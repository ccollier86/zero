/** Pure aggregate validation, ranking, inspection and live identity regression tests. */
import { describe, expect, test } from 'bun:test';
import { buildRaceBarModel, computeRaceBarSnapshot, inspectRaceBarItem, preserveRaceBarFramePosition,
  raceBarValueAt, RACE_BAR_LIMITS } from './race-bar-model';
import type { RaceBarData } from './race-bar-types';

const data = (): RaceBarData => ({ groups: [{ id: 'g', label: 'Group' }],
  items: [{ id: 'a', label: 'Alpha', group: 'g' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }],
  frames: [{ id: 'jan', period: 'January', values: { a: 10, b: 0, c: 10 } },
    { id: 'feb', period: 'February', values: { a: 0, b: 20, c: 10 } }] });

describe('Race Bar model', () => {
  test('copies declared order, groups, values and finite whole-history totals', () => {
    const model = buildRaceBarModel(data());
    expect(model.items.map(item => [item.id, item.index, item.series])).toEqual([['a', 0, 1], ['b', 1, 2], ['c', 2, 3]]);
    expect(model.groups[0]!.label).toBe('Group');
    expect(model.frames.map(frame => [frame.id, frame.index, frame.total])).toEqual([['jan', 0, 20], ['feb', 1, 30]]);
    expect(model.byId.get('a')).toBe(model.items[0]);
    expect(model.frameById.get('feb')).toBe(model.frames[1]);
    const source = { items: [{ id: 'a', label: 'Before' }], frames: [{ period: 'One', values: { a: 7 } }] };
    const owned = buildRaceBarModel(source);
    source.items[0]!.label = 'After'; source.frames[0]!.values.a = 999; source.frames.push({ period: 'Two', values: { a: 20 } });
    expect(owned.items[0]!.label).toBe('Before'); expect(owned.frames[0]!.values[0]).toBe(7); expect(owned.frames.length).toBe(1);
  });

  test('uses period identity only when explicit ID is absent; repeated labels with IDs are valid', () => {
    const model = buildRaceBarModel({ items: [], frames: [{ period: 'Same', id: 'one', values: {} }, { period: 'Same', id: 'two', values: {} }] });
    expect(model.frames.map(frame => frame.id)).toEqual(['one', 'two']);
    expect(buildRaceBarModel({ items: [], frames: [{ period: 'January', values: {} }] }).frames[0]!.id).toBe('January');
    expect(() => buildRaceBarModel({ items: [], frames: [{ period: 'Same', values: {} }, { period: 'Same', values: {} }] })).toThrow(/identity/);
    expect(() => buildRaceBarModel({ items: [], frames: [{ period: 'one', values: {} }, { period: 'other', id: 'one', values: {} }] })).toThrow(/identity/);
  });

  test('treats missing own values as zero and supports null-prototype/prototype-like IDs safely', () => {
    const values: Record<string, number> = Object.create(null);
    for (const [key, value] of [['__proto__', 3], ['constructor', 4], ['toString', 5]] as const) {
      Object.defineProperty(values, key, { value, enumerable: true });
    }
    const model = buildRaceBarModel({ items: [{ id: '__proto__' }, { id: 'constructor' }, { id: 'toString' }, { id: 'missing' }], frames: [{ period: 'One', values }] });
    expect(Array.from(model.frames[0]!.values)).toEqual([3, 4, 5, 0]);
    expect(model.frames[0]!.total).toBe(12);
    const absent = buildRaceBarModel({ items: [{ id: 'toString' }], frames: [{ period: 'One', values: {} }] });
    expect(absent.frames[0]!.values[0]).toBe(0);
    const json = buildRaceBarModel({ items: [{ id: '__proto__' }], frames: [{ period: 'One', values: JSON.parse('{"__proto__":8}') }] });
    expect(json.frames[0]!.values[0]).toBe(8);
    expect(Object.getPrototypeOf(json.frames[0]!.values)).toBe(Float64Array.prototype);
  });

  test('rejects inherited records, accessors and unknown own keys without invoking getters', () => {
    const input = (values: unknown) => ({ items: [{ id: 'a' }], frames: [{ period: 'One', values }] } as RaceBarData);
    expect(() => buildRaceBarModel(input(Object.create({ a: 5 })))).toThrow(/Inherited/);
    let called = 0;
    const accessor = Object.defineProperty({}, 'a', { get() { called++; return 1; }, enumerable: true });
    expect(() => buildRaceBarModel(input(accessor))).toThrow(/accessors/); expect(called).toBe(0);
    expect(() => buildRaceBarModel(input({ a: 1, unknown: 2 }))).toThrow(/unknown item key/);
    expect(() => buildRaceBarModel(input({ [Symbol('a')]: 1 }))).toThrow(/unknown item key/);
    for (const value of [null, [], new Date(), 3, 'x']) expect(() => buildRaceBarModel(input(value))).toThrow(/record/);
  });

  test('rejects invalid values, totals, duplicate identity and group references', () => {
    for (const invalid of [-1, NaN, Infinity, -Infinity, undefined, null, '1']) {
      expect(() => buildRaceBarModel({ items: [{ id: 'a' }], frames: [{ period: 'One', values: { a: invalid as number } }] })).toThrow(/finite nonnegative/);
    }
    expect(() => buildRaceBarModel({ items: [{ id: 'a' }, { id: 'b' }], frames: [{ period: 'One', values: { a: Number.MAX_VALUE, b: Number.MAX_VALUE } }] })).toThrow(/totals overflow/);
    expect(() => buildRaceBarModel({ items: [{ id: 'a' }, { id: 'a' }], frames: [] })).toThrow(/Duplicate/);
    expect(() => buildRaceBarModel({ groups: [{ id: 'g' }, { id: 'g' }], items: [], frames: [] })).toThrow(/Duplicate/);
    expect(() => buildRaceBarModel({ items: [{ id: 'a', group: 'nope' }], frames: [] })).toThrow(/declared group/);
    expect(() => buildRaceBarModel({ items: [{ id: '' }], frames: [] })).toThrow(/nonempty/);
    expect(() => buildRaceBarModel({ items: [{ id: 'a', label: 12 as unknown as string }], frames: [] })).toThrow(/label/);
    expect(() => buildRaceBarModel({ items: [], frames: [{ period: '', values: {} }] })).toThrow(/periods/);
    expect(() => buildRaceBarModel({ items: [], frames: [{ id: '', period: 'One', values: {} }] })).toThrow(/frame id/);
  });

  test('bounds all arrays and the dense/accessible history matrix before allocation', () => {
    const items = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `i${index}` }));
    const frames = (n: number) => Array.from({ length: n }, (_, index) => ({ period: `p${index}`, values: {} }));
    expect(() => buildRaceBarModel({ items: items(RACE_BAR_LIMITS.items + 1), frames: [] })).toThrow(/limited/);
    expect(() => buildRaceBarModel({ items: [], frames: frames(RACE_BAR_LIMITS.frames + 1) })).toThrow(/limited/);
    expect(() => buildRaceBarModel({ items: [], frames: [], groups: items(RACE_BAR_LIMITS.groups + 1) })).toThrow(/limited/);
    expect(() => buildRaceBarModel({ items: items(256), frames: frames(257) })).toThrow(/matrix cells/);
    expect(buildRaceBarModel({ items: items(256), frames: frames(256) }).frames.length).toBe(256);
  });
});

describe('Race Bar ranking and inspection', () => {
  test('keeps equal-value declaration order and ranks fractional blended values', () => {
    const model = buildRaceBarModel(data());
    expect(computeRaceBarSnapshot(model, 0).rows.map(row => [row.item.id, row.value, row.rank])).toEqual([['a', 10, 0], ['c', 10, 1], ['b', 0, 2]]);
    const middle = computeRaceBarSnapshot(model, .5);
    expect(middle.rows.map(row => [row.item.id, row.value, row.rank])).toEqual([['b', 10, 0], ['c', 10, 1], ['a', 5, 2]]);
    expect(middle.total).toBe(25); expect(middle.interpolated).toBe(true); expect(middle.frameIndex).toBe(1);
    expect(middle.lowerFrameIndex).toBe(0); expect(middle.upperFrameIndex).toBe(1);
    expect(raceBarValueAt(model, 'b', .25)).toBeCloseTo(3.96875, 8);
    expect(() => raceBarValueAt(model, 'unknown', 0)).toThrow(/Unknown/);
  });

  test('reports all-item share while separating display interpolation from exact snapshot delta', () => {
    const model = buildRaceBarModel(data()), snapshot = computeRaceBarSnapshot(model, .6);
    const inspection = inspectRaceBarItem(model, snapshot, 'a')!;
    expect(inspection.itemCount).toBe(3); expect(inspection.interpolated).toBe(true);
    expect(inspection.value).toBeGreaterThan(0); expect(inspection.value).toBeLessThan(10);
    expect(inspection.frameValue).toBe(0); expect(inspection.previousValue).toBe(10);
    expect(inspection.change).toBe(-10); expect(inspection.changeRatio).toBe(-1);
    expect(inspection.share).toBeCloseTo(inspection.value / snapshot.total, 10);
    expect(inspection.frame!.id).toBe('feb'); expect(inspection.previousFrame!.id).toBe('jan');
    expect(inspection.lowerFrame!.id).toBe('jan'); expect(inspection.upperFrame!.id).toBe('feb');
    expect(inspectRaceBarItem(model, snapshot, 'b')!.changeRatio).toBeNull();
    expect(inspectRaceBarItem(model, computeRaceBarSnapshot(model, 0), 'a')!.change).toBeNull();
    expect(inspectRaceBarItem(model, snapshot, 'unknown')).toBeNull();
  });

  test('handles empty/single/zero histories and clamps finite positions', () => {
    const empty = buildRaceBarModel({ items: [], frames: [] });
    expect(computeRaceBarSnapshot(empty, 100)).toMatchObject({ position: 0, total: 0, rows: [], frameIndex: 0, interpolated: false });
    const one = buildRaceBarModel({ items: [{ id: 'a' }], frames: [{ period: 'One', values: {} }] });
    expect(computeRaceBarSnapshot(one, -5).position).toBe(0); expect(computeRaceBarSnapshot(one, 5).position).toBe(0);
    expect(inspectRaceBarItem(one, computeRaceBarSnapshot(one, 0), 'a')!.share).toBe(0);
    expect(() => computeRaceBarSnapshot(one, NaN)).toThrow(/finite/);
  });

  test('remains finite for large and subnormal values and undefined relative overflow', () => {
    const model = buildRaceBarModel({ items: [{ id: 'a' }, { id: 'b' }], frames: [
      { period: 'One', values: { a: Number.MIN_VALUE, b: 0 } }, { period: 'Two', values: { a: 8e307, b: 2e307 } }] });
    const snapshot = computeRaceBarSnapshot(model, .5);
    expect(Number.isFinite(snapshot.total)).toBe(true); expect(snapshot.total).toBe(5e307);
    expect(snapshot.rows.every(row => Number.isFinite(row.value))).toBe(true);
    expect(inspectRaceBarItem(model, computeRaceBarSnapshot(model, 1), 'a')!.changeRatio).toBeNull();
  });
});

describe('Race Bar reactive frame continuity', () => {
  test('preserves exact and fractional stable frame identity across prepend and trimming', () => {
    const previous = buildRaceBarModel(data());
    const prepended = buildRaceBarModel({ ...data(), frames: [{ period: 'Before', values: {} }, ...data().frames] });
    expect(preserveRaceBarFramePosition(previous, prepended, 0)).toBe(1);
    expect(preserveRaceBarFramePosition(previous, prepended, .35)).toBeCloseTo(1.35, 10);
    expect(preserveRaceBarFramePosition(previous, prepended, 1)).toBe(2);
    const trimmed = buildRaceBarModel({ ...data(), frames: [data().frames[1]!] });
    expect(preserveRaceBarFramePosition(previous, trimmed, 1)).toBe(0);
    expect(preserveRaceBarFramePosition(previous, trimmed, .8)).toBe(0);
  });

  test('uses rounded identity when insertion separates bounds; falls back safely when retired', () => {
    const previous = buildRaceBarModel(data());
    const inserted = buildRaceBarModel({ ...data(), frames: [data().frames[0]!, { period: 'Middle', values: {} }, data().frames[1]!] });
    expect(preserveRaceBarFramePosition(previous, inserted, .7)).toBe(2);
    expect(preserveRaceBarFramePosition(previous, inserted, .3)).toBe(0);
    const replaced = buildRaceBarModel({ ...data(), frames: [{ period: 'New', values: {} }] });
    expect(preserveRaceBarFramePosition(previous, replaced, 1)).toBe(0);
    expect(preserveRaceBarFramePosition(previous, buildRaceBarModel({ items: [], frames: [] }), 1)).toBe(0);
  });
});
