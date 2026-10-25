/** Scope-generation owned logging transport. Reuses authenticated SDK fetch; never exposes server persistence modules. */
import { LOGGING_API, type LoggingClient, type LoggingCollectionPolicy, type LoggingObservationResult } from '../../logging/logging-api-contracts';
import { LOGGING_FAMILIES, LOGGING_EVIDENCE, LOGGING_OUTCOMES } from '../../logging/logging-contracts';
import type { LoggingPage } from '../../logging/logging-contracts';
import type { FetchInit } from './sdk';
import { readLoggingExportJob } from '../../logging/logging-export-result';

export function createLoggingClient(fetch: <T = unknown>(path: string, init?: FetchInit) => Promise<T>): LoggingClient {
  let generation = 0, boundary = new AbortController();
  const validatePage = (result: LoggingPage): LoggingPage => {
    if (!result || !Array.isArray(result.events) || result.events.length > 100 || !Number.isSafeInteger(result.highWaterOrdinal) || result.highWaterOrdinal < 0 || typeof result.hasMore !== 'boolean') throw new Error('Invalid logging page.');
    let before = Number.MAX_SAFE_INTEGER;
    for (const row of result.events) {
      const e = row?.event;
      if (!row || !e || e.version !== 1 || !Number.isSafeInteger(row.ordinal) || row.ordinal < 1 || row.ordinal > result.highWaterOrdinal || row.ordinal >= before
        || !Number.isSafeInteger(row.ingestedAt) || !Number.isSafeInteger(e.occurredAt) || e.occurredAt < 0 || e.occurredAt > 8640000000000000
        || typeof e.id !== 'string' || typeof e.sourceId !== 'string' || typeof e.action !== 'string' || e.action.length > 120
        || !e.actor || !['user', 'system', 'service', 'anonymous'].includes(e.actor.kind) || e.actor.id !== null && typeof e.actor.id !== 'string'
        || !e.scope || !['application', 'tenant'].includes(e.scope.kind) || e.scope.kind === 'tenant' && typeof e.scope.tenantId !== 'string'
        || !LOGGING_OUTCOMES.includes(e.outcome) || !LOGGING_EVIDENCE.includes(e.evidence) || !LOGGING_FAMILIES.includes(e.family)
        || e.target !== null && (!e.target || typeof e.target.type !== 'string' || typeof e.target.id !== 'string')
        || !e.metadata || typeof e.metadata !== 'object' || Array.isArray(e.metadata)) throw new Error('Invalid logging event.');
      before = row.ordinal;
    }
    if (result.hasMore ? !result.events.length || result.nextBeforeOrdinal !== result.events.at(-1)!.ordinal : result.nextBeforeOrdinal !== null) throw new Error('Invalid logging cursor.');
    return result;
  };
  const request = async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const epoch = generation, capturedBody = body === undefined ? undefined : structuredClone(body);
    const currentSignal = AbortSignal.any([boundary.signal, ...(signal ? [signal] : [])]);
    const result = await fetch<T>(LOGGING_API + path, { method: body === undefined ? 'GET' : 'POST', body: capturedBody, signal: currentSignal });
    if (generation !== epoch || currentSignal.aborted) throw new DOMException('Logging scope changed.', 'AbortError');
    return result;
  };
  const readPage = async (path: string, stream: Parameters<LoggingClient['page']>[0], query: Parameters<LoggingClient['page']>[1] = {}, options?: { signal?: AbortSignal }) => {
    const result = await request<LoggingPage>(path, { stream, query }, options?.signal);
    return validatePage(result);
  };
  const page: LoggingClient['page'] = (stream, query, options) => readPage('/events', stream, query, options);
  const platformPage: LoggingClient['platformPage'] = (stream, query, options) => readPage('/platform/events', stream, query, options);
  const observe: LoggingClient['observe'] = async (observations, options) => {
    const result = await request<LoggingObservationResult>('/observations', { observations, ...(options?.policyVersion ? { policyVersion: options.policyVersion } : {}) }, options?.signal);
    if (!result || !Number.isSafeInteger(result.accepted) || result.accepted < 0 || result.accepted > observations.length
      || result.admission && (typeof result.admission.policyVersion !== 'string' || !Number.isSafeInteger(result.admission.expiresAt)
        || result.admission.expiresAt <= Date.now() || result.admission.expiresAt > Date.now() + 120000
        || result.admission.policyVersion !== options?.policyVersion)) throw new Error('Invalid logging observation acknowledgment.');
    if (options?.policyVersion && !result.admission) throw new Error('Audit delivery acknowledgment is missing.');
    return result;
  };
  return Object.freeze({
    clear() { generation++; boundary.abort(); boundary = new AbortController(); },
    bindObservations() {
      const epoch = generation, signal = boundary.signal;
      return Object.freeze({ observe(observations, options) {
        if (epoch !== generation || signal.aborted) return Promise.reject(new DOMException('Logging scope changed.', 'AbortError'));
        return observe(observations, { ...options, signal: AbortSignal.any([signal, ...(options?.signal ? [options.signal] : [])]) });
      } } satisfies Pick<LoggingClient, 'observe'>);
    },
    page,
    platformPage,
    observe,
    async collectionPolicy(options) {
      const value = await request<LoggingCollectionPolicy>('/policy', undefined, options?.signal);
      if (!value || typeof value.enabled !== 'boolean' || !value.capture || LOGGING_FAMILIES.some(f => typeof value.capture[f] !== 'boolean')
        || !Number.isSafeInteger(value.heartbeatMs) || value.heartbeatMs < 10000 || value.heartbeatMs > 60000
        || !Number.isSafeInteger(value.idleMs) || value.idleMs < 1000 || value.idleMs > 300000
        || value.durableExports !== undefined && typeof value.durableExports !== 'boolean'
        || value.delivery && (value.delivery.required !== true || typeof value.delivery.policyVersion !== 'string' || !value.delivery.policyVersion || value.delivery.policyVersion.length > 100 || !Number.isSafeInteger(value.delivery.ttlMs)
          || value.delivery.ttlMs < 30000 || value.delivery.ttlMs > 120000 || value.heartbeatMs >= value.delivery.ttlMs)) throw new Error('Invalid logging collection policy.');
      return value;
    },
    health: options => request('/health', undefined, options?.signal),
    evidence: (before, options) => request('/evidence', before === undefined ? {} : { before }, options?.signal),
    hold: (input, options) => request('/holds', input, options?.signal),
    releaseHold: (id, options) => request('/holds/release', { id }, options?.signal),
    review: (input, options) => request('/reviews', input, options?.signal),
    export: (stream, query = {}, options) => request('/export', { stream, query }, options?.signal),
    createExport: async (input, options) => readLoggingExportJob(await request('/exports/create', input, options?.signal)),
    exportJob: async (id, options) => { const value = await request('/exports/status', { id }, options?.signal); return value === null ? null : readLoggingExportJob(value); },
    async downloadExport(id, options) {
      const epoch = generation, signal = AbortSignal.any([boundary.signal, ...(options?.signal ? [options.signal] : [])]);
      const response = await fetch<Response>(LOGGING_API + '/exports/download', { method: 'POST', body: { id }, signal, json: false });
      if (signal.aborted || epoch !== generation) { await response.body?.cancel().catch(() => {}); throw new DOMException('Logging scope changed.', 'AbortError'); }
      const expected = response.headers.get('x-zero-logging-sha256');
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/x-ndjson') || !expected || !/^[a-f0-9]{64}$/.test(expected)) {
        await response.body?.cancel().catch(() => {}); throw new Error('Invalid private export download.');
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (signal.aborted || epoch !== generation) throw new DOMException('Logging scope changed.', 'AbortError');
          if (next.done) break;
          bytes += next.value.byteLength; if (bytes > 8 * 1024 * 1024 + 16384) throw new Error('Export download exceeds its byte budget.');
          chunks.push(next.value);
        }
        const blob = new Blob(chunks as BlobPart[], { type: 'application/x-ndjson' });
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
        if (hash !== expected) throw new Error('Export download failed integrity verification.');
        if (signal.aborted || epoch !== generation) throw new DOMException('Logging scope changed.', 'AbortError');
        return blob;
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { try { reader.releaseLock(); } catch { /* A native cleanup failure must not mask the integrity/read result. */ } }
    },
    verify: (stream, afterOrdinal = 0, checkpoint, options) => request('/verify', { stream, afterOrdinal, ...(checkpoint ? { checkpoint } : {}) }, options?.signal),
    watch(stream, query, listener, options = {}) {
      const epoch = generation, controller = new AbortController(), signal = AbortSignal.any([controller.signal, boundary.signal, ...(options.signal ? [options.signal] : [])]);
      const detached = structuredClone(query);
      const intervalMs = options.intervalMs ?? 3000;
      if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 60000) throw new Error('Invalid logging refresh interval.');
      let timer: ReturnType<typeof setTimeout> | undefined, highWater = -1;
      const poll = async () => {
        try {
          const result = await (options.platform ? platformPage : page)(stream, detached, { signal });
          if (!signal.aborted && epoch === generation) options.onStatus?.('live');
          if (!signal.aborted && epoch === generation && result.highWaterOrdinal !== highWater) { highWater = result.highWaterOrdinal; listener(result); }
        } catch (error) { if (!signal.aborted && epoch === generation) { options.onStatus?.('reconnecting'); options.onError?.(error); } }
        finally { if (!signal.aborted && epoch === generation) timer = setTimeout(() => { void poll(); }, intervalMs); }
      };
      const stop = () => { controller.abort(); clearTimeout(timer); };
      signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
      const consumeStream = async () => {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let failed = false;
        try {
          const response = await fetch<Response>(LOGGING_API + '/stream', { method: 'POST', body: { stream, query: detached, platform: options.platform ?? false }, signal, json: false });
          if (signal.aborted || epoch !== generation) { await response.body?.cancel(); return; }
          if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Invalid logging stream response.');
          reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', eventData = '';
          while (!signal.aborted && epoch === generation) {
            const value = await reader.read(); if (value.done) break;
            if (value.value.byteLength > 1024 * 1024) throw new Error('Logging stream packet is too large.');
            buffer += decoder.decode(value.value, { stream: true });
            if (buffer.length > 1024 * 1024) throw new Error('Logging stream packet is too large.');
            for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
              const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
              if (line.startsWith('data:')) { eventData += line.slice(5).replace(/^ /, '') + '\n'; if (eventData.length > 1024 * 1024) throw new Error('Logging stream event is too large.'); continue; }
              if (line !== '' || !eventData) continue;
              const packet = JSON.parse(eventData); eventData = '';
              if (packet.version !== 1 || packet.error) throw new Error('Logging subscription ended; authority must be rechecked.');
              const page = validatePage(packet.page);
              if (!signal.aborted && epoch === generation) options.onStatus?.('live');
              if (!signal.aborted && epoch === generation && page.highWaterOrdinal !== highWater) { highWater = page.highWaterOrdinal; listener(page); }
            }
          }
        } catch (error) { failed = true; if (!signal.aborted && epoch === generation) { options.onStatus?.('reconnecting'); options.onError?.(error); } }
        finally {
          try { await reader?.cancel(); } catch { /* Cancellation is already represented by the retired generation/error callback. */ }
          if (!signal.aborted && epoch === generation) timer = setTimeout(() => { void consumeStream(); }, failed ? intervalMs : 250);
        }
      };
      if (!signal.aborted) { options.onStatus?.('connecting'); if (options.transport === 'poll') void poll(); else void consumeStream(); } return stop;
    },
  } satisfies LoggingClient);
}
