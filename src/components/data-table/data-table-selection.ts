/** Project only selected rows in the current accepted/rendered page model. */

import type { Row, Table } from '@tanstack/react-table';

/** Controlled selection may retain other IDs; it never expands page-action scope. */
export function selectedDataTablePageRows<T>(table: Table<T>): Row<T>[] {
  return table.getRowModel().rows.filter((row) => row.getIsSelected());
}
