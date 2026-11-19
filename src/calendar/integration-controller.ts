/** Native owner policy/control orchestration only. No managed activation, request actor or provider engine. */
import { WorkPool } from '../workers/work-pool';
import { JobsError } from '../jobs/error';
import { jobSourceId, type JobSourceRegistration } from '../jobs/source-model';
import type { SourceJobs } from '../jobs/source-service';
import { CalendarError } from './error';
import { integrationPolicy, integrationTime, CALENDAR_INTEGRATION_LIMITS, type CalendarIntegrationCode,
  type CalendarIntegrationPolicySpec, type CalendarIntegrationPolicyView } from './integration-model';
import type { CalendarIntegrationControlEvidence, CalendarIntegrationControlResult, CalendarIntegrationControlView } from './integration-controls';
import type { CalendarIntegrationCommand, CalendarIntegrationOwner } from './integration-runtime';
import { calendarHash, calendarJson, calendarKey, calendarRecord, calendarInteger } from './validation';
import { calendarObservationPinInput } from './integration-catalog';

export interface CalendarIntegrationEligibilityGuards { assertEligible(): void; confirmEligible(): Promise<void> }
export interface CalendarIntegrationPolicyControllerOptions {
  readonly owner: CalendarIntegrationOwner;
  /** Synchronous native capability binding. It must not start Jobs work or retain a source lease. */
  readonly jobs: (policy: CalendarIntegrationPolicySpec, guards: CalendarIntegrationEligibilityGuards) => SourceJobs;
  readonly now?: () => number;
}
export interface CalendarIntegrationActivationResult {
  readonly policy: CalendarIntegrationPolicyView; readonly control: CalendarIntegrationControlView;
  readonly result: CalendarIntegrationControlResult | null;
}
export interface CalendarIntegrationRetirementResult {
  readonly policy: CalendarIntegrationPolicyView; readonly control: CalendarIntegrationControlView | null;
  readonly result: 'retired' | 'no-registration'; readonly registration: JobSourceRegistration | null;
}
interface Cell { readonly id: string; readonly hash: string; quiesced: boolean }
interface Retirement { settled: boolean; pending: number; started: boolean; missing: boolean }
const RETRY_MS = 1000;

export class CalendarIntegrationPolicyController {
  private readonly pool = new WorkPool({ concurrency: 8, maxConcurrentPerKey: 1, maxQueued: 32, maxQueuedPerKey: 32, queueTimeoutMs: 5000 });
  private readonly stop = new AbortController();
  private readonly cells = new Map<string, Cell>();
  private readonly retirements = new Map<string, Retirement>();
  private closing = false;
  private closeTask: Promise<void> | null = null;
  private readonly signal: AbortSignal;
  constructor(private readonly options: CalendarIntegrationPolicyControllerOptions) {
    if (!options || typeof options.jobs !== 'function' || options.now !== undefined && typeof options.now !== 'function') throw new CalendarError('CALENDAR_CONFIG_INVALID');
    options.owner.assertCurrent(); this.signal = AbortSignal.any([options.owner.signal, this.stop.signal]);
  }

  /** Capture preparation only: this method NEVER resolves a Jobs capability or calls Jobs. */
  prepare(input: CalendarIntegrationPolicySpec): Promise<CalendarIntegrationPolicyView> {
    try {
      this.assertOpen(); const policy = integrationPolicy(input), hash = calendarHash(policy), cell = this.cells.get(policy.ruleId);
      if (cell && cell.hash !== hash) cell.quiesced = true;
      return this.run(policy.ruleId, async () => {
        const current = await this.policy(policy.ruleId);
        if (this.retirementPending(policy.ruleId)) throw new CalendarError('CALENDAR_NOT_READY');
        if (current && current.state !== 'retired' && calendarHash(current.policy) === hash) { this.bind(current, true); return current; }
        if (current) {
          const evidence = await this.evidence(policy.ruleId);
          if (evidence.pending) throw new CalendarError('CALENDAR_NOT_READY');
          if (current.state === 'retired' && evidence.registered) {
            const retirement = await this.control(policy.ruleId, current.epoch, 'retire');
            // A crash after local retirement but before target capture must not
            // turn same-hash reactivation into a Jobs generation-preserving no-op.
            if (retirement?.result?.state !== 'accepted' || retirement.result.registration.state !== 'retired') throw new CalendarError('CALENDAR_NOT_READY');
          }
        }
        const expectedEpoch = current?.epoch ?? 0;
        const installed = await this.command<CalendarIntegrationPolicyView>('calendar.integration.policy.install', { policy, expectedEpoch },
          ['install', this.options.owner.owner.owner_id, policy.ruleId, expectedEpoch, hash]);
        this.retirements.delete(policy.ruleId); this.bind(installed, true); return installed;
      });
    } catch (error) { return Promise.reject(error); }
  }

  activate(ruleInput: string): Promise<CalendarIntegrationActivationResult> {
    try {
      this.assertOpen(); const ruleId = calendarKey(ruleInput, 64);
      return this.run(ruleId, async () => {
        let selected = await this.requirePolicy(ruleId);
        if (selected.state === 'retired' || this.retirementPending(ruleId)) throw new CalendarError('CALENDAR_POLICY_STALE');
        this.bind(selected);
        await this.settleOlder(ruleId, selected.id);
        selected = await this.requirePolicy(ruleId);
        if (selected.state === 'retired') throw new CalendarError('CALENDAR_POLICY_STALE');
        let control = await this.control(ruleId, selected.epoch, 'activate');
        const jobs = this.broker(selected);
        if (!control) {
          const expectedRegistration = await jobs.registration.get(); this.assertOpen();
          if (!expectedRegistration && (await this.evidence(ruleId)).registered) throw new CalendarError('CALENDAR_STATE_INVALID');
          control = await this.command<CalendarIntegrationControlView>('calendar.integration.control.prepare', { ruleId, epoch: selected.epoch, action: 'activate', expectedRegistration },
            ['prepare-activate', selected.id]);
        }
        try {
          const original = await jobs.registration.reconcile(control.jobsKey, { signal: this.signal });
          this.assertOpen();
          if (control.result?.state === 'accepted' && (!original || !sameRegistration(original, control.result.registration))) throw new CalendarError('CALENDAR_STATE_INVALID');
          if (control.result?.state === 'absent') throw new CalendarError('CALENDAR_POLICY_STALE');
          if (!original && (await this.evidence(ruleId)).registered && await jobs.registration.get() === null) throw new CalendarError('CALENDAR_STATE_INVALID');
          if (!original && control.lastFailure && control.nextAttemptMs > this.time()) return { policy: selected, control, result: null };
          if (!original && this.cells.get(ruleId)?.quiesced) throw new CalendarError('CALENDAR_NOT_READY');
          // Even a previously accepted control re-enters its ORIGINAL activate
          // key to hydrate this native capability. Its receipt precedes fresh admission.
          // A rejected replacement preparation quiesces A. If A's original
          // receipt exists, finish evidence without reviving its live source.
          const registration = original && this.cells.get(ruleId)?.quiesced ? original : await jobs.registration.activate({ expectedRevision: control.expectedJobsRevision,
            idempotencyKey: control.jobsKey, pinInput: calendarObservationPinInput(control.epoch), signal: this.signal });
          const actual = await jobs.registration.get();
          const exact = actual !== null && sameRegistration(actual, registration) && actual.state === 'active';
          if (!exact || this.retirementPending(ruleId)) await this.retireLocalIfCurrent(selected);
          control = await this.ack(control, { state: 'accepted', registration });
          const policy = await this.requirePolicy(ruleId);
          if (!exact) { this.cells.get(ruleId)!.quiesced = true; throw new CalendarError('CALENDAR_STATE_INVALID'); }
          return { policy, control, result: control.result };
        } catch (error) { return this.failed(control, error); }
      });
    } catch (error) { return Promise.reject(error); }
  }

  /** Synchronous eligibility quiescence happens BEFORE this operation waits in the per-rule pool. */
  retire(ruleInput: string): Promise<CalendarIntegrationRetirementResult> {
    try {
      this.assertOpen(); const ruleId = calendarKey(ruleInput, 64), previous = this.retirements.get(ruleId);
      if (!this.retirements.has(ruleId) && this.retirements.size >= CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_CAPACITY');
      // Concurrent calls reuse one bounded marker, rather than constructing a
      // chain of refused newer markers which could mask a completed retirement.
      const marker: Retirement = previous && (!previous.settled || previous.pending > 0) ? previous : { settled: false, pending: 0, started: false, missing: false };
      marker.pending++;
      this.retirements.set(ruleId, marker); const cell = this.cells.get(ruleId); if (cell) cell.quiesced = true;
      return this.run<CalendarIntegrationRetirementResult>(ruleId, async () => {
        marker.started = true; marker.settled = false;
        let policy = await this.requirePolicy(ruleId);
        await this.retireLocalIfCurrent(policy); policy = await this.requirePolicy(ruleId); this.bind(policy);
        await this.settleOlder(ruleId);
        let control = await this.control(ruleId, policy.epoch, 'retire');
        const jobs = this.broker(policy), proof = await this.evidence(ruleId), actual = await jobs.registration.get();
        this.assertOpen();
        if (!actual) {
          if (proof.registered || control?.result?.state === 'accepted' || policy.registration) throw new CalendarError('CALENDAR_STATE_INVALID');
          marker.settled = true;
          return { policy, control: null, result: 'no-registration', registration: null };
        }
        validateOwnedRegistration(actual, policy.policy);
        if (!control) control = await this.command<CalendarIntegrationControlView>('calendar.integration.control.prepare', { ruleId, epoch: policy.epoch, action: 'retire', expectedRegistration: actual },
          ['prepare-retire', policy.id]);
        control = await this.retireControl(control);
        if (control.result?.state !== 'accepted') throw new CalendarError('CALENDAR_STATE_INVALID');
        const retired = control.result.registration, current = await jobs.registration.get(); this.assertOpen();
        if (!current || current.state !== 'retired' || !sameRegistration(current, retired)) throw new CalendarError('CALENDAR_STATE_INVALID');
        marker.settled = true; policy = await this.requirePolicy(ruleId);
        return { policy, control, result: 'retired', registration: retired };
      }).catch(error => {
        if (error instanceof CalendarError && error.code === 'CALENDAR_NOT_FOUND' && !this.cells.has(ruleId)) marker.missing = true;
        throw error;
      }).finally(() => {
        marker.pending--;
        if (marker.pending === 0 && this.retirements.get(ruleId) === marker && (!marker.started || marker.missing && !this.cells.has(ruleId))) this.retirements.delete(ruleId);
      });
    } catch (error) { return Promise.reject(error); }
  }

  /** Stop fresh control/source eligibility only. Shared Jobs and owner evidence lifetimes remain live. */
  quiesce(): void {
    this.closing = true; for (const cell of this.cells.values()) cell.quiesced = true;
    // A running control may already have entered a separate Jobs writer. Pool
    // cancellation cannot truthfully report that original control never started.
    this.stop.abort(new JobsError('JOBS_OUTCOME_UNKNOWN'));
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.quiesce(); const task = this.pool.close(); this.closeTask = task;
    void task.catch(() => { if (this.closeTask === task) this.closeTask = null; }); return task;
  }
  /** @internal Join actual controller callbacks after close was attempted.
   * A bounded close rejection must be reported separately, not relabelled clean.
   */
  drainPhysical(): Promise<void> { return this.pool.drainPhysical(); }
  diagnostics() { return { closing: this.closing, rules: this.cells.size, retirementMarkers: this.retirements.size, pool: this.pool.status() }; }

  private run<T>(ruleId: string, work: () => Promise<T>): Promise<T> {
    return this.pool.run(async signal => { signal.throwIfAborted(); this.assertOpen(); return work(); },
      { key: 'calendar-policy:' + calendarHash([this.options.owner.owner.id, ruleId]), signal: this.signal });
  }
  private assertOpen(): void { if (this.closing) throw new CalendarError('CALENDAR_NOT_READY'); this.signal.throwIfAborted(); this.options.owner.assertCurrent(); }
  private bind(policy: CalendarIntegrationPolicyView, restore = false): Cell {
    const hash = calendarHash(policy.policy), prior = this.cells.get(policy.ruleId);
    if (prior?.id === policy.id && prior.hash === hash) {
      if (policy.state === 'retired') prior.quiesced = true;
      else if (restore && !this.retirementPending(policy.ruleId)) prior.quiesced = false;
      return prior;
    }
    if (!prior && this.cells.size >= CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_CAPACITY');
    if (prior) prior.quiesced = true;
    const cell = { id: policy.id, hash, quiesced: policy.state === 'retired' || this.closing || this.retirementPending(policy.ruleId) };
    this.cells.set(policy.ruleId, cell); return cell;
  }
  private broker(policy: CalendarIntegrationPolicyView): SourceJobs {
    const current = this.cells.get(policy.ruleId), cell: Cell = current?.id === policy.id ? current : { id: policy.id, hash: calendarHash(policy.policy), quiesced: true };
    const assertEligible = () => {
      this.assertOpen();
      if (cell.quiesced || this.cells.get(policy.ruleId) !== cell || this.retirementPending(policy.ruleId)) throw new JobsError('JOBS_AUTHORITY_RETIRED');
    };
    const jobs = this.options.jobs(policy.policy, { assertEligible, confirmEligible: async () => {
      assertEligible(); const selected = await this.policy(policy.ruleId); assertEligible();
      if (!selected || selected.id !== policy.id || selected.state === 'retired' || calendarHash(selected.policy) !== cell.hash) {
        cell.quiesced = true; throw new JobsError('JOBS_AUTHORITY_RETIRED');
      }
    } });
    if (!jobs || typeof jobs.registration?.get !== 'function' || typeof jobs.registration?.reconcile !== 'function'
      || typeof jobs.registration?.activate !== 'function' || typeof jobs.registration?.retire !== 'function') {
      try { Promise.prototype.then.call(jobs, undefined, () => {}); } catch {}
      throw new CalendarError('CALENDAR_CONFIG_INVALID');
    }
    return jobs;
  }
  private policy(ruleId: string): Promise<CalendarIntegrationPolicyView | null> { return this.options.owner.read('calendar.integration.policy', { ruleId }); }
  private async requirePolicy(ruleId: string): Promise<CalendarIntegrationPolicyView> {
    const policy = await this.policy(ruleId); if (!policy) throw new CalendarError('CALENDAR_NOT_FOUND'); return policy;
  }
  private evidence(ruleId: string): Promise<CalendarIntegrationControlEvidence> { return this.options.owner.read('calendar.integration.controlEvidence', { ruleId }); }
  private control(ruleId: string, epoch: number, action: 'activate' | 'retire'): Promise<CalendarIntegrationControlView | null> {
    return this.options.owner.read('calendar.integration.control', { ruleId, epoch, action });
  }
  private async retireLocalIfCurrent(policy: CalendarIntegrationPolicyView): Promise<void> {
    const selected = await this.requirePolicy(policy.ruleId);
    if (selected.id !== policy.id || selected.state === 'retired') return;
    await this.command('calendar.integration.policy.retire', { ruleId: policy.ruleId, epoch: policy.epoch }, ['local-retire', policy.id]);
    const cell = this.cells.get(policy.ruleId); if (cell?.id === policy.id) cell.quiesced = true;
  }
  private async settleOlder(ruleId: string, currentActivationId?: string): Promise<void> {
    for (let step = 0; step < CALENDAR_INTEGRATION_LIMITS.rules * 2; step++) {
      const pending = (await this.evidence(ruleId)).pending;
      if (!pending) return;
      if (currentActivationId && pending.action === 'activate') {
        const current = await this.requirePolicy(ruleId); if (current.id === currentActivationId && current.epoch === pending.epoch) return;
      }
      if (pending.action === 'retire') { await this.retireControl(pending); continue; }
      try {
        const result = await this.broker({ id: 'historical:' + pending.id, ruleId, epoch: pending.epoch, state: 'retired', policy: pending.policy, registration: null })
          .registration.reconcile(pending.jobsKey, { signal: this.signal });
        this.assertOpen(); await this.ack(pending, result ? { state: 'accepted', registration: result } : { state: 'absent' });
      } catch (error) { await this.failed(pending, error); }
    }
    throw new CalendarError('CALENDAR_NOT_READY');
  }
  private async retireControl(control: CalendarIntegrationControlView): Promise<CalendarIntegrationControlView> {
    const jobs = this.broker({ id: 'historical:' + control.id, ruleId: control.ruleId, epoch: control.epoch, state: 'retired', policy: control.policy, registration: null });
    let deferred = false;
    try {
      const original = await jobs.registration.reconcile(control.jobsKey, { signal: this.signal }); this.assertOpen();
      if (control.result?.state === 'accepted') {
        if (!original || !sameRegistration(original, control.result.registration)) throw new CalendarError('CALENDAR_STATE_INVALID'); return control;
      }
      if (!original && control.lastFailure && control.nextAttemptMs > this.time()) { deferred = true; throw new CalendarError('CALENDAR_NOT_READY'); }
      const registration = original ?? await jobs.registration.retire({ idempotencyKey: control.jobsKey,
        expectedRevision: control.expectedJobsRevision, signal: this.signal });
      return await this.ack(control, { state: 'accepted', registration });
    } catch (error) { if (deferred) throw error; return this.failed(control, error); }
  }
  private ack(control: CalendarIntegrationControlView, result: CalendarIntegrationControlResult): Promise<CalendarIntegrationControlView> {
    return this.command('calendar.integration.control.ack', { id: control.id, result }, ['ack', control.id, result]);
  }
  private async failed(control: CalendarIntegrationControlView, error: unknown): Promise<never> {
    const now = this.time(), code = safeCode(error), retryAt = integrationTime(now + (code === 'JOBS_CAPACITY' ? 5000 : RETRY_MS));
    try { await this.command('calendar.integration.control.fail', { id: control.id, code, now, retryAt }, ['fail', control.id, code, retryAt]); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Calendar control failure could not be recorded.'); }
    throw error;
  }
  private command<T>(name: CalendarIntegrationCommand, input: unknown, identity: unknown): Promise<T> {
    // Historical acknowledgment/failure remains owner-authorized after intake
    // quiesces; no stopped eligibility check is substituted for factual evidence.
    const fresh = name === 'calendar.integration.policy.install' || name === 'calendar.integration.control.prepare';
    if (fresh) this.assertOpen();
    return this.options.owner.command(name, input, { idempotencyKey: 'calendar-policy:' + calendarHash(identity),
      ...(fresh ? { assertCurrent: () => this.assertOpen() } : {}) });
  }
  private retirementPending(ruleId: string): boolean { const marker = this.retirements.get(ruleId); return !!marker && (!marker.settled || marker.pending > 0); }
  private time(): number { return integrationTime((this.options.now ?? Date.now)()); }
}

function sameRegistration(a: JobSourceRegistration, b: JobSourceRegistration): boolean { return calendarJson(a) === calendarJson(b); }
function validateOwnedRegistration(input: JobSourceRegistration, policy: CalendarIntegrationPolicySpec): void {
  const r = calendarRecord(input, ['id', 'generation', 'revision', 'state', 'policyHash']);
  if (r.id !== jobSourceId(policy.source.identity) || !['active', 'retired'].includes(r.state as string)
    || typeof r.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.policyHash)) throw new CalendarError('CALENDAR_STATE_INVALID');
  calendarInteger(r.generation, 1); calendarInteger(r.revision, 1);
}
function safeCode(error: unknown): CalendarIntegrationCode {
  if (error instanceof JobsError && ['JOBS_CAPACITY', 'JOBS_OUTCOME_UNKNOWN', 'JOBS_NOT_READY', 'JOBS_REVISION_CONFLICT', 'JOBS_DEFINITION_UNAVAILABLE', 'JOBS_AUTHORITY_RETIRED'].includes(error.code)) return error.code as CalendarIntegrationCode;
  return error instanceof CalendarError && error.code === 'CALENDAR_NOT_READY' ? 'CALENDAR_NOT_READY' : 'INTEGRATION_RETRY';
}
