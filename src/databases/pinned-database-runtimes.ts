/**
 * Ordered owner for database runtimes that remain pinned to one app process.
 *
 * The manager uses this for today's system and application planes. The same
 * primitive can own future service planes (logs, metrics, audit, or plugins)
 * without teaching the lifecycle boundary another one-off database field.
 */

import { DatabaseError } from './database-error';
import { DatabaseRuntime, type DatabaseRuntimeRole } from './database-runtime';

const DATABASE_PLANE_MAX_LENGTH = 128;
const DATABASE_PLANE_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;

export interface PinnedDatabaseRuntimeBinding {
  /** Stable logical role; never interpreted as a path or tenant selector. */
  readonly plane: string;
  readonly runtime: DatabaseRuntime;
}

export interface PinnedDatabaseRuntimeDiagnostics {
  readonly plane: string;
  readonly id: string;
  readonly role: DatabaseRuntimeRole;
  readonly started: boolean;
  readonly closed: boolean;
}

/** Lifecycle and lookup boundary for app-process-owned database planes. */
export class PinnedDatabaseRuntimes {
  readonly #bindings: readonly PinnedDatabaseRuntimeBinding[];
  readonly #byPlane: ReadonlyMap<string, DatabaseRuntime>;

  constructor(bindings: readonly PinnedDatabaseRuntimeBinding[]) {
    if (!Array.isArray(bindings) || bindings.length === 0) {
      throw configInvalid('At least one pinned database runtime is required.');
    }

    const byPlane = new Map<string, DatabaseRuntime>();
    const runtimes = new Set<DatabaseRuntime>();
    const normalized = bindings.map((binding) => {
      if (!binding || typeof binding !== 'object'
        || !isDatabasePlane(binding.plane)
        || !(binding.runtime instanceof DatabaseRuntime)) {
        throw configInvalid('Pinned database runtime configuration is invalid.');
      }
      if (byPlane.has(binding.plane)) {
        throw configInvalid(`Pinned database plane "${binding.plane}" is duplicated.`);
      }
      if (runtimes.has(binding.runtime)) {
        throw configInvalid('A database runtime cannot own more than one pinned plane.');
      }
      if (binding.runtime.diagnostics().closed) {
        throw configInvalid(`Pinned database plane "${binding.plane}" is already closed.`);
      }
      byPlane.set(binding.plane, binding.runtime);
      runtimes.add(binding.runtime);
      return Object.freeze({ plane: binding.plane, runtime: binding.runtime });
    });

    this.#bindings = Object.freeze(normalized);
    this.#byPlane = byPlane;
  }

  get size(): number {
    return this.#bindings.length;
  }

  get(plane: string): DatabaseRuntime | null {
    return this.#byPlane.get(plane) ?? null;
  }

  /** Start in dependency order. */
  start(): void {
    try {
      for (const binding of this.#bindings) binding.runtime.start();
    } catch (cause) {
      if (cause instanceof DatabaseError) throw cause;
      throw new DatabaseError(
        'DATABASE_OPEN_FAILED',
        'Pinned database runtime startup failed.',
        { cause, retryable: true, outcome: 'not-started' },
      );
    }
  }

  /** Close in reverse dependency order while attempting every owned plane. */
  close(): void {
    const failures: unknown[] = [];
    for (const binding of [...this.#bindings].reverse()) {
      try {
        binding.runtime.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 0) return;
    if (failures.length === 1 && failures[0] instanceof DatabaseError) {
      throw failures[0];
    }
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Pinned database runtime cleanup failed.',
      {
        cause: new AggregateError(failures, 'Pinned database cleanup failed.'),
        retryable: false,
        outcome: 'unknown',
      },
    );
  }

  diagnostics(): readonly PinnedDatabaseRuntimeDiagnostics[] {
    return Object.freeze(this.#bindings.map(({ plane, runtime }) => {
      const diagnostics = runtime.diagnostics();
      return Object.freeze({
        plane,
        id: diagnostics.id,
        role: diagnostics.role,
        started: diagnostics.started,
        closed: diagnostics.closed,
      });
    }));
  }
}

function isDatabasePlane(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= DATABASE_PLANE_MAX_LENGTH
    && DATABASE_PLANE_PATTERN.test(value);
}

function configInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', message);
}
