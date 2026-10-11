/** Pure command identity/navigation qualification; no React or DOM provider. */
import { describe, expect, test } from 'bun:test';
import {
  enabledActionIds, recoverTabStop, resolveActiveActionId, resolveRovingTarget,
  validateFloatingButtonGroupItems,
  type FloatingButtonGroupModelItem,
} from './floating-button-group-model';

const actions: readonly FloatingButtonGroupModelItem[] = [
  { id: 'cut', label: 'Cut' },
  { id: 'copy', label: 'Copy', disabled: true },
  { type: 'separator', id: 'edit-end' },
  { id: 'paste', label: 'Paste' },
  { type: 'separator' },
  { type: 'action', id: 'share', label: 'Share' },
];

describe('floating toolbar identity', () => {
  test('validates stable action names and shared explicit identity without prototype collisions', () => {
    expect(() => validateFloatingButtonGroupItems(actions)).not.toThrow();
    expect(() => validateFloatingButtonGroupItems([])).not.toThrow();
    expect(() => validateFloatingButtonGroupItems([{ id: '__proto__', label: 'Prototype' },
      { id: 'constructor', label: 'Constructor' }, { type: 'separator' }, { type: 'separator' }])).not.toThrow();
    for (const invalid of [
      [{ label: 'Missing id' }], [{ id: '', label: 'Blank id' }], [{ id: ' ', label: 'Whitespace id' }],
      [{ id: 'bad' }], [{ id: 'bad', label: '' }], [{ id: 'bad', label: '\t' }],
      [{ id: 'same', label: 'One' }, { id: 'same', label: 'Two' }],
      [{ id: 'same', label: 'One' }, { id: 'same', type: 'separator' }],
      [{ id: 'same', type: 'separator' }, { id: 'same', type: 'separator' }],
      [{ type: 'separator', id: '' }], [{ type: 'separator', id: ' ' }],
    ] satisfies FloatingButtonGroupModelItem[][]) expect(() => validateFloatingButtonGroupItems(invalid)).toThrow(TypeError);
    for (const invalid of [[null], [{ type: 'other' }], [{ id: 1, label: 'Numeric' }], [{ id: 'bad', label: 1 }]]) {
      expect(() => validateFloatingButtonGroupItems(invalid as unknown as FloatingButtonGroupModelItem[])).toThrow(TypeError);
    }
  });

  test('separators and disabled actions never enter the enabled sequence', () => {
    expect(enabledActionIds(actions)).toEqual(['cut', 'paste', 'share']);
    expect(enabledActionIds([])).toEqual([]);
    expect(enabledActionIds([{ type: 'separator' }, { id: 'copy', label: 'Copy', disabled: true }])).toEqual([]);
    expect(actions[1]?.disabled).toBe(true);
  });

  test('active material follows input precedence and drops stale/disabled identities', () => {
    expect(resolveActiveActionId(actions, { hoveredId: 'paste', focusedId: 'cut', interaction: 'pointer' })).toBe('paste');
    expect(resolveActiveActionId(actions, { hoveredId: 'paste', focusedId: 'cut', interaction: 'keyboard' })).toBe('cut');
    expect(resolveActiveActionId(actions, { hoveredId: 'copy', focusedId: 'cut', interaction: 'pointer' })).toBe('cut');
    expect(resolveActiveActionId(actions, { hoveredId: 'paste', focusedId: 'gone', interaction: 'keyboard' })).toBe('paste');
    expect(resolveActiveActionId(actions, { hoveredId: 'edit-end', focusedId: 'copy', interaction: 'pointer' })).toBeNull();
    expect(resolveActiveActionId(actions, { hoveredId: null, focusedId: null, interaction: 'keyboard' })).toBeNull();
    expect(resolveActiveActionId([], { hoveredId: 'paste', focusedId: 'cut', interaction: 'pointer' })).toBeNull();
  });
});

describe('floating toolbar roving focus', () => {
  const ids = ['cut', 'paste', 'share'];
  test('horizontal LTR/RTL arrows wrap and Home/End keep document order', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      expect(resolveRovingTarget(ids, 'paste', 'Home', 'horizontal', direction)).toBe('cut');
      expect(resolveRovingTarget(ids, 'paste', 'End', 'horizontal', direction)).toBe('share');
      expect(resolveRovingTarget(ids, 'paste', 'ArrowUp', 'horizontal', direction)).toBeNull();
      expect(resolveRovingTarget(ids, 'paste', 'ArrowDown', 'horizontal', direction)).toBeNull();
      expect(resolveRovingTarget(ids, 'paste', 'Enter', 'horizontal', direction)).toBeNull();
    }
    expect(resolveRovingTarget(ids, 'cut', 'ArrowLeft')).toBe('share');
    expect(resolveRovingTarget(ids, 'share', 'ArrowRight')).toBe('cut');
    expect(resolveRovingTarget(ids, 'paste', 'ArrowRight', 'horizontal', 'rtl')).toBe('cut');
    expect(resolveRovingTarget(ids, 'paste', 'ArrowLeft', 'horizontal', 'rtl')).toBe('share');
  });

  test('vertical arrows ignore RTL and recover unknown origin deterministically', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      expect(resolveRovingTarget(ids, 'cut', 'ArrowUp', 'vertical', direction)).toBe('share');
      expect(resolveRovingTarget(ids, 'share', 'ArrowDown', 'vertical', direction)).toBe('cut');
      expect(resolveRovingTarget(ids, 'cut', 'ArrowRight', 'vertical', direction)).toBeNull();
    }
    expect(resolveRovingTarget(ids, null, 'ArrowRight')).toBe('cut');
    expect(resolveRovingTarget(ids, 'gone', 'ArrowLeft')).toBe('share');
    expect(resolveRovingTarget(ids, null, 'ArrowDown', 'vertical')).toBe('cut');
    expect(resolveRovingTarget(ids, 'gone', 'ArrowUp', 'vertical')).toBe('share');
    expect(resolveRovingTarget(['only'], 'only', 'ArrowRight')).toBe('only');
    for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowDown']) expect(resolveRovingTarget([], null, key)).toBeNull();
  });

  test('recovery preserves live IDs through reorders and finds the nearest following slot', () => {
    expect(recoverTabStop(actions, [...actions].reverse(), 'paste')).toBe('paste');
    expect(recoverTabStop(actions, actions, null)).toBe('cut');
    expect(recoverTabStop(actions, actions, 'unknown')).toBe('cut');
    expect(recoverTabStop(actions, actions, 'copy')).toBe('paste');
    expect(recoverTabStop(actions, actions.filter(item => item.id !== 'paste'), 'paste')).toBe('share');
    expect(recoverTabStop(actions, actions.filter(item => item.id !== 'share'), 'share')).toBe('paste');
    expect(recoverTabStop(actions, actions.map(item => item.id === 'paste' ? { ...item, disabled: true } : item), 'paste')).toBe('share');
    expect(recoverTabStop(actions, actions.map(item => ({ ...item, disabled: true })), 'paste')).toBeNull();
    expect(recoverTabStop(actions, [], 'paste')).toBeNull();
    expect(recoverTabStop([], [{ id: 'new', label: 'New' }], null)).toBe('new');
    expect(actions[3]?.id).toBe('paste');
  });
});
