/**
 * App-local service and lifecycle container used by managed `createApp()`.
 *
 * This is deliberately not an ambient "current app" singleton. Callers keep
 * the concrete runtime they created and pass it (or narrow dependencies from
 * it) into plugins, routes, and background work.
 */

export interface ZeroRuntimeServiceKey<T> {
  readonly token: symbol;
  readonly label: string;
  /** Type-only marker. */
  readonly _service?: T;
}

/** Create a collision-proof typed key for one app-local service. */
export function createZeroRuntimeServiceKey<T>(label: string): ZeroRuntimeServiceKey<T> {
  return Object.freeze({ token: Symbol(label), label });
}

export type ZeroRuntimeCleanup = () => void | Promise<void>;

let nextRuntimeId = 0;

export class ZeroAppRuntime {
  readonly id: string;
  private readonly services = new Map<symbol, unknown>();
  private readonly cleanups: ZeroRuntimeCleanup[] = [];
  private disposePromise: Promise<void> | null = null;

  constructor(id = `zero-app-${++nextRuntimeId}`) {
    this.id = id;
  }

  /** Install or replace one service owned by this app. */
  set<T>(key: ZeroRuntimeServiceKey<T>, service: T): T {
    if (this.disposePromise) {
      throw new Error(`[runtime] Cannot install ${key.label}; runtime ${this.id} is stopping.`);
    }
    this.services.set(key.token, service);
    return service;
  }

  /** Return this app's service, or null when the capability is not mounted. */
  get<T>(key: ZeroRuntimeServiceKey<T>): T | null {
    return (this.services.get(key.token) as T | undefined) ?? null;
  }

  /** Return this app's service or fail with an app-local setup error. */
  require<T>(key: ZeroRuntimeServiceKey<T>): T {
    const service = this.get(key);
    if (service === null) {
      throw new Error(`[runtime] ${key.label} is unavailable in runtime ${this.id}.`);
    }
    return service;
  }

  /** Clear an exact service without disturbing a replacement instance. */
  clear<T>(key: ZeroRuntimeServiceKey<T>, expected?: T): void {
    if (expected !== undefined && this.services.get(key.token) !== expected) return;
    this.services.delete(key.token);
  }

  /**
   * Register app-owned teardown in construction order.
   * Teardown runs in reverse order so dependants stop before their providers.
   */
  addCleanup(cleanup: ZeroRuntimeCleanup): () => void {
    if (this.disposePromise) {
      throw new Error(`[runtime] Cannot register cleanup; runtime ${this.id} is stopping.`);
    }
    this.cleanups.push(cleanup);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.cleanups.lastIndexOf(cleanup);
      if (index >= 0) this.cleanups.splice(index, 1);
    };
  }

  /** Stop this app's registered services exactly once. */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.disposeOwnedServices();
    return this.disposePromise;
  }

  private async disposeOwnedServices(): Promise<void> {
    const failures: unknown[] = [];
    for (const cleanup of [...this.cleanups].reverse()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    this.cleanups.length = 0;
    this.services.clear();

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `[runtime] ${failures.length} cleanup operation(s) failed for ${this.id}.`,
      );
    }
  }
}
