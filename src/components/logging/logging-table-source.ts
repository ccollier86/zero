/** Private Fabric logging mapped onto the standard live server-DataTable adapter. */
import type { LoggingClient } from '../../logging/logging-api-contracts';
import type { LoggingQuery, LoggingStream, StoredLoggingEvent } from '../../logging/logging-contracts';
import type { DataTableServerChange, DataTableServerQuery, DataTableServerSource } from '../data-table/data-table-server-types';

export interface LoggingTableRow extends Record<string, unknown> {
  id: string; time: string; actor: string; action: string; target: string; outcome: string; evidence: string; stored: StoredLoggingEvent;
}
type Status = 'connecting' | 'live' | 'reconnecting';
export interface LoggingTableSource extends DataTableServerSource<LoggingTableRow> {
  /** Shares the adapter's connection, including while protected rows are masked during recovery. */
  watchStatus(listener: (status: Status) => void): () => void;
}
const identity = (stored: StoredLoggingEvent) => JSON.stringify([stored.event.sourceId, stored.event.id]);
export function loggingTableRow(stored: StoredLoggingEvent): LoggingTableRow {
  const e = stored.event;
  return { id: identity(stored), time: new Date(e.occurredAt).toLocaleString(), actor: e.actor.id ?? e.actor.kind,
    action: e.action, target: e.target ? `${e.target.type} · ${e.target.id}` : '—', outcome: e.outcome, evidence: e.evidence, stored };
}

/** One scoped connection; actual INSERTs drive DataTable's existing motion, membership and incoming-record handling. */
export function createLoggingTableSource(client: Pick<LoggingClient, 'page'> & Partial<Pick<LoggingClient, 'watch'>>,
  stream: LoggingStream, criteria: LoggingQuery = {}, options: { platform?: boolean } = {}): LoggingTableSource {
  const filters = structuredClone(criteria);
  const listeners = new Set<(change: DataTableServerChange) => void>(), observers = new Set<(status: Status) => void>();
  let baseline: Promise<number> | null = null, cursor: number | undefined, status: Status = 'connecting';
  let feed: AbortController | null = null, stop: (() => void) | undefined, retry: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, DataTableServerChange>();
  let batch: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    batch = undefined;
    const changes = [...pending.values()]; pending.clear();
    for (const change of changes) for (const listener of listeners) listener(change);
  };
  const initial = (signal: AbortSignal) => {
    if (!baseline) baseline = client.page(stream, { ...filters, limit: 1 }, { signal })
      .then(page => page.highWaterOrdinal).catch(error => { baseline = null; throw error; });
    return baseline;
  };
  const notify = (next: Status) => { status = next; for (const observer of observers) observer(next); };
  const connect = () => {
    if (feed || !client.watch || !listeners.size && !observers.size) return;
    const controller = new AbortController(); feed = controller;
    const active = () => feed === controller && !controller.signal.aborted;
    notify('connecting');
    void initial(controller.signal).then(first => {
      if (!active()) return;
      stop = client.watch!(stream, { ...filters, limit: 1 }, () => {}, {
        signal: controller.signal, platform: options.platform, afterOrdinal: cursor ?? first,
        onStatus: next => { if (active()) notify(next); },
        onError: () => { if (active()) notify('reconnecting'); },
        onChanges: changes => {
          if (!active()) return;
          for (const row of changes.events) {
            const rowId = identity(row); pending.set(rowId, { op: 'INSERT', rowId });
            // Presentation evidence is bounded; the durable database retains
            // all events. Keep the newest identities, including the real head.
            while (pending.size > 1000) pending.delete(pending.keys().next().value!);
          }
          if (pending.size && !batch) batch = setTimeout(flush, 250);
          cursor = changes.throughOrdinal;
        },
      });
    }).catch(() => {
      if (!active()) return;
      notify('reconnecting');
      retry = setTimeout(() => { if (active()) { feed = null; connect(); } }, 5000);
    });
  };
  const release = () => {
    if (listeners.size || observers.size) return;
    clearTimeout(retry); clearTimeout(batch); batch = undefined; pending.clear();
    feed?.abort(); stop?.(); feed = null; stop = undefined;
  };
  const validate = (query: DataTableServerQuery) => {
    if (query.search || query.filters.length || query.sorting.length || query.pagination.pageSize > 100) throw new Error('Logging uses server-defined filters and newest-first evidence order.');
  };
  return {
    type: 'server', table: 'zero_logging_projection', pagination: 'cursor', live: Boolean(client.watch), prefetch: false,
    getRowId: row => row.id,
    watchStatus(listener) {
      observers.add(listener); listener(status); connect();
      return () => { observers.delete(listener); release(); };
    },
    adapter: {
      async query(query, { signal }) {
        validate(query);
        let before: number | undefined;
        if (query.pagination.cursor) {
          if (!/^[1-9][0-9]{0,15}$/.test(query.pagination.cursor)) throw new Error('Invalid logging cursor.');
          before = Number(query.pagination.cursor); if (!Number.isSafeInteger(before)) throw new Error('Invalid logging cursor.');
        }
        // Establish the feed cursor before the first page, closing the read/subscribe race.
        await initial(signal);
        if (signal.aborted) throw new DOMException('Logging query retired.', 'AbortError');
        // The first page is live. Older pages keep their stable ordinal cursor,
        // so new head inserts cannot turn a page transition into a new initial load.
        const page = await client.page(stream, { ...filters,
          ...(before === undefined ? {} : { beforeOrdinal: Math.min(before, filters.beforeOrdinal ?? before) }), limit: query.pagination.pageSize }, { signal });
        return { rows: page.events.map(loggingTableRow), page: { mode: 'cursor', hasMore: page.hasMore, nextCursor: page.nextBeforeOrdinal === null ? null : String(page.nextBeforeOrdinal) } };
      },
      async confirmInsertedRows(query, rowIds, { signal }) {
        validate(query);
        const wanted = rowIds.filter(id => !filters.eventIds || filters.eventIds.includes(id));
        const confirmed = new Set<string>();
        for (let offset = 0; offset < wanted.length; offset += 100) {
          if (signal.aborted) return [];
          const ids = wanted.slice(offset, offset + 100), candidates = new Set(ids);
          const page = await client.page(stream, { ...filters, eventIds: ids, limit: 100 }, { signal });
          for (const row of page.events) { const id = identity(row); if (candidates.has(id)) confirmed.add(id); }
        }
        return signal.aborted ? [] : [...confirmed];
      },
      async getLeadingRowId(query, { signal }) {
        validate(query);
        const page = await client.page(stream, { ...filters, limit: 1 }, { signal });
        return signal.aborted || !page.events.length ? null : identity(page.events[0]!);
      },
      subscribeChanges(query, listener, { signal }) {
        validate(query);
        if (signal.aborted) return () => {};
        const guarded = (change: DataTableServerChange) => { if (!signal.aborted) listener(change); };
        listeners.add(guarded); connect();
        const unsubscribe = () => { listeners.delete(guarded); signal.removeEventListener('abort', unsubscribe); release(); };
        signal.addEventListener('abort', unsubscribe, { once: true }); return unsubscribe;
      },
    },
  };
}
