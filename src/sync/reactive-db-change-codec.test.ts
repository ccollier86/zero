/** Single-pass, allocation-bounded codec validation. No physical fixtures. */
import { expect, test } from 'bun:test';
import {
  validateRetainedChangeRows,
  validateRetainedHistory,
  type ChangeLogStateRow,
} from './reactive-db-change-codec';
import type { ChangeRow } from './types';

const state = (seq: number, pruneThrough = 0): ChangeLogStateRow => ({
  singleton: 1, schema_version: 1, write_format: 1, min_reader_format: 0, seq, prune_through: pruneThrough,
});
const row = (seq: number, versioned = true): ChangeRow => ({
  seq, tbl: 'synthetic', op: 'INSERT', row_id: String(seq), data: '{"id":"synthetic"}',
  previous_data: null, ts: 0, origin: null, format_version: versioned ? 1 : null,
  format_version_type: versioned ? 'integer' : 'null',
});

function singlePass(rows: readonly ChangeRow[]) {
  let iterations = 0;
  let yielded = 0;
  let closed = 0;
  const iterable: Iterable<ChangeRow> = { *[Symbol.iterator]() {
    if (++iterations !== 1) throw new Error('synthetic iterator was consumed twice');
    try { for (const item of rows) { yielded++; yield item; } }
    finally { closed++; }
  } };
  return { iterable, stats: () => ({ iterations, yielded, closed }) };
}

test('retained-history validator consumes a generator exactly once with legacy then current rows', () => {
  const fixture = singlePass([row(3, false), row(4), row(5)]);
  expect(() => validateRetainedHistory(state(5, 2), fixture.iterable)).not.toThrow();
  expect(fixture.stats()).toEqual({ iterations: 1, yielded: 3, closed: 1 });
});

test('row-only validation preserves array compatibility and accepts a single-pass iterable', () => {
  expect(() => validateRetainedChangeRows([row(1), row(2)])).not.toThrow();
  const fixture = singlePass([row(1), row(2)]);
  expect(() => validateRetainedChangeRows(fixture.iterable)).not.toThrow();
  expect(fixture.stats()).toEqual({ iterations: 1, yielded: 2, closed: 1 });
});

test('streaming preserves payload, sequence and legacy-order errors and closes early failures', () => {
  for (const [rows, message] of [
    [[row(1), row(3)], 'retained change history is not contiguous'],
    [[row(1), row(2, false)], 'legacy history follows versioned history'],
    [[{ ...row(1), data: 'not-json' }, row(2)], 'invalid data JSON'],
    [[{ ...row(1), seq: -1 }], 'invalid change sequence'],
  ] as const) {
    for (const validate of [validateRetainedChangeRows, (input: Iterable<ChangeRow>) => validateRetainedHistory(state(2), input)]) {
      const fixture = singlePass(rows);
      expect(() => validate(fixture.iterable)).toThrow(message);
      expect(fixture.stats().iterations).toBe(1);
      expect(fixture.stats().closed).toBe(1);
    }
  }
});

test('streaming retains empty, pruned and endpoint/count state checks', () => {
  expect(() => validateRetainedHistory(state(0), singlePass([]).iterable)).not.toThrow();
  expect(() => validateRetainedHistory(state(5, 5), singlePass([]).iterable)).not.toThrow();
  expect(() => validateRetainedHistory(state(5, 4), singlePass([]).iterable)).toThrow('retained history is missing');
  for (const [current, rows] of [[state(3), [row(1), row(2)]],
    [state(3, 1), [row(1), row(2), row(3)]], [state(3), [row(2), row(3)]]] as const) {
    expect(() => validateRetainedHistory(current, singlePass(rows).iterable)).toThrow('retained history does not match log state');
  }
});
