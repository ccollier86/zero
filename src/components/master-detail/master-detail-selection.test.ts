/**
 * master-detail-selection.test.ts
 *
 * Verifies pure row-selection behavior for master-detail views. These tests
 * cover identity resolution only; React rendering and SDK wiring are handled by
 * the component and hook layers.
 */

import { describe, expect, test } from 'bun:test';
import type { Row } from '../../sync/types';
import { resolveMasterDetailSelection } from './master-detail-selection';

interface TestRow extends Row {
  id: string;
  name: string;
}

const rows: TestRow[] = [
  { id: 'one', name: 'One' },
  { id: 'two', name: 'Two' },
];

describe('resolveMasterDetailSelection', () => {
  test('preserves an existing requested row', () => {
    const selection = resolveMasterDetailSelection(rows, 'id', 'two');

    expect(selection.selectedId).toBe('two');
    expect(selection.selectedItem?.name).toBe('Two');
    expect(selection.selectedIndex).toBe(1);
  });

  test('auto-selects the first row when no valid row is requested', () => {
    const selection = resolveMasterDetailSelection(rows, 'id', null);

    expect(selection.selectedId).toBe('one');
    expect(selection.selectedItem?.name).toBe('One');
    expect(selection.selectedIndex).toBe(0);
  });

  test('can leave selection empty when auto-selection is disabled', () => {
    const selection = resolveMasterDetailSelection(rows, 'id', 'missing', false);

    expect(selection.selectedId).toBeNull();
    expect(selection.selectedItem).toBeNull();
    expect(selection.selectedIndex).toBe(-1);
  });

  test('clears selection for an empty row set', () => {
    const selection = resolveMasterDetailSelection([], 'id', 'one');

    expect(selection.selectedId).toBeNull();
    expect(selection.selectedItem).toBeNull();
    expect(selection.selectedIndex).toBe(-1);
  });
});
