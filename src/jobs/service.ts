/** Admitted jobs facade. The shared per-schedule gate orders controls against handoff without holding a SQL lease. */
import type { SchedulerService } from '../scheduler/scheduler-service';
import { WorkPool } from '../workers/work-pool';
import type { WorkflowDeferredStartBridge } from '../workflows/workflow-deferred-start-bridge';
import { prepareJobAdmission } from './admission';
import type { ResolvedJobsConfig } from './config';
import type { JobControlOptions, JobEnqueueOptions, JobOccurrenceView, JobPageOptions, JobRequestOptions, JobScheduleDetail, JobScheduleInput, JobScheduleView, JobSchedulePage, JobWatchOptions, ScopedJobs } from './contracts';
import type { JobDefinition } from './definition';
import { JobsError } from './error';
import type { JobAdmission, JobScheduleRow } from './model';
import { JobOperatorPolicy } from './operator-policy';
import type { JobScheduleReadDetail, JobScheduleReadSummary } from './operator-views';
import type { ActorJobScheduleRow } from './realm-model';
import { JobsSourceBroker, type SourceJobs } from './source-service';
import type { TrustedJobSource } from './source-authority';
import { JobsRunner, jobGateKey } from './runner';
import { JobsRuntime } from './runtime';
import { normalizeScheduleTiming, type ScheduleTiming } from './schedule-time';
import { admitJobRequest, type JobRequestAuthority, type JobsAuthority } from './service-authority';
import { jobHash, jobInput, jobInteger, jobKey, jobRecord, jobText } from './validation';
import { watchJobSchedules } from './watch';

interface ServiceOptions {
  readonly config: ResolvedJobsConfig;
  readonly runtime: JobsRuntime;
  readonly bridge: WorkflowDeferredStartBridge;
  readonly now?: () => number;
  readonly onFailure?: (stage: 'scope' | 'dispatch' | 'completion', code: string) => void;
}
interface ScheduleContext { readonly schedule: ActorJobScheduleRow; readonly admission: JobAdmission }
type SchedulePatch = { definition?: string | JobDefinition; input?: unknown; timing?: ScheduleTiming; overlap?: JobAdmission['overlap']; ownership?: JobAdmission['runAs'] };
type Control = 'pause' | 'cancel' | 'resume' | 'update' | 'runNow';
export class JobsService {
  private readonly gate: WorkPool;
  private readonly runner: JobsRunner;
  private readonly sources: JobsSourceBroker;
  private readonly abort = new AbortController();
  private readonly now: () => number;
  private closeTask: Promise<void> | null = null;
  constructor(private readonly options: ServiceOptions) {
    this.now = options.now ?? Date.now;
    this.gate = new WorkPool({ concurrency: options.config.concurrency, maxConcurrentPerKey: 1,
      maxQueued: options.config.concurrency * 4, maxQueuedPerKey: Math.min(16, options.config.concurrency * 4), queueTimeoutMs: 5000 });
    this.sources = new JobsSourceBroker({ ...options, gate: this.gate, signal: this.abort.signal, now: this.now, wake: () => this.runner.wake() });
    this.runner = new JobsRunner({ ...options, gate: this.gate, sources: this.sources });
  }
  start(scheduler: SchedulerService): void { this.runner.start(scheduler); }
  /** Trusted lifecycle/test composition. Request code only receives forAuthority(). */
  tick(): Promise<void> { return this.runner.tick(); }
  /** @internal Native source lifecycle only; never project this method to a request/activity. */
  forSource(source: TrustedJobSource): SourceJobs { return this.sources.forSource(source); }
  diagnostics() { return { gate: this.gate.status(), runner: this.runner.diagnostics(), persistence: this.options.runtime.diagnostics() }; }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.abort.abort(new JobsError('JOBS_NOT_READY'));
    this.sources.close();
    this.closeTask = (async () => {
      try { await this.runner.close(); } finally { try { await this.gate.close(); } finally { await this.options.runtime.close(); } }
    })();
    return this.closeTask;
  }
  forAuthority(request: JobsAuthority): ScopedJobs {
    const admit = (signal?: AbortSignal) => admitJobRequest(request, this.options.bridge, this.options.config, this.abort.signal, signal);
    const enqueue = async (target: string | JobDefinition, input: unknown, options: JobEnqueueOptions) => {
      const opts = requestOptions(options, ['ownership', 'maxLatenessMs']), context = await admit(opts.signal);
      const patch = this.patch({ definition: target, input, ownership: opts.ownership ?? 'actor' });
      const maxLatenessMs = jobInteger(opts.maxLatenessMs ?? 60_000, 0, 366 * 24 * 60 * 60 * 1000);
      const intentHash = jobHash(['enqueue', this.intentPatch(patch), maxLatenessMs]);
      return this.create(context, request, patch, opts.idempotencyKey, intentHash,
        now => timing({ kind: 'once', at: new Date(now).toISOString(), maxLatenessMs }));
    };
    return Object.freeze({ enqueue: enqueue as ScopedJobs['enqueue'],
      definitions: Object.freeze({ list: async () => {
        const context = await admit(), result = this.operatorPolicy(request, context).definitions();
        await context.confirm(); return result;
      } }),
      receipts: Object.freeze({ get: async (key: string) => {
        const context = await admit(); return this.read<JobScheduleView | null>(context, 'jobs.receipt', { actor: context.actor, requestId: jobKey(key) });
      } }),
      schedules: Object.freeze({
        create: async (input: JobScheduleInput, options: JobRequestOptions) => {
          const opts = requestOptions(options), context = await admit(opts.signal), patch = this.patch(input);
          if (!patch.definition || !patch.timing) throw new JobsError('JOBS_INPUT_INVALID');
          return this.create(context, request, patch, opts.idempotencyKey, jobHash(['schedule', this.intentPatch(patch)]), () => patch.timing!);
        },
        get: async (id: string): Promise<JobScheduleDetail> => {
          const context = await admit(), detail = await this.read<JobScheduleReadDetail>(context, 'jobs.schedule', { actor: context.actor, id: jobText(id, 96) });
          return { ...detail, actions: this.operatorPolicy(request, context).actions(context.actor, detail) };
        },
        list: async (options?: JobPageOptions) => { const context = await admit(); return this.readSchedules(request, context, page(options, true)); },
        watch: (listener: Parameters<ScopedJobs['schedules']['watch']>[0], options: JobWatchOptions = {}) => {
          const r = jobRecord(options, ['query', 'signal', 'onError']), query = page(r.query, true);
          if (typeof listener !== 'function' || r.onError !== undefined && typeof r.onError !== 'function'
            || r.signal !== undefined && !(r.signal instanceof AbortSignal)) throw new JobsError('JOBS_INPUT_INVALID');
          const signal = AbortSignal.any([this.abort.signal, ...[request.signal, r.signal].filter((item): item is AbortSignal => item instanceof AbortSignal)]);
          return watchJobSchedules({ listener, signal, onError: r.onError as ((error: unknown) => void) | undefined, prepare: async () => {
            const context = await admit(signal);
            return { read: () => this.readSchedules(request, context, query),
              subscribe: changed => this.options.runtime.subscribe(context.scope, changed, context.actor.manageAll ? {} : { ownerId: context.actor.userId }) };
          } });
        },
        occurrences: async (id: string, options?: Pick<JobPageOptions, 'limit' | 'offset'>) => {
          const context = await admit(); return this.read<{ items: JobOccurrenceView[]; total: number }>(context, 'jobs.occurrences', { actor: context.actor, id: jobText(id, 96), ...page(options) });
        },
        update: (id: string, input: Partial<JobScheduleInput>, options: JobControlOptions) => this.control(request, 'update', id, input, options),
        resume: (id: string, options: JobControlOptions) => this.control(request, 'resume', id, {}, options),
        pause: (id: string, options: JobControlOptions) => this.control(request, 'pause', id, {}, options),
        cancel: (id: string, options: JobControlOptions) => this.control(request, 'cancel', id, {}, options),
        runNow: (id: string, options: JobControlOptions) => this.control(request, 'runNow', id, {}, options),
      }),
    });
  }
  private async create(context: JobRequestAuthority, request: JobsAuthority, patch: SchedulePatch, key: string, intentHash: string, when: (now: number) => ScheduleTiming): Promise<JobScheduleView> {
    const id = scheduleId(context, key);
    return this.gate.run(async () => {
      await context.confirm();
      const replay = await this.receipt(context, key, ['create', intentHash]); if (replay) return replay;
      const definition = this.options.config.catalog.resolve(patch.definition!); request.access.authorize(definition.access);
      const now = this.now(), prepared = prepareJobAdmission(this.options.bridge, definition, context.authority, context.scope, context.actor,
        { id, input: patch.input === undefined ? {} : patch.input, timing: when(now), overlap: patch.overlap ?? 'skip', runAs: patch.ownership ?? 'actor', generation: 1 });
      return this.write(context, 'jobs.schedule.create', { actor: context.actor, requestId: key, ...prepared, intentHash, now });
    }, { key: jobGateKey(context.scope, id), signal: context.signal });
  }
  private async control(request: JobsAuthority, action: Control, suppliedId: string, input: Partial<JobScheduleInput>, options: JobControlOptions): Promise<JobScheduleView> {
    const opts = requestOptions(options, ['expectedRevision']), expectedRevision = jobInteger(opts.expectedRevision, 1);
    const context = await admitJobRequest(request, this.options.bridge, this.options.config, this.abort.signal, opts.signal);
    const id = jobText(suppliedId, 96), patch = this.patch(input), key = opts.idempotencyKey;
    const intentHash = jobHash([action, id, expectedRevision, this.intentPatch(patch)]);
    return this.gate.run(async () => {
      await context.confirm();
      const realmAction = action === 'pause' || action === 'cancel' ? action : 'readmit';
      const intent = action === 'runNow' ? ['create', intentHash] : ['change', id, expectedRevision, realmAction, intentHash];
      const replay = await this.receipt(context, key, intent); if (replay) return replay;
      const source = await this.read<ScheduleContext>(context, 'jobs.schedule.context', { actor: context.actor, id });
      if (source.schedule.revision !== expectedRevision) throw new JobsError('JOBS_REVISION_CONFLICT');
      if (source.schedule.control === 'cancelled') throw new JobsError('JOBS_STAGE_CONFLICT');
      if (action === 'pause' || action === 'cancel') return this.write(context, 'jobs.schedule.change', {
        actor: context.actor, requestId: key, id, expectedRevision, action, intentHash, now: this.now() });
      if (patch.ownership !== undefined && patch.ownership !== source.admission.runAs) throw new JobsError('JOBS_INPUT_INVALID');
      const definition = patch.definition === undefined ? this.options.config.catalog.resolve(source.admission.definition, source.admission.definitionVersion)
        : this.options.config.catalog.resolve(patch.definition);
      request.access.authorize(definition.access);
      const now = this.now(), runNow = action === 'runNow', nextId = runNow ? scheduleId(context, key) : id;
      const prepared = prepareJobAdmission(this.options.bridge, definition, context.authority, context.scope, context.actor, {
        id: nextId, input: patch.input === undefined ? source.admission.input : patch.input,
        timing: runNow ? timing({ kind: 'once', at: new Date(now).toISOString(), maxLatenessMs: source.admission.timing.maxLatenessMs }) : patch.timing ?? source.admission.timing,
        overlap: patch.overlap ?? source.admission.overlap, runAs: source.admission.runAs, generation: runNow ? 1 : source.schedule.generation + 1,
        ...(runNow ? {} : { ownerId: source.schedule.actor_id, ownerPrincipal: source.schedule.principal }),
      });
      return this.write(context, runNow ? 'jobs.schedule.create' : 'jobs.schedule.change', { actor: context.actor, requestId: key,
        ...(runNow ? {} : { id, expectedRevision, action: 'readmit' }), ...prepared, intentHash, now });
    }, { key: jobGateKey(context.scope, id), signal: context.signal });
  }
  private patch(input: unknown): SchedulePatch {
    const r = jobRecord(input, ['definition', 'input', 'timing', 'overlap', 'ownership']);
    if (r.overlap !== undefined && !['skip', 'allow', 'queue-one'].includes(r.overlap as string)
      || r.ownership !== undefined && !['actor', 'service'].includes(r.ownership as string)) throw new JobsError('JOBS_INPUT_INVALID');
    const definition = r.definition === undefined ? undefined : typeof r.definition === 'string' ? jobText(r.definition, 96) : this.options.config.catalog.resolve(r.definition as JobDefinition);
    return { ...(definition === undefined ? {} : { definition }), ...(r.input === undefined ? {} : { input: jobInput(r.input) }),
      ...(r.timing === undefined ? {} : { timing: timing(r.timing) }), ...(r.overlap === undefined ? {} : { overlap: r.overlap as JobAdmission['overlap'] }),
      ...(r.ownership === undefined ? {} : { ownership: r.ownership as JobAdmission['runAs'] }) };
  }
  private intentPatch(patch: SchedulePatch): unknown {
    return { ...patch, ...(typeof patch.definition === 'object' ? { definition: { name: patch.definition.name, version: patch.definition.version } } : {}) };
  }
  private receipt(context: JobRequestAuthority, key: string, intent: unknown): Promise<JobScheduleView | null> {
    return this.read(context, 'jobs.receipt', { actor: context.actor, requestId: key, intentDigest: jobHash(intent) });
  }
  private operatorPolicy(request: JobsAuthority, context: JobRequestAuthority): JobOperatorPolicy {
    context.guard();
    return new JobOperatorPolicy(this.options.config.catalog, context.scope.scopeKind, definition => request.access.authorize(definition.access));
  }
  private async readSchedules(request: JobsAuthority, context: JobRequestAuthority, query: JobPageOptions): Promise<JobSchedulePage> {
    const result = await this.read<{ items: JobScheduleReadSummary[]; total: number }>(context, 'jobs.schedules', { actor: context.actor, ...query });
    const policy = this.operatorPolicy(request, context);
    return { items: result.items.map(item => ({ ...item, actions: policy.actions(context.actor, item) })), total: result.total };
  }
  private async read<T>(context: JobRequestAuthority, name: string, input: unknown): Promise<T> {
    context.guard(); const result = await this.options.runtime.read<T>(context.scope, name, input, context.guard, context.signal);
    await context.confirm(); return result;
  }
  private async write(context: JobRequestAuthority, name: string, input: unknown): Promise<JobScheduleView> {
    context.guard(); const result = await this.options.runtime.write<JobScheduleView>(context.scope, name, input, crypto.randomUUID(), context.guard, context.signal);
    try { await context.confirm(); } catch { throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
    this.runner.wake(); return result;
  }
}
function scheduleId(context: JobRequestAuthority, key: string): string { return 'job_' + jobHash([context.actor.scopeId, context.actor.principal, key]); }
function requestOptions(input: unknown, extra: readonly string[] = []): JobRequestOptions & Record<string, unknown> {
  const r = jobRecord(input, ['idempotencyKey', 'signal', ...extra]);
  if (r.signal !== undefined && !(r.signal instanceof AbortSignal)) throw new JobsError('JOBS_INPUT_INVALID');
  return { ...r, idempotencyKey: jobKey(r.idempotencyKey), ...(r.signal === undefined ? {} : { signal: r.signal as AbortSignal }) };
}
function timing(input: unknown): ScheduleTiming { try { return normalizeScheduleTiming(input); } catch { throw new JobsError('JOBS_INPUT_INVALID'); } }
function page(input: unknown, controls = false): JobPageOptions {
  const r = jobRecord(input ?? {}, controls ? ['limit', 'offset', 'control'] : ['limit', 'offset']);
  if (r.control !== undefined && !['active', 'paused', 'cancelled'].includes(r.control as string)) throw new JobsError('JOBS_INPUT_INVALID');
  return { limit: jobInteger(r.limit ?? 25, 1, 100), offset: jobInteger(r.offset ?? 0, 0, controls ? 10_000 : 100_000),
    ...(r.control === undefined ? {} : { control: r.control as JobPageOptions['control'] }) };
}
