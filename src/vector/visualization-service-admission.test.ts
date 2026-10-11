/** Real writer admission/lifecycle regressions use disposable SQLite and controlled provider/native adapters. */
import { describe, expect, test } from 'bun:test';
import { createPlatformSQLiteService } from '../persistence';
import { createAsyncDatabaseClient } from '../databases/database-client';
import type { AsyncDatabaseOperationExecutor } from '../databases/database-operation-contracts';
import { defineDatabaseRealm } from '../databases/database-realm';
import { DatabaseRuntime } from '../databases/database-runtime';
import { DatabaseWriterOperationEngine } from '../databases/database-writer-engine';
import { VectorError } from './vector-error';
import { AsyncVectorVisualizationStore, type VectorVisualizationStore } from './visualization-store';
import { VectorVisualizationService, type VectorVisualizationServiceOptions } from './visualization-service';
import { VECTOR_VISUALIZATION_FEED_TABLE, VECTOR_VISUALIZATION_FEED_SCHEMA,
  VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_OPERATION_SCHEMA } from './visualization-schema';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const realm = defineDatabaseRealm({ name: 'visualization-admission-tests', version: '1',
    tables: { [VECTOR_VISUALIZATION_OPERATIONS_TABLE]: VECTOR_VISUALIZATION_OPERATION_SCHEMA,
      [VECTOR_VISUALIZATION_FEED_TABLE]: VECTOR_VISUALIZATION_FEED_SCHEMA } });
  const runtime = DatabaseRuntime.open({ id: 'visualization-admission-tests', role: 'named',
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }), ownsSQLite: true, tables: realm.tables });
  const engine = new DatabaseWriterOperationEngine({ runtime, realm });
  const client = createAsyncDatabaseClient({ executor: {
    async execute(operation) { return engine.execute(operation); },
  } as AsyncDatabaseOperationExecutor });
  let allowed = true, clock = 0;
  const calls = { embed: 0, embedMany: 0, upsert: 0 };
  const store = () => new AsyncVectorVisualizationStore(client, 'corpus:a', 'user:a', 'tenant:a');
  const options: VectorVisualizationServiceOptions = { index: 'docs', scopeId: 'corpus:a', dimensions: 3,
    store: store(), assertCurrentAuthority() { if (!allowed) throw new Error('private-authority-details'); },
    now: () => new Date(Date.parse('2026-10-09T00:00:00Z') + clock++),
    emitCode: (() => null) as unknown as NonNullable<VectorVisualizationServiceOptions['emitCode']>,
    ai: { async embed() { calls.embed++; return { embedding: [1, 0, 0] }; },
      async embedMany(request: { values: readonly string[] }) { calls.embedMany++; return { embeddings: request.values.map(() => [1, 0, 0]) }; },
      async rerank() { throw new Error('Unused'); } } as unknown as VectorVisualizationServiceOptions['ai'],
    vectors: { async query() { return []; }, async fetch() { return []; },
      async upsert(value) { calls.upsert++; return { ok: true, count: Array.isArray(value) ? value.length : 1, errors: [] }; } },
  };
  const services: VectorVisualizationService[] = [];
  return { options, calls, store, setAllowed(value: boolean) { allowed = value; },
    service(overrides: Partial<VectorVisualizationServiceOptions> = {}) {
      const service = new VectorVisualizationService({ ...options, store: store(), ...overrides }); services.push(service); return service;
    },
    async close() { await Promise.all(services.map(service => service.dispose())); engine.close(); runtime.close(); } };
}

describe('VectorVisualizationService atomic admission and retirement', () => {
  for (const sameTimestamp of [true, false]) for (const kind of ['search', 'ingestion'] as const) {
    test(`concurrent ${kind} retries own one runner with ${sameTimestamp ? 'identical' : 'different'} timestamps`, async () => {
      const f = fixture();
      try {
        const overrides = sameTimestamp ? { now: () => new Date('2026-10-09T00:00:00Z') } : {};
        const a = f.service(overrides), b = f.service(overrides);
        const id = `${kind}:${sameTimestamp}`;
        const accepted = kind === 'search'
          ? await Promise.all([a.startSearch({ operationId: id, text: 'Query' }), b.startSearch({ operationId: id, text: 'Query' })])
          : await Promise.all([a.startIngest({ operationId: id, document: { id: 'doc', title: 'Doc', text: 'Body' } }),
            b.startIngest({ operationId: id, document: { id: 'doc', title: 'Doc', text: 'Body' } })]);
        const completed = await Promise.all(accepted.map(operation => operation.completion));
        expect(completed.map(operation => operation.status)).toEqual(['completed', 'completed']);
        expect(completed[0]).toEqual(completed[1]);
        expect(f.calls.embed).toBe(kind === 'search' ? 1 : 0);
        expect(f.calls.embedMany).toBe(kind === 'ingestion' ? 1 : 0);
        expect(f.calls.upsert).toBe(kind === 'ingestion' ? 1 : 0);
        expect((await f.store().get(id))?.status).toBe('completed');
      } finally { await f.close(); }
    });
  }

  test('same-instance custom-store retries serialize admission without duplicate effects', async () => {
    const f = fixture();
    try {
      const native = f.store();
      const custom: VectorVisualizationStore = { create: snapshot => native.create(snapshot), get: id => native.get(id),
        list: (index, limit) => native.list(index, limit), compareAndSwap: (id, revision, next) => native.compareAndSwap(id, revision, next) };
      const service = f.service({ store: custom });
      const accepted = await Promise.all([service.startSearch({ operationId: 'custom:same', text: 'Query' }),
        service.startSearch({ operationId: 'custom:same', text: 'Query' })]);
      expect((await Promise.all(accepted.map(operation => operation.completion))).every(row => row.status === 'completed')).toBe(true);
      expect(f.calls.embed).toBe(1);
    } finally { await f.close(); }
  });

  test('a concurrent changed command cannot run or retire the winning operation', async () => {
    const f = fixture();
    try {
      const a = f.service(), b = f.service();
      const started = await Promise.allSettled([a.startSearch({ operationId: 'different', text: 'First query' }),
        b.startSearch({ operationId: 'different', text: 'Other query' })]);
      expect(started.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(started.filter(result => result.status === 'rejected')).toHaveLength(1);
      const accepted = started.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof a.startSearch>>> => result.status === 'fulfilled')!;
      expect((await accepted.value.completion).status).toBe('completed');
      expect((await f.store().get('different'))?.status).toBe('completed'); expect(f.calls.embed).toBe(1);
    } finally { await f.close(); }
  });

  test('dispose drains a gated create and retires its accepted row before any provider effect', async () => {
    const f = fixture();
    try {
      const gate = deferred<void>(), entered = deferred<void>(), native = f.store();
      const custom: VectorVisualizationStore = { get: id => native.get(id), list: (index, limit) => native.list(index, limit),
        compareAndSwap: (id, revision, next) => native.compareAndSwap(id, revision, next),
        async create(snapshot) { entered.resolve(); await gate.promise; return native.create(snapshot); } };
      const service = f.service({ store: custom });
      const started = service.startSearch({ operationId: 'dispose:pending', text: 'Query' }).catch(error => error);
      await entered.promise;
      let disposed = false; const cleanup = service.dispose().then(() => { disposed = true; });
      expect(service.dispose()).toBe(service.dispose()); await Promise.resolve(); expect(disposed).toBe(false);
      gate.resolve(); await cleanup; expect(await started).toBeInstanceOf(Error);
      expect(f.calls.embed).toBe(0); expect((await native.get('dispose:pending'))?.status).toBe('interrupted');
    } finally { await f.close(); }
  });

  test('pending admission consumes capacity without blocking existing-operation reads', async () => {
    const f = fixture();
    try {
      const gate = deferred<void>(), entered = deferred<void>(), native = f.store();
      const custom: VectorVisualizationStore = { get: id => native.get(id), list: (index, limit) => native.list(index, limit),
        compareAndSwap: (id, revision, next) => native.compareAndSwap(id, revision, next),
        async create(snapshot) { entered.resolve(); await gate.promise; return native.create(snapshot); } };
      const service = f.service({ store: custom, maxActiveOperations: 1 });
      const first = service.startSearch({ operationId: 'capacity:first', text: 'Query' }); await entered.promise;
      await expect(service.startSearch({ operationId: 'capacity:second', text: 'Query' })).rejects.toBeInstanceOf(VectorError);
      expect(await service.get('capacity:second')).toBeNull(); gate.resolve();
      expect((await (await first).completion).status).toBe('completed'); expect(f.calls.embed).toBe(1);
    } finally { await f.close(); }
  });

  test('lost authority retires durable progress, delivery stays denied, and regained permission can reattach terminal state', async () => {
    const f = fixture();
    try {
      const waiting = deferred<{ embeddings: number[][] }>(), entered = deferred<void>();
      const service = f.service({ ai: { ...f.options.ai, embedMany: (async () => {
        f.calls.embedMany++; entered.resolve(); return waiting.promise;
      }) as unknown as typeof f.options.ai.embedMany } });
      const accepted = await service.startIngest({ operationId: 'authority:retired', document: { id: 'doc', title: 'Doc', text: 'Body' } });
      await entered.promise; f.setAllowed(false); waiting.resolve({ embeddings: [[1, 0, 0]] });
      const denied = await accepted.completion.catch(error => error);
      expect(denied.code).toBe('VECTOR_SCOPE_CONFLICT'); expect(denied.message).not.toContain('private-authority-details');
      const durable = await f.store().get('authority:retired');
      expect(durable?.status).toBe('interrupted'); expect(durable?.ingestion?.completedChunks).toBe(0);
      expect(durable?.ingestion?.chunks.every(chunk => chunk.status === 'interrupted')).toBe(true); expect(f.calls.upsert).toBe(0);
      f.setAllowed(true);
      const replay = await f.service().startIngest({ operationId: 'authority:retired', document: { id: 'doc', title: 'Doc', text: 'Body' } });
      expect((await replay.completion).status).toBe('interrupted'); expect(f.calls.embedMany).toBe(1);
    } finally { await f.close(); }
  });

  test('retired authority after acknowledged native I/O stays terminal with unknown unpublished outcome', async () => {
    const f = fixture();
    try {
      const waiting = deferred<{ ok: boolean; count: number; errors: never[] }>(), entered = deferred<void>();
      const service = f.service({ vectors: { ...f.options.vectors, async upsert() {
        f.calls.upsert++; entered.resolve(); return waiting.promise;
      } } });
      const accepted = await service.startIngest({ operationId: 'authority:write', document: { id: 'doc', title: 'Doc', text: 'Body' } });
      await entered.promise; f.setAllowed(false); waiting.resolve({ ok: true, count: 1, errors: [] });
      expect((await accepted.completion.catch(error => error)).code).toBe('VECTOR_SCOPE_CONFLICT');
      const durable = await f.store().get('authority:write');
      expect(durable?.status).toBe('interrupted'); expect(durable?.error?.outcomeUnknown).toBe(true);
      expect(durable?.ingestion?.completedChunks).toBe(0); expect(f.calls.upsert).toBe(1);
      f.setAllowed(true); expect((await service.get('authority:write'))?.status).toBe('interrupted');
    } finally { await f.close(); }
  });
});
