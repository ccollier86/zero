'use client';
/** Scope-owned authorized reads; stale content is masked during render, before effect cleanup or a late callback. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClientMaybe, shouldUseSsrFallback } from './client-context';
import { AuthorizationScopeBoundaryFence, useAuthorizationScopeBoundary, readAuthorizationScopeBoundaryKey,
  isAuthorizationDataReady, isAuthorizationScopeReady } from './authorization-scope-hooks';
import type { Client, InternalClient } from './sdk';
import type { CalendarAppointmentPage, CalendarAppointmentView, CalendarRangeQuery, CalendarResourcePage, CalendarResourcePageQuery } from '../../calendar/contracts';
import { CalendarReadError } from './calendar-mutation';
export interface CalendarReadResult<T> {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly value: T | null;
  readonly error: string | null;
  readonly code: string | null;
  refresh(): void;
}
export interface UseCalendarAppointmentsResult extends CalendarReadResult<CalendarAppointmentPage> {
  readonly invalidationRevision: number;
  readonly reconnectRevision: number;
}
export function useCalendarResources(query: CalendarResourcePageQuery = {}): CalendarReadResult<CalendarResourcePage> {
  return useCalendarRead(JSON.stringify(['resources', query.limit ?? null, query.after ?? null]),
    (client, signal) => client.calendar.resources.list(query, { signal }));
}
export function useCalendarAppointment(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarAppointmentView> {
  return useCalendarRead(id === null ? null : JSON.stringify(['appointment', id, readRevision ?? null]), (client, signal) => client.calendar.appointments.get(id!, { signal }));
}
function useCalendarRead<T>(identity: string | null, load: (client: Client, signal: AbortSignal) => Promise<T>): CalendarReadResult<T> {
  const client = useClientMaybe(), ssr = shouldUseSsrFallback(client, 'useCalendarRead'), boundary = useAuthorizationScopeBoundary(client);
  const currentClient = useRef(client); currentClient.current = client;
  const loadRef = useRef(load); loadRef.current = load;
  const [revision, setRevision] = useState(0), fence = useRef(new AuthorizationScopeBoundaryFence()).current;
  const key = !ssr && boundary.ready && identity !== null ? JSON.stringify([boundary.key, identity]) : null, selection = fence.update(key ?? 'unselected');
  const [state, setState] = useState<{ client: typeof client; selection: number; requestRevision: number; value: T | null; status: 'loading' | 'ready' | 'error'; code: string | null }>({ client: null, selection: 0, requestRevision: 0, value: null, status: 'loading', code: null });
  useEffect(() => {
    if (!client || !key) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && currentClient.current === client && fence.isCurrent(selection) && calendarScopeReadable(client, boundary.key);
    setState({ client, selection, requestRevision: revision, status: 'loading', value: null, code: null });
    void Promise.resolve().then(() => { if (current()) return loadRef.current(client, controller.signal); }).then(value => {
      if (current() && value !== undefined) setState({ client, selection, requestRevision: revision, status: 'ready', value, code: null });
    }, error => { if (current()) setState({ client, selection, requestRevision: revision, status: 'error', value: null, code: error instanceof CalendarReadError ? error.code : null }); });
    return () => { controller.abort(); };
  }, [client, key, selection, fence, boundary.key, revision]);
  const refresh = useCallback(() => { if (key && currentClient.current === client && fence.isCurrent(selection) && calendarScopeReadable(client, boundary.key)) setRevision(value => value + 1); }, [client, key, selection, fence, boundary.key]);
  const visible = key && state.client === client && state.selection === selection && state.requestRevision === revision ? state : null, status = !key ? 'idle' : visible?.status ?? 'loading';
  return { status, value: visible?.value ?? null, code: visible?.code ?? null,
    error: status === 'error' ? 'Calendar data could not be loaded. Reauthorize or retry the read.' : null, refresh };
}
export function useCalendarAppointments(query: CalendarRangeQuery | null): UseCalendarAppointmentsResult {
  const client = useClientMaybe(), ssr = shouldUseSsrFallback(client, 'useCalendarAppointments'), boundary = useAuthorizationScopeBoundary(client);
  const currentClient = useRef(client); currentClient.current = client;
  const [revision, setRevision] = useState(0), fence = useRef(new AuthorizationScopeBoundaryFence()).current;
  const identity = query === null ? null : JSON.stringify([query.resourceIds, query.startAt, query.endAt, query.limit ?? null]);
  const key = !ssr && boundary.ready && identity !== null ? JSON.stringify([boundary.key, identity]) : null, selection = fence.update(key ?? 'unselected');
  const [state, setState] = useState<{ client: typeof client; selection: number; requestRevision: number; status: 'loading' | 'ready' | 'error'; value: CalendarAppointmentPage | null;
    invalidationRevision: number; reconnectRevision: number }>({ client: null, selection: 0, requestRevision: 0, status: 'loading', value: null, invalidationRevision: 0, reconnectRevision: 0 });
  useEffect(() => {
    if (!client || !key || !query) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && currentClient.current === client && fence.isCurrent(selection) && calendarScopeReadable(client, boundary.key);
    const counts = (old: typeof state) => old.client === client && old.selection === selection
      ? { invalidationRevision: old.invalidationRevision, reconnectRevision: old.reconnectRevision } : { invalidationRevision: 0, reconnectRevision: 0 };
    setState(old => ({ client, selection, requestRevision: revision, status: 'loading', value: null, ...counts(old) }));
    let stop: (() => void) | undefined;
    const failure = (error?: unknown) => { if (current()) {
      setState(old => ({ client, selection, requestRevision: revision, status: 'error', value: null, ...counts(old) }));
      controller.abort(); stop?.();
    } };
    try { stop = client.calendar.appointments.watch(query, (value, update) => {
      if (current()) setState(old => { const previous = counts(old); return { client, selection, requestRevision: revision, status: 'ready', value,
        invalidationRevision: previous.invalidationRevision + (update?.invalidated === true ? 1 : 0),
        reconnectRevision: previous.reconnectRevision + (update?.reconnected === true ? 1 : 0) }; });
    }, { signal: controller.signal, onError: failure }); } catch { failure(); }
    return () => { controller.abort(); stop?.(); };
  }, [client, key, boundary.key, selection, fence, revision]);
  const refresh = useCallback(() => { if (key && currentClient.current === client && fence.isCurrent(selection) && calendarScopeReadable(client, boundary.key)) setRevision(value => value + 1); }, [client, key, selection, fence, boundary.key]);
  const visible = key && state.client === client && state.selection === selection && state.requestRevision === revision ? state : null, status = !key ? 'idle' : visible?.status ?? 'loading';
  return { status, value: visible?.value ?? null, code: null, error: status === 'error' ? 'Calendar data could not be loaded. Reauthorize or retry the read.' : null,
    invalidationRevision: visible?.invalidationRevision ?? 0, reconnectRevision: visible?.reconnectRevision ?? 0, refresh };
}
/** A queued callback may run before React has observed the authority notification. */
export function calendarScopeReadable(client: Client | null, key: string): boolean {
  if (!client) return false;
  const internal = client as InternalClient, auth = internal.auth ?? null, revision = internal._authorizationDataBoundary?.revision ?? 0;
  return readAuthorizationScopeBoundaryKey(auth, revision) === key && (!auth || isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
    && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated));
}
