/** Genuine-event provenance/query isolation tests. No socket/network, shared collections, or app data. */
import { expect, test } from 'bun:test';
import type { InternalClient } from '../../frontend/client/sdk';
import { DATA_TABLE_SERVER_MAX_INSERT_EVIDENCE, DataTableServerInsertEvidence, readDataTableSyncChange, subscribeDataTableServerChanges } from './data-table-server-changes';
import type { DataTableServerChange, DataTableServerQuery } from './data-table-server-types';
const query: DataTableServerQuery = { search: 'Ada', filters: [], sorting: [], pagination: { mode: 'offset', pageIndex: 0, pageSize: 2 } };
const insert = (rowId: string): DataTableServerChange => ({ op: 'INSERT', rowId });

test('only staged genuine IDs intersected with the current accepted query become evidence; result joins alone never do', () => {
  const evidence = new DataTableServerInsertEvidence(); evidence.reconcile('scope-a/query-a');
  expect(evidence.accept('scope-a/query-a', ['ordinary-page-joiner'])).toEqual([]);
  evidence.observe(insert('already-visible'), ['already-visible']);
  evidence.observe(insert('matching'), []); evidence.observe(insert('not-in-response'), []);
  expect(evidence.accept('scope-a/query-a', ['matching', 'ordinary-page-joiner', 'already-visible'])).toEqual(['matching']);
  expect(evidence.accept('scope-a/query-a', ['matching'])).toEqual([]);
  expect(evidence.accept('scope-a/query-a', ['not-in-response'])).toEqual(['not-in-response']);
});
test('source/auth/query replacement resets pending evidence and late receipts cannot claim membership', () => {
  const evidence = new DataTableServerInsertEvidence(); evidence.reconcile('scope-a/query-a'); evidence.observe(insert('old-private'), []);
  evidence.reconcile('scope-b/query-a'); expect(evidence.accept('scope-b/query-a', ['old-private'])).toEqual([]);
  evidence.observe(insert('current'), []); expect(evidence.accept('scope-a/query-a', ['current'])).toEqual([]);
  evidence.reconcile('scope-b/query-b'); expect(evidence.accept('scope-b/query-b', ['current'])).toEqual([]);
});
test('updates preserve genuine pending INSERT provenance, deletes retire it, and invalid events are conservatively ignored', () => {
  const evidence = new DataTableServerInsertEvidence(); evidence.reconcile('a');
  for (const id of ['updated', 'deleted']) evidence.observe(insert(id), []);
  evidence.observe({ op: 'UPDATE', rowId: 'updated' }, []); evidence.observe({ op: 'DELETE', rowId: 'deleted' }, []);
  evidence.observe(insert(''), []); evidence.observe(insert('x'.repeat(1_025)), []);
  expect(evidence.accept('a', ['updated', 'deleted', '', 'x'.repeat(1_025)])).toEqual(['updated']);
});
test('the bounded evidence ledger drops oldest overflow rather than inventing an unseen count', () => {
  const evidence = new DataTableServerInsertEvidence(); evidence.reconcile('a');
  for (let index = 0; index <= DATA_TABLE_SERVER_MAX_INSERT_EVIDENCE; index++) evidence.observe(insert(String(index)), []);
  expect(evidence.accept('a', ['0', '1', String(DATA_TABLE_SERVER_MAX_INSERT_EVIDENCE)])).toEqual(['1', String(DATA_TABLE_SERVER_MAX_INSERT_EVIDENCE)]);
});
test('only actual admitted sync.change operations for the exact table are projected, never catchup/snapshot/ack', () => {
  const valid = { type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'new', row: { id: 'new' } };
  expect(readDataTableSyncChange(valid, 'records')).toEqual(insert('new'));
  expect(readDataTableSyncChange(valid, 'other')).toBeNull();
  for (const type of ['sync.snapshot', 'sync.catchup', 'sync.ack']) expect(readDataTableSyncChange({ ...valid, type }, 'records')).toBeNull();
  expect(readDataTableSyncChange({ ...valid, row: null }, 'records')).toBeNull();
  expect(readDataTableSyncChange({ ...valid, op: 'LOAD' }, 'records')).toBeNull();
  expect(readDataTableSyncChange({ ...valid, rowId: 2 }, 'records')).toBeNull();
  expect(readDataTableSyncChange({ ...valid, op: 'DELETE', row: null }, 'records')).toEqual({ op: 'DELETE', rowId: 'new' });
});
test('custom endpoints explicitly own their query subscription and retired callbacks cannot emit; no fallback to unrelated SDK stream', () => {
  let sdkSubscriptions = 0, seenQuery: DataTableServerQuery | undefined, callback!: (change: DataTableServerChange) => void;
  const client = { _syncClient: { onMessage() { sdkSubscriptions++; return () => {}; } } } as unknown as InternalClient;
  const controller = new AbortController(), received: DataTableServerChange[] = [];
  const unsubscribe = subscribeDataTableServerChanges({ type: 'server', table: 'records', adapter: {
    query: async () => ({ rows: [], page: { mode: 'offset', offset: 0, hasMore: false } }),
    subscribeChanges(value, listener, { signal }) { seenQuery = value; callback = listener; expect(signal).toBe(controller.signal); return () => {}; },
  } }, query, client, change => received.push(change), controller.signal);
  expect(seenQuery).toEqual(query); expect(seenQuery).not.toBe(query); expect(sdkSubscriptions).toBe(0);
  callback(insert('current')); controller.abort(); callback(insert('late')); unsubscribe(); expect(received).toEqual([insert('current')]);
  subscribeDataTableServerChanges({ type: 'server', table: 'records', adapter: { query: async () => ({ rows: [], page: { mode: 'offset', offset: 0, hasMore: false } }) } }, query, client, () => {}, new AbortController().signal);
  expect(sdkSubscriptions).toBe(0);
});
test('built-in data queries subscribe to SDK changes but live:false and aborted admission create no subscription', () => {
  let subscriptions = 0, callback!: (message: { type: string; [key: string]: unknown }) => void;
  const client = { _syncClient: { onMessage(listener: typeof callback) { subscriptions++; callback = listener; return () => {}; } } } as unknown as InternalClient;
  const controller = new AbortController(), received: DataTableServerChange[] = [];
  subscribeDataTableServerChanges({ type: 'server', table: 'records' }, query, client, change => received.push(change), controller.signal);
  callback({ type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'new', row: {} });
  controller.abort(); callback({ type: 'sync.change', table: 'records', op: 'INSERT', rowId: 'late', row: {} });
  subscribeDataTableServerChanges({ type: 'server', table: 'records', live: false }, query, client, () => {}, new AbortController().signal);
  subscribeDataTableServerChanges({ type: 'server', table: 'records' }, query, client, () => {}, controller.signal);
  expect(subscriptions).toBe(1); expect(received).toEqual([insert('new')]);
});
