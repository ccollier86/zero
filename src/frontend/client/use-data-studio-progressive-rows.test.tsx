/** Synthetic null-render hook checks for progressive reads, scope fences and recovery. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDataStudioProgressiveRows } from './use-data-studio-progressive-rows';
import type { DataStudioRowPage, DataStudioRowQuery, DataStudioSdkSurface, DataStudioTable } from './data-studio-client';
import { configureFrontendObservability } from './observability';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';

const roots = new Set<Root>();
let restore: () => void;
beforeEach(() => { restore = installMinimalHookDom(); configureFrontendObservability({ http: false, console: false }); });
afterEach(async () => { for (const root of roots) await act(async () => root.unmount()); roots.clear(); restore(); });

test('loads bounded batches, coalesces duplicate load-more and retains selected identity', async () => {
  const f = await fixture();
  expect(f.requests).toHaveLength(1);
  await f.resolve(0, page(0, ['a', 'b']));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'b']);
  await act(async () => f.select('b'));
  let first!: Promise<void>, second!: Promise<void>;
  await act(async () => { first = f.current.loadMoreRows(); second = f.current.loadMoreRows(); });
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]!.query).toMatchObject({ offset: 2, limit: 2 });
  await f.resolve(1, page(2, ['c', 'd']));
  await Promise.all([first, second]);
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'b', 'c', 'd']);
  expect(f.current.selectedRow?.rowId).toBe('b');
  expect(f.current.hasMoreRows).toBe(false);
});

test('changed snapshots retain the previous window and require explicit coherent refresh', async () => {
  const f = await fixture();
  await f.resolve(0, page(0, ['a', 'b']));
  await act(async () => { void f.current.loadMoreRows(); });
  await f.resolve(1, page(2, ['c', 'd'], 2));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'b']);
  expect(f.current.rowsNeedRefresh).toBe(true);
  await act(async () => { void f.current.loadRows(); });
  await f.resolve(2, page(0, ['new', 'a'], 2, 5));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['new', 'a']);
  expect(f.current.rowsNeedRefresh).toBe(false);
});

test('reactive refresh reconstructs the loaded prefix atomically with bounded requests', async () => {
  const f = await fixture();
  await f.resolve(0, page(0, ['a', 'b']));
  await act(async () => { void f.current.loadMoreRows(); });
  await f.resolve(1, page(2, ['c', 'd']));
  await act(async () => { void f.current.loadRows(); });
  await f.resolve(2, page(0, ['a', 'changed'], 2));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'b', 'c', 'd']);
  await f.resolve(3, page(2, ['c', 'd'], 2));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'changed', 'c', 'd']);
  expect(f.requests.slice(2).map(r => r.query.limit)).toEqual([2, 2]);
});

test('an organization switch clears rows immediately and rejects late old results', async () => {
  const f = await fixture();
  await f.resolve(0, page(0, ['old-a', 'old-b']));
  await act(async () => { void f.current.loadMoreRows(); });
  await f.change({ scope: 'organization:two' });
  expect(f.current.rows).toEqual([]);
  expect(f.requests[1]!.signal?.aborted).toBe(true);
  await f.resolve(1, page(2, ['old-c', 'old-d']));
  expect(f.current.rows).toEqual([]);
  await f.resolve(2, page(0, ['new-a', 'new-b']));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['new-a', 'new-b']);
});

test('query replacement aborts and ignores superseded results even when transport completes', async () => {
  const f = await fixture();
  await f.change({ query: { limit: 2, search: 'new' } });
  await f.resolve(1, page(0, ['new-a', 'new-b']));
  await f.resolve(0, page(0, ['stale-a', 'stale-b']));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['new-a', 'new-b']);
});

test('read failures preserve the window and retry the exact continuation', async () => {
  const f = await fixture();
  await f.resolve(0, page(0, ['a', 'b']));
  await act(async () => { void f.current.loadMoreRows(); });
  await act(async () => f.requests[1]!.reject(new Error('synthetic offline')));
  expect(f.current.loadMoreError).toBeInstanceOf(Error);
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'b']);
  await act(async () => { void f.current.loadMoreRows(); });
  expect(f.requests[2]!.query.offset).toBe(2);
  await f.resolve(2, page(2, ['c', 'd']));
  expect(f.current.loadMoreError).toBeNull();
});

test('unmount aborts pending reads and retained callbacks cannot start more work', async () => {
  const f = await fixture();
  const retained = f.current;
  await act(async () => f.root.unmount()); roots.delete(f.root);
  expect(f.requests[0]!.signal?.aborted).toBe(true);
  await retained.loadMoreRows(); await retained.loadRows();
  await f.resolve(0, page(0, ['late-a', 'late-b']));
  expect(f.requests).toHaveLength(1);
});

test('schema and access changes retire the previous result window', async () => {
  const f = await fixture();
  await f.resolve(0, page(0, ['a', 'b']));
  await f.change({ table: { ...TABLE, schemaRevision: 2 } });
  expect(f.current.rows).toEqual([]);
  await f.resolve(1, page(0, ['new-a', 'new-b']));
  await f.change({ canRead: false });
  expect(f.current.rows).toEqual([]);
  await f.current.loadMoreRows();
  expect(f.requests).toHaveLength(2);
});

test('a replacement surface retires old rows even when scope and query match', async () => {
  const f = await fixture();
  await f.resolve(0, page(0, ['old-a', 'old-b']));
  await f.change({ replaceSurface: true });
  expect(f.current.rows).toEqual([]);
  expect(f.requests).toHaveLength(2);
  await f.resolve(1, page(0, ['replacement-a', 'replacement-b']));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['replacement-a', 'replacement-b']);
});

test('continuous sequence drift stops after two reconstruction attempts without publishing a mixed prefix', async () => {
  const f = await fixture();
  await f.resolve(0, page(0, ['a', 'b']));
  await act(async () => { void f.current.loadMoreRows(); });
  await f.resolve(1, page(2, ['c', 'd']));
  await act(async () => { void f.current.loadRows(); });
  await f.resolve(2, page(0, ['first', 'second'], 2));
  await f.resolve(3, page(2, ['third', 'fourth'], 3));
  await f.resolve(4, page(0, ['fifth', 'sixth'], 4));
  await f.resolve(5, page(2, ['seventh', 'eighth'], 5));
  expect(f.requests).toHaveLength(6);
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'b', 'c', 'd']);
  expect(f.current.rowsNeedRefresh).toBe(true);
  expect(f.current.rowsLoading).toBe(false);
});

function page(offset: number, ids: string[], readSequence = 1, total = 4): DataStudioRowPage {
  return { offset, limit: 2, total, readSequence,
    nextOffset: offset + ids.length < total ? offset + ids.length : null,
    rows: ids.map(rowId => ({ rowId, tableId: TABLE.tableId, revision: 1,
      schemaRevision: 1, values: {}, createdAt: 1, updatedAt: 1 })) };
}
const TABLE: DataStudioTable = {
  tableId: 'table-one', key: 'notes', name: 'Notes', description: null, status: 'active',
  schema: { version: 1, columns: [] }, schemaRevision: 1, revision: 1,
  rowCount: 4, createdAt: 1, updatedAt: 1,
};
async function fixture() {
  let scope = 'organization:one', query: DataStudioRowQuery = { limit: 2 }, table = TABLE, canRead = true;
  let current!: ReturnType<typeof useDataStudioProgressiveRows>;
  let select!: (id: string) => void;
  const requests: { query: DataStudioRowQuery; signal?: AbortSignal;
    resolve: (page: DataStudioRowPage) => void; reject: (cause: unknown) => void }[] = [];
  let surface = { invalidateRows() {}, listRows(_tableId: string, q: DataStudioRowQuery, options: { signal?: AbortSignal }) {
    return new Promise<DataStudioRowPage>((resolve, reject) => requests.push({ query: q, signal: options.signal, resolve, reject }));
  } } as unknown as DataStudioSdkSurface;
  function Probe() {
    const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
    select = setSelectedRowId;
    const boundaryKeyRef = useRef(scope); boundaryKeyRef.current = scope;
    const selectedTableIdRef = useRef(table.tableId); selectedTableIdRef.current = table.tableId;
    current = useDataStudioProgressiveRows({ enabled: true, surface,
      boundary: { key: scope, scopeKey: scope, dataRevision: 1, stable: true, ready: true, phase: 'idle' },
      scopeAvailable: true, shouldLoad: true, canRead, cacheVisible: true, selectedTable: table,
      selectedTableIdRef, boundaryKeyRef, boundaryReadyRef: useRef(true), rowQuery: query,
      selectedRowId, setSelectedRowId, offset: 0, offsetHistory: [],
      setOffsetState() {}, setOffsetHistory() {},
    });
    return null;
  }
  const root = createRoot(createHookContainer()); roots.add(root);
  await act(async () => root.render(createElement(Probe)));
  return { root, requests, get current() { return current; }, select: (id: string) => select(id),
    resolve: async (index: number, value: DataStudioRowPage) => { await act(async () => requests[index]!.resolve(value)); },
    change: async (next: { scope?: string; query?: DataStudioRowQuery; table?: DataStudioTable; canRead?: boolean; replaceSurface?: boolean }) => {
      scope = next.scope ?? scope; query = next.query ?? query; table = next.table ?? table; canRead = next.canRead ?? canRead;
      if (next.replaceSurface) surface = { ...surface };
      await act(async () => root.render(createElement(Probe)));
    },
  };
}
