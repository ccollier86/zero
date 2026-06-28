import { describe, expect, it } from 'bun:test';

import { resolveVectorConfig } from './vector-config';
import { VectorRegistry } from './vector-registry';
import { VectorService } from './vector-service';
import type {
  ResolvedVectorIndexConfig,
  StoredVectorRecord,
  VectorDeleteResult,
  VectorFetchOptions,
  VectorFilter,
  VectorIndexStore,
  VectorQueryOptions,
  VectorRecord,
  VectorStats,
  VectorWriteResult,
} from './vector-types';

describe('VectorService', () => {
  it('routes default-index upserts and explicit-index queries to stores', async () => {
    const { service, store } = createTestService();

    await service.upsert({ id: 'a', vector: [1, 2, 3], text: 'Alpha' });
    expect(store.records.get('a')?.text).toBe('Alpha');

    await service.query('docs', { vector: [1, 2, 3], filter: { bucket: 'docs' } });
    expect(store.lastQuery?.filter).toEqual({ bucket: 'docs' });
  });

  it('stamps scope equality metadata on writes and merges query filters', async () => {
    const { service, store } = createTestService();
    const scope = service.scope('docs', { bucket: 'docs' });

    await scope.upsert({ id: 'a', vector: [1, 2, 3], metadata: { source: 'manual' } });
    expect(store.records.get('a')?.metadata).toEqual({ source: 'manual', bucket: 'docs' });

    await scope.query({ vector: [1, 2, 3], filter: { status: 'open' } });
    expect(store.lastQuery?.filter).toEqual({ $and: [{ bucket: 'docs' }, { status: 'open' }] });
  });

  it('filters scoped fetches in memory to avoid id-guess leaks', async () => {
    const { service, store } = createTestService();
    store.seed([
      { id: 'a', metadata: { bucket: 'docs' } },
      { id: 'b', metadata: { bucket: 'other' } },
    ]);

    const records = await service.scope('docs', { bucket: 'docs' }).fetch(['a', 'b']);
    expect(records.map((record) => record.id)).toEqual(['a']);
  });
});

function createTestService() {
  const config = resolveVectorConfig({
    dataDir: '.',
    defaultIndex: 'docs',
    indexes: { docs: 3 },
  }, {});
  if (config === false) throw new Error('Expected vector config.');

  const store = new MemoryVectorStore(config.indexes.docs);
  const registry = new VectorRegistry({
    config,
    storeFactory: () => store,
  });
  return {
    service: new VectorService(registry),
    store,
  };
}

class MemoryVectorStore implements VectorIndexStore {
  records = new Map<string, StoredVectorRecord>();
  lastQuery: VectorQueryOptions | null = null;

  constructor(readonly config: ResolvedVectorIndexConfig) {}

  seed(records: StoredVectorRecord[]) {
    for (const record of records) this.records.set(record.id, record);
  }

  async upsert(records: readonly VectorRecord[]): Promise<VectorWriteResult> {
    for (const record of records) {
      this.records.set(record.id, {
        id: record.id,
        text: record.text,
        metadata: record.metadata ?? {},
        vector: Array.from(record.vector),
      });
    }
    return { ok: true, count: records.length, errors: [] };
  }

  async query(options: VectorQueryOptions): Promise<StoredVectorRecord[]> {
    this.lastQuery = options;
    return [...this.records.values()];
  }

  async fetch(ids: readonly string[], _options?: VectorFetchOptions): Promise<StoredVectorRecord[]> {
    return ids.map((id) => this.records.get(id)).filter((record): record is StoredVectorRecord => Boolean(record));
  }

  async delete(ids: readonly string[]): Promise<VectorDeleteResult> {
    for (const id of ids) this.records.delete(id);
    return { ok: true, count: ids.length, errors: [] };
  }

  async deleteWhere(_filter: VectorFilter): Promise<VectorDeleteResult> {
    return { ok: true, count: 0, errors: [] };
  }

  async stats(): Promise<VectorStats> {
    return {
      index: this.config.name,
      path: this.config.path,
      dimensions: this.config.dimensions,
      documentCount: this.records.size,
      indexCompleteness: {},
    };
  }

  async optimize(): Promise<void> {}

  async dispose(): Promise<void> {}
}
