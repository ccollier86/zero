/** Coherent progressive projection regressions; synthetic records, no databases. */
import { expect, test } from 'bun:test';
import { appendDataStudioRowPage, DataStudioWindowChangedError } from './data-studio-row-window';
import type { DataStudioRowPage } from './data-studio-client';

function page(offset: number, ids: string[], seq = 1, total = 4): DataStudioRowPage {
  return {
    readSequence: seq, offset, total, limit: 2,
    nextOffset: offset + ids.length < total ? offset + ids.length : null,
    rows: ids.map(rowId => ({ rowId, tableId: 'table-one', schemaRevision: 1,
      revision: 1, values: {}, createdAt: 1, updatedAt: 1 })),
  };
}
test('joins exact ordered batches including a byte-short continuation', () => {
  const first = appendDataStudioRowPage(null, page(0, ['a']));
  const next = appendDataStudioRowPage(first, page(1, ['b', 'c']));
  const final = appendDataStudioRowPage(next, page(3, ['d']));
  expect(final.rows.map(row => row.rowId)).toEqual(['a', 'b', 'c', 'd']);
  expect(final.page.nextOffset).toBeNull();
  expect(first.rows.map(row => row.rowId)).toEqual(['a']);
});
test('insert, delete and sort changes cannot silently join different sequences', () => {
  const first = appendDataStudioRowPage(null, page(0, ['a', 'b']));
  for (const candidate of [page(2, ['c', 'd'], 2), page(2, ['d'], 2, 3), page(2, ['a', 'c'])]) {
    expect(() => appendDataStudioRowPage(first, candidate)).toThrow(DataStudioWindowChangedError);
  }
});
test('rejects missing snapshot metadata, shifted offsets, duplicate IDs and nonprogress', () => {
  const first = appendDataStudioRowPage(null, page(0, ['a', 'b']));
  for (const candidate of [
    { ...page(2, ['c', 'd']), readSequence: undefined },
    page(3, ['d']), page(2, ['c', 'c']), page(2, []),
    { ...page(2, ['c', 'd']), nextOffset: 3 },
  ]) expect(() => appendDataStudioRowPage(first, candidate)).toThrow(DataStudioWindowChangedError);
});
test('empty first page is a valid exhausted schema-backed result', () => {
  const empty = appendDataStudioRowPage(null, page(0, [], 1, 0));
  expect(empty.rows).toEqual([]);
  expect(empty.page.nextOffset).toBeNull();
});
