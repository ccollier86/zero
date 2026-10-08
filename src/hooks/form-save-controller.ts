/** Owns Save/Discard/Stay decisions over an existing form adapter; no values, routing, or persistence. */

import type { FormSubmitResult } from './form-save-types';

export interface FormSaveAdapter {
  /** Optional opaque draft-target incarnation; supplied automatically by useForm. */
  readonly boundaryKey?: string;
  readonly isDirty: boolean;
  readonly isSubmitting: boolean;
  readonly submitError?: string | null;
  submit(): Promise<FormSubmitResult>;
  reset(): void;
}
export interface FormSaveControllerOptions {
  readonly readBoundary: () => { readonly key: string; readonly ready: boolean };
  readonly readForm: () => FormSaveAdapter;
  readonly onNotificationFailure: () => void;
}
export interface FormSaveState {
  readonly saving: boolean;
  readonly confirmationOpen: boolean;
  readonly error: string | null;
}
/** Cancels only the leave decision; a separately admitted save still owns its acknowledgment. */
export interface FormLeaveOptions {
  readonly signal?: AbortSignal;
}
const IDLE: FormSaveState = Object.freeze({ saving: false, confirmationOpen: false, error: null });
interface LeaveAttempt {
  readonly key: string;
  readonly continuation: () => void | Promise<void>;
  readonly resolve: (continued: boolean) => void;
  readonly signal?: AbortSignal;
  dispose(): void;
}

/** Single-flight save and scope-fenced continuation; security retirement never asks permission. */
export class FormSaveController {
  private active = false;
  private epoch = 0;
  private state = IDLE;
  private stateKey: string | null = null;
  private saveAttempt: object | null = null;
  private leave: LeaveAttempt | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly options: FormSaveControllerOptions) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = (): FormSaveState => {
    const boundary = this.options.readBoundary();
    return this.active && boundary.ready && this.stateKey === boundary.key ? this.state : IDLE;
  };
  activate(): void { this.active = true; }
  /** Resolve obsolete navigation false; retiring auth never retains/vetoes old draft UI. */
  retire(): void {
    this.active = false; this.epoch += 1; this.saveAttempt = null;
    this.cancelLeave(); this.publish(IDLE);
  }
  reconcile(): void {
    const boundary = this.options.readBoundary();
    if (!boundary.ready || this.stateKey !== null && this.stateKey !== boundary.key) {
      this.epoch += 1; this.saveAttempt = null; this.cancelLeave(); this.publish(IDLE);
    }
  }
  /** Native beforeunload asks only for a current readable draft/pending operation. */
  needsLeavePrompt(): boolean {
    const boundary = this.options.readBoundary(), form = this.options.readForm();
    return this.active && boundary.ready && (form.isDirty || form.isSubmitting || this.saveAttempt !== null);
  }

  /** Accepted results alone are not enough to leave if edits made during the save remain. */
  async save(): Promise<FormSubmitResult> {
    this.reconcile();
    const boundary = this.options.readBoundary();
    if (!this.active || !boundary.ready) return { kind: 'retired' };
    if (this.saveAttempt || this.options.readForm().isSubmitting) return { kind: 'blocked' };
    const attempt = {}, epoch = this.epoch;
    this.saveAttempt = attempt;
    this.publish({ saving: true, confirmationOpen: this.leave !== null, error: null });
    const current = () => this.active && epoch === this.epoch && this.saveAttempt === attempt
      && this.options.readBoundary().ready && this.options.readBoundary().key === boundary.key;
    try {
      const result = await this.options.readForm().submit();
      if (!current()) return { kind: 'retired' };
      const error = result.kind === 'failed' ? result.error : result.kind === 'invalid'
        ? 'Check the highlighted fields before saving.' : result.kind === 'blocked'
          ? 'Saving is not available for this form.' : null;
      this.publish({ saving: false, confirmationOpen: this.leave !== null, error });
      return result;
    } catch {
      if (!current()) return { kind: 'retired' };
      const error = 'These changes could not be saved. Please try again.';
      this.options.onNotificationFailure();
      this.publish({ saving: false, confirmationOpen: this.leave !== null, error });
      return { kind: 'failed', error, conflict: false };
    } finally {
      if (this.saveAttempt === attempt) this.saveAttempt = null;
    }
  }

  discard(): boolean {
    this.reconcile();
    if (!this.active || !this.options.readBoundary().ready || this.saveAttempt || this.options.readForm().isSubmitting) return false;
    try {
      this.options.readForm().reset(); this.publish({ saving: false, confirmationOpen: this.leave !== null, error: null });
      return true;
    } catch {
      this.options.onNotificationFailure(); this.publish({ saving: false, confirmationOpen: this.leave !== null,
        error: 'These changes could not be discarded. Please try again.' }); return false;
    }
  }

  /** Root-owned router/modal adapters supply the actual continuation, not this controller. */
  requestLeave(continuation: () => void | Promise<void>, options: FormLeaveOptions = {}): Promise<boolean> {
    this.reconcile();
    const boundary = this.options.readBoundary();
    if (!this.active || !boundary.ready || this.leave || options.signal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const attempt: LeaveAttempt = { key: boundary.key, continuation, resolve, signal: options.signal,
        dispose: () => options.signal?.removeEventListener('abort', abort) };
      const abort = () => {
        if (this.leave !== attempt) return;
        this.cancelLeave();
        this.publish({ saving: this.saveAttempt !== null, confirmationOpen: false, error: null });
      };
      this.leave = attempt;
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) { abort(); return; }
      if (!this.needsLeavePrompt()) {
        void this.continue(attempt).then(continued => this.finishLeave(attempt, continued));
      } else this.publish({ saving: this.saveAttempt !== null, confirmationOpen: true, error: null });
    });
  }

  async chooseLeave(choice: 'save' | 'discard' | 'stay'): Promise<void> {
    const leave = this.leave;
    if (!leave || !this.active || !this.options.readBoundary().ready || leave.key !== this.options.readBoundary().key) return;
    if (choice === 'stay') {
      if (this.saveAttempt) return;
      this.finishLeave(leave, false); return;
    }
    if (choice === 'save') {
      const result = await this.save();
      if (this.leave !== leave || result.kind !== 'accepted') return;
      if (this.options.readForm().isDirty) {
        this.publish({ saving: false, confirmationOpen: true, error: 'Your saved changes were accepted, but newer edits still need saving.' });
        return;
      }
    } else if (!this.discard()) return;
    if (this.leave !== leave) return;
    this.publish({ saving: false, confirmationOpen: false, error: null });
    this.finishLeave(leave, await this.continue(leave));
  }

  private async continue(leave: LeaveAttempt): Promise<boolean> {
    const boundary = this.options.readBoundary();
    if (!this.active || !boundary.ready || boundary.key !== leave.key || this.leave !== leave || leave.signal?.aborted) return false;
    const epoch = this.epoch;
    const current = () => this.active && epoch === this.epoch && this.leave === leave && !leave.signal?.aborted && this.options.readBoundary().ready
      && this.options.readBoundary().key === leave.key;
    try { await leave.continuation(); return current(); }
    catch { if (current()) this.options.onNotificationFailure(); return false; }
  }
  private cancelLeave(): void {
    const leave = this.leave;
    if (!leave) return;
    this.leave = null; leave.dispose(); leave.resolve(false);
  }
  private finishLeave(leave: LeaveAttempt, continued: boolean): void {
    if (this.leave !== leave) return;
    this.leave = null; leave.dispose(); leave.resolve(continued);
    this.publish({ saving: this.saveAttempt !== null, confirmationOpen: false, error: null });
  }
  private publish(state: FormSaveState): void {
    this.stateKey = this.options.readBoundary().key;
    this.state = Object.freeze(state);
    for (const listener of this.listeners) listener();
  }
}
