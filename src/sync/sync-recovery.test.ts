import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReactiveDB } from './reactive-db';
import { deliverSyncChange } from './sync-change-delivery';
import { handleSyncSubscribe } from './sync-subscribe-handler';
import { clearSyncBackpressure } from './sync-wire-send';
import type { ServerMessage, SyncSocketData } from './types';

function socket(scope = 'scope-a', sendStatuses: number[] = []) {
  const messages: ServerMessage[] = [];
  const closes: Array<[number | undefined, string | undefined]> = [];
  const data: SyncSocketData = {
    allowedTables: new Set(['todos', 'logs']), subscribedTopics: new Set(),
    lastSeq: 0, syncSubscribedTables: new Set(), syncBackpressured: false,
    authContext: null, authResolved: true, authorizationFingerprint: 'policy',
    authorizationScope: scope, connectionId: 'conn', query: {},
    stateSubscribed: false, ephemeralTopics: new Set(), resourceRowFilters: new Map(),
    rowFilteredSubscribedTables: new Set(),
  };
  const value = {
    data,
    send(payload: string) {
      messages.push(JSON.parse(payload));
      return sendStatuses.shift() ?? payload.length;
    },
    close(code?: number, reason?: string) { closes.push([code, reason]); },
    subscribe() {}, unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, messages, closes };
}

describe('Sync recovery protocol', () => {
  test('foreign server epoch forces an authoritative replacement at equal seq', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', { id: 'text primary key', title: 'text' });
    db.insert('todos', { id: 'fresh', title: 'Canonical' });
    const ws = socket();

    await handleSyncSubscribe(ws.value, {
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'],
      lastSeq: 1, epoch: 'previous-process', scope: 'scope-a',
    }, db);

    expect(ws.messages).toHaveLength(1);
    const message = ws.messages[0];
    expect(message.type).toBe('sync.snapshot');
    if (message.type === 'sync.snapshot') {
      expect(message.reset).toBe('preserve-pending');
      expect(message.epoch).toBe(db.syncEpoch);
      expect(message.tables.todos).toEqual({ fresh: { id: 'fresh', title: 'Canonical' } });
    }
    db.dispose();
  });

  test('changed authorization scope forces a purging replacement', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', { id: 'text primary key' });
    const ws = socket('new-scope');

    await handleSyncSubscribe(ws.value, {
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'],
      lastSeq: 0, epoch: db.syncEpoch, scope: 'old-scope',
    }, db);

    const message = ws.messages[0];
    expect(message.type === 'sync.snapshot' && message.reset).toBe('purge');
    db.dispose();
  });

  test('snapshot never advances its cursor past rows from the same SQLite view', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-sync-snapshot-cursor-'));
    const path = join(directory, 'app.sqlite');
    const writer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const reader = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const schema = { id: 'text primary key', title: 'text' };
    writer.defineTable('todos', schema);
    reader.defineTable('todos', schema);
    writer.insert('todos', { id: 'item', title: 'Before' });
    const ws = socket();
    const query = reader.query.bind(reader);
    let interleaved = false;
    reader.query = ((table: string) => {
      const rows = query(table);
      if (!interleaved) {
        interleaved = true;
        writer.update('todos', 'item', { title: 'After' });
      }
      return rows;
    }) as typeof reader.query;

    try {
      await handleSyncSubscribe(ws.value, {
        type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'],
        lastSeq: 0, epoch: 'force-snapshot', scope: 'scope-a',
      }, reader);

      const message = ws.messages[0];
      expect(message.type).toBe('sync.snapshot');
      if (message.type === 'sync.snapshot') {
        expect(message.tables.todos.item?.title).toBe('Before');
        expect(message.seq).toBe(1);
      }
      expect(ws.data.lastSeq).toBe(1);
      expect(reader.currentSeq).toBe(2);
    } finally {
      reader.dispose();
      writer.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('catch-up never advances past changes read from the same SQLite view', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-sync-catchup-cursor-'));
    const path = join(directory, 'app.sqlite');
    const writer = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const reader = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const schema = { id: 'text primary key', title: 'text' };
    writer.defineTable('todos', schema);
    reader.defineTable('todos', schema);
    writer.insert('todos', { id: 'first', title: 'First' });
    const ws = socket();
    const getChangesAfter = reader.getChangesAfter.bind(reader);
    let interleaved = false;
    reader.getChangesAfter = ((seq: number) => {
      const changes = getChangesAfter(seq);
      if (!interleaved) {
        interleaved = true;
        writer.insert('todos', { id: 'second', title: 'Second' });
      }
      return changes;
    }) as typeof reader.getChangesAfter;

    try {
      await handleSyncSubscribe(ws.value, {
        type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'],
        lastSeq: 0, epoch: reader.syncEpoch, scope: 'scope-a',
      }, reader);

      const message = ws.messages[0];
      expect(message.type).toBe('sync.catchup');
      if (message.type === 'sync.catchup') {
        expect(message.changes.map((change) => change.rowId)).toEqual(['first']);
        expect(message.seq).toBe(1);
      }
      expect(ws.data.lastSeq).toBe(1);
      expect(reader.currentSeq).toBe(2);
    } finally {
      reader.dispose();
      writer.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('live predecessor cursor ignores unrelated tables without hiding loss', () => {
    const ws = socket();
    ws.data.syncSubscribedTables.add('todos');
    ws.data.lastSeq = 4;
    deliverSyncChange([ws.value], {
      seq: 4, table: 'todos', op: 'UPDATE', rowId: 'already-snapshotted',
      row: { id: 'already-snapshotted' }, ts: 0,
    }, 'epoch', '');
    deliverSyncChange([ws.value], {
      seq: 5, table: 'logs', op: 'INSERT', rowId: 'l1', row: { id: 'l1' }, ts: 1,
    }, 'epoch', '');
    deliverSyncChange([ws.value], {
      seq: 8, table: 'todos', op: 'UPDATE', rowId: 't1', row: { id: 't1' }, ts: 2,
    }, 'epoch', '');

    expect(ws.messages).toHaveLength(1);
    const message = ws.messages[0];
    expect(message.type === 'sync.change' && message.prevSeq).toBe(4);
    expect(message.type === 'sync.change' && message.seq).toBe(8);
    expect(ws.data.lastSeq).toBe(8);
  });

  test('checks durable authority immediately before an outgoing live change', () => {
    const ws = socket();
    ws.data.syncSubscribedTables.add('todos');
    let checked = 0;
    deliverSyncChange([ws.value], {
      seq: 1,
      table: 'todos',
      op: 'INSERT',
      rowId: 'blocked',
      row: { id: 'blocked' },
      ts: 1,
    }, 'epoch', '', () => {
      checked += 1;
      return false;
    });

    expect(checked).toBe(1);
    expect(ws.messages).toEqual([]);
    expect(ws.data.lastSeq).toBe(0);
  });

  test('defers live changes until a backpressured snapshot drains atomically', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', { id: 'text primary key', title: 'text' });
    db.insert('todos', { id: 'item', title: 'Snapshot' });
    const ws = socket('scope-a', [-1, 100]);

    const pending = handleSyncSubscribe(ws.value, {
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'],
      lastSeq: 0, epoch: 'force-snapshot', scope: 'scope-a',
    }, db);
    await Promise.resolve();
    await Promise.resolve();
    expect(ws.messages.map((message) => message.type)).toEqual(['sync.snapshot']);

    deliverSyncChange([ws.value], {
      seq: 2,
      table: 'todos',
      op: 'UPDATE',
      rowId: 'item',
      row: { id: 'item', title: 'After' },
      previousRow: { id: 'item', title: 'Snapshot' },
      ts: 2,
    }, db.syncEpoch, 'other-connection');
    expect(ws.messages.map((message) => message.type)).toEqual(['sync.snapshot']);

    clearSyncBackpressure(ws.value);
    await pending;
    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot', 'sync.change',
    ]);
    expect(ws.messages[1]).toMatchObject({
      type: 'sync.change', seq: 2, prevSeq: 1, rowId: 'item',
    });
    expect(ws.data.lastSeq).toBe(2);
    db.dispose();
  });

  test('does not flush a deferred change after read authority changes during drain', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', { id: 'text primary key', title: 'text' });
    db.insert('todos', { id: 'item', title: 'Snapshot' });
    const ws = socket('scope-a', [-1]);
    let authorityCurrent = true;
    const assertAuthority = () => {
      if (!authorityCurrent) throw new Error('read authority changed');
    };

    const pending = handleSyncSubscribe(ws.value, {
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'],
      lastSeq: 0, epoch: 'force-snapshot', scope: 'scope-a',
    }, db, undefined, undefined, assertAuthority);
    await Promise.resolve();
    await Promise.resolve();

    deliverSyncChange([ws.value], {
      seq: 2,
      table: 'todos',
      op: 'UPDATE',
      rowId: 'item',
      row: { id: 'item', title: 'After' },
      previousRow: { id: 'item', title: 'Snapshot' },
      ts: 2,
    }, db.syncEpoch, 'other-connection');
    authorityCurrent = false;
    clearSyncBackpressure(ws.value);

    await expect(pending).rejects.toThrow('read authority changed');
    expect(ws.messages.map((message) => message.type)).toEqual(['sync.snapshot']);
    expect(ws.data.lastSeq).toBe(1);
    db.dispose();
  });

  test('does not send snapshot chunks after read authority changes during drain', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', { id: 'text primary key', title: 'text' });
    db.insert('todos', { id: 'one', title: 'x'.repeat(600_000) });
    db.insert('todos', { id: 'two', title: 'y'.repeat(600_000) });
    const ws = socket('scope-a', [-1]);
    let authorityCurrent = true;
    const assertAuthority = () => {
      if (!authorityCurrent) throw new Error('read authority changed');
    };

    const pending = handleSyncSubscribe(ws.value, {
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'],
      lastSeq: 0, epoch: 'force-snapshot', scope: 'scope-a',
    }, db, undefined, undefined, assertAuthority);
    await Promise.resolve();
    await Promise.resolve();
    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
    ]);

    authorityCurrent = false;
    clearSyncBackpressure(ws.value);
    await expect(pending).rejects.toThrow('read authority changed');
    expect(ws.messages.map((message) => message.type)).toEqual([
      'sync.snapshot.begin',
    ]);
    expect(ws.data.lastSeq).toBe(0);
    db.dispose();
  });
});
