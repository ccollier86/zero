import { describe, expect, test } from 'bun:test';
import { countCompletedClauseInitials, projectClauseInitialsValue, updateClauseInitialsValue, validateSignatureClauseIds } from './clause-initials-model';

const ink = [{ points: [[1, 2, 3] as const] }];
const clauses = [{ id: 'privacy' }, { id: 'payment' }];

describe('stable clause initials projection', () => {
  test('counts only current clauses with actual ink', () => {
    const value = projectClauseInitialsValue(clauses, { privacy: ink, payment: [{ points: [] }], removed: ink });
    expect(countCompletedClauseInitials(clauses, value)).toBe(1);
    expect(Object.keys(value)).toEqual(['privacy', 'payment']);
    expect(countCompletedClauseInitials([], value)).toBe(0);
  });

  test('reordering and duplicate names do not change stable-ID ownership', () => {
    const value = projectClauseInitialsValue(clauses, { privacy: ink });
    const reordered = projectClauseInitialsValue([...clauses].reverse(), value);
    expect(reordered.privacy).toEqual(ink);
    expect(reordered.payment).toEqual([]);
    expect(countCompletedClauseInitials(clauses, reordered)).toBe(1);
  });

  test('updating makes a deep immutable snapshot and drops removed keys', () => {
    const mutable = [{ points: [[1, 2, 3] as [number, number, number]] }];
    const value = updateClauseInitialsValue(clauses, { privacy: [], payment: [], removed: ink }, 'privacy', mutable);
    mutable[0].points[0][0] = 90;
    expect(value.privacy[0].points[0][0]).toBe(1);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.privacy[0].points[0])).toBe(true);
    expect(Object.hasOwn(value, 'removed')).toBe(false);
  });

  test('composed resets preserve both clause changes in the current draft', () => {
    let current = projectClauseInitialsValue(clauses, { privacy: ink, payment: ink });
    current = updateClauseInitialsValue(clauses, current, 'privacy', []);
    expect(current.payment).toEqual(ink);
    current = updateClauseInitialsValue(clauses, current, 'payment', []);
    expect(current.privacy).toEqual([]);
    expect(current.payment).toEqual([]);
    expect(countCompletedClauseInitials(clauses, current)).toBe(0);
  });

  test('reserved-looking stable IDs are own properties rather than prototype mutations', () => {
    const special = [{ id: '__proto__' }, { id: 'constructor' }, { id: 'toString' }];
    const next = updateClauseInitialsValue(special, projectClauseInitialsValue(special), '__proto__', ink);
    expect(Object.getPrototypeOf(next)).toBeNull();
    expect(next.__proto__).toEqual(ink);
    expect(Object.getOwnPropertyDescriptor(next, 'constructor')?.value).toEqual([]);
    expect(countCompletedClauseInitials(special, next)).toBe(1);
  });

  test('prototype-inherited keys do not count as signed', () => {
    const inherited = Object.create({ privacy: ink });
    const projected = projectClauseInitialsValue(clauses, inherited);
    expect(projected.privacy).toEqual([]);
    expect(countCompletedClauseInitials(clauses, inherited)).toBe(0);
  });

  test('ambiguous or empty clause IDs and unknown writes fail explicitly', () => {
    expect(() => validateSignatureClauseIds([{ id: '' }])).toThrow();
    expect(() => validateSignatureClauseIds([{ id: 'privacy' }, { id: 'privacy' }])).toThrow();
    expect(() => validateSignatureClauseIds([{ id: ' ' }])).toThrow();
    expect(() => updateClauseInitialsValue(clauses, {}, 'unknown', ink)).toThrow();
  });

  test('malformed ink is rejected before initials render or native serialization', () => {
    expect(() => projectClauseInitialsValue(clauses, { privacy: [{ points: [[Infinity, 1, 2]] }] })).toThrow();
    expect(() => updateClauseInitialsValue(clauses, {}, 'privacy', [{ points: [[1, 2, -1]] }])).toThrow();
  });
});
