import { expect, test } from 'bun:test';
import { carryLoggingResultRow, registerLoggingResultRows, selectLoggingResultRows } from './logging-result-provenance';
const receipt = { id: 'synthetic', digest: 'a'.repeat(64), kind: 'list' as const, table: 'records', count: 3, expiresAt: 1000 };
test('only released objects or equivalent native codec copies select positions in actual displayed order', () => {
  const rows = [{ id: 'one', value: 'private' }, { id: 'two' }, { id: 'three' }];
  registerLoggingResultRows(rows, receipt);
  const selection = selectLoggingResultRows([rows[2]!, rows[0]!]);
  expect(selection).toEqual({ kind: 'list', sources: [{ receiptId: 'synthetic', positions: [2, 0] }] });
  expect(JSON.stringify(selection)).not.toContain('private');
  expect(selectLoggingResultRows([{ ...rows[0], value: 'optimistic' }])).toBeNull();
  const decoded = { ...rows[0] }; carryLoggingResultRow(rows[0]!, decoded);
  expect(selectLoggingResultRows([decoded])).toEqual({ kind: 'list', sources: [{ receiptId: 'synthetic', positions: [0] }] });
  expect(selectLoggingResultRows([], receipt)).toEqual({ kind: 'list', sources: [{ receiptId: 'synthetic', positions: [] }] });
  expect(selectLoggingResultRows([])).toBeNull();
});
test('mixed releases retain interleaved order and reject missing or cross-table provenance', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  registerLoggingResultRows([a, c], { ...receipt, count: 2 });
  registerLoggingResultRows([b], { ...receipt, id: 'next', count: 1 });
  expect(selectLoggingResultRows([a, b, c])?.sources).toEqual([{ receiptId: 'synthetic', positions: [0] }, { receiptId: 'next', positions: [0] }, { receiptId: 'synthetic', positions: [1] }]);
  expect(selectLoggingResultRows([a, {}])).toBeNull();
  const another = {}; registerLoggingResultRows([another], { ...receipt, table: 'other', count: 1 });
  expect(selectLoggingResultRows([a, another])).toBeNull();
});
