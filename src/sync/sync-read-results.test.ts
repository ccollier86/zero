/** Actual native snapshot/store contracts with synthetic opaque receipt providers; managed browser tests cover real private logging. */
import { expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { createReactiveDB } from './reactive-db';
import { handleSyncSubscribe } from './sync-subscribe-handler';
import { deliverSyncChange } from './sync-change-delivery';
import { syncReadDeliveryTail, prepareSyncCatchupResults } from './sync-read-results';
import { SyncSnapshotAssembler } from './client/sync-snapshot-assembler';
import { createSyncStore, routeServerMessage, type SyncStoreContext } from './client/sync-store';
import { registerSyncReadResults } from './client/sync-read-results';
import { selectLoggingResultRows, emptyLoggingResult } from '../frontend/client/logging-result-provenance';
import type { Row, ServerMessage, SyncSocketData, SyncSnapshotChunkMessage } from './types';
const receipt = (table: string, count: number, id = crypto.randomUUID()) => ({ id, digest: 'a'.repeat(64), kind: 'list' as const, table, count, expiresAt: Date.now() + 300000 });
function fixture() {
  const db = createReactiveDB({ mode: 'memory' }); db.defineTable('records', { id: 'text primary key', state: 'text' });
  const messages: ServerMessage[] = [], closes: number[] = [];
  const data = { allowedTables: new Set(['records']), syncSubscribedTables: new Set(['records']), rowFilteredSubscribedTables: new Set(), subscribedTopics: new Set(),
    resourceRowFilters: new Map(), resourceRowProjectors: new Map(), lastSeq: 0, authorizationScope: 'synthetic-scope', syncBackpressured: false } as unknown as SyncSocketData;
  const socket = { data, send: (value: string) => { messages.push(JSON.parse(value)); return value.length; }, close: (code: number) => closes.push(code), subscribe() {}, unsubscribe() {} } as unknown as ServerWebSocket<SyncSocketData>;
  return { db, messages, closes, socket };
}
test('audited native snapshots keep stable copied rows across evidence awaits, and only committed objects retain provenance', async () => {
  const f = fixture();
  try {
    f.db.insert('records', { id: 'one', state: 'before' }); f.db.insert('records', { id: 'two', state: 'other' });
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const preparations: { rows: readonly Row[]; seq: number }[] = [];
    f.socket.data.prepareReadResult = async (table, rows, seq) => { preparations.push({ rows: structuredClone(rows), seq }); if (preparations.length === 1) { entered(); await held; } return receipt(table, rows.length); };
    const pending = handleSyncSubscribe(f.socket, { type: 'sync.subscribe', tables: ['records'], snapshot: ['records'], lastSeq: 0, epoch: 'old', scope: 'synthetic-scope' }, f.db);
    await started;
    // The application writer is free while the independent evidence provider waits.
    const change = f.db.update('records', 'one', { state: 'after' })!;
    deliverSyncChange([f.socket], change, f.db.syncEpoch, 'different');
    release(); await pending;
    const chunk = f.messages.find(message => message.type === 'sync.snapshot.chunk') as SyncSnapshotChunkMessage;
    expect(chunk.rows.one!.state).toBe('before'); expect(preparations[0]!.rows[0]!.state).toBe('before');
    expect(f.messages.map(message => message.type)).toEqual(['sync.snapshot.begin', 'sync.snapshot.chunk', 'sync.snapshot.end', 'sync.change']);
    const assembler = new SyncSnapshotAssembler({ records: { _pk: 'id' } }, { records: 'default' }), store = createSyncStore({ records: { _pk: 'id' } }).store;
    for (const message of f.messages) {
      if (['sync.snapshot.begin', 'sync.snapshot.chunk', 'sync.snapshot.end'].includes(message.type)) {
        const result = assembler.accept(message as Parameters<SyncSnapshotAssembler['accept']>[0]);
        if (result.status === 'complete') routeServerMessage(store, result.message);
      } else { expect(registerSyncReadResults(message)).toBe(true); routeServerMessage(store, message); }
    }
    const context = store.getSnapshot().context as SyncStoreContext, rows = context.records as Record<string, Row>;
    expect(selectLoggingResultRows([rows.two!, rows.one!])?.sources.map(source => source.positions)).toEqual([[1], [0]]);
    store.send({ type: 'optimistic.update', table: 'records', rowId: 'one', partial: { state: 'unconfirmed' }, ref: 'local' });
    expect(selectLoggingResultRows([(store.getSnapshot().context.records as Record<string, Row>).one!])).toBeNull();
  } finally { f.db.dispose(); }
});
test('empty authoritative tables retain an exact empty release, including receipt-aware chunk assembly', async () => {
  const f = fixture();
  try {
    f.socket.data.prepareReadResult = async (table, rows) => receipt(table, rows.length);
    await handleSyncSubscribe(f.socket, { type: 'sync.subscribe', tables: ['records'], snapshot: ['records'], lastSeq: 0, epoch: 'old', scope: 'synthetic-scope' }, f.db);
    const assembler = new SyncSnapshotAssembler({ records: { _pk: 'id' } }, { records: 'default' });
    for (const message of f.messages) {
      const result = assembler.accept(message as Parameters<SyncSnapshotAssembler['accept']>[0]);
      if (result.status === 'complete') expect(emptyLoggingResult(result.message.tables.records!)?.count).toBe(0);
      expect(result.status).not.toBe('invalid');
    }
    expect(f.messages.some(message => message.type === 'sync.snapshot.chunk' && message.auditReceipt?.count === 0)).toBe(true);
  } finally { f.db.dispose(); }
});
test('only definite pre-admission manifest-size rejection splits chunks; unknown outcomes never cause blind splitting', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 5; i++) f.db.insert('records', { id: 'row-' + i, state: 'draft' });
    f.socket.data.prepareReadResult = async (table, rows) => { if (rows.length > 2) throw { code: 'LOGGING_RESULT_LIMIT' }; return receipt(table, rows.length); };
    await handleSyncSubscribe(f.socket, { type: 'sync.subscribe', tables: ['records'], snapshot: ['records'], lastSeq: 0, epoch: 'old', scope: 'synthetic-scope' }, f.db);
    const chunks = f.messages.filter(message => message.type === 'sync.snapshot.chunk') as SyncSnapshotChunkMessage[];
    expect(chunks.flatMap(chunk => Object.keys(chunk.rows))).toHaveLength(5); expect(chunks.every(chunk => chunk.auditReceipt!.count <= 2)).toBe(true);
    f.messages.length = 0; let calls = 0;
    f.socket.data.prepareReadResult = async () => { calls++; throw { code: 'LOGGING_OUTCOME_UNKNOWN' }; };
    await expect(handleSyncSubscribe(f.socket, { type: 'sync.subscribe', tables: ['records'], snapshot: ['records'], lastSeq: 0, epoch: 'old', scope: 'synthetic-scope' }, f.db)).rejects.toMatchObject({ code: 'LOGGING_OUTCOME_UNKNOWN' });
    expect(calls).toBe(1); expect(f.messages.map(message => message.type)).toEqual(['sync.snapshot.begin']);
  } finally { f.db.dispose(); }
});
test('revocation during read-evidence preparation prevents row-bearing output; slow sockets have bounded independent work', async () => {
  const f = fixture();
  try {
    f.db.insert('records', { id: 'one', state: 'draft' }); let current = true;
    f.socket.data.prepareReadResult = async (table, rows) => { current = false; return receipt(table, rows.length); };
    await expect(handleSyncSubscribe(f.socket, { type: 'sync.subscribe', tables: ['records'], snapshot: ['records'], lastSeq: 0, epoch: 'old', scope: 'synthetic-scope' }, f.db, undefined, undefined, () => { if (!current) throw new Error('Synthetic authority revoked'); })).rejects.toThrow('Synthetic authority revoked');
    expect(f.messages.every(message => message.type === 'sync.snapshot.begin')).toBe(true);
    current = true; f.socket.data.syncSubscribedTables.add('records');
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    f.socket.data.prepareReadResult = async (table, rows) => { await held; return receipt(table, rows.length); };
    for (let i = 0; i < 258; i++) deliverSyncChange([f.socket], { seq: i + 1, table: 'records', op: 'UPDATE', rowId: 'one', row: { id: 'one', state: 'draft' }, ts: 1000 }, 'epoch', 'other');
    expect(f.closes).toEqual([1013]); release(); await syncReadDeliveryTail(f.socket);
    expect(f.messages.every(message => message.type === 'sync.snapshot.begin')).toBe(true);
  } finally { f.db.dispose(); }
});
test('catch-up provenance binds only its final canonical rows and rejects malformed membership', async () => {
  const f = fixture();
  try {
    f.socket.data.prepareReadResult = async (table, rows) => receipt(table, rows.length);
    const changes = [{ seq: 1, table: 'records', op: 'INSERT' as const, rowId: 'one', row: { id: 'one', state: 'old' }, origin: '', ts: 1 },
      { seq: 2, table: 'records', op: 'UPDATE' as const, rowId: 'one', row: { id: 'one', state: 'new' }, origin: '', ts: 2 }];
    const auditResults = await prepareSyncCatchupResults(f.socket, changes, 2, 'epoch');
    expect(registerSyncReadResults({ type: 'sync.catchup', changes, seq: 2, auditResults })).toBe(true);
    expect(selectLoggingResultRows([changes[0]!.row])).toBeNull();
    expect(selectLoggingResultRows([changes[1]!.row])?.sources[0]!.positions).toEqual([0]);
    expect(registerSyncReadResults({ type: 'sync.catchup', changes, seq: 2, auditResults: [{ ...auditResults![0]!, rowIds: ['nonexistent'] }] })).toBe(false);
  } finally { f.db.dispose(); }
});
test('audited snapshot deferrals enforce a byte budget as well as an operation budget', () => {
  const f = fixture();
  try {
    f.socket.data.syncSnapshotInFlight = true;
    f.socket.data.prepareReadResult = async (table, rows) => receipt(table, rows.length);
    const payload = 'x'.repeat(1024 * 1024);
    for (let seq = 1; seq < 5; seq++) deliverSyncChange([f.socket], { seq, table: 'records', op: 'UPDATE', rowId: 'one', row: { id: 'one', payload }, ts: 1 }, 'epoch', 'other');
    expect(f.closes).toEqual([1013]);
    expect(f.socket.data.syncDeferredChanges).toEqual([]);
    expect(f.socket.data.syncDeferredChangeBytes).toBe(0);
  } finally { f.db.dispose(); }
});
