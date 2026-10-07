/** Bounded, single-authorization-partition server-page cache and speculative request ownership. No transport or UI. */
import type { Row } from '../../sync/types';
import { dataTableServerQueryKey, normalizeDataTableServerQuery } from './data-table-server-query';
import type { DataTableServerQuery, DataTableServerResult } from './data-table-server-types';

export const DATA_TABLE_SERVER_CACHE_MAX_PAGES = 5;
export const DATA_TABLE_SERVER_CACHE_FRESH_MS = 30_000;
export const DATA_TABLE_SERVER_CACHE_MAX_PAGE_ROWS = 1_000;
const MAX_PREFETCH_REQUESTS = 2;
interface Entry<T extends Row> { query: DataTableServerQuery; result: DataTableServerResult<T>; at: number }
interface Flight<T extends Row> { controller: AbortController; promise: Promise<DataTableServerResult<T> | null>; speculative: boolean }

/** Never retains another scope's data. Refresh/changes retire all cached results and speculative requests. */
export class DataTableServerPageCache<T extends Row> {
  private partition: string | null = null;
  private generation = 0;
  private readonly entries = new Map<string, Entry<T>>();
  private readonly flights = new Map<string, Flight<T>>();
  constructor(private readonly now: () => number = () => performance.now()) {}

  reconcile(partition: string, ready: boolean): void {
    if (this.partition !== partition || !ready) {
      this.invalidate(); this.partition = ready ? partition : null;
    }
  }
  invalidate(): void {
    this.generation++;
    for (const flight of this.flights.values()) flight.controller.abort();
    this.flights.clear(); this.entries.clear();
  }
  /** Navigation can promote its exact prefetch but retires unrelated speculative work. */
  retireSpeculationExcept(query?: DataTableServerQuery): void {
    const currentKey = query ? queryKey(query) : null;
    for (const [key, flight] of this.flights) if (flight.speculative && key !== currentKey) {
      flight.controller.abort(); this.flights.delete(key);
    }
  }
  read(query: DataTableServerQuery): DataTableServerResult<T> | null {
    const key = queryKey(query), entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.at >= DATA_TABLE_SERVER_CACHE_FRESH_MS) { this.entries.delete(key); return null; }
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.result;
  }

  /** Starts immediately, joins a matching prefetch, and retires even an adapter ignoring AbortSignal. */
  request(queryInput: DataTableServerQuery, fetch: (query: DataTableServerQuery, signal: AbortSignal) => Promise<DataTableServerResult<T>>,
    signal?: AbortSignal, admit?: () => boolean): Promise<DataTableServerResult<T> | null> {
    if (this.partition === null || signal?.aborted || admit?.() === false) return Promise.resolve(null);
    const query = normalizeDataTableServerQuery(queryInput), key = queryKey(query), cached = this.read(query);
    if (cached) return Promise.resolve(cached);
    if (!signal && query.pagination.pageSize > DATA_TABLE_SERVER_CACHE_MAX_PAGE_ROWS) return Promise.resolve(null);
    let flight = this.flights.get(key);
    if (!flight) {
      if (!signal && [...this.flights.values()].filter(value => value.speculative).length >= MAX_PREFETCH_REQUESTS) return Promise.resolve(null);
      const controller = new AbortController(), generation = this.generation, partition = this.partition;
      let resolveRetired!: () => void;
      const retired = new Promise<null>(resolve => { resolveRetired = () => resolve(null); });
      controller.signal.addEventListener('abort', resolveRetired, { once: true });
      const owned: Flight<T> = { controller, speculative: !signal, promise: Promise.resolve(null) };
      this.flights.set(key, owned);
      let transport: Promise<DataTableServerResult<T>>;
      try { transport = fetch(query, controller.signal); }
      catch (error) { transport = Promise.reject(error); }
      const operation = Promise.resolve(transport).then(result => {
        if (admit?.() === false || controller.signal.aborted || generation !== this.generation || partition !== this.partition
          || this.flights.get(key) !== owned) return null;
        if (result.rows.length <= DATA_TABLE_SERVER_CACHE_MAX_PAGE_ROWS) {
          this.entries.delete(key); this.entries.set(key, { query, result, at: this.now() });
          while (this.entries.size > DATA_TABLE_SERVER_CACHE_MAX_PAGES) this.entries.delete(this.entries.keys().next().value!);
        }
        return result;
      });
      owned.promise = Promise.race([operation, retired]).finally(() => {
        controller.signal.removeEventListener('abort', resolveRetired);
        if (this.flights.get(key) === owned) this.flights.delete(key);
      });
      flight = owned;
    }
    if (!signal) return flight.promise;
    flight.speculative = false;
    const owned = flight;
    const abort = () => { owned.controller.abort(); if (this.flights.get(key) === owned) this.flights.delete(key); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    return owned.promise.finally(() => signal.removeEventListener('abort', abort));
  }

  /** Offset pages need actual bounds; cursor pages need a returned or retained opaque cursor. */
  forPage(query: DataTableServerQuery, result: DataTableServerResult<T>, pageIndex: number): DataTableServerQuery | null {
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) return null;
    const { pagination } = query;
    if (pageIndex === pagination.pageIndex) return normalizeDataTableServerQuery(query);
    if (pagination.mode === 'offset') {
      if (!Number.isSafeInteger(pageIndex * pagination.pageSize)) return null;
      if (result.page.total !== undefined) {
        if (pageIndex > 0 && pageIndex * pagination.pageSize >= result.page.total) return null;
      } else if (pageIndex > pagination.pageIndex + 1 || pageIndex === pagination.pageIndex + 1 && !result.page.hasMore) return null;
      return normalizeDataTableServerQuery({ ...query, pagination: { ...pagination, pageIndex } });
    }
    if (result.page.mode !== 'cursor') return null;
    if (pageIndex === 0) return normalizeDataTableServerQuery({ ...query, pagination: { ...pagination, pageIndex, cursor: null } });
    const cursor = pageIndex === pagination.pageIndex + 1 && result.page.hasMore ? result.page.nextCursor
      : pageIndex === pagination.pageIndex - 1 ? result.page.previousCursor : undefined;
    if (typeof cursor === 'string') return normalizeDataTableServerQuery({ ...query, pagination: { ...pagination, pageIndex, cursor } });
    for (const entry of this.entries.values()) {
      if (entry.query.pagination.pageIndex === pageIndex && familyKey(entry.query) === familyKey(query)) {
        return normalizeDataTableServerQuery(entry.query);
      }
    }
    return null;
  }
}
function queryKey(query: DataTableServerQuery): string { return dataTableServerQueryKey('', query); }
function familyKey(query: DataTableServerQuery): string {
  return queryKey({ ...query, pagination: { mode: query.pagination.mode, pageSize: query.pagination.pageSize, pageIndex: 0 } });
}
