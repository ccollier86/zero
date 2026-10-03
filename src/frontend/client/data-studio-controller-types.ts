/**
 * data-studio-controller-types.ts
 *
 * Public React controller contracts and pure capability/query policy. React
 * lifecycle and network effects are composed in data-studio-controller.ts.
 */

import type {
  DataStudioCapabilities,
  DataStudioColumn,
  DataStudioMutationError,
  DataStudioRow,
  DataStudioRowFilter,
  DataStudioRowPage,
  DataStudioSchema,
  DataStudioTable,
  DataStudioTableCreate,
  DataStudioTableSummary,
  DataStudioTableStatus,
  DataStudioTableUpdate,
  DataStudioValue,
} from './data-studio-client';

export type DataStudioControllerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'disabled'
  | 'denied'
  | 'error';

export interface DataStudioAccess {
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly canManage: boolean;
}

export interface UseDataStudioOptions {
  readonly enabled?: boolean;
  readonly initialTableId?: string | null;
  readonly tableStatus?: DataStudioTableStatus | 'all';
  readonly pageSize?: number;
  readonly initialSearch?: string;
  readonly initialFilters?: readonly DataStudioRowFilter[];
}

export interface UseDataStudioResult {
  readonly status: DataStudioControllerStatus;
  readonly capabilities: DataStudioCapabilities | null;
  readonly access: DataStudioAccess;
  readonly tables: readonly DataStudioTableSummary[];
  readonly selectedTableId: string | null;
  readonly selectedTable: DataStudioTable | null;
  readonly rows: readonly DataStudioRow[];
  readonly totalRows: number;
  readonly selectedRowId: string | null;
  readonly selectedRow: DataStudioRow | null;
  readonly selectedRowIndex: number;
  readonly tableStatus: DataStudioTableStatus | 'all';
  readonly search: string;
  readonly filters: readonly DataStudioRowFilter[];
  readonly sortColumnId: string | null;
  readonly sortDirection: 'asc' | 'desc';
  readonly offset: number;
  readonly previousOffset: number | null;
  readonly nextOffset: number | null;
  readonly pageSize: number;
  readonly isLoading: boolean;
  readonly isLoadingRows: boolean;
  readonly isMutating: boolean;
  readonly error: Error | null;
  readonly mutationError: DataStudioMutationError | Error | null;
  selectTable(tableId: string | null): void;
  selectRow(rowId: string | null): void;
  selectPreviousRow(): void;
  selectNextRow(): void;
  setTableStatus(status: DataStudioTableStatus | 'all'): void;
  setSearch(value: string): void;
  setFilters(filters: readonly DataStudioRowFilter[]): void;
  setSort(columnId: string | null, direction?: 'asc' | 'desc'): void;
  setOffset(offset: number): void;
  goToPreviousPage(): void;
  goToNextPage(): void;
  reload(): Promise<void>;
  reloadRows(): Promise<DataStudioRowPage | void>;
  createTable(input: DataStudioTableCreate): Promise<DataStudioTable>;
  updateTable(input: Omit<DataStudioTableUpdate, 'expectedRevision'>): Promise<DataStudioTable>;
  updateSchema(schema: DataStudioSchema): Promise<DataStudioTable>;
  changeTableStatus(status: DataStudioTableStatus): Promise<DataStudioTable>;
  createRow(values: Readonly<Record<string, unknown>>): Promise<DataStudioRow>;
  replaceRow(row: DataStudioRow, values: Readonly<Record<string, unknown>>): Promise<DataStudioRow>;
  updateCell(row: DataStudioRow, columnId: string, value: DataStudioValue): Promise<DataStudioRow>;
  deleteRow(row?: DataStudioRow): Promise<void>;
}

/** Compose server permissions with an optional UI-only narrowing policy. */
export function resolveDataStudioAccess(
  capabilities: DataStudioCapabilities | null,
  narrow?: Partial<DataStudioAccess>,
): DataStudioAccess {
  const enabled = capabilities?.enabled === true;
  return Object.freeze({
    canRead: enabled && capabilities.permissions.read && narrow?.canRead !== false,
    canWrite: enabled && capabilities.permissions.write && narrow?.canWrite !== false,
    canManage: enabled && capabilities.permissions.manage && narrow?.canManage !== false,
  });
}

export function resolveDataStudioStatus(input: {
  enabled: boolean;
  shouldLoad: boolean;
  loading: boolean;
  capabilities: DataStudioCapabilities | null;
  error: Error | null;
}): DataStudioControllerStatus {
  if (!input.enabled) return 'idle';
  if (input.error) return 'error';
  if (input.loading || (input.shouldLoad && !input.capabilities)) return 'loading';
  if (!input.shouldLoad) return 'idle';
  if (input.capabilities?.enabled === false) return 'disabled';
  if (!input.capabilities?.permissions.read) return 'denied';
  return 'ready';
}

export function normalizeDataStudioPageSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.floor(value!));
}

export function clampDataStudioPageSize(value: number, max: number | undefined): number {
  if (!Number.isFinite(max)) return value;
  return Math.min(value, Math.max(1, Math.floor(max!)));
}

export function isCompatibleDataStudioFilter(
  filter: DataStudioRowFilter,
  column: DataStudioColumn,
): boolean {
  if (column.type === 'json') return false;
  if (filter.value === null) return filter.operator === 'eq' || filter.operator === 'ne';
  if (filter.operator === 'contains') {
    return column.type === 'text' && typeof filter.value === 'string';
  }
  if (column.type === 'boolean') {
    return (filter.operator === 'eq' || filter.operator === 'ne')
      && typeof filter.value === 'boolean';
  }
  if (column.type === 'number') return typeof filter.value === 'number';
  return typeof filter.value === 'string' && filter.value.length > 0;
}

export function toDataStudioError(value: unknown): DataStudioMutationError | Error {
  if (value instanceof Error) return value;
  return new Error(String(value));
}
