/** Synthetic scoped-cache/transport regressions; no network, timers, app database, or authority fixtures. */
import { expect, test } from 'bun:test';
import { DATA_TABLE_SERVER_CACHE_FRESH_MS, DATA_TABLE_SERVER_CACHE_MAX_PAGES, DATA_TABLE_SERVER_CACHE_MAX_PAGE_ROWS, DataTableServerPageCache } from './data-table-server-page-cache';
import type { DataTableServerQuery, DataTableServerResult } from './data-table-server-types';
type RecordRow = { id: string };
const query = (pageIndex = 0, search = ''): DataTableServerQuery => ({ search, filters: [], sorting: [], pagination: { mode: 'offset', pageIndex, pageSize: 20 } });
const page = (id: string, hasMore = true): DataTableServerResult<RecordRow> => ({ rows: [{ id }], page: { mode: 'offset', offset: 0, hasMore } });
const deferred = () => {
  let resolve!: (value: DataTableServerResult<RecordRow>) => void, reject!: (error: Error) => void;
  const promise = new Promise<DataTableServerResult<RecordRow>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const setup = () => { const cache = new DataTableServerPageCache<RecordRow>(); cache.reconcile('scope-a/source-a', true); return cache; };

test('fetch starts immediately and exact foreground navigation joins rather than duplicates a known prefetch', async () => {
  const cache = setup(), pending = deferred(), signal = new AbortController(); let calls = 0;
  const fetch = () => { calls++; return pending.promise; };
  const speculative = cache.request(query(1), fetch);
  expect(calls).toBe(1);
  const foreground = cache.request(query(1), fetch, signal.signal);
  expect(calls).toBe(1);
  pending.resolve(page('next'));
  expect((await foreground)?.rows).toEqual([{ id: 'next' }]);
  expect(await speculative).toBe(await foreground);
  await cache.request(query(1), fetch, signal.signal); expect(calls).toBe(1);
});

test('partition replacement aborts all work, drops every old cached row, and ignores adapters that resolve after abort', async () => {
  const cache = setup(), pending = deferred(); let transportSignal!: AbortSignal;
  await cache.request(query(), async () => page('private-old'), new AbortController().signal);
  const request = cache.request(query(1), (_query, signal) => { transportSignal = signal; return pending.promise; });
  cache.reconcile('scope-b/source-a', true);
  expect(transportSignal.aborted).toBe(true); expect(await request).toBeNull(); expect(cache.read(query())).toBeNull();
  pending.resolve(page('late-private')); await Promise.resolve(); expect(cache.read(query(1))).toBeNull();
  await cache.request(query(1), async () => page('new-scope'), new AbortController().signal);
  expect(cache.read(query(1))?.rows[0]?.id).toBe('new-scope');
});

test('unreadable same-scope boundary invalidates cache and denies new reads until reconciled', async () => {
  const cache = setup(); let calls = 0;
  await cache.request(query(), async () => page('before'), new AbortController().signal);
  cache.reconcile('scope-a/source-a', false);
  expect(cache.read(query())).toBeNull();
  expect(await cache.request(query(), async () => { calls++; return page('forbidden'); })).toBeNull(); expect(calls).toBe(0);
  cache.reconcile('scope-a/source-a', true);
  expect((await cache.request(query(), async () => page('after'), new AbortController().signal))?.rows[0]?.id).toBe('after');
});

test('live admission rejects a transport receipt before it can enter a still-rendered cache partition', async () => {
  const cache = setup(), pending = deferred(); let current = true, calls = 0;
  const request = cache.request(query(), () => { calls++; return pending.promise; }, new AbortController().signal, () => current);
  current = false; pending.resolve(page('retired-authority'));
  expect(await request).toBeNull(); expect(cache.read(query())).toBeNull();
  expect(await cache.request(query(), async () => { calls++; return page('forbidden'); }, undefined, () => current)).toBeNull();
  expect(calls).toBe(1);
});

test('cache identity includes search, filters, sorting, page size, pagination mode and opaque cursor', async () => {
  const cache = setup(); let calls = 0;
  const fetch = async () => page(String(++calls));
  const variants = [query(), query(0, 'Ada'), { ...query(), filters: [{ id: 'status', value: 'running' }] },
    { ...query(), sorting: [{ id: 'id', desc: true }] }, { ...query(), pagination: { ...query().pagination, pageSize: 10 } },
    { ...query(), pagination: { mode: 'cursor' as const, pageIndex: 1, pageSize: 20, cursor: 'opaque-a' } },
    { ...query(), pagination: { mode: 'cursor' as const, pageIndex: 1, pageSize: 20, cursor: 'opaque-b' } }];
  for (const variant of variants) await cache.request(variant, fetch, new AbortController().signal);
  expect(calls).toBe(variants.length);
});

test('LRU storage is capped at five pages and expiration uses bounded monotonic admission time', async () => {
  let now = 10; const cache = new DataTableServerPageCache<RecordRow>(() => now); cache.reconcile('a', true);
  for (let index = 0; index < DATA_TABLE_SERVER_CACHE_MAX_PAGES; index++) await cache.request(query(index), async () => page(String(index)), new AbortController().signal);
  expect(cache.read(query(0))).not.toBeNull();
  await cache.request(query(5), async () => page('5'), new AbortController().signal);
  expect(cache.read(query(1))).toBeNull(); expect(cache.read(query(0))).not.toBeNull();
  now += DATA_TABLE_SERVER_CACHE_FRESH_MS; expect(cache.read(query(0))).toBeNull();
});

test('oversized custom pages remain valid foreground results without being cached or speculatively requested', async () => {
  const cache = setup(); let calls = 0;
  const huge = { ...query(), pagination: { ...query().pagination, pageSize: DATA_TABLE_SERVER_CACHE_MAX_PAGE_ROWS + 1 } };
  expect(await cache.request(huge, async () => { calls++; return page('huge'); })).toBeNull(); expect(calls).toBe(0);
  const result = { ...page('huge'), rows: Array.from({ length: DATA_TABLE_SERVER_CACHE_MAX_PAGE_ROWS + 1 }, (_, id) => ({ id: String(id) })) };
  expect(await cache.request(huge, async () => result, new AbortController().signal)).toBe(result);
  expect(cache.read(huge)).toBeNull();
});

test('at most two speculative transports are admitted; foreground promotion frees speculation capacity', async () => {
  const cache = setup(), first = deferred(), second = deferred(), foreground = new AbortController(); let calls = 0;
  const a = cache.request(query(1), () => { calls++; return first.promise; });
  const b = cache.request(query(2), () => { calls++; return second.promise; });
  expect(await cache.request(query(3), async () => { calls++; return page('extra'); })).toBeNull(); expect(calls).toBe(2);
  const promoted = cache.request(query(1), () => { throw Error('must join'); }, foreground.signal);
  expect((await cache.request(query(3), async () => { calls++; return page('extra'); }))?.rows[0]?.id).toBe('extra');
  foreground.abort(); expect(await a).toBeNull(); expect(await promoted).toBeNull(); second.resolve(page('second')); await b;
});

test('navigation retires unrelated speculative queries while retaining its exact promotable request', async () => {
  const cache = setup(), a = deferred(), b = deferred(); const signals: AbortSignal[] = [];
  const first = cache.request(query(1), (_query, signal) => { signals.push(signal); return a.promise; });
  const second = cache.request(query(2), (_query, signal) => { signals.push(signal); return b.promise; });
  cache.retireSpeculationExcept(query(2));
  expect(signals[0]?.aborted).toBe(true); expect(signals[1]?.aborted).toBe(false); expect(await first).toBeNull();
  b.resolve(page('target')); expect((await second)?.rows[0]?.id).toBe('target'); a.resolve(page('obsolete')); await Promise.resolve();
  expect(cache.read(query(1))).toBeNull();
});
test('prefetch opt-out retires speculation without aborting an active foreground read', async () => {
  const cache = setup(), pending = deferred(), foreground = deferred(), signals: AbortSignal[] = [];
  const speculative = cache.request(query(1), (_query, signal) => { signals.push(signal); return pending.promise; });
  const active = cache.request(query(2), (_query, signal) => { signals.push(signal); return foreground.promise; }, new AbortController().signal);
  cache.retireSpeculationExcept();
  expect(signals[0]?.aborted).toBe(true); expect(signals[1]?.aborted).toBe(false); expect(await speculative).toBeNull();
  foreground.resolve(page('foreground')); expect((await active)?.rows[0]?.id).toBe('foreground');
});

test('superseded foreground cancellation retires its owned transport promptly even when adapter ignores cancellation', async () => {
  const cache = setup(), pending = deferred(), controller = new AbortController(); let signal!: AbortSignal;
  const first = cache.request(query(), (_query, input) => { signal = input; return pending.promise; }, controller.signal);
  controller.abort(); expect(signal.aborted).toBe(true); expect(await first).toBeNull();
  await cache.request(query(), async () => page('replacement'), new AbortController().signal);
  pending.resolve(page('stale')); await Promise.resolve(); expect(cache.read(query())?.rows[0]?.id).toBe('replacement');
});

test('refresh/live invalidation cannot be undone by an old speculative receipt', async () => {
  const cache = setup(), pending = deferred();
  await cache.request(query(), async () => page('old'), new AbortController().signal);
  const previous = cache.request(query(1), () => pending.promise);
  cache.invalidate(); expect(await previous).toBeNull(); expect(cache.read(query())).toBeNull();
  await cache.request(query(1), async () => page('fresh'), new AbortController().signal);
  pending.resolve(page('obsolete')); await Promise.resolve(); expect(cache.read(query(1))?.rows[0]?.id).toBe('fresh');
});

test('speculative errors are retryable and do not become cached successful results', async () => {
  const cache = setup(); await expect(cache.request(query(1), async () => { throw Error('synthetic failure'); })).rejects.toThrow('synthetic failure');
  expect(cache.read(query(1))).toBeNull(); expect((await cache.request(query(1), async () => page('retried')))?.rows[0]?.id).toBe('retried');
});

test('offset prefetch respects truthful optional totals and does not speculate beyond unknown next-page evidence', () => {
  const cache = setup();
  expect(cache.forPage(query(), page('one', false), 1)).toBeNull();
  expect(cache.forPage(query(), page('one'), 1)?.pagination.pageIndex).toBe(1);
  expect(cache.forPage(query(), page('one'), 2)).toBeNull();
  const exact = { ...page('one'), page: { mode: 'offset' as const, offset: 0, hasMore: true, total: 40 } };
  expect(cache.forPage(query(), exact, 1)?.pagination.pageIndex).toBe(1); expect(cache.forPage(query(), exact, 2)).toBeNull();
  expect(page('one').page.total).toBeUndefined();
});

test('cursor prefetch only uses returned cursors or bounded captured history from the exact query family', async () => {
  const cache = setup(), first = { ...query(), pagination: { mode: 'cursor' as const, pageIndex: 0, pageSize: 20, cursor: null } };
  const result = { rows: [{ id: 'one' }], page: { mode: 'cursor' as const, hasMore: true, nextCursor: 'opaque-next' } };
  expect(cache.forPage(first, result, 1)?.pagination.cursor).toBe('opaque-next'); expect(cache.forPage(first, result, 2)).toBeNull();
  expect(cache.forPage(first, { ...result, page: { ...result.page, nextCursor: null } }, 1)).toBeNull();
  const second = cache.forPage(first, result, 1)!;
  await cache.request(second, async () => result, new AbortController().signal);
  const third = { ...second, pagination: { ...second.pagination, pageIndex: 2, cursor: 'opaque-third' } };
  expect(cache.forPage(third, result, 1)?.pagination.cursor).toBe('opaque-next');
  expect(cache.forPage({ ...third, search: 'different' }, result, 1)).toBeNull();
  expect(cache.forPage(second, result, 0)?.pagination.cursor).toBeNull();
});
