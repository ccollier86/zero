/** Internal native-service facade over the SAME Jobs runner, pool and Torrent receipts. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { WorkPool } from '../workers/work-pool';
import type { WorkflowDeferredStartBridge } from '../workflows/workflow-deferred-start-bridge';
import { jobBinding } from './admission';
import type { ResolvedJobsConfig } from './config';
import { JobsError } from './error';
import { normalizeJobAdmission, type JobAdmission, type JobScheduleRow } from './model';
import { jobGateKey } from './runner';
import type { JobsRuntime } from './runtime';
import { normalizeScheduleTiming } from './schedule-time';
import { assertJobSourceEligible, assertJobSourceOwner, confirmJobSource, requireJobSource, type TrustedJobSource } from './source-authority';
import { jobSourceId, jobSourcePrincipal, jobSourceScheduleId, normalizeJobSourceContract, normalizeJobSourceInitiator,
  type JobSourceContract, type JobSourceRegistration, type JobSourceScheduleReceipt } from './source-model';
import { jobHash, jobInput, jobInteger, jobKey, jobRecord, jobText } from './validation';
import { sourceGateMutation } from './source-gate';

interface SourceOptions { readonly idempotencyKey: string; readonly signal?: AbortSignal }
interface SourceRevisionOptions extends SourceOptions { readonly expectedRevision: number }
export interface SourceJobInput { readonly input: unknown; readonly at: string; readonly maxLatenessMs?: number; readonly initiatedBy?: string }
/** Private evidence/control surface; it is not a request API or an alternative general scheduler. */
export interface SourceJobs {
  readonly registration: {
    get(): Promise<JobSourceRegistration | null>;
    activate(options: SourceRevisionOptions & { readonly pinInput: unknown }): Promise<JobSourceRegistration>;
    retire(options: SourceRevisionOptions): Promise<JobSourceRegistration>;
  };
  readonly receipts: { get(key: string): Promise<JobSourceRegistration | JobSourceScheduleReceipt | null> };
  readonly schedules: {
    create(input: SourceJobInput, options: SourceOptions): Promise<JobSourceScheduleReceipt>;
    replace(id: string, input: SourceJobInput, options: SourceRevisionOptions): Promise<JobSourceScheduleReceipt>;
    cancel(id: string, options: SourceRevisionOptions): Promise<JobSourceScheduleReceipt>;
    get(id: string): Promise<{ schedule: JobScheduleRow; admission: JobAdmission; receipt: JobSourceScheduleReceipt }>;
  };
}
interface Options {
  readonly config: ResolvedJobsConfig; readonly runtime: JobsRuntime; readonly bridge: WorkflowDeferredStartBridge;
  readonly gate: WorkPool; readonly signal: AbortSignal; readonly now: () => number; readonly wake: () => void;
}
interface LiveBinding { readonly source: TrustedJobSource; readonly contract: JobSourceContract; readonly registration: JobSourceRegistration }
export class JobsSourceBroker {
  private readonly live = new Map<string, LiveBinding>();
  private readonly pendingActivations = new Map<string, Set<{ retired: boolean }>>();
  private pendingActivationCount = 0;
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
    const normalizeOptions = (input: unknown, revision: boolean, pin = false) => {
      const r = jobRecord(input, ['idempotencyKey', 'signal', ...(revision ? ['expectedRevision'] : []), ...(pin ? ['pinInput'] : [])]);
      if (r.signal !== undefined && !(r.signal instanceof AbortSignal)) throw new JobsError('JOBS_INPUT_INVALID');
      return { key: jobKey(r.idempotencyKey), signal: signal(r.signal as AbortSignal | undefined),
        expectedRevision: revision ? jobInteger(r.expectedRevision, 0) : 0, pinInput: r.pinInput };
    };
    const change = async (action: 'create' | 'readmit', suppliedId: string | undefined, input: unknown, options: unknown) => {
      const opts = normalizeOptions(options, action !== 'create'), r = jobRecord(input, ['input', 'at', 'maxLatenessMs', 'initiatedBy']);
      if (action !== 'create') jobInteger(opts.expectedRevision, 1);
      const timing = normalizeScheduleTiming({ kind: 'once', at: r.at, maxLatenessMs: r.maxLatenessMs ?? 60_000 });
      const value = jobInput(r.input), initiatedBy = normalizeJobSourceInitiator(r.initiatedBy);
      const scheduleId = action === 'create' ? jobSourceScheduleId(source.identity, opts.key) : jobText(suppliedId, 96);
      const intentHash = jobHash(['once', id, source.policyVersion, source.semanticsVersion,
        { name: source.definition.name, version: source.definition.version, fingerprint: source.definition.fingerprint }, value, timing, initiatedBy ?? null]);
      const intent = action === 'create' ? ['create', intentHash] : ['change', scheduleId, opts.expectedRevision, 'readmit', intentHash];
      return sourceGateMutation(this.options.gate, async operation => {
        await confirm(); const prior = await receipt<JobSourceScheduleReceipt>(opts.key, intent); operation.signal.throwIfAborted(); if (prior) return prior;
        await confirm(true); const live = current();
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
        const check = () => { if (this.requireLive(capability, id) !== live) throw new JobsError('JOBS_AUTHORITY_RETIRED'); };
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
          const opts = normalizeOptions(input, true, true), token = this.beginActivation(id);
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
              if (token.retired) throw new JobsError('JOBS_AUTHORITY_RETIRED');
              if (!this.live.has(id) && this.live.size >= 1024) throw new JobsError('JOBS_CAPACITY');
              const old = this.live.get(id);
              const prior = await receipt<JobSourceRegistration>(opts.key, ['register', contract, opts.expectedRevision]);
              if (!prior) {
                const selected = await read<JobSourceRegistration | null>('jobs.source', { identity: source.identity });
                if ((selected?.revision ?? 0) !== opts.expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
              }
              const activationFence = () => { if (token.retired) throw new JobsError('JOBS_AUTHORITY_RETIRED'); };
              const result = prior ?? await write<JobSourceRegistration>('jobs.source.register', { contract, expectedRevision: opts.expectedRevision,
                requestId: opts.key, now: this.options.now() }, operation, true, activationFence,
                () => { activationFence(); if (old && jobHash(old.contract) !== jobHash(contract)) this.live.delete(id); });
              // A replay is historical evidence, not permission to revive an old
              // generation after A -> B -> A or a durable retirement.
              try {
                const selected = await read<JobSourceRegistration | null>('jobs.source', { identity: source.identity });
                await confirm(true); operation.signal.throwIfAborted();
                if (token.retired || !selected || selected.state !== 'active'
                  || selected.generation !== result.generation || selected.revision !== result.revision || selected.policyHash !== jobHash(contract)) throw new JobsError('JOBS_AUTHORITY_RETIRED');
                if (!this.live.has(id) && this.live.size >= 1024) throw new JobsError('JOBS_CAPACITY');
                if (!old || old.source !== capability || old.registration.generation !== selected.generation || old.registration.revision !== selected.revision
                  || old.registration.policyHash !== selected.policyHash) this.live.set(id, { source: capability, contract, registration: selected });
                this.options.wake(); return result;
              } catch (error) { if (!prior) throw new JobsError('JOBS_OUTCOME_UNKNOWN'); throw error; }
            }, { key: sourceGateKey(id), signal: opts.signal });
          } finally { this.endActivation(id, token); }
        },
        retire: async (input: SourceRevisionOptions) => {
          const opts = normalizeOptions(input, true); jobInteger(opts.expectedRevision, 1); opts.signal.throwIfAborted(); guard();
          const invalidate = () => {
            const live = this.live.get(id);
            if (live && live.registration.revision !== opts.expectedRevision) return;
            this.live.delete(id); for (const token of this.pendingActivations.get(id) ?? []) token.retired = true;
          };
          const selectedLive = this.live.get(id);
          if (!selectedLive || selectedLive.registration.revision === opts.expectedRevision) {
            for (const token of this.pendingActivations.get(id) ?? []) token.retired = true;
          }
          return sourceGateMutation(this.options.gate, async operation => {
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
        },
      }),
      receipts: Object.freeze({ get: (key: string) => receipt<JobSourceRegistration | JobSourceScheduleReceipt>(key) }),
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
    if (live.registration.generation !== generation || live.registration.policyHash !== policyHash) throw new JobsError('JOBS_AUTHORITY_RETIRED');
    const source = requireJobSource(live.source);
    const guard = () => {
      this.assertReady(); if (this.live.get(id) !== live) throw new JobsError('JOBS_NOT_READY');
      assertJobSourceEligible(source);
    };
    guard(); await confirmJobSource(source, true); guard();
    if (source.identity.scopeId !== admission.scopeId) throw new JobsError('JOBS_STATE_INVALID');
    guard(); return guard;
  }
  private requireLive(source: TrustedJobSource, id: string): LiveBinding {
    this.assertReady(); const live = this.live.get(id);
    if (!live || live.source !== source) throw new JobsError('JOBS_AUTHORITY_RETIRED');
    assertJobSourceEligible(requireJobSource(source)); return live;
  }
  private beginActivation(id: string): { retired: boolean } {
    this.assertReady(); if (this.pendingActivationCount >= 1024) throw new JobsError('JOBS_CAPACITY');
    let pending = this.pendingActivations.get(id); if (!pending) this.pendingActivations.set(id, pending = new Set());
    const token = { retired: false }; pending.add(token); this.pendingActivationCount++; return token;
  }
  private endActivation(id: string, token: { retired: boolean }): void {
    const pending = this.pendingActivations.get(id);
    if (!pending?.delete(token)) return;
    this.pendingActivationCount--; if (!pending.size) this.pendingActivations.delete(id);
  }
  private assertReady(): void { if (this.closed || this.options.signal.aborted) throw new JobsError('JOBS_NOT_READY'); }
}
function sourceGateKey(id: string): string { return 'source:' + id; }
