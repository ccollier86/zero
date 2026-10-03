import { describe, expect, test } from 'bun:test';
import {
  DATA_STUDIO_API_PREFIX,
  DataStudioMutationError,
  createDataStudioSdkSurface,
  dataStudioCellValue,
  dataStudioRowQueryKey,
  dataStudioRowValuesByKey,
  type DataStudioCapabilities,
  type DataStudioReconciliationEvent,
  type DataStudioRow,
  type DataStudioTable,
} from './data-studio-client';
import type { FetchInit } from './sdk';
import { DATA_STUDIO_ROW_PAGE_CACHE_MAX_ENTRIES } from './data-studio-row-page-lru';

const capabilities: DataStudioCapabilities = {
  enabled: true,
  scope: 'organization',
  permissions: { read: true, write: true, manage: true },
  limits: {
    maxTables: 100,
    maxRowsPerTable: 100_000,
    maxColumns: 128,
    maxPageSize: 100,
    maxRowBytes: 262_144,
  },
};

const table: DataStudioTable = {
  tableId: 'table/a',
  key: 'contacts',
  name: 'Contacts',
  description: null,
  status: 'active',
  schema: {
    version: 1,
    columns: [{
      columnId: 'column_name',
      key: 'name',
      label: 'Name',
      type: 'text',
      required: true,
    }],
  },
  schemaRevision: 1,
  revision: 1,
  rowCount: 1,
  createdAt: 1,
  updatedAt: 1,
};

const row: DataStudioRow = {
  rowId: 'row/1',
  tableId: table.tableId,
  schemaRevision: 1,
  revision: 2,
  values: { column_name: 'Ada' },
  createdAt: 1,
  updatedAt: 2,
};

const { schema: _tableSchema, ...tableSummary } = table;

describe('Data Studio browser transport', () => {
  test('exposes the SDK-installed read-only reconciliation signal', () => {
    let listener: ((event: DataStudioReconciliationEvent) => void) | undefined;
    let cleaned = false;
    const studio = createDataStudioSdkSurface(async () => undefined as never, {
      subscribeReconciliation(callback) {
        listener = callback;
        return () => { cleaned = true; };
      },
    });
    const events: unknown[] = [];
    const unsubscribe = studio.subscribeReconciliation((event) => events.push(event));

    listener?.({ kind: 'catalog', tableIds: ['table/a'] });
    expect(events).toEqual([{ kind: 'catalog', tableIds: ['table/a'] }]);
    unsubscribe();
    expect(cleaned).toBe(true);
  });

  test('uses the authenticated route contract and hydrates reactive cache pages', async () => {
    const calls: Array<{ path: string; init?: FetchInit }> = [];
    const responses: unknown[] = [
      capabilities,
      { tables: [tableSummary] },
      { table },
      { rows: [row], total: 1, limit: 25, offset: 0, nextOffset: null },
    ];
    const studio = createDataStudioSdkSurface(async (path, init) => {
      calls.push({ path, init });
      return responses.shift() as never;
    });
    studio.setScope('organization:acme');

    await studio.getCapabilities();
    await studio.listTables('active');
    await studio.getTable(table.tableId);
    await studio.listRows(table.tableId, {
      limit: 25,
      offset: 0,
      search: 'Ada Lovelace',
      filters: [{ columnKey: 'name', operator: 'contains', value: 'Ada' }],
      sortColumnId: 'column_name',
      sortDirection: 'asc',
    });

    expect(calls.map((call) => [call.path, call.init?.method])).toEqual([
      [`${DATA_STUDIO_API_PREFIX}/capabilities`, 'GET'],
      [`${DATA_STUDIO_API_PREFIX}/tables?status=active`, 'GET'],
      [`${DATA_STUDIO_API_PREFIX}/tables/table%2Fa`, 'GET'],
      [
        `${DATA_STUDIO_API_PREFIX}/tables/table%2Fa/rows?limit=25&offset=0&search=Ada+Lovelace&filter=%5B%7B%22columnKey%22%3A%22name%22%2C%22operator%22%3A%22contains%22%2C%22value%22%3A%22Ada%22%7D%5D&sortColumnId=column_name&sortDirection=asc`,
        'GET',
      ],
    ]);
    const key = dataStudioRowQueryKey(table.tableId, {
      limit: 25,
      offset: 0,
      search: 'Ada Lovelace',
      filters: [{ columnKey: 'name', operator: 'contains', value: 'Ada' }],
      sortColumnId: 'column_name',
      sortDirection: 'asc',
    });
    expect(studio.cache.getSnapshot()).toMatchObject({
      scopeKey: 'organization:acme',
      capabilities,
      tables: [tableSummary],
      tableDetails: { [table.tableId]: table },
      rowPages: { [key]: { rows: [row], total: 1 } },
    });
  });

  test('sends one explicit operation id in the JSON body', async () => {
    const requests: Array<{ path: string; init?: FetchInit }> = [];
    const studio = createDataStudioSdkSurface(async (path, init) => {
      requests.push({ path, init });
      return { row } as never;
    });
    await studio.replaceRow(table.tableId, row.rowId, row.revision, { name: 'Grace' }, {
      operationId: 'operation-stable',
    });

    expect(requests[0]).toEqual({
      path: `${DATA_STUDIO_API_PREFIX}/tables/table%2Fa/rows/row%2F1`,
      init: {
        method: 'PUT',
        signal: undefined,
        body: {
          operationId: 'operation-stable',
          expectedRevision: 2,
          values: { name: 'Grace' },
        },
      },
    });
  });

  test('invalidates every filtered and sorted row page after create', async () => {
    const secondRow: DataStudioRow = {
      ...row,
      rowId: 'row/2',
      revision: 1,
      values: { column_name: 'Bea' },
      updatedAt: 1,
    };
    const createdRow: DataStudioRow = {
      ...row,
      rowId: 'row/3',
      revision: 1,
      values: { column_name: 'Aaron' },
      updatedAt: 3,
    };
    const filteredQuery = {
      limit: 25,
      offset: 0,
      filters: [{ columnKey: 'name', operator: 'contains', value: 'Ada' }],
    } as const;
    const sortedQuery = {
      limit: 25,
      offset: 0,
      sortColumnId: 'column_name',
      sortDirection: 'asc',
    } as const;
    const responses: unknown[] = [
      { table },
      { rows: [row], total: 1, limit: 25, offset: 0, nextOffset: null },
      { rows: [row, secondRow], total: 2, limit: 25, offset: 0, nextOffset: null },
      { row: createdRow },
    ];
    const studio = createDataStudioSdkSurface(async () => responses.shift() as never);
    studio.setScope('organization:cache-create');
    await studio.getTable(table.tableId);
    await studio.listRows(table.tableId, filteredQuery);
    await studio.listRows(table.tableId, sortedQuery);
    expect(Object.keys(studio.cache.getSnapshot().rowPages)).toHaveLength(2);

    await expect(studio.createRow(table.tableId, { name: 'Aaron' }, {
      operationId: 'cache-create-row',
    })).resolves.toEqual(createdRow);

    expect(studio.cache.getSnapshot().rowPages).toEqual({});
    expect(studio.cache.getRowPage(dataStudioRowQueryKey(table.tableId, filteredQuery)))
      .toBeUndefined();
    expect(studio.cache.getRowPage(dataStudioRowQueryKey(table.tableId, sortedQuery)))
      .toBeUndefined();
  });

  test('invalidates filtered and sorted pages after replace changes membership and order', async () => {
    const secondRow: DataStudioRow = {
      ...row,
      rowId: 'row/2',
      revision: 1,
      values: { column_name: 'Bea' },
      updatedAt: 1,
    };
    const replacedRow: DataStudioRow = {
      ...row,
      revision: row.revision + 1,
      values: { column_name: 'Grace' },
      updatedAt: row.updatedAt + 1,
    };
    const filteredQuery = {
      limit: 25,
      offset: 0,
      filters: [{ columnKey: 'name', operator: 'contains', value: 'Ada' }],
    } as const;
    const sortedQuery = {
      limit: 25,
      offset: 0,
      sortColumnId: 'column_name',
      sortDirection: 'asc',
    } as const;
    const responses: unknown[] = [
      { table },
      { rows: [row], total: 1, limit: 25, offset: 0, nextOffset: null },
      { rows: [row, secondRow], total: 2, limit: 25, offset: 0, nextOffset: null },
      { row: replacedRow },
    ];
    const studio = createDataStudioSdkSurface(async () => responses.shift() as never);
    studio.setScope('organization:cache-replace');
    await studio.getTable(table.tableId);
    await studio.listRows(table.tableId, filteredQuery);
    await studio.listRows(table.tableId, sortedQuery);

    await expect(studio.replaceRow(
      table.tableId,
      row.rowId,
      row.revision,
      { name: 'Grace' },
      { operationId: 'cache-replace-row' },
    )).resolves.toEqual(replacedRow);

    expect(studio.cache.getSnapshot().rowPages).toEqual({});
    expect(studio.cache.getRowPage(dataStudioRowQueryKey(table.tableId, filteredQuery)))
      .toBeUndefined();
    expect(studio.cache.getRowPage(dataStudioRowQueryKey(table.tableId, sortedQuery)))
      .toBeUndefined();
  });

  test('invalidates paginated row pages after delete instead of publishing stale totals', async () => {
    const secondRow: DataStudioRow = {
      ...row,
      rowId: 'row/2',
      revision: 1,
      values: { column_name: 'Bea' },
      updatedAt: 1,
    };
    const firstQuery = { limit: 1, offset: 0 } as const;
    const secondQuery = { limit: 1, offset: 1 } as const;
    const responses: unknown[] = [
      { table },
      { rows: [row], total: 2, limit: 1, offset: 0, nextOffset: 1 },
      { rows: [secondRow], total: 2, limit: 1, offset: 1, nextOffset: null },
      { deleted: true, rowId: row.rowId },
    ];
    const studio = createDataStudioSdkSurface(async () => responses.shift() as never);
    studio.setScope('organization:cache-delete');
    await studio.getTable(table.tableId);
    await studio.listRows(table.tableId, firstQuery);
    await studio.listRows(table.tableId, secondQuery);

    await expect(studio.deleteRow(table.tableId, row.rowId, row.revision, {
      operationId: 'cache-delete-row',
    })).resolves.toEqual({ deleted: true, rowId: row.rowId });

    expect(studio.cache.getSnapshot().rowPages).toEqual({});
    expect(studio.cache.getRowPage(dataStudioRowQueryKey(table.tableId, firstQuery)))
      .toBeUndefined();
    expect(studio.cache.getRowPage(dataStudioRowQueryKey(table.tableId, secondQuery)))
      .toBeUndefined();
  });

  test('retains the exact operation id on an ambiguous transport failure', async () => {
    const studio = createDataStudioSdkSurface(async () => {
      throw new TypeError('connection closed');
    });

    const failure = await studio.createRow(table.tableId, { name: 'Ada' }, {
      operationId: 'operation-retry-me',
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataStudioMutationError);
    expect(failure).toMatchObject({
      operationId: 'operation-retry-me',
      status: null,
      requiresSameIdempotencyKey: true,
    });
  });

  test('retains the operation id when a committed response cannot be verified', async () => {
    const studio = createDataStudioSdkSurface(async () => ({
      row: { ...row, revision: 0 },
    }) as never);

    const failure = await studio.createRow(table.tableId, { name: 'Ada' }, {
      operationId: 'operation-response-retry',
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataStudioMutationError);
    expect(failure).toMatchObject({
      operationId: 'operation-response-retry',
      requiresSameIdempotencyKey: true,
    });
  });

  test('does not let excess input fields replace the tracked operation id', async () => {
    const requests: FetchInit[] = [];
    const studio = createDataStudioSdkSurface(async (_path, init) => {
      if (init) requests.push(init);
      return { table } as never;
    });
    const input = {
      name: table.name,
      key: table.key,
      description: table.description,
      schema: table.schema,
      operationId: 'hostile-excess-field',
    } as never;

    await studio.createTable(input, { operationId: 'tracked-operation' });

    expect(requests[0]?.body).toMatchObject({ operationId: 'tracked-operation' });
  });

  test('clears tables and rows synchronously across scope replacement', async () => {
    const responses: unknown[] = [{ tables: [tableSummary] }];
    const studio = createDataStudioSdkSurface(async () => responses.shift() as never);
    studio.setScope('organization:a');
    await studio.listTables();
    expect(studio.cache.getSnapshot().tables).toHaveLength(1);

    studio.setScope('organization:b');
    expect(studio.cache.getSnapshot()).toMatchObject({
      scopeKey: 'organization:b',
      tables: [],
      rowPages: {},
    });
  });

  test('rejects malformed server projections before they reach the cache', async () => {
    const studio = createDataStudioSdkSurface(async () => ({
      tables: [{ ...table, revision: 0 }],
    }) as never);
    studio.setScope('organization:a');

    await expect(studio.listTables()).rejects.toThrow('Invalid Data Studio table response.');
    expect(studio.cache.getSnapshot().tables).toEqual([]);
  });

  test('does not materialize schema defaults while parsing older stored rows', async () => {
    const tableWithDefault: DataStudioTable = {
      ...table,
      schema: {
        version: 1,
        columns: [{
          ...table.schema.columns[0]!,
          required: false,
          defaultValue: 'New contact',
        }],
      },
    };
    const oldRow: DataStudioRow = { ...row, values: {} };
    const responses: unknown[] = [
      { tables: [{ ...tableSummary, revision: tableWithDefault.revision }] },
      { table: tableWithDefault },
      { rows: [oldRow], total: 1, limit: 50, offset: 0, nextOffset: null },
    ];
    const studio = createDataStudioSdkSurface(async () => responses.shift() as never);
    studio.setScope('organization:a');
    await studio.listTables();
    await studio.getTable(table.tableId);
    const page = await studio.listRows(table.tableId, { limit: 50, offset: 0 });

    expect(page.rows[0]?.values).toEqual({});
    expect(Object.hasOwn(page.rows[0]!.values, 'column_name')).toBe(false);
  });

  test('discards an old scope response without contaminating the replacement cache', async () => {
    let resolveCatalog: ((value: unknown) => void) | undefined;
    const studio = createDataStudioSdkSurface(() => new Promise((resolve) => {
      resolveCatalog = resolve;
    }) as never);
    studio.setScope('organization:a');
    const pending = studio.listTables();
    resolveCatalog?.({ tables: [tableSummary] });
    studio.setScope('organization:b');

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(studio.cache.getSnapshot()).toMatchObject({
      scopeKey: 'organization:b',
      tables: [],
      tableDetails: {},
    });
  });

  test('uses only the server continuation for byte-budgeted short pages', async () => {
    const studio = createDataStudioSdkSurface(async () => ({
      rows: [row],
      total: 100,
      limit: 50,
      offset: 0,
      nextOffset: 1,
    }) as never);
    const page = await studio.listRows(table.tableId, { limit: 50, offset: 0 });

    expect(page.rows).toHaveLength(1);
    expect(page.nextOffset).toBe(1);
  });

  test('keeps concurrent query pages independent and rejects pre-invalidation responses', async () => {
    const secondRow: DataStudioRow = { ...row, rowId: 'row/2', revision: 1 };
    let resolveStale: ((value: unknown) => void) | undefined;
    const responses: unknown[] = [
      { rows: [row], total: 2, limit: 1, offset: 0, nextOffset: 1 },
      { rows: [secondRow], total: 2, limit: 1, offset: 1, nextOffset: null },
    ];
    const studio = createDataStudioSdkSurface(async () => {
      const response = responses.shift();
      if (response) return response as never;
      return new Promise((resolve) => { resolveStale = resolve; }) as never;
    });
    const firstQuery = { limit: 1, offset: 0 } as const;
    const secondQuery = { limit: 1, offset: 1 } as const;

    await studio.listRows(table.tableId, firstQuery);
    await studio.listRows(table.tableId, secondQuery);
    expect(Object.keys(studio.cache.getSnapshot().rowPages)).toHaveLength(2);

    const stale = studio.listRows(table.tableId, firstQuery);
    studio.invalidateRows(table.tableId, secondQuery);
    resolveStale?.({ rows: [row], total: 2, limit: 1, offset: 0, nextOffset: 1 });

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    expect(studio.cache.getSnapshot().rowPages).toEqual({
      [dataStudioRowQueryKey(table.tableId, secondQuery)]: {
        rows: [secondRow],
        total: 2,
        limit: 1,
        offset: 1,
        nextOffset: null,
      },
    });
  });

  test('evicts least-recent row pages while keeping the just-returned response readable', async () => {
    const studio = createDataStudioSdkSurface(async (path) => {
      const url = new URL(path, 'https://zero.invalid');
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return {
        rows: [],
        total: 100,
        limit: 1,
        offset,
        nextOffset: offset + 1,
      } as never;
    });
    studio.setScope('organization:lru');

    for (let offset = 0; offset < DATA_STUDIO_ROW_PAGE_CACHE_MAX_ENTRIES; offset += 1) {
      await studio.listRows(table.tableId, { limit: 1, offset });
    }
    const firstKey = dataStudioRowQueryKey(table.tableId, { limit: 1, offset: 0 });
    const secondKey = dataStudioRowQueryKey(table.tableId, { limit: 1, offset: 1 });
    expect(studio.cache.getRowPage(firstKey)).toBeDefined();

    const activeQuery = { limit: 1, offset: DATA_STUDIO_ROW_PAGE_CACHE_MAX_ENTRIES };
    const activeKey = dataStudioRowQueryKey(table.tableId, activeQuery);
    let observedDuringPublish: unknown;
    const unsubscribe = studio.cache.subscribe(() => {
      observedDuringPublish = studio.cache.getRowPage(activeKey);
    });
    const returned = await studio.listRows(table.tableId, activeQuery);
    unsubscribe();

    expect(Object.keys(studio.cache.getSnapshot().rowPages)).toHaveLength(
      DATA_STUDIO_ROW_PAGE_CACHE_MAX_ENTRIES,
    );
    expect(studio.cache.getRowPage(firstKey)).toBeDefined();
    expect(studio.cache.getRowPage(secondKey)).toBeUndefined();
    expect(studio.cache.getRowPage(activeKey)).toEqual(returned);
    expect(observedDuringPublish).toEqual(returned);
  });

  test('evicts row pages by approximate bytes before the entry ceiling', async () => {
    const text = 'x'.repeat(62_000);
    const values = {
      column_a: text,
      column_b: text,
      column_c: text,
      column_d: text,
    };
    const studio = createDataStudioSdkSurface(async (path) => {
      const url = new URL(path, 'https://zero.invalid');
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return {
        rows: [0, 1].map((index) => ({
          ...row,
          rowId: `large-${offset + index}`,
          values,
        })),
        total: 100,
        limit: 2,
        offset,
        nextOffset: offset + 2,
      } as never;
    });
    studio.setScope('organization:bytes');

    for (const offset of [0, 2, 4, 6]) {
      await studio.listRows(table.tableId, { limit: 2, offset });
    }

    const cachedKeys = Object.keys(studio.cache.getSnapshot().rowPages);
    expect(cachedKeys.length).toBeLessThan(4);
    expect(studio.cache.getRowPage(
      dataStudioRowQueryKey(table.tableId, { limit: 2, offset: 0 }),
    )).toBeUndefined();
    expect(studio.cache.getRowPage(
      dataStudioRowQueryKey(table.tableId, { limit: 2, offset: 6 }),
    )).toBeDefined();
  });

  test('never reuses row-page recency or values across authorization scopes', async () => {
    const studio = createDataStudioSdkSurface(async (path) => {
      const url = new URL(path, 'https://zero.invalid');
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return {
        rows: [], total: 10, limit: 1, offset, nextOffset: offset + 1,
      } as never;
    });
    const scopeAQuery = { limit: 1, offset: 0 };
    const scopeBQuery = { limit: 1, offset: 1 };
    const scopeAKey = dataStudioRowQueryKey(table.tableId, scopeAQuery);
    const scopeBKey = dataStudioRowQueryKey(table.tableId, scopeBQuery);

    studio.setScope('organization:a');
    await studio.listRows(table.tableId, scopeAQuery);
    expect(studio.cache.getRowPage(scopeAKey)).toBeDefined();

    studio.setScope('organization:b');
    expect(studio.cache.getRowPage(scopeAKey)).toBeUndefined();
    await studio.listRows(table.tableId, scopeBQuery);
    expect(studio.cache.getRowPage(scopeBKey)).toBeDefined();

    studio.setScope('organization:a');
    expect(studio.cache.getSnapshot().rowPages).toEqual({});
    expect(studio.cache.getRowPage(scopeAKey)).toBeUndefined();
    expect(studio.cache.getRowPage(scopeBKey)).toBeUndefined();
  });
});

describe('Data Studio row projection', () => {
  test('maps stable column ids to public column keys without collapsing null', () => {
    const withNull = { ...row, values: { column_name: null } };
    expect(dataStudioCellValue(withNull, 'column_name')).toBeNull();
    expect(dataStudioCellValue(withNull, 'missing')).toBeUndefined();
    expect(dataStudioRowValuesByKey(withNull, table.schema.columns)).toEqual({ name: null });
  });
});
