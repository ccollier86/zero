/** UI-free native mutation lifecycle. It never retries a write or invents a replacement recovery identity. */
import type { CalendarCommandReceipt } from '../../../calendar/contracts';
import { CalendarMutationError, CalendarReadError } from '../../../frontend/client/calendar-mutation';
import { calendarTransitionAuthorityDenied } from './calendar-transition-model';
import { CalendarDraftReceiptFence, calendarPendingReceiptMatches, type CalendarPendingRequest } from './calendar-workspace-model';

export interface CalendarDraftMutationContext {
  readonly signal: AbortSignal;
  setBusy(busy: boolean): void;
  accept(receipt: CalendarCommandReceipt): unknown;
}
export interface CalendarDraftMutationSnapshot {
  readonly phase: 'editing' | 'submitting' | 'unknown' | 'accepted' | 'conflict';
  readonly busy: boolean;
  readonly error: string | null;
  readonly request: CalendarPendingRequest | null;
}
export interface CalendarDraftMutationOptions {
  isCurrent(context: CalendarDraftMutationContext): boolean;
  readReceipt(key: string, signal: AbortSignal): Promise<CalendarCommandReceipt | null>;
  /** Required synchronous scope-owned recovery registration before dispatch.
   * Throwing or returning a Promise prevents dispatch; it is not a permission grant. */
  onUnknown(request: CalendarPendingRequest): void;
  onRejected(request: CalendarPendingRequest): void;
  onAccepted(request: CalendarPendingRequest): void;
  onAuthorityLost(): void;
}
export class CalendarDraftMutationController {
  private readonly fence = new CalendarDraftReceiptFence();
  private readonly listeners = new Set<() => void>();
  private pending = false;
  private retired = false;
  private state: CalendarDraftMutationSnapshot = { phase: 'editing', busy: false, error: null, request: null };
  constructor(private readonly options: CalendarDraftMutationOptions) {}
  readonly snapshot = (): CalendarDraftMutationSnapshot => this.state;
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  edit(): void { this.fence.edit(); if (this.state.phase === 'editing') this.publish({ error: null }); }
  retire(): void { this.retired = true; }
  private current(context: CalendarDraftMutationContext): boolean { return !this.retired && !context.signal.aborted && this.options.isCurrent(context); }
  /** Settlement observers cannot change source evidence. The boolean additionally
   * lets required pre-dispatch registration fail without dispatching. */
  private notify(observer: () => unknown): boolean {
    try {
      const result = observer();
      if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
        void Promise.resolve(result).catch(() => {}); return false;
      }
      return true;
    } catch { return false; }
  }
  private publish(patch: Partial<CalendarDraftMutationSnapshot>): void {
    this.state = Object.freeze({ ...this.state, ...patch }); for (const listener of this.listeners) this.notify(listener);
  }
  private accepted(context: CalendarDraftMutationContext, receipt: CalendarCommandReceipt): void {
    if (!this.current(context)) return;
    const request = this.state.request, admitted = this.fence.accepted(receipt);
    if (!request || !admitted.matches || typeof receipt.id !== 'string' || receipt.id.length > 128
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(receipt.id) || !calendarPendingReceiptMatches(request, receipt)) {
      this.publish({ phase: 'unknown', error: 'The acknowledgment did not match the original request and revision. Reconcile that identity.' }); return;
    }
    this.publish({ phase: 'accepted', error: admitted.canClose ? null
      : 'The submitted revision was accepted. Your newer edits are preserved and have not been submitted. Close to review current data before another operation.' });
    if (!this.current(context)) return;
    this.notify(() => this.options.onAccepted(request));
    if (!this.current(context)) return;
    if (admitted.canClose) {
      try { context.accept(receipt); }
      catch { this.publish({ error: 'The submitted revision was accepted, but the editor could not close. Close to review current data.' }); }
    }
  }
  async submit(context: CalendarDraftMutationContext, request: CalendarPendingRequest, dispatch: () => Promise<CalendarCommandReceipt>): Promise<void> {
    if (this.pending || this.state.phase !== 'editing' || !this.current(context)) return;
    const captured = Object.freeze({ ...request });
    this.fence.submit(captured.key, captured.operation, captured.id);
    this.pending = true; this.publish({ phase: 'submitting', busy: true, error: null, request: captured });
    let dispatched = false;
    try {
      if (!this.current(context)) return;
      if (!this.notify(() => this.options.onUnknown(captured))) {
        this.fence.rejected(); this.notify(() => this.options.onRejected(captured));
        if (this.current(context)) this.publish({ phase: 'editing', request: null,
          error: 'The editor could not register recovery for this operation. No mutation was dispatched; your draft is preserved.' });
        return;
      }
      // An owner callback can retire the opening synchronously before dispatch.
      if (!this.current(context)) return;
      context.setBusy(true);
      if (!this.current(context)) return;
      dispatched = true;
      this.accepted(context, await dispatch());
    } catch (cause) {
      if (!this.current(context)) return;
      if (!dispatched) {
        this.fence.rejected(); this.notify(() => this.options.onRejected(captured));
        if (!this.current(context)) return;
        this.publish({ phase: 'editing', request: null, error: 'The editor could not start the operation. No mutation was dispatched; your draft is preserved.' }); return;
      }
      const known = cause instanceof CalendarMutationError && !cause.requiresReconciliation && cause.idempotencyKey === captured.key;
      if (known) { this.fence.rejected(); this.notify(() => this.options.onRejected(captured)); if (!this.current(context)) return; }
      if (cause instanceof CalendarMutationError && calendarTransitionAuthorityDenied(cause)) {
        this.notify(() => this.options.onAuthorityLost()); this.retire(); return;
      }
      if (!known) this.publish({ phase: 'unknown', error: 'The appointment change may have been accepted. Reconcile this original request; do not submit it again.' });
      else {
        const conflict = cause.code === 'CALENDAR_REVISION_CONFLICT' || cause.code === 'CALENDAR_TRANSITION_INVALID';
        this.publish({ phase: conflict ? 'conflict' : 'editing', request: null,
          error: conflict ? 'The appointment changed. Your draft is preserved without rebasing. Close and review current details.'
            : 'The appointment change was not accepted. Your draft is preserved; review current resources, catalogs and participants before retrying.' });
      }
    } finally { this.pending = false; if (this.current(context)) { this.publish({ busy: false }); this.notify(() => context.setBusy(false)); } }
  }
  async reconcile(context: CalendarDraftMutationContext): Promise<void> {
    const request = this.state.request;
    if (!request || this.state.phase !== 'unknown' || this.pending || !this.current(context)) return;
    this.pending = true; this.publish({ busy: true });
    try {
      context.setBusy(true);
      const receipt = await this.options.readReceipt(request.key, context.signal);
      if (!this.current(context)) return;
      if (receipt) this.accepted(context, receipt);
      else this.publish({ error: 'No receipt is currently visible. This does not prove rollback. Keep the original request identity.' });
    } catch (cause) {
      if (!this.current(context)) return;
      if (cause instanceof CalendarReadError && calendarTransitionAuthorityDenied(cause)) { this.notify(() => this.options.onAuthorityLost()); this.retire(); }
      else this.publish({ error: 'Reconciliation is unavailable. Keep the original request identity; do not repeat the mutation.' });
    } finally { this.pending = false; if (this.current(context)) { this.publish({ busy: false }); this.notify(() => context.setBusy(false)); } }
  }
}
