/** Pure server-row identity, visibility and query admission; no requests, React state, or rendering. */
import type { Row } from '../../sync/types';
import { normalizeDataTableServerQuery } from './data-table-server-query';
import { DataTableServerSourceError, type DataTableServerQuery, type DataTableServerSource } from './data-table-server-types';

/** Validate unique row identities while preserving the adapter's order. */
export function projectDataTableServerRows<T extends Row>(rows: readonly T[], primaryKey?: string,
  getRowId?: (row: T, index: number) => string | number): { byId: Record<string, T>; orderedIds: string[] } {
  const byId = Object.create(null) as Record<string, T>, orderedIds: string[] = [];
  rows.forEach((row, index) => {
    const candidate = getRowId ? getRowId(row, index) : row[primaryKey ?? 'id'];
    if ((typeof candidate !== 'string' && typeof candidate !== 'number') || String(candidate).length === 0) throw invalidResponse();
    const id = String(candidate);
    if (Object.prototype.hasOwnProperty.call(byId, id)) throw invalidResponse();
    byId[id] = row; orderedIds.push(id);
  });
  return { byId, orderedIds };
}
/** Exact result identity; retained previous-query data is separately marked by the hook. */
export function dataTableServerStateMatches<State extends { boundaryKey: string; signature: string }>(state: State | null,
  boundaryKey: string, signature: string, ready: boolean): state is State {
  return !!state && ready && state.boundaryKey === boundaryKey && state.signature === signature;
}
/** Previous query pages may remain visible only inside the exact readable source/authorization partition. */
export function dataTableServerPartitionMatches<State extends { partition: string }>(state: State | null,
  partition: string, ready: boolean): state is State {
  return !!state && ready && state.partition === partition;
}
export function resolveDataTableServerQuery<T extends Row>(source: DataTableServerSource<T> | null,
  input?: DataTableServerQuery): { query: DataTableServerQuery | null; error: Error | null } {
  if (!source) return { query: null, error: null };
  try {
    const mode = source.pagination ?? 'offset';
    const query = normalizeDataTableServerQuery(input ?? { search: '', filters: [], sorting: [], pagination: { mode, pageIndex: 0, pageSize: 20 } });
    if (query.pagination.mode !== mode) throw new DataTableServerSourceError('DataTable query pagination does not match its server source.', 'DATA_TABLE_SERVER_QUERY_INVALID');
    if (mode === 'cursor' && !source.adapter) throw new DataTableServerSourceError('Cursor pagination requires a custom DataTable server adapter.', 'DATA_TABLE_SERVER_CURSOR_ADAPTER_REQUIRED');
    return { query, error: null };
  } catch (cause) { return { query: null, error: normalizeDataTableServerFailure(cause) }; }
}
export function normalizeDataTableServerFailure(cause: unknown): Error {
  return cause instanceof Error ? cause : new DataTableServerSourceError('DataTable server query failed.', 'DATA_TABLE_SERVER_QUERY_FAILED');
}
function invalidResponse(): DataTableServerSourceError {
  return new DataTableServerSourceError('DataTable server adapter returned an invalid result.', 'DATA_TABLE_SERVER_RESPONSE_INVALID');
}
