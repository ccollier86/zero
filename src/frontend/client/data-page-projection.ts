/**
 * Owns accepted page membership/order and filtered Sync invalidation signals.
 * It does not fetch, authorize, mutate cache records, or render React state.
 */
import type { Row } from '../../sync/types';

export interface AcceptedDataPageRows<T extends Row> {
  readonly boundaryKey: string;
  readonly queryKey: string;
  readonly orderedIds: readonly string[];
  readonly snapshot: Readonly<Record<string, T>>;
}

/** Capture declared-key IDs in server order, independently of shared cache membership. */
export function captureDataPageRows<T extends Row>(
  rows: readonly T[], primaryKey: string, cache: Readonly<Record<string, T>>,
  boundaryKey: string, queryKey: string,
): AcceptedDataPageRows<T> {
  const orderedIds: string[] = [];
  const snapshot: Record<string, T> = Object.create(null);
  for (const row of rows) {
    const key = row[primaryKey];
    if ((typeof key !== 'string' && typeof key !== 'number') || String(key).length === 0
      || (typeof key === 'number' && !Number.isSafeInteger(key))) {
      throw new TypeError('A data page contains a row without its declared primary key.');
    }
    const id = String(key);
    if (Object.hasOwn(snapshot, id)) throw new TypeError('A data page contains duplicate row identities.');
    orderedIds.push(id);
    snapshot[id] = cache[id] ?? row;
  }
  return { boundaryKey, queryKey, orderedIds, snapshot };
}

/** Project only accepted IDs; cache evictions by other queries are not server deletions. */
export function projectDataPageRows<T extends Row>(
  page: AcceptedDataPageRows<T>, cache: Readonly<Record<string, T>>,
): T[] {
  return page.orderedIds.map((id) => cache[id] ?? page.snapshot[id]!).filter(Boolean);
}

/** Extract table-local server changes without treating cache loads as authoritative events. */
export function dataPageSyncChanges(
  message: { type: string; [key: string]: unknown }, table: string,
): Array<{ rowId: string; op: string }> {
  if (message.type === 'sync.snapshot' && message.tables && typeof message.tables === 'object'
    && (message.reset || Object.hasOwn(message.tables, table))) return [{ rowId: '', op: 'snapshot' }];
  const candidates = message.type === 'sync.change' ? [message]
    : message.type === 'sync.catchup' && Array.isArray(message.changes) ? message.changes : [];
  return candidates.flatMap((candidate) => {
    if (candidate === null || typeof candidate !== 'object') return [];
    const change = candidate as Record<string, unknown>;
    return change.table === table && typeof change.rowId === 'string'
      && (change.op === 'insert' || change.op === 'update' || change.op === 'delete')
      ? [{ rowId: change.rowId, op: change.op }] : [];
  });
}
