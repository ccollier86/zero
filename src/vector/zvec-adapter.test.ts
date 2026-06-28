import { describe, expect, it } from 'bun:test';

import { resolveVectorConfig } from './vector-config';
import { ZvecAdapter } from './zvec-adapter';

describe('ZvecAdapter', () => {
  it('maps Zero vector records and filters to zvec documents and queries', async () => {
    const config = resolveVectorConfig({
      dataDir: '.',
      defaultIndex: 'docs',
      indexes: {
        docs: {
          dimensions: 3,
          path: 'zvec-test-index',
          metadata: { year: 'number' },
        },
      },
    }, {});
    if (config === false) throw new Error('Expected vector config.');

    const collection = new FakeCollection();
    const adapter = new ZvecAdapter({
      config: config.indexes.docs,
      loader: async () => fakeZvecModule(collection),
    });

    await adapter.upsert([{
      id: 'doc_1',
      vector: [1, 2, 3],
      text: 'Hello',
      metadata: {
        bucket: 'docs',
        year: 2026,
        extra: { nested: true },
      },
    }]);

    expect(collection.upserts[0][0]).toMatchObject({
      id: 'doc_1',
      vectors: { embedding: [1, 2, 3] },
      fields: {
        _zero_id: 'doc_1',
        text: 'Hello',
        bucket: 'docs',
        year: 2026,
      },
    });
    expect(JSON.parse(collection.upserts[0][0].fields._metadata)).toEqual({
      bucket: 'docs',
      year: 2026,
      extra: { nested: true },
    });

    collection.queryResults = [{
      id: 'doc_1',
      vectors: { embedding: new Float32Array([1, 2, 3]) },
      fields: {
        text: 'Hello',
        _metadata: '{"bucket":"docs","extra":{"nested":true}}',
        bucket: 'docs',
        year: 2026,
      },
      score: 0.94,
    }];

    const results = await adapter.query({
      vector: [1, 2, 3],
      filter: { id: 'doc_1', bucket: 'docs', year: { gte: 2024 } },
      includeVector: true,
    });

    expect(collection.lastQuery).toMatchObject({
      fieldName: 'embedding',
      topk: 10,
      filter: "(_zero_id = 'doc_1') AND (bucket = 'docs') AND (year >= 2024)",
      includeVector: true,
    });
    expect(results[0]).toEqual({
      id: 'doc_1',
      vector: [1, 2, 3],
      text: 'Hello',
      metadata: {
        bucket: 'docs',
        extra: { nested: true },
        year: 2026,
      },
      score: 0.94,
    });
  });
});

class FakeCollection {
  path = 'zvec-test-index';
  schema = {};
  options = {};
  stats = { docCount: 0, indexCompleteness: {} };
  upserts: any[][] = [];
  lastQuery: any = null;
  queryResults: any[] = [];

  upsertSync(docs: any[]) {
    this.upserts.push(docs);
    this.stats.docCount += docs.length;
    return docs.map(() => ({ ok: true, code: 'OK', message: '' }));
  }

  async query(params: any) {
    this.lastQuery = params;
    return this.queryResults;
  }

  fetchSync() {
    return {};
  }

  deleteSync(ids: string[]) {
    return ids.map(() => ({ ok: true, code: 'OK', message: '' }));
  }

  async deleteByFilter() {
    return { ok: true, code: 'OK', message: '' };
  }

  async optimize() {}

  closeSync() {}
}

function fakeZvecModule(collection: FakeCollection) {
  return {
    ZVecDataType: {
      STRING: 2,
      BOOL: 3,
      DOUBLE: 9,
      VECTOR_FP32: 23,
    },
    ZVecIndexType: {
      HNSW: 1,
      IVF: 2,
      FLAT: 3,
      DISKANN: 5,
      INVERT: 10,
    },
    ZVecMetricType: {
      L2: 1,
      IP: 2,
      COSINE: 3,
    },
    ZVecCollectionSchema: class {
      constructor(readonly params: unknown) {}
    },
    ZVecCreateAndOpen: () => collection,
  } as any;
}
