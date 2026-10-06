/**
 * signature-agreement-controller.ts
 *
 * Owns one agreement UI's pending and acknowledged lifecycle. It fences retired
 * requests and duplicate clicks but does not persist signatures or grant legal
 * authority; application callbacks own those boundaries.
 */
import {
  acknowledgeSignatureAgreement,
  type SignatureAgreementAcknowledgement,
  type SignatureAgreementError,
  type SignatureAgreementPayload,
  type SignatureAgreementReceipt,
} from './signature-agreement-model';

/** Immutable view state for an agreement's acknowledged-signing lifecycle. */
export interface SignatureAgreementState {
  readonly pending: boolean;
  readonly receipt: SignatureAgreementReceipt | null;
  readonly error: SignatureAgreementError | null;
}

/** Result distinguishes stale completions from current operational failures. */
export type SignatureAgreementRequestResult = 'signed' | 'stale' | 'ignored' | 'failed';

/** A single-source signing lifecycle; construct a new instance when document/scope changes. */
export class SignatureAgreementController {
  private state: SignatureAgreementState = Object.freeze({ pending: false, receipt: null, error: null });
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = true;

  /** Read the stable snapshot consumed by useSyncExternalStore. */
  readonly getSnapshot = (): SignatureAgreementState => this.state;

  /** Observe state changes; unsubscribing only removes this listener. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** React effect reactivation also supports Strict Mode's setup/cleanup replay. */
  activate(): void { this.active = true; }

  /** Prevent a retired request from publishing a receipt after unmount or scope change. */
  retire(): void {
    this.active = false;
    this.generation += 1;
    if (this.state.pending) this.update({ ...this.state, pending: false });
  }

  /** A server-provided signed receipt is sticky for this document lifetime. */
  acceptReceipt(receipt: SignatureAgreementReceipt): void {
    if (!this.active || this.state.receipt === receipt) return;
    this.generation += 1;
    this.update({ pending: false, receipt, error: null });
  }

  /** Editing a rejected draft dismisses its old failure without unlocking a signed record. */
  clearError(): void {
    if (!this.state.pending && !this.state.receipt && this.state.error) this.update({ ...this.state, error: null });
  }

  /** Await the app's receipt; pending, invalid, stale and duplicate work never signs the UI. */
  async sign(
    payload: SignatureAgreementPayload,
    onSign: (payload: SignatureAgreementPayload) => SignatureAgreementAcknowledgement | Promise<SignatureAgreementAcknowledgement>,
    isCurrent: () => boolean,
  ): Promise<SignatureAgreementRequestResult> {
    if (!this.active || this.state.pending || this.state.receipt || !isCurrent()) return 'ignored';
    const generation = ++this.generation;
    const current = () => this.active && this.generation === generation && isCurrent();
    this.update({ pending: true, receipt: null, error: null });
    let receipt: SignatureAgreementReceipt;
    try {
      const acknowledgement = await onSign(payload);
      if (!current()) return 'stale';
      receipt = acknowledgeSignatureAgreement(payload, acknowledgement);
    } catch {
      if (!current()) return 'stale';
      this.update({ pending: false, receipt: null, error: {
        code: 'SIGNATURE_AGREEMENT_SAVE_FAILED',
        message: 'The signature was not confirmed. Please try again.',
      } });
      return 'failed';
    } finally {
      if (this.active && this.generation === generation && this.state.pending) {
        this.update({ ...this.state, pending: false });
      }
    }
    if (!current()) return 'stale';
    this.update({ pending: false, receipt, error: null });
    return 'signed';
  }

  private update(state: SignatureAgreementState): void {
    this.state = Object.freeze(state);
    for (const listener of this.listeners) listener();
  }
}
