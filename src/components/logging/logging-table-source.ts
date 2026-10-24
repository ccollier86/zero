/** Logging-to-DataTable cursor adapter. No shared collections, fabricated totals, client-side filtering or snapshot-as-insert events. */
import type { LoggingClient } from '../../logging/logging-api-contracts';
import type { LoggingQuery, LoggingStream, StoredLoggingEvent } from '../../logging/logging-contracts';
import type { DataTableServerSource } from '../data-table/data-table-server-types';

export interface LoggingTableRow extends Record<string, unknown> {
  id: string; time: string; actor: string; action: string; target: string; outcome: string; evidence: string; stored: StoredLoggingEvent;
}
export function loggingTableRow(stored: StoredLoggingEvent): LoggingTableRow {
  const e = stored.event;
  return { id: JSON.stringify([e.sourceId, e.id]), time: new Date(e.occurredAt).toLocaleString(), actor: e.actor.id ?? e.actor.kind,
    action: e.action, target: e.target ? `${e.target.type} · ${e.target.id}` : '—', outcome: e.outcome, evidence: e.evidence, stored };
}
/** One adapter owns one immutable reading baseline; construct a new one when explicitly revealing new activity. */
export function createLoggingTableSource(client: Pick<LoggingClient, 'page'>, stream: LoggingStream, criteria: LoggingQuery = {}): DataTableServerSource<LoggingTableRow> {
  const filters = structuredClone(criteria);
  let baseline: Promise<number> | null = null;
  return {
    type: 'server', table: 'zero_logging_projection', pagination: 'cursor', live: false, prefetch: false,
    getRowId: row => row.id,
    adapter: { async query(query, { signal }) {
      if (query.search || query.filters.length || query.sorting.length || query.pagination.pageSize > 100) throw new Error('Logging uses server-defined filters and newest-first evidence order.');
      let before: number | undefined;
      if (query.pagination.cursor) {
        if (!/^[1-9][0-9]{0,15}$/.test(query.pagination.cursor)) throw new Error('Invalid logging cursor.');
        before = Number(query.pagination.cursor); if (!Number.isSafeInteger(before)) throw new Error('Invalid logging cursor.');
      }
      if (!baseline) {
        // An aborted first request must not poison this adapter for subsequent reads.
        baseline = client.page(stream, { ...filters, limit: 1 }, { signal }).then(page => page.highWaterOrdinal).catch(error => { baseline = null; throw error; });
      }
      const highWaterOrdinal = await baseline;
      if (signal.aborted) throw new DOMException('Logging query retired.', 'AbortError');
      const page = await client.page(stream, { ...filters, highWaterOrdinal, ...(before === undefined ? {} : { beforeOrdinal: before }), limit: query.pagination.pageSize }, { signal });
      return { rows: page.events.map(loggingTableRow), page: { mode: 'cursor', hasMore: page.hasMore, nextCursor: page.nextBeforeOrdinal === null ? null : String(page.nextBeforeOrdinal) } };
    } },
  };
}
