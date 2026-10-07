/** Pure presentation identity and priority regressions; no network, DOM, source writes or animation timers. */
import { expect, test } from 'bun:test';
import type { Row } from '@tanstack/react-table';
import { dataTableMotionRowsMatch, dataTableMotionTargetChange, reconcileDataTableMotionRows } from './data-table-motion-model';
import { DATA_TABLE_MOTION, dataTableMoveDuration, dataTableMotionDuration } from './data-table-motion-tokens';

const row = (id: string, value = id) => ({ id, original: { value } }) as Row<{ value: string }>;
test('retained leavers preserve one identity and same-id re-entry uses the current original row', () => {
  const a = row('a'), b = row('b'), c = row('c');
  const original = reconcileDataTableMotionRows([a, b], []);
  const leaving = reconcileDataTableMotionRows([b, c], original);
  expect(leaving.map(item => [item.row.id, item.leaving])).toEqual([['b', false], ['c', false], ['a', true]]);
  expect(leaving[2]!.row).toBe(a);
  const updatedA = row('a', 'changed');
  const returned = reconcileDataTableMotionRows([updatedA, b, c], leaving);
  expect(returned.map(item => [item.row.id, item.leaving])).toEqual([['a', false], ['b', false], ['c', false]]);
  expect(returned[0]!.row).toBe(updatedA);
  expect(new Set(returned.map(item => item.row.id)).size).toBe(3);
});
test('page, disabled and reduced-motion reconciliation removes old rows immediately', () => {
  const previous = reconcileDataTableMotionRows([row('a'), row('b')], []);
  expect(reconcileDataTableMotionRows([row('c')], previous, false).map(item => item.row.id)).toEqual(['c']);
});
test('row matching includes order and immutable values but ignores still-leaving rows and recreated TanStack wrappers', () => {
  const a = row('a'), b = row('b'), previous = reconcileDataTableMotionRows([a, b], []);
  expect(dataTableMotionRowsMatch(previous, [{ ...a }, { ...b }])).toBe(true);
  expect(dataTableMotionRowsMatch(previous, [b, a])).toBe(false);
  expect(dataTableMotionRowsMatch(previous, [row('a', 'changed'), b])).toBe(false);
  expect(dataTableMotionRowsMatch([...previous, { row: row('gone'), leaving: true }], [a, b])).toBe(true);
});
test('criteria and batch-size changes take priority over a simultaneous page target', () => {
  const previous = { queryKey: 'q1', pageIndex: 0, pageSize: 20 };
  expect(dataTableMotionTargetChange(previous, { ...previous, pageIndex: 2 })).toBe('page');
  expect(dataTableMotionTargetChange(previous, { ...previous, queryKey: 'q2', pageIndex: 2 })).toBe('query');
  expect(dataTableMotionTargetChange(previous, { ...previous, pageSize: 50, pageIndex: 2 })).toBe('query');
  expect(dataTableMotionTargetChange(previous, previous)).toBeNull();
});
test('reference movement, keyboard and reduced-motion timings remain exact', () => {
  expect(dataTableMoveDuration(0)).toBe(700);
  expect(dataTableMoveDuration(-100)).toBe(735);
  expect(dataTableMoveDuration(10000)).toBe(930);
  expect(dataTableMotionDuration(DATA_TABLE_MOTION.pageOut, false, DATA_TABLE_MOTION.keyboardFactor)).toBe(161);
  expect(dataTableMotionDuration(DATA_TABLE_MOTION.pageOut, true)).toBe(1);
  expect(DATA_TABLE_MOTION).toMatchObject({ fast: 350, base: 525, height: 580, enterDelay: 120, stagger: 45, loaderDelay: 300, loaderMinimum: 400 });
});
