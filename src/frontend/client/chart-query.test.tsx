/** Synthetic null-rendering hook tests; source authority is owned by the SDK. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import { ClientProvider } from './client-context';
import { useChartQuery, type ChartQueryOptions, type ChartQueryResult } from './chart-query';
import type { AuthClient } from './auth-client';
import type { Collection } from './collection';
import type { Client, InternalClient } from './sdk';
import type { ClientTableDef, Row } from '../../sync/types';
import { AuthorizationDataBoundaryController } from './authorization-data-boundary';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';

type FlowRow = Row & { id: string; value: number };
const roots = new Set<Root>();
let restoreDom: () => void;
beforeEach(() => { restoreDom = installMinimalHookDom(); });
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear();
  restoreDom();
});
const sumValues = (rows: readonly FlowRow[]) => rows.reduce((sum, row) => sum + row.value, 0);

describe('useChartQuery', () => {
  test('reacts to actual collection changes through the existing query subscription', async () => {
    const fixture = createFixture();
    fixture.load([{ id: 'a', value: 2 }]);
    const capture = await renderQuery(fixture.client, { table: 'flows', project: sumValues });
    expect(capture.current()).toEqual({ data: 2, error: null, rowCount: 1, connected: true, readable: true });
    await act(async () => fixture.load([{ id: 'a', value: 4 }, { id: 'b', value: 3 }]));
    expect(capture.current().data).toBe(7);
    expect(capture.current().rowCount).toBe(2);
  });

  test('connection loss retains readable cached data without inventing completeness', async () => {
    const fixture = createFixture();
    fixture.load([{ id: 'a', value: 2 }]);
    const capture = await renderQuery(fixture.client, { table: 'flows', project: sumValues });
    await act(async () => fixture.connect(false));
    expect(capture.current()).toEqual({ data: 2, error: null, rowCount: 1, connected: false, readable: true });
    expect(capture.current()).not.toHaveProperty('loading');
    expect(capture.current()).not.toHaveProperty('total');
  });

  test('masks prior data synchronously during scope retirement and never projects its empty fallback', async () => {
    const fixture = createFixture(true);
    fixture.load([{ id: 'a', value: 2 }]);
    const projected: number[] = [];
    const capture = await renderQuery(fixture.client, {
      table: 'flows', project: rows => { projected.push(rows.length); return sumValues(rows); },
    });
    expect(capture.current().data).toBe(2);
    await act(async () => fixture.retire());
    expect(capture.current()).toEqual({ data: null, error: null, rowCount: 0, connected: false, readable: false });
    expect(projected).toEqual([1]);
    await act(async () => fixture.replaceScope([{ id: 'b', value: 7 }]));
    expect(capture.current().data).toBe(7);
    expect(projected).toEqual([1, 1]);
  });

  test('retirement also removes a previous projector error', async () => {
    const fixture = createFixture(true);
    fixture.load([{ id: 'a', value: 2 }]);
    const capture = await renderQuery(fixture.client, {
      table: 'flows', project: () => { throw new Error('scope-a failure'); },
    });
    expect(capture.current().error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
    await act(async () => fixture.retire());
    expect(capture.current().error).toBeNull();
    expect(capture.current().data).toBeNull();
  });

  test('same-scope authority purge masks rows until its replacement projection is validated', async () => {
    const fixture = createFixture(true);
    fixture.load([{ id: 'a', value: 2 }]);
    const capture = await renderQuery(fixture.client, { table: 'flows', project: sumValues });
    await act(async () => fixture.purgeAuthority());
    expect(capture.current()).toEqual({ data: null, error: null, rowCount: 0, connected: false, readable: false });
    await act(async () => fixture.revalidateAuthority([{ id: 'b', value: 5 }]));
    expect(capture.current().data).toBe(5);
    expect(capture.current().readable).toBe(true);
  });

  test('predicate exceptions produce an error result without crashing React', async () => {
    const fixture = createFixture();
    fixture.load([{ id: 'a', value: 2 }]);
    const capture = await renderQuery(fixture.client, {
      table: 'flows', predicate: () => { throw new Error('predicate'); }, project: sumValues,
    });
    expect(capture.current().error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
    expect(capture.current().data).toBeNull();
  });

  for (const [invalid, code] of [
    [() => Promise.resolve(false), 'CHART_QUERY_PREDICATE_ASYNC'],
    [() => Promise.reject(new Error('synthetic predicate rejection')), 'CHART_QUERY_PREDICATE_ASYNC'],
    [() => 0, 'CHART_QUERY_PREDICATE_INVALID'],
  ] as const) test(`runtime ${code} retires an old reactive chart before projection and recovers on valid data`, async () => {
    const fixture = createFixture(true); fixture.load([{ id: 'a', value: 2 }]);
    let predicate: () => unknown = () => true, projected = 0;
    const capture = await renderQuery(fixture.client, {
      table: 'flows', predicate: () => predicate() as boolean,
      project: rows => { projected++; return sumValues(rows); },
    });
    expect(capture.current().data).toBe(2); expect(projected).toBe(1);
    predicate = invalid; await act(async () => fixture.load([{ id: 'a', value: 5 }]));
    expect(capture.current()).toMatchObject({ data: null, rowCount: 1, readable: true });
    expect(capture.current().error?.code).toBe(code); expect(projected).toBe(1);
    predicate = () => true; await act(async () => fixture.load([{ id: 'a', value: 7 }]));
    expect(capture.current().data).toBe(7); expect(capture.current().error).toBeNull(); expect(projected).toBe(2);
    predicate = invalid; await act(async () => fixture.load([{ id: 'a', value: 8 }]));
    await act(async () => fixture.retire());
    expect(capture.current()).toEqual({ data: null, error: null, rowCount: 0, connected: false, readable: false });
    expect(projected).toBe(2);
  });

  for (const mode of ['lazy', 'auto'] as const) {
    test(`fails closed for a ${mode} collection without running the projector`, async () => {
      const fixture = createFixture(false, mode);
      fixture.load([{ id: 'a', value: 2 }]);
      let projected = 0;
      const capture = await renderQuery(fixture.client, {
        table: 'flows', project: () => { projected++; return 1; },
      });
      expect(capture.current().error?.code).toBe('CHART_QUERY_SOURCE_PARTIAL');
      expect(capture.current().data).toBeNull();
      expect(projected).toBe(0);
    });
  }

  test('stable rows and callbacks keep the projection memoized', async () => {
    const fixture = createFixture();
    fixture.load([{ id: 'a', value: 2 }]);
    let projected = 0;
    const capture = await renderQuery(fixture.client, {
      table: 'flows', project: rows => { projected++; return sumValues(rows); },
    });
    await act(async () => capture.renderAgain());
    expect(projected).toBe(1);
  });

  test('unmount cleans up collection and connectivity subscriptions', async () => {
    const fixture = createFixture();
    const capture = await renderQuery(fixture.client, { table: 'flows', project: sumValues });
    expect(fixture.subscriptions()).toEqual({ rows: 1, connection: 1, authority: 0 });
    await act(async () => capture.root.unmount());
    roots.delete(capture.root);
    expect(fixture.subscriptions()).toEqual({ rows: 0, connection: 0, authority: 0 });
  });

  test('SSR returns unreadable null state and never invokes projection', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
    try {
      let projected = 0;
      let current: ChartQueryResult<number> | undefined;
      function Capture() {
        current = useChartQuery<FlowRow, number>({ table: 'flows', project: () => { projected++; return 1; } });
        return null;
      }
      expect(renderToString(createElement(Capture))).toBe('');
      expect(current).toEqual({ data: null, error: null, rowCount: 0, connected: false, readable: false });
      expect(projected).toBe(0);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    }
  });
});

async function renderQuery<TData>(client: Client, options: ChartQueryOptions<FlowRow, TData>) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer());
  roots.add(root);
  let current!: ChartQueryResult<TData>;
  function Capture() { current = useChartQuery(options); return null; }
  const renderAgain = () => root.render(createElement(ClientProvider, { client, children: createElement(Capture) }));
  await act(async () => renderAgain());
  return { root, current: () => current, renderAgain };
}

function createFixture(authEnabled = false, mode?: ClientTableDef['_sync']) {
  let byId: Record<string, FlowRow> = {};
  let connected = true;
  const rowListeners = new Set<() => void>();
  const connectionListeners = new Set<() => void>();
  const authorityListeners = new Set<() => void>();
  const dataBoundary = new AuthorizationDataBoundaryController();
  const auth = {
    authorizationScopeKey: 'scope-a', user: { userId: 'user-a' }, activeTenant: { tenantId: 'tenant-a' },
    isLoading: false, isAuthenticated: true, isRestoring: false, authorizationState: { status: 'ready' },
    sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
    subscribe(callback: () => void) { authorityListeners.add(callback); return () => { authorityListeners.delete(callback); }; },
    subscribeAuthorization(callback: () => void) { authorityListeners.add(callback); return () => { authorityListeners.delete(callback); }; },
  } as unknown as AuthClient;
  const collection = {
    name: 'flows', primaryKey: 'id', getAll: () => byId,
    subscribe(callback: () => void) { rowListeners.add(callback); return () => { rowListeners.delete(callback); }; },
  } as unknown as Collection<FlowRow>;
  const client = {
    auth: authEnabled ? auth : null,
    collection: () => collection,
    get connected() { return connected; },
    onConnectionChange(callback: () => void) { connectionListeners.add(callback); return () => { connectionListeners.delete(callback); }; },
    _syncClient: { tables: { flows: { _pk: 'id', ...(mode ? { _sync: mode } : {}) } } },
    _authorizationDataBoundary: dataBoundary,
  } as unknown as InternalClient;
  const load = (rows: FlowRow[]) => {
    byId = Object.fromEntries(rows.map(row => [row.id, row]));
    for (const callback of rowListeners) callback();
  };
  return {
    client, load,
    connect(next: boolean) { connected = next; for (const callback of connectionListeners) callback(); },
    retire() {
      Object.assign(auth, { sessionTransition: { ...auth.sessionTransition, phase: 'preparing', revision: 1 } });
      for (const callback of authorityListeners) callback();
    },
    purgeAuthority() {
      Object.assign(auth, { authorizationState: { status: 'revoked' } });
      dataBoundary.invalidate();
    },
    revalidateAuthority(rows: FlowRow[]) {
      byId = Object.fromEntries(rows.map(row => [row.id, row]));
      Object.assign(auth, { authorizationState: { status: 'ready' } });
      for (const callback of authorityListeners) callback();
    },
    replaceScope(rows: FlowRow[]) {
      Object.assign(auth, {
        authorizationScopeKey: 'scope-b', user: { userId: 'user-b' }, activeTenant: { tenantId: 'tenant-b' },
        sessionTransition: { ...auth.sessionTransition, phase: 'idle', revision: 2 },
      });
      byId = Object.fromEntries(rows.map(row => [row.id, row]));
      for (const callback of authorityListeners) callback();
    },
    subscriptions: () => ({ rows: rowListeners.size, connection: connectionListeners.size, authority: authorityListeners.size }),
  };
}
