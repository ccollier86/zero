import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { DatabaseError } from '../databases/database-error';
import type {
  AsyncDatabaseClient,
  DatabaseCommitResult,
  DatabaseMutation,
  DatabaseOperationRow,
} from '../databases/database-operations';
import type {
  DatabaseLogicalReceiptFingerprint,
  DatabaseTrustedWriteExecutor,
} from '../databases/database-trusted-writer';
import {
  MemoryEventStore,
  OBS_CODES,
  configureObservability,
  type PlatformObservabilityRuntime,
} from '../observability';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { routeMessage } from './message-handler';
import { createReactiveDB } from './reactive-db';
import { createSyncPlugin } from './sync.plugin';
import {
  createTenantSyncIdempotencyKey,
  createTenantSyncLogicalReceiptFingerprint,
  SyncTenantSocketBridge,
  type SyncTenantDataPlane,
  type SyncTenantDataPlaneBinding,
  type SyncTenantDataPlaneReplayChange,
  type SyncTenantDataPlaneWakeup,
} from './sync-tenant-data-plane';
import { clearSyncBackpressure } from './sync-wire-send';
import { SYNC_SNAPSHOT_CHUNK_MAX_WIRE_BYTES } from './sync-snapshot-chunks';
import { SYNC_ACK_ERROR_CODES, SYNC_OUTGOING_BACKPRESSURE_LIMIT } from './types';
import type {
  ServerMessage,
  SyncAuthContext,
  SyncSocketData,
  SyncSubscribeMessage,
} from './types';

const auth: SyncAuthContext = {
  userId: 'user-1',
  email: 'user@example.com',
  role: 'user',
  sessionKind: 'web',
  sessionId: 'session-1',
  sessionGeneration: 1,
  sessionScopeKind: 'tenant',
  sessionScopeId: 'tenant-1',
  tenantId: 'tenant-1',
  membershipId: 'membership-1',
  tenantRole: 'member',
  tenantAuthorizationGeneration: 1,
  membershipAuthorizationGeneration: 1,
};

function socket(sendStatuses: number[] = []) {
  const messages: ServerMessage[] = [];
  const closes: Array<[number | undefined, string | undefined]> = [];
  const data: SyncSocketData = {
    allowedTables: new Set(['platform_users', 'todos']),
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: auth,
    authResolved: true,
    authorizationFingerprint: 'policy',
    authorizationScope: 'scope-current',
    connectionId: 'connection-1',
    query: {},
    stateSubscribed: false,
    ephemeralTopics: new Set(),
    resourceRowFilters: new Map(),
    resourceRowProjectors: new Map(),
    rowFilteredSubscribedTables: new Set(),
  };
  const value = {
    data,
    send(payload: string) {
      messages.push(JSON.parse(payload));
      return sendStatuses.shift() ?? payload.length;
    },
    close(code?: number, reason?: string) { closes.push([code, reason]); },
    subscribe() {},
    unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, messages, closes };
}

class FakeTenantBinding implements SyncTenantDataPlaneBinding {
  readonly databaseRef = 'db:test';
  readonly generation = 7;
  readonly syncEpoch = 'actor-epoch-1';
  readonly rows = new Map<string, DatabaseOperationRow>();
  readonly changes: SyncTenantDataPlaneReplayChange[] = [];
  readonly listeners = new Set<(value: SyncTenantDataPlaneWakeup) => void>();
  readonly receipts = new Map<string, {
    fingerprint: DatabaseLogicalReceiptFingerprint;
    result: DatabaseCommitResult<any>;
  }>();
  readonly expiredReceipts = new Map<
    string,
    DatabaseLogicalReceiptFingerprint
  >();
  writeExecutions = 0;
  released = false;
  releaseCount = 0;
  replayGap = false;
  unknownAfterWrite = false;
  gapAfterWrite = false;
  snapshotCalls: string[][] = [];
  snapshotPageCalls: number[] = [];
  snapshotAbortCount = 0;
  snapshotBeginError: Error | null = null;
  snapshotPageError: Error | null = null;
  snapshotAbortError: Error | null = null;
  receiptLookupError: Error | null = null;
  writeError: Error | null = null;
  onSnapshotMaterialized: (() => void) | null = null;
  snapshotBarrier: Promise<void> | null = null;
  listResultLimitAbove: number | null = null;
  listLimits: number[] = [];

  readonly client = {
    get: async (_table: string, id: string) => ({
      value: this.rows.get(id) ?? null,
      sequence: { seq: this.changes.length },
    }),
    list: async (
      _table: string,
      page: { limit: number; after?: string },
    ) => {
      this.listLimits.push(page.limit);
      if (this.listResultLimitAbove !== null
        && page.limit > this.listResultLimitAbove) {
        throw new DatabaseError(
          'DATABASE_RESULT_LIMIT',
          'Actor result exceeded its IPC limit.',
        );
      }
      const rows = [...this.rows.values()].sort((left, right) =>
        String(left.id).localeCompare(String(right.id)));
      const remaining = page.after === undefined
        ? rows
        : rows.filter((row) => String(row.id) > page.after!);
      const selected = remaining.slice(0, page.limit);
      return {
        value: {
          rows: selected,
          nextCursor: remaining.length > page.limit
            ? String(selected.at(-1)!.id)
            : null,
        },
        sequence: { seq: this.changes.length },
      };
    },
    mutate: async () => { throw new Error('trusted writer required'); },
    batch: async () => { throw new Error('trusted writer required'); },
  } as unknown as AsyncDatabaseClient;

  readonly trustedWriter: DatabaseTrustedWriteExecutor = {
    findReceipt: async (key, fingerprint) => {
      if (this.receiptLookupError) throw this.receiptLookupError;
      const expiredFingerprint = this.expiredReceipts.get(key);
      if (expiredFingerprint) {
        if (expiredFingerprint !== fingerprint) {
          throw Object.assign(new Error('conflict'), { code: 'DATABASE_CONFLICT' });
        }
        throw new DatabaseError(
          'DATABASE_OUTCOME_UNKNOWN',
          'Database receipt result is no longer retained.',
          {
            outcome: 'unknown',
            retryable: false,
            details: { receiptState: 'expired' },
          },
        );
      }
      const receipt = this.receipts.get(key);
      if (!receipt) return { status: 'miss' } as const;
      if (receipt.fingerprint !== fingerprint) {
        throw Object.assign(new Error('conflict'), { code: 'DATABASE_CONFLICT' });
      }
      return { status: 'hit', result: { ...receipt.result, replayed: true } } as const;
    },
    executeWrite: async (operationValue, options) => {
      if (this.writeError) throw this.writeError;
      this.writeExecutions += 1;
      const operation = operationValue as {
        type: 'mutate' | 'batch';
        idempotencyKey: string;
        mutation?: DatabaseMutation;
        mutations?: DatabaseMutation[];
      };
      const existing = this.receipts.get(operation.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== options.logicalReceiptFingerprint) {
          throw Object.assign(new Error('conflict'), { code: 'DATABASE_CONFLICT' });
        }
        return { ...existing.result, replayed: true } as any;
      }
      const mutation = operation.mutation ?? operation.mutations?.[0];
      if (!mutation) throw new Error('missing mutation');
      const previous = mutation.type === 'create'
        ? null
        : mutation.type === 'upsert'
          ? this.rows.get(String(mutation.row.id)) ?? null
          : this.rows.get(mutation.id) ?? null;
      let row: DatabaseOperationRow | null;
      let rowId: string;
      let op: 'INSERT' | 'UPDATE' | 'DELETE';
      if (mutation.type === 'create' || mutation.type === 'upsert') {
        row = mutation.row;
        rowId = String(row.id);
        op = previous ? 'UPDATE' : 'INSERT';
        this.rows.set(rowId, row);
      } else if (mutation.type === 'update') {
        if (!previous) throw Object.assign(new Error('missing'), { code: 'DATABASE_CONFLICT' });
        rowId = mutation.id;
        row = { ...previous, ...mutation.patch };
        op = 'UPDATE';
        this.rows.set(rowId, row);
      } else {
        if (!previous) throw Object.assign(new Error('missing'), { code: 'DATABASE_CONFLICT' });
        rowId = mutation.id;
        row = null;
        op = 'DELETE';
        this.rows.delete(rowId);
      }
      const change = this.appendChange({ table: mutation.table, op, rowId, row, previous });
      const result = {
        value: {
          kind: operation.type === 'batch' ? 'batch' : 'mutation',
          ...(operation.type === 'batch'
            ? { mutations: [effect(mutation, change)] }
            : { mutation: effect(mutation, change) }),
        },
        sequence: { seq: change.seq },
        idempotencyKey: operation.idempotencyKey,
        replayed: false,
      } as DatabaseCommitResult<any>;
      this.receipts.set(operation.idempotencyKey, {
        fingerprint: options.logicalReceiptFingerprint,
        result,
      });
      this.emitChanges(change.seq - 1, change.seq);
      if (this.gapAfterWrite) this.replayGap = true;
      if (this.unknownAfterWrite) {
        throw new DatabaseError(
          'DATABASE_OUTCOME_UNKNOWN',
          'Database operation outcome is unknown.',
          {
            outcome: 'unknown',
            retryable: false,
            details: { retryWithSameKeyOnly: true },
          },
        );
      }
      return result as any;
    },
  };

  async snapshot(tables: readonly string[]) {
    this.snapshotCalls.push([...tables]);
    await this.snapshotBarrier;
    return {
      ...this.identity(),
      tables: Object.fromEntries(tables.map((table) => [
        table,
        table === 'todos' ? [...this.rows.values()] : [],
      ])),
    };
  }

  async beginSnapshot(tables: readonly string[]) {
    this.snapshotCalls.push([...tables]);
    await this.snapshotBarrier;
    if (this.snapshotBeginError) throw this.snapshotBeginError;
    const identity = this.identity();
    const entries = tables.flatMap((table, tableIndex) => (
      table === 'todos'
        ? [...this.rows.values()]
          .sort((left, right) => String(left.id).localeCompare(String(right.id)))
          .map((source, ordinal) => ({
            ordinal,
            tableIndex,
            rowId: String(source.id),
            row: Object.freeze({
              id: source.id,
              title: source.title ?? null,
              visible: source.visible ?? null,
            }),
          }))
        : []
    )).map((entry, ordinal) => ({ ...entry, ordinal }));
    const totalSourceBytes = entries.reduce(
      (bytes, entry) => bytes + new TextEncoder().encode(JSON.stringify(entry.row)).byteLength,
      0,
    );
    this.onSnapshotMaterialized?.();
    let aborted = false;
    return {
      ...identity,
      tables: [...tables],
      totalRows: entries.length,
      totalSourceBytes,
      expiresAt: Date.now() + 30_000,
      get aborted() { return aborted; },
      page: async (cursor: number) => {
        this.snapshotPageCalls.push(cursor);
        if (this.snapshotPageError) throw this.snapshotPageError;
        if (aborted) throw new Error('snapshot aborted');
        const rows: typeof entries = [];
        let pageBytes = 0;
        for (const entry of entries.slice(cursor, cursor + 100)) {
          const entryBytes = new TextEncoder().encode(JSON.stringify(entry.row)).byteLength;
          if (rows.length > 0 && pageBytes + entryBytes > 4_194_304) break;
          rows.push(entry);
          pageBytes += entryBytes;
        }
        const next = cursor + rows.length;
        return {
          cursor,
          rows,
          nextCursor: next === entries.length ? null : next,
        };
      },
      abort: async () => {
        if (this.snapshotAbortError) throw this.snapshotAbortError;
        if (aborted) return;
        aborted = true;
        this.snapshotAbortCount += 1;
      },
    };
  }

  async replay(afterSeq: number, limit = 500) {
    if (this.replayGap) {
      throw Object.assign(new Error('gap'), { code: 'DATABASE_HISTORY_GAP' });
    }
    const available = this.changes.filter((change) => change.seq > afterSeq);
    const changes = available.slice(0, limit);
    const throughSeq = changes.at(-1)?.seq ?? afterSeq;
    return {
      ...this.identity(),
      value: {
        afterSeq,
        throughSeq,
        nextAfterSeq: throughSeq < this.changes.length ? throughSeq : null,
        changes,
      },
    };
  }

  onWakeup(listener: (value: SyncTenantDataPlaneWakeup) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.releaseCount += 1;
    this.listeners.clear();
  }

  emitReset(epoch = 'actor-epoch-2'): void {
    for (const listener of [...this.listeners]) listener({
      type: 'reset', databaseRef: this.databaseRef, generation: this.generation + 1,
      syncEpoch: epoch, sequence: { seq: this.changes.length },
    });
  }

  external(rowId: string, row: DatabaseOperationRow): void {
    this.externalChange(rowId, row, true);
  }

  externalWithoutWakeup(rowId: string, row: DatabaseOperationRow): void {
    this.externalChange(rowId, row, false);
  }

  private externalChange(
    rowId: string,
    row: DatabaseOperationRow,
    wakeup: boolean,
  ): void {
    const previous = this.rows.get(rowId) ?? null;
    this.rows.set(rowId, row);
    const change = this.appendChange({
      table: 'todos', op: previous ? 'UPDATE' : 'INSERT', rowId, row, previous,
    });
    if (wakeup) this.emitChanges(change.seq - 1, change.seq);
  }

  private identity() {
    return {
      databaseRef: this.databaseRef,
      generation: this.generation,
      syncEpoch: this.syncEpoch,
      sequence: { seq: this.changes.length },
    };
  }

  private appendChange(input: {
    table: string;
    op: 'INSERT' | 'UPDATE' | 'DELETE';
    rowId: string;
    row: DatabaseOperationRow | null;
    previous: DatabaseOperationRow | null;
  }): SyncTenantDataPlaneReplayChange {
    const change = {
      seq: this.changes.length + 1,
      table: input.table,
      op: input.op,
      rowId: input.rowId,
      row: input.row,
      previousRow: input.previous,
      ts: this.changes.length + 1,
    } as const;
    this.changes.push(change);
    return change;
  }

  private emitChanges(afterSeq: number, throughSeq: number): void {
    for (const listener of [...this.listeners]) listener({
      type: 'changes', databaseRef: this.databaseRef,
      generation: this.generation, syncEpoch: this.syncEpoch,
      afterSeq, throughSeq,
    });
  }
}

function effect(mutation: DatabaseMutation, change: SyncTenantDataPlaneReplayChange) {
  return {
    type: mutation.type,
    table: change.table,
    rowId: change.rowId,
    changed: true,
    op: change.op,
    sequence: { seq: change.seq },
    row: change.row,
    previousRow: change.previousRow,
  };
}

function plane(binding: FakeTenantBinding): SyncTenantDataPlane {
  return {
    tables: {
      todos: {
        primaryKey: 'id',
        columns: ['id', 'title', 'visible'],
      },
    },
    async bind(context) {
      expect(context.authContext.tenantId).toBe('tenant-1');
      context.assertCurrentAuthoritySync();
      return binding;
    },
  };
}

function bridge(
  ws: ServerWebSocket<SyncSocketData>,
  binding: FakeTenantBinding,
  observability?: PlatformObservabilityRuntime,
  assertCurrentReadAuthoritySync: () => undefined = () => undefined,
): SyncTenantSocketBridge {
  return new SyncTenantSocketBridge({
    socket: ws,
    plane: plane(binding),
    authContext: auth,
    assertCurrentAuthoritySync: () => undefined,
    assertCurrentReadAuthoritySync,
    assertMutationAuthoritySync: () => undefined,
    observability,
  });
}

async function route(
  ws: ServerWebSocket<SyncSocketData>,
  db: ReturnType<typeof createReactiveDB>,
  tenant: SyncTenantSocketBridge,
  message: Record<string, unknown>,
  assertCurrentReadAuthority: () => void = () => undefined,
): Promise<void> {
  await routeMessage(
    ws,
    message,
    db,
    { publish() {} },
    null,
    null,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'multi',
    async () => true,
    () => true,
    tenant,
    undefined,
    assertCurrentReadAuthority,
  );
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function authorityChanged(): Error & { code: string } {
  return Object.assign(new Error('authority changed'), {
    code: 'DATABASE_AUTHORITY_CHANGED',
  });
}

describe('actor-backed tenant Sync bridge', () => {
  test('fails composition when the trusted Resource and actor table catalogs disagree', () => {
    const resourcePolicy = {
      classifyManagedTableRealm: () => 'tenant' as const,
      classifyManagedTableExposure: () => 'sync' as const,
      classifyManagedTableDataPlane: () => 'tenant' as const,
      async resolveTableAccess() {
        return {
          readableTables: new Set(['todos']),
          rowFilters: new Map(),
          readAuthorityFingerprint: 'read-authority',
        };
      },
      validateReadAuthorityAtDelivery: (_context: unknown, fingerprint: string) =>
        fingerprint === 'read-authority',
      async authorizeMutation() { return { ok: false as const, reason: 'denied' }; },
    };
    const config = {
      db: { mode: 'memory' as const },
      tenancyMode: 'multi' as const,
      auth: { required: true, getTokenVerifier: () => null },
      tables: { todos: { id: 'text primary key' } },
      resourcePolicy,
    };

    expect(() => createSyncPlugin(config))
      .toThrow('require a tenant data plane');
    expect(() => createSyncPlugin({
      ...config,
      tenantDataPlane: {
        tables: {},
        async bind() { throw new Error('not reached'); },
      },
    })).toThrow('missing from the actor catalog');
    expect(() => createSyncPlugin({
      ...config,
      tenantDataPlane: {
        tables: {
          todos: { primaryKey: 'id', columns: ['id'] },
          undeclared: { primaryKey: 'id', columns: ['id'] },
        },
        async bind() { throw new Error('not reached'); },
      },
    })).toThrow('is not a Sync-exposed physical tenant resource');
    expect(() => createSyncPlugin({
      ...config,
      tenantDataPlane: {
        tables: {
          todos: { primaryKey: 'id', columns: ['id', 'not valid'] },
        },
        async bind() { throw new Error('not reached'); },
      },
    })).toThrow('table catalog is invalid');
  });

  test('keeps every physical tenant table out of the default database and only exposes Sync tables', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const runtime = new ZeroAppRuntime('tenant-sync-topology-test');
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
      sink: { emit() {} },
      store: null,
      config: { enabled: false },
    });
    const exposure = new Map([
      ['todos', 'sync'],
      ['http_records', 'http'],
      ['internal_secrets', 'internal'],
    ] as const);
    const tenantDataPlane: SyncTenantDataPlane = {
      tables: {
        todos: { primaryKey: 'id', columns: ['id', 'title'] },
      },
      async bind() { throw new Error('not reached'); },
    };

    createSyncPlugin({
      db: { mode: 'memory' },
      reactiveDB: db,
      ownsReactiveDB: false,
      runtime,
      tenancyMode: 'multi',
      auth: { required: true, getTokenVerifier: () => null },
      tables: {
        todos: { id: 'text primary key', title: 'text not null' },
        http_records: { id: 'text primary key', value: 'text not null' },
        internal_secrets: { id: 'text primary key', value: 'text not null' },
      },
      tenantDataPlane,
      resourcePolicy: {
        classifyManagedTableRealm: () => 'tenant',
        classifyManagedTableExposure: (table) => exposure.get(table as any) ?? null,
        classifyManagedTableDataPlane: () => 'tenant',
        async resolveTableAccess() {
          return {
            readableTables: new Set(['todos']),
            rowFilters: new Map(),
            readAuthorityFingerprint: 'read-authority',
          };
        },
        validateReadAuthorityAtDelivery: (_context, fingerprint) =>
          fingerprint === 'read-authority',
        async authorizeMutation() { return { ok: false, reason: 'denied' }; },
      },
    });

    expect(db.hasTable('todos')).toBe(false);
    expect(db.hasTable('http_records')).toBe(false);
    expect(db.hasTable('internal_secrets')).toBe(false);
    expect(Object.keys(tenantDataPlane.tables)).toEqual(['todos']);
    await runtime.dispose();
    db.dispose();
  });

  test('splits one mixed subscribe into independently tagged default and tenant baselines', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('platform_users', { id: 'text primary key' });
    db.insert('platform_users', { id: 'p1' });
    const binding = new FakeTenantBinding();
    binding.rows.set('t1', { id: 't1', title: 'Tenant' });
    const ws = socket();
    const tenant = bridge(ws.value, binding);

    await route(ws.value, db, tenant, {
      type: 'sync.subscribe',
      tables: ['platform_users', 'todos'],
      snapshot: ['platform_users', 'todos'],
      lastSeq: 0,
    });

    expect(ws.messages.map((message) => [message.type, 'plane' in message && message.plane]))
      .toEqual([
        ['sync.snapshot', 'default'],
        ['sync.snapshot.begin', 'tenant'],
        ['sync.snapshot.chunk', 'tenant'],
        ['sync.snapshot.end', 'tenant'],
      ]);
    expect(ws.data.lastSeq).toBe(1);
    expect(tenant.diagnostics()).toMatchObject({
      actorCursor: 0,
      lastDeliveredWireSeq: 0,
    });
    expect(db.hasTable('todos')).toBe(false);
    tenant.dispose();
    db.dispose();
  });

  test('streams one exact baseline at H before replaying an interleaved write after H', async () => {
    const binding = new FakeTenantBinding();
    binding.rows.set('t1', { id: 't1', title: 'Before' });
    binding.onSnapshotMaterialized = () => {
      binding.onSnapshotMaterialized = null;
      binding.externalWithoutWakeup('t1', { id: 't1', title: 'After' });
    };
    const ws = socket();
    const tenant = bridge(ws.value, binding);

    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    await settle();

    const chunk = ws.messages.find((message) => message.type === 'sync.snapshot.chunk');
    const change = ws.messages.find((message) => message.type === 'sync.change');
    expect(chunk).toMatchObject({
      type: 'sync.snapshot.chunk',
      table: 'todos',
      rows: { t1: { id: 't1', title: 'Before' } },
    });
    expect(change).toMatchObject({
      type: 'sync.change',
      seq: 1,
      row: { id: 't1', title: 'After' },
    });
    expect(binding.snapshotCalls).toEqual([['todos']]);
    expect(binding.snapshotAbortCount).toBe(1);
    expect(tenant.diagnostics()).toMatchObject({ actorCursor: 1 });
    tenant.dispose();
  });

  test('chunks the final keyed wire shape when long identities exceed one frame', async () => {
    const binding = new FakeTenantBinding();
    for (let index = 0; index < 700; index += 1) {
      const id = `${String(index).padStart(4, '0')}-${'x'.repeat(900)}`;
      binding.rows.set(id, { id, title: `Row ${index}` });
    }
    const ws = socket();
    const tenant = bridge(ws.value, binding);

    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });

    const chunks = ws.messages.filter(
      (message) => message.type === 'sync.snapshot.chunk',
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(ws.messages[0]?.type).toBe('sync.snapshot.begin');
    expect(ws.messages.at(-1)?.type).toBe('sync.snapshot.end');
    expect(ws.messages.every((message) =>
      new TextEncoder().encode(JSON.stringify(message)).byteLength
        <= SYNC_SNAPSHOT_CHUNK_MAX_WIRE_BYTES)).toBe(true);
    expect(ws.closes).toEqual([]);
    tenant.dispose();
  });

  test('streams a baseline larger than Bun backpressure capacity one drained frame at a time', async () => {
    const binding = new FakeTenantBinding();
    for (let index = 0; index < 20; index += 1) {
      const id = `large-${String(index).padStart(2, '0')}`;
      binding.rows.set(id, { id, title: 'x'.repeat(850_000) });
    }
    const ws = socket(Array.from({ length: 64 }, () => -1));
    const tenant = bridge(ws.value, binding);
    let complete = false;
    const pending = tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    }).then(() => { complete = true; });

    for (let attempt = 0; attempt < 64 && !complete; attempt += 1) {
      await settle();
      if (ws.data.syncBackpressured) {
        clearSyncBackpressure(ws.value);
        tenant.resume();
      }
    }
    await pending;

    expect(ws.messages[0]?.type).toBe('sync.snapshot.begin');
    expect(ws.messages.at(-1)?.type).toBe('sync.snapshot.end');
    expect(ws.messages.reduce(
      (bytes, message) => bytes + new TextEncoder().encode(JSON.stringify(message)).byteLength,
      0,
    )).toBeGreaterThan(SYNC_OUTGOING_BACKPRESSURE_LIMIT);
    expect(ws.closes).toEqual([]);
    expect(tenant.diagnostics()).toMatchObject({ actorCursor: 0 });
    tenant.dispose();
  });

  test('does not send an actor snapshot after read authority changes during the read', async () => {
    const binding = new FakeTenantBinding();
    binding.rows.set('t1', { id: 't1', title: 'Private tenant row' });
    let release!: () => void;
    binding.snapshotBarrier = new Promise<void>((resolve) => { release = resolve; });
    let authorityCurrent = true;
    const ws = socket();
    const tenant = bridge(ws.value, binding, undefined, () => {
      if (!authorityCurrent) throw authorityChanged();
      return undefined;
    });

    const pending = tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    await settle();
    authorityCurrent = false;
    release();
    await pending;

    expect(ws.messages).toEqual([]);
    expect(binding.releaseCount).toBe(1);
  });

  test('does not send a snapshot chunk or end after authority changes during drain', async () => {
    const binding = new FakeTenantBinding();
    binding.rows.set('t1', { id: 't1', title: 'Private tenant row' });
    let authorityCurrent = true;
    const ws = socket([-1]);
    const tenant = bridge(ws.value, binding, undefined, () => {
      if (!authorityCurrent) throw authorityChanged();
      return undefined;
    });

    const pending = tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    await settle();
    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
    ]);

    authorityCurrent = false;
    clearSyncBackpressure(ws.value);
    tenant.resume();
    await pending;

    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
    ]);
    expect(binding.releaseCount).toBe(1);
  });

  test('streams the actor snapshot through retry-safe session pages', async () => {
    const binding = new FakeTenantBinding();
    binding.rows.set('t1', { id: 't1', title: 'Tenant' });
    const ws = socket();
    const tenant = bridge(ws.value, binding);

    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });

    expect(binding.snapshotPageCalls).toEqual([0]);
    expect(binding.listLimits).toEqual([]);
    expect(binding.snapshotAbortCount).toBe(1);
    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin', 'sync.snapshot.chunk', 'sync.snapshot.end',
    ]);
    expect(ws.closes).toEqual([]);
    tenant.dispose();
  });

  test('closes terminally when snapshot cleanup and telemetry both fail', async () => {
    const binding = new FakeTenantBinding();
    binding.snapshotPageError = new DatabaseError(
      'DATABASE_PAYLOAD_LIMIT',
      'Actor snapshot page exceeds its bounded contract.',
    );
    binding.snapshotAbortError = new Error('/private/snapshot/session');
    binding.rows.set('t1', { id: 't1', title: 'Tenant' });
    const ws = socket();
    const tenant = bridge(ws.value, binding, {
      sink: {
        emit() {
          throw new Error('private observability failure');
        },
      },
      store: null,
      config: { console: false },
    });

    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });

    expect(binding.snapshotPageCalls).toEqual([0]);
    expect(binding.snapshotAbortCount).toBe(0);
    expect(ws.closes.at(-1)?.[0]).toBe(4004);
    expect(binding.releaseCount).toBe(1);
  });

  test('closes mutation recovery even when telemetry fails', async () => {
    const binding = new FakeTenantBinding();
    const ws = socket();
    const tenant = bridge(ws.value, binding, {
      sink: {
        emit() {
          throw new Error('private observability failure');
        },
      },
      store: null,
      config: { console: false },
    });
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });

    expect(() => tenant.recoverUnacknowledgedMutation()).not.toThrow();
    expect(ws.closes.at(-1)).toEqual([
      1012, 'Tenant Sync mutation recovery required',
    ]);
    expect(binding.releaseCount).toBe(1);
  });

  test('closes terminally for non-retryable staged snapshot contract failures', async () => {
    const scenarios = [
      {
        stage: 'begin' as const,
        error: new DatabaseError(
          'DATABASE_PROTOCOL_ERROR',
          'Actor snapshot begin result is invalid.',
        ),
      },
      {
        stage: 'page' as const,
        error: new DatabaseError(
          'DATABASE_PROTOCOL_ERROR',
          'Actor snapshot page result is invalid.',
        ),
      },
      {
        stage: 'page' as const,
        error: new DatabaseError(
          'DATABASE_RESULT_LIMIT',
          'Actor snapshot page exceeded its response bound.',
        ),
      },
    ];

    for (const scenario of scenarios) {
      const binding = new FakeTenantBinding();
      binding.rows.set('t1', { id: 't1', title: 'Tenant' });
      if (scenario.stage === 'begin') binding.snapshotBeginError = scenario.error;
      else binding.snapshotPageError = scenario.error;
      const ws = socket();
      const tenant = bridge(ws.value, binding);

      await tenant.subscribe({
        type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
      });

      expect(ws.closes.at(-1)?.[0]).toBe(4004);
      expect(binding.releaseCount).toBe(1);
    }
  });

  test('closes permanent database-capacity subscription failure once without snapshot telemetry', async () => {
    const binding = new FakeTenantBinding();
    binding.snapshotBeginError = new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      '/private/tenant/acme.sqlite cannot be created',
      {
        retryable: false,
        outcome: 'not-started',
        details: {
          capacityType: 'files',
          capacityLimit: 10_000,
          privatePath: '/private/tenant/acme.sqlite',
        },
      },
    );
    const ws = socket();
    const events = new MemoryEventStore();
    const observability = {
      sink: events,
      store: events,
      config: { console: false, store: events },
    };
    const tenant = bridge(ws.value, binding, observability);
    const subscription: SyncSubscribeMessage = {
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    };

    await tenant.subscribe(subscription);
    await tenant.subscribe(subscription);

    expect(ws.closes).toEqual([
      [4004, 'Tenant Sync database capacity is exhausted'],
    ]);
    expect(binding.releaseCount).toBe(1);
    expect(tenant.diagnostics().bound).toBe(false);
    expect(events.query().events.some((event) => (
      event.code === OBS_CODES.SYNC_SNAPSHOT_TRANSPORT_REJECTED.code
      || event.code === OBS_CODES.SYNC_TENANT_SNAPSHOT_BUDGET_REJECTED.code
    ))).toBe(false);
    expect(JSON.stringify({ closes: ws.closes, events: events.query().events }))
      .not.toContain('/private/');
  });

  test('fails the accepted baseline closed when session cleanup alone fails', async () => {
    const binding = new FakeTenantBinding();
    binding.rows.set('t1', { id: 't1', title: 'Tenant' });
    binding.snapshotAbortError = new Error('/private/snapshot/session');
    const ws = socket();
    const events = new MemoryEventStore();
    const observability = {
      sink: events,
      store: events,
      config: { console: false, store: events },
    };
    const tenant = bridge(ws.value, binding, observability);

    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });

    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin', 'sync.snapshot.chunk', 'sync.snapshot.end',
    ]);
    expect(ws.closes.at(-1)?.[0]).toBe(1012);
    const cleanup = events.query().events.find((event) => (
      event.code === OBS_CODES.SYNC_TENANT_SNAPSHOT_CLEANUP_FAILED.code
    ));
    expect(cleanup?.metadata).toEqual({
      plane: 'tenant-database',
      reason: 'snapshot-cleanup-failed',
    });
    expect(cleanup?.message).toBe('Tenant Sync snapshot cleanup failed.');
    expect(JSON.stringify(events.query().events)).not.toContain('/private/');
    expect(binding.releaseCount).toBe(1);
  });

  test('uses independent reconnect cursors, epochs, and per-plane scope reset', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('platform_users', { id: 'text primary key' });
    db.insert('platform_users', { id: 'p1' });
    const binding = new FakeTenantBinding();
    binding.external('t1', { id: 't1', title: 'One' });
    const ws = socket();
    const tenant = bridge(ws.value, binding);

    await route(ws.value, db, tenant, {
      type: 'sync.subscribe',
      tables: ['platform_users', 'todos'],
      snapshot: ['platform_users', 'todos'],
      lastSeq: 999,
      epoch: 'wrong-default',
      scope: 'wrong-top-level',
      cursors: {
        default: { lastSeq: 1, epoch: db.syncEpoch, scope: 'scope-current' },
        tenant: { lastSeq: 1, epoch: binding.syncEpoch, scope: 'scope-stale' },
      },
    });

    expect(ws.messages[0]).toMatchObject({
      type: 'sync.catchup', plane: 'default', prevSeq: 1,
    });
    expect(ws.messages[1]).toMatchObject({
      type: 'sync.snapshot.begin', plane: 'tenant', reset: 'purge',
    });
    tenant.dispose();
    db.dispose();
  });

  test('emits an empty tenant baseline when actor tables were requested but none are readable', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('platform_users', { id: 'text primary key' });
    const binding = new FakeTenantBinding();
    const ws = socket();
    ws.data.allowedTables.delete('todos');
    const tenant = bridge(ws.value, binding);

    await route(ws.value, db, tenant, {
      type: 'sync.subscribe', tables: ['platform_users', 'todos'],
      snapshot: ['platform_users', 'todos'], lastSeq: 0,
    });

    expect(ws.messages.at(-1)).toMatchObject({
      type: 'sync.snapshot', plane: 'tenant', tables: {},
    });
    expect(binding.snapshotCalls).toEqual([]);
    expect(binding.releaseCount).toBe(0);
    expect(tenant.diagnostics()).toMatchObject({ bound: false });
    expect(ws.closes).toEqual([]);
    tenant.dispose();
    db.dispose();
  });

  test('cancels an older asynchronous baseline before a newer subscribe can replace it', async () => {
    const binding = new FakeTenantBinding();
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    let release!: () => void;
    binding.snapshotBarrier = new Promise<void>((resolve) => { release = resolve; });

    const stale = tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    await settle();
    const current = tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: [], lastSeq: 0,
    });
    release();
    await Promise.all([stale, current]);

    expect(binding.snapshotCalls).toEqual([['todos'], []]);
    expect(ws.messages).toEqual([expect.objectContaining({
      type: 'sync.snapshot', plane: 'tenant', tables: {},
    })]);
    tenant.dispose();
  });

  test('cancels a superseded snapshot at final-chunk drain before accepting its cursor', async () => {
    const binding = new FakeTenantBinding();
    binding.rows.set('stale', { id: 'stale', title: 'Stale baseline' });
    const ws = socket([100, -1, 100]);
    const tenant = bridge(ws.value, binding);

    const stale = tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    await settle();
    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
      'sync.snapshot.chunk',
    ]);
    expect(ws.data.syncBackpressured).toBe(true);

    const current = tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: [], lastSeq: 0,
    });
    clearSyncBackpressure(ws.value);
    tenant.resume();
    await Promise.all([stale, current]);

    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
      'sync.snapshot.chunk',
      'sync.snapshot',
    ]);
    expect(ws.messages.at(-1)).toMatchObject({
      type: 'sync.snapshot', plane: 'tenant', tables: {},
    });
    expect(ws.messages.some((message) => message.type === 'sync.snapshot.end'))
      .toBe(false);
    tenant.dispose();
  });

  test('does not bind for a tenant mutation when no actor table is authorized', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    const ws = socket();
    ws.data.allowedTables.delete('todos');
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;

    await route(ws.value, db, tenant, {
      type: 'sync.mutate', ref: 'unauthorized', table: 'todos', op: 'INSERT',
      row: { id: 't1', title: 'Must not bind' },
    });

    expect(ws.messages).toEqual([expect.objectContaining({
      type: 'sync.ack', plane: 'tenant', ref: 'unauthorized', ok: false,
    })]);
    expect(binding.snapshotCalls).toEqual([]);
    expect(binding.writeExecutions).toBe(0);
    expect(binding.releaseCount).toBe(0);
    expect(tenant.diagnostics()).toMatchObject({ bound: false });
    tenant.dispose();
    db.dispose();
  });

  test('cancels a draining snapshot and purges tenant state when the subscription clears', async () => {
    const binding = new FakeTenantBinding();
    binding.rows.set('stale', { id: 'stale', title: 'Stale baseline' });
    const ws = socket([100, -1, 100]);
    const tenant = bridge(ws.value, binding);

    const stale = tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    await settle();
    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
      'sync.snapshot.chunk',
    ]);

    const cleared = tenant.clearSubscription();
    clearSyncBackpressure(ws.value);
    tenant.resume();
    await Promise.all([stale, cleared]);

    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
      'sync.snapshot.chunk',
      'sync.snapshot',
    ]);
    expect(ws.messages.at(-1)).toMatchObject({
      type: 'sync.snapshot',
      plane: 'tenant',
      tables: {},
      reset: 'purge',
    });
    expect(ws.messages.some((message) => message.type === 'sync.snapshot.end'))
      .toBe(false);
    expect(binding.releaseCount).toBe(1);
    expect(tenant.diagnostics()).toMatchObject({ bound: false });
    tenant.dispose();
  });

  test('rejects actor mutation before a tenant baseline without starting a write', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    const ws = socket();
    const tenant = bridge(ws.value, binding);

    await route(ws.value, db, tenant, {
      type: 'sync.mutate', ref: 'too-early', table: 'todos', op: 'INSERT',
      row: { id: 't1', title: 'Must not commit' },
    });

    expect(ws.messages).toEqual([expect.objectContaining({
      type: 'sync.ack', plane: 'tenant', ref: 'too-early', ok: false,
    })]);
    expect(binding.rows.size).toBe(0);
    expect(binding.receipts.size).toBe(0);
    tenant.dispose();
    db.dispose();
  });

  test('advances actor replay across filtered gaps while preserving the wire predecessor', async () => {
    const binding = new FakeTenantBinding();
    const ws = socket();
    ws.data.resourceRowFilters.set('todos', {
      matches: (row) => row.visible === true,
    });
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;

    binding.external('hidden', { id: 'hidden', title: 'No', visible: false });
    binding.external('shown', { id: 'shown', title: 'Yes', visible: true });
    await settle();

    expect(ws.messages).toEqual([expect.objectContaining({
      type: 'sync.change', plane: 'tenant', seq: 2, prevSeq: 0, rowId: 'shown',
    })]);
    expect(tenant.diagnostics()).toMatchObject({
      actorCursor: 2,
      lastDeliveredWireSeq: 2,
    });
    tenant.dispose();
  });

  test('pauses on backpressure, resumes on drain, and releases wakeup state on cleanup', async () => {
    const binding = new FakeTenantBinding();
    const ws = socket([100, 100, -1, 100]);
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;

    binding.external('one', { id: 'one', title: 'One' });
    await settle();
    expect(ws.data.syncBackpressured).toBe(true);
    binding.external('two', { id: 'two', title: 'Two' });
    await settle();
    expect(ws.messages.map((message) => message.type)).toEqual(['sync.change']);

    clearSyncBackpressure(ws.value);
    tenant.resume();
    await settle();
    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.change', 'sync.change',
    ]);
    tenant.dispose();
    expect(binding.releaseCount).toBe(1);
    expect(binding.listeners.size).toBe(0);
  });

  test('reset/history invalidation closes 1012 and releases the binding', async () => {
    const binding = new FakeTenantBinding();
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    binding.emitReset();

    expect(ws.closes.at(-1)?.[0]).toBe(1012);
    expect(binding.releaseCount).toBe(1);
  });

  test('emits tenant recovery events only through its app-local runtime', async () => {
    const ambient = new MemoryEventStore();
    const local = new MemoryEventStore();
    configureObservability({ console: false, store: ambient });
    try {
      const binding = new FakeTenantBinding();
      const ws = socket();
      const tenant = bridge(ws.value, binding, {
        sink: local,
        store: local,
        config: { console: false, store: local },
      });
      await tenant.subscribe({
        type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
      });
      binding.emitReset();

      expect(local.query().events.map((event) => event.code)).toEqual([
        OBS_CODES.SYNC_TENANT_RESNAPSHOT_REQUIRED.code,
      ]);
      expect(ambient.query().count).toBe(0);

      const standaloneBinding = new FakeTenantBinding();
      const standaloneSocket = socket();
      const standalone = bridge(standaloneSocket.value, standaloneBinding);
      await standalone.subscribe({
        type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
      });
      standaloneBinding.emitReset();
      expect(ambient.query().count).toBe(0);
    } finally {
      configureObservability(false);
    }
  });

  test('closes and releases when live replay reports a retained-history gap', async () => {
    const binding = new FakeTenantBinding();
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    binding.replayGap = true;
    binding.external('lost', { id: 'lost', title: 'Lost' });
    await settle();

    expect(ws.closes.at(-1)?.[0]).toBe(1012);
    expect(binding.releaseCount).toBe(1);
  });

  test('consumes replay teardown failures after attempting close and release', async () => {
    const binding = new FakeTenantBinding();
    const ws = socket();
    let closeAttempts = 0;
    (ws.value as unknown as {
      close(code?: number, reason?: string): void;
    }).close = () => {
      closeAttempts += 1;
      throw new Error('private transport close failure');
    };
    const tenant = bridge(ws.value, binding, {
      sink: {
        emit() {
          throw new Error('private observability failure');
        },
      },
      store: null,
      config: { console: false },
    });
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    binding.replayGap = true;
    binding.external('lost', { id: 'lost', title: 'Lost' });
    await settle();

    expect(closeAttempts).toBe(1);
    expect(binding.releaseCount).toBe(1);
  });

  test('delivers the canonical origin change before ack and replays the exact receipt', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;
    const mutation = {
      type: 'sync.mutate', ref: 'stable-ref', table: 'todos', op: 'INSERT',
      row: { id: 't1', title: 'Canonical' },
    } as const;

    await route(ws.value, db, tenant, mutation);
    await settle();
    expect(ws.messages).toEqual([
      expect.objectContaining({
        type: 'sync.change', plane: 'tenant', seq: 1, rowId: 't1',
        origin: 'connection-1',
      }),
      expect.objectContaining({
        type: 'sync.ack', plane: 'tenant', ref: 'stable-ref', ok: true, seq: 1,
      }),
    ]);
    expect(tenant.diagnostics().actorCursor).toBe(1);

    ws.messages.length = 0;
    await route(ws.value, db, tenant, { ...mutation, attempt: 2 });
    expect(ws.messages).toEqual([expect.objectContaining({
      type: 'sync.ack', plane: 'tenant', ref: 'stable-ref', ok: true, seq: 1,
    })]);
    binding.external('t2', { id: 't2', title: 'External' });
    await settle();
    expect(ws.messages.at(-1)).toMatchObject({
      type: 'sync.change', plane: 'tenant', seq: 2, rowId: 't2',
    });
    tenant.dispose();
    db.dispose();
  });

  test('does not send a canonical ack when its projector revokes read authority', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    const ws = socket();
    let authorityCurrent = true;
    let projections = 0;
    const assertAuthority = () => {
      if (!authorityCurrent) throw authorityChanged();
      return undefined;
    };
    const tenant = bridge(ws.value, binding, undefined, assertAuthority);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;
    ws.data.resourceRowProjectors = new Map([['todos', {
      project(row) {
        projections += 1;
        if (projections === 2) authorityCurrent = false;
        return row;
      },
    }]]);

    await route(ws.value, db, tenant, {
      type: 'sync.mutate', ref: 'revoked-ack', table: 'todos', op: 'INSERT',
      row: { id: 't1', title: 'Committed' },
    }, assertAuthority);

    expect(projections).toBe(2);
    expect(binding.rows.get('t1')).toMatchObject({ title: 'Committed' });
    expect(ws.messages).toEqual([
      expect.objectContaining({
        type: 'sync.change', plane: 'tenant', seq: 1, rowId: 't1',
      }),
    ]);
    tenant.dispose();
    db.dispose();
  });

  test('does not send a replayed canonical ack after read authority changes', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    const ws = socket();
    let authorityCurrent = true;
    const assertAuthority = () => {
      if (!authorityCurrent) throw authorityChanged();
      return undefined;
    };
    const tenant = bridge(ws.value, binding, undefined, assertAuthority);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    const mutation = {
      type: 'sync.mutate', ref: 'revoked-replay-ack', table: 'todos', op: 'INSERT',
      row: { id: 't1', title: 'Committed' },
    } as const;
    await route(ws.value, db, tenant, mutation, assertAuthority);
    ws.messages.length = 0;
    ws.data.resourceRowProjectors = new Map([['todos', {
      project(row) {
        authorityCurrent = false;
        return row;
      },
    }]]);

    await route(ws.value, db, tenant, { ...mutation, attempt: 2 }, assertAuthority);

    expect(binding.writeExecutions).toBe(1);
    expect(ws.messages).toEqual([]);
    tenant.dispose();
    db.dispose();
  });

  test('rechecks mutation authority after ordered replay and immediately before ack', async () => {
    const binding = new FakeTenantBinding();
    const ws = socket();
    let mutationAuthorityCurrent = true;
    let mutationAuthorityChecks = 0;
    let acknowledged = false;
    const tenant = new SyncTenantSocketBridge({
      socket: ws.value,
      plane: plane(binding),
      authContext: auth,
      assertCurrentAuthoritySync: () => undefined,
      assertCurrentReadAuthoritySync: () => undefined,
      assertMutationAuthoritySync: () => {
        mutationAuthorityChecks += 1;
        if (!mutationAuthorityCurrent) throw authorityChanged();
        return undefined;
      },
    });
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;

    const send = ws.value.send.bind(ws.value);
    ws.value.send = ((payload: string) => {
      const status = send(payload);
      if ((JSON.parse(payload) as ServerMessage).type === 'sync.change') {
        // Runs after replay's final send but before the awaiting commit
        // continuation. This deterministically exercises the pre-ack window.
        queueMicrotask(() => { mutationAuthorityCurrent = false; });
      }
      return status;
    }) as typeof ws.value.send;

    const message = {
      table: 'todos', op: 'INSERT' as const,
      row: { id: 'authority-window', title: 'Committed' },
    };
    await expect(tenant.commit({
      mutation: {
        type: 'upsert', table: message.table, row: message.row,
      },
      idempotencyKey: 'sync:test-pre-ack-mutation-authority',
      logicalReceiptFingerprint: createTenantSyncLogicalReceiptFingerprint(message),
      authorityFingerprint: 'mutation-authority-v1',
      acknowledge: () => { acknowledged = true; },
    })).rejects.toMatchObject({
      code: 'SYNC_TENANT_MUTATION_RECOVERY_REQUIRED',
    });

    expect(binding.rows.get('authority-window')).toMatchObject({
      title: 'Committed',
    });
    expect(ws.messages).toEqual([expect.objectContaining({
      type: 'sync.change', plane: 'tenant', rowId: 'authority-window',
    })]);
    expect(mutationAuthorityChecks).toBe(3);
    expect(acknowledged).toBe(false);
    tenant.dispose();
  });

  test('rechecks durable authority after receipt replay and immediately before ack', async () => {
    const binding = new FakeTenantBinding();
    const ws = socket();
    let authorityCurrent = true;
    let acknowledged = false;
    const assertAuthority = () => {
      if (!authorityCurrent) throw authorityChanged();
      return undefined;
    };
    const tenant = new SyncTenantSocketBridge({
      socket: ws.value,
      plane: plane(binding),
      authContext: auth,
      assertCurrentAuthoritySync: assertAuthority,
      assertCurrentReadAuthoritySync: assertAuthority,
      assertMutationAuthoritySync: () => undefined,
    });
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;

    const message = {
      table: 'todos', op: 'INSERT' as const,
      row: { id: 'receipt-authority-window', title: 'Committed' },
    };
    const idempotencyKey = 'sync:test-pre-ack-receipt-authority';
    const logicalReceiptFingerprint = createTenantSyncLogicalReceiptFingerprint(message);
    await binding.trustedWriter.executeWrite({
      type: 'mutate',
      idempotencyKey,
      mutation: { type: 'upsert', table: message.table, row: message.row },
    }, { logicalReceiptFingerprint });

    const send = ws.value.send.bind(ws.value);
    ws.value.send = ((payload: string) => {
      const status = send(payload);
      if ((JSON.parse(payload) as ServerMessage).type === 'sync.change') {
        queueMicrotask(() => { authorityCurrent = false; });
      }
      return status;
    }) as typeof ws.value.send;

    await expect(tenant.replayMutationReceipt({
      idempotencyKey,
      logicalReceiptFingerprint,
      expected: { table: message.table, op: message.op },
      authorize: () => true,
      acknowledge: () => { acknowledged = true; },
    })).rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });

    expect(ws.messages).toEqual([expect.objectContaining({
      type: 'sync.change', plane: 'tenant', rowId: 'receipt-authority-window',
    })]);
    expect(acknowledged).toBe(false);
    tenant.dispose();
  });

  test('replays an INSERT intent whose actor upsert updated an existing row', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    binding.rows.set('t1', { id: 't1', title: 'Before' });
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;
    const mutation = {
      type: 'sync.mutate', ref: 'upsert-ref', table: 'todos', op: 'INSERT',
      row: { id: 't1', title: 'After' },
    } as const;

    await route(ws.value, db, tenant, mutation);
    expect(ws.messages).toEqual([
      expect.objectContaining({ type: 'sync.change', op: 'UPDATE', seq: 1 }),
      expect.objectContaining({ type: 'sync.ack', ok: true, seq: 1 }),
    ]);

    ws.messages.length = 0;
    await route(ws.value, db, tenant, { ...mutation, attempt: 2 });
    expect(ws.messages).toEqual([expect.objectContaining({
      type: 'sync.ack', plane: 'tenant', ok: true, seq: 1,
    })]);
    tenant.dispose();
    db.dispose();
  });

  test('closes without ack on an unknown write outcome and settles the same receipt after reconnect', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    binding.unknownAfterWrite = true;
    const firstSocket = socket();
    const firstBridge = bridge(firstSocket.value, binding);
    await firstBridge.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    firstSocket.messages.length = 0;
    const mutation = {
      type: 'sync.mutate', ref: 'unknown-ref', table: 'todos', op: 'INSERT',
      row: { id: 'uncertain', title: 'Committed once' },
    } as const;

    await route(firstSocket.value, db, firstBridge, mutation);

    expect(firstSocket.messages).toEqual([]);
    expect(firstSocket.closes.at(-1)).toEqual([
      1012, 'Tenant Sync mutation recovery required',
    ]);
    expect(binding.receipts.size).toBe(1);
    expect(binding.rows.get('uncertain')).toMatchObject({ title: 'Committed once' });

    binding.unknownAfterWrite = false;
    binding.released = false;
    const retrySocket = socket();
    const retryBridge = bridge(retrySocket.value, binding);
    await retryBridge.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    retrySocket.messages.length = 0;
    await route(retrySocket.value, db, retryBridge, { ...mutation, attempt: 2 });

    expect(retrySocket.messages).toEqual([expect.objectContaining({
      type: 'sync.ack', plane: 'tenant', ref: mutation.ref, ok: true, seq: 1,
    })]);
    expect(binding.changes).toHaveLength(1);
    retryBridge.dispose();
    db.dispose();
  });

  test('rejects an expired receipt after baseline without reconnect or re-execution', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    binding.rows.set('settled', {
      id: 'settled',
      title: 'Authoritative current state',
    });
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    const mutation = {
      type: 'sync.mutate',
      ref: 'expired-ref',
      table: 'todos',
      op: 'INSERT',
      row: { id: 'settled', title: 'Old requested state' },
    } as const;
    binding.expiredReceipts.set(
      createTenantSyncIdempotencyKey(auth, mutation.ref),
      createTenantSyncLogicalReceiptFingerprint(mutation),
    );

    // The bridge will not inspect a receipt until this authoritative baseline
    // has been delivered and accepted for the actor plane.
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
      'sync.snapshot.chunk',
      'sync.snapshot.end',
    ]);
    expect(ws.messages[0]).toMatchObject({
      type: 'sync.snapshot.begin',
      plane: 'tenant',
    });
    expect(ws.messages.find((message) =>
      message.type === 'sync.snapshot.chunk')).toMatchObject({
      type: 'sync.snapshot.chunk',
      plane: 'tenant',
      table: 'todos',
      rows: {
        settled: { title: 'Authoritative current state' },
      },
    });
    ws.messages.length = 0;

    await route(ws.value, db, tenant, { ...mutation, attempt: 2 });
    await route(ws.value, db, tenant, { ...mutation, attempt: 3 });

    expect(ws.messages).toEqual([
      {
        type: 'sync.ack',
        plane: 'tenant',
        ref: mutation.ref,
        ok: false,
        seq: null,
        error: 'Mutation result expired; current synchronized state is authoritative',
        errorCode: SYNC_ACK_ERROR_CODES.mutationReceiptExpired,
      },
      {
        type: 'sync.ack',
        plane: 'tenant',
        ref: mutation.ref,
        ok: false,
        seq: null,
        error: 'Mutation result expired; current synchronized state is authoritative',
        errorCode: SYNC_ACK_ERROR_CODES.mutationReceiptExpired,
      },
    ]);
    expect(ws.closes).toEqual([]);
    expect(binding.writeExecutions).toBe(0);
    expect(binding.changes).toEqual([]);
    expect(binding.rows.get('settled')).toEqual({
      id: 'settled', title: 'Authoritative current state',
    });

    tenant.dispose();
    db.dispose();
  });

  test('returns a permanent-capacity negative ack when receipt lookup rejects', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    binding.receiptLookupError = new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      '/private/receipt/ledger is full',
      {
        retryable: false,
        outcome: 'not-started',
        details: { capacityType: 'receipts', capacityLimit: 1_000_000 },
      },
    );
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;

    await route(ws.value, db, tenant, {
      type: 'sync.mutate', ref: 'lookup-capacity', table: 'todos', op: 'INSERT',
      row: { id: 'capacity-row', title: 'Must not commit' },
    });

    expect(ws.messages).toEqual([{
      type: 'sync.ack',
      plane: 'tenant',
      ref: 'lookup-capacity',
      ok: false,
      seq: null,
      error: 'Mutation capacity is exhausted; new mutations are not accepted',
      errorCode: SYNC_ACK_ERROR_CODES.mutationCapacityExhausted,
    }]);
    expect(ws.closes).toEqual([]);
    expect(binding.writeExecutions).toBe(0);
    expect(binding.rows).toEqual(new Map());
    expect(JSON.stringify(ws.messages)).not.toContain('/private/');

    tenant.dispose();
    db.dispose();
  });

  test('returns a permanent-capacity negative ack before an unseen receipt can commit', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    binding.writeError = new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      '/private/receipt/ledger is full',
      {
        retryable: false,
        outcome: 'not-started',
        details: { capacityType: 'receipts', capacityLimit: 1_000_000 },
      },
    );
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;

    await route(ws.value, db, tenant, {
      type: 'sync.mutate', ref: 'commit-capacity', table: 'todos', op: 'INSERT',
      row: { id: 'capacity-row', title: 'Must not commit' },
    });

    expect(ws.messages).toEqual([{
      type: 'sync.ack',
      plane: 'tenant',
      ref: 'commit-capacity',
      ok: false,
      seq: null,
      error: 'Mutation capacity is exhausted; new mutations are not accepted',
      errorCode: SYNC_ACK_ERROR_CODES.mutationCapacityExhausted,
    }]);
    expect(ws.closes).toEqual([]);
    expect(binding.writeExecutions).toBe(0);
    expect(binding.rows).toEqual(new Map());
    expect(binding.changes).toEqual([]);
    expect(binding.receipts.size).toBe(0);
    expect(JSON.stringify(ws.messages)).not.toContain('/private/');

    tenant.dispose();
    db.dispose();
  });

  test('does not classify non-receipt permanent capacity as mutation receipt exhaustion', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    binding.writeError = new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      '/private/database/root is full',
      {
        retryable: false,
        outcome: 'not-started',
        details: { capacityType: 'files', capacityLimit: 10_000 },
      },
    );
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;

    await route(ws.value, db, tenant, {
      type: 'sync.mutate', ref: 'file-capacity', table: 'todos', op: 'INSERT',
      row: { id: 'capacity-row', title: 'Must not commit' },
    });

    expect(ws.messages).toEqual([{
      type: 'sync.ack',
      plane: 'tenant',
      ref: 'file-capacity',
      ok: false,
      seq: null,
      error: 'Mutation failed',
    }]);
    expect(ws.closes).toEqual([]);
    expect(binding.writeExecutions).toBe(0);
    expect(binding.rows).toEqual(new Map());
    expect(JSON.stringify(ws.messages)).not.toContain('/private/');

    tenant.dispose();
    db.dispose();
  });

  test('closes without negative ack when ordered replay gaps after a committed write', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    binding.gapAfterWrite = true;
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;

    await route(ws.value, db, tenant, {
      type: 'sync.mutate', ref: 'gap-ref', table: 'todos', op: 'INSERT',
      row: { id: 'committed', title: 'Needs receipt recovery' },
    });

    expect(ws.messages).toEqual([]);
    expect(ws.closes.at(-1)).toEqual([
      1012, 'Tenant Sync mutation recovery required',
    ]);
    expect(binding.receipts.size).toBe(1);
    expect(binding.rows.has('committed')).toBe(true);
    db.dispose();
  });

  test('delivers an interleaved durable prefix through the origin change before ack', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;
    binding.externalWithoutWakeup('other', { id: 'other', title: 'Other socket' });

    await route(ws.value, db, tenant, {
      type: 'sync.mutate', ref: 'origin', table: 'todos', op: 'INSERT',
      row: { id: 'mine', title: 'Mine' },
    });

    expect(ws.messages.map((message) => (
      message.type === 'sync.change'
        ? `${message.type}:${message.seq}:${message.rowId}`
        : message.type === 'sync.ack'
          ? `${message.type}:${message.seq}:${message.ref}`
          : message.type
    ))).toEqual([
      'sync.change:1:other',
      'sync.change:2:mine',
      'sync.ack:2:origin',
    ]);
    const originChange = ws.messages[1];
    expect(originChange.type === 'sync.change' && originChange.origin)
      .toBe('connection-1');
    expect(tenant.diagnostics()).toMatchObject({
      actorCursor: 2,
      lastDeliveredWireSeq: 2,
    });
    tenant.dispose();
    db.dispose();
  });

  test('fails closed when a logical receipt returns a different row intent', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    const ws = socket();
    const tenant = bridge(ws.value, binding);
    await tenant.subscribe({
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'], lastSeq: 0,
    });
    ws.messages.length = 0;
    const message = {
      type: 'sync.mutate', ref: 'receipt-intent', table: 'todos', op: 'UPDATE',
      rowId: 'expected', row: { title: 'Update' },
    } as const;
    const key = createTenantSyncIdempotencyKey(auth, message.ref);
    binding.receipts.set(key, {
      fingerprint: createTenantSyncLogicalReceiptFingerprint(message),
      result: {
        value: {
          kind: 'batch',
          mutations: [{
            type: 'update', table: 'todos', rowId: 'different', changed: true,
            op: 'UPDATE', sequence: { seq: 1 },
            row: { id: 'different', title: 'Secret' },
            previousRow: { id: 'different', title: 'Before' },
          }],
        },
        sequence: { seq: 1 },
        idempotencyKey: key,
        replayed: false,
      },
    });

    await route(ws.value, db, tenant, message);

    expect(ws.messages).toEqual([]);
    expect(ws.closes.at(-1)).toEqual([
      1012, 'Tenant Sync mutation recovery required',
    ]);
    db.dispose();
  });

  test('rejects a client mutation plane that disagrees with server table routing', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const binding = new FakeTenantBinding();
    const ws = socket();
    const tenant = bridge(ws.value, binding);

    await route(ws.value, db, tenant, {
      type: 'sync.mutate', plane: 'default', ref: 'spoof',
      table: 'todos', op: 'DELETE', rowId: 't1',
    });

    expect(ws.closes.at(-1)).toEqual([
      1008, 'Sync mutation plane does not match its table',
    ]);
    tenant.dispose();
    db.dispose();
  });

  test('keeps receipt identity stable across session rotation and isolates principals/bodies', () => {
    const rotated = {
      ...auth,
      sessionId: 'session-2',
      sessionGeneration: 9,
      tenantAuthorizationGeneration: 4,
    };
    expect(createTenantSyncIdempotencyKey(auth, 'ref'))
      .toBe(createTenantSyncIdempotencyKey(rotated, 'ref'));
    expect(createTenantSyncIdempotencyKey(auth, 'ref'))
      .not.toBe(createTenantSyncIdempotencyKey({
        ...rotated,
        membershipId: 'membership-2',
      }, 'ref'));
    expect(createTenantSyncLogicalReceiptFingerprint({
      table: 'todos', op: 'UPDATE', rowId: 't1', row: { title: 'A' },
    })).toBe(createTenantSyncLogicalReceiptFingerprint({
      row: { title: 'A' }, rowId: 't1', op: 'UPDATE', table: 'todos',
    }));
    expect(createTenantSyncLogicalReceiptFingerprint({
      table: 'todos', op: 'UPDATE', rowId: 't1', row: { title: 'A' },
    })).not.toBe(createTenantSyncLogicalReceiptFingerprint({
      table: 'todos', op: 'UPDATE', rowId: 't1', row: { title: 'B' },
    }));
  });
});
