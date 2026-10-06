import { describe, expect, test } from 'bun:test';
import {
  assertSignaturePadColor, commitSignaturePadHistory, createSignaturePadHistory,
  hasSignaturePadInk, reconcileSignaturePadHistory, redoSignaturePadHistory,
  resetSignaturePadHistory, sameSignaturePadStrokes, SIGNATURE_PAD_HISTORY_LIMIT,
  SIGNATURE_PAD_LIMITS, snapshotSignaturePadStrokes, undoSignaturePadHistory,
  validateSignaturePadStrokes,
} from './signature-model';
import type { SignaturePadStroke } from './signature-pad.types';

const ink = (x = 10): SignaturePadStroke[] => [{ points: [[x, 10, 2], [20, 20, 3], [30, 30, 4]] }];

describe('signature ink admission and snapshots', () => {
  test('snapshots every mutable level without caller aliases', () => {
    const input: Array<{ points: [number, number, number][]; color: string }> = [
      { points: [[10, 20, 3]], color: '#123' },
    ];
    const snapshot = snapshotSignaturePadStrokes(input);
    expect(snapshot).toEqual(input);
    expect(snapshot).not.toBe(input);
    expect(snapshot[0]).not.toBe(input[0]);
    expect(snapshot[0].points).not.toBe(input[0].points);
    expect(snapshot[0].points[0]).not.toBe(input[0].points[0]);
    for (const value of [snapshot, snapshot[0], snapshot[0].points, snapshot[0].points[0]]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    input[0].points[0][0] = 99;
    input[0].color = '#fff';
    expect(snapshot[0]).toEqual({ points: [[10, 20, 3]], color: '#123' });
  });

  test('reuses only internally owned immutable ink to keep history efficient', () => {
    const first = snapshotSignaturePadStrokes(ink());
    expect(snapshotSignaturePadStrokes(first)).toBe(first);
    const next = snapshotSignaturePadStrokes([...first, { points: [[50, 50, 2]] }]);
    expect(next[0]).toBe(first[0]);
    const external = Object.freeze([{ points: [[1, 2, 3]] }]) as readonly SignaturePadStroke[];
    const copied = snapshotSignaturePadStrokes(external);
    expect(copied[0].points).not.toBe(external[0].points);
  });

  test('normalizes unknown properties instead of carrying them into exported JSON', () => {
    const value: unknown = [{ points: [[1, 2, 3]], applicationSecret: 'not-signature-data' }];
    validateSignaturePadStrokes(value);
    expect(snapshotSignaturePadStrokes(value)).toEqual([{ points: [[1, 2, 3]] }]);
  });

  test('compares interior points, sizes and stroke colors, not just endpoints', () => {
    expect(sameSignaturePadStrokes(ink(), ink())).toBe(true);
    const middleChanged = [{ points: [[10, 10, 2], [21, 20, 3], [30, 30, 4]] }] as SignaturePadStroke[];
    expect(sameSignaturePadStrokes(ink(), middleChanged)).toBe(false);
    expect(sameSignaturePadStrokes(ink(), [{ points: [[10, 10, 2], [20, 20, 5], [30, 30, 4]] }])).toBe(false);
    expect(sameSignaturePadStrokes(ink(), [{ ...ink()[0], color: '#123' }])).toBe(false);
    expect(sameSignaturePadStrokes(ink(), [])).toBe(false);
  });

  test('only real ink satisfies required-field emptiness', () => {
    expect(hasSignaturePadInk([])).toBe(false);
    expect(hasSignaturePadInk([{ points: [] }, { points: [], color: 'red' }])).toBe(false);
    expect(hasSignaturePadInk([{ points: [] }, { points: [[0, 0, 1]] }])).toBe(true);
  });

  test.each([
    'black', 'currentColor', 'transparent', '#fff', '#1234', '#102030', '#102030aa',
    'rgb(12, 34, 56)', 'rgba(12,34,56,.8)', 'rgb(0 0 0 / 50%)', 'hsl(30deg 50% 60%)',
  ])('admits a safe solid color: %s', (value) => expect(() => assertSignaturePadColor(value)).not.toThrow());

  test.each([
    'url(https://example.test/paint.svg#fill)', 'var(--ink)', 'context-fill',
    'red" onload="alert(1)', '</path><script>alert(1)</script>', 'rgb(1,2,3);fill:url(x)',
    '', 'a'.repeat(129), undefined, 42,
  ])('rejects unsafe/nonbounded paints: %s', (value) => expect(() => assertSignaturePadColor(value)).toThrow(TypeError));

  test.each([
    null, {}, [{ points: 'bad' }], [null], [{ points: [[1, 2]] }],
    [{ points: [[1, 2, 3, 4]] }], [{ points: [[NaN, 2, 3]] }], [{ points: [[1, Infinity, 3]] }],
    [{ points: [[1, 2, -1]] }], [{ points: [[1, 2, 0]] }], [{ points: [[1, 2, 257]] }],
    [{ points: [[1_000_001, 2, 1]] }], [{ points: [[1, -1_000_001, 1]] }],
    [{ points: [['1', 2, 3]] }], [{ points: [[1, 2, 3]], color: 'url(x)' }],
  ])('rejects malformed imported ink without reflecting its contents', (value) => {
    expect(() => validateSignaturePadStrokes(value)).toThrow();
  });

  test('enforces aggregate point and stroke limits before geometry allocation', () => {
    expect(() => validateSignaturePadStrokes(Array.from({ length: SIGNATURE_PAD_LIMITS.strokes + 1 }, () => ({ points: [] })))).toThrow(RangeError);
    const point = [1, 2, 3];
    expect(() => validateSignaturePadStrokes([{ points: Array(SIGNATURE_PAD_LIMITS.points + 1).fill(point) }])).toThrow(RangeError);
    expect(() => validateSignaturePadStrokes([{ points: Array(50_001).fill(point) }, { points: Array(50_000).fill(point) }])).toThrow(RangeError);
    expect(() => validateSignaturePadStrokes([{ points: [[1_000_000, -1_000_000, 256]] }])).not.toThrow();
  });

  test('rejects sparse point tuples rather than skipping missing coordinates', () => {
    expect(() => validateSignaturePadStrokes([{ points: [Array(3)] }])).toThrow(TypeError);
    expect(() => validateSignaturePadStrokes([{ points: [[1, , 3]] }])).toThrow(TypeError);
  });
});

describe('signature history', () => {
  test('commits, undo, redo and clear are distinct snapshots', () => {
    const initial = createSignaturePadHistory();
    const signed = commitSignaturePadHistory(initial, ink());
    const cleared = commitSignaturePadHistory(signed, []);
    expect(cleared.present).toEqual([]);
    const undoClear = undoSignaturePadHistory(cleared);
    expect(undoClear.present).toEqual(ink());
    expect(undoClear.future).toEqual([[]]);
    const undoSign = undoSignaturePadHistory(undoClear);
    expect(undoSign.present).toEqual([]);
    expect(redoSignaturePadHistory(undoSign).present).toEqual(ink());
    expect(redoSignaturePadHistory(redoSignaturePadHistory(undoSign)).present).toEqual([]);
    expect(undoSignaturePadHistory(initial)).toBe(initial);
    expect(redoSignaturePadHistory(initial)).toBe(initial);
  });

  test('controlled deep copies preserve history, including redo', () => {
    const history = undoSignaturePadHistory(commitSignaturePadHistory(createSignaturePadHistory(), ink()));
    expect(reconcileSignaturePadHistory(history, structuredClone(history.present))).toBe(history);
    expect(reconcileSignaturePadHistory(history, []).future.length).toBe(1);
  });

  test('an outside interior-point edit clears both stacks', () => {
    const history = commitSignaturePadHistory(createSignaturePadHistory(), ink());
    const changed = [{ points: [[10, 10, 2], [99, 20, 3], [30, 30, 4]] }] as SignaturePadStroke[];
    const reconciled = reconcileSignaturePadHistory(history, changed);
    expect(reconciled.present).toEqual(changed);
    expect(reconciled.past).toEqual([]);
    expect(reconciled.future).toEqual([]);
    expect(reconciled.present).not.toBe(changed);
  });

  test('a new edit after undo invalidates redo; an equal commit is a no-op', () => {
    const signed = commitSignaturePadHistory(createSignaturePadHistory(), ink());
    expect(commitSignaturePadHistory(signed, ink())).toBe(signed);
    const edited = commitSignaturePadHistory(undoSignaturePadHistory(signed), ink(15));
    expect(edited.future).toEqual([]);
    expect(edited.present).toEqual(ink(15));
  });

  test('caps history at 100 and retains the latest preceding snapshot', () => {
    let history = createSignaturePadHistory();
    for (let index = 0; index < 110; index++) history = commitSignaturePadHistory(history, ink(index));
    expect(history.past.length).toBe(SIGNATURE_PAD_HISTORY_LIMIT);
    expect(history.past[0]).toEqual(ink(9));
    expect(undoSignaturePadHistory(history).present).toEqual(ink(108));
    for (const value of [history, history.past, history.future, history.present]) expect(Object.isFrozen(value)).toBe(true);
  });

  test('form reset snapshots the default and does not retain stale undo/redo', () => {
    const input = ink();
    const reset = resetSignaturePadHistory(input);
    expect(reset.present).toEqual(input);
    expect(reset.present).not.toBe(input);
    expect(reset.past).toEqual([]);
    expect(reset.future).toEqual([]);
  });
});
