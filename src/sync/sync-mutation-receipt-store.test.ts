import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeMessage } from './message-handler';
import { createReactiveDB } from './reactive-db';
import {
  hashSyncMutation,
  SyncMutationReceiptStore,
} from './sync-mutation-receipt-store';
import { pruneMutationReceipts } from './sync-mutation-receipt-prune';
import type {
  ServerMessage,
  SyncMutateMessage,
  SyncSocketData,
} from './types';

function socket() {
  const messages: ServerMessage[] = [];
  const data: SyncSocketData = {
    allowedTables: new Set(['todos']), subscribedTopics: new Set(), lastSeq: 0,
    syncSubscribedTables: new Set(), syncBackpressured: false,
    authContext: { userId: 'u1', email: 'u@example.com', role: 'user' },
    authResolved: true, authorizationFingerprint: 'policy',
    authorizationScope: 'scope', connectionId: 'conn', query: {},
    stateSubscribed: false, ephemeralTopics: new Set(),
    resourceRowFilters: new Map(), rowFilteredSubscribedTables: new Set(),
  };
  const value = {
    data,
    send(payload: string) { messages.push(JSON.parse(payload)); return payload.length; },
    close() {}, subscribe() {}, unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, messages };
}

async function mutate(
  ws: ReturnType<typeof socket>,
  db: ReturnType<typeof createReactiveDB>,
  receipts: SyncMutationReceiptStore,
  message: SyncMutateMessage,
) {
  await routeMessage(
    ws.value, message as unknown as Record<string, unknown>, db,
    { publish() {} }, null, null, undefined, undefined, undefined, receipts,
  );
}

describe('Sync mutation receipts', () => {
  test('protects recent uncertainty while bounding old receipts', () => {
    const db = createReactiveDB({ mode: 'memory' });
    new SyncMutationReceiptStore(db);
    const old = Date.now() - 2 * 60 * 60 * 1_000;
    db.exec(`WITH RECURSIVE n(x) AS (
      VALUES(1) UNION ALL SELECT x + 1 FROM n WHERE x < 2601
    ) INSERT INTO _sync_mutation_receipts
      SELECT 'attacker', 'r-' || x, 'h-' || x, '{}', ${old} FROM n`);
    db.prepare(`INSERT INTO _sync_mutation_receipts
      VALUES (?, ?, ?, ?, ?)`).run('victim', 'recent', 'hash', '{}', Date.now());
    pruneMutationReceipts(db, 'attacker', false);
    const attackerCount = db.prepare(`SELECT COUNT(*) AS count
      FROM _sync_mutation_receipts WHERE principal = 'attacker'`)
      .get() as { count: number };
    expect(attackerCount.count).toBe(2_500);
    expect(db.prepare(`SELECT 1 AS present FROM _sync_mutation_receipts
      WHERE principal = 'victim'`).get()).toEqual({ present: 1 });

    db.exec('DELETE FROM _sync_mutation_receipts');
    db.exec(`WITH RECURSIVE n(x) AS (
      VALUES(1) UNION ALL SELECT x + 1 FROM n WHERE x < 25050
    ) INSERT INTO _sync_mutation_receipts
      SELECT 'p-' || x, 'r', 'h', '{}', ${old} FROM n`);
    db.prepare(`INSERT INTO _sync_mutation_receipts
      VALUES (?, ?, ?, ?, ?)`).run('victim', 'recent', 'hash', '{}', Date.now());
    pruneMutationReceipts(db, 'victim', true);
    const total = db.prepare('SELECT COUNT(*) AS count FROM _sync_mutation_receipts')
      .get() as { count: number };
    expect(total.count).toBe(25_000);
    expect(db.prepare(`SELECT 1 AS present FROM _sync_mutation_receipts
      WHERE principal = 'victim'`).get()).toEqual({ present: 1 });
    db.dispose();
  });

  test('commits the data and receipt atomically', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', { id: 'text primary key', title: 'text' });
    const receipts = new SyncMutationReceiptStore(db);
    const message: SyncMutateMessage = {
      type: 'sync.mutate', ref: 'atomic', table: 'todos', op: 'INSERT',
      row: { id: '1', title: 'Never committed' },
    };
    expect(() => db.transaction(() => {
      const change = db.insert('todos', message.row!);
      receipts.save('user:u1', message.ref, hashSyncMutation(message), {
        type: 'sync.ack', ref: message.ref, seq: change.seq, ok: true,
        change: {
          table: change.table, op: change.op, rowId: change.rowId, row: change.row,
        },
      });
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(db.get('todos', '1')).toBeNull();
    expect(receipts.find('user:u1', message.ref, hashSyncMutation(message))).toEqual({
      status: 'miss',
    });
    db.dispose();
  });

  test('replays once across restart and rejects unknown or conflicting retries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-sync-receipt-'));
    const path = join(directory, 'app.db');
    const firstDb = createReactiveDB({ mode: path });
    firstDb.defineTable('todos', { id: 'text primary key', title: 'text' });
    const firstReceipts = new SyncMutationReceiptStore(firstDb);
    const firstSocket = socket();
    const message: SyncMutateMessage = {
      type: 'sync.mutate', ref: 'durable-ref', table: 'todos', op: 'INSERT',
      row: { id: '1', title: 'Exactly once' }, epoch: firstDb.syncEpoch, attempt: 1,
    };
    await mutate(firstSocket, firstDb, firstReceipts, message);
    expect(firstDb.currentSeq).toBe(1);
    expect(firstSocket.messages.at(-1)).toMatchObject({ ok: true, ref: 'durable-ref' });
    const stored = firstDb.prepare(
      'SELECT ack_json FROM _sync_mutation_receipts WHERE ref = ?',
    ).get('durable-ref') as { ack_json: string };
    expect(JSON.parse(stored.ack_json)).toEqual({
      table: 'todos', op: 'INSERT', rowId: '1',
    });
    const indexes = firstDb.prepare(
      'PRAGMA index_list(_sync_mutation_receipts)',
    ).all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      '_sync_receipts_created_at', '_sync_receipts_principal_created',
    ]));
    const oldEpoch = firstDb.syncEpoch;
    firstDb.dispose();

    const secondDb = createReactiveDB({ mode: path });
    secondDb.defineTable('todos', { id: 'text primary key', title: 'text' });
    const secondReceipts = new SyncMutationReceiptStore(secondDb);
    const secondSocket = socket();
    await mutate(secondSocket, secondDb, secondReceipts, {
      ...message, epoch: oldEpoch, attempt: 2,
    });
    expect(secondDb.currentSeq).toBe(1);
    expect(secondDb.get('todos', '1')).toEqual({ id: '1', title: 'Exactly once' });
    expect(secondSocket.messages.at(-1)).toMatchObject({
      ok: true, ref: 'durable-ref', seq: 1,
      change: { table: 'todos', rowId: '1', row: { title: 'Exactly once' } },
    });

    await mutate(secondSocket, secondDb, secondReceipts, {
      ...message, row: { id: '2', title: 'Conflict' }, attempt: 2,
    });
    expect(secondSocket.messages.at(-1)).toMatchObject({
      ok: false, error: 'Mutation reference conflict',
    });
    secondDb.prepare(
      'DELETE FROM _sync_mutation_receipts WHERE principal = ? AND ref = ?',
    ).run('user:u1:scope:scope', 'durable-ref');
    await mutate(secondSocket, secondDb, secondReceipts, {
      ...message, epoch: oldEpoch, attempt: 3,
    });
    expect(secondSocket.messages.at(-1)).toMatchObject({
      ok: false, error: 'Mutation outcome unavailable; retry as new work',
    });
    expect(secondDb.get('todos', '1')).toEqual({ id: '1', title: 'Exactly once' });
    await mutate(secondSocket, secondDb, secondReceipts, {
      ...message, ref: 'missing-ref', attempt: 2,
    });
    expect(secondSocket.messages.at(-1)).toMatchObject({
      ok: false, error: 'Mutation outcome unavailable; retry as new work',
    });
    expect(secondDb.currentSeq).toBe(1);
    secondDb.dispose();
    await rm(directory, { recursive: true, force: true });
  });
});
