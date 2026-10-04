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
  type FilterFnOption,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { FieldMeta } from '../../schema/field-types';
import type { Row } from '../../sync/types';
import { decodeFieldValue } from '../../schema/field-codecs';
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
}

export type DataTableColumnOverrides<T extends Row> = Record<string, DataTableColumnOverride<T>>;

export interface UseDataTableOptions<T extends Row> {
  schema: SchemaDescriptor;
  data: T[];
  columns?: string[];
  editable?: string[];
  selectable?: boolean;
  pageSize?: number;
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
    initialState,
    state: options.state,
    onStateChange: options.onStateChange,
    pageSize,
    boundaryKey: options.boundaryKey,
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

  const columnDefs = useMemo((): ColumnDef<T, unknown>[] => {
    const fieldNames = visibleColumns ?? schema.fieldNames.filter((name) => {
      const meta = schema.fields.get(name);
      return meta?.tableVisible !== false;
    });

    return fieldNames.map((name) => {
      const meta = schema.fields.get(name);
      const override = columnOverrides?.[name];
      const filterFn = getSchemaFilterFn<T>(meta);
      return {
        id: name,
        accessorFn: (row) => meta ? decodeFieldValue(meta, row[name]) : row[name],
        header: override?.header ?? meta?.label ?? formatLabel(name),
        ...(override?.cell ? {
          cell: (context) => override.cell!({
            row: context.row.original,
            value: context.getValue(),
            columnId: name,
            fieldMeta: meta,
          }),
        } : {}),
        enableSorting: options.sortable !== false && (override?.sortable ?? meta?.sortable !== false),
        enableColumnFilter: override?.filterable ?? meta?.filterable !== false,
        enableGlobalFilter: options.searchableFields ? options.searchableFields.includes(name) : undefined,
        ...(filterFn ? { filterFn } : {}),
        size: override?.width ?? meta?.columnWidth,
        minSize: override?.minWidth,
        maxSize: override?.maxWidth,
        meta: {
          fieldMeta: meta,
          isEditable: override?.editable ?? editable.includes(name),
          flex: override?.flex,
          wrap: override?.wrap,
          truncate: override?.truncate,
        },
      };
    });
  }, [columnOverrides, schema, visibleColumns, editable, options.sortable, options.searchableFields]);

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

// ─── Utility ────────────────────────────────────────────────────────────────

function formatLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/** Keep schema-backed discrete controls exact and scalar numeric filters safe. */
function getSchemaFilterFn<T extends Row>(
  meta: FieldMeta | undefined,
): FilterFnOption<T> | undefined {
  switch (meta?.type) {
    case 'boolean':
    case 'date':
    case 'datetime':
    case 'enum':
    case 'number':
    case 'select':
      return 'equals';
    case 'combobox':
      return meta.multiple ? 'arrIncludes' : 'equals';
    case 'multiSelect':
    case 'tags':
      return 'arrIncludes';
    default:
      return undefined;
  }
}
