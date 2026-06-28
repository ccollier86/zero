import { useState, useMemo, useCallback } from 'react';
import {
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
  type PaginationState,
  type Table,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { FieldMeta } from '../../schema/field-types';
import type { Row } from '../../sync/types';
import { decodeFieldValue } from '../../schema/field-codecs';
import { getRowPrimaryKey, getSchemaPrimaryKey } from './row-identity';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DataTableCellContext<T extends Row> {
  row: T;
  value: unknown;
  columnId: string;
  fieldMeta?: FieldMeta;
}

export interface DataTableColumnOverride<T extends Row> {
  header?: string;
  cell?: (context: DataTableCellContext<T>) => ReactNode;
  width?: number;
  sortable?: boolean;
  filterable?: boolean;
  editable?: boolean;
}

export type DataTableColumnOverrides<T extends Row> = Record<string, DataTableColumnOverride<T>>;

export interface DataTableInitialState {
  sorting?: SortingState;
  columnFilters?: ColumnFiltersState;
  columnVisibility?: VisibilityState;
  rowSelection?: RowSelectionState;
  globalFilter?: string;
  pagination?: Partial<PaginationState>;
}

export interface UseDataTableOptions<T extends Row> {
  schema: SchemaDescriptor;
  data: T[];
  columns?: string[];
  editable?: string[];
  selectable?: boolean;
  pageSize?: number;
  globalFilter?: string;
  primaryKey?: string;
  columnOverrides?: DataTableColumnOverrides<T>;
  initialState?: DataTableInitialState;
}

export interface UseDataTableReturn<T extends Row> {
  table: Table<T>;
  sorting: SortingState;
  setSorting: React.Dispatch<React.SetStateAction<SortingState>>;
  columnFilters: ColumnFiltersState;
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
  columnVisibility: VisibilityState;
  setColumnVisibility: React.Dispatch<React.SetStateAction<VisibilityState>>;
  rowSelection: RowSelectionState;
  setRowSelection: React.Dispatch<React.SetStateAction<RowSelectionState>>;
  editingCell: { rowId: string; columnId: string } | null;
  setEditingCell: (cell: { rowId: string; columnId: string } | null) => void;
  globalFilter: string;
  setGlobalFilter: React.Dispatch<React.SetStateAction<string>>;
  columnDefs: ColumnDef<T, unknown>[];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useDataTable<T extends Row>(
  options: UseDataTableOptions<T>,
): UseDataTableReturn<T> {
  const {
    schema,
    data,
    columns: visibleColumns,
    editable = [],
    selectable = false,
    pageSize = 20,
    primaryKey: primaryKeyOverride,
    columnOverrides,
    initialState,
  } = options;
  const primaryKey = getSchemaPrimaryKey(schema, primaryKeyOverride);

  // ─── State ──────────────────────────────────────────────────────────

  const [sorting, setSorting] = useState<SortingState>(initialState?.sorting ?? []);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    initialState?.columnFilters ?? [],
  );
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialState?.columnVisibility ?? {},
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>(
    initialState?.rowSelection ?? {},
  );
  const [editingCell, setEditingCellState] = useState<{ rowId: string; columnId: string } | null>(null);
  const [globalFilter, setGlobalFilter] = useState(initialState?.globalFilter ?? '');
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: initialState?.pagination?.pageIndex ?? 0,
    pageSize: initialState?.pagination?.pageSize ?? pageSize,
  });

  const setEditingCell = useCallback(
    (cell: { rowId: string; columnId: string } | null) => setEditingCellState(cell),
    [],
  );

  // ─── Column Definitions ─────────────────────────────────────────────

  const columnDefs = useMemo((): ColumnDef<T, unknown>[] => {
    const fieldNames = visibleColumns ?? schema.fieldNames.filter((name) => {
      const meta = schema.fields.get(name);
      return meta?.tableVisible !== false;
    });

    return fieldNames.map((name) => {
      const meta = schema.fields.get(name);
      const override = columnOverrides?.[name];
      return {
        id: name,
        accessorFn: (row) => meta ? decodeFieldValue(meta, row[name]) : row[name],
        header: override?.header ?? meta?.label ?? formatLabel(name),
        cell: override?.cell
          ? (context) => override.cell!({
              row: context.row.original,
              value: context.getValue(),
              columnId: name,
              fieldMeta: meta,
            })
          : undefined,
        enableSorting: override?.sortable ?? meta?.sortable !== false,
        enableColumnFilter: override?.filterable ?? meta?.filterable !== false,
        size: override?.width ?? meta?.columnWidth,
        meta: {
          fieldMeta: meta,
          isEditable: override?.editable ?? editable.includes(name),
        },
      };
    });
  }, [columnOverrides, schema, visibleColumns, editable]);

  // ─── Table Instance ─────────────────────────────────────────────────

  const table = useReactTable<T>({
    data,
    columns: columnDefs,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: selectable,
    getRowId: (row, index) => getRowPrimaryKey(row, primaryKey) ?? String(index),
  });

  return {
    table,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    rowSelection,
    setRowSelection,
    editingCell,
    setEditingCell,
    globalFilter,
    setGlobalFilter,
    columnDefs,
  };
}

// ─── Utility ────────────────────────────────────────────────────────────────

function formatLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
