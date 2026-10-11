/** Authorized SDK adapter over existing HTTP and Sync, never a second socket/provider. */
import type { FetchInit } from './sdk';
import type { Row } from '../../sync/types';
import type { VectorVisualizationAdapter, VectorVisualizationMap, VectorVisualizationSnapshot } from '../../vector/visualization-types';

export interface VectorVisualizationClientOptions {
  enabled: boolean;
  fetch<T>(path: string, init?: FetchInit): Promise<T>;
  boundary(): { key: string; ready: boolean; connected: boolean };
  subscribeBoundary(callback: () => void): () => void;
  /** Optional compatibility source for an external, already bounded snapshot transport. */
  rows?(): Readonly<Record<string, Row>>;
  /** Managed Sync carries only fixed-slot metadata invalidations, never operation history. */
  feed?(): Readonly<Record<string, Row>>;
  subscribeRows(callback: () => void): () => void;
  /** Best-effort, code-only telemetry. Never pass queries, vector values or operation payloads to a sink. */
  reportFailure?(action: 'read' | 'search' | 'ingest' | 'cancel' | 'map' | 'observe'): void;
}
/** An index-bound facade. Attach/read is deliberately separate from start. */
export function createVectorVisualizationClient(options: VectorVisualizationClientOptions, index?: string): VectorVisualizationAdapter {
  const suffix = index === undefined ? '' : `?index=${encodeURIComponent(index)}`;
  const prefix = '/api/vector-visualizations';
  // Only mounted observers retain terminal knowledge, not an unbounded history cache.
  const baselines = new Map<string, Set<(value: VectorVisualizationSnapshot | null) => void>>();
  function capture() {
    const before = options.boundary();
    if (!options.enabled || !before.ready) throw new DOMException('Visualization authority is not ready.', 'AbortError');
    return () => { const current = options.boundary();
      if (!current.ready || before.key !== current.key) throw new DOMException('Visualization authority changed.', 'AbortError'); };
  }
  function report(action: NonNullable<Parameters<NonNullable<VectorVisualizationClientOptions['reportFailure']>>[0]>, error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    try { options.reportFailure?.(action); } catch { /* A best-effort observer cannot change command/state semantics. */ }
  }
  async function request(path: string, init?: FetchInit, action?: Parameters<typeof report>[0]) {
    try { const current = capture(); const value = await options.fetch<unknown>(path, init); current();
      return parseVectorVisualizationSnapshot(value);
    } catch (error) { if (action) report(action, error); throw error; }
  }
  async function read(id: string, cancel: boolean, signal?: AbortSignal) {
    const snapshot = await request(`${prefix}/${encodeURIComponent(id)}${cancel ? '/cancel' : ''}${suffix}`, { ...(cancel ? { method: 'POST' } : {}), signal }, cancel ? 'cancel' : 'read');
    if (snapshot && (snapshot.id !== id || index && snapshot.index !== index)) throw new Error('Visualization identity mismatch.');
    if (!signal?.aborted) for (const note of baselines.get(id) ?? []) note(snapshot);
    return snapshot;
  }
  return Object.freeze({
    get: (id: string, signal?: AbortSignal) => read(id, false, signal),
    search: (input, signal) => request(`${prefix}/search`, { method: 'POST', body: { ...input, ...(index ? { index } : {}) }, signal }, 'search').then(required),
    ingest: (input, signal) => request(`${prefix}/ingest`, { method: 'POST', body: { ...input, ...(index ? { index } : {}) }, signal }, 'ingest').then(required),
    cancel: (id: string, signal?: AbortSignal) => read(id, true, signal),
    async map(requestedIndex?: string, signal?: AbortSignal) {
      try { const current = capture(); const query = requestedIndex ?? index;
        const value = await options.fetch<unknown>(`${prefix}/map${query ? `?index=${encodeURIComponent(query)}` : ''}`, { signal }); current();
        return parseVectorVisualizationMap(value);
      } catch (error) { report('map', error); throw error; }
    },
    subscribe(id: string, listener: (snapshot: VectorVisualizationSnapshot | null) => void, onError?: (error: unknown) => void) {
      const assertCurrent = capture();
      let active = true, revision = -1, reading = false, rerun = false, abort: AbortController | null = null;
      let terminal = false, knownRevision = -1;
      let feedTokens = new Map<string, string>();
      let connection = options.boundary().connected;
      const note = (value: VectorVisualizationSnapshot | null) => {
        if (!active || !value || value.revision < knownRevision) return;
        knownRevision = value.revision;
        terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(value.status);
      };
      const fail = (error: unknown) => {
        if (!active) return;
        try { stop(); } catch { /* A cleanup failure cannot keep a retired observer active. */ }
        report('observe', error); listener(null); onError?.(error);
      };
      const publish = (value: VectorVisualizationSnapshot | null) => {
        assertCurrent(); if (!active) return;
        if (value && (value.id !== id || index && value.index !== index)) throw new Error('Visualization identity mismatch.');
        if (value && value.revision <= revision) return;
        if (value) { revision = value.revision; note(value); }
        listener(value);
      };
      const read = async () => {
        if (!active) return;
        if (reading) { rerun = true; return; }
        reading = true; abort = new AbortController();
        const before = revision;
        try { const snapshot = await request(`${prefix}/${encodeURIComponent(id)}${suffix}`, { signal: abort.signal });
          // A feed change during this read schedules reconciliation; its stale
          // absent baseline must not detach the viewer before that read runs.
          if (snapshot !== null || revision <= before && !rerun) publish(snapshot); }
        catch (error) { if (!abort.signal.aborted) fail(error); }
        finally { reading = false; if (rerun && active) { rerun = false; void read(); } }
      };
      const rows = () => {
        if (!active) return;
        try {
          assertCurrent(); const row = options.rows?.()[id];
          if (row && typeof row.snapshot_json === 'string') publish(parseVectorVisualizationSnapshot(JSON.parse(row.snapshot_json)));
          // Absence is not proof of deletion while a reconnect baseline is in flight.
          if (options.feed) {
            const next = new Map<string, string>();
            for (const [key, signal] of Object.entries(options.feed())) {
              if (index && signal.index_name !== index || typeof signal.change_token !== 'string') continue;
              next.set(key, signal.change_token);
            }
            const changed = next.size !== feedTokens.size || [...next].some(([key, token]) => feedTokens.get(key) !== token);
            feedTokens = next;
            // Completed chat/history cards keep authority listeners, but unrelated
            // future searches must not repeatedly fetch their immutable snapshots.
            if (changed && !terminal) void read();
          }
        } catch (error) { fail(error); }
      };
      const watchers = baselines.get(id) ?? new Set(); watchers.add(note); baselines.set(id, watchers);
      let removeRows = () => {}, removeBoundary = () => {};
      const stop = () => {
        active = false; abort?.abort();
        watchers.delete(note); if (!watchers.size && baselines.get(id) === watchers) baselines.delete(id);
        const rows = removeRows, boundary = removeBoundary; removeRows = () => {}; removeBoundary = () => {};
        try { rows(); } finally { boundary(); }
      };
      try {
        removeRows = options.subscribeRows(rows);
        if (!active) { stop(); return stop; }
        removeBoundary = options.subscribeBoundary(() => {
          if (!active) return;
          try { assertCurrent(); const connected = options.boundary().connected;
            if (connected && !connection) void read(); connection = connected;
          } catch (error) { fail(error); }
        });
        if (!active) { stop(); return stop; }
        // Establish the current feed baseline without refetching every historical
        // operation. attach/get owns the initial read; changes and reconnects reconcile it.
        if (options.feed) for (const [key, signal] of Object.entries(options.feed())) {
          if ((!index || signal.index_name === index) && typeof signal.change_token === 'string') feedTokens.set(key, signal.change_token);
        }
        rows();
      } catch (error) { stop(); throw error; }
      return stop;
    },
  } satisfies VectorVisualizationAdapter);
}
function required(value: VectorVisualizationSnapshot | null): VectorVisualizationSnapshot {
  if (!value) throw new Error('Missing accepted vector visualization.'); return value;
}

const statuses = new Set(['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'skipped', 'interrupted']);
const stageIds = new Set(['accept', 'chunk', 'embed', 'enrich', 'index', 'query', 'retrieve', 'lexical', 'fusion', 'rerank']);
const scoreKinds = new Set(['cosine', 'distance', 'inner-product', 'lexical', 'fusion', 'rerank']);
/** Bound and verify public transport data before it reaches the rendering/controller boundary. */
export function parseVectorVisualizationSnapshot(value: unknown): VectorVisualizationSnapshot | null {
  if (value === null) return null;
  assertSafeJson(value);
  if (!record(value) || !text(value.id, 128) || !text(value.index, 128)
    || !oneOf(value.kind, ['search', 'ingestion']) || !status(value.status)
    || !integer(value.revision, 1) || !text(value.createdAt, 64) || !text(value.updatedAt, 64)
    || !list(value.stages, 32, stage) || !uniqueIds(value.stages)
    || !optional(value.map, validMap) || !optional(value.query, query)
    || !optional(value.ingestion, ingestion) || !optional(value.candidates, candidates)
    || !optional(value.results, candidates) || !optional(value.trace, trace)
    || !optional(value.error, failure) || !optional(value.warnings, warnings => list(warnings, 32, failure))) {
    throw new Error('Invalid vector visualization snapshot.');
  }
  return value as unknown as VectorVisualizationSnapshot;
}
/** Validate standalone maps with the same nested contract used by operation snapshots. */
export function parseVectorVisualizationMap(value: unknown): VectorVisualizationMap {
  assertSafeJson(value);
  if (!validMap(value)) throw new Error('Invalid vector visualization map.');
  return value as VectorVisualizationMap;
}
/** These structural predicates run only after accessor/prototype/budget admission. */
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max: number, min = 1): value is string { return typeof value === 'string' && value.length >= min && value.length <= max; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max; }
function boolean(value: unknown): value is boolean { return typeof value === 'boolean'; }
function optional(value: unknown, validate: (value: unknown) => boolean): boolean { return value === undefined || validate(value); }
function oneOf(value: unknown, values: readonly string[]): boolean { return typeof value === 'string' && values.includes(value); }
function status(value: unknown): boolean { return typeof value === 'string' && statuses.has(value); }
function dimensions(value: unknown): boolean { return integer(value, 1, 8192); }
function count(value: unknown): boolean { return finite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER; }
function list(value: unknown, max: number, validate: (value: unknown) => boolean): value is unknown[] {
  if (!Array.isArray(value) || value.length > max) return false;
  // Index iteration rejects sparse holes rather than letting Array#every skip them.
  for (let index = 0; index < value.length; index++) if (!validate(value[index])) return false;
  return true;
}
function uniqueIds(value: readonly unknown[]): boolean { return new Set(value.map(item => (item as Record<string, unknown>).id)).size === value.length; }
function source(value: unknown): boolean { return record(value) && text(value.label, 512) && optional(value.id, id => text(id, 1024)) && optional(value.abbreviation, abbreviation => text(abbreviation, 64, 0)); }
function position(value: unknown): boolean { return record(value) && finite(value.x) && finite(value.y); }
function preview(value: unknown): boolean { return list(value, 8192, finite); }
function stage(value: unknown): boolean {
  return record(value) && text(value.id, 64) && text(value.label, 128) && status(value.status)
    && optional(value.completed, count) && optional(value.total, count)
    && optional(value.startedAt, date => text(date, 64)) && optional(value.completedAt, date => text(date, 64));
}
function validMap(value: unknown): boolean {
  return record(value) && text(value.projectionId, 128) && integer(value.revision, 1)
    && oneOf(value.projectionKind, ['pca', 'provided']) && dimensions(value.dimensions)
    && optional(value.model, model => text(model, 1024)) && optional(value.totalRecords, integer)
    && record(value.capabilities) && boolean(value.capabilities.nativeTraversal) && boolean(value.capabilities.liveUpdates)
    && oneOf(value.capabilities.graph, ['native', 'derived-neighbors', 'none'])
    && list(value.points, 512, point) && uniqueIds(value.points)
    && list(value.clusters, 512, cluster => record(cluster) && text(cluster.id, 1024) && text(cluster.label, 512)) && uniqueIds(value.clusters);
}
function point(value: unknown): boolean {
  return record(value) && text(value.id, 1024) && text(value.title, 512) && position(value.position)
    && optional(value.clusterId, id => text(id, 1024)) && optional(value.source, source)
    && optional(value.neighborIds, ids => list(ids, 512, id => text(id, 1024))) && optional(value.kind, kind => oneOf(kind, ['stored', 'new']));
}
function score(value: unknown): boolean {
  return record(value) && finite(value.value) && typeof value.kind === 'string' && scoreKinds.has(value.kind)
    && oneOf(value.direction, ['higher', 'lower']);
}
function candidates(value: unknown): boolean {
  return list(value, 200, item => record(item) && text(item.id, 1024) && text(item.title, 512)
    && optional(item.source, source) && optional(item.clusterId, id => text(id, 1024)) && optional(item.text, body => text(body, 65536, 0))
    && integer(item.rank, 1) && integer(item.foundRank, 1) && boolean(item.returned) && score(item.score)
    && optional(item.scores, scores => list(scores, 32, score))) && uniqueIds(value);
}
function query(value: unknown): boolean {
  return record(value) && text(value.text, 65536, 0) && oneOf(value.retrieval, ['vector', 'hybrid']) && boolean(value.rerank)
    && integer(value.topK, 1) && optional(value.candidateCount, candidateCount => integer(candidateCount, 1))
    && optional(value.dimensions, dimensions) && optional(value.model, model => text(model, 1024))
    && optional(value.embeddingPreview, preview) && optional(value.position, position);
}
function document(value: unknown): boolean {
  return record(value) && text(value.id, 1024) && text(value.title, 512) && optional(value.text, body => text(body, 240000, 0))
    && optional(value.source, source) && optional(value.clusterId, id => text(id, 1024));
}
function metadata(value: unknown): boolean {
  if (!record(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 64 && entries.every(([key, item]) => text(key, 128)
    && (item === null || boolean(item) || finite(item) || text(item, 65536, 0)));
}
function chunk(value: unknown): boolean {
  return record(value) && text(value.id, 1024) && text(value.documentId, 1024) && integer(value.index)
    && text(value.text, 240000, 0) && optional(value.section, section => text(section, 65536, 0))
    && integer(value.start) && integer(value.end) && value.end >= value.start && integer(value.overlapChars)
    && integer(value.tokenCount) && boolean(value.tokenCountApproximate) && status(value.status)
    && optional(value.stageId, id => typeof id === 'string' && stageIds.has(id)) && optional(value.attempt, integer)
    && optional(value.dimensions, dimensions) && optional(value.embeddingPreview, preview)
    && optional(value.metadata, metadata) && optional(value.storedAt, date => text(date, 64));
}
function ingestion(value: unknown): boolean {
  return record(value) && document(value.document) && optional(value.sourceRevision, revision => text(revision, 1024))
    && list(value.chunks, 128, chunk) && uniqueIds(value.chunks) && integer(value.completedChunks) && integer(value.tokenCount)
    && boolean(value.tokenCountApproximate) && optional(value.currentChunkId, id => text(id, 1024));
}
function trace(value: unknown): boolean {
  return record(value) && oneOf(value.provenance, ['native', 'illustrative']) && list(value.visitedIds, 4096, id => text(id, 1024))
    && optional(value.edges, edges => list(edges, 8192, edge => record(edge) && text(edge.from, 1024) && text(edge.to, 1024)))
    && optional(value.comparisons, integer);
}
function failure(value: unknown): boolean {
  return record(value) && text(value.code, 128) && text(value.message, 8192) && optional(value.retryable, boolean) && optional(value.outcomeUnknown, boolean);
}
function assertSafeJson(value: unknown): void {
  let nodes = 0, bytes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 30000 || depth > 16) throw new Error('Vector visualization response exceeds limits.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw new Error('Non-finite vector visualization value.'); return; }
    if (typeof item === 'string') { bytes += item.length * 3; if (bytes > 720000) throw new Error('Vector visualization response exceeds limits.'); return; }
    if (!item || typeof item !== 'object') throw new Error('Invalid vector visualization data.');
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('Invalid vector visualization data.');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') throw new Error('Invalid vector visualization symbol.');
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor)) throw new Error('Invalid vector visualization accessor.');
      // Nonenumerable DTO fields must not hide an accessor-bearing nested object.
      bytes += key.length * 3;
      if (bytes > 720000) throw new Error('Vector visualization response exceeds limits.');
      visit(descriptor.value, depth + 1);
    }
  }; visit(value, 0);
}
