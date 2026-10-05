/** Controlled same-service scope/write races using only synthetic adapters. */

import { describe, expect, test } from 'bun:test';
import { resolveVectorConfig } from './vector-config';
import { recordMatchesVectorFilter } from './vector-filter';
import { VectorOperationBoundary } from './vector-operation-boundary';
import { VectorRegistry } from './vector-registry';
import { VectorService } from './vector-service';
import type { ResolvedVectorIndexConfig, StoredVectorRecord, VectorFilter, VectorIndexStore,
  VectorRecord, VectorStats } from './vector-types';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function microtasks() { for (let count = 0; count < 12; count++) await Promise.resolve(); }
const record = (id = 'shared'): VectorRecord => ({ id, vector: [1, 2, 3], text: 'synthetic' });

describe('VectorScope write boundary', () => {
  test('overlapping empty-id claims have one scope winner across the fetch and write barrier', async () => {
    const { service, stores } = fixture();
    const store = stores.get('docs')!;
    const entered = barrier(), resume = barrier();
    store.beforeFetch = async () => { entered.release(); await resume.promise; };
    const first = service.scope('docs', { tenantId: 'a' }).upsert(record());
    await entered.promise;
    const second = service.scope('docs', { tenantId: 'b' }).upsert(record());
    const losing = second.then(() => null, error => error);
    await microtasks();
    expect(store.fetchCalls).toBe(1);
    store.beforeFetch = undefined;
    resume.release();
    await first;
    expect(await losing).toMatchObject({ code: 'VECTOR_SCOPE_CONFLICT' });
    expect(store.writeCalls).toBe(1);
    expect(store.records.get('shared')?.metadata.tenantId).toBe('a');
    await service.dispose();
  });

  test('ordinary writes participate before a later scoped admission', async () => {
    const { service, stores } = fixture();
    const store = stores.get('docs')!;
    const entered = barrier(), resume = barrier();
    store.beforeWrite = async () => { entered.release(); await resume.promise; };
    const ordinary = service.upsert('docs', { ...record(), metadata: { tenantId: 'a' } });
    await entered.promise;
    const scoped = service.scope('docs', { tenantId: 'b' }).upsert(record());
    const losing = scoped.then(() => null, error => error);
    await microtasks();
    expect(store.fetchCalls).toBe(0);
    store.beforeWrite = undefined;
    resume.release();
    await ordinary; expect(await losing).toMatchObject({ code: 'VECTOR_SCOPE_CONFLICT' });
    expect(store.records.get('shared')?.metadata.tenantId).toBe('a');
    await service.dispose();
  });

  test.each(['delete', 'deleteWhere'] as const)('%s participates in the same index boundary', async operation => {
    const { service, stores } = fixture();
    const store = stores.get('docs')!;
    const entered = barrier(), resume = barrier();
    store.beforeFetch = async () => { entered.release(); await resume.promise; };
    const writing = service.scope('docs', { tenantId: 'a' }).upsert(record());
    await entered.promise;
    const deleting = operation === 'delete'
      ? service.delete('docs', 'shared')
      : service.deleteWhere('docs', { tenantId: 'a' });
    await microtasks(); expect(store.deleteCalls).toBe(0);
    store.beforeFetch = undefined; resume.release();
    await writing; await deleting;
    expect(store.records.has('shared')).toBe(false);
    await service.dispose();
  });

  test('scope and queued record inputs are detached; compound scopes require the full candidate to match', async () => {
    const { service, stores } = fixture();
    const store = stores.get('docs')!;
    const required: VectorFilter = { $and: [{ tenantId: 'a' }, { rating: { gte: 4 } }] };
    const scoped = service.scope('docs', required);
    required.$and![0]!.tenantId = 'b';
    (required.$and![1]!.rating as { gte: number }).gte = 0;
    expect(() => scoped.upsert({ ...record('wrong'), metadata: { rating: 3 } }))
      .toThrow(expect.objectContaining({ code: 'VECTOR_SCOPE_CONFLICT' }));
    const entered = barrier(), resume = barrier();
    store.beforeFetch = async () => { entered.release(); await resume.promise; };
    const value = { ...record(), metadata: { rating: 5, nested: { note: 'initial' } } };
    const writing = scoped.upsert(value);
    await entered.promise;
    value.id = 'different'; value.vector[0] = 99; value.metadata.rating = 0;
    value.metadata.nested.note = 'changed';
    store.beforeFetch = undefined; resume.release(); await writing;
    expect(store.records.get('shared')).toMatchObject({ vector: [1, 2, 3],
      metadata: { tenantId: 'a', rating: 5, nested: { note: 'initial' } } });
    expect(store.records.has('different')).toBe(false);
    await service.dispose();
  });

  test('a batch conflict performs no adapter writes and a failed adapter releases later work', async () => {
    const { service, stores } = fixture();
    const store = stores.get('docs')!;
    store.records.set('foreign', { id: 'foreign', metadata: { tenantId: 'b' } });
    await expect(service.scope('docs', { tenantId: 'a' }).upsert([record('new'), record('foreign')]))
      .rejects.toMatchObject({ code: 'VECTOR_SCOPE_CONFLICT' });
    expect(store.writeCalls).toBe(0);
    expect(store.records.has('new')).toBe(false);
    store.failNextWrite = true;
    await expect(service.upsert('docs', record('failed'))).rejects.toThrow('synthetic adapter failure');
    await service.scope('docs', { tenantId: 'a' }).upsert(record('next'));
    expect(store.records.has('next')).toBe(true);
    await service.dispose();
  });

  test('independent indexes remain usable and disposal drains admitted operations before closing stores', async () => {
    const { service, stores } = fixture();
    const docs = stores.get('docs')!, other = stores.get('other')!;
    const entered = barrier(), resume = barrier();
    docs.beforeFetch = async () => { entered.release(); await resume.promise; };
    const writing = service.scope('docs', { tenantId: 'a' }).upsert(record());
    await entered.promise;
    await service.scope('other', { tenantId: 'b' }).upsert(record());
    expect(other.records.get('shared')?.metadata.tenantId).toBe('b');
    const draining = service.dispose();
    await microtasks(); expect(docs.closed).toBe(false); expect(other.closed).toBe(false);
    await expect(service.upsert(record('late'))).rejects.toMatchObject({ code: 'VECTOR_OPERATION_FAILED' });
    docs.beforeFetch = undefined; resume.release(); await writing; await draining;
    expect(docs.closed).toBe(true); expect(other.closed).toBe(true);
    await expect(service.stats('docs')).rejects.toMatchObject({ code: 'VECTOR_OPERATION_FAILED' });
  });

  test('idle queue entries retire and rejection does not retain an index tail', async () => {
    const boundary = new VectorOperationBoundary();
    const entered = barrier(), resume = barrier();
    const pending = boundary.write('docs', async () => { entered.release(); await resume.promise; });
    await entered.promise; expect(boundary.pendingIndexes).toBe(1);
    const next = boundary.write('docs', async () => undefined);
    resume.release(); await pending; await next; await microtasks();
    expect(boundary.pendingIndexes).toBe(0);
    await expect(boundary.write('docs', async () => { throw new Error('synthetic'); })).rejects.toThrow('synthetic');
    await microtasks(); expect(boundary.pendingIndexes).toBe(0);
    await boundary.close();
  });

  test('cyclic scope data rejects safely instead of overflowing a recursive matcher', async () => {
    const { service } = fixture();
    const cyclic: VectorFilter = {};
    cyclic.$and = [cyclic];
    expect(() => service.scope('docs', cyclic))
      .toThrow(expect.objectContaining({ code: 'VECTOR_FILTER_INVALID' }));
    await service.dispose();
  });

  test('a rejected preflight releases a queued ordinary write, and disposal waits for reads too', async () => {
    const { service, stores } = fixture();
    const store = stores.get('docs')!;
    store.beforeFetch = async () => { throw new Error('synthetic preflight failure'); };
    const failed = service.scope('docs', { tenantId: 'a' }).upsert(record()).then(() => null, error => error);
    const following = service.upsert('docs', record('next'));
    expect(await failed).toBeInstanceOf(Error); await following;
    expect(store.records.has('next')).toBe(true);
    const entered = barrier(), resume = barrier();
    store.beforeFetch = async () => { entered.release(); await resume.promise; };
    const reading = service.fetch('docs', 'next');
    await entered.promise;
    const disposal = service.dispose();
    await microtasks(); expect(store.closed).toBe(false);
    resume.release(); await reading; await disposal;
    expect(store.closed).toBe(true);
  });

  test('null equality scopes are stamped and checked consistently', async () => {
    const { service, stores } = fixture();
    await service.scope('docs', { owner: { eq: null } }).upsert(record());
    expect(stores.get('docs')!.records.get('shared')?.metadata.owner).toBeNull();
    await service.dispose();
  });

  test('saturated public writes reject before copying records, then accept after the queue drains', async () => {
    const { service, stores } = fixture();
    const store = stores.get('docs')!, entered = barrier(), resume = barrier();
    store.beforeWrite = async () => { entered.release(); await resume.promise; };
    const first = service.upsert('docs', record('first'));
    await entered.promise;
    const queued = Array.from({ length: 127 }, (_, index) => service.upsert('docs', record(`queued-${index}`)));
    let copies = 0;
    const costly: VectorRecord = { id: 'overflow', vector: [1, 2, 3],
      get metadata() { copies++; return { tenantId: 'a' }; } };
    await expect(service.upsert('docs', costly)).rejects.toMatchObject({ code: 'VECTOR_BACKPRESSURE' });
    expect(() => service.scope('docs', { tenantId: 'a' }).upsert(costly))
      .toThrow(expect.objectContaining({ code: 'VECTOR_BACKPRESSURE' }));
    expect(copies).toBe(0);
    await service.upsert('other', record('independent'));
    expect(stores.get('other')!.records.has('independent')).toBe(true);
    store.beforeWrite = undefined; resume.release(); await first; await Promise.all(queued);
    await service.upsert('docs', costly);
    expect(copies).toBeGreaterThan(0);
    expect(store.records.has('overflow')).toBe(true);
    await service.dispose();
  });
});

function fixture() {
  const config = resolveVectorConfig({ dataDir: '.', defaultIndex: 'docs', indexes: { docs: 3, other: 3 } }, {});
  if (config === false) throw new Error('Synthetic vector config is required');
  const stores = new Map(Object.entries(config.indexes).map(([name, index]) => [name, new FakeVectorStore(index)]));
  return { stores, service: new VectorService(new VectorRegistry({ config, storeFactory: index => stores.get(index.name)! })) };
}

class FakeVectorStore implements VectorIndexStore {
  readonly records = new Map<string, StoredVectorRecord>();
  fetchCalls = 0; writeCalls = 0; deleteCalls = 0; closed = false; failNextWrite = false;
  beforeFetch?: () => Promise<void>; beforeWrite?: () => Promise<void>;
  constructor(readonly config: ResolvedVectorIndexConfig) {}
  async fetch(ids: readonly string[]) {
    this.fetchCalls++;
    const snapshot = ids.flatMap(id => { const value = this.records.get(id); return value ? [structuredClone(value)] : []; });
    await this.beforeFetch?.(); return snapshot;
  }
  async upsert(records: readonly VectorRecord[]) {
    this.writeCalls++; await this.beforeWrite?.();
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('synthetic adapter failure'); }
    for (const row of records) this.records.set(row.id, { id: row.id, text: row.text,
      metadata: structuredClone(row.metadata ?? {}), vector: Array.from(row.vector) });
    return { ok: true, count: records.length, errors: [] };
  }
  async query() { return [...this.records.values()]; }
  async delete(ids: readonly string[]) {
    this.deleteCalls++; ids.forEach(id => this.records.delete(id)); return { ok: true, count: ids.length, errors: [] };
  }
  async deleteWhere(filter: VectorFilter) {
    return this.delete([...this.records.values()].filter(row => recordMatchesVectorFilter(row, filter)).map(row => row.id));
  }
  async stats(): Promise<VectorStats> {
    return { index: this.config.name, path: '.', dimensions: 3, documentCount: this.records.size, indexCompleteness: {} };
  }
  async optimize() {}
  async dispose() { this.closed = true; }
}
