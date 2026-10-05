/** Synthetic React regressions for isolated accepted query membership and live rows. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { ClientProvider } from './client-context';
import { useDataPage, type DataPageResult } from './data-composition-hooks';
import type { Client, InternalClient } from './sdk';
import type { Collection } from './collection';
import type { AuthClient } from './auth-client';
import type { Row } from '../../sync/types';
import { configureFrontendObservability } from './observability';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';

type TestRow = Row & { record_key: number; title: string };
const roots = new Set<Root>();
let restoreDom: () => void;
beforeEach(() => {
  restoreDom = installMinimalHookDom();
  configureFrontendObservability({ http: false, console: false });
});
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear();
  restoreDom();
});

describe('useDataPage accepted result ownership', () => {
  test('keeps server order and excludes another consumer cache row', async () => {
    const fixture = createClientFixture();
    fixture.load([{ record_key: 9, title: 'other consumer' }]);
    const rendered = await renderPages(fixture.client, ['left']);
    await act(async () => {
      fixture.resolve(0, [{ record_key: 2, title: 'first' }, { record_key: 1, title: 'second' }]);
    });
    expect(rendered.current.left!.rows.map((row) => row.record_key)).toEqual([2, 1]);
    expect(rendered.current.left!.pageInfo?.count).toBe(2);
  });

  test('two accepted pages do not expand or replace each other', async () => {
    const fixture = createClientFixture();
    const rendered = await renderPages(fixture.client, ['left', 'right']);
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'left only' }]); });
    await act(async () => { fixture.resolve(1, [{ record_key: 2, title: 'right only' }]); });
    expect(rendered.current.left!.rows.map((row) => row.record_key)).toEqual([1]);
    expect(rendered.current.right!.rows.map((row) => row.record_key)).toEqual([2]);
  });

  test('an explicit replacing consumer cannot erase an accepted sibling page', async () => {
    const fixture = createClientFixture();
    const rendered = await renderPages(fixture.client, ['left', 'right'], true);
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'left only' }]); });
    await act(async () => { fixture.resolve(1, [{ record_key: 2, title: 'right only' }]); });
    expect(rendered.current.left!.rows.map((row) => row.record_key)).toEqual([1]);
    expect(rendered.current.right!.rows.map((row) => row.record_key)).toEqual([2]);
  });

  test('visible cache updates keep result order and unrelated rows stay absent', async () => {
    const fixture = createClientFixture();
    const rendered = await renderPages(fixture.client, ['left']);
    await act(async () => { fixture.resolve(0, [{ record_key: 2, title: 'first' }, { record_key: 1, title: 'second' }]); });
    await act(async () => { fixture.load([{ record_key: 2, title: 'updated' }, { record_key: 9, title: 'unrelated' }]); });
    expect(rendered.current.left!.rows.map((row) => row.title)).toEqual(['updated', 'second']);
  });

  test('an authoritative delete removes its visible row and requests scoped reconciliation', async () => {
    const fixture = createClientFixture();
    const rendered = await renderPages(fixture.client, ['left']);
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'deleted' }]); });
    await act(async () => fixture.change({ table: 'records', rowId: '1', op: 'delete' }));
    expect(rendered.current.left!.rows).toEqual([]);
    expect(fixture.requests.length).toBe(2);
  });

  test('a superseded query result cannot replace the new accepted membership', async () => {
    const fixture = createClientFixture();
    const rendered = await renderPages(fixture.client, ['left']);
    await act(async () => rendered.current.left!.setFilter('title', 'new'));
    await act(async () => { fixture.resolve(1, [{ record_key: 2, title: 'new' }]); });
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'old' }]); });
    expect(rendered.current.left!.rows.map((row) => row.record_key)).toEqual([2]);
  });

  test('manual refresh remains available when automatic loading is disabled', async () => {
    const fixture = createClientFixture();
    const rendered = await renderPages(fixture.client, ['left'], false, false);
    expect(fixture.requests).toHaveLength(0);
    await act(async () => rendered.current.left!.refresh());
    expect(fixture.requests).toHaveLength(1);
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'manual' }]); });
    expect(rendered.current.left!.rows[0]?.title).toBe('manual');
  });

  test('a cache replacement retains the latest visible record snapshot', async () => {
    const fixture = createClientFixture();
    const rendered = await renderPages(fixture.client, ['left']);
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'original' }]); });
    await act(async () => fixture.load([{ record_key: 1, title: 'latest' }]));
    await act(async () => fixture.load([{ record_key: 2, title: 'replacement consumer' }], true));
    expect(rendered.current.left!.rows[0]?.title).toBe('latest');
  });

  test('authoritative snapshots reconcile a loaded query without importing cache membership', async () => {
    const fixture = createClientFixture();
    const rendered = await renderPages(fixture.client, ['left']);
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'previous' }]); });
    await act(async () => fixture.message({ type: 'sync.snapshot', tables: { records: {} }, reset: 'preserve-pending' }));
    expect(fixture.requests).toHaveLength(2);
    await act(async () => fixture.resolve(1, []));
    expect(rendered.current.left!.rows).toEqual([]);
  });

  test('unrelated server changes do not refetch this page', async () => {
    const fixture = createClientFixture();
    await renderPages(fixture.client, ['left']);
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'owned' }]); });
    await act(async () => fixture.message({ type: 'sync.change', table: 'other', rowId: '1', op: 'update' }));
    expect(fixture.requests).toHaveLength(1);
  });

  test('scope replacement hides old accepted rows and rejects late responses', async () => {
    const fixture = createClientFixture(true);
    const rendered = await renderPages(fixture.client, ['left']);
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'old identity' }]); });
    await act(async () => rendered.current.left!.refresh());
    await act(async () => fixture.switchScope());
    expect(rendered.current.left!.rows).toEqual([]);
    await act(async () => { fixture.resolve(2, [{ record_key: 2, title: 'new identity' }]); });
    await act(async () => { fixture.resolve(1, [{ record_key: 1, title: 'late old identity' }]); });
    expect(rendered.current.left!.rows.map((row) => row.title)).toEqual(['new identity']);
  });

  test('unmount clears reconciliation subscribers and fences pending reads', async () => {
    const fixture = createClientFixture();
    await renderPages(fixture.client, ['left']);
    expect(fixture.messageSubscriptions()).toBe(1);
    await act(async () => { for (const root of roots) root.unmount(); });
    roots.clear();
    expect(fixture.messageSubscriptions()).toBe(0);
    await act(async () => { fixture.resolve(0, [{ record_key: 1, title: 'late' }]); });
    expect(fixture.requests).toHaveLength(1);
  });

  test('manual loading unmount aborts its request and prevents late cache writes', async () => {
    const fixture = createClientFixture();
    const rendered = await renderPages(fixture.client, ['left'], false, false);
    await act(async () => rendered.current.left!.refresh());
    const retainedRefresh = rendered.current.left!.refresh;
    await act(async () => { for (const root of roots) root.unmount(); });
    roots.clear();
    expect(fixture.requests[0]!.signal?.aborted).toBe(true);
    await act(async () => fixture.resolve(0, [{ record_key: 1, title: 'late manual' }]));
    expect(fixture.cachedRows()).toEqual([]);
    await act(async () => retainedRefresh());
    expect(fixture.requests).toHaveLength(1);
  });
});

async function renderPages(client: Client, names: string[], replaceCollection = false, autoLoad = true) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer());
  roots.add(root);
  const current: Record<string, DataPageResult<TestRow>> = {};
  function Capture({ name }: { name: string }) {
    current[name] = useDataPage<TestRow>('records', { filters: { title: name }, replaceCollection, autoLoad });
    return null;
  }
  await act(async () => root.render(createElement(ClientProvider, {
    client,
    children: names.map((name) => createElement(Capture, { key: name, name })),
  })));
  return { current };
}

function createClientFixture(authEnabled = false) {
  let byId: Record<string, TestRow> = {};
  const listeners = new Set<() => void>();
  const messages = new Set<(message: { type: string; [key: string]: unknown }) => void>();
  const authListeners = new Set<() => void>();
  const auth = {
    authorizationScopeKey: 'scope-a', user: { userId: 'user-a' }, activeTenant: { tenantId: 'tenant-a' },
    isLoading: false, isAuthenticated: true, isRestoring: false, authorizationState: { status: 'ready' },
    sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
    subscribe(listener: () => void) { authListeners.add(listener); return () => { authListeners.delete(listener); }; },
    subscribeAuthorization(listener: () => void) { authListeners.add(listener); return () => { authListeners.delete(listener); }; },
  } as unknown as AuthClient;
  const requests: Array<{ resolve: (value: unknown) => void; signal?: AbortSignal }> = [];
  const load = (rows: TestRow[], replace = false) => {
    byId = { ...(replace ? {} : byId), ...Object.fromEntries(rows.map((row) => [String(row.record_key), row])) };
    for (const listener of listeners) listener();
  };
  const collection = {
    name: 'records', primaryKey: 'record_key',
    getAll: () => byId,
    getOne: (id: string) => byId[id] ?? null,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load(rows: TestRow[], options?: { replace?: boolean }) { load(rows, options?.replace); },
  } as unknown as Collection<TestRow>;
  const client = {
    auth: authEnabled ? auth : null,
    collection: () => collection,
    fetch: (_path: string, options?: { signal?: AbortSignal }) => new Promise((resolve) => requests.push({ resolve, signal: options?.signal })),
    _syncClient: {
      tables: { records: { _pk: 'record_key' } },
      onMessage(listener: (message: { type: string; [key: string]: unknown }) => void) {
        messages.add(listener); return () => { messages.delete(listener); };
      },
    },
  } as unknown as InternalClient;
  return {
    client, requests, load,
    cachedRows: () => Object.values(byId),
    messageSubscriptions: () => messages.size,
    switchScope() {
      Object.assign(auth, { authorizationScopeKey: 'scope-b', user: { userId: 'user-b' }, activeTenant: { tenantId: 'tenant-b' } });
      for (const listener of authListeners) listener();
    },
    message(message: { type: string; [key: string]: unknown }) {
      for (const listener of messages) listener(message);
    },
    resolve(index: number, rows: TestRow[]) {
      requests[index]!.resolve({ rows, page: { count: rows.length, limit: 20, offset: 0, hasMore: false, nextOffset: null } });
    },
    change(change: { table: string; rowId: string; op: string }) {
      const next = { ...byId };
      delete next[change.rowId]; byId = next;
      for (const listener of listeners) listener();
      for (const listener of messages) listener({ type: 'sync.change', ...change });
    },
  };
}
