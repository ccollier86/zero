/** Private native composition only. No public configuration, reminder delivery or managed activation. */
import { serviceDataScopeKey, trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import { createDatabaseRef } from '../databases/database-file';
import { JobsError } from '../jobs/error';
import type { JobAdmission, JobWorkflowPin } from '../jobs/model';
import { jobSourceId } from '../jobs/source-model';
import { createTrustedJobSource } from '../jobs/source-authority';
import type { SourceJobs } from '../jobs/source-service';
import type { JobsService } from '../jobs/service';
import { withoutLoggingAttribution } from '../logging/logging-attribution';
import { WorkPool } from '../workers/work-pool';
import type { StepContext, WorkflowInstanceRecord } from '../workflows/types';
import { CalendarError } from './error';
import { CALENDAR_OBSERVATION_JOB, calendarObservationPinInput, normalizeCalendarObservationInput, calendarObservationPolicy, type CalendarObservationExecution, type CalendarObservationRule } from './integration-catalog';
import { CalendarIntegrationPolicyController, type CalendarIntegrationEligibilityGuards } from './integration-controller';
import type { CalendarIntegrationControlEvidence, CalendarIntegrationControlView } from './integration-controls';
import type { CalendarIntegrationWakeCatalog } from './integration-wake-catalog';
import { CalendarIntegrationDispatcher } from './integration-dispatcher';
import { CALENDAR_INTEGRATION_LIMITS, type CalendarIntegrationCode, type CalendarIntegrationIntentView,
  type CalendarIntegrationPolicySpec, type CalendarIntegrationPolicyView } from './integration-model';
import type { CalendarIntegrationInspection } from './integration-inspection-model';
import { isCalendarIntegrationHistoricalRealmFingerprint } from './integration-historical-realms';
import { calendarIntegrationInspectionKey, calendarIntegrationOperatorControl, calendarIntegrationOperatorOptions,
  calendarIntegrationPolicySelection, type CalendarIntegrationNativeOperations, type CalendarIntegrationOperatorControl,
  type CalendarIntegrationOperatorInspection, type CalendarIntegrationOperatorReadOptions,
  type CalendarIntegrationOperatorResult, type CalendarIntegrationOperatorRule } from './integration-operator';
import { observeCalendarIntegration, type CalendarIntegrationObservationResult } from './integration-observation';
import type { CalendarIntegrationOwner, CalendarIntegrationReadOptions } from './integration-runtime';
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
  readonly jobs: Pick<JobsService, 'forSource'> & Partial<Pick<JobsService, 'tryDetachSources'>>;
  /** Lazy native SYSTEM metadata only. Presence selects bounded catalog mode. */
  readonly wakeCatalog?: () => CalendarIntegrationWakeCatalog;
  readonly inspect: (instanceId: string, scope: ServiceDataScope) => WorkflowInstanceRecord | null;
  /** Native SYSTEM publication after this owner's whole pass has settled.
   * The implementation samples/queries/generation-CASes without overlapping
   * SYSTEM and private leases. Rejection leaves the durable marker dirty. */
  readonly refreshWake?: (record: CalendarOwnerRecord,
    failure?: { readonly classification: 'retry' | 'review'; readonly nextWakeAt: number }) => Promise<number | null>;
  readonly now?: () => number;
  readonly onFailure?: (code: CalendarIntegrationCode) => void;
  readonly maxOwners?: number;
  readonly batchSize?: number;
}
interface OwnerCell {
  readonly owner: CalendarIntegrationOwner;
  readonly controller: CalendarIntegrationPolicyController;
  readonly dispatcher: CalendarIntegrationDispatcher;
  readonly hydrated: Map<string, string>;
  readonly generation: number;
  phase: 'open' | 'evicting' | 'detached';
  queued: number;
  physical: number;
  readonly sourceIds: Set<string>;
  inventoryRead: boolean;
  ready: Promise<void> | null;
  revision: number;
  nextWakeAt: number | null;
  lastFailure: CalendarIntegrationCode | null;
  retiredRule: boolean;
  unselectedRule: boolean;
}
interface Wake { readonly at: number; readonly token: object; readonly handle: { cancel(): void } }
interface OwnerPin { start(): void; attach(cell: OwnerCell): void; release(): void }
const RETRY_MS = 1000;
/** This is an explicit PRIVATE envelope, not lazy scalable hydration of the 10,000-owner catalog.
 * Eight permanent rule identities x 64 owners consumes at most 512 source slots;
 * Jobs' 1024-source limit is SHARED, not reserved, and still may reject admission.
 * Cells are not evicted at this seam: exact Jobs detach is necessary but does
 * not itself fence owner readiness/intake/evidence or settle their real bodies.
 */
export const CALENDAR_INTEGRATION_COORDINATOR_MAX_OWNERS = 64;

export class CalendarIntegrationCoordinator implements CalendarObservationExecution, CalendarIntegrationNativeOperations {
  readonly source: CalendarRuntimeSource;
  private readonly rules: readonly CalendarObservationRule[];
  private readonly maxOwners: number;
  private readonly batchSize: number;
  private readonly cells = new Map<string, OwnerCell>();
  private readonly refs = new Map<string, OwnerCell>();
  private readonly ownerActivity = new Map<string, number>();
  private readonly admissions = new Map<string, { readonly hash: string; readonly task: Promise<OwnerCell> }>();
  private readonly readyTasks = new Map<string, { readonly hash: string; readonly task: Promise<void> }>();
  private readonly demand = new Set<Promise<boolean>>();
  private readonly cleanup = new Set<Promise<void>>();
  private cleanupFailure: unknown;
  private generation = 0;
  private evictedOwners = 0;
  private evicting = false;
  private catalogRetryAt: number | null = null;
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
    if (!options || !Array.isArray(options.rules) || options.rules.length > CALENDAR_INTEGRATION_LIMITS.rules
      || ['pin', 'owner', 'discover', 'resolveOwner', 'inspect'].some(key => typeof options[key as keyof CalendarIntegrationCoordinatorOptions] !== 'function')
      || typeof options.jobs?.forSource !== 'function' || options.now !== undefined && typeof options.now !== 'function'
      || options.onFailure !== undefined && typeof options.onFailure !== 'function'
      || options.refreshWake !== undefined && typeof options.refreshWake !== 'function'
      || options.wakeCatalog !== undefined && (typeof options.wakeCatalog !== 'function' || typeof options.refreshWake !== 'function'
        || typeof options.jobs.tryDetachSources !== 'function')) throw new CalendarError('CALENDAR_CONFIG_INVALID');
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
      prepare: (record: CalendarOwnerRecord) => { this.assertIntake();
        if (this.options.wakeCatalog && record.established === 1) this.hint(createDatabaseRef(record.id)); },
      ready: (record: CalendarOwnerRecord) => this.ready(record),
      wake: (ref: string) => this.hint(ref),
      // Runtime/source close stops intake only. Torrent may still need evidence.
      close: () => this.drain(),
    });
  }

  /** Durable discovery hint only, never a fresh policy/pin authority proof.
   * No owner lookup, random controller identity or function source enters it. */
  configurationStamp(): string {
    return calendarHash({ semantics: 'calendar-integration-coordinator-v1', rules: this.rules,
      jobFingerprint: CALENDAR_OBSERVATION_JOB.fingerprint });
  }

  /** Physical owner proof and capture-only preparation. NEVER resolves SourceJobs. */
  ready(record: CalendarOwnerRecord): Promise<void> {
    try {
      this.assertIntake(); const existing = this.existingCell(record), shared = this.readyTasks.get(record.id);
      if (shared) { if (shared.hash !== calendarHash(record)) throw new CalendarError('CALENDAR_STATE_INVALID'); return shared.task; }
      if (this.readyTasks.size >= this.maxOwners + 64) throw new CalendarError('CALENDAR_CAPACITY');
      let admitted: OwnerCell | undefined;
      const task = withoutLoggingAttribution(() => this.pinned(this.readiness, record.id, existing, async (signal, pin) => {
        signal.throwIfAborted(); this.assertIntake();
        const cell = await this.cell(record); pin.attach(cell); admitted = cell;
        if (existing || !this.options.wakeCatalog) await cell.owner.verify({ signal: this.intakeStop.signal });
        this.assertIntake();
        await this.prepare(cell, true);
      }, { key: 'calendar-ready:' + calendarHash(record.id), signal: this.intakeStop.signal }))
        .then(() => { if (this.state === 'running' && admitted) this.mark(admitted); });
      this.readyTasks.set(record.id, { hash: calendarHash(record), task }); if (existing) existing.ready = task;
      void task.finally(() => { if (this.readyTasks.get(record.id)?.task === task) this.readyTasks.delete(record.id);
        if (existing?.ready === task) existing.ready = null; }).catch(() => {});
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
        if (this.options.wakeCatalog) {
          await this.catalogPass(); this.assertIntake(); this.state = 'running'; this.arm(); return;
        }
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
            await this.cell(record); previous = record.id;
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
    if (this.options.wakeCatalog) {
      // Same-pass dirty hints are covered by publication; they must not erase
      // an earlier failed publication's finite backoff and recreate a spin.
      if (this.state === 'running' && !this.wakeTask) { this.catalogRetryAt = null; this.arm(); }
      return;
    }
    const cell = this.refs.get(ref); if (cell) this.mark(cell);
  }

  /** Existing-only inspection. It never hydrates a source, allocates an intake
   * cell, pins a graph, provisions a file, registers Jobs or claims work. Reads
   * may finish during intake drainage; evidence lifetime remains independently owned.
   */
  inspect(scope: ServiceDataScope, options?: CalendarIntegrationOperatorReadOptions): Promise<CalendarIntegrationOperatorInspection | null> {
    try {
      this.assertEvidence(); const opts = calendarIntegrationOperatorOptions(options), owner = this.operatorOwner(scope);
      if (!owner) return Promise.resolve(null);
      return withoutLoggingAttribution(() => this.pinned(this.evidence, owner.owner.id, undefined, async signal => {
        const guard = () => {
          this.assertEvidence(); signal.throwIfAborted(); owner.assertCurrent();
          if (opts.assertCurrent) invokeSynchronousAuthCallback(opts.assertCurrent, {
            component: 'calendar', invariant: 'operator-inspection-authority-is-synchronous',
            message: 'Calendar inspection authority checks must not yield.',
          });
        };
        const confirm = async () => { guard(); await opts.confirmCurrent?.(); guard(); };
        const read = { signal, assertCurrent: guard };
        guard(); await owner.verify(read); await confirm();
        const before = await owner.read<CalendarIntegrationInspection>('calendar.integration.inspection', {}, read); await confirm();
        const policies = await owner.read<CalendarIntegrationPolicyView[]>('calendar.integration.policies', {}, read); await confirm();
        if (!Array.isArray(policies) || policies.length !== before.rules.length || policies.some(policy => {
          const selected = before.rules.find(rule => rule.ruleId === policy.ruleId);
          return !selected || selected.id !== policy.id || selected.epoch !== policy.epoch || selected.state !== policy.state
            || selected.policyDigest !== calendarHash(policy.policy);
        })) throw new CalendarError('CALENDAR_POLICY_STALE');
        const observed: CalendarIntegrationOperatorRule[] = [];
        for (const policy of policies) {
          guard(); const jobs = this.bindJobs(owner, policy.policy, retiredGuards, signal);
          const registration = await jobs.registration.get(); await confirm();
          const capacity = await jobs.capacity.get(); await confirm();
          observed.push({ ...before.rules.find(rule => rule.ruleId === policy.ruleId)!,
            configured: this.rules.some(rule => rule.id === policy.ruleId), selection: calendarIntegrationPolicySelection(policy),
            downstream: registration && { generation: registration.generation, revision: registration.revision,
              state: registration.state, matchesPolicy: registration.policyHash === calendarHash(policy.policy.source) },
            capacity });
        }
        const after = await owner.read<CalendarIntegrationInspection>('calendar.integration.inspection', {}, read); await confirm();
        if (calendarIntegrationInspectionKey(before) !== calendarIntegrationInspectionKey(after)) throw new CalendarError('CALENDAR_POLICY_STALE');
        // These are separate source/Jobs observations, not an atomic snapshot or
        // a certificate that effects drained or the evidence owner can be removed.
        return { ...after, rules: observed.map(rule => ({ ...rule,
          pendingControl: after.rules.find(current => current.ruleId === rule.ruleId)!.pendingControl })),
        evidenceOwnerRequired: true, snapshot: 'separate-source-and-jobs-observations' };
      }, { key: 'calendar-inspection:' + calendarHash(owner.owner.id), signal: AbortSignal.any([this.evidenceStop.signal, ...(opts.signal ? [opts.signal] : [])]) }));
    } catch (error) { return Promise.reject(error); }
  }

  /** Private native controls only. A browser mutation must additionally acquire
   * a source-atomic initiating-actor/receipt/audit boundary before projection.
   */
  retire(scope: ServiceDataScope, input: CalendarIntegrationOperatorControl): Promise<CalendarIntegrationOperatorResult> {
    return this.operatorControl(scope, input, false);
  }
  reactivate(scope: ServiceDataScope, input: CalendarIntegrationOperatorControl): Promise<CalendarIntegrationOperatorResult> {
    return this.operatorControl(scope, input, true);
  }

  /** @internal Pure closed-catalog compilation for a NEW actor request. Never
   * call this before looking up an original accepted actor receipt. No cell,
   * file, Jobs operation, policy write or mutable caller contract is admitted.
   */
  reactivationPolicy(scope: ServiceDataScope, ruleInput: string): CalendarIntegrationPolicySpec {
    this.assertIntake();
    if (this.state !== 'running') throw new CalendarError('CALENDAR_NOT_READY');
    const ruleId = calendarKey(ruleInput, 64), rule = this.rules.find(rule => rule.id === ruleId);
    if (!rule) throw new CalendarError('CALENDAR_NOT_READY');
    const owner = this.operatorOwner(scope);
    if (!owner) throw new CalendarError('CALENDAR_NOT_FOUND');
    return calendarObservationPolicy(owner, rule, this.options.pin(owner));
  }

  private operatorControl(scope: ServiceDataScope, input: CalendarIntegrationOperatorControl,
    reactivate: boolean): Promise<CalendarIntegrationOperatorResult> {
    try {
      this.assertIntake(); const selected = calendarIntegrationOperatorControl(input), owner = this.operatorOwner(scope);
      if (!owner) throw new CalendarError('CALENDAR_NOT_FOUND');
      const rule = this.rules.find(rule => rule.id === selected.ruleId);
      if (reactivate && (!rule || this.state !== 'running')) throw new CalendarError('CALENDAR_NOT_READY');
      const existing = this.existingCell(owner.owner); let started = false;
      const signal = AbortSignal.any([this.intakeStop.signal, ...(selected.signal ? [selected.signal] : [])]);
      // Share the retained controller and owner queue with startup/wake work.
      // Creating a second controller would create independent eligibility cells.
      return withoutLoggingAttribution(() => this.pinned(this.intake, owner.owner.id, existing, async (signal, pin) => {
        started = true;
        const cell = await this.cell(owner.owner); pin.attach(cell);
        const guard = () => {
          this.assertIntake(); signal.throwIfAborted();
          if (reactivate && this.state !== 'running') throw new CalendarError('CALENDAR_NOT_READY');
        };
        guard();
        try {
          await cell.owner.verify({ signal, assertCurrent: guard }); guard();
          if (!reactivate) {
            const result = await cell.controller.retire(selected.ruleId, { expected: selected.expected, signal });
            guard();
            cell.hydrated.set(selected.ruleId, 'retired:' + result.policy.id); cell.retiredRule = true;
            return { ruleId: selected.ruleId, selection: calendarIntegrationPolicySelection(result.policy),
              localState: result.policy.state, downstream: result.result === 'no-registration' ? 'never-registered' : 'retired',
              evidenceOwnerRequired: true } satisfies CalendarIntegrationOperatorResult;
          }
          const desired = calendarObservationPolicy(cell.owner, rule!, this.options.pin(cell.owner));
          const prepared = await cell.controller.prepare(desired, { expected: selected.expected, requireRetired: true, signal });
          guard();
          const result = await cell.controller.activate(selected.ruleId, { expected: calendarIntegrationPolicySelection(prepared), signal });
          guard();
          const active = result.policy.state === 'active' && result.result?.state === 'accepted';
          if (active) cell.hydrated.set(selected.ruleId, 'active:' + result.policy.id); else cell.hydrated.delete(selected.ruleId);
          cell.retiredRule = (await this.policies(cell)).some(policy => policy.state === 'retired');
          return { ruleId: selected.ruleId, selection: calendarIntegrationPolicySelection(result.policy), localState: result.policy.state,
            downstream: active ? 'active' : 'pending', evidenceOwnerRequired: true } satisfies CalendarIntegrationOperatorResult;
        } finally { this.mark(cell); }
      }, { key: 'calendar-owner:' + calendarHash(owner.owner.id), signal }).catch(error => {
        // Caller cancellation does not prove a dispatched source/Jobs command
        // rolled back. Inspection must reconcile it; never automatically replay.
        if (started && signal.aborted) throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
        throw error;
      }));
    } catch (error) { return Promise.reject(error); }
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
      const record = this.options.resolveOwner(scope);
      if (!record) throw new CalendarError('CALENDAR_STATE_INVALID');
      return withoutLoggingAttribution(() => this.pinned(this.evidence, record.id, undefined, async signal => {
        this.assertEvidence(); signal.throwIfAborted(); context.assertCurrentAuthority();
        const owner = this.options.owner(record);
        if (serviceDataScopeKey(owner.scope) !== serviceDataScopeKey(scope)) throw new CalendarError('CALENDAR_STATE_INVALID');
        await owner.verify({ signal });
        const intent = await owner.read<CalendarIntegrationIntentView | null>('calendar.integration.intent', { id }, { signal });
        if (!intent) throw new CalendarError('CALENDAR_FORBIDDEN');
        const jobs = this.bindJobs(owner, intent.policy, retiredGuards, signal);
        const originalGuard = context.assertCurrentAuthority;
        const execution = Object.freeze({ ...context, signal,
          assertCurrentAuthority: () => { this.assertEvidence(); signal.throwIfAborted(); originalGuard(); } });
        return observeCalendarIntegration({ owner, executions: jobs.executions, inspect: this.options.inspect, now: this.options.now,
          assertAdmissionCurrent: () => this.assertConfiguredPolicy(owner, intent.policy) }, execution);
      }, { key: 'calendar-evidence:' + calendarHash([serviceDataScopeKey(scope), id]), signal: AbortSignal.any([context.signal!, this.evidenceStop.signal]) }));
    } catch (error) { return Promise.reject(error); }
  }

  /** Runner-only read/attach lane. It never enters owner intake/controller
   * queues, installs capture, prepares controls or re-enters activate. The
   * caller's Jobs schedule gate may already be held. */
  hydrateSource(scope: ServiceDataScope, admission: JobAdmission, signal?: AbortSignal): Promise<boolean> {
    if (admission.definition !== CALENDAR_OBSERVATION_JOB.name) return Promise.resolve(false);
    try {
      this.assertIntake(); signal?.throwIfAborted();
      if (this.state !== 'running' && this.state !== 'starting' || this.demand.size >= this.maxOwners
        || admission.definitionVersion !== CALENDAR_OBSERVATION_JOB.version || admission.definitionHash !== CALENDAR_OBSERVATION_JOB.fingerprint
        || !admission.source || admission.scopeId !== serviceDataScopeKey(scope)) throw new JobsError('JOBS_NOT_READY');
      const input = normalizeCalendarObservationInput(admission.input), owner = this.operatorOwner(scope);
      if (!owner) throw new JobsError('JOBS_NOT_READY');
      const pin = this.pin(owner.owner.id);
      const operationSignal = signal ? AbortSignal.any([signal, this.intakeStop.signal]) : this.intakeStop.signal;
      const task = withoutLoggingAttribution(async () => {
        try {
          pin.start(); const cell = await this.cell(owner.owner); pin.attach(cell);
          const guard = () => { operationSignal.throwIfAborted(); this.assertCell(cell); cell.owner.assertCurrent(); };
          guard(); await cell.owner.verify({ signal: operationSignal, assertCurrent: guard }); guard();
          const read = { signal: operationSignal, assertCurrent: guard };
          const intent = await cell.owner.read<CalendarIntegrationIntentView | null>('calendar.integration.intent', { id: input.intentId }, read); guard();
          const rule = intent && this.rules.find(rule => rule.id === intent.ruleId);
          if (!intent || !rule || intent.appointmentRevision !== input.appointmentRevision || intent.policyEpoch !== input.policyEpoch
            || calendarHash(intent.input) !== calendarHash(admission.input)) throw new JobsError('JOBS_NOT_READY');
          const policy = (await this.policies(cell, read)).find(policy => policy.ruleId === rule.id); guard();
          if (!policy || policy.state !== 'active' || policy.epoch !== input.policyEpoch || calendarHash(intent.policy) !== calendarHash(policy.policy)
            || calendarHash(admission.workflow) !== calendarHash(policy.policy.source.workflow)) throw new JobsError('JOBS_NOT_READY');
          const assertDesired = () => {
            guard();
            const desired = calendarObservationPolicy(cell.owner, rule, this.options.pin(cell.owner));
            if (calendarHash(desired) !== calendarHash(policy.policy)) throw new JobsError('JOBS_NOT_READY');
          };
          assertDesired();
          const control = await cell.owner.read<CalendarIntegrationControlView | null>('calendar.integration.control',
            { ruleId: rule.id, epoch: policy.epoch, action: 'activate' }, read); guard(); assertDesired();
          const evidence = await cell.owner.read<CalendarIntegrationControlEvidence>('calendar.integration.controlEvidence', { ruleId: rule.id }, read); guard(); assertDesired();
          if (!control || control.result?.state !== 'accepted' || evidence.pending || control.epoch !== policy.epoch
            || calendarHash(control.policy) !== calendarHash(policy.policy) || !policy.registration || !intent.registration
            || calendarHash(policy.registration) !== calendarHash(control.result.registration)
            || calendarHash(intent.registration) !== calendarHash(control.result.registration)) throw new JobsError('JOBS_NOT_READY');
          const registration = control.result.registration;
          if (registration.state !== 'active' || registration.id !== admission.source!.id || registration.id !== jobSourceId(policy.policy.source.identity)
            || registration.generation !== admission.source!.generation || registration.policyHash !== admission.source!.policyHash
            || registration.policyHash !== calendarHash(policy.policy.source)) throw new JobsError('JOBS_NOT_READY');
          const binding = cell.controller.sourceBindingForHydration(policy, assertDesired);
          try {
            const jobs = binding.jobs;
            if (!jobs.hydration) throw new JobsError('JOBS_NOT_READY');
            const current = await jobs.registration.get(); guard(); assertDesired();
            if (calendarHash(current) !== calendarHash(registration)) throw new JobsError('JOBS_NOT_READY');
            await jobs.hydration.attach({ originalActivateKey: control.jobsKey, expectedRegistration: registration,
              pinInput: calendarObservationPinInput(policy.epoch), signal: operationSignal });
            guard(); assertDesired(); return true;
          } finally { binding.release(); }
        } catch (error) {
          try { this.hint(createDatabaseRef(owner.owner.id)); } catch { /* Retained dirty metadata/Jobs retry owns continuation. */ }
          if (error instanceof JobsError && error.code === 'JOBS_NOT_READY') throw error;
          throw new JobsError('JOBS_NOT_READY');
        } finally { pin.release(); }
      });
      this.demand.add(task); void task.then(() => { this.demand.delete(task); }, () => { this.demand.delete(task); });
      return task;
    } catch { return Promise.reject(new JobsError('JOBS_NOT_READY')); }
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
        ...this.cleanup,
        ...[...this.demand].map(task => task.then(() => undefined, () => undefined)),
        ...[...this.admissions.values()].map(value => value.task.then(() => undefined, () => undefined)),
      ]);
      const failures = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (wakeFailure) failures.push({ status: 'rejected', reason: wakeFailure });
      if (this.cleanupFailure) failures.push({ status: 'rejected', reason: this.cleanupFailure });
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
    while (this.demand.size || this.cleanup.size || this.admissions.size) await Promise.allSettled([...this.demand, ...this.cleanup, ...[...this.admissions.values()].map(value => value.task)]);
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
    const lifecycle = [...this.cells.values()].map(cell => ({ controller: cell.controller.diagnostics(), dispatcher: cell.dispatcher.diagnostics() }));
    // Catalog mode deliberately does not count every retained SYSTEM row on
    // diagnostic polling. Resident memory must never masquerade as that total.
    return { state: this.state, retainedOwners: this.options.wakeCatalog ? null : this.cells.size,
      residentOwners: this.cells.size, stagingOwners: this.admissions.size, maxOwners: this.maxOwners, scheduledAt: this.scheduled?.at ?? null,
      ...(this.options.wakeCatalog ? { catalogCoverage: this.options.wakeCatalog().coverage() } : {}),
      uncancelledWakeAt: this.uncancelledWake?.at ?? null,
      wakeFailure: this.wakeFailure, wakeActive: this.wakeTask !== null,
      readiness: this.readiness.status(), intake: this.intake.status(), evidence: this.evidence.status(),
      residency: { idleReleaseQualified: false as const,
        ownerActivity: this.ownerActivity.size,
        mode: this.options.wakeCatalog ? 'catalog' as const : 'standalone' as const, evictedOwners: this.evictedOwners,
        queued: [...this.cells.values()].reduce((sum, cell) => sum + cell.queued, 0),
        physical: [...this.cells.values()].reduce((sum, cell) => sum + cell.physical, 0),
        activeOwnerPins: this.ownerActivity.size, demand: this.demand.size, cleanup: this.cleanup.size, cleanupFailed: this.cleanupFailure !== undefined,
        sourceBindings: lifecycle.reduce((sum, cell) => sum + cell.controller.sourceBindings, 0),
        physicalControllerCallbacks: lifecycle.reduce((sum, cell) => sum + cell.controller.physicalCallbacks, 0),
        activeDispatchers: lifecycle.filter(cell => cell.dispatcher.active).length,
        unsettledUninvokedClaims: lifecycle.reduce((sum, cell) => sum + cell.dispatcher.unsettledUninvokedClaims.length, 0) },
      blockedOwners: [...this.cells.values()].filter(cell => cell.lastFailure || cell.retiredRule || cell.unselectedRule).map(cell => ({
        owner: calendarHash(cell.owner.owner.id), code: cell.lastFailure, retiredRule: cell.retiredRule, unselectedRule: cell.unselectedRule,
      })) };
  }

  private existingCell(record: CalendarOwnerRecord): OwnerCell | undefined {
    this.assertIntake();
    const old = this.cells.get(record.id);
    if (old) {
      if (calendarHash(old.owner.owner) !== calendarHash(record)) throw new CalendarError('CALENDAR_STATE_INVALID');
      this.assertCell(old);
    }
    return old;
  }
  private cell(record: CalendarOwnerRecord): Promise<OwnerCell> {
    try {
      const existing = this.existingCell(record); if (existing) return Promise.resolve(existing);
      if (!this.options.wakeCatalog) return Promise.resolve(this.publishCell(record));
      const hash = calendarHash(record), staged = this.admissions.get(record.id);
      if (staged) { if (staged.hash !== hash) throw new CalendarError('CALENDAR_STATE_INVALID'); return staged.task; }
      if (this.admissions.size >= this.maxOwners) throw new CalendarError('CALENDAR_NOT_READY');
      const task = Promise.resolve().then(async () => {
        try {
          const owner = this.options.owner(record), guard = () => { this.assertIntake(); owner.assertCurrent();
            if (calendarHash(owner.owner) !== hash) throw new CalendarError('CALENDAR_STATE_INVALID'); };
          guard(); const read = { signal: this.intakeStop.signal, assertCurrent: guard };
          await owner.verify(read); guard();
          const policies = await owner.read<CalendarIntegrationPolicyView[]>('calendar.integration.policies', {}, read); guard();
          this.policySourceIds(record, policies);
          const current = this.existingCell(record); if (current) return current;
          return this.publishCell(record, owner, policies);
        } catch (error) { await this.retryOwner(record); throw error; }
      });
      this.admissions.set(record.id, { hash, task });
      void task.then(() => { if (this.admissions.get(record.id)?.task === task) this.admissions.delete(record.id); },
        () => { if (this.admissions.get(record.id)?.task === task) this.admissions.delete(record.id); });
      return task;
    } catch (error) { return Promise.reject(error); }
  }
  private publishCell(record: CalendarOwnerRecord, admittedOwner?: CalendarIntegrationOwner, policies?: CalendarIntegrationPolicyView[]): OwnerCell {
    this.assertIntake();
    if (this.cleanupFailure) throw new CalendarError('CALENDAR_NOT_READY');
    if (this.cells.size >= this.maxOwners && (!this.options.wakeCatalog || !this.evictIdle())) throw new CalendarError(this.options.wakeCatalog ? 'CALENDAR_NOT_READY' : 'CALENDAR_CAPACITY');
    if (record.established !== 1) throw new CalendarError('CALENDAR_NOT_READY');
    const owner = admittedOwner ?? this.options.owner(record); owner.assertCurrent();
    if (calendarHash(owner.owner) !== calendarHash(record)) throw new CalendarError('CALENDAR_STATE_INVALID');
    let cell!: OwnerCell;
    const controller = new CalendarIntegrationPolicyController({ owner, now: this.options.now,
      jobs: (policy, guards) => this.bindJobs(owner, policy, {
        assertEligible: () => { this.assertCell(cell); guards.assertEligible(); },
        confirmEligible: async () => { this.assertCell(cell); await guards.confirmEligible(); this.assertCell(cell); },
      }, owner.signal) });
    const dispatcher = new CalendarIntegrationDispatcher({ store: owner, batchSize: this.batchSize, now: this.options.now,
      onFailure: code => this.report(code), jobs: intent => {
        // Historical control/evidence lookups must never replace the selected
        // controller's exact capability with an ineligible transient handle.
        return controller.sourceBinding(intent.ruleId, calendarHash(intent.policy))
          ?? this.bindJobs(owner, intent.policy, retiredGuards, owner.signal);
      } });
    cell = { owner, controller, dispatcher, hydrated: new Map(), ready: null, generation: ++this.generation, phase: 'open', queued: 0, physical: 0,
      sourceIds: new Set([...this.rules.map(rule => this.sourceId(record, rule.id)), ...(policies ? this.policySourceIds(record, policies) : [])]), inventoryRead: !!policies,
      revision: 0, nextWakeAt: this.time(), lastFailure: null, retiredRule: false, unselectedRule: false };
    this.cells.set(record.id, cell); this.refs.set(createDatabaseRef(record.id), cell); return cell;
  }
  private assertCell(cell: OwnerCell): void {
    this.assertIntake();
    if (cell.phase !== 'open' || this.cells.get(cell.owner.owner.id) !== cell) throw new CalendarError('CALENDAR_NOT_READY');
  }
  /** No await/callback after the native batch succeeds and before exact removal. */
  private evictIdle(): boolean {
    if (this.evicting) return false;
    this.evicting = true;
    try {
      for (const cell of this.cells.values()) {
        const controller = cell.controller.diagnostics(), dispatcher = cell.dispatcher.diagnostics();
        if (cell.phase !== 'open' || !cell.inventoryRead || cell.ready || cell.queued || cell.physical || this.ownerActivity.has(cell.owner.owner.id)
          || controller.physicalCallbacks || controller.pool.active || controller.pool.queued || dispatcher.active
          || dispatcher.wakeQueued || dispatcher.wakeAgain || dispatcher.unsettledUninvokedClaims.length) continue;
        cell.phase = 'evicting';
        try {
          const handles = cell.controller.sourceBindings().map(binding => binding.jobs);
          if (this.options.jobs.tryDetachSources!(handles, [...cell.sourceIds]) !== 'detached') continue;
          this.cells.delete(cell.owner.owner.id); this.refs.delete(createDatabaseRef(cell.owner.owner.id));
          cell.phase = 'detached'; this.evictedOwners++;
          this.cleanupCell(cell); return true;
        } catch { /* Failed owner proof is not authority to remove this cell. */ }
        finally { if (cell.phase === 'evicting') cell.phase = 'open'; }
      }
      return false;
    } finally { this.evicting = false; }
  }
  private cleanupCell(cell: OwnerCell): void {
    const task = (async () => {
      const outcomes = await Promise.allSettled([cell.controller.close(), cell.dispatcher.close()]);
      const failures = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Calendar idle cleanup did not settle.');
      await cell.controller.drainPhysical();
    })();
    this.cleanup.add(task);
    void task.then(() => { this.cleanup.delete(task); }, error => { this.cleanup.delete(task); this.cleanupFailure ??= error; });
  }
  /** A queued pin transfers to the actual callback, never its cancelled caller. */
  private pinned<T>(pool: WorkPool, ownerId: string, cell: OwnerCell | undefined, work: (signal: AbortSignal, pin: OwnerPin) => Promise<T>,
    options: { readonly key: string; readonly signal: AbortSignal }): Promise<T> {
    const pin = this.pin(ownerId, cell); let started = false;
    try {
      return pool.run(async signal => {
        started = true;
        try { pin.start(); return await work(signal, pin); } finally { pin.release(); }
      }, options).finally(() => { if (!started) pin.release(); });
    } catch (error) { pin.release(); return Promise.reject(error); }
  }
  private pin(ownerId: string, cell?: OwnerCell): OwnerPin {
    if (this.cells.get(ownerId)?.phase === 'evicting') throw new CalendarError('CALENDAR_NOT_READY');
    if (cell) this.assertCell(cell);
    this.ownerActivity.set(ownerId, (this.ownerActivity.get(ownerId) ?? 0) + 1);
    if (cell) cell.queued++;
    let phase: 'queued' | 'active' | 'released' = 'queued';
    return {
      attach: next => {
        if (cell === next) return;
        if (cell || phase === 'released' || next.owner.owner.id !== ownerId) throw new CalendarError('CALENDAR_NOT_READY');
        this.assertCell(next); cell = next;
        if (phase === 'queued') cell.queued++; else cell.physical++;
      },
      start: () => {
        if (phase !== 'queued') throw new CalendarError('CALENDAR_NOT_READY');
        phase = 'active'; if (cell) { cell.queued--; cell.physical++; this.assertCell(cell); }
      },
      release: () => {
        if (phase === 'released') return;
        if (cell) { if (phase === 'queued') cell.queued--; else cell.physical--; }
        phase = 'released'; const count = (this.ownerActivity.get(ownerId) ?? 1) - 1;
        if (count) this.ownerActivity.set(ownerId, count); else this.ownerActivity.delete(ownerId);
      },
    };
  }
  private operatorOwner(scope: ServiceDataScope): CalendarIntegrationOwner | null {
    if (!scope || (scope.scopeKind === 'application' ? scope.scopeId !== 'application' || scope.tenantId !== null
      : scope.scopeKind !== 'tenant' || typeof scope.tenantId !== 'string' || !scope.tenantId || scope.scopeId !== scope.tenantId)) {
      throw new CalendarError('CALENDAR_FORBIDDEN');
    }
    const record = this.options.resolveOwner(scope);
    if (!record || record.established !== 1) return null;
    const owner = this.options.owner(record); owner.assertCurrent();
    if (calendarHash(owner.owner) !== calendarHash(record) || serviceDataScopeKey(owner.scope) !== serviceDataScopeKey(scope)) throw new CalendarError('CALENDAR_STATE_INVALID');
    return owner;
  }
  private run<T>(cell: OwnerCell, work: () => Promise<T>): Promise<T> {
    return withoutLoggingAttribution(() => this.pinned(this.intake, cell.owner.owner.id, cell, async signal => { signal.throwIfAborted(); this.assertIntake(); return work(); },
      { key: 'calendar-owner:' + calendarHash(cell.owner.owner.id), signal: this.intakeStop.signal }));
  }
  private async prepare(cell: OwnerCell, strict: boolean): Promise<void> {
    cell.retiredRule = false;
    const retained = await this.policies(cell);
    cell.unselectedRule = retained.some(policy => policy.state !== 'retired' && !this.rules.some(rule => rule.id === policy.ruleId));
    if (cell.unselectedRule) throw new CalendarError('CALENDAR_NOT_READY');
    for (const rule of this.rules) {
      const current = retained.find(policy => policy.ruleId === rule.id);
      if (current?.state === 'retired') {
        cell.retiredRule = true;
        // Retirement disables capture, not ordinary Calendar writes. Preserve
        // the physical readiness proof above without implicitly reactivating.
        continue;
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
    let refreshRevision: number | null = null;
    let controlRule: string | null = null, verified = false, dispatching = false, localFailure = false;
    cell.lastFailure = null;
    try {
      await cell.owner.verify({ signal: this.intakeStop.signal }); this.assertIntake(); verified = true;
      const policies = await this.policies(cell);
      cell.unselectedRule = policies.some(policy => policy.state !== 'retired' && !this.rules.some(rule => rule.id === policy.ruleId));
      cell.retiredRule = policies.some(policy => policy.state === 'retired');
      // Removed configuration is not authority to revive or retire an old
      // source. Original-key evidence and explicit retirement still progress;
      // capture preparation waits for review while other configured controls
      // and previously accepted work retain their independent progress.
      let pending = false;
      for (const policy of policies) {
        const proof = await cell.owner.read<CalendarIntegrationControlEvidence>('calendar.integration.controlEvidence', { ruleId: policy.ruleId });
        const key = (policy.state === 'retired' ? 'retired:' : 'active:') + policy.id;
        if (cell.hydrated.get(policy.ruleId) === key && !proof.pending) continue;
        controlRule = policy.ruleId;
        if (policy.state === 'retired') {
          await cell.controller.retire(policy.ruleId); cell.hydrated.set(policy.ruleId, key); controlRule = null; continue;
        }
        if (!this.rules.some(rule => rule.id === policy.ruleId)) {
          try { await cell.controller.reconcileRetained(policy.ruleId); }
          catch (error) {
            // A durably backed-off removed control must not starve a later
            // configured rule. Unjournaled/owner failures still stop the pass.
            const retry = await cell.owner.read<CalendarIntegrationControlEvidence>('calendar.integration.controlEvidence', { ruleId: policy.ruleId });
            if (!retry.pending?.lastFailure || retry.pending.nextAttemptMs <= this.time()) throw error;
            cell.lastFailure = code(error); this.report(cell.lastFailure);
          }
          controlRule = null; continue;
        }
        // Every pass checks pending original controls, not just initial startup.
        // A local retirement preserves policy.id, so cache state is essential.
        const result = await cell.controller.activate(policy.ruleId); controlRule = null;
        if (result.policy.state === 'active' && result.result?.state === 'accepted') cell.hydrated.set(policy.ruleId, 'active:' + result.policy.id);
        else pending = true;
      }
      if (cell.unselectedRule) {
        cell.lastFailure = 'CALENDAR_NOT_READY'; this.report(cell.lastFailure);
        dispatching = true; await cell.dispatcher.runBatch(); dispatching = false; return;
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
      if (verified && controlRule && !dispatching) try {
        // The first thrown activation failure needs this pass too, not just a
        // later returned-backoff result. No source lease crosses this Jobs wait.
        await cell.dispatcher.runBatch();
      } catch (dispatchError) { localFailure = true; cell.lastFailure = code(dispatchError); this.report(cell.lastFailure); }
    } finally {
      if (this.state !== 'quiescing' && this.state !== 'closed') {
        try {
          if (this.options.refreshWake) {
            const failure = localFailure || cell.unselectedRule ? {
              classification: cell.unselectedRule || cell.lastFailure === 'JOBS_AUTHORITY_RETIRED'
                || cell.lastFailure === 'JOBS_DEFINITION_UNAVAILABLE' ? 'review' as const : 'retry' as const,
              nextWakeAt: this.time() + RETRY_MS,
            } : undefined;
            refreshRevision = cell.revision;
            const nextWakeAt = await this.options.refreshWake(cell.owner.owner, failure);
            cell.nextWakeAt = nextWakeAt === null ? null : calendarInteger(nextWakeAt, 0, 8_640_000_000_000_000);
          } else {
            const wake = await cell.owner.read<{ nextWakeAt: number | null }>('calendar.integration.nextWake', {});
            if (!wake || wake.nextWakeAt !== null && !Number.isSafeInteger(wake.nextWakeAt)) throw new CalendarError('CALENDAR_STATE_INVALID');
            cell.nextWakeAt = wake.nextWakeAt === null ? null : calendarInteger(wake.nextWakeAt, 0, 8_640_000_000_000_000);
          }
          // An unjournaled owner/read/pin refusal must neither sleep until an
          // unrelated accepted expiry nor spin an unprocessable ready-at-now
          // row. Back this owner off locally; durable control failures retain
          // their exact source deadline and independently progressing dispatch.
          if (localFailure) cell.nextWakeAt = this.time() + RETRY_MS;
        } catch (error) { localFailure = true; cell.lastFailure = code(error); this.report(cell.lastFailure); cell.nextWakeAt = this.time() + RETRY_MS; }
        // The native query/CAS covers this pass's own writes. Only hints arriving
        // during its final refresh can race publication/return to this RAM wake
        // owner. Comparing to pass start would make every empty claim spin.
        const observedRevision = this.options.refreshWake ? refreshRevision : revision;
        if (!localFailure && observedRevision !== null && cell.revision !== observedRevision) cell.nextWakeAt = Math.min(cell.nextWakeAt ?? Infinity, this.time());
      }
    }
  }
  private async policies(cell: OwnerCell, options?: CalendarIntegrationReadOptions): Promise<CalendarIntegrationPolicyView[]> {
    const policies = await cell.owner.read<CalendarIntegrationPolicyView[]>('calendar.integration.policies', {}, options);
    for (const id of this.policySourceIds(cell.owner.owner, policies)) cell.sourceIds.add(id);
    cell.inventoryRead = true;
    return policies;
  }
  private policySourceIds(owner: CalendarOwnerRecord, policies: CalendarIntegrationPolicyView[]): string[] {
    if (!Array.isArray(policies) || policies.length > CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_STATE_INVALID');
    const ids: string[] = [];
    for (const policy of policies) {
      const id = this.sourceId(owner, policy.ruleId);
      if (policy.policy.ruleId !== policy.ruleId || jobSourceId(policy.policy.source.identity) !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
      ids.push(id);
    }
    return ids;
  }
  private sourceId(owner: CalendarOwnerRecord, ruleId: string): string {
    return jobSourceId({ domain: 'calendar.' + calendarHash(['observation-rule-v1', calendarKey(ruleId, 64)]).slice(0, 55),
      databaseId: owner.id, ownerId: owner.owner_id, rootHash: owner.root_hash, scopeId: owner.scope_id });
  }
  /** Code configuration fences fresh work only. Retained facts keep their
   * independent owner/authority lifetime, including qualified older realms.
   */
  private assertConfiguredPolicy(owner: CalendarIntegrationOwner, policy: CalendarIntegrationPolicySpec): void {
    this.assertEvidence(); owner.assertCurrent();
    const rule = this.rules.find(rule => rule.id === policy.ruleId);
    if (!rule) throw new JobsError('JOBS_AUTHORITY_RETIRED');
    const desired = calendarObservationPolicy(owner, rule, this.options.pin(owner));
    const compatible = { ...desired, source: { ...desired.source, realmFingerprint: policy.source.realmFingerprint } };
    if (calendarHash(compatible) !== calendarHash(policy)) throw new JobsError('JOBS_AUTHORITY_RETIRED');
  }
  private bindJobs(owner: CalendarIntegrationOwner, input: CalendarIntegrationPolicySpec,
    guards: CalendarIntegrationEligibilityGuards, signal: AbortSignal): SourceJobs {
    // The current physical owner proof is independent of an immutable receipt's
    // original schema identity. Retained source contracts may name a qualified
    // older native realm; new installation STILL requires the current realm at
    // calendarIntegrationInput. Never rewrite the old policy or Jobs receipt.
    if (input.source.realmFingerprint !== owner.owner.realm_fingerprint
      && !isCalendarIntegrationHistoricalRealmFingerprint(input.source.realmFingerprint)) throw new CalendarError('CALENDAR_STATE_INVALID');
    const expected = calendarObservationPolicy(owner, { id: input.ruleId, version: input.ruleVersion,
      dueOffsetMs: input.dueOffsetMs, maxLatenessMs: input.maxLatenessMs }, input.source.workflow);
    const historical = { ...expected, source: { ...expected.source, realmFingerprint: input.source.realmFingerprint } };
    // All other native identity/catalog/timing/semantics facts remain exact.
    if (calendarHash(historical) !== calendarHash(input)) throw new CalendarError('CALENDAR_STATE_INVALID');
    const capability = createTrustedJobSource({ ...input.source, scope: owner.scope, definition: CALENDAR_OBSERVATION_JOB,
      signal: AbortSignal.any([owner.signal, signal, this.evidenceStop.signal]),
      assertOwnerCurrent: () => { this.assertEvidence(); owner.assertCurrent(); },
      confirmOwnerCurrent: async () => { this.assertEvidence(); await owner.verify(); this.assertEvidence(); },
      assertEligible: () => {
        if (this.state !== 'running' && this.state !== 'starting') throw new JobsError('JOBS_AUTHORITY_RETIRED');
        // Membership permits original configured-rule A control recovery before
        // desired B preparation. It does not grant B's fresh effect cutoff;
        // observeCalendarIntegration separately fences the exact desired pin.
        if (!this.rules.some(rule => rule.id === input.ruleId)) throw new JobsError('JOBS_AUTHORITY_RETIRED');
        guards.assertEligible();
      },
      confirmEligible: async () => { await guards.confirmEligible(); },
    });
    return this.options.jobs.forSource(capability);
  }
  private mark(cell: OwnerCell): void {
    if (this.options.wakeCatalog) { this.hint(createDatabaseRef(cell.owner.owner.id)); return; }
    cell.revision++; cell.nextWakeAt = this.time();
    if (this.state !== 'running') return;
    if (this.wakeTask) return;
    try { this.arm(); } catch (error) { cell.lastFailure = code(error); }
  }
  private arm(): void {
    if (this.state !== 'running' || !this.scheduler) return;
    try {
      const now = this.time(), catalog = this.options.wakeCatalog?.();
      const next = catalog ? catalog.nextWakeAt(now) ?? Infinity : Math.min(...[...this.cells.values()].map(cell => cell.nextWakeAt ?? Infinity));
      if (!Number.isFinite(next)) { this.cancelWake(); this.wakeFailure = null; return; }
      const scanning = catalog && (!catalog.coverage().complete || catalog.coverage().turnHorizon !== null);
      const at = Math.max(now, next, catalog && !scanning ? this.catalogRetryAt ?? 0 : 0);
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
    if (this.options.wakeCatalog) { await this.catalogPass(); return; }
    const now = this.time();
    await Promise.all([...this.cells.values()].filter(cell => cell.nextWakeAt !== null && cell.nextWakeAt <= now)
      .map(cell => this.run(cell, () => this.process(cell))));
  }
  /** One bounded SYSTEM page/turn. Never enumerates physical files or retains
   * all owners. Persistent cursor advancement precedes private work, so a
   * failed prefix cannot starve later owners after restart. */
  private async catalogPass(): Promise<void> {
    this.assertIntake(); const catalog = this.options.wakeCatalog!();
    let coverage = catalog.coverage();
    if (coverage.configurationGeneration === 0) throw new CalendarError('CALENDAR_NOT_READY');
    if (!coverage.complete) coverage = await catalog.seedPage({ generation: coverage.configurationGeneration, now: this.time(), limit: 100 },
      { signal: this.intakeStop.signal, assertCurrent: () => this.assertIntake() });
    this.assertIntake();
    const page = await catalog.takeDuePage({ now: this.time(), limit: Math.min(this.batchSize, this.maxOwners) },
      { signal: this.intakeStop.signal, assertCurrent: () => this.assertIntake() });
    this.assertIntake();
    await Promise.all(page.owners.map(async entry => {
      try {
        await this.pinned(this.intake, entry.owner.id, this.existingCell(entry.owner), async (signal, pin) => {
          signal.throwIfAborted(); const cell = await this.cell(entry.owner); pin.attach(cell);
          await this.process(cell);
          if (cell.nextWakeAt !== null && cell.nextWakeAt <= this.time()) this.catalogRetryAt = this.time() + RETRY_MS;
        }, { key: 'calendar-owner:' + calendarHash(entry.owner.id), signal: this.intakeStop.signal });
      } catch (error) {
        // Cancellation of a started intake callback is not proof that an
        // adjacent Jobs writer rolled back. Preserve its original uncertainty
        // for the lifecycle owner; do not replace it with a later readiness error.
        if (this.state === 'quiescing' || this.state === 'closed') throw error;
        this.report(code(error)); await this.retryOwner(entry.owner);
      }
    }));
  }
  private async retryOwner(record: CalendarOwnerRecord): Promise<void> {
    if (!this.options.wakeCatalog || this.state === 'quiescing' || this.state === 'closed') return;
    this.catalogRetryAt = this.time() + RETRY_MS;
    try { await this.options.refreshWake!(record, { classification: 'retry', nextWakeAt: this.catalogRetryAt }); }
    catch { /* Dirty metadata is retained; local floor prevents busy recursion. */ }
    if (this.state === 'running' && !this.wakeTask) try { this.arm(); } catch { /* Wake failure remains explicit/restartable in diagnostics. */ }
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
