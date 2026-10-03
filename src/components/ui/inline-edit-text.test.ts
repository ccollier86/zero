import { describe, expect, test } from 'bun:test';
import { resolveInlineEditTextKeyAction } from './inline-edit-text';

describe('resolveInlineEditTextKeyAction', () => {
  test('maps the complete keyboard save and cancellation contract', () => {
    expect(resolveInlineEditTextKeyAction('Enter')).toEqual({ type: 'save' });
    expect(resolveInlineEditTextKeyAction('Tab')).toEqual({
      type: 'save-and-move',
      direction: 1,
    });
    expect(resolveInlineEditTextKeyAction('Tab', true)).toEqual({
      type: 'save-and-move',
      direction: -1,
    });
    expect(resolveInlineEditTextKeyAction('Escape')).toEqual({ type: 'cancel' });
    expect(resolveInlineEditTextKeyAction('a')).toBeNull();
    expect(resolveInlineEditTextKeyAction('Enter', false, true)).toBeNull();
  });
});
