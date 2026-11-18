/** Internal native-service facade over the SAME Jobs runner, pool and Torrent receipts. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { WorkPool } from '../workers/work-pool';
import { SchedulerError } from '../scheduler/scheduler-error';
import type { WorkflowDeferredStartBridge } from '../workflows/workflow-deferred-start-bridge';
import { assertJobExecutionIdentity, jobBinding, jobDispatchKey } from './admission';
import type { ResolvedJobsConfig } from './config';
import { JobsError } from './error';
import { normalizeJobAdmission, type JobAdmission, type JobScheduleRow } from './model';
import { jobGateKey } from './runner';
import type { JobsRuntime } from './runtime';
import { normalizeScheduleTiming } from './schedule-time';
import { assertJobSourceEligible, assertJobSourceOwner, confirmJobSource, requireJobSource, type TrustedJobSource } from './source-authority';
import { jobSourceId, jobSourcePrincipal, jobSourceScheduleId, normalizeJobSourceContract, normalizeJobSourceInitiator,
  type JobSourceContract, type JobSourceExecutionEvidence, type JobSourceRegistration, type JobSourceScheduleReceipt } from './source-model';
import type { JobSourceExecutionContext } from './realm-source-queries';
import { jobDigest, jobHash, jobInput, jobInteger, jobKey, jobRecord, jobText, jobTime } from './validation';
import { isKnownJobMutationRejection, sourceGateMutation } from './source-gate';

interface SourceOptions { readonly idempotencyKey: string; readonly signal?: AbortSignal }
interface SourceScheduleOptions extends SourceOptions {
  /** Optional immutable source-epoch mapping. Historical command replay still precedes this fence. */
  readonly expectedRegistration?: JobSourceRegistration;
}
interface SourceRevisionOptions extends SourceOptions { readonly expectedRevision: number }
interface SourceScheduleRevisionOptions extends SourceScheduleOptions { readonly expectedRevision: number }
export interface SourceJobInput { readonly input: unknown; readonly at: string; readonly maxLatenessMs?: number; readonly initiatedBy?: string }
/** Private evidence/control surface; it is not a request API or an alternative general scheduler. */
export interface SourceJobs {
  readonly registration: {
    get(): Promise<JobSourceRegistration | null>;
    activate(options: SourceRevisionOptions & { readonly pinInput: unknown }): Promise<JobSourceRegistration>;
    retire(options: SourceRevisionOptions): Promise<JobSourceRegistration>;
  };
  readonly receipts: { get(key: string): Promise<JobSourceRegistration | JobSourceScheduleReceipt | null> };
  readonly executions: {
    /** Exact permanent Torrent evidence, including before Jobs acknowledges dispatch. Never reauthorizes an effect. */
    get(id: string, options: { readonly generation: number; readonly scheduledAt: number }): Promise<JobSourceExecutionEvidence | null>;
  };
  readonly schedules: {
    create(input: SourceJobInput, options: SourceScheduleOptions): Promise<JobSourceScheduleReceipt>;
    replace(id: string, input: SourceJobInput, options: SourceScheduleRevisionOptions): Promise<JobSourceScheduleReceipt>;
    cancel(id: string, options: SourceRevisionOptions): Promise<JobSourceScheduleReceipt>;
    get(id: string): Promise<{ schedule: JobScheduleRow; admission: JobAdmission; receipt: JobSourceScheduleReceipt }>;
  };
}
interface Options {
  readonly config: ResolvedJobsConfig; readonly runtime: JobsRuntime; readonly bridge: WorkflowDeferredStartBridge;
  readonly gate: WorkPool; readonly signal: AbortSignal; readonly now: () => number; readonly wake: () => void;
}
interface LiveBinding {
  readonly source: TrustedJobSource; readonly contract: JobSourceContract; readonly registration: JobSourceRegistration;
  quiescedBy?: ActivationToken;
}
interface RetirementFence { readonly signal: AbortSignal; active: boolean }
interface ActivationToken { readonly expectedRevision: number; retired: boolean; readonly retirements: Set<RetirementFence> }
export class JobsSourceBroker {
  private readonly live = new Map<string, LiveBinding>();
  private readonly pendingActivations = new Map<string, Set<ActivationToken>>();
  private pendingActivationCount = 0;
  private pendingRetirementCount = 0;
  private closed = false;
  constructor(private readonly options: Options) {}
  close(): void {
    this.closed = true; this.live.clear();
    for (const pending of this.pendingActivations.values()) for (const token of pending) token.retired = true;
  }
  forSource(capability: TrustedJobSource): SourceJobs {
    const source = requireJobSource(capability), id = jobSourceId(source.identity);
    const signal = (supplied?: AbortSignal) => AbortSignal.any([this.options.signal, source.signal, ...(supplied ? [supplied] : [])]);
    const guard = () => { this.assertReady(); this.options.bridge.assertRuntimeCurrent(); assertJobSourceOwner(source); };
    const confirm = async (eligible = false) => { guard(); await confirmJobSource(source, eligible); guard(); };
    const read = async <T>(name: string, input: unknown): Promise<T> => {
      await confirm(); const value = await this.options.runtime.readExisting<T>(source.scope, name, input, guard, signal()); await confirm(); return value as T;
    };
    const receipt = <T>(key: string, intent?: unknown) => read<T | null>('jobs.source.receipt', { identity: source.identity, requestId: jobKey(key),
      ...(intent === undefined ? {} : { intentDigest: jobHash(intent) }) });
    const write = async <T>(name: string, input: unknown, operation: { signal: AbortSignal; markWriteAttempted(): void }, eligible: boolean,
      fence: () => void = () => {}, beforeWrite: () => void = () => {}): Promise<T> => {
      const operationSignal = operation.signal;
      const check = () => { guard(); operationSignal.throwIfAborted(); if (eligible) assertJobSourceEligible(source); fence(); };
      check(); operation.markWriteAttempted(); beforeWrite();
      const writer = name === 'jobs.source.register' ? this.options.runtime.write.bind(this.options.runtime) : this.options.runtime.writeExisting.bind(this.options.runtime);
      const value = await writer<T>(source.scope, name, input, crypto.randomUUID(), check, operationSignal);
      try { await confirm(eligible); operationSignal.throwIfAborted(); } catch { throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
      this.options.wake(); return value;
    };
    const current = () => this.requireLive(capability, id);
    const normalizeOptions = (input: unknown, revision: boolean, pin = false, mapping = false) => {
      const r = jobRecord(input, ['idempotencyKey', 'signal', ...(revision ? ['expectedRevision'] : []), ...(pin ? ['pinInput'] : []), ...(mapping ? ['expectedRegistration'] : [])]);
      if (r.signal !== undefined && !(r.signal instanceof AbortSignal)) throw new JobsError('JOBS_INPUT_INVALID');
      return { key: jobKey(r.idempotencyKey), signal: signal(r.signal as AbortSignal | undefined),
        expectedRevision: revision ? jobInteger(r.expectedRevision, 0) : 0, pinInput: r.pinInput,
        expectedRegistration: r.expectedRegistration === undefined ? undefined : expectedSourceRegistration(r.expectedRegistration) };
    };
    const change = async (action: 'create' | 'readmit', suppliedId: string | undefined, input: unknown, options: unknown) => {
      const opts = normalizeOptions(options, action !== 'create', false, true), r = jobRecord(input, ['input', 'at', 'maxLatenessMs', 'initiatedBy']);
      if (action !== 'create') jobInteger(opts.expectedRevision, 1);
      const timing = sourceScheduleTiming({ kind: 'once', at: r.at, maxLatenessMs: r.maxLatenessMs ?? 60_000 });
      const value = jobInput(r.input), initiatedBy = normalizeJobSourceInitiator(r.initiatedBy);
      const scheduleId = action === 'create' ? jobSourceScheduleId(source.identity, opts.key) : jobText(suppliedId, 96);
      const intentHash = jobHash(['once', id, source.policyVersion, source.semanticsVersion,
        { name: source.definition.name, version: source.definition.version, fingerprint: source.definition.fingerprint }, value, timing, initiatedBy ?? null]);
      const intent = action === 'create' ? ['create', intentHash] : ['change', scheduleId, opts.expectedRevision, 'readmit', intentHash];
      return sourceGateMutation(this.options.gate, async operation => {
        await confirm(); const prior = await receipt<JobSourceScheduleReceipt>(opts.key, intent); operation.signal.throwIfAborted(); if (prior) return prior;
        await confirm(true); const live = current();
        const assertMapped = () => {
          if (opts.expectedRegistration && !sameSourceRegistration(live.registration, opts.expectedRegistration)) throw new JobsError('JOBS_AUTHORITY_RETIRED');
        };
        assertMapped();
        const previous = action === 'create' ? null : await read<{ schedule: JobScheduleRow }>('jobs.source.schedule', { identity: source.identity, id: scheduleId });
        if (previous && previous.schedule.revision !== opts.expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
        const generation = previous ? jobInteger(previous.schedule.generation, 1, Number.MAX_SAFE_INTEGER - 1) + 1 : 1;
        const definition = this.options.config.catalog.resolve(source.definition);
        if (definition.origin === 'request') throw new JobsError('JOBS_FORBIDDEN');
        const parsed = definition.parseInput(value);
        const authority = this.options.bridge.system({ principal: jobSourcePrincipal(id), reason: 'Source-owned scheduled Zero job', scope: source.scope });
        const pin = this.options.bridge.pin(authority, definition.workflow.name, parsed, definition.workflow.version);
        if (jobHash(pin) !== jobHash(live.contract.workflow)) throw new JobsError('JOBS_DEFINITION_UNAVAILABLE');
        const admission = normalizeJobAdmission({ id: scheduleId, scopeId: source.identity.scopeId, actorId: null, principal: null,
          source: { id, generation: live.registration.generation, policyHash: live.registration.policyHash },
          ...(initiatedBy === undefined ? {} : { initiatedBy }), definition: definition.name, definitionVersion: definition.version,
          definitionHash: definition.fingerprint, workflow: pin, input: parsed, timing, overlap: 'skip', runAs: 'service' });
        const seal = this.options.bridge.seal(authority, jobBinding(admission, generation));
        const check = () => { if (this.requireLive(capability, id) !== live) throw new JobsError('JOBS_AUTHORITY_RETIRED'); assertMapped(); };
        check();
        // Use the live token as the final Jobs writer fence too. No source SQL
        // lease is held while waiting for this separate-file commit.
        const fencedSignal = operation.signal;
        operation.markWriteAttempted();
        const result = await this.options.runtime.writeExisting<JobSourceScheduleReceipt>(source.scope,
          action === 'create' ? 'jobs.source.schedule.create' : 'jobs.source.schedule.change', {
            identity: source.identity, requestId: opts.key, admission, seal, intentHash, now: this.options.now(),
            ...(action === 'create' ? {} : { id: scheduleId, expectedRevision: opts.expectedRevision, action: 'readmit' }),
          }, crypto.randomUUID(), () => { guard(); fencedSignal.throwIfAborted(); check(); }, fencedSignal);
        try { await confirm(true); check(); fencedSignal.throwIfAborted(); } catch { throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
        this.options.wake(); return result;
      }, { key: jobGateKey(source.scope, scheduleId), signal: opts.signal });
    };
    return Object.freeze({
      registration: Object.freeze({
        get: () => read<JobSourceRegistration | null>('jobs.source', { identity: source.identity }),
        activate: async (input: SourceRevisionOptions & { pinInput: unknown }) => {
          const opts = normalizeOptions(input, true, true), token = this.beginActivation(id, opts.expectedRevision);
          try {
            await confirm(true);
            const definition = this.options.config.catalog.resolve(source.definition);
            if (definition.origin === 'request') throw new JobsError('JOBS_FORBIDDEN');
            const parsed = definition.parseInput(opts.pinInput);
            const authority = this.options.bridge.system({ principal: jobSourcePrincipal(id), reason: 'Source-owned scheduled Zero job', scope: source.scope });
            const contract = normalizeJobSourceContract({ identity: source.identity, realmFingerprint: source.realmFingerprint,
              policyVersion: source.policyVersion, semanticsVersion: source.semanticsVersion,
              definition: { name: definition.name, version: definition.version, fingerprint: definition.fingerprint },
              workflow: this.options.bridge.pin(authority, definition.workflow.name, parsed, definition.workflow.version) });
            return await sourceGateMutation(this.options.gate, async operation => {
              await confirm(true);
              this.assertActivationCurrent(token);
              if (!this.live.has(id) && this.live.size >= 1024) throw new JobsError('JOBS_CAPACITY');
              const old = this.live.get(id);
              const prior = await receipt<JobSourceRegistration>(opts.key, ['register', contract, opts.expectedRevision]);
              if (!prior) {
                const selected = await read<JobSourceRegistration | null>('jobs.source', { identity: source.identity });
                if ((selected?.revision ?? 0) !== opts.expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
              }
              const activationFence = () => this.assertActivationCurrent(token);
              let result: JobSourceRegistration;
              try {
                result = prior ?? await write<JobSourceRegistration>('jobs.source.register', { contract, expectedRevision: opts.expectedRevision,
                  requestId: opts.key, now: this.options.now() }, operation, true, activationFence,
                  () => {
                    activationFence();
                    // Keep the observed current CAS epoch while handoff is
                    // quiesced. Absence loses the distinction between a current
                    // retirement and a historical receipt retry.
                    if (old && jobHash(old.contract) !== jobHash(contract)) old.quiescedBy = token;
                  });
              } catch (error) {
                // Only a proved rejection may restore the prior live binding.
                // An uncertain write may already have advanced its durable epoch.
                if (isKnownJobMutationRejection(error) && old?.quiescedBy === token) delete old.quiescedBy;
                throw error;
              }
              // A replay is historical evidence, not permission to revive an old
              // generation after A -> B -> A or a durable retirement.
              try {
                const selected = await read<JobSourceRegistration | null>('jobs.source', { identity: source.identity });
                await confirm(true); operation.signal.throwIfAborted();
                activationFence();
                if (!selected || selected.state !== 'active'
                  || selected.generation !== result.generation || selected.revision !== result.revision || selected.policyHash !== jobHash(contract)) throw new JobsError('JOBS_AUTHORITY_RETIRED');
                if (!this.live.has(id) && this.live.size >= 1024) throw new JobsError('JOBS_CAPACITY');
                if (!old || old.quiescedBy || old.source !== capability || old.registration.generation !== selected.generation || old.registration.revision !== selected.revision
                  || old.registration.policyHash !== selected.policyHash) this.live.set(id, { source: capability, contract, registration: selected });
                this.options.wake(); return result;
              } catch (error) { if (!prior) throw new JobsError('JOBS_OUTCOME_UNKNOWN'); throw error; }
            }, { key: sourceGateKey(id), signal: opts.signal });
          } finally { this.endActivation(id, token); }
        },
        retire: async (input: SourceRevisionOptions) => {
          const opts = normalizeOptions(input, true); jobInteger(opts.expectedRevision, 1); opts.signal.throwIfAborted(); guard();
          if (this.pendingRetirementCount >= 1024) throw new JobsError('JOBS_CAPACITY');
          this.pendingRetirementCount++;
          const retirement: RetirementFence = { signal: opts.signal, active: true };
          const marked = new Set<ActivationToken>();
          const markPending = (definitive = false) => {
            for (const token of this.pendingActivations.get(id) ?? []) {
              if (token.expectedRevision !== opts.expectedRevision) continue;
              if (definitive) token.retired = true;
              else { token.retirements.add(retirement); marked.add(token); }
            }
          };
          const invalidate = () => {
            const live = this.live.get(id);
            if (live && live.registration.revision !== opts.expectedRevision) return;
            this.live.delete(id); markPending(true);
          };
          try {
            // Inspect durable evidence before affecting pending activation. Its
            // writer may already have committed a newer epoch while the reply
            // is still in flight, despite the prior binding remaining quiesced.
            await confirm();
            const prior = await receipt<JobSourceRegistration>(opts.key, ['retire', source.identity, opts.expectedRevision]); opts.signal.throwIfAborted();
            if (prior) return prior;
            const selected = await read<JobSourceRegistration | null>('jobs.source', { identity: source.identity });
            opts.signal.throwIfAborted();
            if (!selected || selected.revision !== opts.expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
            const selectedLive = this.live.get(id);
            if (!selectedLive || selectedLive.registration.revision === opts.expectedRevision) markPending();
            return await sourceGateMutation(this.options.gate, async operation => {
              let attempted = false;
              try {
                await confirm();
                const prior = await receipt<JobSourceRegistration>(opts.key, ['retire', source.identity, opts.expectedRevision]); operation.signal.throwIfAborted();
                if (prior) return prior;
                const selected = await read<JobSourceRegistration | null>('jobs.source', { identity: source.identity });
                if (!selected || selected.revision !== opts.expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
                operation.signal.throwIfAborted(); operation.markWriteAttempted(); invalidate(); attempted = true;
                return await write<JobSourceRegistration>('jobs.source.retire', { identity: source.identity,
                  expectedRevision: opts.expectedRevision, requestId: opts.key, now: this.options.now() }, operation, false);
              } finally { if (attempted) invalidate(); }
            }, { key: sourceGateKey(id), signal: opts.signal });
          } finally {
            retirement.active = false; for (const token of marked) token.retirements.delete(retirement);
            this.pendingRetirementCount--;
          }
        },
      }),
      receipts: Object.freeze({ get: (key: string) => receipt<JobSourceRegistration | JobSourceScheduleReceipt>(key) }),
      executions: Object.freeze({ get: async (scheduleId: string, input: { generation: number; scheduledAt: number }): Promise<JobSourceExecutionEvidence | null> => {
        const opts = jobRecord(input, ['generation', 'scheduledAt']);
        const context = await read<JobSourceExecutionContext | null>('jobs.source.execution', { identity: source.identity,
          id: jobText(scheduleId, 96), generation: jobInteger(opts.generation, 1), scheduledAt: jobTime(opts.scheduledAt) });
        if (!context) return null;
        const binding = jobBinding(context.admission, context.generation), authority = this.options.bridge.open(context.seal, binding);
        assertJobExecutionIdentity(context.admission, authority);
        const accepted = this.options.bridge.inspect(authority, context.admission.workflow, context.admission.input,
          jobDispatchKey(context.occurrenceId), binding);
        if (!accepted) {
          if (context.recordedInstanceId !== null || context.recordedReceipt !== null) throw new JobsError('JOBS_STATE_INVALID');
          return null;
        }
        if (context.recordedInstanceId !== null && (context.recordedInstanceId !== accepted.receipt.instanceId
          || jobHash(context.recordedReceipt) !== jobHash(accepted.receipt))) throw new JobsError('JOBS_STATE_INVALID');
        await confirm();
        const origin = context.admission.source;
        if (!origin) throw new JobsError('JOBS_STATE_INVALID');
        return Object.freeze({ scheduleId: context.scheduleId, generation: context.generation, scheduledAt: context.scheduledAt,
          occurrenceId: context.occurrenceId, sourceId: origin.id, policyGeneration: origin.generation, policyHash: origin.policyHash,
          workflow: Object.freeze({ ...context.admission.workflow }), inputHash: jobHash(context.admission.input),
          instanceId: accepted.receipt.instanceId, status: accepted.status });
      } }),
      schedules: Object.freeze({ create: (input: SourceJobInput, opts: SourceOptions) => change('create', undefined, input, opts),
        replace: (scheduleId: string, input: SourceJobInput, opts: SourceRevisionOptions) => change('readmit', scheduleId, input, opts),
        get: async (scheduleId: string) => {
          const result = await read<{ schedule: JobScheduleRow; admission: JobAdmission; receipt: JobSourceScheduleReceipt } | null>('jobs.source.schedule', { identity: source.identity, id: jobText(scheduleId, 96) });
          if (!result) throw new JobsError('JOBS_NOT_FOUND'); return result;
        },
        cancel: async (scheduleId: string, input: SourceRevisionOptions) => {
          const opts = normalizeOptions(input, true), selected = jobText(scheduleId, 96);
          jobInteger(opts.expectedRevision, 1);
          return sourceGateMutation(this.options.gate, async operation => {
            await confirm(); const intent = ['change', selected, opts.expectedRevision, 'cancel', null];
            const prior = await receipt<JobSourceScheduleReceipt>(opts.key, intent); operation.signal.throwIfAborted(); if (prior) return prior;
            return write<JobSourceScheduleReceipt>('jobs.source.schedule.change', { identity: source.identity, id: selected, action: 'cancel',
              expectedRevision: opts.expectedRevision, requestId: opts.key, now: this.options.now() }, operation, false);
          }, { key: jobGateKey(source.scope, selected), signal: opts.signal });
        },
      }),
    });
  }
  /** Called only AFTER exact Torrent receipt inspection, and after the schedule pool wait. */
  async prepareDispatch(scope: ServiceDataScope, admission: JobAdmission): Promise<() => void> {
    if (!admission.source) return () => {};
    const runtimeGuard = () => { this.assertReady(); this.options.bridge.assertRuntimeCurrent(); };
    runtimeGuard();
    // Retained epoch retirement is definitive. A native source which has not
    // hydrated on this process yet is merely not ready, not permanently revoked.
    const selected = await this.options.runtime.readExisting(scope, 'jobs.source.dispatch',
      { scopeId: admission.scopeId, source: admission.source }, runtimeGuard, this.options.signal);
    if (selected !== true) throw new JobsError('JOBS_STATE_INVALID');
    const { id, generation, policyHash } = admission.source, live = this.live.get(id);
    if (!live) throw new JobsError('JOBS_NOT_READY');
    if (live.quiescedBy) throw new JobsError('JOBS_NOT_READY');
    if (live.registration.generation !== generation || live.registration.policyHash !== policyHash) throw new JobsError('JOBS_AUTHORITY_RETIRED');
    const source = requireJobSource(live.source);
    const guard = () => {
      this.assertReady(); if (this.live.get(id) !== live || live.quiescedBy) throw new JobsError('JOBS_NOT_READY');
      assertJobSourceEligible(source);
    };
    guard(); await confirmJobSource(source, true); guard();
    if (source.identity.scopeId !== admission.scopeId) throw new JobsError('JOBS_STATE_INVALID');
    guard(); return guard;
  }
  private requireLive(source: TrustedJobSource, id: string): LiveBinding {
    this.assertReady(); const live = this.live.get(id);
    if (!live || live.source !== source || live.quiescedBy) throw new JobsError('JOBS_AUTHORITY_RETIRED');
    assertJobSourceEligible(requireJobSource(source)); return live;
  }
  private assertActivationCurrent(token: ActivationToken): void {
    if (token.retired) throw new JobsError('JOBS_AUTHORITY_RETIRED');
    for (const retirement of token.retirements) if (retirement.active && !retirement.signal.aborted) throw new JobsError('JOBS_AUTHORITY_RETIRED');
  }
  private beginActivation(id: string, expectedRevision: number): ActivationToken {
    this.assertReady(); if (this.pendingActivationCount >= 1024) throw new JobsError('JOBS_CAPACITY');
    let pending = this.pendingActivations.get(id); if (!pending) this.pendingActivations.set(id, pending = new Set());
    const token: ActivationToken = { expectedRevision, retired: false, retirements: new Set() }; pending.add(token); this.pendingActivationCount++; return token;
  }
  private endActivation(id: string, token: ActivationToken): void {
    const pending = this.pendingActivations.get(id);
    if (!pending?.delete(token)) return;
    this.pendingActivationCount--; if (!pending.size) this.pendingActivations.delete(id);
  }
  private assertReady(): void { if (this.closed || this.options.signal.aborted) throw new JobsError('JOBS_NOT_READY'); }
}
function sourceGateKey(id: string): string { return 'source:' + id; }
/** Time parsing occurs before the gate/writer. Only the native typed input refusal proves no write began. */
function sourceScheduleTiming(input: unknown): ReturnType<typeof normalizeScheduleTiming> {
  try { return normalizeScheduleTiming(input); }
  catch (error) {
    if (error instanceof SchedulerError && error.code === 'SCHEDULER_JOB_INVALID') throw new JobsError('JOBS_INPUT_INVALID', 'not-started');
    throw error;
  }
}
function expectedSourceRegistration(input: unknown): JobSourceRegistration {
  const r = jobRecord(input, ['id', 'generation', 'revision', 'state', 'policyHash']), id = jobText(r.id, 68);
  if (!/^src_[a-f0-9]{64}$/.test(id) || r.state !== 'active') throw new JobsError('JOBS_INPUT_INVALID');
  return Object.freeze({ id, generation: jobInteger(r.generation, 1), revision: jobInteger(r.revision, 1),
    state: 'active', policyHash: jobDigest(r.policyHash) });
}
function sameSourceRegistration(a: JobSourceRegistration, b: JobSourceRegistration): boolean {
  return a.id === b.id && a.generation === b.generation && a.revision === b.revision && a.state === 'active'
    && b.state === 'active' && a.policyHash === b.policyHash;
}
