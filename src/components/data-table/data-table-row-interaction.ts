import type * as React from 'react';

type DataTableRowKeyboardEvent = Pick<
  React.KeyboardEvent<HTMLTableRowElement>,
  'currentTarget' | 'key' | 'preventDefault' | 'target'
>;

/**
 * Activate a clickable table row from the keyboard without intercepting key
 * events from controls rendered inside the row.
 */
export function handleDataTableRowKeyDown<T>(
  event: DataTableRowKeyboardEvent,
  row: T,
  onActivate: (row: T) => void,
): void {
  if (event.currentTarget !== event.target) return;

  if (event.key === ' ') {
    event.preventDefault();
  } else if (event.key !== 'Enter') {
    return;
  }

  onActivate(row);
}
