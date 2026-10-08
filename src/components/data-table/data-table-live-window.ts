/** Pure held-insert reconciliation; complete datasets or explicit authoritative evidence, never inferred server totals. */
import type { Row } from '../../sync/types';

export interface DataTableLiveWindowState<T extends Row> {
  boundary: string;
  criteria: string;
  input: readonly T[];
  seen: ReadonlySet<string>;
  held: ReadonlySet<string>;
  /** Unacknowledged matching arrivals, including records sorted somewhere other than the start. */
  incoming: ReadonlySet<string>;
  fresh: ReadonlySet<string>;
  baselineReady: boolean;
  evidence?: readonly string[];
  confirmedEvidence?: readonly string[];
  leadingRowId?: string | null;
  observedInserts: ReadonlySet<string>;
  releasedInserts: ReadonlySet<string>;
}

export interface DataTableLiveWindowInput<T extends Row> {
  boundary: string;
  criteria: string;
  data: readonly T[];
  orderedMatchingIds: readonly string[];
  getId: (row: T) => string | null;
  enabled: boolean;
  loading: boolean;
  pageIndex: number;
  pageSize: number;
  scrolledAway: boolean;
  busy: boolean;
  /** Server pages admit only genuine INSERT IDs already confirmed by their authoritative response. */
  insertedRowIds?: readonly string[];
  /** Separately query-confirmed genuine INSERTs, including identities outside the supplied page. */
  confirmedInsertedRowIds?: readonly string[];
  /** Actual first matching identity under the active sort; undefined means position is not known. */
  leadingRowId?: string | null;
}

/** A missing/duplicate identity preserves legacy rendering but disables entity retention. */
export function dataTableStableIds<T extends Row>(data: readonly T[], getId: (row: T) => string | null): Set<string> | null {
  const result = new Set<string>();
  for (const row of data) {
    const id = getId(row);
    if (id === null || result.has(id)) return null;
    result.add(id);
  }
  return result;
}

/** Reconcile latest records while holding only matching genuine additions within one unchanged query. */
export function reconcileDataTableLiveWindow<T extends Row>(previous: DataTableLiveWindowState<T> | null,
  input: DataTableLiveWindowInput<T>): DataTableLiveWindowState<T> {
  const ids = dataTableStableIds(input.data, input.getId);
  const confirmed = new Set(input.confirmedInsertedRowIds);
  if (!previous || previous.boundary !== input.boundary || !ids || !input.enabled) {
    return { boundary: input.boundary, criteria: input.criteria, input: input.data,
      seen: ids ?? new Set(), held: new Set(), incoming: new Set(), fresh: new Set(), baselineReady: !input.loading,
      evidence: input.insertedRowIds, confirmedEvidence: input.confirmedInsertedRowIds,
      leadingRowId: input.leadingRowId,
      observedInserts: new Set(), releasedInserts: new Set() };
  }
  const queryChanged = previous.criteria !== input.criteria;
  const held = new Set([...previous.held].filter(id => ids.has(id) || confirmed.has(id)));
  const matching = new Set([...input.orderedMatchingIds, ...confirmed]);
  const incoming = new Set([...previous.incoming].filter(id => matching.has(id)));
  const fresh = new Set([...previous.fresh].filter(id => ids.has(id) || confirmed.has(id)));
  const observedInserts = new Set(previous.observedInserts);
  const releasedInserts = new Set(previous.releasedInserts);
  if (queryChanged) { held.clear(); incoming.clear(); fresh.clear(); observedInserts.clear(); releasedInserts.clear(); }
  if (!queryChanged && previous.baselineReady && (input.data !== previous.input || input.insertedRowIds !== previous.evidence
    || input.confirmedInsertedRowIds !== previous.confirmedEvidence)) {
    const positions = new Map(input.orderedMatchingIds.map((id, index) => [id, index]));
    const start = input.pageIndex * input.pageSize;
    const explicitEvidence = input.insertedRowIds !== undefined || input.confirmedInsertedRowIds !== undefined;
    const candidates = explicitEvidence ? new Set([...(input.insertedRowIds ?? []), ...confirmed]) : ids;
    for (const id of candidates) {
      if ((explicitEvidence ? releasedInserts.has(id) || observedInserts.has(id) && !confirmed.has(id) : previous.seen.has(id))
        || !ids.has(id) && !confirmed.has(id)) continue;
      const position = positions.get(id);
      if (position === undefined && !confirmed.has(id)) continue;
      fresh.add(id);
      incoming.add(id);
      if (explicitEvidence) observedInserts.add(id);
      if (input.busy || input.scrolledAway || position !== undefined && position < start
        || explicitEvidence && input.pageIndex > 0) held.add(id);
    }
  }
  if (input.pageIndex === 0 && !input.scrolledAway && !input.busy && !input.loading) {
    // Releasing a visual hold is not acknowledgement of records sorted elsewhere.
    held.clear();
    // Already reading the beginning: acknowledge only the new leading block.
    // Arrivals sorted elsewhere remain a passive count, never a false jump action.
    if (input.leadingRowId !== undefined && input.leadingRowId === input.orderedMatchingIds[0]) {
      for (const id of input.orderedMatchingIds) {
        if (!incoming.has(id)) break;
        incoming.delete(id);
        releasedInserts.add(id);
      }
    }
  }
  while (observedInserts.size > 1_000) observedInserts.delete(observedInserts.values().next().value!);
  while (releasedInserts.size > 1_000) releasedInserts.delete(releasedInserts.values().next().value!);
  return { boundary: input.boundary, criteria: input.criteria, input: input.data,
    seen: ids, held, incoming, fresh, baselineReady: previous.baselineReady || !input.loading,
    evidence: input.insertedRowIds, confirmedEvidence: input.confirmedInsertedRowIds,
    leadingRowId: input.leadingRowId, observedInserts, releasedInserts };
}

/** Offer a return-to-start action only when a tracked arrival is actually the first sorted result. */
export function dataTableCanRevealNewRecords(incoming: ReadonlySet<string>, leadingRowId: string | null | undefined): boolean {
  return typeof leadingRowId === 'string' && incoming.has(leadingRowId);
}
