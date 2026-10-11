import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import { resolveVectorConfig } from './vector-config';
import { VectorRegistry } from './vector-registry';
import { VectorService } from './vector-service';
import { ZvecAdapter } from './zvec-adapter';
import type { ZVecDoc, ZVecFieldSchema } from '@zvec/zvec';

async function fixture(options: { lexical?: boolean; existing?: boolean; indexed?: number; readOnly?: boolean; textField?: string } = {}) {
  const scratch = process.platform === 'darwin' ? '/Volumes/code-bank/tmp/scratch/zero-platform' : tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'vector-lexical-'));
  const path = join(root, 'index');
  if (options.existing) { await mkdir(path); await writeFile(join(path, 'manifest.1'), 'fixture'); }
  const resolved = resolveVectorConfig({ indexes: { default: { dimensions: 2, path, lexical: options.lexical ?? true, readOnly: options.readOnly, textField: options.textField,
    ...(options.textField && options.textField !== 'text' ? { metadata: { text: { type: 'string', indexed: true } } } : {}) } } }, {});
  if (!resolved) throw new Error('Expected fixture config');
  const field = { name: 'text', dataType: 2, ...(options.indexed ? { indexParams: { indexType: options.indexed } } : {}) } as ZVecFieldSchema;
  const collection = {
    schema: { field: () => field }, stats: { docCount: 0, indexCompleteness: {} },
    lastQuery: undefined as any, lastMulti: undefined as any, lastCreate: undefined as any,
    lastFetch: undefined as any, fetchResults: {} as Record<string, any>,
    results: [{ id: 'lexical-only', score: 0.1, fields: { text: 'Exact marker', _metadata: '{"tenantId":"mine"}' } }] as Array<Pick<ZVecDoc, 'id' | 'score' | 'fields'>>,
    closed: false,
    async query(input: any) { this.lastQuery = input; return this.results; },
    async multiQuery(input: any) { this.lastMulti = input; return this.results; },
    fetchSync(input: any) { this.lastFetch = input; return this.fetchResults; },
    createIndexSync(input: any) { this.lastCreate = input; },
    closeSync() { this.closed = true; },
  };
  let createdSchema: any;
  const module = {
    ZVecDataType: { STRING: 2, BOOL: 3, DOUBLE: 9, VECTOR_FP32: 23 },
    ZVecIndexType: { HNSW: 1, IVF: 2, FLAT: 3, DISKANN: 5, INVERT: 10, FTS: 11 },
    ZVecMetricType: { L2: 1, IP: 2, COSINE: 3 },
    ZVecCollectionSchema: class { constructor(readonly params: any) { createdSchema = params; } },
    ZVecCreateAndOpen: () => collection, ZVecOpen: () => collection,
  };
  const adapter = new ZvecAdapter({ config: resolved.indexes.default!, loader: async () => module as any, emitCode: () => undefined as never });
  return { adapter, collection, resolved, schema: () => createdSchema, cleanup: async () => { await adapter.dispose(); await rm(root, { recursive: true, force: true }); } };
}

describe('native full-corpus lexical/hybrid retrieval', () => {
  it('keeps dense default schemas unchanged and lexical indexes explicitly opt in', async () => {
    const f = await fixture({ lexical: false });
    try {
      await f.adapter.query({ vector: [1, 0] });
      expect(f.schema().fields.find((field: any) => field.name === 'text').indexParams).toBeUndefined();
      await expect(f.adapter.query({ text: 'literal' })).rejects.toMatchObject({ code: 'VECTOR_CONFIG_INVALID' });
      expect(f.collection.lastMulti).toBeUndefined();
      expect(() => resolveVectorConfig({ indexes: { default: { dimensions: 2, lexical: 'yes' as any } } }, {})).toThrow();
    } finally { await f.cleanup(); }
  });
  it('searches literal full-corpus text and never feeds text into the engine filter language', async () => {
    const f = await fixture();
    try {
      const rows = await f.adapter.query({ text: '"word" OR tenantId:other', filter: { tenantId: 'mine' }, topK: 3 });
      expect(f.schema().fields.find((field: any) => field.name === 'text').indexParams).toEqual({ indexType: 11, tokenizerName: 'standard', filters: ['lowercase'] });
      expect(f.collection.lastQuery).toMatchObject({ fieldName: 'text', fts: { matchString: '"word" OR tenantId:other' }, filter: "(tenantId = 'mine')", topk: 3, params: { indexType: 11 } });
      expect(f.collection.lastQuery.vector).toBeUndefined();
      expect(rows.map(row => row.id)).toEqual(['lexical-only']);
    } finally { await f.cleanup(); }
  });
  it('unions native vector and FTS candidates with one shared pre-filter and RRF', async () => {
    const f = await fixture();
    try {
      const rows = await f.adapter.query({ text: 'marker', vector: [1, 0], retrieval: 'hybrid', topK: 4, candidateCount: 20, rankConstant: 42, filter: { tenantId: 'mine' } });
      expect(f.collection.lastMulti).toMatchObject({
        queries: [{ fieldName: 'embedding', vector: [1, 0], numCandidates: 20 }, { fieldName: 'text', fts: { matchString: 'marker' }, numCandidates: 20 }],
        filter: "(tenantId = 'mine')", topk: 4, rerank: { type: 'rrf', rankConstant: 42 },
      });
      expect(f.collection.lastQuery).toBeUndefined();
      expect(rows.map(row => row.id)).toEqual(['lexical-only']);
    } finally { await f.cleanup(); }
  });
  it('hydrates native FTS vectors from current records while retaining only lexical order and score', async () => {
    const f = await fixture();
    try {
      f.collection.results = [
        { id: 'b', score: 0.7, fields: { text: 'old b', _metadata: '{"tenantId":"mine","title":"old"}' } },
        { id: 'a', score: 0.5, fields: { text: 'old a', _metadata: '{"tenantId":"mine"}' } },
      ];
      f.collection.fetchResults = {
        a: { id: 'a', score: 0, fields: { text: 'current a', _metadata: '{"tenantId":"mine"}' }, vectors: { embedding: [1, 0] } },
        b: { id: 'b', score: 0, fields: { text: 'current b', _metadata: '{"tenantId":"mine","title":"current"}' }, vectors: { embedding: [0, 1] } },
      };
      const rows = await f.adapter.query({ text: 'marker', includeVector: true, filter: { tenantId: 'mine' }, topK: 2 });
      expect(f.collection.lastQuery.includeVector).toBe(false);
      expect(f.collection.lastFetch).toMatchObject({ ids: ['b', 'a'], includeVector: true });
      expect(rows).toEqual([
        { id: 'b', text: 'current b', metadata: { tenantId: 'mine', title: 'current' }, vector: [0, 1], score: 0.7 },
        { id: 'a', text: 'current a', metadata: { tenantId: 'mine' }, vector: [1, 0], score: 0.5 },
      ]);
    } finally { await f.cleanup(); }
  });
  it('drops deleted and re-scoped FTS hits rather than trusting old query scope metadata', async () => {
    const f = await fixture();
    try {
      f.collection.results = ['deleted', 'moved', 'stays'].map(id => ({ id, score: 0.5,
        fields: { text: 'old text', _metadata: '{"tenantId":"mine"}' } }));
      f.collection.fetchResults = {
        moved: { id: 'moved', fields: { text: 'private other corpus', _metadata: '{"tenantId":"other"}' }, vectors: { embedding: [1, 0] } },
        stays: { id: 'stays', fields: { text: 'current authorized text', _metadata: '{"tenantId":"mine"}' }, vectors: { embedding: [1, 0] } },
      };
      const rows = await f.adapter.query({ text: 'marker', includeVector: true, filter: { tenantId: 'mine' }, topK: 3 });
      expect(rows.map(row => row.id)).toEqual(['stays']);
      expect(JSON.stringify(rows)).not.toContain('private other corpus');
    } finally { await f.cleanup(); }
  });
  for (const retrieval of ['lexical', 'hybrid'] as const) {
    it(`hydrates ${retrieval} hits using the configured text field and current scoped metadata`, async () => {
      const f = await fixture({ textField: 'body' });
      try {
        f.collection.results = ['stays', 'changed', 'moved'].map(id => ({ id, score: 0.5,
          fields: { body: 'matching body', _metadata: '{"tenantId":"mine"}' } }));
        f.collection.fetchResults = Object.fromEntries([
          ['stays', 'matching body', 'mine', 'matching label'], ['changed', 'no longer matching', 'mine', 'changed label'], ['moved', 'matching body', 'other', 'matching label'],
        ].map(([id, body, tenantId, text]) => [id!, { id, fields: { body, _metadata: JSON.stringify({ tenantId, text }) }, vectors: { embedding: [1, 0] } }]));
        const rows = await f.adapter.query({ text: 'matching', retrieval, ...(retrieval === 'hybrid' ? { vector: [1, 0] } : {}),
          includeVector: true, topK: 3, filter: { $and: [{ tenantId: 'mine' }, { $or: [{ text: 'matching label' }, { text: 'alternate' }] }] } });
        expect(rows).toMatchObject([{ id: 'stays', text: 'matching body', vector: [1, 0], score: 0.5 }]);
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows)).not.toContain('no longer matching');
      } finally { await f.cleanup(); }
    });
  }
  it('rejects scalar conditions on the FTS column before loading or dispatching the native engine', async () => {
    const f = await fixture({ textField: 'body' });
    try {
      await expect(f.adapter.query({ text: 'marker', filter: { body: 'matching body' }, includeVector: true }))
        .rejects.toMatchObject({ code: 'VECTOR_FILTER_INVALID' });
      expect(f.schema()).toBeUndefined(); expect(f.collection.lastQuery).toBeUndefined();
    } finally { await f.cleanup(); }
  });
  it('hydrates hybrid rank-fusion output without asking the native FTS leg to project a dense vector', async () => {
    const f = await fixture();
    try {
      f.collection.fetchResults = { 'lexical-only': { id: 'lexical-only', fields: { text: 'current literal text', _metadata: '{"tenantId":"mine"}' }, vectors: { embedding: [-1, 0] } } };
      const rows = await f.adapter.query({ text: 'marker', vector: [1, 0], retrieval: 'hybrid', includeVector: true,
        filter: { tenantId: 'mine' } });
      expect(f.collection.lastMulti.includeVector).toBe(false);
      expect(rows).toMatchObject([{ id: 'lexical-only', vector: [-1, 0], text: 'current literal text', score: 0.1 }]);
    } finally { await f.cleanup(); }
  });
  it('carries immutable trusted scope through every native hybrid leg', async () => {
    const f = await fixture();
    try {
      const service = new VectorService(new VectorRegistry({ config: f.resolved, storeFactory: () => f.adapter }), { emitCode: () => undefined as never });
      await service.scope({ tenantId: 'mine' }).query({ vector: [1, 0], text: 'marker', filter: { tenantId: 'other' } });
      expect(f.collection.lastMulti.filter).toBe("(((tenantId = 'mine')) AND ((tenantId = 'other')))");
      await service.dispose();
    } finally { await f.cleanup(); }
  });
  it('scoped fetch on a custom text field cannot mistake body text for metadata scope authority', async () => {
    const f = await fixture({ textField: 'body' });
    const service = new VectorService(new VectorRegistry({ config: f.resolved, storeFactory: () => f.adapter }), { emitCode: () => undefined as never });
    try {
      f.collection.fetchResults = {
        allowed: { id: 'allowed', fields: { body: 'actual document', _metadata: '{"text":"mine"}' } },
        forbidden: { id: 'forbidden', fields: { body: 'mine', _metadata: '{"text":"other"}' } },
      };
      expect((await service.scope({ text: 'mine' }).fetch(['allowed', 'forbidden'])).map(row => row.id)).toEqual(['allowed']);
    } finally { await service.dispose(); await f.cleanup(); }
  });
  it('rejects invalid modes, text and limits before dispatching any native search', async () => {
    const f = await fixture();
    try {
      for (const input of [{ text: '' }, { text: 'x\0' }, { text: 'x', retrieval: 'vector' },
        { vector: [1, 0], retrieval: 'hybrid' }, { text: 'x', topK: 0 }, { text: 'x', topK: 10, candidateCount: 9 },
        { text: 'x', rankConstant: -1 }]) {
        await expect(f.adapter.query(input as any)).rejects.toBeInstanceOf(Error);
      }
      expect(f.collection.lastQuery).toBeUndefined();
      expect(f.collection.lastMulti).toBeUndefined();
    } finally { await f.cleanup(); }
  });
  it('sanitizes native failure text instead of leaking caller search content', async () => {
    const f = await fixture();
    try {
      f.collection.query = async () => { throw new Error('private search terms from engine'); };
      await expect(f.adapter.query({ text: 'private search terms' })).rejects.toMatchObject({ code: 'VECTOR_OPERATION_FAILED', message: 'Vector retrieval failed.' });
    } finally { await f.cleanup(); }
  });
  it('adds missing FTS only to an explicitly enabled writable existing unindexed text field', async () => {
    const f = await fixture({ existing: true });
    try {
      await f.adapter.query({ text: 'hello' });
      expect(f.collection.lastCreate).toMatchObject({ fieldName: 'text', indexParams: { indexType: 11 } });
    } finally { await f.cleanup(); }
    for (const options of [{ existing: true, indexed: 10 }, { existing: true, readOnly: true }]) {
      const f = await fixture(options);
      try {
        await expect(f.adapter.query({ text: 'hello' })).rejects.toBeInstanceOf(Error);
        expect(f.collection.lastCreate).toBeUndefined();
        expect(f.collection.closed).toBe(true);
      } finally { await f.cleanup(); }
    }
    const existing = await fixture({ existing: true, indexed: 11, readOnly: true });
    try { await existing.adapter.query({ text: 'hello' }); expect(existing.collection.lastCreate).toBeUndefined(); }
    finally { await existing.cleanup(); }
  });
});
