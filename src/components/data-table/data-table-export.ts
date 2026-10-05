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
    escapeCsv(typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id),
  );
  const rows = table.getFilteredRowModel().rows.map((row) =>
    columns.map((column) => escapeCsv(row.getValue(column.id))),
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

function escapeCsv(value: unknown): string {
  const text = String(value ?? '');
  // Keep actual numeric cells numeric. Formula-looking text is a literal
  // spreadsheet value, not an instruction: quote it with apostrophe + tab as
  // defense in depth for spreadsheet import and Excel save/reopen behavior.
  // Leading whitespace/control and locale variants must not bypass the guard.
  const literalText = typeof value !== 'number' && typeof value !== 'bigint'
    && (/^\s*[=+\-@＝＋－＠]/u.test(text) || /^[\u0000-\u001f]/u.test(text));
  const content = literalText ? `'\t${text}` : text;
  return literalText || /[",\r\n]/u.test(content)
    ? `"${content.replaceAll('"', '""')}"`
    : content;
}
