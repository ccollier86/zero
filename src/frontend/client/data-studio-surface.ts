/**
 * data-studio-surface.ts
 *
 * Authenticated HTTP method binding for the browser Data Studio SDK surface.
 * Parsing, cache mechanics, and mutation semantics are delegated to SRP peers.
 */

import type {
  DataStudioTableStatus,
} from '../../data-studio/data-studio-contracts';
import type { FetchInit } from './sdk';
import type { DataStudioReconciliationEvent } from './data-studio-sync';
import type {
  DataStudioMutationOptions,
  DataStudioRequestOptions,
  DataStudioRowQuery,
  DataStudioSchemaVersionQuery,
  DataStudioSdkSurface,
  DataStudioSdkSurfaceOptions,
  DataStudioTableCreate,
  DataStudioTableUpdate,
} from './data-studio-client-types';
import { createDataStudioCacheStore } from './data-studio-cache';
import {
  createDataStudioOperationId,
  mutate,
  verifyMutationResponse,
} from './data-studio-mutation';
import { dataStudioRowQueryKey, rowQueryString } from './data-studio-query';
import {
  invalidResponse,
  parseCapabilities,
  parseRow,
  parseRowPage,
  parseSchemaVersion,
  parseTable,
  parseTableSummary,
  responseArray,
  responseRecord,
} from './data-studio-response';

export const DATA_STUDIO_API_PREFIX = '/api/_zero/data-studio';

type DataStudioFetch = <T = unknown>(path: string, init?: FetchInit) => Promise<T>;

/** Bind Data Studio's portable HTTP contract to Zero's authenticated fetch. */
export function createDataStudioSdkSurface(
  fetch: DataStudioFetch,
  options: DataStudioSdkSurfaceOptions = {},
): DataStudioSdkSurface {
  const store = createDataStudioCacheStore();
  const scoped = async <T, R>(
    request: () => Promise<T>,
    consume: (result: T) => R,
  ): Promise<R> => {
    const scopeRevision = store.captureScope();
    const result = await request();
    return store.withScope(scopeRevision, () => consume(result));
  };
  const scopedMutation = async <R,>(
    path: string,
    method: string,
    input: Readonly<object>,
    requestOptions: DataStudioMutationOptions,
    consume: (result: unknown) => R,
  ): Promise<R> => {
    const operationId = requestOptions.operationId ?? createDataStudioOperationId();
    return scoped(
      () => mutate<unknown>(fetch, path, method, input, { ...requestOptions, operationId }),
      (result) => verifyMutationResponse(operationId, () => consume(result)),
    );
  };

  return Object.freeze({
    cache: Object.freeze({
      getSnapshot: store.getSnapshot,
      getRowPage: store.getRowPage,
      subscribe: store.subscribe,
    }),
    setScope: store.setScope,
    clear: store.clear,
    subscribeReconciliation(callback: (event: DataStudioReconciliationEvent) => void) {
      return options.subscribeReconciliation?.(callback) ?? (() => {});
    },
    invalidateRows(tableId: string, preserveQuery?: DataStudioRowQuery) {
      store.invalidateRowPages(
        tableId,
        preserveQuery ? dataStudioRowQueryKey(tableId, preserveQuery) : undefined,
      );
    },

    async getCapabilities(requestOptions: DataStudioRequestOptions = {}) {
      return scoped(() => fetch<unknown>(
        `${DATA_STUDIO_API_PREFIX}/capabilities`,
        { method: 'GET', signal: requestOptions.signal },
      ), (result) => {
        const capabilities = parseCapabilities(result);
        store.setCapabilities(capabilities);
        return capabilities;
      });
    },

    async listTables(
      status: DataStudioTableStatus | 'all' = 'active',
      requestOptions: DataStudioRequestOptions = {},
    ) {
      const params = new URLSearchParams({ status });
      return scoped(() => fetch<unknown>(
        `${DATA_STUDIO_API_PREFIX}/tables?${params.toString()}`,
        { method: 'GET', signal: requestOptions.signal },
      ), (result) => {
        const record = responseRecord(result, 'table catalog');
        const tables = responseArray(record.tables, 'table catalog').map(parseTableSummary);
        store.setTables(tables, status);
        return tables;
      });
    },

    async getTable(tableId: string, requestOptions: DataStudioRequestOptions = {}) {
      return scoped(() => fetch<unknown>(
        `${DATA_STUDIO_API_PREFIX}/tables/${encodePathSegment(tableId)}`,
        { method: 'GET', signal: requestOptions.signal },
      ), (result) => {
        const table = parseTable(responseRecord(result, 'get table').table);
        if (table.tableId !== tableId) throw invalidResponse('get table');
        store.upsertTable(table);
        return table;
      });
    },

    async createTable(input: DataStudioTableCreate, requestOptions: DataStudioMutationOptions = {}) {
      return scopedMutation(`${DATA_STUDIO_API_PREFIX}/tables`, 'POST', input, requestOptions, (result) => {
        const table = parseTable(responseRecord(result, 'create table').table);
        store.upsertTable(table);
        return table;
      });
    },

    async updateTable(
      tableId: string,
      input: DataStudioTableUpdate,
      requestOptions: DataStudioMutationOptions = {},
    ) {
      return scopedMutation(
        `${DATA_STUDIO_API_PREFIX}/tables/${encodePathSegment(tableId)}`,
        'PATCH',
        input,
        requestOptions,
        (result) => {
          const table = parseTable(responseRecord(result, 'update table').table);
          if (table.tableId !== tableId) throw invalidResponse('update table');
          store.upsertTable(table);
          return table;
        },
      );
    },

    async setTableStatus(
      tableId: string,
      expectedRevision: number,
      status: DataStudioTableStatus,
      requestOptions: DataStudioMutationOptions = {},
    ) {
      return scopedMutation(
        `${DATA_STUDIO_API_PREFIX}/tables/${encodePathSegment(tableId)}/status`,
        'POST',
        { expectedRevision, status },
        requestOptions,
        (result) => {
          const table = parseTable(responseRecord(result, 'table status').table);
          if (table.tableId !== tableId) throw invalidResponse('table status');
          store.upsertTable(table);
          return table;
        },
      );
    },

    async listRows(
      tableId: string,
      query: DataStudioRowQuery = {},
      requestOptions: DataStudioRequestOptions = {},
    ) {
      const queryKey = dataStudioRowQueryKey(tableId, query);
      const rowEpoch = store.captureRowEpoch(tableId);
      return scoped(() => fetch<unknown>(
        `${DATA_STUDIO_API_PREFIX}/tables/${encodePathSegment(tableId)}/rows${rowQueryString(query)}`,
        { method: 'GET', signal: requestOptions.signal },
      ), (result) => {
        const schema = store.getSnapshot().tableDetails[tableId]?.schema;
        const page = parseRowPage(result, schema);
        const requestedOffset = query.offset ?? 0;
        if (page.offset !== requestedOffset
          || (query.limit !== undefined && page.limit !== query.limit)
          || page.rows.some((row) => row.tableId !== tableId)) {
          throw invalidResponse('row page');
        }
        store.setRowPage(tableId, queryKey, page, rowEpoch);
        return page;
      });
    },

    async createRow(
      tableId: string,
      values: Readonly<Record<string, unknown>>,
      requestOptions: DataStudioMutationOptions = {},
    ) {
      return scopedMutation(
        `${DATA_STUDIO_API_PREFIX}/tables/${encodePathSegment(tableId)}/rows`,
        'POST',
        { values },
        requestOptions,
        (result) => {
          const schema = store.getSnapshot().tableDetails[tableId]?.schema;
          const row = parseRow(responseRecord(result, 'create row').row, schema);
          if (row.tableId !== tableId) throw invalidResponse('create row');
          // A create can change membership, ordering, totals, and pagination for
          // every cached query over this table. The mutation response alone is
          // not enough to repair those query-specific projections safely.
          store.invalidateRowPages(tableId);
          return row;
        },
      );
    },

    async replaceRow(
      tableId: string,
      rowId: string,
      expectedRevision: number,
      values: Readonly<Record<string, unknown>>,
      requestOptions: DataStudioMutationOptions = {},
    ) {
      return scopedMutation(
        `${DATA_STUDIO_API_PREFIX}/tables/${encodePathSegment(tableId)}/rows/${encodePathSegment(rowId)}`,
        'PUT',
        { expectedRevision, values },
        requestOptions,
        (result) => {
          const schema = store.getSnapshot().tableDetails[tableId]?.schema;
          const row = parseRow(responseRecord(result, 'replace row').row, schema);
          if (row.tableId !== tableId || row.rowId !== rowId) {
            throw invalidResponse('replace row');
          }
          // Replacing a sort/filter/search field can move this row between or
          // out of any cached page. Evict every table page instead of exposing
          // a locally patched projection with stale membership or ordering.
          store.invalidateRowPages(tableId);
          return row;
        },
      );
    },

    async deleteRow(
      tableId: string,
      rowId: string,
      expectedRevision: number,
      requestOptions: DataStudioMutationOptions = {},
    ) {
      return scopedMutation(
        `${DATA_STUDIO_API_PREFIX}/tables/${encodePathSegment(tableId)}/rows/${encodePathSegment(rowId)}`,
        'DELETE',
        { expectedRevision },
        requestOptions,
        (response) => {
          const result = responseRecord(response, 'delete row');
          if (result.deleted !== true || result.rowId !== rowId) throw invalidResponse('delete row');
          // Removing one visible row does not identify the row which should
          // refill a paginated page, so totals and page boundaries require a
          // fresh server read.
          store.invalidateRowPages(tableId);
          return Object.freeze({ deleted: true as const, rowId: result.rowId });
        },
      );
    },

    async listSchemaVersions(
      tableId: string,
      query: DataStudioSchemaVersionQuery = {},
      requestOptions: DataStudioRequestOptions = {},
    ) {
      const suffix = schemaVersionQueryString(query);
      return scoped(() => fetch<unknown>(
        `${DATA_STUDIO_API_PREFIX}/tables/${encodePathSegment(tableId)}/schema-versions${suffix}`,
        { method: 'GET', signal: requestOptions.signal },
      ), (result) => {
        const record = responseRecord(result, 'schema versions');
        const versions = responseArray(record.versions, 'schema versions').map(parseSchemaVersion);
        if (versions.some((version) => version.tableId !== tableId)) {
          throw invalidResponse('schema versions');
        }
        return Object.freeze(versions);
      });
    },
  });
}

function schemaVersionQueryString(query: DataStudioSchemaVersionQuery): string {
  if (query.limit !== undefined
    && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 10)) {
    throw new TypeError('Data Studio schema history limit must be between 1 and 10.');
  }
  if (query.beforeRevision !== undefined
    && (!Number.isSafeInteger(query.beforeRevision) || query.beforeRevision < 1)) {
    throw new TypeError('Data Studio schema history revision must be a positive integer.');
  }
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.beforeRevision !== undefined) params.set('beforeRevision', String(query.beforeRevision));
  return params.size > 0 ? `?${params.toString()}` : '';
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
