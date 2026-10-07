/** Pure live-buffer qualification; real arrivals, query changes and authority partitions remain source-owned. */
import { expect, test } from 'bun:test';
import { dataTableStableIds, reconcileDataTableLiveWindow, type DataTableLiveWindowInput } from './data-table-live-window';

type RecordRow = { id: string; rank: number };
const row = (id: string, rank = 0): RecordRow => ({ id, rank });
function input(data: readonly RecordRow[], overrides: Partial<DataTableLiveWindowInput<RecordRow>> = {}): DataTableLiveWindowInput<RecordRow> {
  return { boundary: 'account-a', criteria: 'rank-desc', data, orderedMatchingIds: data.map(value => value.id),
    getId: value => value.id, enabled: true, loading: false, pageIndex: 0, pageSize: 2,
    scrolledAway: false, busy: false, ...overrides };
}

test('missing or duplicate stable identities disable retention without changing supplied records', () => {
  expect(dataTableStableIds([row('a'), row('a')], value => value.id)).toBeNull();
  expect(dataTableStableIds([row('a')], () => null)).toBeNull();
  const data = [row('a'), row('a')];
  const result = reconcileDataTableLiveWindow(null, input(data, { scrolledAway: true }));
  expect(result.input).toBe(data); expect(result.held.size).toBe(0); expect(result.fresh.size).toBe(0);
});

test('first-load data is a baseline, not a newly inserted count', () => {
  const empty = reconcileDataTableLiveWindow(null, input([], { loading: true }));
  const data = [row('a'), row('b')];
  const ready = reconcileDataTableLiveWindow(empty, input(data, { scrolledAway: true }));
  expect(ready.baselineReady).toBe(true); expect(ready.held.size).toBe(0); expect(ready.fresh.size).toBe(0);
  const inserted = reconcileDataTableLiveWindow(ready, input([row('new'), ...data], { scrolledAway: true }));
  expect([...inserted.held]).toEqual(['new']); expect([...inserted.fresh]).toEqual(['new']);
});

test('sorted additions above a later local page are held while existing updates remain live', () => {
  const data = [row('a', 4), row('b', 3), row('c', 2), row('d', 1)];
  const before = reconcileDataTableLiveWindow(null, input(data, { pageIndex: 1 }));
  const updated = [row('new', 5), data[0]!, data[1]!, row('c', 2.5), data[3]!];
  const next = reconcileDataTableLiveWindow(before, input(updated, { pageIndex: 1 }));
  expect([...next.held]).toEqual(['new']); expect([...next.fresh]).toEqual(['new']);
  expect(next.input.find(value => value.id === 'c')?.rank).toBe(2.5);
  expect(next.input.filter(value => !next.held.has(value.id)).slice(2, 4).map(value => value.id)).toEqual(['c', 'd']);
});

test('only matching additions count and explicit reveal at the top clears held identities', () => {
  const data = [row('a'), row('b')];
  const before = reconcileDataTableLiveWindow(null, input(data));
  const nextData = [row('matching'), row('not-matching'), ...data];
  const held = reconcileDataTableLiveWindow(before, input(nextData, { orderedMatchingIds: ['matching', 'a', 'b'], scrolledAway: true }));
  expect([...held.held]).toEqual(['matching']); expect([...held.fresh]).toEqual(['matching']);
  const revealed = reconcileDataTableLiveWindow(held, input(nextData, { orderedMatchingIds: ['matching', 'a', 'b'] }));
  expect(revealed.held.size).toBe(0); expect([...revealed.fresh]).toEqual(['matching']);
});

test('a busy transition coalesces arrivals and releases them only when its current top view settles', () => {
  const data = [row('a')];
  const baseline = reconcileDataTableLiveWindow(null, input(data));
  const latest = [row('new'), ...data];
  const busy = reconcileDataTableLiveWindow(baseline, input(latest, { busy: true }));
  expect([...busy.held]).toEqual(['new']);
  const settled = reconcileDataTableLiveWindow(busy, input(latest));
  expect(settled.held.size).toBe(0); expect([...settled.fresh]).toEqual(['new']);
});

test('collection or server query arrivals require explicit INSERT evidence, including a late same-data receipt', () => {
  const data = [row('a')], noEvidence: string[] = [];
  const baseline = reconcileDataTableLiveWindow(null, input(data, { insertedRowIds: noEvidence, pageIndex: 1 }));
  const latest = [row('b'), ...data];
  const arrived = reconcileDataTableLiveWindow(baseline, input(latest, { insertedRowIds: noEvidence, pageIndex: 1 }));
  expect(arrived.held.size).toBe(0); expect(arrived.fresh.size).toBe(0);
  const confirmed = reconcileDataTableLiveWindow(arrived, input(latest, { insertedRowIds: ['b'], pageIndex: 1 }));
  expect([...confirmed.held]).toEqual(['b']); expect([...confirmed.fresh]).toEqual(['b']);
  const revealed = reconcileDataTableLiveWindow(confirmed, input(latest, { insertedRowIds: ['b'] }));
  const repeated = reconcileDataTableLiveWindow(revealed, input([...latest], { insertedRowIds: ['b'], pageIndex: 1 }));
  expect(repeated.held.size).toBe(0);
});

test('deletions, query replacement and account replacement retire held and fresh presentation', () => {
  const data = [row('a')];
  const before = reconcileDataTableLiveWindow(null, input(data));
  const held = reconcileDataTableLiveWindow(before, input([row('new'), ...data], { scrolledAway: true }));
  const deleted = reconcileDataTableLiveWindow(held, input(data, { scrolledAway: true }));
  expect(deleted.held.size).toBe(0); expect(deleted.fresh.size).toBe(0);
  const query = reconcileDataTableLiveWindow(held, input(held.input, { criteria: 'name-asc', scrolledAway: true }));
  expect(query.held.size).toBe(0); expect(query.fresh.size).toBe(0); expect(query.observedInserts.size).toBe(0);
  const account = reconcileDataTableLiveWindow(held, input(held.input, { boundary: 'account-b', scrolledAway: true }));
  expect(account.held.size).toBe(0); expect(account.fresh.size).toBe(0);
});

test('liveUpdates disabled clears the buffer and never invents a new arrival', () => {
  const data = [row('a')];
  const before = reconcileDataTableLiveWindow(null, input(data));
  const held = reconcileDataTableLiveWindow(before, input([row('new'), ...data], { scrolledAway: true }));
  const disabled = reconcileDataTableLiveWindow(held, input(held.input, { enabled: false, scrolledAway: true }));
  expect(disabled.held.size).toBe(0); expect(disabled.fresh.size).toBe(0); expect(disabled.input).toBe(held.input);
});

test('separate confirmed server membership holds off-page insert IDs without adding lookup rows to the page', () => {
  const data = [row('page-two-a'), row('page-two-b')], noEvidence: string[] = [];
  const baseline = reconcileDataTableLiveWindow(null, input(data, {
    pageIndex: 1, insertedRowIds: noEvidence, confirmedInsertedRowIds: noEvidence,
  }));
  const confirmed = reconcileDataTableLiveWindow(baseline, input(data, {
    pageIndex: 1, insertedRowIds: noEvidence, confirmedInsertedRowIds: ['above-view'],
  }));
  expect(confirmed.input).toBe(data);
  expect([...confirmed.held]).toEqual(['above-view']);
  expect([...confirmed.fresh]).toEqual(['above-view']);
  const laterPage = [row('page-three-a')];
  const persisted = reconcileDataTableLiveWindow(confirmed, input(laterPage, {
    pageIndex: 2, insertedRowIds: noEvidence, confirmedInsertedRowIds: ['above-view'],
  }));
  expect(persisted.input).toBe(laterPage);
  expect([...persisted.held]).toEqual(['above-view']);
  const removed = reconcileDataTableLiveWindow(persisted, input(laterPage, {
    pageIndex: 2, insertedRowIds: noEvidence, confirmedInsertedRowIds: [],
  }));
  expect(removed.held.size).toBe(0); expect(removed.fresh.size).toBe(0);
});

test('page and separate membership evidence deduplicate and cannot replay after reveal', () => {
  const data = [row('a')], noEvidence: string[] = [];
  const baseline = reconcileDataTableLiveWindow(null, input(data, {
    pageIndex: 1, insertedRowIds: noEvidence, confirmedInsertedRowIds: noEvidence,
  }));
  const latest = [row('new'), ...data];
  const confirmed = reconcileDataTableLiveWindow(baseline, input(latest, {
    pageIndex: 1, insertedRowIds: ['new'], confirmedInsertedRowIds: ['new', 'off-page'],
  }));
  expect([...confirmed.held]).toEqual(['new', 'off-page']);
  const revealed = reconcileDataTableLiveWindow(confirmed, input(latest, {
    insertedRowIds: ['new'], confirmedInsertedRowIds: ['new', 'off-page'],
  }));
  expect(revealed.held.size).toBe(0);
  const repeated = reconcileDataTableLiveWindow(revealed, input(latest, {
    pageIndex: 1, insertedRowIds: ['new'], confirmedInsertedRowIds: ['new', 'off-page'],
  }));
  expect(repeated.held.size).toBe(0);
  const changed = reconcileDataTableLiveWindow(confirmed, input(latest, {
    pageIndex: 1, criteria: 'different-search', insertedRowIds: ['new'], confirmedInsertedRowIds: [],
  }));
  expect(changed.held.size).toBe(0);
});

test('off-page UPDATE revalidation can restore a held ID until it is explicitly released', () => {
  const data = [row('page-two')], none: string[] = [];
  const options = { pageIndex: 1, insertedRowIds: none, confirmedInsertedRowIds: none };
  const baseline = reconcileDataTableLiveWindow(null, input(data, options));
  const original = reconcileDataTableLiveWindow(baseline, input(data, { ...options, confirmedInsertedRowIds: ['new'] }));
  expect([...original.held]).toEqual(['new']);
  const rechecking = reconcileDataTableLiveWindow(original, input(data, { ...options, confirmedInsertedRowIds: [] }));
  expect(rechecking.held.size).toBe(0);
  const reconfirmed = reconcileDataTableLiveWindow(rechecking, input(data, { ...options, confirmedInsertedRowIds: ['new'] }));
  expect([...reconfirmed.held]).toEqual(['new']);
  const released = reconcileDataTableLiveWindow(reconfirmed, input(data, { ...options, pageIndex: 0, confirmedInsertedRowIds: ['new'] }));
  const again = reconcileDataTableLiveWindow(released, input(data, { ...options, confirmedInsertedRowIds: ['new'] }));
  expect(again.held.size).toBe(0);
});
