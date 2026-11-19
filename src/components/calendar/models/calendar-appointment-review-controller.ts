/** Read-only review lifecycle, never a second mutation/recovery owner. */
import type { CalendarAppointmentOverride, CalendarOverrideReview } from '../../../calendar/contracts';
import { CalendarReadError } from '../../../frontend/client/calendar-mutation';
import { calendarOverrideReview } from '../../../frontend/client/calendar-client-overrides';
export interface CalendarAppointmentReviewContext { readonly signal: AbortSignal }
export interface CalendarAppointmentReviewSnapshot {
  readonly phase: 'idle' | 'loading' | 'ready' | 'stale' | 'unavailable';
  readonly basis: string | null; readonly key: string | null; readonly result: CalendarOverrideReview | null;
  readonly selected: boolean; readonly reason: string; readonly error: string | null;
}
export class CalendarAppointmentReviewController {
  private generation = 0; private abort: AbortController | null = null;
  private state: CalendarAppointmentReviewSnapshot = { phase: 'idle', basis: null, key: null, result: null, selected: false, reason: '', error: null };
  private readonly listeners = new Set<() => void>();
  constructor(private readonly options: {
    isCurrent(context: CalendarAppointmentReviewContext, basis: string): boolean;
    createKey(): string; onEdit(): void; onAuthorityLost(): void;
  }) {}
  readonly snapshot = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<CalendarAppointmentReviewSnapshot>) {
    this.state = Object.freeze({ ...this.state, ...patch }); for (const listener of this.listeners) { try { listener(); } catch { /* React observation cannot decide source outcomes. */ } }
  }
  invalidate(): void {
    this.generation++; this.abort?.abort(); this.abort = null;
    if (this.state.phase !== 'idle') this.publish({ phase: 'stale', basis: null, key: null, result: null, selected: false, error: 'The review is no longer current. Review this draft again or cancel review.' });
  }
  cancel(): void {
    this.generation++; this.abort?.abort(); this.abort = null;
    this.publish({ phase: 'idle', basis: null, key: null, result: null, selected: false, reason: '', error: null });
  }
  choose(context: CalendarAppointmentReviewContext, basis: string, selected: boolean): void {
    if (!this.options.isCurrent(context, basis) || this.state.basis !== basis || this.state.phase !== 'ready' || this.state.result?.status !== 'reviewable') return;
    if (this.state.selected !== selected) { this.options.onEdit(); this.publish({ selected }); }
  }
  reason(context: CalendarAppointmentReviewContext, basis: string, reason: string): void {
    if (!this.options.isCurrent(context, basis)) return;
    if (this.state.reason !== reason) { this.options.onEdit(); this.publish({ reason }); }
  }
  async review(context: CalendarAppointmentReviewContext, basis: string, load: (key: string, signal: AbortSignal) => Promise<CalendarOverrideReview>): Promise<void> {
    if (!this.options.isCurrent(context, basis) || this.state.phase === 'loading') return;
    this.abort?.abort(); const abort = new AbortController(), generation = ++this.generation, key = this.options.createKey(); this.abort = abort;
    const signal = AbortSignal.any([context.signal, abort.signal]);
    this.publish({ phase: 'loading', basis, key, result: null, selected: false, error: null });
    try {
      if (signal.aborted || generation !== this.generation || !this.options.isCurrent(context, basis)) return;
      const result = calendarOverrideReview(await load(key, signal));
      if (signal.aborted || generation !== this.generation || !this.options.isCurrent(context, basis)) return;
      this.publish({ phase: 'ready', result });
    } catch (error) {
      if (signal.aborted || generation !== this.generation || !this.options.isCurrent(context, basis)) return;
      this.publish({ phase: 'unavailable', key: null, result: null, selected: false, error: 'Exception review is unavailable for this request or current access. No mutation was submitted.' });
      if (error instanceof CalendarReadError && (error.status === 401 || error.status === 428
        || ['UNAUTHORIZED', 'AUTH_UNAUTHORIZED', 'FORBIDDEN', 'AUTH_FORBIDDEN', 'CALENDAR_FORBIDDEN', 'LOGGING_ADMISSION_REQUIRED'].includes(error.code ?? ''))) {
        try {
          const notified: unknown = this.options.onAuthorityLost();
          if (notified && (typeof notified === 'object' || typeof notified === 'function') && 'then' in notified) void Promise.resolve(notified).catch(() => {});
        } catch { /* Notification cannot turn a read refusal into mutation uncertainty. */ }
      }
    } finally { if (this.abort === abort) this.abort = null; }
  }
  submission(context: CalendarAppointmentReviewContext, basis: string): { readonly key?: string; readonly override?: CalendarAppointmentOverride } | null {
    if (this.state.phase === 'idle') return {};
    if (!this.options.isCurrent(context, basis) || this.state.phase !== 'ready' || this.state.basis !== basis || !this.state.key) return null;
    if (this.state.result?.status === 'clear') return { key: this.state.key };
    const result = this.state.result, reason = this.state.reason.trim();
    if (result?.status !== 'reviewable' || !this.state.selected || !reason || this.state.reason.length > 1024 || /[\u0000-\u001f\u007f]/.test(this.state.reason)) return null;
    if (Date.parse(result.expiresAt) <= Date.now()) return null; // Presentation hint only; the native writer owns expiry admission.
    return { key: this.state.key, override: Object.freeze({ policyVersion: result.policyVersion, decisionToken: result.decisionToken, reason }) };
  }
}
