/** Actual memory ReactDOM hook ownership; no browser, physical fixture, actors or generated build output. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import type { CalendarParticipantDirectoryPage, CalendarParticipantDirectoryQuery, CalendarParticipantReference, CalendarWatchOptions } from '../../../calendar/contracts';
import { ClientProvider } from '../../../frontend/client/client-context';
import { CalendarReadError } from '../../../frontend/client/calendar-mutation';
import type { Client } from '../../../frontend/client/sdk';
import { createHookContainer, installMinimalHookDom } from '../../../frontend/client/test-fixtures/react-hook-dom';
import { useCalendarParticipantSelection, type CalendarParticipantSelection } from '../components/calendar-connected-participant-fields';
import type { CalendarParticipantFieldsProps } from '../components/calendar-participant-fields';
const roots = new Set<Root>(); let restore: () => void;
beforeEach(() => { restore = installMinimalHookDom(); });
afterEach(async () => { try { for (const root of roots) await act(async () => root.unmount()); } finally { roots.clear(); restore(); } });
const ref = (userId: string): CalendarParticipantReference => ({ kind: 'guardian-user', userId });
const page = (userId: string, name: string, nextAfter: string | null = null): CalendarParticipantDirectoryPage => ({
  items: [{ ref: ref(userId), availability: 'available', name }], truncated: nextAfter !== null, nextAfter,
});
const fields = (selection: CalendarParticipantSelection) => (selection.fields as ReactElement<CalendarParticipantFieldsProps>).props;
test('disabled participation performs no discovery and does not turn an omitted draft into explicit empty participants', async () => {
  const f = fixture(), rendered = await renderSelection(f, false);
  expect(f.watches).toHaveLength(0); expect(rendered.current.ready).toBe(true); expect(rendered.current.fields).toBeNull(); expect(rendered.value).toBeUndefined();
  await rendered.enable(true); expect(f.watches).toHaveLength(1); expect(rendered.current.ready).toBe(false);
  await act(async () => { f.watches[0]!.publish(page('a', 'SYNTHETIC_A')); });
  expect(rendered.current.ready).toBe(true); expect(rendered.value).toBeUndefined();
  await act(async () => { fields(rendered.current).onChange([ref('a')]); }); expect(rendered.value).toEqual([ref('a')]);
  await act(async () => { fields(rendered.current).onChange([]); }); expect(rendered.value).toEqual([]);
});
test('opaque paging preserves selected refs but never caches old page names or mislabels off-page choices as unavailable', async () => {
  const f = fixture(), rendered = await renderSelection(f);
  await act(async () => { f.watches[0]!.publish(page('a', 'OLD_PRIVATE_PAGE_NAME', 'opaque-first')); });
  const oldFields = fields(rendered.current);
  await act(async () => { oldFields.onChange([ref('a')]); });
  expect(JSON.stringify(fields(rendered.current))).toContain('OLD_PRIVATE_PAGE_NAME');
  await act(async () => { rendered.current.onNext(); });
  expect(f.watches[1]!.query).toEqual({ search: '', after: 'opaque-first' });
  expect(f.watches[0]!.removals).toBe(1); expect(rendered.current.directory).toBeNull(); expect(rendered.current.ready).toBe(false);
  expect(JSON.stringify(fields(rendered.current))).not.toContain('OLD_PRIVATE_PAGE_NAME');
  await act(async () => { f.watches[1]!.publish(page('b', 'CURRENT_PRIVATE_PAGE_NAME', 'opaque-second')); });
  expect(JSON.stringify(fields(rendered.current))).not.toContain('OLD_PRIVATE_PAGE_NAME');
  expect(fields(rendered.current).value).toEqual([ref('a')]); expect(fields(rendered.current).accepted).toBeUndefined();
  await act(async () => { oldFields.onChange([]); }); expect(rendered.value).toEqual([ref('a')]);
  await act(async () => { fields(rendered.current).onChange([ref('a'), ref('b')]); }); expect(rendered.value).toEqual([ref('a'), ref('b')]);
  await act(async () => { fields(rendered.current).onChange([ref('a'), ref('b'), ref('not-offered')]); }); expect(rendered.value).toEqual([ref('a'), ref('b')]);
  await act(async () => { rendered.current.onPrevious(); }); expect(f.watches[2]!.query).toEqual({ search: '' });
});
test('search replacement and expired continuation restart discovery while preserving the reference draft', async () => {
  const f = fixture(), rendered = await renderSelection(f);
  await act(async () => { f.watches[0]!.publish(page('a', 'PRIVATE_NAME', 'opaque-first')); });
  await act(async () => { fields(rendered.current).onChange([ref('a')]); });
  await act(async () => { rendered.current.onNext(); });
  await act(async () => { f.watches[1]!.options.onError?.(new CalendarReadError('CALENDAR_INPUT_INVALID', 400)); });
  expect(rendered.current).toMatchObject({ status: 'error', ready: false, denied: false, directory: null });
  await act(async () => { rendered.current.refresh(); }); expect(f.watches[2]!.query).toEqual({ search: '' });
  expect(rendered.value).toEqual([ref('a')]); expect(rendered.current.canGoBack).toBe(false);
  await act(async () => { f.watches[2]!.publish(page('b', 'B', 'opaque-next')); rendered.current.onSearchChange('Taylor'); });
  expect(f.watches[3]!.query).toEqual({ search: 'Taylor' }); expect(rendered.current.directory).toBeNull();
  await act(async () => { f.watches[2]!.publish(page('a', 'PRIVATE_NAME')); }); expect(rendered.current.directory).toBeNull();
});
test('a retained picker callback cannot add a name withdrawn by a newer live page of the same query', async () => {
  const f = fixture(), rendered = await renderSelection(f);
  await act(async () => { f.watches[0]!.publish(page('a', 'WITHDRAWN_PRIVATE_NAME', 'old-opaque')); });
  const old = fields(rendered.current);
  await act(async () => { f.watches[0]!.publish(page('b', 'CURRENT_NAME', 'new-opaque')); });
  await act(async () => { old.onChange([ref('a')]); }); expect(rendered.value).toBeUndefined();
  await act(async () => { old.onNext?.(); }); expect(f.watches[1]!.query).toEqual({ search: '', after: 'new-opaque' });
});
test('known denial conceals fields; scope/client replacement and unmount retire callbacks and pagination ownership', async () => {
  const f = fixture(), rendered = await renderSelection(f);
  await act(async () => { f.watches[0]!.publish(page('a', 'PRIVATE_NAME', 'opaque')); });
  const old = rendered.current;
  f.auth.authorizationScopeKey = 'next-scope';
  await act(async () => { old.onNext(); fields(old).onChange([ref('a')]); old.refresh(); }); expect(f.watches).toHaveLength(1); expect(rendered.value).toBeUndefined();
  await act(async () => { f.notify(); }); expect(f.watches[1]!.query).toEqual({ search: '' });
  await act(async () => { f.watches[1]!.options.onError?.(new CalendarReadError('CALENDAR_FORBIDDEN', 403)); });
  expect(rendered.current).toMatchObject({ denied: true, ready: false, fields: null });
  await act(async () => { f.watches[1]!.publish(page('a', 'PRIVATE_NAME')); }); expect(rendered.current.fields).toBeNull();
  const replacement = fixture(); await rendered.replace(replacement);
  expect(replacement.watches).toHaveLength(1); expect(rendered.current).toMatchObject({ ready: false, denied: false });
  await act(async () => { replacement.watches[0]!.publish(page('b', 'B')); });
  const last = rendered.current; await rendered.unmount();
  await act(async () => { last.refresh(); last.onSearchChange('retired'); }); expect(replacement.watches).toHaveLength(1); expect(replacement.watches[0]!.removals).toBe(1);
});

function fixture() {
  const observers = new Set<() => void>(), subscribe = (observer: () => void) => { observers.add(observer); return () => { observers.delete(observer); }; };
  const auth = { authorizationScopeKey: 'participant-scope', user: { userId: 'synthetic-user' }, activeTenant: null, isLoading: false, isRestoring: false,
    isAuthenticated: true, authorizationState: { status: 'ready' }, sessionTransition: { phase: 'idle', revision: 0 }, subscribe, subscribeAuthorization: subscribe };
  const watches: { query: CalendarParticipantDirectoryQuery; options: CalendarWatchOptions; publish(value: CalendarParticipantDirectoryPage): void; removals: number }[] = [];
  const client = { auth, calendar: { participants: { watchDirectory(query: CalendarParticipantDirectoryQuery, publish: (value: CalendarParticipantDirectoryPage) => void, options: CalendarWatchOptions) {
    const item = { query, options, publish, removals: 0 }; watches.push(item); return () => { item.removals++; };
  } } } } as unknown as Client;
  return { client, auth, watches, notify() { for (const observer of observers) observer(); } };
}
async function renderSelection(initial: ReturnType<typeof fixture>, initialEnabled = true) {
  const { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  let f = initial, enabled = initialEnabled, value: readonly CalendarParticipantReference[] | undefined, current!: CalendarParticipantSelection, providerGeneration = 0;
  function Capture() { current = useCalendarParticipantSelection({ enabled, value, onChange(refs) { value = refs; render(); } }); return null; }
  const render = () => root.render(createElement(ClientProvider, { key: providerGeneration, client: f.client, children: createElement(Capture) }));
  await act(async () => { render(); });
  return { get current() { return current; }, get value() { return value; }, async enable(next: boolean) { enabled = next; await act(async () => { render(); }); },
    async replace(next: ReturnType<typeof fixture>) { f = next; providerGeneration++; await act(async () => { render(); }); },
    async unmount() { await act(async () => { root.unmount(); }); roots.delete(root); } };
}
