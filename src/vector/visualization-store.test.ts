/** Actor-backed snapshot persistence tests use only disposable in-memory databases. */
import { describe, expect, test } from 'bun:test';
import { createPlatformSQLiteService } from '../persistence';
import { createAsyncDatabaseClient } from '../databases/database-client';
import type { AsyncDatabaseOperationExecutor, DatabaseOperationRow } from '../databases/database-operation-contracts';
import { defineDatabaseRealm } from '../databases/database-realm';
import { DatabaseRuntime } from '../databases/database-runtime';
import { DatabaseWriterOperationEngine } from '../databases/database-writer-engine';
import { AsyncVectorVisualizationStore } from './visualization-store';
import { VECTOR_VISUALIZATION_FEED_TABLE, VECTOR_VISUALIZATION_FEED_SCHEMA,
  VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_OPERATION_SCHEMA } from './visualization-schema';
import { VectorError } from './vector-error';
import type { VectorVisualizationSnapshot } from './visualization-types';

function harness() {
  const realm = defineDatabaseRealm({ name: 'visualization-test', version: '1',
    tables: { [VECTOR_VISUALIZATION_OPERATIONS_TABLE]: VECTOR_VISUALIZATION_OPERATION_SCHEMA,
      [VECTOR_VISUALIZATION_FEED_TABLE]: VECTOR_VISUALIZATION_FEED_SCHEMA } });
  const runtime = DatabaseRuntime.open({ id: 'visualization-test', role: 'named',
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }), ownsSQLite: true, tables: realm.tables });
  const engine = new DatabaseWriterOperationEngine({ runtime, realm });
  const client = createAsyncDatabaseClient({ executor: {
    async execute(operation) { return engine.execute(operation); },
  } as AsyncDatabaseOperationExecutor });
  const store = new AsyncVectorVisualizationStore(client, 'corpus:a', 'user:a', 'tenant:a');
  return { runtime, client, store, close() { engine.close(); runtime.close(); } };
}

function snapshot(id = 'operation:a'): VectorVisualizationSnapshot {
  return { id, index: 'docs', kind: 'search', status: 'running', revision: 1,
    createdAt: '2026-10-08T12:00:00.000Z', updatedAt: '2026-10-08T12:00:00.000Z',
    stages: [{ id: 'embed', label: 'Embed', status: 'running' }],
    query: { text: 'private query', retrieval: 'vector', rerank: false, topK: 5 } };
}

function feedRows(fixture: ReturnType<typeof harness>): DatabaseOperationRow[] {
  return fixture.runtime.db.prepare(`SELECT * FROM ${VECTOR_VISUALIZATION_FEED_TABLE}`).all() as DatabaseOperationRow[];
}

describe('AsyncVectorVisualizationStore', () => {
  test('durable history grows independently of one metadata-only feed slot and receipt replay cannot overwrite a newer signal', async () => {
    const fixture = harness();
    try {
      const first = snapshot('history:a'); await fixture.store.create(first);
      const before = feedRows(fixture)[0]!;
      for (let i = 0; i < 12; i++) await fixture.store.claim(snapshot(`history:${i}`));
      const feed = feedRows(fixture);
      expect(fixture.runtime.db.prepare(`SELECT * FROM ${VECTOR_VISUALIZATION_OPERATIONS_TABLE}`).all()).toHaveLength(13);
      expect(feed).toHaveLength(1); expect(feed[0]!.feed_id).toBe(before.feed_id);
      expect(feed[0]!.change_token).not.toBe(before.change_token);
      expect(feed[0]!.snapshot_json).toBeUndefined(); expect(feed[0]!.operation_id).toBeUndefined();
      expect(JSON.stringify(feed)).not.toContain('private query');
      await fixture.store.create(first);
      expect(feedRows(fixture)).toEqual(feed);
      const operation = (await fixture.store.get(first.id))!;
      await fixture.store.compareAndSwap(first.id, operation.revision, { ...operation, revision: operation.revision + 1, status: 'completed' });
      expect(feedRows(fixture)[0]!.change_token).not.toBe(feed[0]!.change_token);
      expect(await fixture.store.get('history:0')).not.toBeNull();
    } finally { fixture.close(); }
  });

  test('feed upsert failure atomically rolls back history creation and progress updates', async () => {
    const fixture = harness();
    try {
      const initial = snapshot('atomic:existing'); await fixture.store.create(initial);
      const before = feedRows(fixture);
      fixture.runtime.db.prepare(`CREATE TRIGGER reject_vector_feed BEFORE INSERT ON ${VECTOR_VISUALIZATION_FEED_TABLE}
        BEGIN SELECT RAISE(ABORT, 'controlled feed failure'); END`).run();
      await expect(fixture.store.create(snapshot('atomic:new'))).rejects.toThrow();
      expect(await fixture.store.get('atomic:new')).toBeNull();
      await expect(fixture.store.claim(snapshot('atomic:claim'))).rejects.toThrow();
      expect(await fixture.store.get('atomic:claim')).toBeNull();
      await expect(fixture.store.compareAndSwap(initial.id, initial.revision,
        { ...initial, revision: initial.revision + 1, status: 'completed' })).rejects.toThrow();
      expect(await fixture.store.get(initial.id)).toEqual(initial);
      expect(feedRows(fixture)).toEqual(before);
    } finally { fixture.close(); }
  });

  test('atomic claims attach retries while cleanup remains bound to the original scoped identity', async () => {
    const fixture = harness();
    try {
      const first = snapshot('claim:a'), second = snapshot('claim:b');
      const [winner, replay] = await Promise.all([fixture.store.claim(first), fixture.store.claim({ ...first,
        createdAt: '2026-10-08T12:00:01Z', updatedAt: '2026-10-08T12:00:01Z' })]);
      expect(winner.created).toBe(true); expect(replay.created).toBe(false); expect(replay.retire).toBeUndefined();
      expect(replay.snapshot).toEqual(first);
      const secondClaim = await fixture.store.claim(second);
      winner.snapshot.id = second.id;
      await winner.retire!({ code: 'PRIVATE', message: 'private-provider-details', outcomeUnknown: true });
      const retired = await fixture.store.get(first.id);
      expect(retired?.status).toBe('interrupted'); expect(retired?.error?.outcomeUnknown).toBe(true);
      expect(JSON.stringify(retired)).not.toContain('private-provider-details');
      expect((await fixture.store.get(second.id))?.status).toBe('running');
      const other = new AsyncVectorVisualizationStore(fixture.client, 'corpus:b', 'user:a', 'tenant:a');
      await expect(other.claim(first)).rejects.toBeInstanceOf(VectorError);
      expect(await other.get(first.id)).toBeNull();
      const done = (await fixture.store.get(second.id))!;
      await fixture.store.compareAndSwap(done.id, done.revision, { ...done, revision: done.revision + 1, status: 'completed' });
      await secondClaim.retire!({ code: 'PRIVATE', message: 'ignored' });
      expect((await fixture.store.get(second.id))?.status).toBe('completed');
    } finally { fixture.close(); }
  });

  test('persists detached canonical snapshots and returns the same accepted revision after reattachment', async () => {
    const fixture = harness();
    try {
      const input = snapshot();
      await fixture.store.create(input);
      input.query!.text = 'mutated later';
      expect((await fixture.store.get(input.id))?.query?.text).toBe('private query');
      const next = { ...(await fixture.store.get(input.id))!, revision: 2, status: 'completed' as const };
      await fixture.store.compareAndSwap(input.id, 1, next);
      const attached = new AsyncVectorVisualizationStore(fixture.client, 'corpus:a', 'user:a', 'tenant:a');
      expect(await attached.get(input.id)).toEqual(next);
      expect(await attached.list('docs')).toEqual([next]);
      await expect(attached.compareAndSwap(input.id, 2, { ...next, revision: 3 })).rejects.toBeInstanceOf(VectorError);
    } finally { fixture.close(); }
  });

  test('never exposes another owner, tenant or corpus and keeps index list predicates exact', async () => {
    const fixture = harness();
    try {
      await fixture.store.create(snapshot());
      for (const args of [ ['corpus:b', 'user:a', 'tenant:a'], ['corpus:a', 'user:b', 'tenant:a'],
        ['corpus:a', 'user:a', 'tenant:b'], ['corpus:a', 'user:a', null] ] as const) {
        const other = new AsyncVectorVisualizationStore(fixture.client, args[0], args[1], args[2]);
        expect(await other.get('operation:a')).toBeNull();
        expect(await other.list('docs')).toEqual([]);
        await expect(other.compareAndSwap('operation:a', 1, { ...snapshot(), revision: 2 })).rejects.toBeInstanceOf(VectorError);
      }
      expect(await fixture.store.list('DOCS')).toEqual([]);
    } finally { fixture.close(); }
  });

  test('writer-transaction assertions fence simultaneous progress publishers', async () => {
    const fixture = harness();
    try {
      const before = snapshot(); await fixture.store.create(before);
      const attempts = await Promise.allSettled([
        fixture.store.compareAndSwap(before.id, 1, { ...before, revision: 2, status: 'waiting' }),
        fixture.store.compareAndSwap(before.id, 1, { ...before, revision: 2, status: 'completed' }),
      ]);
      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect((await fixture.store.get(before.id))?.revision).toBe(2);
    } finally { fixture.close(); }
  });

  test('rejects unbounded, inconsistent, non-finite and accessor snapshots before a mutation', async () => {
    const fixture = harness();
    try {
      await expect(fixture.store.create({ ...snapshot(), query: { ...snapshot().query!, text: 'x'.repeat(250_000) } })).rejects.toBeInstanceOf(VectorError);
      await expect(fixture.store.create({ ...snapshot(), revision: NaN })).rejects.toBeInstanceOf(VectorError);
      await expect(fixture.store.create({ ...snapshot(), map: {
        revision: 1, projectionId: 'p', projectionKind: 'provided', dimensions: 3,
        points: [{ id: 'p', title: 'P', position: { x: Infinity, y: 0 } }], clusters: [],
        capabilities: { nativeTraversal: false, graph: 'none', liveUpdates: true },
      } })).rejects.toBeInstanceOf(VectorError);
      let reads = 0;
      const hostile = { ...snapshot(), get candidates() { reads++; return []; } };
      await expect(fixture.store.create(hostile)).rejects.toBeInstanceOf(VectorError);
      await expect(fixture.store.create({ ...snapshot(), get id() { reads++; return 'operation:a'; } })).rejects.toBeInstanceOf(VectorError);
      const hidden = snapshot(); Object.defineProperty(hidden, 'id', { value: hidden.id, enumerable: false });
      await expect(fixture.store.create(hidden)).rejects.toBeInstanceOf(VectorError);
      expect(reads).toBe(0);
      expect(await fixture.store.get('operation:a')).toBeNull();
      await fixture.store.create(snapshot());
      fixture.runtime.db.update(VECTOR_VISUALIZATION_OPERATIONS_TABLE, 'operation:a', {
        snapshot_json: JSON.stringify({ ...snapshot(), id: 'operation:b' }),
      });
      await expect(fixture.store.get('operation:a')).rejects.toBeInstanceOf(VectorError);
    } finally { fixture.close(); }
  });
});
