/** Schema-aware TanStack wiring; source transport and interaction state live separately. */

import { useState, useMemo, useCallback, useEffect } from 'react';
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
  type SortingFnOption,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { FieldMeta } from '../../schema/field-types';
import type { Row } from '../../sync/types';
import { createDataTableColumns } from './data-table-columns';
import { getRowPrimaryKey, getSchemaPrimaryKey } from './row-identity';
import {
  useDataTableState,
  type DataTableInitialState,
  type DataTableState,
} from './data-table-state';
export type { DataTableInitialState, DataTableState } from './data-table-state';

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
  minWidth?: number;
  maxWidth?: number;
  /** Flexible columns consume remaining width in fixed layout. */
  flex?: boolean;
  wrap?: boolean;
  truncate?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  editable?: boolean;
  /** Natural direction on first activation; omission retains TanStack's type-aware default. */
  sortDescFirst?: boolean;
  /** Optional domain comparator; transport sorting still uses the declared column ID. */
  sortingFn?: SortingFnOption<T>;
}

export type DataTableColumnOverrides<T extends Row> = Record<string, DataTableColumnOverride<T>>;

export interface UseDataTableOptions<T extends Row> {
  schema: SchemaDescriptor;
  data: T[];
  columns?: string[];
  editable?: string[];
  selectable?: boolean;
  pageSize?: number;
  /** Initial search shorthand; initialState and controlled state take precedence. */
  globalFilter?: string;
  primaryKey?: string;
  /** Stable identity for custom server results without the schema primary key. */
  getRowId?: (row: T, index: number) => string | number;
  columnOverrides?: DataTableColumnOverrides<T>;
  initialState?: DataTableInitialState;
  state?: Partial<DataTableState>;
  onStateChange?: (state: DataTableState) => void;
  /** False renders every supplied row instead of only hiding the footer. */
  paginated?: boolean;
  manualQuery?: boolean;
  /** For an opaque cursor source, changing batch size resets navigation history. */
  paginationMode?: 'offset' | 'cursor';
  rowCount?: number;
  pageCount?: number;
  boundaryKey?: string;
  sortable?: boolean;
  searchableFields?: string[];
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

  const controls = useDataTableState({
    initialState: { ...initialState, globalFilter: initialState?.globalFilter ?? options.globalFilter },
    state: options.state,
    onStateChange: options.onStateChange,
    pageSize,
    boundaryKey: options.boundaryKey,
    paginationMode: options.paginationMode,
  });
  const { sorting, columnFilters, columnVisibility, rowSelection, pagination, globalFilter } = controls.state;
  const setSorting = useCallback((update: React.SetStateAction<SortingState>) => controls.update('sorting', update), [controls.update]);
  const setColumnFilters = useCallback((update: React.SetStateAction<ColumnFiltersState>) => controls.update('columnFilters', update), [controls.update]);
  const setColumnVisibility = useCallback((update: React.SetStateAction<VisibilityState>) => controls.update('columnVisibility', update), [controls.update]);
  const setRowSelection = useCallback((update: React.SetStateAction<RowSelectionState>) => controls.update('rowSelection', update), [controls.update]);
  const setPagination = useCallback((update: React.SetStateAction<PaginationState>) => controls.update('pagination', update), [controls.update]);
  const setGlobalFilter = useCallback((update: React.SetStateAction<string>) => controls.update('globalFilter', update), [controls.update]);
  const [editingCell, setEditingCellState] = useState<{ rowId: string; columnId: string } | null>(null);
  const [editingBoundary, setEditingBoundary] = useState(options.boundaryKey);
  const visibleEditingCell = editingBoundary === options.boundaryKey ? editingCell : null;
  useEffect(() => { setEditingCellState(null); }, [options.boundaryKey]);

  const setEditingCell = useCallback(
    (cell: { rowId: string; columnId: string } | null) => {
      setEditingBoundary(options.boundaryKey);
      setEditingCellState(cell);
    },
    [options.boundaryKey],
  );

  // ─── Column Definitions ─────────────────────────────────────────────

  const columnDefs = useMemo(() => createDataTableColumns<T>({
    schema, columns: visibleColumns, editable, columnOverrides,
    sortable: options.sortable, searchableFields: options.searchableFields,
  }), [columnOverrides, schema, visibleColumns, editable, options.sortable, options.searchableFields]);

  // ─── Table Instance ─────────────────────────────────────────────────

  // TanStack's core-row memo keys only on data, not on getRowId. A new identity
  // boundary must rebuild wrappers even if the caller retains its array.
  const rowData = useMemo(() => [...data], [data, options.boundaryKey, primaryKey, options.getRowId, schema]);

  const table = useReactTable<T>({
    data: rowData,
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
    getSortedRowModel: options.manualQuery ? undefined : getSortedRowModel(),
    getFilteredRowModel: options.manualQuery ? undefined : getFilteredRowModel(),
    getPaginationRowModel: options.paginated === false || options.manualQuery ? undefined : getPaginationRowModel(),
    manualSorting: options.manualQuery,
    manualFiltering: options.manualQuery,
    manualPagination: options.manualQuery || options.paginated === false,
    rowCount: options.rowCount,
    pageCount: options.pageCount,
    autoResetPageIndex: false,
    enableRowSelection: selectable,
    getRowId: (row, index) => String(options.getRowId?.(row, index) ?? getRowPrimaryKey(row, primaryKey) ?? index),
  });

  // An accepted shrinking result must not leave local/known-total offset tables
  // on an empty out-of-range page. Never infer a total from a server batch.
  const knownRows = options.manualQuery ? options.rowCount : table.getPrePaginationRowModel().rows.length;
  useEffect(() => {
    if (options.paginated === false || options.paginationMode === 'cursor' || knownRows === undefined) return;
    const lastPage = Math.max(0, Math.ceil(knownRows / pagination.pageSize) - 1);
    if (pagination.pageIndex > lastPage) table.setPageIndex(lastPage);
  }, [knownRows, pagination.pageIndex, pagination.pageSize, options.paginated, options.paginationMode, table]);

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
    editingCell: visibleEditingCell,
    setEditingCell,
    globalFilter,
    setGlobalFilter,
    columnDefs,
  };
}
