/** Real coordinator FIFO/adapter and native MEMORY writer; only IPC is doubled. */
import { expect, test } from 'bun:test';
import { createPlatformSQLiteService } from '../persistence';
import { DatabaseRuntime } from './database-runtime';
import { DatabaseWriterOperationEngine } from './database-writer-engine';
import { defineDatabaseRealm, createDatabaseRealmOperationCatalog } from './database-realm';
import { DatabaseCoordinatorOperationRuntime } from './database-coordinator-operation-runtime';
import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import { DatabaseWriterLane } from './database-writer-lane';
import { DatabaseError } from './database-error';
import { createDatabaseRef, normalizeDatabaseId } from './database-file';
import { DATABASE_ACTOR_OPERATIONS } from './database-actor-protocol';
import type { DatabaseExecutor, DatabaseExecutorExecuteOptions, DatabaseExecutorRequest, DatabaseExecutorValue } from './database-executor';
import type { DatabaseObservability } from './database-observability';

function fixture() {
  const realm = defineDatabaseRealm({ name: 'synthetic-admission-runtime', version: '1', tables: { facts: { id: 'TEXT PRIMARY KEY' } } });
  const sqlite = createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false });
  let native: DatabaseRuntime | undefined, engine: DatabaseWriterOperationEngine | undefined;
  try {
    sqlite.raw.run('PRAGMA temp_store=MEMORY');
    native = DatabaseRuntime.open({ id: realm.name, role: 'named', sqlite, ownsSQLite: true, tables: realm.tables });
    engine = new DatabaseWriterOperationEngine({ runtime: native, realm });
    const requests: { request: DatabaseExecutorRequest; options?: DatabaseExecutorExecuteOptions }[] = [];
    let respond: () => unknown = () => engine!.inspectAdmission(), state: 'ready' | 'failed' | 'closed' = 'ready', retired = 0, queued = 0;
    const executor: DatabaseExecutor = {
      async start() {}, async settled() {}, async close() { state = 'closed'; }, async [Symbol.asyncDispose]() { await this.close(); },
      execute<Result extends DatabaseExecutorValue = DatabaseExecutorValue, Payload extends DatabaseExecutorValue = DatabaseExecutorValue>(request: DatabaseExecutorRequest<Payload>, options?: DatabaseExecutorExecuteOptions): Promise<Result> {
        requests.push({ request, ...(options ? { options } : {}) });
        expect(request.operation).toBe(DATABASE_ACTOR_OPERATIONS.inspectAdmission); expect(request.kind).toBe('read');
        return Promise.resolve().then(() => respond() as Result);
      },
      diagnostics() { return { state, slot: 0, generation: 1, inFlight: 0, maxInFlight: 1, disconnectObserved: false,
        exitObserved: state === 'closed', settled: state === 'closed', exitCode: null, signalCode: null, lastFailureCode: null }; },
    };
    const id = normalizeDatabaseId('synthetic-admission-runtime'), databaseRef = createDatabaseRef(id);
    const lane = () => new DatabaseWriterLane({ databaseRef, placement: 'file', maxQueued: 8, now: () => 1000,
      onQueued: () => { queued++; return true; }, onDequeued: () => { queued--; }, observability: null });
    const entry: DatabaseCoordinatorEntry = { id, databaseRef, filePath: '/synthetic-never-created/admission.sqlite', fileIdentity: { device: '1', inode: '2' },
      bindingIdentity: { databaseRef, instanceId: '00000000-0000-4000-8000-000000000001', realmName: realm.name }, placement: { mode: 'file' }, slot: 0,
      lane: lane(), readerLane: lane(), state: 'ready', writer: executor, reader: null, opening: Promise.resolve(), recovery: null,
      settlement: null, closeTask: null, failure: null, closeFailure: null, restartRetryCount: 0, restartAbortController: null,
      leases: 1, activeOperations: 0, recoveryWaiters: 0, lastUsedAt: 0, syncIdentity: null, tenantSyncBindingSlots: 0, syncBindings: new Set() };
    const events: Parameters<DatabaseObservability['emit']>[0][] = [];
    const adapter = new DatabaseCoordinatorOperationRuntime({ operationCatalog: createDatabaseRealmOperationCatalog(realm), queueTimeoutMs: 5000,
      operationTimeoutMs: 15000, maxQueuedPerDatabase: 8, maxQueuedTotal: 8, now: () => 1000,
      authorityCommitCoordinator: null, requireCommitAuthority: false, captureAuthorityRevision: null,
      assertStarted() {}, canAwaitOpening: () => false, assertUsableEntry(value) { if (value.state !== 'ready') throw new DatabaseError('DATABASE_NOT_READY', 'Synthetic entry unavailable.'); },
      requireWriter(value) { if (!value.writer) throw new DatabaseError('DATABASE_NOT_READY', 'Synthetic writer unavailable.'); return value.writer; },
      isTerminalFailure: (_writer, error) => error.code === 'DATABASE_PROTOCOL_ERROR' || state === 'failed',
      async retire() { retired++; }, publishCommit() { throw new Error('Inspection cannot publish a commit.'); },
      holdAuthorityUntilSettlement() { throw new Error('Inspection cannot acquire write authority.'); },
      queuedOperations: () => queued, incrementQueuedOperations() { queued++; }, decrementQueuedOperations() { queued--; },
      cleanupFailedEntryIfUnused() {}, emit(event) { events.push(event); },
    });
    return { engine, native, entry, adapter, requests, events, retired: () => retired, queued: () => queued,
      response(value: () => unknown) { respond = value; }, fail() { state = 'failed'; },
      async close() { await Promise.all([entry.lane.idle(), entry.readerLane.idle()]); try { await executor.close(); engine!.close(); } finally { native!.close(); } } };
  } catch (error) { try { engine?.close(); } finally { if (native) native.close(); else sqlite.close(); } throw error; }
}

test('actual aggregate inspection adapter uses the writer FIFO and supported native executor timeout options', async () => {
  const f = fixture(); let release!: () => void;
  const blocker = f.entry.lane.enqueue(() => new Promise<void>(resolve => { release = resolve; }), { operationClass: 'mutation', timeoutMs: 1000 });
  try {
    await Promise.resolve(); const before = f.engine.receiptRetentionCounts();
    const pending = f.adapter.inspectWriterAdmission(f.entry, { operationTimeoutMs: 1234 });
    expect(f.entry.lane.depth).toBe(2); expect(f.requests).toHaveLength(0);
    release(); await blocker;
    expect(await pending).toEqual(f.engine.inspectAdmission());
    expect(f.requests).toHaveLength(1); expect(f.requests[0]!.options).toEqual({ timeoutMs: 1234 });
    expect(f.requests[0]!.request.payload).toEqual({ databaseRef: f.entry.databaseRef });
    expect(f.entry.activeOperations).toBe(0); expect(f.queued()).toBe(0); expect(f.engine.receiptRetentionCounts()).toEqual(before);
  } finally { release?.(); await blocker; await f.close(); }
});

test('inspection queued cancellation never dispatches or spends a receipt identity and releases its FIFO accounting', async () => {
  const f = fixture(); let release!: () => void; const cancel = new AbortController();
  const blocker = f.entry.lane.enqueue(() => new Promise<void>(resolve => { release = resolve; }), { operationClass: 'mutation', timeoutMs: 1000 });
  try {
    await Promise.resolve(); const pending = f.adapter.inspectWriterAdmission(f.entry, { signal: cancel.signal }); cancel.abort();
    await expect(pending).rejects.toMatchObject({ code: 'DATABASE_QUEUE_TIMEOUT', outcome: 'not-started' });
    expect(f.requests).toHaveLength(0); expect(f.entry.activeOperations).toBe(0); expect(f.queued()).toBe(0);
    expect(f.engine.receiptRetentionCounts().totalKeys).toBe(0);
  } finally { release?.(); await blocker; await f.close(); }
});

test('malformed actor aggregate is a protocol failure with real terminal retirement, not a missing error-handler exception', async () => {
  const f = fixture();
  try {
    const before = f.engine.receiptRetentionCounts(); f.response(() => ({ ...f.engine.inspectAdmission(), receipts: { totalKeys: 999 } }));
    await expect(f.adapter.inspectWriterAdmission(f.entry)).rejects.toMatchObject({ code: 'DATABASE_PROTOCOL_ERROR', outcome: 'unknown' });
    expect(f.retired()).toBe(1); expect(f.entry.activeOperations).toBe(0);
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'operation-outcome-unknown', operation: 'query', role: 'writer' }));
    expect(f.engine.receiptRetentionCounts()).toEqual(before);
  } finally { await f.close(); }
});

test('failed executor inspection preserves the native error and invokes terminal retirement', async () => {
  const f = fixture();
  try {
    f.fail(); f.response(() => { throw new DatabaseError('DATABASE_EXECUTOR_FAILED', 'Synthetic executor unavailable.', { outcome: 'not-started' }); });
    await expect(f.adapter.inspectWriterAdmission(f.entry)).rejects.toMatchObject({ code: 'DATABASE_EXECUTOR_FAILED' });
    expect(f.retired()).toBe(1); expect(f.entry.activeOperations).toBe(0);
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'operation-failed', operation: 'query' }));
  } finally { await f.close(); }
});
