/** Single-flight pre-close decisions for exact modal instances; owns no dialog, persistence, or auth. */
import type { ModalInstance } from './modal.types';

interface PendingClose {
  readonly modal: ModalInstance;
  readonly controller: AbortController;
  readonly promise: Promise<boolean>;
  readonly resolve: (closed: boolean) => void;
}

/** App guards are advisory and may not keep discarded/security-retired instances alive. */
export class ModalCloseAdmission {
  private readonly pending = new Map<string, PendingClose>();
  constructor(private readonly options: {
    readonly isCurrent: (modal: ModalInstance) => boolean;
    readonly commit: (modal: ModalInstance) => void;
    readonly onFailure: () => void;
  }) {}

  request(modal: ModalInstance, force = false): Promise<boolean> {
    if (!this.options.isCurrent(modal)) return Promise.resolve(false);
    if (force || !modal.beforeClose) {
      this.cancel(modal.id); this.options.commit(modal); return Promise.resolve(true);
    }
    const previous = this.pending.get(modal.id);
    if (previous?.modal === modal) return previous.promise;
    this.cancel(modal.id);
    let resolve!: (closed: boolean) => void;
    const promise = new Promise<boolean>(yes => { resolve = yes; });
    const attempt: PendingClose = { modal, controller: new AbortController(), promise, resolve };
    this.pending.set(modal.id, attempt);
    const current = () => this.pending.get(modal.id) === attempt && !attempt.controller.signal.aborted
      && this.options.isCurrent(modal);
    const complete = (allowed: boolean) => {
      if (!current()) { resolve(false); return; }
      this.pending.delete(modal.id);
      if (allowed === true) this.options.commit(modal);
      resolve(allowed === true);
    };
    const failed = () => {
      if (current()) { this.pending.delete(modal.id); this.options.onFailure(); }
      resolve(false);
    };
    try {
      const decision = modal.beforeClose({ signal: attempt.controller.signal });
      if (typeof decision === 'boolean') complete(decision);
      else void Promise.resolve(decision).then(complete, failed);
    } catch { failed(); }
    return promise;
  }

  cancel(id: string): void {
    const attempt = this.pending.get(id);
    if (!attempt) return;
    this.pending.delete(id); attempt.controller.abort(); attempt.resolve(false);
  }
  cancelAll(): void { for (const id of this.pending.keys()) this.cancel(id); }
}
