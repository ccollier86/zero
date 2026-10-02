/**
 * data-table-export.ts
 *
 * Serializes the visible, filtered TanStack table rows to a browser-downloaded
 * CSV file. This module owns export mechanics only; toolbar UI stays separate.
 */

import type { Table } from '@tanstack/react-table';

/** Download the table's visible filtered rows as CSV. */
export function exportDataTableCsv<TData>(table: Table<TData>, filename: string) {
  const columns = table.getVisibleFlatColumns();
  const headers = columns.map((column) =>
    typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id,
  );
  const rows = table.getFilteredRowModel().rows.map((row) =>
    columns.map((column) => escapeCsv(String(row.getValue(column.id) ?? ''))),
  );

  const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
