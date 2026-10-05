/** Actual ClientProvider + controller + SDK parsing/cache, with synthetic readiness and an in-memory transport. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ClientProvider } from './client-context';
import { useDataStudio } from './data-studio-controller';
import { createDataStudioSdkSurface, type DataStudioRowPage, type DataStudioTable } from './data-studio-client';
import type { UseDataStudioResult } from './data-studio-controller-types';
import type { InternalClient, FetchInit } from './sdk';
import type { AuthClient } from './auth-client';
import type { DataStudioReconciliationEvent } from './data-studio-sync';
import { configureFrontendObservability } from './observability';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';

const roots = new Set<Root>();
let restore: () => void;
beforeEach(() => { restore = installMinimalHookDom(); configureFrontendObservability({ http: false, console: false }); });
afterEach(async () => { for (const root of roots) await act(async () => root.unmount()); roots.clear(); restore(); });

test('full progressive controller appends one owned window without a competing paged read', async () => {
  const f = await fixture('progressive');
  expect(f.reads).toHaveLength(1);
  await f.respond(0, page(0, ['a', 'b']));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'b']);
  await act(async () => f.current.selectRow('b'));
  await act(async () => { void f.current.loadMoreRows?.(); void f.current.loadMoreRows?.(); });
  expect(f.reads).toHaveLength(2);
  expect(f.reads[1]!.offset).toBe(2);
  await f.respond(1, page(2, ['c', 'd']));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'b', 'c', 'd']);
  expect(f.current.selectedRow?.rowId).toBe('b');
  expect(f.current.hasMoreRows).toBe(false);
});

test('full paged controller preserves compatibility by replacing pages and retaining offset history', async () => {
  const f = await fixture('paged');
  await f.respond(0, page(0, ['a', 'b']));
  expect(f.current.loadMoreRows).toBeUndefined();
  await act(async () => f.current.goToNextPage());
  expect(f.reads[1]!.offset).toBe(2);
  await f.respond(1, page(2, ['c', 'd']));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['c', 'd']);
  expect(f.current.previousOffset).toBe(0);
  await act(async () => f.current.goToPreviousPage());
  expect(f.reads.at(-1)!.offset).toBe(0);
});

test('actual SDK scope reset prevents a late old-organization continuation entering the controller', async () => {
  const f = await fixture('progressive');
  await f.respond(0, page(0, ['old-a', 'old-b']));
  await act(async () => { void f.current.loadMoreRows?.(); });
  await f.scope('family-two');
  expect(f.current.rows).toEqual([]);
  expect(f.reads[1]!.signal?.aborted).toBe(true);
  await f.respond(1, page(2, ['old-c', 'old-d']));
  expect(f.current.rows).toEqual([]);
  await f.respond(2, page(0, ['new-a', 'new-b']));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['new-a', 'new-b']);
});

test('real SDK reconciliation rebuilds a progressive prefix instead of appending shared cached rows', async () => {
  const f = await fixture('progressive');
  await f.respond(0, page(0, ['a', 'b']));
  await act(async () => { void f.current.loadMoreRows?.(); });
  await f.respond(1, page(2, ['c', 'd']));
  await act(async () => { f.signal({ kind: 'rows', tableIds: [TABLE.tableId] }); await Bun.sleep(35); });
  expect(f.reads).toHaveLength(3);
  await f.respond(2, page(0, ['changed', 'b'], 2));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['a', 'b', 'c', 'd']);
  await f.respond(3, page(2, ['c', 'd'], 2));
  expect(f.current.rows.map(row => row.rowId)).toEqual(['changed', 'b', 'c', 'd']);
});

const TABLE: DataStudioTable = { tableId: 'table-one', key: 'contacts', name: 'Contacts', description: null,
  status: 'active', revision: 1, schemaRevision: 1, rowCount: 4, createdAt: 1, updatedAt: 1,
  schema: { version: 1, columns: [{ columnId: 'name', key: 'name', label: 'Name', type: 'text', required: false }] } };
function page(offset: number, ids: string[], readSequence = 1): DataStudioRowPage {
  return { offset, limit: 2, total: 4, nextOffset: offset + ids.length < 4 ? offset + ids.length : null, readSequence,
    rows: ids.map(rowId => ({ rowId, tableId: TABLE.tableId, revision: 1, schemaRevision: 1,
      values: { name: rowId }, createdAt: 1, updatedAt: 1 })) };
}

async function fixture(rowLoading: 'paged' | 'progressive') {
  const listeners = new Set<() => void>();
  const reconciliation = new Set<(event: DataStudioReconciliationEvent) => void>();
  const reads: { offset: number; signal?: AbortSignal; resolve: (page: DataStudioRowPage) => void }[] = [];
  // Synthetic readiness is a fixture precondition, not an authentication verifier.
  const auth = {
    authorizationScopeKey: 'family-one', user: { userId: 'fixture-user' }, activeTenant: { tenantId: 'fixture-tenant' },
    isAuthenticated: true, isRestoring: false, authorizationState: { status: 'ready' },
    sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
    subscribe(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
    subscribeAuthorization(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  } as unknown as AuthClient;
  const transport = async <T = unknown>(path: string, options?: FetchInit): Promise<T> => {
    if (path.endsWith('/capabilities')) return { enabled: true, scope: 'organization',
      permissions: { read: true, write: true, manage: true },
      limits: { maxTables: 10, maxColumns: 10, maxRowsPerTable: 100, maxPageSize: 2, maxRowBytes: 65_536 } } as T;
    if (path.includes('/rows?')) {
      const offset = Number(new URL(path, 'http://fixture.invalid').searchParams.get('offset') ?? 0);
      return await new Promise<DataStudioRowPage>(resolve => reads.push({ offset, signal: options?.signal, resolve })) as T;
    }
    if (path.includes('/tables?')) return { tables: [TABLE] } as T;
    if (path.endsWith('/tables/table-one')) return { table: TABLE } as T;
    throw new Error('Unexpected synthetic controller request');
  };
  const dataStudio = createDataStudioSdkSurface(transport, {
    subscribeReconciliation(callback) { reconciliation.add(callback); return () => { reconciliation.delete(callback); }; },
  });
  const client = { auth, dataStudio, isAuthenticated: true } as unknown as InternalClient;
  let current!: UseDataStudioResult;
  function Probe() { current = useDataStudio({ rowLoading, pageSize: 2 }); return null; }
  const root = createRoot(createHookContainer()); roots.add(root);
  await act(async () => root.render(createElement(ClientProvider, { client, children: createElement(Probe) })));
  return {
    reads, get current() { return current; },
    respond: async (index: number, value: DataStudioRowPage) => { await act(async () => reads[index]!.resolve(value)); },
    scope: async (key: string) => { await act(async () => { Object.assign(auth, {
      authorizationScopeKey: key, activeTenant: { tenantId: key },
    }); for (const listener of listeners) listener(); }); },
    signal: (event: DataStudioReconciliationEvent) => { for (const callback of reconciliation) callback(event); },
  };
}
