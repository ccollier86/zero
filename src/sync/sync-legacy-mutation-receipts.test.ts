/** Imported user-wide proof never re-executes work or carries old row visibility. */
import { expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { createReactiveDB } from './reactive-db';
import { handleDefaultSyncMutation } from './sync-default-mutation-handler';
import { hashSyncMutation, SyncMutationReceiptStore } from './sync-mutation-receipt-store';
import type { ServerMessage, SyncMutateMessage, SyncSocketData } from './types';

test('only explicitly bound legacy receipts replay, with current user, projection and final read authority', async () => {
  const db = createReactiveDB({ mode: 'memory' });
  db.defineTable('notes', { id: 'text primary key', text: 'text', secret: 'text' });
  const message: SyncMutateMessage = { type: 'sync.mutate', table: 'notes', op: 'UPDATE', ref: 'old-ref', rowId: 'note', row: { text: 'Original already committed' }, epoch: 'old-stream', attempt: 2 };
  db.insert('notes', { id: 'note', text: 'New current value', secret: 'private' });
  const unmarked = new SyncMutationReceiptStore(db);
  db.prepare('INSERT INTO _sync_mutation_receipts VALUES (?,?,?,?,?)').run('user:owner', message.ref, hashSyncMutation(message), JSON.stringify({ table: 'notes', op: 'UPDATE', rowId: 'note' }), Date.now());
  expect(unmarked.findLegacyUser('owner', message.ref, hashSyncMutation(message))).toEqual({ status: 'miss' });
  db.exec(`CREATE TABLE _sync_legacy_mutation_receipt_bindings (
    principal TEXT NOT NULL, ref TEXT NOT NULL, request_hash TEXT NOT NULL, source_sha256 TEXT NOT NULL,
    PRIMARY KEY(principal,ref), FOREIGN KEY(principal,ref) REFERENCES _sync_mutation_receipts(principal,ref) ON DELETE CASCADE
  )`);
  db.prepare('INSERT INTO _sync_legacy_mutation_receipt_bindings VALUES (?,?,?,?)').run('user:owner', message.ref, hashSyncMutation(message), 'a'.repeat(64));
  const receipts = new SyncMutationReceiptStore(db), messages: ServerMessage[] = [];
  const socket = { data: {
    authContext: { userId: 'owner', email: 'owner@example.test', role: 'user' }, authorizationScope: 'new-scope',
    allowedTables: new Set(['notes']), resourceRowFilters: new Map(),
    resourceRowProjectors: new Map([['notes', { project: (row: Record<string, unknown>) => ({ id: row.id, text: row.text }) }]]),
  }, send(value: string) { messages.push(JSON.parse(value)); return value.length; }, close() {} } as unknown as ServerWebSocket<SyncSocketData>;
  const sequence = db.currentSeq;
  const run = (request = message, assertCurrentReadAuthority?: () => void) => handleDefaultSyncMutation(socket, request, { db, receipts, policy: { canMutateTable: () => false }, assertCurrentReadAuthority });
  try {
    await run();
    expect(messages.at(-1)).toMatchObject({ ok: true, change: { row: { id: 'note', text: 'New current value' }, op: 'UPDATE' } });
    expect(JSON.stringify(messages.at(-1))).not.toContain('private');
    expect(db.currentSeq).toBe(sequence);
    await run({ ...message, row: { text: 'Different request' } });
    expect(messages.at(-1)).toMatchObject({ ok: false, error: 'Mutation reference conflict' });
    socket.data.authContext = { ...socket.data.authContext!, userId: 'another-user' };
    await run();
    expect(messages.at(-1)).toMatchObject({ ok: false, error: 'Mutation outcome unavailable; retry as new work' });
    socket.data.authContext = null;
    await run();
    expect(messages.at(-1)).toMatchObject({ ok: false, error: 'Mutation outcome unavailable; retry as new work' });
    socket.data.authContext = { userId: 'owner', email: 'owner@example.test', role: 'user' };
    socket.data.allowedTables.clear();
    await run();
    expect(messages.at(-1)).toMatchObject({ ok: true, change: { op: 'DELETE', row: null } });
    socket.data.allowedTables.add('notes');
    const before = messages.length;
    await run(message, () => { throw Object.assign(new Error('Revoked'), { code: 'DATABASE_AUTHORITY_CHANGED' }); });
    expect(messages).toHaveLength(before);
    db.prepare('UPDATE _sync_legacy_mutation_receipt_bindings SET request_hash=?').run('wrong-binding');
    await run();
    expect(messages.at(-1)).toMatchObject({ ok: false, error: 'Mutation reference conflict' });
    db.prepare('UPDATE _sync_legacy_mutation_receipt_bindings SET request_hash=?').run(hashSyncMutation(message));
    db.prepare('UPDATE _sync_mutation_receipts SET ack_json=?').run('{"unexpected":"malformed"}');
    await run();
    expect(messages.at(-1)).toMatchObject({ ok: false, error: 'Mutation reference conflict' });
    expect(db.currentSeq).toBe(sequence);
    expect(db.get('notes', 'note')).toMatchObject({ text: 'New current value' });
  } finally { db.dispose(); }
});
