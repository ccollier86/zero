'use client';

/** Schema-ID-based presentation sizing backed by TanStack; never patches logical schema or row values. */
import * as React from 'react';
import { useReactTable, getCoreRowModel, type ColumnDef } from '@tanstack/react-table';
import type { DataStudioColumn, DataStudioRow } from '../../frontend/client/data-studio-client';
import { dataStudioCellValue } from '../../frontend/client/data-studio-client';
import { DATA_STUDIO_COLUMN_DEFAULT_WIDTH, DATA_STUDIO_COLUMN_MIN_WIDTH,
  DATA_STUDIO_COLUMN_MAX_WIDTH, clampDataStudioColumnWidth } from './data-studio-column-resize';

export function useDataStudioColumnSizing(columns: readonly DataStudioColumn[], rows: readonly DataStudioRow[], identity?: string) {
  const definitions = React.useMemo<ColumnDef<DataStudioRow>[]>(() => columns.map(column => ({
    id: column.columnId, accessorFn: row => dataStudioCellValue(row, column.columnId),
    size: DATA_STUDIO_COLUMN_DEFAULT_WIDTH, minSize: DATA_STUDIO_COLUMN_MIN_WIDTH,
    maxSize: DATA_STUDIO_COLUMN_MAX_WIDTH,
  })), [columns]);
  const data = React.useMemo(() => [...rows], [rows]);
  // Keep sizing and sizing-info in TanStack's shared state queue. Separately
  // controlled React slots can observe a touch move before its derived width.
  const table = useReactTable({ data, columns: definitions, getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange' });
  React.useEffect(() => { table.resetColumnSizing(); table.resetHeaderSizeInfo(); }, [identity, table]);
  return {
    headers: table.getFlatHeaders(),
    totalWidth: table.getTotalSize(),
    setWidth(columnId: string, width: number) {
      table.setColumnSizing(current => ({ ...current, [columnId]: clampDataStudioColumnWidth(width) }));
    },
  };
}
