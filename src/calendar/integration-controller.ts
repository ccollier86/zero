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
/** Native operator selection only. This is neither Jobs data nor a request actor. */
export interface CalendarIntegrationPolicySelection {
  readonly id: string; readonly epoch: number; readonly policyDigest: string;
}
export interface CalendarIntegrationPolicyControlOptions {
  readonly expected?: CalendarIntegrationPolicySelection; readonly signal?: AbortSignal;
}
export interface CalendarIntegrationPolicyPrepareOptions extends CalendarIntegrationPolicyControlOptions {
  readonly requireRetired?: boolean;
}
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
interface Cell { readonly id: string; readonly hash: string; readonly sourceId: string; quiesced: boolean }
interface Retirement { id?: string; hash?: string; explicit: boolean; settled: boolean; pending: number; started: boolean; missing: boolean }
const RETRY_MS = 1000;

export class CalendarIntegrationPolicyController {
  private readonly pool = new WorkPool({ concurrency: 8, maxConcurrentPerKey: 1, maxQueued: 32, maxQueuedPerKey: 32, queueTimeoutMs: 5000 });
  private readonly stop = new AbortController();
  private readonly cells = new Map<string, Cell>();
  private readonly retirements = new Map<string, Retirement>();
  /** Separate concurrent native selections from historical install replay.
   * After unknown selected installation, inspect current state; a stale token
   * is not a human idempotency receipt or permission to manufacture success. */
  private readonly selectedControlId = crypto.randomUUID();
  private closing = false;
  private closeTask: Promise<void> | null = null;
  private readonly signal: AbortSignal;
  constructor(private readonly options: CalendarIntegrationPolicyControllerOptions) {
    if (!options || typeof options.jobs !== 'function' || options.now !== undefined && typeof options.now !== 'function') throw new CalendarError('CALENDAR_CONFIG_INVALID');
    options.owner.assertCurrent(); this.signal = AbortSignal.any([options.owner.signal, this.stop.signal]);
  }

  /** Capture preparation only: this method NEVER resolves a Jobs capability or calls Jobs. */
  prepare(input: CalendarIntegrationPolicySpec, options?: CalendarIntegrationPolicyPrepareOptions): Promise<CalendarIntegrationPolicyView> {
    try {
      this.assertOpen(); const policy = integrationPolicy(input), opts = this.controlOptions(policy.ruleId, options, true), hash = calendarHash(policy), cell = this.cells.get(policy.ruleId);
      this.assertPolicyOwner(policy);
      if (cell && cell.sourceId !== jobSourceId(policy.source.identity)) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      // A rejected operator selection must not retire a healthy current cell.
      // Unselected native preparation preserves its existing replacement cutoff.
      if (!opts.expected && cell && cell.hash !== hash) cell.quiesced = true;
      return this.run(policy.ruleId, async signal => {
        const current = await this.policy(policy.ruleId, signal);
        this.assertSelection(current, opts.expected);
        if (current && jobSourceId(current.policy.source.identity) !== jobSourceId(policy.source.identity)) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
        if (opts.requireRetired && current?.state !== 'retired') throw new CalendarError('CALENDAR_POLICY_STALE');
        if (this.retirementPending(policy.ruleId, current?.id)) throw new CalendarError('CALENDAR_NOT_READY');
        if (!opts.requireRetired && this.explicitRetirement(policy.ruleId, current?.id)) throw new CalendarError('CALENDAR_POLICY_STALE');
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
        if (opts.expected && current) {
          const observed = this.cells.get(policy.ruleId); if (observed?.id === current.id && observed.hash === opts.expected.policyDigest) observed.quiesced = true;
        }
        const expectedEpoch = current?.epoch ?? 0;
        const installed = await this.command<CalendarIntegrationPolicyView>('calendar.integration.policy.install', { policy, expectedEpoch,
          ...(opts.expected ? { expectedSelection: opts.expected, requireRetired: opts.requireRetired ?? false } : {}) },
          opts.expected ? ['install-selected', this.selectedControlId, this.options.owner.owner.owner_id, policy.ruleId, opts.expected, hash]
            : ['install', this.options.owner.owner.owner_id, policy.ruleId, expectedEpoch, hash], { signal, assertCurrent: () => {
            this.assertPolicyCell(current, signal);
            if (this.retirementPending(policy.ruleId, current?.id)) throw new CalendarError('CALENDAR_NOT_READY');
            if (!opts.requireRetired && this.explicitRetirement(policy.ruleId, current?.id)) throw new CalendarError('CALENDAR_POLICY_STALE');
          } });
        // Original command replay may describe history after another controller
        // advanced the pointer. Never publish that historical result as current.
        const actual = await this.requirePolicy(policy.ruleId, signal);
        if (actual.id !== installed.id || actual.epoch !== expectedEpoch + 1 || calendarHash(actual.policy) !== hash || actual.state === 'retired') throw new CalendarError('CALENDAR_POLICY_STALE');
        const marker = this.retirements.get(policy.ruleId);
        if (!marker || marker.id === current?.id) this.retirements.delete(policy.ruleId);
        this.bind(actual, true); return actual;
      }, opts.signal);
    } catch (error) { return Promise.reject(error); }
  }

  activate(ruleInput: string, options?: CalendarIntegrationPolicyControlOptions): Promise<CalendarIntegrationActivationResult> {
    try {
      this.assertOpen(); const ruleId = calendarKey(ruleInput, 64), opts = this.controlOptions(ruleId, options);
      return this.run(ruleId, async signal => {
        let selected = await this.requirePolicy(ruleId, signal); this.assertSelection(selected, opts.expected);
        if (selected.state === 'retired' || this.retirementPending(ruleId, selected.id)) throw new CalendarError('CALENDAR_POLICY_STALE');
        this.bind(selected);
        await this.settleOlder(ruleId, selected.id);
        selected = await this.requirePolicy(ruleId, signal); this.assertSelection(selected, opts.expected);
        if (selected.state === 'retired' || this.retirementPending(ruleId, selected.id)) throw new CalendarError('CALENDAR_POLICY_STALE');
        let control = await this.control(ruleId, selected.epoch, 'activate');
        const jobs = this.broker(selected);
        if (!control) {
          const expectedRegistration = await jobs.registration.get(); this.assertPolicyCell(selected, signal);
          if (!expectedRegistration && (await this.evidence(ruleId)).registered) throw new CalendarError('CALENDAR_STATE_INVALID');
          control = await this.command<CalendarIntegrationControlView>('calendar.integration.control.prepare', { ruleId, epoch: selected.epoch, action: 'activate', expectedRegistration },
            ['prepare-activate', selected.id], { signal, assertCurrent: () => {
              this.assertPolicyCell(selected, signal);
              if (this.retirementPending(ruleId, selected.id)) throw new CalendarError('CALENDAR_POLICY_STALE');
            } });
        }
        try {
          const original = await jobs.registration.reconcile(control.jobsKey, { signal });
          this.assertOpen(); signal.throwIfAborted();
          if (control.result?.state === 'accepted' && (!original || !sameRegistration(original, control.result.registration))) throw new CalendarError('CALENDAR_STATE_INVALID');
          if (control.result?.state === 'absent') throw new CalendarError('CALENDAR_POLICY_STALE');
          if (!original && (await this.evidence(ruleId)).registered && await jobs.registration.get() === null) throw new CalendarError('CALENDAR_STATE_INVALID');
          if (!original && control.lastFailure && control.nextAttemptMs > this.time()) {
            const policy = await this.requirePolicy(ruleId, signal);
            this.assertSelection(policy, { id: selected.id, epoch: selected.epoch, policyDigest: calendarHash(selected.policy) });
            return { policy, control, result: null };
          }
          if (!original && this.cells.get(ruleId)?.quiesced) throw new CalendarError('CALENDAR_NOT_READY');
          // Even a previously accepted control re-enters its ORIGINAL activate
          // key to hydrate this native capability. Its receipt precedes fresh admission.
          // A rejected replacement preparation quiesces A. If A's original
          // receipt exists, finish evidence without reviving its live source.
          const registration = original && this.cells.get(ruleId)?.quiesced ? original : await jobs.registration.activate({ expectedRevision: control.expectedJobsRevision,
            idempotencyKey: control.jobsKey, pinInput: calendarObservationPinInput(control.epoch), signal });
          const actual = await jobs.registration.get();
          const exact = actual !== null && sameRegistration(actual, registration) && actual.state === 'active';
          if (!exact || this.retirementPending(ruleId, selected.id)) await this.retireLocalIfCurrent(selected);
          control = await this.ack(control, { state: 'accepted', registration });
          const policy = await this.requirePolicy(ruleId, signal); this.assertSelection(policy, opts.expected);
          if (!exact) { const cell = this.cells.get(ruleId); if (cell?.id === selected.id) cell.quiesced = true; throw new CalendarError('CALENDAR_STATE_INVALID'); }
          return { policy, control, result: control.result };
        } catch (error) { return this.failed(control, error); }
      }, opts.signal);
    } catch (error) { return Promise.reject(error); }
  }

  /** Existing journal evidence only: never prepare a control, activate/hydrate a
   * source or infer retirement from configuration removal. A current missing
   * activation stays review-blocked; only explicit local retirement or a newer
   * source pointer permits recording same-gate absence of the old operation.
   */
  reconcileRetained(ruleInput: string): Promise<void> {
    try {
      this.assertOpen(); const ruleId = calendarKey(ruleInput, 64);
      return this.run(ruleId, () => this.settleOlder(ruleId, undefined, true));
    } catch (error) { return Promise.reject(error); }
  }

  /** Synchronous eligibility quiescence happens BEFORE this operation waits in the per-rule pool. */
  retire(ruleInput: string, options?: CalendarIntegrationPolicyControlOptions): Promise<CalendarIntegrationRetirementResult> {
    try {
      this.assertOpen(); const ruleId = calendarKey(ruleInput, 64), opts = this.controlOptions(ruleId, options), cell = this.cells.get(ruleId);
      // Only the exact observed cell can be synchronously cut off. A stale or
      // forged selection queues validation without touching a newer marker.
      let marker: Retirement | null = !opts.expected || cell?.id === opts.expected.id && cell.hash === opts.expected.policyDigest
        ? this.beginRetirement(ruleId, cell, !!opts.expected) : null;
      return this.run<CalendarIntegrationRetirementResult>(ruleId, async signal => {
        let policy = await this.requirePolicy(ruleId, signal); this.assertSelection(policy, opts.expected);
        if (!marker) marker = this.beginRetirement(ruleId, { id: policy.id, hash: calendarHash(policy.policy), sourceId: jobSourceId(policy.policy.source.identity), quiesced: true }, !!opts.expected);
        marker.id = policy.id; marker.hash = calendarHash(policy.policy); marker.started = true; marker.settled = false;
        await this.retireLocalIfCurrent(policy, signal, opts.expected);
        policy = await this.requirePolicy(ruleId, signal); this.assertSelection(policy, opts.expected); this.bind(policy);
        await this.settleOlder(ruleId);
        this.assertSelection(await this.requirePolicy(ruleId, signal), { id: policy.id, epoch: policy.epoch, policyDigest: calendarHash(policy.policy) });
        let control = await this.control(ruleId, policy.epoch, 'retire');
        const jobs = this.broker(policy), proof = await this.evidence(ruleId), actual = await jobs.registration.get();
        this.assertPolicyCell(policy, signal);
        if (!actual) {
          if (proof.registered || control?.result?.state === 'accepted' || policy.registration) throw new CalendarError('CALENDAR_STATE_INVALID');
          marker.settled = true;
          return { policy, control: null, result: 'no-registration', registration: null };
        }
        validateOwnedRegistration(actual, policy.policy);
        if (!control) control = await this.command<CalendarIntegrationControlView>('calendar.integration.control.prepare', { ruleId, epoch: policy.epoch, action: 'retire', expectedRegistration: actual },
          ['prepare-retire', policy.id], { signal, assertCurrent: () => this.assertPolicyCell(policy, signal) });
        control = await this.retireControl(control, signal);
        if (control.result?.state !== 'accepted') throw new CalendarError('CALENDAR_STATE_INVALID');
        const retired = control.result.registration, current = await jobs.registration.get(); this.assertOpen(); signal.throwIfAborted();
        if (!current || current.state !== 'retired' || !sameRegistration(current, retired)) throw new CalendarError('CALENDAR_STATE_INVALID');
        marker.settled = true; policy = await this.requirePolicy(ruleId, signal); this.assertSelection(policy, opts.expected);
        return { policy, control, result: 'retired', registration: retired };
      }, opts.signal).catch(error => {
        if (marker && error instanceof CalendarError && error.code === 'CALENDAR_NOT_FOUND' && !this.cells.has(ruleId)) marker.missing = true;
        throw error;
      }).finally(() => {
        if (!marker) return;
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

  private run<T>(ruleId: string, work: (signal: AbortSignal) => Promise<T>, requestSignal?: AbortSignal): Promise<T> {
    const signal = requestSignal ? AbortSignal.any([this.signal, requestSignal]) : this.signal;
    return this.pool.run(async operationSignal => { operationSignal.throwIfAborted(); this.assertOpen(); return work(operationSignal); },
      { key: 'calendar-policy:' + calendarHash([this.options.owner.owner.id, ruleId]), signal });
  }
  private assertOpen(): void { if (this.closing) throw new CalendarError('CALENDAR_NOT_READY'); this.signal.throwIfAborted(); this.options.owner.assertCurrent(); }
  private controlOptions(ruleId: string, input: unknown, prepare = false): CalendarIntegrationPolicyPrepareOptions {
    const r = calendarRecord(input ?? {}, prepare ? ['expected', 'signal', 'requireRetired'] : ['expected', 'signal']);
    if (r.signal !== undefined && !(r.signal instanceof AbortSignal) || r.requireRetired !== undefined && typeof r.requireRetired !== 'boolean') throw new CalendarError('CALENDAR_INPUT_INVALID');
    const signal = r.signal as AbortSignal | undefined; signal?.throwIfAborted();
    let expected: CalendarIntegrationPolicySelection | undefined;
    if (r.expected !== undefined) {
      const s = calendarRecord(r.expected, ['id', 'epoch', 'policyDigest']), epoch = calendarInteger(s.epoch, 1), id = calendarKey(s.id, 64);
      if (typeof s.policyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(s.policyDigest)
        || id !== calendarHash([this.options.owner.owner.scope_id, ruleId, epoch])) throw new CalendarError('CALENDAR_INPUT_INVALID');
      expected = Object.freeze({ id, epoch, policyDigest: s.policyDigest });
    }
    if (r.requireRetired === true && !expected) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return { ...(expected ? { expected } : {}), ...(signal ? { signal } : {}), ...(r.requireRetired === undefined ? {} : { requireRetired: r.requireRetired as boolean }) };
  }
  private assertSelection(policy: CalendarIntegrationPolicyView | null, selection?: CalendarIntegrationPolicySelection): void {
    if (selection && (!policy || policy.id !== selection.id || policy.epoch !== selection.epoch || calendarHash(policy.policy) !== selection.policyDigest)) throw new CalendarError('CALENDAR_POLICY_STALE');
  }
  private assertPolicyOwner(policy: CalendarIntegrationPolicySpec): void {
    const owner = this.options.owner.owner, source = policy.source, identity = source.identity;
    if (identity.databaseId !== owner.id || identity.ownerId !== owner.owner_id || identity.scopeId !== owner.scope_id
      || identity.rootHash !== owner.root_hash || source.realmFingerprint !== owner.realm_fingerprint) throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  /** Synchronous companion to the canonical command's expected-epoch CAS. */
  private assertPolicyCell(policy: CalendarIntegrationPolicyView | null, signal: AbortSignal): void {
    this.assertOpen(); signal.throwIfAborted();
    const cell = policy && this.cells.get(policy.ruleId);
    if (cell && (cell.id !== policy.id || cell.hash !== calendarHash(policy.policy))) throw new CalendarError('CALENDAR_POLICY_STALE');
  }
  private beginRetirement(ruleId: string, cell: Cell | undefined, explicit: boolean): Retirement {
    const previous = this.retirements.get(ruleId);
    if (!previous && this.retirements.size >= CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_CAPACITY');
    // The shared marker belongs to one observed epoch, not the permanent rule.
    const compatible = previous && previous.id === cell?.id && previous.hash === cell?.hash;
    const marker: Retirement = compatible && (!previous.settled || previous.pending > 0 || previous.explicit)
      ? previous : { id: cell?.id, hash: cell?.hash, explicit, settled: false, pending: 0, started: false, missing: false };
    marker.explicit ||= explicit; marker.pending++; this.retirements.set(ruleId, marker);
    const current = this.cells.get(ruleId); if (current && (!marker.id || current.id === marker.id && current.hash === marker.hash)) current.quiesced = true;
    return marker;
  }
  private bind(policy: CalendarIntegrationPolicyView, restore = false): Cell {
    const hash = calendarHash(policy.policy), prior = this.cells.get(policy.ruleId);
    if (prior?.id === policy.id && prior.hash === hash) {
      if (policy.state === 'retired') prior.quiesced = true;
      else if (restore && !this.retirementPending(policy.ruleId, policy.id) && !this.explicitRetirement(policy.ruleId, policy.id)) prior.quiesced = false;
      return prior;
    }
    if (!prior && this.cells.size >= CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_CAPACITY');
    if (prior) prior.quiesced = true;
    const cell = { id: policy.id, hash, sourceId: jobSourceId(policy.policy.source.identity), quiesced: policy.state === 'retired' || this.closing || this.retirementPending(policy.ruleId, policy.id) || this.explicitRetirement(policy.ruleId, policy.id) };
    this.cells.set(policy.ruleId, cell); return cell;
  }
  private broker(policy: CalendarIntegrationPolicyView): SourceJobs {
    const current = this.cells.get(policy.ruleId), cell: Cell = current?.id === policy.id ? current : { id: policy.id, hash: calendarHash(policy.policy), sourceId: jobSourceId(policy.policy.source.identity), quiesced: true };
    const assertEligible = () => {
      this.assertOpen();
      if (cell.quiesced || this.cells.get(policy.ruleId) !== cell || this.retirementPending(policy.ruleId, policy.id) || this.explicitRetirement(policy.ruleId, policy.id)) throw new JobsError('JOBS_AUTHORITY_RETIRED');
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
  private policy(ruleId: string, signal?: AbortSignal): Promise<CalendarIntegrationPolicyView | null> { return this.options.owner.read('calendar.integration.policy', { ruleId }, signal ? { signal } : undefined); }
  private async requirePolicy(ruleId: string, signal?: AbortSignal): Promise<CalendarIntegrationPolicyView> {
    const policy = await this.policy(ruleId, signal); if (!policy) throw new CalendarError('CALENDAR_NOT_FOUND'); return policy;
  }
  private evidence(ruleId: string): Promise<CalendarIntegrationControlEvidence> { return this.options.owner.read('calendar.integration.controlEvidence', { ruleId }); }
  private control(ruleId: string, epoch: number, action: 'activate' | 'retire'): Promise<CalendarIntegrationControlView | null> {
    return this.options.owner.read('calendar.integration.control', { ruleId, epoch, action });
  }
  private async retireLocalIfCurrent(policy: CalendarIntegrationPolicyView, signal?: AbortSignal, expected?: CalendarIntegrationPolicySelection): Promise<void> {
    const selected = await this.requirePolicy(policy.ruleId, signal); this.assertSelection(selected, expected);
    if (selected.id !== policy.id || selected.state === 'retired') return;
    await this.command('calendar.integration.policy.retire', { ruleId: policy.ruleId, epoch: policy.epoch, ...(expected ? { expectedSelection: expected } : {}) },
      expected ? ['local-retire-selected', policy.id, expected] : ['local-retire', policy.id],
      signal ? { signal, assertCurrent: () => this.assertPolicyCell(policy, signal) } : undefined);
    const cell = this.cells.get(policy.ruleId); if (cell?.id === policy.id) cell.quiesced = true;
  }
  private async settleOlder(ruleId: string, currentActivationId?: string, evidenceOnly = false): Promise<void> {
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
        if (evidenceOnly && !result) {
          const current = await this.requirePolicy(ruleId);
          if (current.epoch === pending.epoch && current.state !== 'retired') {
            if (pending.lastFailure && pending.nextAttemptMs > this.time()) return;
            throw new CalendarError('CALENDAR_NOT_READY');
          }
        }
        // A factual accepted result may be journaled after intake quiesces;
        // canonical ack/fail keep their independent owner evidence lifetime.
        if (!evidenceOnly) this.assertOpen();
        await this.ack(pending, result ? { state: 'accepted', registration: result } : { state: 'absent' });
        if (evidenceOnly && this.closing) return;
      } catch (error) { await this.failed(pending, error); }
    }
    throw new CalendarError('CALENDAR_NOT_READY');
  }
  private async retireControl(control: CalendarIntegrationControlView, signal = this.signal): Promise<CalendarIntegrationControlView> {
    const jobs = this.broker({ id: 'historical:' + control.id, ruleId: control.ruleId, epoch: control.epoch, state: 'retired', policy: control.policy, registration: null });
    let deferred = false;
    try {
      const original = await jobs.registration.reconcile(control.jobsKey, { signal }); this.assertOpen(); signal.throwIfAborted();
      if (control.result?.state === 'accepted') {
        if (!original || !sameRegistration(original, control.result.registration)) throw new CalendarError('CALENDAR_STATE_INVALID'); return control;
      }
      if (!original && control.lastFailure && control.nextAttemptMs > this.time()) { deferred = true; throw new CalendarError('CALENDAR_NOT_READY'); }
      const registration = original ?? await jobs.registration.retire({ idempotencyKey: control.jobsKey,
        expectedRevision: control.expectedJobsRevision, signal });
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
  private command<T>(name: CalendarIntegrationCommand, input: unknown, identity: unknown, options?: { readonly signal: AbortSignal; readonly assertCurrent: () => void }): Promise<T> {
    // Historical acknowledgment/failure remains owner-authorized after intake
    // quiesces; no stopped eligibility check is substituted for factual evidence.
    const fresh = name === 'calendar.integration.policy.install' || name === 'calendar.integration.control.prepare';
    if (fresh || options) this.assertOpen(); options?.assertCurrent();
    return this.options.owner.command(name, input, { idempotencyKey: 'calendar-policy:' + calendarHash(identity),
      ...(options ? { signal: options.signal, assertCurrent: options.assertCurrent } : fresh ? { assertCurrent: () => this.assertOpen() } : {}) });
  }
  private retirementPending(ruleId: string, id?: string): boolean { const marker = this.retirements.get(ruleId); return !!marker && (!marker.id || marker.id === id) && (!marker.settled || marker.pending > 0); }
  private explicitRetirement(ruleId: string, id?: string): boolean { const marker = this.retirements.get(ruleId); return !!marker?.explicit && marker.id === id; }
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
