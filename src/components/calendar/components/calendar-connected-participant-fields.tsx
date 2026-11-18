'use client';
/** Opt-in native discovery controller. Only the current authorized page supplies names; pagination retains opaque tokens, not people. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CalendarParticipantDirectoryPage, CalendarParticipantReference, CalendarParticipantView } from '../../../calendar/contracts';
import { useClientMaybe } from '../../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../../frontend/client/authorization-scope-hooks';
import { calendarScopeReadable, useCalendarParticipantDirectory, type CalendarReadResult } from '../../../frontend/client/calendar-hooks';
import { calendarTransitionAuthorityDenied } from '../models/calendar-transition-model';
import { calendarParticipantDraft } from '../models/calendar-participant-model';
import { CalendarParticipantFields } from './calendar-participant-fields';

export interface CalendarParticipantSelectionOptions {
  readonly enabled: boolean;
  readonly value: readonly CalendarParticipantReference[] | undefined;
  readonly disabled?: boolean;
  readonly maxParticipants?: number;
  /** Fresh private binding presentation only. Omit for creation; never retain selected picker labels here. */
  readonly accepted?: readonly CalendarParticipantView[];
  readonly acceptedStatus?: CalendarReadResult<unknown>['status'];
  readonly acceptedCode?: string | null;
  readonly onRetryAccepted?: () => void;
  readonly onChange: (value: readonly CalendarParticipantReference[]) => void;
}
interface Navigation { readonly owner: string; readonly client: unknown; readonly search: string; readonly after: string | null; readonly history: readonly (string | null)[] }
export interface CalendarParticipantSelection {
  readonly fields: ReactNode;
  readonly ready: boolean;
  readonly denied: boolean;
  readonly status: CalendarReadResult<unknown>['status'];
  readonly directory: CalendarParticipantDirectoryPage | null;
  readonly search: string;
  readonly canGoBack: boolean;
  onSearchChange(value: string): void;
  onPrevious(): void;
  onNext(): void;
  refresh(): void;
}
export function useCalendarParticipantSelection(options: CalendarParticipantSelectionOptions): CalendarParticipantSelection {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  const [stored, setNavigation] = useState<Navigation>({ owner: boundary.key, client, search: '', after: null, history: [] });
  const nav = stored.owner === boundary.key && stored.client === client ? stored : { owner: boundary.key, client, search: '', after: null, history: [] };
  const query = options.enabled ? { search: nav.search, ...(nav.after === null ? {} : { after: nav.after }) } : null;
  const directory = useCalendarParticipantDirectory(query);
  const denied = options.enabled && (directory.status === 'error' && calendarTransitionAuthorityDenied({ code: directory.code, status: null })
    || options.acceptedStatus === 'error' && calendarTransitionAuthorityDenied({ code: options.acceptedCode ?? null, status: null }));
  const status = !options.enabled ? 'idle' : directory.status === 'error' || options.acceptedStatus === 'error' ? 'error'
    : directory.status === 'ready' && (options.acceptedStatus === undefined || options.acceptedStatus === 'ready') ? 'ready' : 'loading';
  const ready = !options.enabled || status === 'ready' && !denied;
  const page = status === 'ready' ? directory.value : null;
  const key = JSON.stringify([boundary.key, options.enabled, nav.search, nav.after]);
  const alive = useRef(true); useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const latest = useRef({ client, key, options, ready, page }); latest.current = { client, key, options, ready, page };
  const owned = () => alive.current && latest.current.client === client && latest.current.key === key && latest.current.options.enabled
    && calendarScopeReadable(client, boundary.key);
  const current = () => owned() && !latest.current.options.disabled;
  function onSearchChange(search: string) {
    if (!current() || search.length > 100 || /[\u0000-\u001f\u007f]/.test(search)) return;
    setNavigation({ owner: boundary.key, client, search, after: null, history: [] });
  }
  function pageChange(next: boolean) {
    if (!current() || !latest.current.ready) return;
    const after = next ? latest.current.page?.nextAfter : nav.history.at(-1);
    if (after === undefined || next && after === null) return;
    setNavigation({ ...nav, after, history: next ? [...nav.history, nav.after] : nav.history.slice(0, -1) });
  }
  function refresh() {
    if (!owned()) return;
    latest.current.options.onRetryAccepted?.();
    // Opaque tokens may expire, be evicted, or belong to a retired server process. Retry starts discovery again.
    if (nav.after !== null || nav.history.length) setNavigation({ ...nav, after: null, history: [] });
    else directory.refresh();
  }
  function onChange(value: readonly CalendarParticipantReference[]) {
    if (!current() || !latest.current.ready) return;
    const shaped = calendarParticipantDraft(value), retained = new Set((latest.current.options.value ?? []).map(ref => ref.userId));
    const unavailable = new Set((latest.current.options.accepted ?? []).filter(person => person.availability === 'unavailable').map(person => person.ref.userId));
    const offered = new Set((latest.current.page?.items ?? []).filter(person => person.availability === 'available' && !unavailable.has(person.ref.userId)).map(person => person.ref.userId));
    // UI additions originate only in this fresh page. The server separately re-admits all additions at actual commit.
    if (!shaped || shaped.some(ref => !retained.has(ref.userId) && !offered.has(ref.userId))) return;
    latest.current.options.onChange(shaped);
  }
  const onPrevious = () => pageChange(false), onNext = () => pageChange(true);
  return { ready, denied, status, directory: page, search: nav.search, canGoBack: nav.history.length > 0,
    onSearchChange, onPrevious, onNext, refresh,
    fields: !options.enabled || denied ? null : <CalendarParticipantFields value={options.value ?? []} directory={page}
      accepted={status === 'ready' ? options.accepted : undefined} status={status} search={nav.search} disabled={options.disabled}
      maxParticipants={options.maxParticipants}
      canGoBack={nav.history.length > 0} onSearchChange={onSearchChange} onChange={onChange} onPrevious={onPrevious} onNext={onNext} onRetry={refresh} /> };
}
