/** Existing HTTP adapter membership qualification; fake transport only, no client authority or database. */
import { expect, test } from 'bun:test';
import type { Client } from '../../frontend/client/sdk';
import { createDataTableApiAdapter } from './data-table-server-query';
import { dataTableServerMembershipQueries } from './data-table-server-membership-query';
import type { DataTableServerQuery } from './data-table-server-types';

const query: DataTableServerQuery = { search: 'Alpha', searchFields: ['name'],
  filters: [{ id: 'status', value: 'open' }], sorting: [{ id: 'rank', desc: true }],
  pagination: { mode: 'offset', pageIndex: 8, pageSize: 20 } };

test('membership projection keeps captured criteria, adds PK intersection and never changes the caller query', () => {
  const before = JSON.stringify(query);
  const [lookup] = dataTableServerMembershipQueries(query, 'recordKey', ['one', 'two', 'one']);
  expect(lookup).toEqual({ ...query,
    filters: [...query.filters, { id: 'recordKey', value: { op: 'in', value: ['one', 'two'] } }],
    pagination: { mode: 'offset', pageIndex: 0, pageSize: 2 } });
  expect(JSON.stringify(query)).toBe(before);
});

test('membership lookups bound ID count and expression length, conservatively omitting unsupported encodings and filter budgets', () => {
  const batches = dataTableServerMembershipQueries(query, 'id', Array.from({ length: 1_005 }, (_, index) => `row-${index}`));
  expect(batches).toHaveLength(20);
  expect(batches.every(value => value.pagination.pageSize <= 50)).toBe(true);
  expect(batches.reduce((total, value) => total + value.pagination.pageSize, 0)).toBe(1_000);
  const long = dataTableServerMembershipQueries(query, 'id', Array.from({ length: 10 }, (_, index) => `${index}${'a'.repeat(1_023)}`));
  expect(long.map(value => value.pagination.pageSize)).toEqual([3, 3, 3, 1]);
  expect(dataTableServerMembershipQueries(query, 'id', ['', 'bad,id', ' padded', 'tail ', 'bad\u0000id', 'x'.repeat(1_025)])).toEqual([]);
  expect(dataTableServerMembershipQueries({ ...query, filters: Array.from({ length: 64 }, () => ({ id: 'status', value: 'open' })) }, 'id', ['one'])).toEqual([]);
  expect(dataTableServerMembershipQueries({ ...query, pagination: { mode: 'cursor', pageIndex: 0, pageSize: 20 } }, 'id', ['one'])).toEqual([]);
  expect(dataTableServerMembershipQueries(query, 'invalid.key', ['one'])).toEqual([]);
});

test('built-in adapter confirms exact returned PKs through the existing bounded search/filter API without merging lookup rows', async () => {
  const requests: { path: string; signal: AbortSignal }[] = [];
  const client = { async fetch(path: string, { signal }: { signal: AbortSignal }) {
    requests.push({ path, signal });
    return { rows: [{ recordKey: 'one', name: 'Alpha one' }, { recordKey: 'not-requested', name: 'Alpha ordinary' }],
      page: { limit: 2, offset: 0, count: 2, hasMore: false, nextOffset: null } };
  } } as unknown as Client;
  const adapter = createDataTableApiAdapter(client, 'records', 'recordKey');
  const controller = new AbortController();
  expect(await adapter.confirmInsertedRows!(query, ['one', 'two'], { signal: controller.signal })).toEqual(['one']);
  expect(requests).toHaveLength(1);
  const params = new URL(requests[0]!.path, 'http://fixture.invalid').searchParams;
  expect(params.get('table')).toBe('records'); expect(params.get('search')).toBe('Alpha');
  expect(params.getAll('searchField')).toEqual(['name']); expect(params.getAll('filter')).toEqual(['recordKey:in:one,two', 'status:open']);
  expect(params.getAll('sort')).toEqual(['rank:desc']); expect(params.get('offset')).toBe('0'); expect(params.get('limit')).toBe('2');
  expect(requests[0]!.signal).toBe(controller.signal);
  controller.abort();
  expect(await adapter.confirmInsertedRows!(query, ['one'], { signal: controller.signal })).toEqual([]);
  expect(requests).toHaveLength(1);
  expect(createDataTableApiAdapter(client, 'records').confirmInsertedRows).toBeUndefined();
});

test('denial propagates to the content-free hook reporting boundary and cancellation cannot confirm a late transport response', async () => {
  const denied = createDataTableApiAdapter({ fetch: async () => { throw new Error('PRIVATE_DENIAL'); } } as unknown as Client, 'records', 'id');
  await expect(denied.confirmInsertedRows!(query, ['one'], { signal: new AbortController().signal })).rejects.toThrow('PRIVATE_DENIAL');
  let resolve!: (value: unknown) => void;
  const delayed = createDataTableApiAdapter({ fetch: () => new Promise(done => { resolve = done; }) } as unknown as Client, 'records', 'id');
  const controller = new AbortController();
  const pending = delayed.confirmInsertedRows!(query, ['one'], { signal: controller.signal });
  controller.abort();
  resolve({ rows: [{ id: 'one' }], page: { limit: 1, offset: 0, count: 1, hasMore: false, nextOffset: null } });
  expect(await pending).toEqual([]);
});
