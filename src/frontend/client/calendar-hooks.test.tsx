/** Synthetic in-memory hook DOM only. No browser/server/database or generated build tree. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import type { CalendarAppointmentPage, CalendarAppointmentView, CalendarLocationPage, CalendarLocationPageQuery, CalendarRangeQuery, CalendarReadOptions, CalendarResourcePage, CalendarResourcePageQuery, CalendarWatchOptions, CalendarWatchUpdate } from '../../calendar/contracts';
import { ClientProvider } from './client-context';
import type { Client } from './sdk';
import { CalendarReadError } from './calendar-mutation';
import { useCalendarAppointment, useCalendarAppointments, useCalendarResources, useCalendarLocations, type CalendarReadResult, type UseCalendarAppointmentsResult } from './calendar-hooks';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';
const roots = new Set<Root>(); let restore: () => void;
beforeEach(() => { restore = installMinimalHookDom(); });
afterEach(async () => { try { for (const root of roots) await act(async () => root.unmount()); } finally { roots.clear(); restore(); } });
const query: CalendarRangeQuery = { resourceIds: ['synthetic-resource'], startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
const page: CalendarAppointmentPage = { items: [], truncated: false };
test('terminal denial immediately removes the last snapshot and retires retained callbacks until explicit read refresh', async () => {
  const f = fixture(), rendered = await renderCalendar(f.client);
  await act(async () => { f.subscriptions[0]!.listener(page, { invalidated: true }); });
  expect(rendered.current).toMatchObject({ status: 'ready', value: page, invalidationRevision: 1 });
  await act(async () => { f.subscriptions[0]!.options.onError?.(new CalendarReadError(null, null, true)); });
  expect(rendered.current).toMatchObject({ status: 'error', value: null }); expect(f.subscriptions[0]!.options.signal!.aborted).toBe(true);
  await act(async () => { f.subscriptions[0]!.listener(page, { invalidated: true }); });
  expect(rendered.current).toMatchObject({ status: 'error', value: null, invalidationRevision: 1 });
  await act(async () => { rendered.current.refresh(); });
  expect(rendered.current).toMatchObject({ status: 'loading', value: null });
  await act(async () => { f.subscriptions[1]!.listener(page); });
  expect(rendered.current).toMatchObject({ status: 'ready', value: page, invalidationRevision: 1 });
});
test('empty resource selection stays empty and query replacement masks old data before effects settle', async () => {
  const f = fixture(), rendered = await renderCalendar(f.client);
  await act(async () => { f.subscriptions[0]!.listener(page); });
  await rendered.query({ ...query, resourceIds: [] });
  expect(rendered.renders.find(render => render.ids === '[]')!.value).toMatchObject({ status: 'loading', value: null });
  expect(f.subscriptions[1]!.query.resourceIds).toEqual([]);
  await act(async () => { f.subscriptions[0]!.listener(page, { invalidated: true }); });
  expect(rendered.current).toMatchObject({ status: 'loading', value: null, invalidationRevision: 0 });
  await rendered.query(null); expect(rendered.current).toMatchObject({ status: 'idle', value: null });
  expect(f.subscriptions[1]!.options.signal!.aborted).toBe(true);
});
test('scope changes fence retained callbacks before React notification and replace counts, selection and refresh owners', async () => {
  const f = fixture(), rendered = await renderCalendar(f.client);
  await act(async () => { f.subscriptions[0]!.listener(page, { invalidated: true, reconnected: true }); });
  const refresh = rendered.current.refresh;
  f.auth.authorizationScopeKey = 'replacement-scope';
  await act(async () => { f.subscriptions[0]!.listener(page, { invalidated: true }); refresh(); });
  expect(rendered.current.invalidationRevision).toBe(1); expect(f.subscriptions).toHaveLength(1);
  await act(async () => f.notify());
  expect(rendered.current).toMatchObject({ status: 'loading', value: null, invalidationRevision: 0, reconnectRevision: 0 });
  await act(async () => { f.subscriptions[0]!.listener(page, { invalidated: true }); f.subscriptions[1]!.listener(page); });
  expect(rendered.current).toMatchObject({ status: 'ready', invalidationRevision: 0, reconnectRevision: 0 });
  await rendered.unmount(); await act(async () => { f.subscriptions[1]!.listener(page, { invalidated: true }); });
  expect(f.subscriptions[1]!.options.signal!.aborted).toBe(true);
});
test('catalog continuation withdraws the previous page during render and retires old page reads', async () => {
  const f = fixture(), rendered = await renderReads(f.client);
  const catalog = { items: [], truncated: true, nextAfter: 'cursor-a' };
  await act(async () => { f.resources[0]!.resolve(catalog); });
  expect(rendered.current.catalog.value).toBe(catalog);
  await rendered.change('cursor-a', 0);
  expect(rendered.renders.find(render => render.cursor === 'cursor-a')!.catalog).toMatchObject({ status: 'loading', value: null });
  expect(f.resources[0]!.options.signal!.aborted).toBe(true); expect(f.resources[1]!.query).toEqual({ after: 'cursor-a' });
  await act(async () => { f.resources[1]!.resolve({ items: [], truncated: false, nextAfter: null }); });
  expect(rendered.current.catalog.status).toBe('ready');
});
test('detail invalidation and explicit refresh mask the previous snapshot before effects can reauthorize it', async () => {
  const f = fixture(), rendered = await renderReads(f.client);
  const detail = { id: 'appointment-a' } as CalendarAppointmentView;
  await act(async () => { f.details[0]!.resolve(detail); }); expect(rendered.current.detail.value).toBe(detail);
  await rendered.change(null, 1);
  expect(rendered.renders.find(render => render.readRevision === 1)!.detail).toMatchObject({ status: 'loading', value: null });
  expect(f.details[0]!.options.signal!.aborted).toBe(true);
  await act(async () => { f.details[1]!.resolve(detail); });
  const index = rendered.renders.length;
  await act(async () => { rendered.current.detail.refresh(); });
  expect(rendered.renders[index]!.detail).toMatchObject({ status: 'loading', value: null });
});
test('a detail read denied after a co-resource invalidation cannot revive the prior authorized snapshot', async () => {
  const f = fixture(), rendered = await renderReads(f.client);
  const detail: CalendarAppointmentView = { id: 'appointment-a', resourceIds: ['synthetic-resource', 'co-resource'],
    revision: 1, title: 'Synthetic appointment', startAt: query.startAt, endAt: query.endAt, timeZone: 'UTC',
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'synthetic-user' };
  await act(async () => { f.details[0]!.resolve(detail); });
  await rendered.change(null, 1);
  await act(async () => { f.details[1]!.reject(new CalendarReadError('CALENDAR_NOT_FOUND', 404)); });
  expect(rendered.current.detail).toMatchObject({ status: 'error', value: null, code: 'CALENDAR_NOT_FOUND' });
  expect(rendered.renders.filter(render => render.readRevision === 1).every(render => render.detail.value === null)).toBe(true);
});
test('directory filters own their subscriptions and current live snapshots replace data without manual refresh', async () => {
  const f = fixture(), { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let filters: CalendarResourcePageQuery = {}, current!: CalendarReadResult<CalendarResourcePage>;
  const renders: { filters: string; value: CalendarReadResult<CalendarResourcePage> }[] = [];
  function Capture() { current = useCalendarResources(filters); renders.push({ filters: JSON.stringify(filters), value: current }); return null; }
  const render = () => root.render(createElement(ClientProvider, { client: f.client, children: createElement(Capture) }));
  await act(async () => { render(); });
  const initial = { items: [], truncated: false, nextAfter: null };
  await act(async () => { f.resources[0]!.resolve(initial); }); expect(current.value).toBe(initial);
  const updated = { items: [], truncated: true, nextAfter: 'current-cursor' };
  await act(async () => { f.resources[0]!.resolve(updated); }); expect(current.value).toBe(updated);
  filters = { locationIds: ['location-b'], regions: ['US-IN'] };
  await act(async () => { render(); });
  expect(renders.find(value => value.filters.includes('location-b'))!.value).toMatchObject({ status: 'loading', value: null });
  expect(f.resources[0]!.options.signal!.aborted).toBe(true); expect(f.resources[0]!.removals).toBe(1);
  expect(f.resources[1]!.query).toEqual(filters);
  await act(async () => { f.resources[0]!.resolve(updated); }); expect(current.value).toBeNull();
  await act(async () => { f.resources[1]!.resolve(initial); }); expect(current.value).toBe(initial);
  await act(async () => { f.resources[1]!.options.onError?.(new CalendarReadError('CALENDAR_NOT_FOUND', 404)); });
  expect(current).toMatchObject({ status: 'error', value: null, code: 'CALENDAR_NOT_FOUND' });
  await act(async () => { f.resources[1]!.resolve(updated); }); expect(current.value).toBeNull();
  expect(f.resources[1]!.removals).toBe(1);
});
test('location catalog callbacks and refresh are retired before a changed authority can publish another page', async () => {
  const f = fixture(), { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let current!: CalendarReadResult<CalendarLocationPage>;
  function Capture() { current = useCalendarLocations(); return null; }
  await act(async () => { root.render(createElement(ClientProvider, { client: f.client, children: createElement(Capture) })); });
  const page: CalendarLocationPage = { items: [{ id: 'location', label: 'Synthetic location', revision: 1, region: 'US-IN', active: true }], truncated: false, nextAfter: null };
  await act(async () => { f.locations[0]!.resolve(page); }); expect(current.value).toBe(page);
  const refresh = current.refresh; f.auth.authorizationScopeKey = 'other-scope';
  await act(async () => { f.locations[0]!.resolve({ ...page, truncated: true }); refresh(); });
  expect(f.locations).toHaveLength(1); expect(current.value).toBe(page);
  await act(async () => { f.notify(); }); expect(current).toMatchObject({ status: 'loading', value: null });
  expect(f.locations[0]!.removals).toBe(1);
  await act(async () => { f.locations[0]!.resolve(page); }); expect(current.value).toBeNull();
  await act(async () => { f.locations[1]!.resolve({ items: [], truncated: false, nextAfter: null }); });
  expect(current.status).toBe('ready'); expect(current.value!.items).toEqual([]);
});
test('synchronous directory watch failure retires its subsequently returned unsubscribe exactly once', async () => {
  const f = fixture(), { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let removals = 0, current!: CalendarReadResult<CalendarLocationPage>;
  f.client.calendar.locations.watch = (_query, _listener, options) => {
    options!.onError?.(new CalendarReadError('CALENDAR_NOT_FOUND', 404)); return () => { removals++; };
  };
  function Capture() { current = useCalendarLocations(); return null; }
  await act(async () => { root.render(createElement(ClientProvider, { client: f.client, children: createElement(Capture) })); });
  expect(current).toMatchObject({ status: 'error', value: null, code: 'CALENDAR_NOT_FOUND' }); expect(removals).toBe(1);
  await act(async () => { root.unmount(); }); roots.delete(root); expect(removals).toBe(1);
});
function fixture() {
  const observers = new Set<() => void>(), subscribe = (observer: () => void) => { observers.add(observer); return () => { observers.delete(observer); }; };
  const auth = { authorizationScopeKey: 'original-scope', user: { userId: 'synthetic-user' }, activeTenant: { tenantId: 'synthetic-tenant' }, isLoading: false,
    isRestoring: false, isAuthenticated: true, authorizationState: { status: 'ready' }, sessionTransition: { phase: 'idle', revision: 0 }, subscribe, subscribeAuthorization: subscribe };
  const subscriptions: { query: CalendarRangeQuery; listener(page: CalendarAppointmentPage, update?: CalendarWatchUpdate): void; options: CalendarWatchOptions }[] = [];
  const resources: { query: CalendarResourcePageQuery; options: CalendarWatchOptions; resolve(value: CalendarResourcePage): void; removals: number }[] = [];
  const locations: { query: CalendarLocationPageQuery; options: CalendarWatchOptions; resolve(value: CalendarLocationPage): void; removals: number }[] = [];
  const details: { options: CalendarReadOptions; resolve(value: CalendarAppointmentView): void; reject(error: unknown): void }[] = [];
  const client = { auth, calendar: { resources: { watch(query: CalendarResourcePageQuery, listener: (value: CalendarResourcePage) => void, options: CalendarWatchOptions) {
    const item = { query, options, resolve: listener, removals: 0 }; resources.push(item); return () => { item.removals++; };
  } }, locations: { watch(query: CalendarLocationPageQuery, listener: (value: CalendarLocationPage) => void, options: CalendarWatchOptions) {
    const item = { query, options, resolve: listener, removals: 0 }; locations.push(item); return () => { item.removals++; };
  } }, appointments: { get(_id: string, options: CalendarReadOptions) { return new Promise<CalendarAppointmentView>((resolve, reject) => details.push({ options, resolve, reject })); }, watch(query: CalendarRangeQuery, listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void, options: CalendarWatchOptions) {
    subscriptions.push({ query, listener, options }); return () => {};
  } } } } as unknown as Client;
  return { client, auth, subscriptions, resources, locations, details, notify() { for (const observer of observers) observer(); } };
}
async function renderReads(client: Client) {
  const { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let cursor: string | null = null, readRevision = 0;
  type Snapshot = { catalog: CalendarReadResult<CalendarResourcePage>; detail: CalendarReadResult<CalendarAppointmentView> };
  let current!: Snapshot; const renders: (Snapshot & { cursor: string | null; readRevision: number })[] = [];
  function Capture() { const catalog = useCalendarResources(cursor ? { after: cursor } : {}), detail = useCalendarAppointment('appointment-a', readRevision);
    current = { catalog, detail }; renders.push({ ...current, cursor, readRevision }); return null; }
  const render = () => root.render(createElement(ClientProvider, { client, children: createElement(Capture) }));
  await act(async () => { render(); });
  return { get current() { return current; }, renders, async change(after: string | null, revision: number) { cursor = after; readRevision = revision; await act(async () => { render(); }); } };
}
async function renderCalendar(client: Client) {
  const { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let selected: CalendarRangeQuery | null = query, current!: UseCalendarAppointmentsResult;
  const renders: { ids: string; value: UseCalendarAppointmentsResult }[] = [];
  function Capture() { current = useCalendarAppointments(selected); renders.push({ ids: JSON.stringify(selected?.resourceIds ?? null), value: current }); return null; }
  const render = () => root.render(createElement(ClientProvider, { client, children: createElement(Capture) }));
  await act(async () => { render(); });
  return { get current() { return current; }, renders, async query(value: CalendarRangeQuery | null) { selected = value; await act(async () => { render(); }); },
    async unmount() { await act(async () => root.unmount()); roots.delete(root); } };
}
