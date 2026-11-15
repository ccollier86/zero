/** In-memory hook state only; no browser, database, generated files or live runtime. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import type { JobPageOptions, JobSchedulePage, JobWatchOptions, JobWatchUpdate } from '../../jobs/contracts';
import { ClientProvider } from './client-context';
import type { Client } from './sdk';
import { useJobSchedules, type UseJobSchedulesResult } from './jobs-hooks';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';

const roots = new Set<Root>();
let restoreDom: () => void;
beforeEach(() => { restoreDom = installMinimalHookDom(); });
afterEach(async () => {
  try { for (const root of roots) await act(async () => root.unmount()); }
  finally { roots.clear(); restoreDom(); }
});

test('invalidation revisions count only committed notifications and survive same-selection refresh or denial', async () => {
  const fixture = jobsFixture(), rendered = await renderJobs(fixture.client);
  const page = { items: [], total: 0 };
  await act(async () => { fixture.subscriptions[0]!.listener(page); });
  expect(rendered.current).toMatchObject({ status: 'ready', page, invalidationRevision: 0 });
  await act(async () => {
    fixture.subscriptions[0]!.listener(page, { invalidated: true });
    fixture.subscriptions[0]!.listener(page, { invalidated: true });
    fixture.subscriptions[0]!.listener(page, { invalidated: false });
  });
  expect(rendered.current.invalidationRevision).toBe(2);
  await act(async () => { rendered.current.refresh(); });
  expect(fixture.subscriptions[0]!.options.signal!.aborted).toBe(true);
  expect(rendered.current).toMatchObject({ status: 'loading', page: null, invalidationRevision: 2 });
  await act(async () => {
    fixture.subscriptions[0]!.listener(page, { invalidated: true });
    fixture.subscriptions[1]!.listener(page);
  });
  expect(rendered.current).toMatchObject({ status: 'ready', invalidationRevision: 2 });
  await act(async () => { fixture.subscriptions[1]!.options.onError?.(new Error('PRIVATE_DENIAL')); });
  expect(rendered.current).toMatchObject({ status: 'error', page: null, invalidationRevision: 2 });
  expect(rendered.current.error).not.toContain('PRIVATE_');
  await act(async () => { rendered.current.refresh(); });
  await act(async () => { fixture.subscriptions[1]!.listener(page, { invalidated: true }); });
  await act(async () => { fixture.subscriptions[2]!.listener(page); });
  expect(rendered.current).toMatchObject({ status: 'ready', invalidationRevision: 2 });
});

test('query and authority replacement mask prior revisions and retire retained invalidation callbacks', async () => {
  const fixture = jobsFixture(), rendered = await renderJobs(fixture.client);
  const page = { items: [], total: 0 };
  await act(async () => { fixture.subscriptions[0]!.listener(page, { invalidated: true }); });
  expect(rendered.current.invalidationRevision).toBe(1);
  await rendered.query({ limit: 20, offset: 20 });
  expect(rendered.renders.find(value => value.offset === 20)!.value).toMatchObject({ status: 'loading', page: null, invalidationRevision: 0 });
  await act(async () => {
    fixture.subscriptions[0]!.listener(page, { invalidated: true });
    fixture.subscriptions[1]!.listener(page, { invalidated: true });
  });
  expect(rendered.current.invalidationRevision).toBe(1);
  const oldRefresh = rendered.current.refresh;
  fixture.auth.authorizationScopeKey = 'replacement-authority';
  await act(async () => { fixture.subscriptions[1]!.listener(page, { invalidated: true }); oldRefresh(); });
  expect(fixture.subscriptions).toHaveLength(2); expect(rendered.current.invalidationRevision).toBe(1);
  await act(async () => { fixture.notify(); });
  expect(rendered.current).toMatchObject({ status: 'loading', page: null, invalidationRevision: 0 });
  await act(async () => {
    fixture.subscriptions[1]!.listener(page, { invalidated: true });
    fixture.subscriptions[2]!.listener(page);
  });
  expect(rendered.current).toMatchObject({ status: 'ready', invalidationRevision: 0 });
  const oldListener = fixture.subscriptions[2]!.listener;
  await rendered.unmount();
  await act(async () => { oldListener(page, { invalidated: true }); });
  expect(fixture.subscriptions[2]!.options.signal!.aborted).toBe(true);
});

test('successful reconnect revisions reconcile equal pages without claiming a commit and retire with their selection', async () => {
  const fixture = jobsFixture(), rendered = await renderJobs(fixture.client);
  const page = { items: [], total: 0 };
  await act(async () => { fixture.subscriptions[0]!.listener(page, { invalidated: false }); });
  expect(rendered.current).toMatchObject({ status: 'ready', page, invalidationRevision: 0, reconnectRevision: 0 });
  await act(async () => { fixture.subscriptions[0]!.listener(page, { invalidated: false, reconnected: true }); });
  expect(rendered.current).toMatchObject({ status: 'ready', page, invalidationRevision: 0, reconnectRevision: 1 });
  await act(async () => { rendered.current.refresh(); });
  expect(rendered.current).toMatchObject({ status: 'loading', page: null, invalidationRevision: 0, reconnectRevision: 1 });
  await act(async () => {
    fixture.subscriptions[0]!.listener(page, { invalidated: true, reconnected: true });
    fixture.subscriptions[1]!.listener(page, { invalidated: false });
  });
  expect(rendered.current).toMatchObject({ invalidationRevision: 0, reconnectRevision: 1 });
  await rendered.query({ limit: 20, offset: 20 });
  expect(rendered.current).toMatchObject({ status: 'loading', page: null, invalidationRevision: 0, reconnectRevision: 0 });
  await act(async () => {
    fixture.subscriptions[1]!.listener(page, { invalidated: false, reconnected: true });
    fixture.subscriptions[2]!.listener(page, { invalidated: false, reconnected: true });
  });
  expect(rendered.current).toMatchObject({ invalidationRevision: 0, reconnectRevision: 1 });
  fixture.auth.authorizationScopeKey = 'reconnected-replacement';
  await act(async () => { fixture.subscriptions[2]!.listener(page, { invalidated: false, reconnected: true }); });
  expect(rendered.current).toMatchObject({ invalidationRevision: 0, reconnectRevision: 1 });
  await act(async () => { fixture.notify(); });
  expect(rendered.current).toMatchObject({ status: 'loading', page: null, invalidationRevision: 0, reconnectRevision: 0 });
  await act(async () => {
    fixture.subscriptions[2]!.listener(page, { invalidated: true, reconnected: true });
    fixture.subscriptions[3]!.listener(page, { invalidated: false });
  });
  expect(rendered.current).toMatchObject({ invalidationRevision: 0, reconnectRevision: 0 });
  const replacement = jobsFixture();
  await rendered.replaceClient(replacement.client);
  expect(rendered.current).toMatchObject({ status: 'loading', page: null, invalidationRevision: 0, reconnectRevision: 0 });
  expect(fixture.subscriptions[3]!.options.signal!.aborted).toBe(true);
  await act(async () => {
    fixture.subscriptions[3]!.listener(page, { invalidated: true, reconnected: true });
    replacement.subscriptions[0]!.listener(page, { invalidated: false });
  });
  expect(rendered.current).toMatchObject({ invalidationRevision: 0, reconnectRevision: 0 });
  await rendered.unmount();
  expect(replacement.subscriptions[0]!.options.signal!.aborted).toBe(true);
});

function jobsFixture() {
  const notifications = new Set<() => void>(), subscribe = (listener: () => void) => { notifications.add(listener); return () => { notifications.delete(listener); }; };
  const auth = { authorizationScopeKey: 'original-authority', user: { userId: 'synthetic-owner' }, activeTenant: { tenantId: 'synthetic-tenant' },
    isLoading: false, isRestoring: false, isAuthenticated: true, authorizationState: { status: 'ready' },
    sessionTransition: { phase: 'idle', revision: 0 }, subscribe, subscribeAuthorization: subscribe };
  const subscriptions: { listener: (page: JobSchedulePage, update?: JobWatchUpdate) => void; options: JobWatchOptions }[] = [];
  const client = { auth, jobs: { schedules: { watch(listener: (page: JobSchedulePage, update?: JobWatchUpdate) => void, options: JobWatchOptions) {
    subscriptions.push({ listener, options }); return () => {};
  } } } } as unknown as Client;
  return { auth, client, subscriptions, notify() { for (const listener of notifications) listener(); } };
}

async function renderJobs(client: Client) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  let query: JobPageOptions = { limit: 20, offset: 0 }, current!: UseJobSchedulesResult, providerRevision = 0;
  const renders: { offset: number; value: UseJobSchedulesResult }[] = [];
  function Capture() { current = useJobSchedules(query); renders.push({ offset: query.offset ?? 0, value: current }); return null; }
  const render = () => root.render(createElement(ClientProvider, { key: providerRevision, client, children: createElement(Capture) }));
  await act(async () => { render(); });
  return { get current() { return current; }, renders,
    async query(value: JobPageOptions) { query = value; await act(async () => { render(); }); },
    // ClientProvider deliberately owns one client for its mount. Replacement
    // retires that provider; changing its initial prop alone is not a public switch API.
    async replaceClient(value: Client) { client = value; providerRevision++; await act(async () => { render(); }); },
    async unmount() { await act(async () => { root.unmount(); }); roots.delete(root); },
  };
}
