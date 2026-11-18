/** Private bounded source -> Jobs handoff. Never holds a calendar lease over Jobs or joins Torrent/provider execution. */
import { JobsError } from '../jobs/error';
import { DatabaseError } from '../databases/database-error';
import { WorkerError } from '../workers/worker-error';
import type { SourceJobs } from '../jobs/source-service';
import { jobSourceId, jobSourceScheduleId, type JobSourceRegistration, type JobSourceScheduleReceipt } from '../jobs/source-model';
import { CalendarError } from './error';
import { CALENDAR_INTEGRATION_LIMITS, type CalendarIntegrationClaim, type CalendarIntegrationCode, type CalendarIntegrationIntentView } from './integration-model';
import type { CalendarIntegrationOwner } from './integration-runtime';
import { calendarHash, calendarInteger, calendarKey, calendarRecord } from './validation';

export type CalendarIntegrationDispatchStore = Pick<CalendarIntegrationOwner, 'assertCurrent' | 'command' | 'signal'>;
export interface CalendarIntegrationDispatchJobs {
  readonly registration: Pick<SourceJobs['registration'], 'get'>;
  readonly receipts: Pick<SourceJobs['receipts'], 'get'>;
  readonly schedules: Pick<SourceJobs['schedules'], 'create' | 'cancel' | 'get'>;
}
export interface CalendarIntegrationDispatcherOptions {
  readonly store: CalendarIntegrationDispatchStore;
  /** Pure synchronous native capability lookup only: it must not start work, retain a lease, or return a promise. */
  readonly jobs: CalendarIntegrationDispatchJobs | ((intent: CalendarIntegrationIntentView) => CalendarIntegrationDispatchJobs);
  readonly now?: () => number;
  readonly nonce?: () => string;
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly retryMs?: number;
  readonly onFailure?: (code: CalendarIntegrationCode) => void;
}
export interface CalendarIntegrationBatchResult {
  readonly claimed: number; readonly accepted: number; readonly cancelled: number;
  readonly suppressed: number; readonly deferred: number; readonly stale: number;
}
type MutableResult = { -readonly [Key in keyof CalendarIntegrationBatchResult]: CalendarIntegrationBatchResult[Key] };

/** Explicit batches and coalesced advisory wakes only. Empty queues install no timer or recurring Jobs schedule. */
export class CalendarIntegrationDispatcher {
  private readonly abort = new AbortController();
  private readonly signal: AbortSignal;
  private readonly now: () => number;
  private readonly nonce: () => string;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly retryMs: number;
  private active: Promise<CalendarIntegrationBatchResult> | null = null;
  private wakeQueued = false;
  private wakeAgain = false;
  private closing = false;
  private readonly cleanupFailures = new Map<string, CalendarIntegrationCode>();
  constructor(private readonly options: CalendarIntegrationDispatcherOptions) {
    this.signal = AbortSignal.any([options.store.signal, this.abort.signal]);
    this.now = options.now ?? Date.now; this.nonce = options.nonce ?? (() => 'claim_' + crypto.randomUUID());
    this.batchSize = calendarInteger(options.batchSize ?? 25, 1, CALENDAR_INTEGRATION_LIMITS.page);
    this.leaseMs = calendarInteger(options.leaseMs ?? 30_000, 1, CALENDAR_INTEGRATION_LIMITS.leaseMs);
    this.retryMs = calendarInteger(options.retryMs ?? 1_000, 1, CALENDAR_INTEGRATION_LIMITS.leaseMs);
  }
  runBatch(): Promise<CalendarIntegrationBatchResult> {
    if (this.active) return this.active;
    if (this.cleanupFailures.size) return Promise.reject(new CalendarError('CALENDAR_OUTCOME_UNKNOWN'));
    try { this.guard(); } catch (error) { return Promise.reject(error); }
    const task = Promise.resolve().then(() => this.batch()); this.active = task;
    void task.finally(() => {
      if (this.active === task) this.active = null;
      if (this.wakeAgain && !this.closing) { this.wakeAgain = false; this.wake(); }
    }).catch(() => {});
    return task;
  }
  wake(): void {
    if (this.closing || this.signal.aborted || this.cleanupFailures.size) return;
    if (this.active) { this.wakeAgain = true; return; }
    if (this.wakeQueued) return; this.wakeQueued = true;
    queueMicrotask(() => {
      this.wakeQueued = false; if (this.closing || this.signal.aborted) return;
      void this.runBatch().catch(error => this.report(safeCode(error)));
    });
  }
  /** Stops intake and drains this handoff caller, NOT physical Jobs callbacks.
   * Keep the calendar owner alive until the shared Jobs service has drained.
   */
  async close(): Promise<void> {
    this.closing = true; this.wakeAgain = false; this.abort.abort();
    await Promise.allSettled(this.active ? [this.active] : []);
    if (this.cleanupFailures.size) throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
  }
  diagnostics() { return { closing: this.closing, active: this.active !== null, wakeQueued: this.wakeQueued, batchSize: this.batchSize,
    unsettledUninvokedClaims: [...this.cleanupFailures].map(([id, code]) => ({ id, code })) }; }
  private guard = () => {
    if (this.closing) throw new CalendarError('CALENDAR_NOT_READY');
    this.signal.throwIfAborted(); this.options.store.assertCurrent();
  };
  private async batch(): Promise<CalendarIntegrationBatchResult> {
    this.guard(); const nonce = calendarKey(this.nonce());
    const claims = await this.command<CalendarIntegrationClaim[]>('calendar.integration.claim',
      { now: this.time(), nonce, leaseMs: this.leaseMs, limit: this.batchSize }, ['claim', nonce]);
    if (!Array.isArray(claims) || claims.length > this.batchSize) throw new CalendarError('CALENDAR_STATE_INVALID');
    const result: MutableResult = { claimed: claims.length, accepted: 0, cancelled: 0, suppressed: 0, deferred: 0, stale: 0 };
    const uninvoked = new Map<string, CalendarIntegrationClaim>();
    for (const claim of claims) {
      if (claim.nonce !== nonce || claim.id !== claim.intent.id || typeof claim.previouslyAttempted !== 'boolean') throw new CalendarError('CALENDAR_STATE_INVALID');
      calendarInteger(claim.claimGeneration, 1);
      if (!claim.previouslyAttempted && !claim.intent.jobsReceipt) uninvoked.set(claim.id, claim);
    }
    try {
      for (const claim of claims) {
        this.guard();
        await this.handoff(claim, result, () => { uninvoked.delete(claim.id); });
        uninvoked.delete(claim.id);
      }
      return Object.freeze(result);
    } finally {
      // Every controlled exit retains this process's no-invocation knowledge,
      // including a failed source settlement before later rows were visited.
      await this.releaseUninvoked(uninvoked.values());
      if (this.cleanupFailures.size) throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
    }
  }
  private async handoff(claim: CalendarIntegrationClaim, result: MutableResult, markInvoked: () => void): Promise<void> {
    const intent = claim.intent;
    let attempted = false, acceptanceObserved = intent.jobsReceipt !== null;
    try {
      this.guard();
      const jobs = typeof this.options.jobs === 'function' ? this.options.jobs(intent) : this.options.jobs;
      if (!jobs || typeof jobs.registration?.get !== 'function' || typeof jobs.receipts?.get !== 'function'
        || typeof jobs.schedules?.create !== 'function' || typeof jobs.schedules?.cancel !== 'function' || typeof jobs.schedules?.get !== 'function') {
        // Consume a genuine mistakenly async resolver rejection without calling
        // an authored then getter or joining any work it returned.
        try { Promise.prototype.then.call(jobs, undefined, () => {}); } catch {}
        throw new CalendarError('CALENDAR_CONFIG_INVALID');
      }
      if (intent.jobsReceipt) {
        const original = receipt(intent.jobsReceipt, intent, 'create');
        if (intent.eligibility === 'current' && !this.expired(intent)) {
          await this.ack(claim, 'create', original); result.accepted++; return;
        }
        const saved = await jobs.receipts.get(intent.cancelKey); this.guard();
        let cancelled: JobSourceScheduleReceipt;
        if (saved) cancelled = receipt(saved, intent, 'cancel');
        else {
          const selected = await jobs.schedules.get(original.id); this.guard();
          if (selected.schedule.control === 'cancelled') cancelled = receipt(selected.receipt, intent, 'cancel');
          else {
            // This adapter never replaces schedules. The immutable original revision
            // remains the cancel command's CAS and its permanent key never changes.
            if (selected.schedule.revision !== original.revision) throw new JobsError('JOBS_REVISION_CONFLICT');
            attempted = true;
            cancelled = receipt(await jobs.schedules.cancel(original.id,
              { idempotencyKey: intent.cancelKey, expectedRevision: original.revision, signal: this.signal }), intent, 'cancel');
          }
        }
        await this.ack(claim, 'cancel', cancelled); result.cancelled++; return;
      }
      const saved = await jobs.receipts.get(intent.createKey); this.guard();
      if (saved) { acceptanceObserved = true; markInvoked(); await this.ack(claim, 'create', receipt(saved, intent, 'create')); result.accepted++; return; }
      if (!claim.previouslyAttempted && (intent.eligibility !== 'current' || this.expired(intent))) {
        // Only the source's durable preclaim fact permits this no-write decision.
        // A null Jobs read alone never proves an uncertain old writer is absent.
        await this.suppress(claim); result.suppressed++; return;
      }
      const expected = expectedRegistration(intent);
      const current = await jobs.registration.get(); this.guard();
      if (!claim.previouslyAttempted && !sameRegistration(current, expected)) throw new JobsError('JOBS_AUTHORITY_RETIRED');
      if (!claim.previouslyAttempted && this.expired(intent)) { await this.suppress(claim); result.suppressed++; return; }
      // Re-enter the exact original create through Jobs' per-schedule gate even
      // after a null receipt read. That gate waits for a cancelled physical writer.
      // expectedRegistration prevents a missing old command sliding into a new
      // policy epoch; an original committed receipt still precedes that fence.
      attempted = true; markInvoked();
      const created = await jobs.schedules.create({ input: intent.input, at: intent.at,
        maxLatenessMs: intent.maxLatenessMs, initiatedBy: intent.initiatedBy },
      { idempotencyKey: intent.createKey, expectedRegistration: expected, signal: this.signal });
      acceptanceObserved = true;
      this.guard(); await this.ack(claim, 'create', receipt(created, intent, 'create')); result.accepted++;
    } catch (error) {
      this.guard();
      if (isStale(error)) { result.stale++; return; }
      if (!claim.previouslyAttempted && !acceptanceObserved && attempted && isKnownNoJobCommit(error) && this.expired(intent)) {
        try { await this.suppress(claim); result.suppressed++; return; }
        catch (settlement) { if (isStale(settlement)) { result.stale++; return; } throw settlement; }
      }
      const code = safeCode(error), unknown = acceptanceObserved || attempted && !isKnownNoJobCommit(error);
      const notCommitted = !claim.previouslyAttempted && !acceptanceObserved && (!attempted || isKnownNoJobCommit(error));
      try {
        const now = this.time();
        await this.command('calendar.integration.defer', { ...claimIdentity(claim), now, code,
          retryAt: now + (code === 'JOBS_CAPACITY' ? Math.max(5_000, this.retryMs) : this.retryMs), unknown, ...(notCommitted ? { notCommitted: true } : {}) }, ['defer', claim.id, claim.nonce, claim.claimGeneration]);
        result.deferred++; this.report(code);
      } catch (settlement) { if (isStale(settlement)) result.stale++; else throw settlement; }
    }
  }
  private expired(intent: CalendarIntegrationIntentView): boolean { return this.time() > Date.parse(intent.at) + intent.maxLatenessMs; }
  private time(): number { return calendarInteger(this.now(), 0, 8_640_000_000_000_000); }
  private ack(claim: CalendarIntegrationClaim, phase: 'create' | 'cancel', value: JobSourceScheduleReceipt) {
    return this.command('calendar.integration.ack', { ...claimIdentity(claim), phase, receipt: value }, ['ack', phase, claim.id, claim.nonce, claim.claimGeneration]);
  }
  private suppress(claim: CalendarIntegrationClaim) {
    return this.command('calendar.integration.suppress', claimIdentity(claim), ['suppress', claim.id, claim.nonce, claim.claimGeneration]);
  }
  /** This process knows these first-attempt rows never invoked a Jobs mutation.
   * Persist that fact before the owner closes; a restart may NOT infer it later.
   */
  private async releaseUninvoked(claims: Iterable<CalendarIntegrationClaim>): Promise<void> {
    const ownerGuard = () => { this.options.store.signal.throwIfAborted(); this.options.store.assertCurrent(); };
    for (const claim of claims) {
      try {
        ownerGuard(); const now = this.time();
        await this.options.store.command('calendar.integration.defer', { ...claimIdentity(claim), now, retryAt: now + this.retryMs,
          code: 'CALENDAR_NOT_READY', unknown: false, notCommitted: true },
        { idempotencyKey: 'calendar-integration:' + calendarHash(['close-uninvoked', claim.id, claim.nonce, claim.claimGeneration]),
          signal: this.options.store.signal, assertCurrent: ownerGuard });
        this.cleanupFailures.delete(claim.id);
      } catch (error) {
        // Another claim/settlement already owns this row; it is not an owned
        // leftover. No other refusal is silently represented as clean drainage.
        if (isStale(error)) { this.cleanupFailures.delete(claim.id); continue; }
        const code = safeCode(error); this.cleanupFailures.set(claim.id, code); this.report(code);
      }
    }
  }
  private command<T>(name: Parameters<CalendarIntegrationOwner['command']>[0], input: unknown, identity: unknown): Promise<T> {
    this.guard();
    return this.options.store.command<T>(name, input, { idempotencyKey: 'calendar-integration:' + calendarHash(identity),
      signal: this.signal, assertCurrent: this.guard });
  }
  private report(code: CalendarIntegrationCode): void { try { this.options.onFailure?.(code); } catch { /* Evidence/advisory diagnostics never change source settlement. */ } }
}

function claimIdentity(claim: CalendarIntegrationClaim) { return { id: claim.id, nonce: claim.nonce, claimGeneration: claim.claimGeneration }; }
function expectedRegistration(intent: CalendarIntegrationIntentView): JobSourceRegistration {
  const value = intent.registration;
  if (!value || value.state !== 'active' || value.id !== jobSourceId(intent.policy.source.identity)
    || value.policyHash !== calendarHash(intent.policy.source)) throw new JobsError('JOBS_NOT_READY');
  return value;
}
function sameRegistration(value: JobSourceRegistration | null, expected: JobSourceRegistration): boolean {
  return !!value && value.state === 'active' && value.id === expected.id && value.generation === expected.generation
    && value.revision === expected.revision && value.policyHash === expected.policyHash;
}
function receipt(input: unknown, intent: CalendarIntegrationIntentView, phase: 'create' | 'cancel'): JobSourceScheduleReceipt {
  const r = calendarRecord(input, ['id', 'sourceId', 'policyGeneration', 'control', 'revision', 'generation', 'createdAt', 'updatedAt']);
  if (r.id !== jobSourceScheduleId(intent.policy.source.identity, intent.createKey) || r.sourceId !== jobSourceId(intent.policy.source.identity)
    || !intent.registration || r.policyGeneration !== intent.registration.generation
    || r.generation !== 1 || (phase === 'cancel' ? r.control !== 'cancelled' : r.control !== 'active' || r.revision !== 1)) throw new CalendarError('CALENDAR_STATE_INVALID');
  const value = { id: String(r.id), sourceId: String(r.sourceId), policyGeneration: calendarInteger(r.policyGeneration, 1),
    control: r.control as JobSourceScheduleReceipt['control'], revision: calendarInteger(r.revision, phase === 'cancel' ? 2 : 1), generation: 1,
    createdAt: calendarInteger(r.createdAt), updatedAt: calendarInteger(r.updatedAt) };
  if (value.updatedAt < value.createdAt) throw new CalendarError('CALENDAR_STATE_INVALID');
  return Object.freeze(value);
}
function isStale(error: unknown): boolean { return error instanceof CalendarError && error.code === 'CALENDAR_REVISION_CONFLICT'; }
/** Native boundary proof only. Active pool cancellation is converted to Jobs unknown by SourceJobs before it reaches this adapter. */
function isKnownNoJobCommit(error: unknown): boolean {
  return error instanceof JobsError && (error.outcome === 'not-started' || error.outcome === 'not-committed')
    || error instanceof DatabaseError && (error.outcome === 'not-started' || error.outcome === 'not-committed')
    || error instanceof WorkerError && error.outcome === 'not-started';
}
function safeCode(error: unknown): CalendarIntegrationCode {
  if (error instanceof JobsError && ['JOBS_CAPACITY', 'JOBS_OUTCOME_UNKNOWN', 'JOBS_NOT_READY', 'JOBS_REVISION_CONFLICT',
    'JOBS_DEFINITION_UNAVAILABLE', 'JOBS_AUTHORITY_RETIRED'].includes(error.code)) return error.code as CalendarIntegrationCode;
  return error instanceof CalendarError && error.code === 'CALENDAR_NOT_READY' ? 'CALENDAR_NOT_READY' : 'INTEGRATION_RETRY';
}
