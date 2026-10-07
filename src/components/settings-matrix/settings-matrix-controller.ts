/** Own pending/error lifetimes for controlled settings callbacks; never persist values. */

import type { SettingsMatrixChange, SettingsMatrixChangeContext } from './settings-matrix-types';

export const SETTINGS_MATRIX_CHANGE_FAILED = 'This setting could not be saved. Please try again.';

interface PendingChange {
  readonly boundaryKey: string;
  readonly controller: AbortController;
}

export interface SettingsMatrixControllerOptions {
  readonly readBoundary: () => { readonly key: string; readonly ready: boolean };
  readonly isEditable: (key: string) => boolean;
  readonly onFailure: () => void;
}

/** Deduplicate per-cell callbacks and retire results on boundary/capability changes. */
export class SettingsMatrixController {
  private readonly pending = new Map<string, PendingChange>();
  private readonly errors = new Map<string, { readonly boundaryKey: string; readonly message: string }>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private active = false;

  constructor(private readonly options: SettingsMatrixControllerOptions) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = (): number => this.revision;

  /** Effects activate; cleanup synchronously retires every pending callback. */
  activate(): void { this.active = true; }
  retire(): void {
    this.active = false;
    for (const attempt of this.pending.values()) attempt.controller.abort();
    this.pending.clear();
    this.errors.clear();
  }

  /** Descriptor object identity is irrelevant; only current IDs/capabilities matter. */
  reconcile(): void {
    let changed = false;
    for (const [key, attempt] of this.pending) {
      if (this.isCurrent(key, attempt)) continue;
      attempt.controller.abort();
      this.pending.delete(key);
      changed = true;
    }
    for (const [key, error] of this.errors) {
      const boundary = this.options.readBoundary();
      if (boundary.ready && boundary.key === error.boundaryKey && this.options.isEditable(key)) continue;
      this.errors.delete(key);
      changed = true;
    }
    if (changed) this.publish();
  }

  isPending(key: string): boolean {
    const attempt = this.pending.get(key);
    return Boolean(attempt && this.isCurrent(key, attempt));
  }

  getError(key: string): string | null {
    const boundary = this.options.readBoundary();
    const error = this.errors.get(key);
    if (boundary.ready && boundary.key === error?.boundaryKey && this.options.isEditable(key)) return error.message;
    this.errors.delete(key);
    return null;
  }

  /** A fulfilled callback acknowledges an app operation; controlled values remain app-owned. */
  async run(
    key: string,
    change: SettingsMatrixChange,
    callback: (change: SettingsMatrixChange, context: SettingsMatrixChangeContext) => void | Promise<void>,
  ): Promise<void> {
    const boundary = this.options.readBoundary();
    if (!this.active || !boundary.ready || !this.options.isEditable(key) || this.isPending(key)) return;
    this.pending.get(key)?.controller.abort();
    const attempt: PendingChange = { boundaryKey: boundary.key, controller: new AbortController() };
    this.pending.set(key, attempt);
    this.errors.delete(key);
    this.publish();
    try {
      await Promise.resolve().then(() => {
        if (!this.isCurrent(key, attempt)) return;
        return callback(change, { signal: attempt.controller.signal });
      });
    } catch {
      if (!this.isCurrent(key, attempt)) return;
      this.errors.set(key, { boundaryKey: attempt.boundaryKey, message: SETTINGS_MATRIX_CHANGE_FAILED });
      this.options.onFailure();
    } finally {
      if (this.pending.get(key) === attempt) {
        this.pending.delete(key);
        this.publish();
      }
    }
  }

  private isCurrent(key: string, attempt: PendingChange): boolean {
    const boundary = this.options.readBoundary();
    const current = this.active && !attempt.controller.signal.aborted && boundary.ready
      && boundary.key === attempt.boundaryKey && this.options.isEditable(key)
      && this.pending.get(key) === attempt;
    if (!current && this.pending.get(key) === attempt) {
      attempt.controller.abort();
      this.pending.delete(key);
      this.errors.delete(key);
    }
    return current;
  }

  private publish(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}
