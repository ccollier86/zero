/** Read-only Zero Sync bridge for Data Studio cache reconciliation. */

import type { Row } from '../../sync/types';

type DataStudioClientTableName = keyof typeof import(
  '../../data-studio/data-studio-client-tables'
).DATA_STUDIO_CLIENT_TABLES;

const DATA_STUDIO_TABLES = 'data_studio_tables' satisfies DataStudioClientTableName;
const DATA_STUDIO_ROWS = 'data_studio_rows' satisfies DataStudioClientTableName;

interface DataStudioSyncCollection {
  getAll(): Record<string, Row>;
  subscribe(callback: (rows: Record<string, Row>) => void): () => void;
}

export interface DataStudioSyncCollectionSource {
  /** Return null when an application did not opt this public Sync table in. */
  collection(name: DataStudioClientTableName): DataStudioSyncCollection | null;
}

export type DataStudioReconciliationEvent = Readonly<
  | {
      readonly kind: 'catalog';
      readonly tableIds: readonly string[];
    }
  | {
      readonly kind: 'rows';
      readonly tableIds: readonly string[];
    }
>;

/**
 * Observe only the public Data Studio reconciliation tables. This bridge never
 * writes through Sync: logical mutations remain revision-checked HTTP commands.
 */
export function subscribeToDataStudioSync(
  source: DataStudioSyncCollectionSource,
  callback: (event: DataStudioReconciliationEvent) => void,
): () => void {
  const unsubscribers: Array<() => void> = [];
  const catalog = source.collection(DATA_STUDIO_TABLES);
  const rows = source.collection(DATA_STUDIO_ROWS);

  if (catalog) {
    unsubscribers.push(subscribeCollection(catalog, 'catalog', callback));
  }

  if (rows) {
    unsubscribers.push(subscribeCollection(rows, 'rows', callback));
  }

  return () => {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  };
}

function subscribeCollection(
  collection: DataStudioSyncCollection,
  kind: DataStudioReconciliationEvent['kind'],
  callback: (event: DataStudioReconciliationEvent) => void,
): () => void {
  let previous: Record<string, Row> | null = null;
  const publish = (next: Record<string, Row>): void => {
    const previousRows = previous;
    const initial = previousRows === null;
    const tableIds = initial
      ? tableIdsIn(next, 'table_id')
      : changedTableIds(previousRows, next, 'table_id');
    previous = next;
    // An unseen DELETE on the lazy row table legitimately produces an
    // empty-to-empty projection. Preserve that signal; the controller treats
    // an empty affected-id set as a bounded wildcard for its active table.
    callback(Object.freeze({ kind, tableIds }));
  };

  // Subscribe first, then read. A remote commit landing between the hook's
  // HTTP snapshot and this baseline is therefore represented either by the
  // subscription callback or by the immediate baseline signal below.
  const unsubscribe = collection.subscribe(publish);
  const baseline = collection.getAll();
  if (previous === null || previous !== baseline) publish(baseline);
  return unsubscribe;
}

function changedTableIds(
  previous: Readonly<Record<string, Row>>,
  next: Readonly<Record<string, Row>>,
  field: string,
): readonly string[] {
  const tableIds = new Set<string>();
  const rowIds = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const rowId of rowIds) {
    if (previous[rowId] === next[rowId]) continue;
    addString(tableIds, previous[rowId]?.[field]);
    addString(tableIds, next[rowId]?.[field]);
  }
  return Object.freeze([...tableIds].sort());
}

function tableIdsIn(
  rows: Readonly<Record<string, Row>>,
  field: string,
): readonly string[] {
  const tableIds = new Set<string>();
  for (const row of Object.values(rows)) addString(tableIds, row[field]);
  return Object.freeze([...tableIds].sort());
}

function addString(values: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.length > 0) values.add(value);
}
