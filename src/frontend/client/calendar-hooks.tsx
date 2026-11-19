'use client';
/** Scope-owned authorized reads; stale content is masked during render, before effect cleanup or a late callback. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClientMaybe, shouldUseSsrFallback } from './client-context';
import { AuthorizationScopeBoundaryFence, useAuthorizationScopeBoundary, readAuthorizationScopeBoundaryKey,
  isAuthorizationDataReady, isAuthorizationScopeReady } from './authorization-scope-hooks';
import type { Client, InternalClient } from './sdk';
import type { CalendarAppointmentPage, CalendarAppointmentView, CalendarAppointmentTypePage, CalendarAppointmentTypePageQuery, CalendarAppointmentTypeView, CalendarResourceTypesView,
  CalendarLifecyclePolicy, CalendarAppointmentTransitions, CalendarCapabilities, CalendarAvailabilityPolicyView,
  CalendarParticipantDirectoryQuery, CalendarParticipantDirectoryPage, CalendarParticipantsView,
  CalendarLocationPage, CalendarLocationPageQuery, CalendarLocationView, CalendarResourceLocationsView, CalendarResourceLocationPolicyView, CalendarVisitLocationQuery,
  CalendarRangeQuery, CalendarDateRangeQuery, CalendarResourcePage, CalendarResourcePageQuery, CalendarWatchOptions, CalendarWatchUpdate } from '../../calendar/contracts';
import { CalendarReadError } from './calendar-mutation';
import type { CalendarOverrideGrantView } from '../../calendar/contracts';
export function useCalendarOverrideGrant(resourceId: string | null, userId: string | null, readRevision?: string | number): CalendarReadResult<CalendarOverrideGrantView> {
  return useCalendarLive<CalendarOverrideGrantView>(resourceId === null || userId === null ? null : JSON.stringify(['override-grant', resourceId, userId, readRevision ?? null]),
    (client, listener, options) => client.calendar.overrides.grants.watch(resourceId!, userId!, listener, options));
}
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
export function useCalendarCapabilities(): CalendarReadResult<CalendarCapabilities> {
  return useCalendarLive<CalendarCapabilities>('capabilities', (client, listener, options) => client.calendar.capabilities.watch(listener, options));
}
export function useCalendarAvailabilityPolicy(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarAvailabilityPolicyView> {
  return useCalendarLive<CalendarAvailabilityPolicyView>(id === null ? null : JSON.stringify(['availability-policy', id, readRevision ?? null]),
    (client, listener, options) => client.calendar.availability.policy.watch(id!, listener, options));
}
export function useCalendarParticipantDirectory(query: CalendarParticipantDirectoryQuery | null): CalendarReadResult<CalendarParticipantDirectoryPage> {
  return useCalendarLive<CalendarParticipantDirectoryPage>(query === null ? null : JSON.stringify(['participant-directory', query.search ?? '', query.limit ?? null, query.after ?? null]),
    (client, listener, options) => client.calendar.participants.watchDirectory(query!, listener, options));
}
export function useCalendarAppointmentParticipants(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarParticipantsView> {
  return useCalendarLive<CalendarParticipantsView>(id === null ? null : JSON.stringify(['appointment-participants', id, readRevision ?? null]),
    (client, listener, options) => client.calendar.participants.watchForAppointment(id!, listener, options));
}
export function useCalendarHoldParticipants(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarParticipantsView> {
  return useCalendarLive<CalendarParticipantsView>(id === null ? null : JSON.stringify(['hold-participants', id, readRevision ?? null]),
    (client, listener, options) => client.calendar.participants.watchForHold(id!, listener, options));
}
export function useCalendarResources(query: CalendarResourcePageQuery = {}): CalendarReadResult<CalendarResourcePage> {
  return useCalendarLive<CalendarResourcePage>(JSON.stringify(['resources', query.limit ?? null, query.after ?? null, query.locationIds ?? [], query.regions ?? []]),
    (client, listener, options) => client.calendar.resources.watch(query, listener, options));
}
export function useCalendarLocations(query: CalendarLocationPageQuery = {}): CalendarReadResult<CalendarLocationPage> {
  return useCalendarLive<CalendarLocationPage>(JSON.stringify(['locations', query.limit ?? null, query.after ?? null]),
    (client, listener, options) => client.calendar.locations.watch(query, listener, options));
}
export function useCalendarVisitLocations(query: CalendarVisitLocationQuery | null): CalendarReadResult<CalendarLocationPage> {
  return useCalendarLive<CalendarLocationPage>(query === null ? null : JSON.stringify(['visit-locations', query.resourceIds, query.limit ?? null, query.after ?? null, query.interval ?? null]),
    (client, listener, options) => client.calendar.locations.watchForVisit(query!, listener, options));
}
export function useCalendarResourceLocationPolicy(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarResourceLocationPolicyView> {
  return useCalendarLive<CalendarResourceLocationPolicyView>(id === null ? null : JSON.stringify(['location-policy', id, readRevision ?? null]),
    (client, listener, options) => client.calendar.locations.policy.watch(id!, listener, options));
}
export function useCalendarAppointmentTypes(query: CalendarAppointmentTypePageQuery = {}): CalendarReadResult<CalendarAppointmentTypePage> {
  return useCalendarLive<CalendarAppointmentTypePage>(JSON.stringify(['appointment-types', query.resourceIds ?? null, query.limit ?? null, query.after ?? null]),
    (client, listener, options) => client.calendar.types.watch(query, listener, options));
}
export function useCalendarAppointmentType(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarAppointmentTypeView> {
  return useCalendarLive<CalendarAppointmentTypeView>(id === null ? null : JSON.stringify(['appointment-type', id, readRevision ?? null]),
    (client, listener, options) => client.calendar.types.watchType(id!, listener, options));
}
export function useCalendarResourceTypes(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarResourceTypesView> {
  return useCalendarLive<CalendarResourceTypesView>(id === null ? null : JSON.stringify(['resource-types', id, readRevision ?? null]),
    (client, listener, options) => client.calendar.types.watchForResource(id!, listener, options));
}
export function useCalendarLocation(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarLocationView> {
  return useCalendarLive<CalendarLocationView>(id === null ? null : JSON.stringify(['location', id, readRevision ?? null]),
    (client, listener, options) => client.calendar.locations.watchLocation(id!, listener, options));
}
export function useCalendarResourceLocations(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarResourceLocationsView> {
  return useCalendarLive<CalendarResourceLocationsView>(id === null ? null : JSON.stringify(['resource-locations', id, readRevision ?? null]),
    (client, listener, options) => client.calendar.locations.watchForResource(id!, listener, options));
}
export function useCalendarAppointment(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarAppointmentView> {
  return useCalendarRead(id === null ? null : JSON.stringify(['appointment', id, readRevision ?? null]), (client, signal) => client.calendar.appointments.get(id!, { signal }));
}
export function useCalendarLifecycle(): CalendarReadResult<CalendarLifecyclePolicy> {
  return useCalendarLive<CalendarLifecyclePolicy>('lifecycle', (client, listener, options) => client.calendar.lifecycle.watch(listener, options));
}
export function useCalendarAppointmentTransitions(id: string | null, readRevision?: string | number): CalendarReadResult<CalendarAppointmentTransitions> {
  return useCalendarLive<CalendarAppointmentTransitions>(id === null ? null : JSON.stringify(['appointment-transitions', id, readRevision ?? null]),
    (client, listener, options) => client.calendar.appointments.watchTransitions(id!, listener, options));
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
  const identity = query === null ? null : JSON.stringify([query.resourceIds, query.startAt, query.endAt, query.limit ?? null]);
  return useCalendarLive<CalendarAppointmentPage>(identity, (client, listener, options) => client.calendar.appointments.watch(query!, listener, options));
}
export function useCalendarAppointmentDates(query: CalendarDateRangeQuery | null): UseCalendarAppointmentsResult {
  const identity = query === null ? null : JSON.stringify(['appointment-dates', query.resourceIds, query.startDate, query.endDate, query.limit ?? null]);
  return useCalendarLive<CalendarAppointmentPage>(identity, (client, listener, options) => client.calendar.appointments.watchDates(query!, listener, options));
}
/** Directory and appointment views share the same current-scope retirement contract. */
function useCalendarLive<T>(identity: string | null,
  watch: (client: Client, listener: (page: T, update?: CalendarWatchUpdate) => void, options: CalendarWatchOptions) => () => void
): CalendarReadResult<T> & { readonly invalidationRevision: number; readonly reconnectRevision: number } {
  const client = useClientMaybe(), ssr = shouldUseSsrFallback(client, 'useCalendarLive'), boundary = useAuthorizationScopeBoundary(client);
  const currentClient = useRef(client); currentClient.current = client;
  const watchRef = useRef(watch); watchRef.current = watch;
  const [revision, setRevision] = useState(0), fence = useRef(new AuthorizationScopeBoundaryFence()).current;
  const key = !ssr && boundary.ready && identity !== null ? JSON.stringify([boundary.key, identity]) : null, selection = fence.update(key ?? 'unselected');
  const [state, setState] = useState<{ client: typeof client; selection: number; requestRevision: number; status: 'loading' | 'ready' | 'error'; value: T | null; code: string | null;
    invalidationRevision: number; reconnectRevision: number }>({ client: null, selection: 0, requestRevision: 0, status: 'loading', value: null, code: null, invalidationRevision: 0, reconnectRevision: 0 });
  useEffect(() => {
    if (!client || !key) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && currentClient.current === client && fence.isCurrent(selection) && calendarScopeReadable(client, boundary.key);
    const counts = (old: typeof state) => old.client === client && old.selection === selection
      ? { invalidationRevision: old.invalidationRevision, reconnectRevision: old.reconnectRevision } : { invalidationRevision: 0, reconnectRevision: 0 };
    setState(old => ({ client, selection, requestRevision: revision, status: 'loading', value: null, code: null, ...counts(old) }));
    let stop: (() => void) | undefined, stopped = false;
    const retire = () => { controller.abort(); if (stop && !stopped) { stopped = true; stop(); } };
    const failure = (error?: unknown) => { if (current()) {
      setState(old => ({ client, selection, requestRevision: revision, status: 'error', value: null,
        code: error instanceof CalendarReadError ? error.code : null, ...counts(old) }));
      retire();
    } };
    try { stop = watchRef.current(client, (value, update) => {
      if (current()) setState(old => { const previous = counts(old); return { client, selection, requestRevision: revision, status: 'ready', value, code: null,
        invalidationRevision: previous.invalidationRevision + (update?.invalidated === true ? 1 : 0),
        reconnectRevision: previous.reconnectRevision + (update?.reconnected === true ? 1 : 0) }; });
    }, { signal: controller.signal, onError: failure });
      // A synchronous failure can precede installation of its removal capability.
      if (controller.signal.aborted) retire();
    } catch (error) { failure(error); }
    return retire;
  }, [client, key, boundary.key, selection, fence, revision]);
  const refresh = useCallback(() => { if (key && currentClient.current === client && fence.isCurrent(selection) && calendarScopeReadable(client, boundary.key)) setRevision(value => value + 1); }, [client, key, selection, fence, boundary.key]);
  const visible = key && state.client === client && state.selection === selection && state.requestRevision === revision ? state : null, status = !key ? 'idle' : visible?.status ?? 'loading';
  return { status, value: visible?.value ?? null, code: visible?.code ?? null, error: status === 'error' ? 'Calendar data could not be loaded. Reauthorize or retry the read.' : null,
    invalidationRevision: visible?.invalidationRevision ?? 0, reconnectRevision: visible?.reconnectRevision ?? 0, refresh };
}
/** A queued callback may run before React has observed the authority notification. */
export function calendarScopeReadable(client: Client | null, key: string): boolean {
  if (!client) return false;
  const internal = client as InternalClient, auth = internal.auth ?? null, revision = internal._authorizationDataBoundary?.revision ?? 0;
  return readAuthorizationScopeBoundaryKey(auth, revision) === key && (!auth || isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
    && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated));
}
