/** Private native composition only. No public configuration, reminder delivery or managed activation. */
import { serviceDataScopeKey, trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import { createDatabaseRef } from '../databases/database-file';
import { JobsError } from '../jobs/error';
import type { JobWorkflowPin } from '../jobs/model';
import { createTrustedJobSource } from '../jobs/source-authority';
import type { SourceJobs } from '../jobs/source-service';
import type { JobsService } from '../jobs/service';
import { withoutLoggingAttribution } from '../logging/logging-attribution';
import { WorkPool } from '../workers/work-pool';
import type { StepContext, WorkflowInstanceRecord } from '../workflows/types';
import { CalendarError } from './error';
import { CALENDAR_OBSERVATION_JOB, calendarObservationPolicy, type CalendarObservationExecution, type CalendarObservationRule } from './integration-catalog';
import { CalendarIntegrationPolicyController, type CalendarIntegrationEligibilityGuards } from './integration-controller';
import type { CalendarIntegrationControlEvidence } from './integration-controls';
import { CalendarIntegrationDispatcher } from './integration-dispatcher';
import { CALENDAR_INTEGRATION_LIMITS, type CalendarIntegrationCode, type CalendarIntegrationIntentView,
  type CalendarIntegrationPolicySpec, type CalendarIntegrationPolicyView } from './integration-model';
import { observeCalendarIntegration, type CalendarIntegrationObservationResult } from './integration-observation';
import type { CalendarIntegrationOwner } from './integration-runtime';
import type { CalendarOwnerRecord } from './owner-schema';
import type { CalendarRuntimeSource } from './runtime';
import { calendarHash, calendarInteger, calendarKey, calendarRecord } from './validation';

/** One native absolute wake, never a Jobs recurrence or a per-appointment timer. */
export interface CalendarIntegrationWakeScheduler {
  scheduleAt(definition: { readonly name: string; readonly at: number;
    readonly run: (context: { readonly signal: AbortSignal }) => Promise<void> }): { cancel(): void };
}
export interface CalendarIntegrationOwnerPage {
  readonly owners: readonly CalendarOwnerRecord[];
  readonly nextCursor: string | null;
}
export interface CalendarIntegrationCoordinatorOptions {
  readonly rules: readonly CalendarObservationRule[];
  /** Synchronous fixed-graph pin lookup. Must not wait for workflow recovery. */
  readonly pin: (owner: CalendarIntegrationOwner) => JobWorkflowPin;
  readonly owner: (record: CalendarOwnerRecord) => CalendarIntegrationOwner;
  /** Existing SYSTEM metadata only; an implementation must not provision or enumerate physical files. */
  readonly discover: (options: { readonly after?: string; readonly limit: number; readonly signal: AbortSignal }) => CalendarIntegrationOwnerPage | Promise<CalendarIntegrationOwnerPage>;
  /** Pure canonical SYSTEM lookup for recovered execution, including BEFORE start/discovery. */
  readonly resolveOwner: (scope: ServiceDataScope) => CalendarOwnerRecord | null;
  readonly jobs: Pick<JobsService, 'forSource'>;
  readonly inspect: (instanceId: string, scope: ServiceDataScope) => WorkflowInstanceRecord | null;
  readonly now?: () => number;
  readonly onFailure?: (code: CalendarIntegrationCode) => void;
  readonly maxOwners?: number;
  readonly batchSize?: number;
}
interface Binding { readonly hash: string; readonly jobs: SourceJobs }
interface OwnerCell {
  readonly owner: CalendarIntegrationOwner;
  readonly controller: CalendarIntegrationPolicyController;
  readonly dispatcher: CalendarIntegrationDispatcher;
  readonly bindings: Map<string, Binding>;
  readonly hydrated: Map<string, string>;
  ready: Promise<void> | null;
  revision: number;
  nextWakeAt: number | null;
  lastFailure: CalendarIntegrationCode | null;
  retiredRule: boolean;
  unselectedRule: boolean;
}
interface Wake { readonly at: number; readonly token: object; readonly handle: { cancel(): void } }
const RETRY_MS = 1000;
/** This is an explicit PRIVATE envelope, not lazy scalable hydration of the 10,000-owner catalog.
 * Eight permanent rule identities x 64 owners consumes at most 512 source slots;
 * Jobs' 1024-source limit is SHARED, not reserved, and still may reject admission.
 * Cells are not evicted: eviction cannot release Jobs' retained physical source identities.
 */
export const CALENDAR_INTEGRATION_COORDINATOR_MAX_OWNERS = 64;

export class CalendarIntegrationCoordinator implements CalendarObservationExecution {
  readonly source: CalendarRuntimeSource;
  private readonly rules: readonly CalendarObservationRule[];
  private readonly maxOwners: number;
  private readonly batchSize: number;
  private readonly cells = new Map<string, OwnerCell>();
  private readonly refs = new Map<string, OwnerCell>();
  private readonly readiness = new WorkPool({ concurrency: 4, maxConcurrentPerKey: 1, maxQueued: 64, maxQueuedPerKey: 8, queueTimeoutMs: 5000 });
  private readonly intake = new WorkPool({ concurrency: 4, maxConcurrentPerKey: 1, maxQueued: 64, maxQueuedPerKey: 8, queueTimeoutMs: 5000 });
  private readonly evidence = new WorkPool({ concurrency: 8, maxConcurrentPerKey: 1, maxQueued: 32, maxQueuedPerKey: 8, queueTimeoutMs: 5000 });
  private readonly intakeStop = new AbortController();
  private readonly evidenceStop = new AbortController();
  private state: 'dormant' | 'starting' | 'running' | 'quiescing' | 'closed' = 'dormant';
  private scheduler: CalendarIntegrationWakeScheduler | null = null;
  private scheduled: Wake | null = null;
  private uncancelledWake: Wake | null = null;
  private wakeFailure: CalendarIntegrationCode | null = null;
  private startTask: Promise<void> | null = null;
  private wakeTask: Promise<void> | null = null;
  private drainTask: Promise<void> | null = null;
  private evidenceCloseTask: Promise<void> | null = null;
  private readonly wakeName = 'calendar-integration:' + crypto.randomUUID();

  /** Construction is inert: no discovery, owner/pin/capability lookup, files or scheduled work. */
  constructor(private readonly options: CalendarIntegrationCoordinatorOptions) {
    if (!options || !Array.isArray(options.rules) || !options.rules.length || options.rules.length > CALENDAR_INTEGRATION_LIMITS.rules
      || ['pin', 'owner', 'discover', 'resolveOwner', 'inspect'].some(key => typeof options[key as keyof CalendarIntegrationCoordinatorOptions] !== 'function')
      || typeof options.jobs?.forSource !== 'function' || options.now !== undefined && typeof options.now !== 'function'
      || options.onFailure !== undefined && typeof options.onFailure !== 'function') throw new CalendarError('CALENDAR_CONFIG_INVALID');
    this.maxOwners = calendarInteger(options.maxOwners ?? CALENDAR_INTEGRATION_COORDINATOR_MAX_OWNERS, 1, CALENDAR_INTEGRATION_COORDINATOR_MAX_OWNERS);
    this.batchSize = calendarInteger(options.batchSize ?? 25, 1, CALENDAR_INTEGRATION_LIMITS.page);
    const ids = new Set<string>();
    this.rules = Object.freeze(options.rules.map(input => {
      const r = calendarRecord(input, ['id', 'version', 'dueOffsetMs', 'maxLatenessMs']);
      const rule = Object.freeze({ id: calendarKey(r.id, 64), version: calendarKey(r.version, 64),
        dueOffsetMs: calendarInteger(r.dueOffsetMs, -CALENDAR_INTEGRATION_LIMITS.horizonMs, CALENDAR_INTEGRATION_LIMITS.horizonMs),
        maxLatenessMs: calendarInteger(r.maxLatenessMs, 0, CALENDAR_INTEGRATION_LIMITS.horizonMs) });
      if (ids.has(rule.id)) throw new CalendarError('CALENDAR_CONFIG_INVALID'); ids.add(rule.id); return rule;
    }));
    this.source = Object.freeze({
      // Runtime announces even unestablished records here. Do not hydrate/retain
      // an entire SYSTEM catalog while the runtime is still being constructed.
      prepare: (_record: CalendarOwnerRecord) => { this.assertIntake(); },
      ready: (record: CalendarOwnerRecord) => this.ready(record),
      wake: (ref: string) => this.hint(ref),
      // Runtime/source close stops intake only. Torrent may still need evidence.
      close: () => this.drain(),
    });
  }

  /** Physical owner proof and capture-only preparation. NEVER resolves SourceJobs. */
  ready(record: CalendarOwnerRecord): Promise<void> {
    try {
      this.assertIntake(); const cell = this.cell(record);
      if (cell.ready) return cell.ready;
      const task = withoutLoggingAttribution(() => this.readiness.run(async signal => {
        signal.throwIfAborted(); this.assertIntake();
        await cell.owner.verify({ signal: this.intakeStop.signal }); this.assertIntake();
        await this.prepare(cell, true);
      }, { key: 'calendar-ready:' + calendarHash(cell.owner.owner.id), signal: this.intakeStop.signal }))
        .then(() => { if (this.state === 'running') this.mark(cell); });
      cell.ready = task;
      void task.finally(() => { if (cell.ready === task) cell.ready = null; }).catch(() => {});
      return task;
    } catch (error) { return Promise.reject(error); }
  }

  /** Call only after Jobs/Torrent dependencies have recovered; there is no implicit recovery promise. */
  start(scheduler: CalendarIntegrationWakeScheduler): Promise<void> {
    if (this.startTask) return this.startTask;
    try {
      this.assertIntake(); if (this.state === 'running') return Promise.resolve();
      if (!scheduler || typeof scheduler.scheduleAt !== 'function') throw new CalendarError('CALENDAR_CONFIG_INVALID');
      this.state = 'starting'; this.scheduler = scheduler;
      const task = withoutLoggingAttribution(async () => {
        // Complete bounded discovery BEFORE activating any newly discovered source.
        // A cursor that cannot advance cannot strand startup in an infinite loop.
        let after: string | undefined;
        for (let page = 0; page <= this.maxOwners; page++) {
          this.assertIntake();
          const found = await this.options.discover({ ...(after === undefined ? {} : { after }), limit: Math.min(16, this.maxOwners + 1), signal: this.intakeStop.signal });
          this.assertIntake();
          if (!found || !Array.isArray(found.owners) || found.owners.length > Math.min(16, this.maxOwners + 1)
            || found.nextCursor !== null && (typeof found.nextCursor !== 'string' || !found.nextCursor || after !== undefined && found.nextCursor <= after)) throw new CalendarError('CALENDAR_STATE_INVALID');
          let previous = after;
          for (const record of found.owners) {
            if (previous !== undefined && record.id <= previous) throw new CalendarError('CALENDAR_STATE_INVALID');
            this.cell(record); previous = record.id;
          }
          if (found.nextCursor === null) break;
          if (!found.owners.length || found.nextCursor !== previous || page === this.maxOwners) throw new CalendarError('CALENDAR_STATE_INVALID');
          after = found.nextCursor;
        }
        await Promise.all([...this.cells.values()].map(cell => this.run(cell, () => this.process(cell))));
        this.assertIntake(); this.state = 'running'; this.arm();
      }).catch(error => {
        try { this.cancelWake(); }
        catch (cleanup) { error = new AggregateError([error, cleanup], 'Calendar startup and wake cleanup failed.'); }
        finally {
          this.scheduler = null;
          if (this.state === 'starting' || this.state === 'running') this.state = 'dormant';
        }
        throw error;
      });
      this.startTask = task;
      void task.finally(() => { if (this.startTask === task) this.startTask = null; }).catch(() => {});
      return task;
    } catch (error) { return Promise.reject(error); }
  }

  /** Payload-free hints are coalesced into the same one absolute native wake. */
  hint(ref: string): void {
    if (this.state !== 'running' && this.state !== 'starting') return;
    const cell = this.refs.get(ref); if (cell) this.mark(cell);
  }

  /** Recovery/evidence path is independent of start(), owner intake capacity and policy hydration. */
  execute(context: StepContext): Promise<CalendarIntegrationObservationResult> {
    try {
      this.assertEvidence();
      const identity = context.execution;
      if (identity.kind !== 'system' || identity.legacyCompatibility || !/^jobs:source:src_[a-f0-9]{64}$/.test(identity.principal)
        || !(context.signal instanceof AbortSignal)) throw new CalendarError('CALENDAR_FORBIDDEN');
      const scope = identity.scopeKind === 'application'
        ? identity.scopeId === 'application' && identity.tenantId === null ? trustedSystemServiceDataScope({ scopeKind: 'application' }) : null
        : identity.tenantId && identity.scopeId === identity.tenantId ? trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: identity.tenantId }) : null;
      if (!scope) throw new CalendarError('CALENDAR_FORBIDDEN');
      const input = calendarRecord(context.input, ['kind', 'intentId', 'appointmentRevision', 'policyEpoch']);
      const id = calendarKey(input.intentId);
      return withoutLoggingAttribution(() => this.evidence.run(async signal => {
        this.assertEvidence(); signal.throwIfAborted(); context.assertCurrentAuthority();
        const record = this.options.resolveOwner(scope);
        if (!record) throw new CalendarError('CALENDAR_STATE_INVALID');
        const owner = this.options.owner(record);
        if (serviceDataScopeKey(owner.scope) !== serviceDataScopeKey(scope)) throw new CalendarError('CALENDAR_STATE_INVALID');
        await owner.verify({ signal });
        const intent = await owner.read<CalendarIntegrationIntentView | null>('calendar.integration.intent', { id }, { signal });
        if (!intent) throw new CalendarError('CALENDAR_FORBIDDEN');
        const jobs = this.bindJobs(owner, intent.policy, retiredGuards, signal);
        const originalGuard = context.assertCurrentAuthority;
        const execution = Object.freeze({ ...context, signal,
          assertCurrentAuthority: () => { this.assertEvidence(); signal.throwIfAborted(); originalGuard(); } });
        return observeCalendarIntegration({ owner, executions: jobs.executions, inspect: this.options.inspect, now: this.options.now }, execution);
      }, { key: 'calendar-evidence:' + calendarHash([serviceDataScopeKey(scope), id]), signal: AbortSignal.any([context.signal!, this.evidenceStop.signal]) }));
    } catch (error) { return Promise.reject(error); }
  }

  /** Synchronously stop new source/control eligibility, not evidence or dependency callbacks. */
  quiesce(): void {
    if (this.state === 'closed' || this.state === 'quiescing') return;
    this.state = 'quiescing';
    try { this.cancelWake(); }
    finally {
      for (const cell of this.cells.values()) {
        cell.controller.quiesce();
        // close() stops dispatcher intake synchronously before its first await.
        // drain() subsequently observes any cleanup refusal rather than hiding it.
        void cell.dispatcher.close().catch(() => {});
      }
      this.intakeStop.abort(new JobsError('JOBS_OUTCOME_UNKNOWN'));
    }
  }
  /** Drain this coordinator's callers only, NOT shared Jobs/Torrent physical work. */
  drain(): Promise<void> {
    if (this.drainTask) return this.drainTask;
    try { this.quiesce(); } catch { /* Retry exact wake cleanup below; intake is already fenced. */ }
    const task = (async () => {
      let wakeFailure: unknown;
      try { this.cancelWake(); } catch (error) { wakeFailure = error; }
      const outcomes = await Promise.allSettled([
        ...[this.startTask, this.wakeTask].filter((task): task is Promise<void> => task !== null),
        this.readiness.close(), this.intake.close(),
        ...[...this.cells.values()].flatMap(cell => [cell.controller.close(), cell.dispatcher.close()]),
      ]);
      const failures = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (wakeFailure) failures.push({ status: 'rejected', reason: wakeFailure });
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Calendar integration intake did not drain cleanly.');
    })();
    this.drainTask = task;
    void task.catch(() => { if (this.drainTask === task) this.drainTask = null; }); return task;
  }
  /** @internal Physical native intake join, separately from bounded drain's
   * diagnostics and shared Jobs/Torrent settlement. Attempt drain() first and
   * preserve its rejection; this join grants no new source/effect authority.
   */
  async drainPhysicalIntake(): Promise<void> {
    if (this.state !== 'quiescing' && this.state !== 'closed') throw new CalendarError('CALENDAR_NOT_READY');
    await Promise.all([this.readiness.drainPhysical(), this.intake.drainPhysical(),
      ...[...this.cells.values()].map(cell => cell.controller.drainPhysical())]);
  }
  /** Final phase ONLY after shared Jobs callbacks and Torrent recovery/execution have stopped. */
  closeEvidence(): Promise<void> {
    if (this.evidenceCloseTask) return this.evidenceCloseTask;
    const task = (async () => {
      await this.drain(); this.evidenceStop.abort(new CalendarError('CALENDAR_NOT_READY'));
      await this.evidence.close(); this.state = 'closed';
    })();
    this.evidenceCloseTask = task;
    void task.catch(() => { if (this.evidenceCloseTask === task) this.evidenceCloseTask = null; }); return task;
  }
  /** @internal AFTER Torrent stop/physical drain. Even if earlier bounded
   * drainage refused, retire this final pool and join its actual bodies before
   * any adjacent Jobs/Calendar provider closes. Earlier errors remain errors.
   */
  async drainPhysicalEvidence(): Promise<void> {
    if (this.state !== 'quiescing' && this.state !== 'closed') throw new CalendarError('CALENDAR_NOT_READY');
    this.evidenceStop.abort(new CalendarError('CALENDAR_NOT_READY'));
    try { await this.evidence.close(); } catch { /* Native owner retains the separately reported bounded-close failure. */ }
    await this.evidence.drainPhysical();
  }
  diagnostics() {
    return { state: this.state, retainedOwners: this.cells.size, maxOwners: this.maxOwners, scheduledAt: this.scheduled?.at ?? null,
      uncancelledWakeAt: this.uncancelledWake?.at ?? null,
      wakeFailure: this.wakeFailure,
      readiness: this.readiness.status(), intake: this.intake.status(), evidence: this.evidence.status(),
      blockedOwners: [...this.cells.values()].filter(cell => cell.lastFailure || cell.retiredRule || cell.unselectedRule).map(cell => ({
        owner: calendarHash(cell.owner.owner.id), code: cell.lastFailure, retiredRule: cell.retiredRule, unselectedRule: cell.unselectedRule,
      })) };
  }

  private cell(record: CalendarOwnerRecord): OwnerCell {
    this.assertIntake();
    const old = this.cells.get(record.id);
    if (old) {
      if (calendarHash(old.owner.owner) !== calendarHash(record)) throw new CalendarError('CALENDAR_STATE_INVALID'); return old;
    }
    if (this.cells.size >= this.maxOwners) throw new CalendarError('CALENDAR_CAPACITY');
    if (record.established !== 1) throw new CalendarError('CALENDAR_NOT_READY');
    const owner = this.options.owner(record); owner.assertCurrent();
    if (calendarHash(owner.owner) !== calendarHash(record)) throw new CalendarError('CALENDAR_STATE_INVALID');
    const bindings = new Map<string, Binding>();
    const controller = new CalendarIntegrationPolicyController({ owner, now: this.options.now, jobs: (policy, guards) => {
      const jobs = this.bindJobs(owner, policy, guards, owner.signal);
      // At most one retained native capability per current rule. Historical
      // evidence capabilities are transient; never retain 10,000 policy epochs.
      bindings.set(policy.ruleId, { hash: calendarHash(policy), jobs }); return jobs;
    } });
    const dispatcher = new CalendarIntegrationDispatcher({ store: owner, batchSize: this.batchSize, now: this.options.now,
      onFailure: code => this.report(code), jobs: intent => {
        const live = bindings.get(intent.ruleId);
        return live?.hash === calendarHash(intent.policy) ? live.jobs : this.bindJobs(owner, intent.policy, retiredGuards, owner.signal);
      } });
    const cell: OwnerCell = { owner, controller, dispatcher, bindings, hydrated: new Map(), ready: null,
      revision: 0, nextWakeAt: this.time(), lastFailure: null, retiredRule: false, unselectedRule: false };
    this.cells.set(record.id, cell); this.refs.set(createDatabaseRef(record.id), cell); return cell;
  }
  private run<T>(cell: OwnerCell, work: () => Promise<T>): Promise<T> {
    return withoutLoggingAttribution(() => this.intake.run(async signal => { signal.throwIfAborted(); this.assertIntake(); return work(); },
      { key: 'calendar-owner:' + calendarHash(cell.owner.owner.id), signal: this.intakeStop.signal }));
  }
  private async prepare(cell: OwnerCell, strict: boolean): Promise<void> {
    cell.retiredRule = false;
    const retained = await this.policies(cell);
    cell.unselectedRule = retained.some(policy => !this.rules.some(rule => rule.id === policy.ruleId));
    if (cell.unselectedRule) throw new CalendarError('CALENDAR_NOT_READY');
    for (const rule of this.rules) {
      const current = retained.find(policy => policy.ruleId === rule.id);
      if (current?.state === 'retired') {
        cell.retiredRule = true;
        // A stale desired-config list must never resurrect an explicitly retired
        // rule. Operator-authorized reactivation is a separate unopened gate.
        if (strict) throw new CalendarError('CALENDAR_NOT_READY'); continue;
      }
      const desired = calendarObservationPolicy(cell.owner, rule, this.options.pin(cell.owner));
      // A fresh verified snapshot, not a successful-readiness cache. Exact
      // capture is already installed and does not depend on Jobs settlement.
      // In particular do not enter the controller's per-rule pool, which may
      // currently be waiting for an independent Jobs registration callback.
      if (strict && current && calendarHash(current.policy) === calendarHash(desired)) continue;
      await cell.controller.prepare(desired);
    }
  }
  private async process(cell: OwnerCell): Promise<void> {
    const revision = cell.revision;
    let controlRule: string | null = null, verified = false, dispatching = false, localFailure = false;
    cell.lastFailure = null;
    try {
      await cell.owner.verify({ signal: this.intakeStop.signal }); this.assertIntake(); verified = true;
      const policies = await this.policies(cell);
      cell.unselectedRule = policies.some(policy => !this.rules.some(rule => rule.id === policy.ruleId));
      // Removed configuration is not authority to revive or retire an old
      // source. Fail closed for explicit operator review before any Jobs call.
      if (cell.unselectedRule) throw new CalendarError('CALENDAR_NOT_READY');
      let pending = false;
      for (const policy of policies) {
        const proof = await cell.owner.read<CalendarIntegrationControlEvidence>('calendar.integration.controlEvidence', { ruleId: policy.ruleId });
        const key = (policy.state === 'retired' ? 'retired:' : 'active:') + policy.id;
        if (cell.hydrated.get(policy.ruleId) === key && !proof.pending) continue;
        controlRule = policy.ruleId;
        if (policy.state === 'retired') {
          await cell.controller.retire(policy.ruleId); cell.hydrated.set(policy.ruleId, key); controlRule = null; continue;
        }
        // Every pass checks pending original controls, not just initial startup.
        // A local retirement preserves policy.id, so cache state is essential.
        const result = await cell.controller.activate(policy.ruleId); controlRule = null;
        if (result.policy.state === 'active' && result.result?.state === 'accepted') cell.hydrated.set(policy.ruleId, 'active:' + result.policy.id);
        else pending = true;
      }
      // A backoff result is not settlement. Do not prepare desired B yet, but
      // durably defer ready appointments and keep historical cancels progressing.
      if (pending) {
        dispatching = true; await cell.dispatcher.runBatch(); dispatching = false; return;
      }
      await this.prepare(cell, false);
      for (const rule of this.rules) {
        const policy = await cell.owner.read<CalendarIntegrationPolicyView | null>('calendar.integration.policy', { ruleId: rule.id });
        if (!policy || policy.state === 'retired' || cell.hydrated.get(rule.id) === 'active:' + policy.id) continue;
        controlRule = rule.id;
        const result = await cell.controller.activate(rule.id); controlRule = null;
        if (result.policy.state === 'active' && result.result?.state === 'accepted') cell.hydrated.set(rule.id, 'active:' + result.policy.id);
      }
      dispatching = true; await cell.dispatcher.runBatch(); dispatching = false;
    } catch (error) {
      if (this.state === 'quiescing' || this.state === 'closed') return;
      cell.lastFailure = code(error); this.report(cell.lastFailure);
      let durable = false;
      if (controlRule) try {
        const proof = await cell.owner.read<CalendarIntegrationControlEvidence>('calendar.integration.controlEvidence', { ruleId: controlRule });
        durable = !!proof.pending?.lastFailure && proof.pending.nextAttemptMs > this.time();
      } catch { /* A failed evidence read cannot fabricate a durable retry marker. */ }
      localFailure = !durable;
      if (verified && controlRule && !dispatching && !cell.unselectedRule) try {
        // The first thrown activation failure needs this pass too, not just a
        // later returned-backoff result. No source lease crosses this Jobs wait.
        await cell.dispatcher.runBatch();
      } catch (dispatchError) { localFailure = true; cell.lastFailure = code(dispatchError); this.report(cell.lastFailure); }
    } finally {
      if (this.state !== 'quiescing' && this.state !== 'closed') {
        if (cell.unselectedRule) { cell.nextWakeAt = null; return; }
        try {
          const wake = await cell.owner.read<{ nextWakeAt: number | null }>('calendar.integration.nextWake', {});
          if (!wake || wake.nextWakeAt !== null && !Number.isSafeInteger(wake.nextWakeAt)) throw new CalendarError('CALENDAR_STATE_INVALID');
          cell.nextWakeAt = wake.nextWakeAt === null ? null : calendarInteger(wake.nextWakeAt, 0, 8_640_000_000_000_000);
          // An unjournaled owner/read/pin refusal must neither sleep until an
          // unrelated accepted expiry nor spin an unprocessable ready-at-now
          // row. Back this owner off locally; durable control failures retain
          // their exact source deadline and independently progressing dispatch.
          if (localFailure) cell.nextWakeAt = this.time() + RETRY_MS;
        } catch (error) { localFailure = true; cell.lastFailure = code(error); this.report(cell.lastFailure); cell.nextWakeAt = this.time() + RETRY_MS; }
        if (!localFailure && cell.revision !== revision) cell.nextWakeAt = Math.min(cell.nextWakeAt ?? Infinity, this.time());
      }
    }
  }
  private async policies(cell: OwnerCell): Promise<CalendarIntegrationPolicyView[]> {
    const policies = await cell.owner.read<CalendarIntegrationPolicyView[]>('calendar.integration.policies', {});
    if (!Array.isArray(policies) || policies.length > CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_STATE_INVALID');
    return policies;
  }
  private bindJobs(owner: CalendarIntegrationOwner, input: CalendarIntegrationPolicySpec,
    guards: CalendarIntegrationEligibilityGuards, signal: AbortSignal): SourceJobs {
    // Rebuild the closed catalog contract against this physical owner; arbitrary
    // source contracts/definitions are never admitted through coordinator options.
    const expected = calendarObservationPolicy(owner, { id: input.ruleId, version: input.ruleVersion,
      dueOffsetMs: input.dueOffsetMs, maxLatenessMs: input.maxLatenessMs }, input.source.workflow);
    if (calendarHash(expected) !== calendarHash(input)) throw new CalendarError('CALENDAR_STATE_INVALID');
    const capability = createTrustedJobSource({ ...input.source, scope: owner.scope, definition: CALENDAR_OBSERVATION_JOB,
      signal: AbortSignal.any([owner.signal, signal, this.evidenceStop.signal]),
      assertOwnerCurrent: () => { this.assertEvidence(); owner.assertCurrent(); },
      confirmOwnerCurrent: async () => { this.assertEvidence(); await owner.verify(); this.assertEvidence(); },
      assertEligible: () => {
        if (this.state !== 'running' && this.state !== 'starting') throw new JobsError('JOBS_AUTHORITY_RETIRED'); guards.assertEligible();
      },
      confirmEligible: async () => { await guards.confirmEligible(); },
    });
    return this.options.jobs.forSource(capability);
  }
  private mark(cell: OwnerCell): void {
    cell.revision++; cell.nextWakeAt = this.time();
    if (this.state !== 'running') return;
    if (this.wakeTask) return;
    try { this.arm(); } catch (error) { cell.lastFailure = code(error); }
  }
  private arm(): void {
    if (this.state !== 'running' || !this.scheduler) return;
    try {
      const next = Math.min(...[...this.cells.values()].map(cell => cell.nextWakeAt ?? Infinity));
      if (!Number.isFinite(next)) { this.cancelWake(); this.wakeFailure = null; return; }
      const at = Math.max(this.time(), next);
      if (this.scheduled?.at === at) return;
      this.cancelWake(); const token = {};
      const handle = withoutLoggingAttribution(() => this.scheduler!.scheduleAt({ name: this.wakeName, at, run: async context => {
        if (this.state !== 'running' || this.scheduled?.token !== token || context.signal.aborted) return;
        this.scheduled = null;
        if (this.wakeTask) return;
        const task = withoutLoggingAttribution(() => this.wake()); this.wakeTask = task;
        try { await task; }
        finally {
          if (this.wakeTask === task) this.wakeTask = null;
          if (this.state === 'running') this.arm();
        }
      } }));
      this.scheduled = { at, token, handle }; this.wakeFailure = null;
    } catch (error) {
      // A live service without its durable-retry wake is not a successful run.
      // Stop fresh eligibility without permanently closing owner/evidence or
      // aborting this coordinator: explicit start() may recover original work.
      this.state = 'dormant'; this.scheduler = null;
      try { this.cancelWake(); }
      catch (cleanup) { error = new AggregateError([error, cleanup], 'Calendar wake registration and cleanup failed.'); }
      this.wakeFailure = code(error); this.report(this.wakeFailure); throw error;
    }
  }
  private async wake(): Promise<void> {
    const now = this.time();
    await Promise.all([...this.cells.values()].filter(cell => cell.nextWakeAt !== null && cell.nextWakeAt <= now)
      .map(cell => this.run(cell, () => this.process(cell))));
  }
  private cancelWake(): void {
    const wake = this.scheduled ?? this.uncancelledWake; this.scheduled = null;
    if (!wake) return;
    try { wake.handle.cancel(); if (this.uncancelledWake === wake) this.uncancelledWake = null; }
    catch (error) { this.uncancelledWake = wake; throw error; }
  }
  private assertIntake(): void { if (this.state === 'quiescing' || this.state === 'closed') throw new CalendarError('CALENDAR_NOT_READY'); this.intakeStop.signal.throwIfAborted(); }
  private assertEvidence(): void { this.evidenceStop.signal.throwIfAborted(); if (this.state === 'closed') throw new CalendarError('CALENDAR_NOT_READY'); }
  private time(): number { return calendarInteger((this.options.now ?? Date.now)(), 0, 8_640_000_000_000_000); }
  private report(value: CalendarIntegrationCode): void { try { this.options.onFailure?.(value); } catch { /* Advisory, never source truth. */ } }
}
const retiredGuards: CalendarIntegrationEligibilityGuards = {
  assertEligible() { throw new JobsError('JOBS_AUTHORITY_RETIRED'); },
  async confirmEligible() { throw new JobsError('JOBS_AUTHORITY_RETIRED'); },
};
function code(error: unknown): CalendarIntegrationCode {
  return error instanceof JobsError && ['JOBS_CAPACITY', 'JOBS_OUTCOME_UNKNOWN', 'JOBS_NOT_READY', 'JOBS_REVISION_CONFLICT',
    'JOBS_DEFINITION_UNAVAILABLE', 'JOBS_AUTHORITY_RETIRED'].includes(error.code) ? error.code as CalendarIntegrationCode
    : error instanceof CalendarError && error.code === 'CALENDAR_NOT_READY' ? 'CALENDAR_NOT_READY' : 'INTEGRATION_RETRY';
}
