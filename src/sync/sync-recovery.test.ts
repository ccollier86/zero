import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { createReactiveDB } from './reactive-db';
import { deliverSyncChange } from './sync-change-delivery';
import { handleSyncSubscribe } from './sync-subscribe-handler';
import type { ServerMessage, SyncSocketData } from './types';

function socket(scope = 'scope-a') {
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
    send(payload: string) { messages.push(JSON.parse(payload)); return payload.length; },
    close(code?: number, reason?: string) { closes.push([code, reason]); },
    subscribe() {}, unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, messages, closes };
}

describe('Sync recovery protocol', () => {
  test('foreign server epoch forces an authoritative replacement at equal seq', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', { id: 'text primary key', title: 'text' });
    db.insert('todos', { id: 'fresh', title: 'Canonical' });
    const ws = socket();

    handleSyncSubscribe(ws.value, {
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

  test('changed authorization scope forces a purging replacement', () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', { id: 'text primary key' });
    const ws = socket('new-scope');

    handleSyncSubscribe(ws.value, {
      type: 'sync.subscribe', tables: ['todos'], snapshot: ['todos'],
      lastSeq: 0, epoch: db.syncEpoch, scope: 'old-scope',
    }, db);

    const message = ws.messages[0];
    expect(message.type === 'sync.snapshot' && message.reset).toBe('purge');
    db.dispose();
  });

  test('live predecessor cursor ignores unrelated tables without hiding loss', () => {
    const ws = socket();
    ws.data.syncSubscribedTables.add('todos');
    ws.data.lastSeq = 4;
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
});
