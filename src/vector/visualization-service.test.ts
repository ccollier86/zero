/** Controlled provider/native adapters qualify the real durable coordinator without live credentials. */
import { describe, expect, test } from 'bun:test';
import type { AIService } from '../ai/ai-service';
import { VectorError } from './vector-error';
import type { StoredVectorRecord, VectorQueryOptions, VectorRecord, VectorWriteResult } from './vector-types';
import { VectorVisualizationService, type VectorVisualizationServiceOptions } from './visualization-service';
import type { VectorVisualizationStore } from './visualization-store';
import type { VectorVisualizationSnapshot } from './visualization-types';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function memoryStore() {
  const snapshots = new Map<string, VectorVisualizationSnapshot>();
  const receipts: VectorVisualizationSnapshot[] = [];
  const store: VectorVisualizationStore = {
    async create(snapshot) {
      if (snapshots.has(snapshot.id)) throw new VectorError('VECTOR_OPERATION_FAILED', 'Conflict');
      snapshots.set(snapshot.id, clone(snapshot)); receipts.push(clone(snapshot)); return clone(snapshot);
    },
    async get(id) { return clone(snapshots.get(id) ?? null); },
    async list(index, limit = 20) { return [...snapshots.values()].filter(row => row.index === index).slice(0, limit).map(clone); },
    async compareAndSwap(id, revision, next) {
      const old = snapshots.get(id);
      if (!old || old.revision !== revision || ['completed', 'cancelled', 'failed', 'interrupted'].includes(old.status)) {
        throw new VectorError('VECTOR_OPERATION_FAILED', 'Conflict');
      }
      snapshots.set(id, clone(next)); receipts.push(clone(next)); return clone(next);
    },
  };
  return { store, snapshots, receipts };
}

function fixture(overrides: Partial<VectorVisualizationServiceOptions> = {}) {
  const persistence = memoryStore();
  const calls = { embed: 0, embedMany: 0, rerank: 0, queries: [] as VectorQueryOptions[],
    writes: [] as VectorRecord[][], providerDocuments: [] as string[][] };
  const records = new Map<string, StoredVectorRecord>([
    ['z-dense', { id: 'z-dense', text: 'Dense actual body', vector: [1, 0, 0], metadata: { title: 'Dense', password: 'must-not-leak' } }],
    ['both', { id: 'both', text: 'Shared actual body', vector: [.6, .8, 0], metadata: { title: 'Shared', api_key: 'must-not-leak' } }],
    ['a-lexical', { id: 'a-lexical', text: 'Lexical actual body', vector: [0, 0, 1], metadata: { title: 'Lexical', secret: 'must-not-leak' } }],
  ]);
  const ai = {
    async embed() { calls.embed++; return { embedding: [1, 0, 0] }; },
    async embedMany(request: { values: readonly string[] }) {
      calls.embedMany++; return { embeddings: request.values.map(() => [1, 0, 0]) };
    },
    async rerank(request: { documents: readonly string[]; topN: number }) {
      calls.rerank++; calls.providerDocuments.push([...request.documents]);
      return { ranking: request.documents.map((document, originalIndex) => ({ document, originalIndex, score: originalIndex + 1 }))
        .reverse().slice(0, request.topN) };
    },
  } as unknown as Pick<AIService, 'embed' | 'embedMany' | 'rerank'>;
  const vectors: VectorVisualizationServiceOptions['vectors'] = {
    async query(options) {
      calls.queries.push(clone(options));
      const ids = options.retrieval === 'lexical' ? ['a-lexical', 'both']
        : options.vector ? ['z-dense', 'both'] : [...records.keys()];
      return ids.slice(0, options.topK).flatMap(id => records.has(id) ? [clone(records.get(id)!)] : []);
    },
    async fetch(ids) { return (typeof ids === 'string' ? [ids] : ids).flatMap(id => records.has(id) ? [clone(records.get(id)!)] : []); },
    async upsert(value) {
      const batch = Array.isArray(value) ? value : [value];
      calls.writes.push(clone(batch));
      batch.forEach(record => records.set(record.id, { ...clone(record), vector: Array.from(record.vector), metadata: clone(record.metadata ?? {}) }));
      return { ok: true, count: batch.length, errors: [] };
    },
  };
  const options: VectorVisualizationServiceOptions = { index: 'docs', scopeId: 'tenant:a', dimensions: 3,
    ai, vectors, store: persistence.store, lexicalEnabled: true, assertCurrentAuthority() {},
    emitCode: (() => null) as unknown as NonNullable<VectorVisualizationServiceOptions['emitCode']>,
    ...overrides };
  return { ...persistence, records, calls, options, service: new VectorVisualizationService(options) };
}

describe('VectorVisualizationService', () => {
  for (const retrieval of ['vector', 'hybrid'] as const) for (const rerank of [false, true]) {
    test(`executes real ${retrieval} retrieval with rerank=${rerank}, preserving backend identities and score provenance`, async () => {
      const f = fixture({ metadataFields: ['title', 'text'] });
      const result = await f.service.search({ text: 'Actual query', retrieval, rerank, topK: 2, candidateCount: 2 });
      expect(result.status).toBe('completed');
      expect(f.calls.embed).toBe(1); expect(f.calls.rerank).toBe(rerank ? 1 : 0);
      expect(f.calls.queries.filter(call => call.retrieval === 'lexical')).toHaveLength(retrieval === 'hybrid' ? 1 : 0);
      expect(result.stages.find(stage => stage.id === 'lexical')?.status).toBe(retrieval === 'hybrid' ? 'completed' : 'skipped');
      expect(result.stages.find(stage => stage.id === 'rerank')?.status).toBe(rerank ? 'completed' : 'skipped');
      expect(result.results).toHaveLength(2);
      expect(result.results?.map(row => row.rank)).toEqual([1, 2]);
      expect(result.results?.every(row => row.returned)).toBe(true);
      expect(result.results?.[0]?.score.kind).toBe(rerank ? 'rerank' : retrieval === 'hybrid' ? 'fusion' : 'cosine');
      if (retrieval === 'hybrid') expect(result.results?.some(row => row.id === 'a-lexical')).toBe(true);
      expect(result.map?.capabilities.nativeTraversal).toBe(false);
      expect(result.trace).toBeUndefined();
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('must-not-leak'); expect(serialized).not.toContain('"vector":');
      expect(result.query?.embeddingPreview).toEqual([1, 0, 0]);
      if (rerank) expect(f.calls.providerDocuments[0]?.every(text => text.includes('actual body'))).toBe(true);
    });
  }

  test('requires explicit metadata/text visibility without copying native backup metadata', async () => {
    const f = fixture();
    const result = await f.service.search({ text: 'query', topK: 1 });
    expect(result.results?.[0]?.title).toBe('z-dense');
    expect(result.results?.[0]?.text).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('Dense actual body');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  test('ingests actual chunks and increments only after native acknowledgements; retries and changed content keep correct identities', async () => {
    const f = fixture({ chunk: { maxChars: 64, maxTokens: 64, overlapChars: 8 }, metadataFields: ['title'] });
    const input = { document: { id: 'doc:a', title: 'Source A', text: 'First sentence. '.repeat(14) }, sourceRevision: 'revision:a' };
    const first = await f.service.ingest(input);
    expect(first.status).toBe('completed');
    expect(first.ingestion!.completedChunks).toBe(first.ingestion!.chunks.length);
    expect(first.ingestion!.chunks.length).toBeGreaterThan(1);
    expect(first.ingestion!.chunks.every(chunk => chunk.storedAt && chunk.status === 'completed')).toBe(true);
    expect(f.receipts.filter(row => row.ingestion?.completedChunks).every(row => row.ingestion!.chunks.filter(chunk => chunk.storedAt).length === row.ingestion!.completedChunks)).toBe(true);
    expect(first.stages.find(stage => stage.id === 'enrich')?.status).toBe('skipped');
    const retry = await f.service.ingest(input);
    expect(retry.ingestion!.chunks.map(chunk => chunk.id)).toEqual(first.ingestion!.chunks.map(chunk => chunk.id));
    const changed = await f.service.ingest({ ...input, document: { ...input.document, text: 'Changed sentence. '.repeat(14) } });
    expect(changed.ingestion!.chunks[0]?.id).not.toBe(first.ingestion!.chunks[0]?.id);
    const otherVersion = await f.service.ingest({ ...input, sourceRevision: 'revision:b' });
    expect(otherVersion.ingestion!.chunks[0]?.id).not.toBe(first.ingestion!.chunks[0]?.id);
    expect(f.records.has(first.ingestion!.chunks[0]!.id)).toBe(true);
    const withOtherPolicy = new VectorVisualizationService({ ...f.options, chunk: { maxChars: 80, maxTokens: 64, overlapChars: 8 } });
    const resplit = await withOtherPolicy.ingest(input);
    expect(resplit.ingestion!.chunks[0]?.id).not.toBe(first.ingestion!.chunks[0]?.id);
  });

  test('empty source and empty index complete without fabricated embeddings or stored rows', async () => {
    const f = fixture(); f.records.clear();
    const result = await f.service.ingest({ document: { id: 'empty', title: 'Empty', text: '' } });
    expect(result.status).toBe('completed'); expect(result.ingestion?.chunks).toEqual([]);
    expect(result.ingestion?.completedChunks).toBe(0); expect(result.map?.points).toEqual([]);
    expect(f.calls.embedMany).toBe(0); expect(f.calls.writes).toHaveLength(0);
  });

  test('zero-variance bootstrap maps fit once useful stored variance exists, then retain that projection', async () => {
    const f = fixture(); f.records.clear();
    f.options.ai.embedMany = (async (request: { values: readonly string[] }) => ({ embeddings: request.values.map(text => text === 'A' ? [1, 0, 0] : [0, 1, 0]) })) as unknown as typeof f.options.ai.embedMany;
    await f.service.ingest({ document: { id: 'a', title: 'A', text: 'A' } });
    const first = await f.service.map(); expect(first.points[0]!.position).toEqual({ x: 0, y: 0 });
    await f.service.ingest({ document: { id: 'b', title: 'B', text: 'B' } });
    const fitted = await f.service.map();
    expect(fitted.points[0]!.position).not.toEqual(fitted.points[1]!.position);
    expect(fitted.projectionId).not.toBe(first.projectionId);
    const search = await f.service.search({ text: 'query', topK: 1 });
    expect(search.status).toBe('completed'); expect((await f.service.map()).projectionId).toBe(fitted.projectionId);
  });

  test('Torrent attempt fence is additive and prevents effects after an otherwise-authorized provider wait', async () => {
    const waiting = deferred<{ embeddings: number[][] }>(); const entered = deferred<void>(); let attemptCurrent = true;
    const f = fixture();
    f.options.ai.embedMany = (async () => { entered.resolve(); return waiting.promise; }) as unknown as typeof f.options.ai.embedMany;
    const started = await f.service.startIngest({ document: { id: 'd', title: 'D', text: 'Body' } }, {
      authorityFence() { if (!attemptCurrent) throw new Error('private-attempt-details'); },
    });
    await entered.promise; attemptCurrent = false; waiting.resolve({ embeddings: [[1, 0, 0]] });
    const error = await started.completion.catch(error => error);
    expect(error.code).toBe('VECTOR_SCOPE_CONFLICT'); expect(f.calls.writes).toHaveLength(0);
    expect((await f.store.get(started.snapshot.id))?.status).not.toBe('completed');
  });

  test('accepted handles return before a provider and cancellation settles even if that provider ignores abort', async () => {
    const waiting = deferred<{ embeddings: number[][] }>(); const entered = deferred<void>();
    const f = fixture();
    f.options.ai.embedMany = (async () => { entered.resolve(); return waiting.promise; }) as unknown as typeof f.options.ai.embedMany;
    const started = await f.service.startIngest({ operationId: 'cancel:embed', document: { id: 'd', title: 'D', text: 'Body' } });
    expect(started.snapshot.status).toBe('pending'); await entered.promise;
    const cancelled = await f.service.cancel(started.snapshot.id);
    expect(cancelled?.status).toBe('cancelled');
    expect((await started.completion).status).toBe('cancelled');
    expect(f.calls.writes).toHaveLength(0);
    waiting.resolve({ embeddings: [[1, 0, 0]] }); await Promise.resolve();
    expect(f.calls.writes).toHaveLength(0);
  });

  test('another service cancellation fences late embeddings before the native effect', async () => {
    const waiting = deferred<{ embeddings: number[][] }>(); const entered = deferred<void>();
    const f = fixture();
    f.options.ai.embedMany = (async () => { entered.resolve(); return waiting.promise; }) as unknown as typeof f.options.ai.embedMany;
    const started = await f.service.startIngest({ operationId: 'cancel:other', document: { id: 'd', title: 'D', text: 'Body' } });
    await entered.promise;
    const other = new VectorVisualizationService(f.options);
    expect((await other.cancel(started.snapshot.id))?.status).toBe('cancelled');
    waiting.resolve({ embeddings: [[1, 0, 0]] });
    expect((await started.completion).status).toBe('cancelled'); expect(f.calls.writes).toHaveLength(0);
  });

  test('cancel during native I/O reports unknown outcome, never counts an unreceived acknowledgement', async () => {
    const write = deferred<VectorWriteResult>(); const entered = deferred<void>();
    const f = fixture();
    f.options.vectors.upsert = async () => { entered.resolve(); return write.promise; };
    const started = await f.service.startIngest({ document: { id: 'd', title: 'D', text: 'Body' } });
    await entered.promise; const cancelled = await f.service.cancel(started.snapshot.id);
    expect(cancelled?.error?.outcomeUnknown).toBe(true); expect(cancelled?.ingestion?.completedChunks).toBe(0);
    expect((await started.completion).status).toBe('cancelled');
    write.resolve({ ok: true, count: 1, errors: [] }); await Promise.resolve();
    expect((await f.service.get(started.snapshot.id))?.ingestion?.completedChunks).toBe(0);
  });

  test('records known partial acknowledgements but rejects unknown per-record outcomes', async () => {
    const f = fixture({ chunk: { maxChars: 12, maxTokens: 64, overlapChars: 0 } });
    f.options.vectors.upsert = async input => {
      const records = Array.isArray(input) ? input : [input];
      return { ok: false, count: 1, errors: records.slice(1).map(record => ({ id: record.id, code: 'failure', message: 'private-provider-details' })) };
    };
    const known = await f.service.ingest({ document: { id: 'd', title: 'D', text: 'abcdefghijklmno' } });
    expect(known.status).toBe('failed'); expect(known.ingestion?.completedChunks).toBe(1);
    expect(known.ingestion?.chunks.filter(chunk => chunk.storedAt)).toHaveLength(1);
    expect(JSON.stringify(known)).not.toContain('private-provider-details');
    f.options.vectors.upsert = async () => ({ ok: true, count: 0, errors: [] });
    const unknown = await f.service.ingest({ document: { id: 'e', title: 'E', text: 'body' } });
    expect(unknown.status).toBe('failed'); expect(unknown.error?.outcomeUnknown).toBe(true);
    expect(unknown.ingestion?.completedChunks).toBe(0);
  });

  test('missing/mismatched embeddings fail safely and do not orphan later operations', async () => {
    const f = fixture();
    f.options.ai.embedMany = (async () => ({ embeddings: [[1, 0]] })) as unknown as typeof f.options.ai.embedMany;
    const failed = await f.service.ingest({ document: { id: 'd', title: 'D', text: 'Body' } });
    expect(failed.status).toBe('failed'); expect(failed.error?.code).toBe('VECTOR_DIMENSION_MISMATCH');
    expect(f.calls.writes).toHaveLength(0);
    f.options.ai.embedMany = (async () => ({ embeddings: [[1, 0, 0]] })) as unknown as typeof f.options.ai.embedMany;
    expect((await f.service.ingest({ document: { id: 'e', title: 'E', text: 'Body' } })).status).toBe('completed');
  });

  test('corrupt optional maps cannot erase real search or ingestion success', async () => {
    const f = fixture({ maps: { async get() { throw new Error('private-map-path'); }, async put() { throw new Error('private-map-path'); } } });
    const search = await f.service.search({ text: 'query' });
    expect(search.status).toBe('completed'); expect(search.results?.length).toBeGreaterThan(0);
    expect(search.map).toBeUndefined(); expect(search.query?.position).toBeUndefined();
    expect(search.warnings).toHaveLength(1); expect(JSON.stringify(search)).not.toContain('private-map-path');
    const ingestion = await f.service.ingest({ document: { id: 'd', title: 'D', text: 'Body' } });
    expect(ingestion.status).toBe('completed'); expect(ingestion.ingestion?.completedChunks).toBe(1);
    expect(ingestion.warnings).toHaveLength(1);
  });

  test('actual enrichment gates indexing, receives detached accepted chunks, and preserves allowlisted source identity', async () => {
    const waiting = deferred<readonly Record<string, string>[]>(); const entered = deferred<void>();
    const f = fixture({ metadataFields: ['title', 'source_label', 'source_id', 'source_abbreviation', 'keywords'],
      async enrich(chunks) {
        expect(chunks[0]?.dimensions).toBe(3); expect(chunks[0]?.stageId).toBe('enrich');
        chunks[0]!.text = 'Accidental callback mutation'; entered.resolve(); return waiting.promise;
      } });
    const started = await f.service.startIngest({ document: { id: 'd', title: 'D', text: 'Actual source body',
      source: { id: 'github', label: 'GitHub', abbreviation: 'GH' } } });
    await entered.promise; expect(f.calls.writes).toHaveLength(0);
    expect((await f.service.get(started.snapshot.id))?.stages.find(stage => stage.id === 'enrich')?.status).toBe('waiting');
    waiting.resolve([{ keywords: 'actual, source' }]);
    const result = await started.completion;
    expect(result.status).toBe('completed'); expect(f.calls.writes[0]?.[0]?.text).toBe('Actual source body');
    const point = result.map?.points.find(point => point.id === result.ingestion?.chunks[0]?.id);
    expect(point?.source).toEqual({ id: 'github', label: 'GitHub', abbreviation: 'GH' });
    expect(result.ingestion?.chunks[0]?.metadata?.keywords).toBe('actual, source');
    const redacted = new VectorVisualizationService({ ...f.options, metadataFields: ['source_label'] });
    expect((await redacted.map()).points.find(item => item.id === result.ingestion?.chunks[0]?.id)?.source?.id).toBeUndefined();
  });

  test('progress publication failure after acknowledged native storage cannot pretend successful completion', async () => {
    const f = fixture(); const compare = f.store.compareAndSwap; let fail = true;
    f.store.compareAndSwap = async (id, revision, next) => {
      if (fail && next.ingestion?.completedChunks === 1) { fail = false; throw new Error('private-receipt-path'); }
      return compare(id, revision, next);
    };
    const result = await f.service.ingest({ document: { id: 'd', title: 'D', text: 'Body' } });
    expect(f.calls.writes).toHaveLength(1); expect(result.status).toBe('failed');
    expect(result.error?.outcomeUnknown).toBe(true); expect(JSON.stringify(result)).not.toContain('private-receipt-path');
    expect((await f.service.get(result.id))?.status).toBe('failed');
  });

  test('same operation identity replays without work and rejects changed request semantics', async () => {
    const f = fixture(); const input = { operationId: 'retry:same', text: 'query', candidateCount: 20 };
    const first = await f.service.search(input); const second = await f.service.search(input);
    expect(second).toEqual(first); expect(f.calls.embed).toBe(1);
    await expect(f.service.search({ ...input, candidateCount: 21 })).rejects.toBeInstanceOf(VectorError);
    const document = { operationId: 'retry:doc', sourceRevision: 'a', document: { id: 'd', title: 'D', text: 'Body' } };
    await f.service.ingest(document);
    await expect(f.service.ingest({ ...document, sourceRevision: 'b' })).rejects.toBeInstanceOf(VectorError);
  });

  test('started completion itself fails closed after authority loss; no provider error details are delivered', async () => {
    const waiting = deferred<{ embedding: number[] }>(); const entered = deferred<void>(); let allowed = true;
    const f = fixture({ assertCurrentAuthority() { if (!allowed) throw new Error('private-authority-secret'); } });
    f.options.ai.embed = (async () => { entered.resolve(); return waiting.promise; }) as unknown as typeof f.options.ai.embed;
    const started = await f.service.startSearch({ text: 'query' }); await entered.promise;
    allowed = false; waiting.resolve({ embedding: [1, 0, 0] });
    const error = await started.completion.catch(error => error);
    expect(error).toBeInstanceOf(VectorError); expect(error.code).toBe('VECTOR_SCOPE_CONFLICT');
    expect(error.message).not.toContain('private-authority-secret');
    expect((await f.store.get(started.snapshot.id))?.status).not.toBe('completed');
    await f.service.dispose();
  });

  test('disposed cross-instance observers stop without cancelling the original durable operation', async () => {
    const waiting = deferred<{ embedding: number[] }>(); const entered = deferred<void>();
    const f = fixture();
    f.options.ai.embed = (async () => { entered.resolve(); return waiting.promise; }) as unknown as typeof f.options.ai.embed;
    const first = await f.service.startSearch({ operationId: 'observe:same', text: 'query' }); await entered.promise;
    expect(f.service.ownsOperation(first.snapshot.id)).toBe(true);
    const observer = new VectorVisualizationService(f.options);
    const replay = await observer.startSearch({ operationId: 'observe:same', text: 'query' });
    expect(observer.ownsOperation(first.snapshot.id)).toBe(false);
    await observer.dispose(); expect(await replay.completion.catch(error => error)).toBeInstanceOf(Error);
    expect((await f.store.get(first.snapshot.id))?.status).not.toBe('cancelled');
    waiting.resolve({ embedding: [1, 0, 0] }); expect((await first.completion).status).toBe('completed');
    expect(f.service.ownsOperation(first.snapshot.id)).toBe(false);
    expect(f.calls.queries.filter(call => call.vector)).toHaveLength(1);
  });

  test('accessors, scope/index injection and unsupported retrieval fail before provider execution', async () => {
    const f = fixture({ lexicalEnabled: false }); let accessed = 0;
    const input = { get text() { accessed++; return 'secret'; } };
    await expect(f.service.search(input)).rejects.toBeInstanceOf(VectorError); expect(accessed).toBe(0);
    await expect(f.service.search({ text: 'q', index: 'other' })).rejects.toBeInstanceOf(VectorError);
    await expect(f.service.search({ text: 'q', retrieval: 'hybrid' })).rejects.toBeInstanceOf(VectorError);
    await expect(f.service.search({ text: 'q', tenantId: 'other' } as never)).rejects.toBeInstanceOf(VectorError);
    expect(f.calls.embed).toBe(0);
  });
});
