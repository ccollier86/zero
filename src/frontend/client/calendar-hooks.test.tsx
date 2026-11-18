/** Synthetic in-memory hook DOM only. No browser/server/database or generated build tree. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import type { CalendarAppointmentPage, CalendarAppointmentView, CalendarAppointmentTypePage, CalendarAppointmentTypePageQuery, CalendarAppointmentTypeView,
  CalendarLifecyclePolicy, CalendarAppointmentTransitions, CalendarParticipantDirectoryQuery, CalendarParticipantDirectoryPage, CalendarParticipantsView,
  CalendarResourceTypesView, CalendarLocationPage, CalendarLocationPageQuery, CalendarVisitLocationQuery, CalendarRangeQuery, CalendarReadOptions, CalendarResourcePage, CalendarResourcePageQuery, CalendarWatchOptions, CalendarWatchUpdate } from '../../calendar/contracts';
import { ClientProvider } from './client-context';
import type { Client } from './sdk';
import { CalendarReadError } from './calendar-mutation';
import { useCalendarAppointment, useCalendarAppointments, useCalendarResources, useCalendarLocations, useCalendarAppointmentTypes,
  useCalendarAppointmentType, useCalendarResourceTypes, useCalendarLifecycle, useCalendarAppointmentTransitions, useCalendarVisitLocations,
  useCalendarParticipantDirectory, useCalendarAppointmentParticipants, useCalendarHoldParticipants, type CalendarReadResult, type UseCalendarAppointmentsResult } from './calendar-hooks';
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
test('type-selector omission and explicit empty resource selection never share an accepted private page', async () => {
  const f = fixture(), { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let query: CalendarAppointmentTypePageQuery = {}, current!: CalendarReadResult<CalendarAppointmentTypePage>;
  const renders: { selection: string; value: CalendarReadResult<CalendarAppointmentTypePage> }[] = [];
  function Capture() { current = useCalendarAppointmentTypes(query); renders.push({ selection: JSON.stringify(query.resourceIds ?? null), value: current }); return null; }
  const render = () => root.render(createElement(ClientProvider, { client: f.client, children: createElement(Capture) }));
  await act(async () => { render(); });
  const catalog = { items: [], truncated: true, nextAfter: 'type' };
  await act(async () => { f.types[0]!.resolve(catalog); }); expect(current.value).toBe(catalog);
  query = { resourceIds: [] }; await act(async () => { render(); });
  expect(renders.find(render => render.selection === '[]')!.value).toMatchObject({ status: 'loading', value: null });
  expect(f.types[1]!.query).toEqual({ resourceIds: [] }); expect(f.types[0]!.removals).toBe(1);
  await act(async () => { f.types[0]!.resolve(catalog); }); expect(current.value).toBeNull();
  await act(async () => { f.types[1]!.resolve({ items: [], truncated: false, nextAfter: null }); }); expect(current.status).toBe('ready');
  await act(async () => { f.types[1]!.options.onError?.(new CalendarReadError('CALENDAR_NOT_FOUND', 404)); });
  expect(current).toMatchObject({ status: 'error', value: null, code: 'CALENDAR_NOT_FOUND' });
});
test('lifecycle policy and transition hooks withdraw on domain denial, appointment replacement and scope retirement', async () => {
  const f = fixture(), { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let id: string | null = 'appointment', current!: { policy: CalendarReadResult<CalendarLifecyclePolicy>; transitions: CalendarReadResult<CalendarAppointmentTransitions> };
  const renders: { id: string | null; transitions: CalendarReadResult<CalendarAppointmentTransitions> }[] = [];
  function Capture() { current = { policy: useCalendarLifecycle(), transitions: useCalendarAppointmentTransitions(id) }; renders.push({ id, transitions: current.transitions }); return null; }
  const render = () => root.render(createElement(ClientProvider, { client: f.client, children: createElement(Capture) }));
  await act(async () => { render(); });
  const policy: CalendarLifecyclePolicy = { revision: 1, extended: true, cancellationReason: 'required', noShowReason: 'optional' };
  const projection: CalendarAppointmentTransitions = { id: 'appointment', revision: 1, policyRevision: 1, status: 'tentative', allowed: [{ status: 'confirmed', requiresReason: false }] };
  await act(async () => { f.lifecycle[0]!.resolve(policy); f.transitions[0]!.resolve(projection); });
  expect(current.policy.value).toBe(policy); expect(current.transitions.value).toBe(projection);
  id = 'replacement'; await act(async () => { render(); });
  expect(renders.find(render => render.id === id)!.transitions).toMatchObject({ status: 'loading', value: null });
  expect(f.transitions[0]!.options.signal!.aborted).toBe(true); expect(f.transitions[0]!.removals).toBe(1);
  await act(async () => { f.transitions[0]!.resolve(projection); }); expect(current.transitions.value).toBeNull();
  await act(async () => { f.transitions[1]!.resolve({ ...projection, id: 'replacement' }); });
  await act(async () => { f.transitions[1]!.options.onError?.(new CalendarReadError('CALENDAR_NOT_FOUND', 404)); });
  expect(current.transitions).toMatchObject({ status: 'error', value: null, code: 'CALENDAR_NOT_FOUND' });
  expect(f.transitions[1]!.removals).toBe(1); expect(current.policy.value).toBe(policy);
  f.auth.authorizationScopeKey = 'replacement-scope'; await act(async () => { f.notify(); });
  expect(current.policy).toMatchObject({ status: 'loading', value: null }); expect(f.lifecycle[0]!.removals).toBe(1);
  id = null; await act(async () => { render(); }); expect(current.transitions).toMatchObject({ status: 'idle', value: null });
});
test('type and resource-policy detail hooks withdraw independently on domain denial and retire on scope replacement', async () => {
  const f = fixture(), { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let current!: { type: CalendarReadResult<CalendarAppointmentTypeView>; policy: CalendarReadResult<CalendarResourceTypesView> };
  function Capture() { current = { type: useCalendarAppointmentType('type'), policy: useCalendarResourceTypes('resource') }; return null; }
  await act(async () => { root.render(createElement(ClientProvider, { client: f.client, children: createElement(Capture) })); });
  const type: CalendarAppointmentTypeView = { id: 'type', revision: 1, label: 'Synthetic type', durationMinutes: 30,
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null, active: true };
  const policy: CalendarResourceTypesView = { resourceId: 'resource', resourceRevision: 2, mode: 'required', typeIds: ['type'] };
  await act(async () => { f.typeDetails[0]!.resolve(type); f.typePolicies[0]!.resolve(policy); });
  expect(current.type.value).toBe(type); expect(current.policy.value).toBe(policy);
  await act(async () => { f.typePolicies[0]!.options.onError?.(new CalendarReadError('CALENDAR_NOT_FOUND', 404)); });
  expect(current.policy).toMatchObject({ status: 'error', value: null }); expect(current.type.value).toBe(type);
  await act(async () => { f.typePolicies[0]!.resolve(policy); }); expect(current.policy.value).toBeNull();
  f.auth.authorizationScopeKey = 'new-scope'; await act(async () => { f.notify(); });
  expect(current.type.value).toBeNull(); expect(current.policy.value).toBeNull();
  await act(async () => { f.typeDetails[0]!.resolve(type); f.typePolicies[0]!.resolve(policy); });
  expect(current.type.value).toBeNull(); expect(current.policy.value).toBeNull();
  expect(f.typeDetails[0]!.options.signal!.aborted).toBe(true); expect(f.typePolicies[0]!.options.signal!.aborted).toBe(true);
});
test('visit location hooks mask selection replacement, empty and null states, domain denial and changed authority callbacks', async () => {
  const f = fixture(), { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let query: CalendarVisitLocationQuery | null = { resourceIds: ['resource-a'] }, current!: CalendarReadResult<CalendarLocationPage>;
  const renders: { selection: string; value: CalendarReadResult<CalendarLocationPage> }[] = [];
  function Capture() { current = useCalendarVisitLocations(query); renders.push({ selection: JSON.stringify(query), value: current }); return null; }
  const render = () => root.render(createElement(ClientProvider, { client: f.client, children: createElement(Capture) }));
  await act(async () => { render(); });
  const page: CalendarLocationPage = { items: [{ id: 'location', label: 'Synthetic visit choice', revision: 1, region: null, active: true }], truncated: false, nextAfter: null };
  await act(async () => { f.visits[0]!.resolve(page); }); expect(current.value).toBe(page);
  query = { resourceIds: ['resource-b'] }; await act(async () => { render(); });
  expect(renders.find(value => value.selection.includes('resource-b'))!.value).toMatchObject({ status: 'loading', value: null });
  expect(f.visits[0]!.removals).toBe(1); expect(f.visits[0]!.options.signal!.aborted).toBe(true);
  await act(async () => { f.visits[0]!.resolve(page); }); expect(current.value).toBeNull();
  await act(async () => { f.visits[1]!.resolve(page); f.visits[1]!.options.onError?.(new CalendarReadError('CALENDAR_NOT_FOUND', 404, true)); });
  expect(current).toMatchObject({ status: 'error', value: null, code: 'CALENDAR_NOT_FOUND' }); expect(f.visits[1]!.removals).toBe(1);
  await act(async () => { f.visits[1]!.resolve(page); }); expect(current.value).toBeNull();
  query = { resourceIds: [] }; await act(async () => { render(); }); expect(f.visits[2]!.query).toEqual({ resourceIds: [] });
  await act(async () => { f.visits[2]!.resolve({ items: [], truncated: false, nextAfter: null }); }); expect(current.value!.items).toEqual([]);
  const refresh = current.refresh; f.auth.authorizationScopeKey = 'replacement';
  await act(async () => { f.visits[2]!.resolve(page); refresh(); }); expect(f.visits).toHaveLength(3); expect(current.value!.items).toEqual([]);
  await act(async () => { f.notify(); }); expect(current).toMatchObject({ status: 'loading', value: null }); expect(f.visits[2]!.removals).toBe(1);
  query = null; await act(async () => { render(); }); expect(current).toMatchObject({ status: 'idle', value: null }); expect(f.visits[3]!.removals).toBe(1);
  await act(async () => { f.visits[3]!.resolve(page); }); expect(current.value).toBeNull();
});
test('participant directory hooks mask opaque continuation and search replacement, denial, scope changes and retired callbacks', async () => {
  const f = fixture(), { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let query: CalendarParticipantDirectoryQuery | null = { search: 'Synthetic', limit: 1 }, current!: CalendarReadResult<CalendarParticipantDirectoryPage>;
  const renders: { query: string; value: CalendarReadResult<CalendarParticipantDirectoryPage> }[] = [];
  function Capture() { current = useCalendarParticipantDirectory(query); renders.push({ query: JSON.stringify(query), value: current }); return null; }
  const render = () => root.render(createElement(ClientProvider, { client: f.client, children: createElement(Capture) }));
  await act(async () => { render(); });
  const page: CalendarParticipantDirectoryPage = { items: [{ ref: { kind: 'guardian-user', userId: 'account-a' }, availability: 'available', name: 'Synthetic account' }],
    truncated: true, nextAfter: 'pc_opaque-next' };
  await act(async () => { f.participantDirectories[0]!.resolve(page); }); expect(current.value).toBe(page);
  query = { search: 'Synthetic', limit: 1, after: page.nextAfter! };
  await act(async () => { render(); });
  expect(renders.find(value => value.query.includes('pc_opaque-next'))!.value).toMatchObject({ status: 'loading', value: null });
  expect(f.participantDirectories[0]!.options.signal!.aborted).toBe(true); expect(f.participantDirectories[0]!.removals).toBe(1);
  expect(f.participantDirectories[1]!.query).toEqual(query);
  await act(async () => { f.participantDirectories[0]!.resolve(page); }); expect(current.value).toBeNull();
  const empty = { items: [], truncated: false, nextAfter: null };
  await act(async () => { f.participantDirectories[1]!.resolve(empty); }); expect(current.value).toBe(empty);
  query = { search: 'Other' }; await act(async () => { render(); }); expect(current).toMatchObject({ status: 'loading', value: null });
  await act(async () => { f.participantDirectories[2]!.options.onError?.(new CalendarReadError('CALENDAR_FORBIDDEN', 403, true)); });
  expect(current).toMatchObject({ status: 'error', value: null, code: 'CALENDAR_FORBIDDEN' }); expect(f.participantDirectories[2]!.removals).toBe(1);
  await act(async () => { f.participantDirectories[2]!.resolve(page); }); expect(current.value).toBeNull();
  await act(async () => { current.refresh(); }); expect(f.participantDirectories).toHaveLength(4);
  await act(async () => { f.participantDirectories[3]!.resolve(empty); });
  const refresh = current.refresh; f.auth.authorizationScopeKey = 'replacement-participant-scope';
  await act(async () => { f.participantDirectories[3]!.resolve(page); refresh(); }); expect(current.value).toBe(empty); expect(f.participantDirectories).toHaveLength(4);
  await act(async () => { f.notify(); }); expect(current).toMatchObject({ status: 'loading', value: null });
  expect(f.participantDirectories[3]!.options.signal!.aborted).toBe(true); expect(f.participantDirectories[3]!.removals).toBe(1);
  query = null; await act(async () => { render(); }); expect(current).toMatchObject({ status: 'idle', value: null });
  expect(f.participantDirectories[4]!.removals).toBe(1);
  await act(async () => { f.participantDirectories[4]!.resolve(page); }); expect(current.value).toBeNull();
});

test('appointment and hold participant hooks retain only the current target and scope, including ref-only tombstones', async () => {
  const f = fixture(), { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let appointmentId: string | null = 'appointment-a', holdId: string | null = 'hold-a';
  let current!: { appointment: CalendarReadResult<CalendarParticipantsView>; hold: CalendarReadResult<CalendarParticipantsView> };
  const renders: { id: string | null; appointment: CalendarReadResult<CalendarParticipantsView> }[] = [];
  function Capture() { current = { appointment: useCalendarAppointmentParticipants(appointmentId), hold: useCalendarHoldParticipants(holdId) };
    renders.push({ id: appointmentId, appointment: current.appointment }); return null; }
  const render = () => root.render(createElement(ClientProvider, { client: f.client, children: createElement(Capture) }));
  await act(async () => { render(); });
  const appointment: CalendarParticipantsView = { id: 'appointment-a', revision: 2, participants: [{ ref: { kind: 'guardian-user', userId: 'retired-account' }, availability: 'unavailable' }] };
  const held: CalendarParticipantsView = { id: 'hold-a', revision: 1, participants: [] };
  await act(async () => { f.appointmentParticipants[0]!.resolve(appointment); f.holdParticipants[0]!.resolve(held); });
  expect(current.appointment.value).toBe(appointment); expect(current.hold.value).toBe(held);
  appointmentId = 'appointment-b'; await act(async () => { render(); });
  expect(renders.find(value => value.id === 'appointment-b')!.appointment).toMatchObject({ status: 'loading', value: null });
  expect(current.hold.value).toBe(held); expect(f.appointmentParticipants[0]!.removals).toBe(1);
  expect(f.appointmentParticipants[0]!.options.signal!.aborted).toBe(true);
  await act(async () => { f.appointmentParticipants[0]!.resolve(appointment); }); expect(current.appointment.value).toBeNull();
  await act(async () => { f.appointmentParticipants[1]!.options.onError?.(new CalendarReadError('CALENDAR_NOT_FOUND', 404)); });
  expect(current.appointment).toMatchObject({ status: 'error', value: null, code: 'CALENDAR_NOT_FOUND' });
  expect(f.appointmentParticipants[1]!.removals).toBe(1);
  await act(async () => { current.appointment.refresh(); }); expect(current.appointment).toMatchObject({ status: 'loading', value: null });
  const replacement = { ...appointment, id: 'appointment-b', revision: 3 };
  await act(async () => { f.appointmentParticipants[2]!.resolve(replacement); }); expect(current.appointment.value).toBe(replacement);
  const refresh = current.hold.refresh; f.auth.authorizationScopeKey = 'new-scope';
  await act(async () => { f.appointmentParticipants[2]!.resolve(appointment); f.holdParticipants[0]!.resolve(appointment); refresh(); });
  expect(current.appointment.value).toBe(replacement); expect(current.hold.value).toBe(held); expect(f.holdParticipants).toHaveLength(1);
  await act(async () => { f.notify(); });
  expect(current.appointment.value).toBeNull(); expect(current.hold.value).toBeNull();
  expect(f.appointmentParticipants[2]!.options.signal!.aborted).toBe(true); expect(f.holdParticipants[0]!.options.signal!.aborted).toBe(true);
  appointmentId = null; holdId = null; await act(async () => { render(); });
  expect(current.appointment).toMatchObject({ status: 'idle', value: null }); expect(current.hold).toMatchObject({ status: 'idle', value: null });
  await act(async () => { f.appointmentParticipants[3]!.resolve(replacement); f.holdParticipants[1]!.resolve(held); });
  expect(current.appointment.value).toBeNull(); expect(current.hold.value).toBeNull();
});

function fixture() {
  const observers = new Set<() => void>(), subscribe = (observer: () => void) => { observers.add(observer); return () => { observers.delete(observer); }; };
  const auth = { authorizationScopeKey: 'original-scope', user: { userId: 'synthetic-user' }, activeTenant: { tenantId: 'synthetic-tenant' }, isLoading: false,
    isRestoring: false, isAuthenticated: true, authorizationState: { status: 'ready' }, sessionTransition: { phase: 'idle', revision: 0 }, subscribe, subscribeAuthorization: subscribe };
  const subscriptions: { query: CalendarRangeQuery; listener(page: CalendarAppointmentPage, update?: CalendarWatchUpdate): void; options: CalendarWatchOptions }[] = [];
  const resources: { query: CalendarResourcePageQuery; options: CalendarWatchOptions; resolve(value: CalendarResourcePage): void; removals: number }[] = [];
  const locations: { query: CalendarLocationPageQuery; options: CalendarWatchOptions; resolve(value: CalendarLocationPage): void; removals: number }[] = [];
  const visits: { query: CalendarVisitLocationQuery; options: CalendarWatchOptions; resolve(value: CalendarLocationPage): void; removals: number }[] = [];
  const types: { query: CalendarAppointmentTypePageQuery; options: CalendarWatchOptions; resolve(value: CalendarAppointmentTypePage): void; removals: number }[] = [];
  const typeDetails: { id: string; options: CalendarWatchOptions; resolve(value: CalendarAppointmentTypeView): void }[] = [];
  const typePolicies: { id: string; options: CalendarWatchOptions; resolve(value: CalendarResourceTypesView): void }[] = [];
  const details: { options: CalendarReadOptions; resolve(value: CalendarAppointmentView): void; reject(error: unknown): void }[] = [];
  const lifecycle: { options: CalendarWatchOptions; resolve(value: CalendarLifecyclePolicy): void; removals: number }[] = [];
  const transitions: { id: string; options: CalendarWatchOptions; resolve(value: CalendarAppointmentTransitions): void; removals: number }[] = [];
  const participantDirectories: { query: CalendarParticipantDirectoryQuery; options: CalendarWatchOptions; resolve(value: CalendarParticipantDirectoryPage): void; removals: number }[] = [];
  const appointmentParticipants: { id: string; options: CalendarWatchOptions; resolve(value: CalendarParticipantsView): void; removals: number }[] = [];
  const holdParticipants: { id: string; options: CalendarWatchOptions; resolve(value: CalendarParticipantsView): void; removals: number }[] = [];
  const client = { auth, calendar: { participants: { watchDirectory(query: CalendarParticipantDirectoryQuery, listener: (value: CalendarParticipantDirectoryPage) => void, options: CalendarWatchOptions) {
    const item = { query, options, resolve: listener, removals: 0 }; participantDirectories.push(item); return () => { item.removals++; };
  }, watchForAppointment(id: string, listener: (value: CalendarParticipantsView) => void, options: CalendarWatchOptions) {
    const item = { id, options, resolve: listener, removals: 0 }; appointmentParticipants.push(item); return () => { item.removals++; };
  }, watchForHold(id: string, listener: (value: CalendarParticipantsView) => void, options: CalendarWatchOptions) {
    const item = { id, options, resolve: listener, removals: 0 }; holdParticipants.push(item); return () => { item.removals++; };
  } }, lifecycle: { watch(listener: (value: CalendarLifecyclePolicy) => void, options: CalendarWatchOptions) {
    const item = { options, resolve: listener, removals: 0 }; lifecycle.push(item); return () => { item.removals++; };
  } }, resources: { watch(query: CalendarResourcePageQuery, listener: (value: CalendarResourcePage) => void, options: CalendarWatchOptions) {
    const item = { query, options, resolve: listener, removals: 0 }; resources.push(item); return () => { item.removals++; };
  } }, locations: { watch(query: CalendarLocationPageQuery, listener: (value: CalendarLocationPage) => void, options: CalendarWatchOptions) {
    const item = { query, options, resolve: listener, removals: 0 }; locations.push(item); return () => { item.removals++; };
  }, watchForVisit(query: CalendarVisitLocationQuery, listener: (value: CalendarLocationPage) => void, options: CalendarWatchOptions) {
    const item = { query, options, resolve: listener, removals: 0 }; visits.push(item); return () => { item.removals++; };
  } }, types: { watch(query: CalendarAppointmentTypePageQuery, listener: (value: CalendarAppointmentTypePage) => void, options: CalendarWatchOptions) {
    const item = { query, options, resolve: listener, removals: 0 }; types.push(item); return () => { item.removals++; };
  }, watchType(id: string, listener: (value: CalendarAppointmentTypeView) => void, options: CalendarWatchOptions) {
    typeDetails.push({ id, options, resolve: listener }); return () => {};
  }, watchForResource(id: string, listener: (value: CalendarResourceTypesView) => void, options: CalendarWatchOptions) {
    typePolicies.push({ id, options, resolve: listener }); return () => {};
  } }, appointments: { watchTransitions(id: string, listener: (value: CalendarAppointmentTransitions) => void, options: CalendarWatchOptions) {
    const item = { id, options, resolve: listener, removals: 0 }; transitions.push(item); return () => { item.removals++; };
  }, get(_id: string, options: CalendarReadOptions) { return new Promise<CalendarAppointmentView>((resolve, reject) => details.push({ options, resolve, reject })); }, watch(query: CalendarRangeQuery, listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void, options: CalendarWatchOptions) {
    subscriptions.push({ query, listener, options }); return () => {};
  } } } } as unknown as Client;
  return { client, auth, subscriptions, resources, locations, visits, types, typeDetails, typePolicies, details, lifecycle, transitions,
    participantDirectories, appointmentParticipants, holdParticipants, notify() { for (const observer of observers) observer(); } };
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
