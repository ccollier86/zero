/**
 * data-studio-cache.ts
 *
 * Authorization-partitioned reactive cache for parsed Data Studio responses.
 * Transport, response validation, and React lifecycle policy live elsewhere.
 */

import type {
  DataStudioTable,
  DataStudioTableSummary,
  DataStudioTableStatus,
} from '../../data-studio/data-studio-contracts';
import type {
  DataStudioCacheSnapshot,
  DataStudioCapabilities,
  DataStudioRowPage,
} from './data-studio-client-types';
import { DataStudioRowPageLru } from './data-studio-row-page-lru';
import { tableSummary } from './data-studio-response';

export interface DataStudioCacheStore {
  getSnapshot(): DataStudioCacheSnapshot;
  getRowPage(key: string): DataStudioRowPage | undefined;
  subscribe(callback: () => void): () => void;
  captureScope(): number;
  withScope<T>(scopeRevision: number, action: () => T): T;
  setScope(scopeKey: string): void;
  clear(): void;
  captureRowEpoch(tableId: string): number;
  invalidateRowPages(tableId: string, preserveKey?: string): void;
  setCapabilities(value: DataStudioCapabilities): void;
  setTables(value: readonly DataStudioTableSummary[], status: DataStudioTableStatus | 'all'): void;
  upsertTable(value: DataStudioTable): void;
  setRowPage(
    tableId: string,
    key: string,
    value: DataStudioRowPage,
    expectedEpoch: number,
  ): void;
}

const EMPTY_ROW_PAGES: Readonly<Record<string, DataStudioRowPage>> = Object.freeze({});
const EMPTY_TABLES: readonly DataStudioTableSummary[] = Object.freeze([]);
const EMPTY_TABLE_DETAILS: Readonly<Record<string, DataStudioTable>> = Object.freeze({});

export function createDataStudioCacheStore(): DataStudioCacheStore {
  let scopeRevision = 0;
  const rowEpochs = new Map<string, number>();
  const rowPageLru = new DataStudioRowPageLru();
  let snapshot: DataStudioCacheSnapshot = Object.freeze({
    scopeKey: null,
    capabilities: null,
    tables: EMPTY_TABLES,
    tableDetails: EMPTY_TABLE_DETAILS,
    rowPages: EMPTY_ROW_PAGES,
  });
  const listeners = new Set<() => void>();

  function publish(next: DataStudioCacheSnapshot): void {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  }

  function clearForScope(scopeKey: string | null): void {
    scopeRevision += 1;
    rowEpochs.clear();
    rowPageLru.clear();
    publish({
      scopeKey,
      capabilities: null,
      tables: EMPTY_TABLES,
      tableDetails: EMPTY_TABLE_DETAILS,
      rowPages: EMPTY_ROW_PAGES,
    });
  }

  return {
    getSnapshot: () => snapshot,
    getRowPage(key) {
      const page = snapshot.rowPages[key];
      if (page) rowPageLru.touch(key);
      return page;
    },
    captureScope: () => scopeRevision,
    withScope(expected, action) {
      assertCurrentScope();
      try {
        const result = action();
        assertCurrentScope();
        return result;
      } catch (cause) {
        if (scopeRevision !== expected) clearForScope(snapshot.scopeKey);
        throw cause;
      }

      function assertCurrentScope(): void {
        if (scopeRevision !== expected) {
          const error = new Error('Discarded a Data Studio response from a previous authorization scope.');
          error.name = 'AbortError';
          throw error;
        }
      }
    },
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    setScope(scopeKey) {
      if (snapshot.scopeKey !== scopeKey) clearForScope(scopeKey);
    },
    clear() {
      clearForScope(null);
    },
    captureRowEpoch(tableId) {
      return rowEpochs.get(tableId) ?? 0;
    },
    invalidateRowPages(tableId, preserveKey) {
      rowEpochs.set(tableId, (rowEpochs.get(tableId) ?? 0) + 1);
      const rowPages: Record<string, DataStudioRowPage> = {};
      for (const [key, page] of Object.entries(snapshot.rowPages)) {
        if (!rowPageBelongsToTable(key, tableId) || key === preserveKey) {
          rowPages[key] = page;
          if (key === preserveKey) rowPageLru.touch(key);
        } else {
          rowPageLru.remove(key);
        }
      }
      publish({ ...snapshot, rowPages: Object.freeze(rowPages) });
    },
    setCapabilities(capabilities) {
      publish({ ...snapshot, capabilities });
    },
    setTables(tables, status) {
      const next = status === 'all'
        ? [...tables]
        : [
            ...snapshot.tables.filter((table) => table.status !== status),
            ...tables,
          ];
      publish({
        ...snapshot,
        tables: Object.freeze(sortTables(dedupeTables(next))),
      });
    },
    upsertTable(table) {
      publish({
        ...snapshot,
        tables: Object.freeze(sortTables(dedupeTables([
          ...snapshot.tables,
          tableSummary(table),
        ]))),
        tableDetails: Object.freeze({
          ...snapshot.tableDetails,
          [table.tableId]: table,
        }),
      });
    },
    setRowPage(tableId, key, page, expectedEpoch) {
      if ((rowEpochs.get(tableId) ?? 0) !== expectedEpoch) {
        const error = new Error('Discarded a stale Data Studio row page.');
        error.name = 'AbortError';
        throw error;
      }
      const frozenPage = freezeRowPage(page);
      const admission = rowPageLru.record(key, approximateRowPageBytes(key, frozenPage));
      if (!admission.accepted) {
        throw new TypeError('Data Studio row page exceeds the browser cache byte budget.');
      }
      const rowPages: Record<string, DataStudioRowPage> = {
        ...snapshot.rowPages,
        [key]: frozenPage,
      };
      for (const evictedKey of admission.evictedKeys) delete rowPages[evictedKey];
      publish({ ...snapshot, rowPages: Object.freeze(rowPages) });
    },
  };
}

function sortTables(tables: DataStudioTableSummary[]): DataStudioTableSummary[] {
  return tables.sort((left, right) => left.name.localeCompare(right.name));
}

function dedupeTables(tables: readonly DataStudioTableSummary[]): DataStudioTableSummary[] {
  const byId = new Map<string, DataStudioTableSummary>();
  for (const table of tables) byId.set(table.tableId, table);
  return [...byId.values()];
}

function freezeRowPage(page: DataStudioRowPage): DataStudioRowPage {
  return Object.freeze({ ...page, rows: Object.freeze([...page.rows]) });
}

function approximateRowPageBytes(key: string, page: DataStudioRowPage): number {
  // Parsed pages are closed, normalized JSON data. UTF-16 code units provide
  // a deterministic browser-safe upper-ish approximation without Node APIs.
  return ((key.length + JSON.stringify(page).length) * 2) + 64;
}

function rowPageBelongsToTable(key: string, tableId: string): boolean {
  return key.startsWith(`[${JSON.stringify(tableId)},`);
}
