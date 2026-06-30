import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

  it('reopens an existing zvec collection instead of recreating it', async () => {
    const root = await mkdtemp(join(process.cwd(), '.zero/zvec-adapter-open-'));
    const config = resolveVectorConfig({
      dataDir: root,
      defaultIndex: 'docs',
      indexes: {
        docs: {
          dimensions: 3,
          path: join(root, 'docs'),
        },
      },
    }, {});
    if (config === false) throw new Error('Expected vector config.');

    try {
      await mkdir(config.indexes.docs.path, { recursive: true });
      await writeFile(join(config.indexes.docs.path, 'manifest.1'), '');
      const collection = new FakeCollection();
      const module = fakeZvecModule(collection);
      const adapter = new ZvecAdapter({
        config: config.indexes.docs,
        loader: async () => module,
      });

      await adapter.stats();

      expect(module.openCalls).toBe(1);
      expect(module.createCalls).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('recovers records after dispose and reopen through zvec WAL storage', async () => {
    const root = await mkdtemp(join(process.cwd(), '.zero/zvec-adapter-recovery-'));
    const config = resolveVectorConfig({
      dataDir: root,
      defaultIndex: 'docs',
      indexes: {
        docs: {
          dimensions: 3,
          path: join(root, 'docs'),
          metadata: {
            bucket: 'string',
          },
        },
      },
    }, {});
    if (config === false) throw new Error('Expected vector config.');

    try {
      const first = new ZvecAdapter({ config: config.indexes.docs });
      await first.upsert([{
        id: 'doc_1',
        vector: [0.1, 0.2, 0.3],
        text: 'Durable vector document',
        metadata: { bucket: 'docs' },
      }]);
      await first.dispose();

      const second = new ZvecAdapter({ config: config.indexes.docs });
      const records = await second.fetch(['doc_1']);
      await second.dispose();

      expect(records).toEqual([{
        id: 'doc_1',
        text: 'Durable vector document',
        metadata: { bucket: 'docs' },
        score: 0,
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
    createCalls: 0,
    openCalls: 0,
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
    ZVecCreateAndOpen() {
      this.createCalls += 1;
      return collection;
    },
    ZVecOpen() {
      this.openCalls += 1;
      return collection;
    },
  } as any;
}
