/** Bounded existing-API membership lookups; owns query projection only, never fetches, evaluates criteria, or reads authorization. */
import type { DataTableServerQuery } from './data-table-server-types';

const MAX_CANDIDATES = 1_000;
const MAX_BATCH = 50;
const MAX_FILTERS = 64;
const MAX_EXPRESSION = 4_096;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** Preserve every captured criterion and append a PK intersection; unsupported identity encodings are omitted conservatively. */
export function dataTableServerMembershipQueries(query: DataTableServerQuery, primaryKey: string,
  rowIds: readonly string[]): DataTableServerQuery[] {
  if (query.pagination.mode !== 'offset' || query.filters.length >= MAX_FILTERS
    || !IDENTIFIER.test(primaryKey) || primaryKey.length > 128) return [];
  const candidates = [...new Set(rowIds.slice(0, MAX_CANDIDATES))].filter(id => typeof id === 'string'
    && id.length > 0 && id.length <= 1_024 && id.trim() === id && !/[\u0000-\u001f\u007f,]/u.test(id));
  const batches: string[][] = [];
  let batch: string[] = [], length = primaryKey.length + 4;
  for (const id of candidates) {
    if (batch.length >= MAX_BATCH || length + id.length + Number(batch.length > 0) > MAX_EXPRESSION) {
      batches.push(batch); batch = []; length = primaryKey.length + 4;
    }
    batch.push(id); length += id.length + Number(batch.length > 1);
  }
  if (batch.length) batches.push(batch);
  return batches.map(ids => ({ ...query,
    filters: [...query.filters, { id: primaryKey, value: { op: 'in', value: ids } }],
    pagination: { mode: 'offset', pageIndex: 0, pageSize: ids.length },
  }));
}
