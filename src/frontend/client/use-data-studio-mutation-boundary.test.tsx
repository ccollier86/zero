/** Local mutation admission, captured revisions and post-commit scope retirement. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDataStudioMutations } from './use-data-studio-mutations';
import { DataStudioOperationTracker } from './data-studio-operation-tracker';
import type { DataStudioSdkSurface, DataStudioTable } from './data-studio-client';
import { configureFrontendObservability } from './observability';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';

const TABLE: DataStudioTable = { tableId: 'table-one', key: 'people', name: 'People', description: null,
  revision: 3, schemaRevision: 1, status: 'active', rowCount: 0, createdAt: 1, updatedAt: 1,
  schema: { version: 1, columns: [] } };
let restore: () => void;
const roots = new Set<Root>();
beforeEach(() => { restore = installMinimalHookDom(); configureFrontendObservability({ http: false, console: false }); });
afterEach(async () => { for (const root of roots) await act(async () => root.unmount()); roots.clear(); restore(); });

test('explicit opening revisions survive live refresh; default callers retain current-revision behavior', async () => {
  const revisions: number[] = [];
  const surface = {
    updateTable: async (_id: string, input: { expectedRevision: number }) => { revisions.push(input.expectedRevision); return TABLE; },
    setTableStatus: async (_id: string, revision: number) => { revisions.push(revision); return TABLE; },
    listTables: async () => [],
  } as unknown as DataStudioSdkSurface;
  const f = await fixture(surface);
  await f.change({ table: { ...TABLE, revision: 7 } });
  await f.current.updateTable({ name: 'New name' }, { expectedRevision: 3 });
  await f.current.updateSchema(TABLE.schema, { expectedRevision: 3 });
  await f.current.changeTableStatus('archived', { expectedRevision: 3 });
  await f.current.updateTable({ name: 'Latest' });
  expect(revisions).toEqual([3, 3, 3, 7]);
});

test('a create committed before a delayed catalog refresh cannot select a table after scope change', async () => {
  const wait = deferred<void>();
  const surface = { createTable: async () => TABLE, listTables: async () => wait.promise } as unknown as DataStudioSdkSurface;
  const f = await fixture(surface);
  const operation = f.current.createTable({ name: 'People', key: 'people', schema: TABLE.schema });
  await act(async () => { await Promise.resolve(); });
  await f.change({ scope: 'organization:two' });
  wait.resolve(); await operation;
  expect(f.selectedTables).toEqual([]);
  expect(f.catalogErrors).toEqual([]);
});

test('a rejected delayed catalog refresh cannot surface an old organization error', async () => {
  const wait = deferred<void>();
  const surface = { setTableStatus: async () => TABLE, listTables: async () => wait.promise } as unknown as DataStudioSdkSurface;
  const f = await fixture(surface);
  const operation = f.current.changeTableStatus('archived');
  await act(async () => { await Promise.resolve(); });
  await f.change({ scope: 'organization:two' });
  wait.reject(new Error('Old catalog failure')); await operation;
  expect(f.catalogErrors).toEqual([]);
});

test('delete refuses a foreign table row and retained unmounted callbacks admit no write', async () => {
  let writes = 0;
  const surface = { deleteRow: async () => { writes += 1; } } as unknown as DataStudioSdkSurface;
  const f = await fixture(surface);
  const row = { rowId: 'record', tableId: 'foreign', revision: 1, schemaRevision: 1, values: {}, createdAt: 1, updatedAt: 1 };
  await expect(f.current.deleteRow(row)).rejects.toThrow('Select an available');
  const retained = f.current;
  await act(async () => f.root.unmount()); roots.delete(f.root);
  await expect(retained.deleteRow({ ...row, tableId: TABLE.tableId })).rejects.toThrow('scope changes');
  expect(writes).toBe(0);
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture(surface: DataStudioSdkSurface) {
  let current!: ReturnType<typeof useDataStudioMutations>;
  let change!: (patch: Partial<{ scope: string; table: DataStudioTable }>) => void;
  const selectedTables: (string | null)[] = [], catalogErrors: unknown[] = [];
  function Capture() {
    const [state, setState] = useState({ scope: 'organization:one', table: TABLE });
    change = patch => setState(old => ({ ...old, ...patch }));
    const boundaryKeyRef = useRef(state.scope); boundaryKeyRef.current = state.scope;
    const boundaryReadyRef = useRef(true), selectedTableIdRef = useRef(TABLE.tableId);
    const operationTracker = useRef(new DataStudioOperationTracker());
    current = useDataStudioMutations({ surface, access: { canRead: true, canWrite: true, canManage: true },
      selectedTable: state.table, selectedRow: null, tableStatus: 'active', boundaryKey: state.scope,
      boundaryKeyRef, boundaryReadyRef, selectedTableIdRef, operationTracker,
      setPendingMutations() {}, setMutationError() {}, setCatalogError: error => catalogErrors.push(error),
      setTableStatusState() {}, setSelectedTableId: id => selectedTables.push(id as string | null), setSelectedRowId() {},
      refreshRowsAfterMutation: async () => {}, refreshTableAfterMutation: async () => {},
    });
    return null;
  }
  const root = createRoot(createHookContainer()); roots.add(root);
  await act(async () => root.render(createElement(Capture)));
  return { root, selectedTables, catalogErrors, get current() { return current; },
    change: async (patch: Parameters<typeof change>[0]) => { await act(async () => change(patch)); } };
}
