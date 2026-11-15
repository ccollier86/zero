/** Browser-safe jobs facade. Mutations retain caller request identities; scope retirement discards late acknowledgments. */
import type { JobControlOptions, JobEnqueueOptions, JobPageOptions, JobRequestOptions, JobScheduleInput, JobSchedulePage, JobScheduleView, JobWatchOptions, ScopedJobs } from '../../jobs/contracts';
import type { FetchInit } from './sdk';
import { watchJobsPage } from './jobs-watch';

export type ClientJobScheduleInput = Omit<JobScheduleInput, 'definition'> & { readonly definition: string };
export interface JobsClient extends Omit<ScopedJobs, 'enqueue' | 'schedules'> {
  enqueue(definition: string, input: unknown, options: JobEnqueueOptions): Promise<JobScheduleView>;
  readonly schedules: Omit<ScopedJobs['schedules'], 'create' | 'update'> & {
    create(input: ClientJobScheduleInput, options: JobRequestOptions): Promise<JobScheduleView>;
    update(id: string, input: Partial<ClientJobScheduleInput>, options: JobControlOptions): Promise<JobScheduleView>;
  };
  clear(): void;
}
export function createJobsClient(fetch: <T = unknown>(path: string, init?: FetchInit) => Promise<T>, open?: (path: string, init: RequestInit) => Promise<Response>): JobsClient {
  let generation = 0, boundary = new AbortController();
  const call = async <T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
    const epoch = generation, combined = AbortSignal.any([boundary.signal, ...(signal ? [signal] : [])]); combined.throwIfAborted();
    const captured = body === undefined ? undefined : structuredClone(body);
    const result = await fetch<T>('/jobs' + path, { method, ...(captured === undefined ? {} : { body: captured }), signal: combined });
    if (epoch !== generation || combined.aborted) throw new DOMException('Jobs authority scope changed.', 'AbortError'); return result;
  };
  const mutation = async (path: string, method: string, body: unknown, options: JobRequestOptions) => view(await call(path, method, body, options.signal));
  const control = (action: string, id: string, supplied: JobControlOptions) => {
    const options = requestOptions(supplied, ['expectedRevision']);
    if (!Number.isSafeInteger(options.expectedRevision) || Number(options.expectedRevision) < 1) throw invalid();
    return mutation('/schedules/' + encodeURIComponent(identifier(id)) + '/' + action, 'POST', options, supplied);
  };
  return Object.freeze({
    async enqueue(definition: string, input: unknown, supplied: JobEnqueueOptions) {
      const options = requestOptions(supplied, ['ownership', 'maxLatenessMs']);
      if (typeof definition !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(definition)) throw invalid();
      return mutation('/enqueue', 'POST', { definition, ...(input === undefined ? {} : { input }), ...options }, supplied);
    },
    receipts: Object.freeze({ async get(key: string) {
      const result = await call<{ receipt: unknown }>('/receipts/' + encodeURIComponent(requestKey(key)));
      if (!result || typeof result !== 'object' || Object.keys(result).length !== 1 || !Object.hasOwn(result, 'receipt')) throw invalid();
      return result.receipt === null ? null : view(result.receipt);
    } }),
    schedules: Object.freeze({
      async create(input: ClientJobScheduleInput, supplied: JobRequestOptions) { return mutation('/schedules', 'POST', { schedule: input, options: requestOptions(supplied) }, supplied); },
      async get(id: string) {
        const result = await call<Record<string, unknown>>('/schedules/' + encodeURIComponent(identifier(id)));
        const { timing, overlap, nextDueAt, skipped, blockedCode, ...base } = result ?? {};
        view(base);
        const acceptedTiming = timingView(timing);
        if (!['skip', 'allow', 'queue-one'].includes(String(overlap)) || nextDueAt !== null && (!Number.isSafeInteger(nextDueAt) || Number(nextDueAt) < 0)
          || typeof skipped !== 'boolean' || blockedCode !== null && (typeof blockedCode !== 'string' || !/^JOBS_[A-Z_]+$/.test(blockedCode))) throw invalid();
        return Object.freeze({ ...base, timing: acceptedTiming, overlap, nextDueAt, skipped, blockedCode }) as Awaited<ReturnType<ScopedJobs['schedules']['get']>>;
      },
      async list(options?: JobPageOptions) {
        return schedulePage(await call('/schedules' + query(options, true)));
      },
      watch(listener: (page: JobSchedulePage) => void, options: JobWatchOptions = {}) {
        if (!open || typeof listener !== 'function') throw invalid();
        const r = record(options, ['query', 'signal', 'onError']);
        if (r.signal !== undefined && !(r.signal instanceof AbortSignal) || r.onError !== undefined && typeof r.onError !== 'function') throw invalid();
        return watchJobsPage(open, '/jobs/schedules/live' + query(r.query, true), boundary.signal, listener, schedulePage, options);
      },
      async occurrences(id: string, options?: Pick<JobPageOptions, 'limit' | 'offset'>) {
        const result = await call<{ items: unknown[]; total: number }>('/schedules/' + encodeURIComponent(identifier(id)) + '/occurrences' + query(options));
        if (!result || !Array.isArray(result.items) || result.items.length > 100 || !Number.isSafeInteger(result.total) || result.total < 0) throw invalid();
        const items = result.items.map(item => {
          const r = record(item, ['id', 'generation', 'scheduledAt', 'state', 'workflowId', 'terminalStatus', 'errorCode', 'createdAt', 'updatedAt']);
          if (Object.keys(r).length !== 9 || !['pending', 'claimed', 'dispatched', 'terminal', 'blocked', 'cancelled'].includes(String(r.state))) throw invalid();
          identifier(r.id, 128);
          for (const key of ['generation', 'scheduledAt', 'createdAt', 'updatedAt']) if (!Number.isSafeInteger(r[key]) || Number(r[key]) < (key === 'generation' ? 1 : 0)) throw invalid();
          for (const key of ['workflowId', 'terminalStatus', 'errorCode']) if (r[key] !== null && (typeof r[key] !== 'string' || String(r[key]).length > 128)) throw invalid();
          return Object.freeze(r) as unknown as import('../../jobs/contracts').JobOccurrenceView;
        });
        return Object.freeze({ items: Object.freeze(items), total: result.total });
      },
      async update(id: string, input: Partial<ClientJobScheduleInput>, supplied: JobControlOptions) {
        const options = requestOptions(supplied, ['expectedRevision']);
        if (!Number.isSafeInteger(options.expectedRevision) || Number(options.expectedRevision) < 1) throw invalid();
        return mutation('/schedules/' + encodeURIComponent(identifier(id)), 'PATCH', { schedule: input, options }, supplied);
      },
      pause: (id: string, options: JobControlOptions) => control('pause', id, options),
      resume: (id: string, options: JobControlOptions) => control('resume', id, options),
      cancel: (id: string, options: JobControlOptions) => control('cancel', id, options),
      runNow: (id: string, options: JobControlOptions) => control('runNow', id, options),
    }),
    clear() { generation++; boundary.abort(); boundary = new AbortController(); },
  });
}
function view(value: unknown): JobScheduleView {
  const r = record(value, ['id', 'definition', 'definitionVersion', 'ownerId', 'runAs', 'control', 'revision', 'generation', 'createdAt', 'updatedAt']);
  if (Object.keys(r).length !== 10 || !['actor', 'service'].includes(String(r.runAs)) || !['active', 'paused', 'cancelled'].includes(String(r.control))) throw invalid();
  for (const key of ['id', 'definition', 'definitionVersion', 'ownerId']) identifier(r[key], key === 'ownerId' ? 128 : key === 'definitionVersion' ? 64 : 96);
  for (const key of ['revision', 'generation', 'createdAt', 'updatedAt']) if (!Number.isSafeInteger(r[key]) || Number(r[key]) < (key === 'revision' || key === 'generation' ? 1 : 0)) throw invalid();
  return Object.freeze(r) as unknown as JobScheduleView;
}
function requestOptions(value: unknown, extra: readonly string[] = []): Record<string, unknown> {
  const { signal, ...r } = record(value, ['idempotencyKey', 'signal', ...extra]);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw invalid(); requestKey(r.idempotencyKey); return r;
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !fields.includes(key) || !Object.hasOwn(descriptors[key]!, 'value')) throw invalid();
    Object.defineProperty(result, key, { value: descriptors[key]!.value, enumerable: true });
  }
  return result;
}
function requestKey(value: unknown): string { const key = identifier(value, 128); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw invalid(); return key; }
function identifier(value: unknown, max = 96): string { if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw invalid(); return value; }
function query(value: unknown = {}, controls = false): string {
  const r = record(value, controls ? ['limit', 'offset', 'control'] : ['limit', 'offset']), params = new URLSearchParams();
  for (const key of ['limit', 'offset']) if (r[key] !== undefined) {
    if (!Number.isSafeInteger(r[key]) || Number(r[key]) < (key === 'limit' ? 1 : 0) || Number(r[key]) > (key === 'limit' ? 100 : controls ? 10_000 : 100_000)) throw invalid();
    params.set(key, String(r[key]));
  }
  if (r.control !== undefined) { if (!['active', 'paused', 'cancelled'].includes(String(r.control))) throw invalid(); params.set('control', String(r.control)); }
  return params.size ? '?' + params : '';
}
function invalid() { return new Error('Invalid jobs request or acknowledgment.'); }
function schedulePage(input: unknown): JobSchedulePage {
  const r = record(input, ['items', 'total']);
  if (!Array.isArray(r.items) || r.items.length > 100 || !Number.isSafeInteger(r.total) || Number(r.total) < 0) throw invalid();
  return Object.freeze({ items: Object.freeze(r.items.map(view)), total: Number(r.total) });
}
function timingView(value: unknown): import('../../jobs/schedule-time').ScheduleTiming {
  const r = record(value, ['kind', 'at', 'maxLatenessMs', 'pattern', 'timezone', 'misfire', 'catchUpLimit']);
  if (!Number.isSafeInteger(r.maxLatenessMs) || Number(r.maxLatenessMs) < 0 || Number(r.maxLatenessMs) > 366 * 86400_000) throw invalid();
  if (r.kind === 'once') {
    if (Object.keys(r).length !== 3 || typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at)) || new Date(r.at).toISOString() !== r.at) throw invalid();
  } else if (r.kind === 'cron') {
    if (Object.keys(r).length !== 6 || !['latest', 'skip', 'catch-up'].includes(String(r.misfire)) || !Number.isSafeInteger(r.catchUpLimit)
      || Number(r.catchUpLimit) < 1 || Number(r.catchUpLimit) > 100 || typeof r.pattern !== 'string' || !r.pattern.trim() || r.pattern.length > 256
      || typeof r.timezone !== 'string' || r.timezone.length > 128) throw invalid();
    try { new Intl.DateTimeFormat('en', { timeZone: r.timezone }); } catch { throw invalid(); }
  } else throw invalid();
  return Object.freeze(r) as unknown as import('../../jobs/schedule-time').ScheduleTiming;
}
