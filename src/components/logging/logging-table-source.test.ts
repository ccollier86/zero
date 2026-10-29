import { expect, test } from 'bun:test';
import { createLoggingTableSource } from './logging-table-source';
import type { LoggingClient } from '../../logging/logging-api-contracts';
import type { StoredLoggingEvent } from '../../logging/logging-contracts';
import type { DataTableServerQuery } from '../data-table/data-table-server-types';
import { loggingEvent } from '../../logging/test-support/logging-fixture';

const query: DataTableServerQuery = { search: '', filters: [], sorting: [], pagination: { mode: 'cursor', pageIndex: 0, pageSize: 25 } };
const row = (ordinal: number): StoredLoggingEvent => ({ ordinal, ingestedAt: 1, event: loggingEvent('e' + ordinal) });
const id = (n: number) => JSON.stringify(['fixture-source', 'e' + n]);

test('one authorized connection supplies native INSERT evidence, batches arrivals and keeps page queries live', async () => {
  let head = 2, watchCalls = 0, stops = 0, options!: NonNullable<Parameters<LoggingClient['watch']>[3]>;
  const source = createLoggingTableSource({
    async page(_stream, q = {}) {
      const events = Array.from({ length: head }, (_, i) => row(head - i)).filter(row => (!q.beforeOrdinal || row.ordinal < q.beforeOrdinal) && (!q.eventIds || q.eventIds.includes(id(row.ordinal))));
      return { events: events.slice(0, q.limit ?? 50), highWaterOrdinal: head, total: head, hasMore: false, nextBeforeOrdinal: null };
    },
    watch(_stream, _q, _listener, opts) { watchCalls++; options = opts!; opts?.onStatus?.('live'); return () => { stops++; }; },
  }, 'audit');
  const signal = new AbortController(), observed: string[] = [];
  let received!: () => void;
  const delivery = new Promise<void>(resolve => { received = resolve; });
  const stopStatus = source.watchStatus(() => {});
  const first = await source.adapter!.query(query, { signal: signal.signal });
  const stopChanges = source.adapter!.subscribeChanges!(query, event => { observed.push(event.rowId); if (observed.length === 2) received(); }, { signal: signal.signal });
  try {
    expect(first.rows.map(row => row.id)).toEqual([id(2), id(1)]);
    expect(first.page.total).toBe(2);
    expect(watchCalls).toBe(1); expect(options.afterOrdinal).toBe(2); expect(source.live).toBe(true);
    head = 4;
    options.onChanges!({ events: [row(3), row(4)], afterOrdinal: 2, throughOrdinal: 4, highWaterOrdinal: 4, hasMore: false });
    expect(observed).toEqual([]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([delivery, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Batched change delivery timed out')), 1500); })]); }
    finally { clearTimeout(timeout); }
    expect(observed).toEqual([id(3), id(4)]);
    expect((await source.adapter!.query(query, { signal: signal.signal })).rows[0]!.id).toBe(id(4));
    expect((await source.adapter!.query({ ...query, pagination: { ...query.pagination, cursor: '2', pageIndex: 1 } }, { signal: signal.signal })).page.total).toBe(4);
    expect(await source.adapter!.getLeadingRowId!(query, { signal: signal.signal })).toBe(id(4));
    expect(await source.adapter!.confirmInsertedRows!(query, [id(4), id(100)], { signal: signal.signal })).toEqual([id(4)]);
    stopChanges(); expect(stops).toBe(0);
  } finally { stopChanges(); stopStatus(); signal.abort(); }
  expect(stops).toBe(1);
});

test('a large visual burst stays bounded to newest INSERT identities without changing durable query ownership', async () => {
  let options!: NonNullable<Parameters<LoggingClient['watch']>[3]>, connected!: () => void, received!: () => void;
  const ready = new Promise<void>(resolve => { connected = resolve; }), complete = new Promise<void>(resolve => { received = resolve; });
  const source = createLoggingTableSource({
    async page() { return { events: [], highWaterOrdinal: 0, hasMore: false, nextBeforeOrdinal: null }; },
    watch(_stream, _query, _listener, value) { options = value!; connected(); return () => {}; },
  }, 'audit');
  const signal = new AbortController(), ids: string[] = [];
  const stop = source.adapter!.subscribeChanges!(query, change => { ids.push(change.rowId); if (ids.length === 1000) received(); }, { signal: signal.signal });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await ready;
    for (let after = 0; after < 1200; after += 100) options.onChanges!({ events: Array.from({ length: 100 }, (_, i) => row(after + i + 1)),
      afterOrdinal: after, throughOrdinal: after + 100, highWaterOrdinal: after + 100, hasMore: false });
    expect(ids).toEqual([]);
    await Promise.race([complete, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Bounded batch delivery timed out')), 1500); })]);
    expect(ids).toHaveLength(1000); expect(ids[0]).toBe(id(201)); expect(ids.at(-1)).toBe(id(1200));
  } finally { clearTimeout(timer); stop(); signal.abort(); }
});
