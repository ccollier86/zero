'use client';
/** Native live jobs pages. Authorization/selection replacement masks old content during render, not after an effect. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClientMaybe, shouldUseSsrFallback } from './client-context';
import { AuthorizationScopeBoundaryFence, useAuthorizationScopeBoundary, readAuthorizationScopeBoundaryKey,
  isAuthorizationDataReady, isAuthorizationScopeReady } from './authorization-scope-hooks';
import type { Client, InternalClient } from './sdk';
import type { JobPageOptions, JobSchedulePage } from '../../jobs/contracts';

export interface UseJobSchedulesResult {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly page: JobSchedulePage | null;
  readonly error: string | null;
  /** Current-selection committed-change notifications, including unchanged visible pages. Not an insert count. */
  readonly invalidationRevision: number;
  /** Successful transport re-admissions after a published connection, not committed-change evidence. */
  readonly reconnectRevision: number;
  /** Reconcile authorized reads only. Never resubmits an enqueue or control. */
  refresh(): void;
}
export function useJobSchedules(query: JobPageOptions = {}): UseJobSchedulesResult {
  const client = useClientMaybe(), ssr = shouldUseSsrFallback(client, 'useJobSchedules'), boundary = useAuthorizationScopeBoundary(client);
  const currentClient = useRef(client); currentClient.current = client;
  const [revision, setRevision] = useState(0);
  const fence = useRef(new AuthorizationScopeBoundaryFence()).current;
  const key = !ssr && boundary.ready ? JSON.stringify([boundary.key, query.limit ?? 25, query.offset ?? 0, query.control ?? null]) : null;
  const selection = fence.update(key ?? 'unselected');
  const [state, setState] = useState<{ client: typeof client; selection: number; status: 'loading' | 'ready' | 'error';
    page: JobSchedulePage | null; invalidationRevision: number; reconnectRevision: number }>({ client: null, selection: 0,
      status: 'loading', page: null, invalidationRevision: 0, reconnectRevision: 0 });
  useEffect(() => {
    if (!client || !key) return;
    const controller = new AbortController();
    const invalidationRevision = (previous: typeof state) => previous.client === client && previous.selection === selection ? previous.invalidationRevision : 0;
    const reconnectRevision = (previous: typeof state) => previous.client === client && previous.selection === selection ? previous.reconnectRevision : 0;
    setState(previous => ({ client, selection, status: 'loading', page: null, invalidationRevision: invalidationRevision(previous),
      reconnectRevision: reconnectRevision(previous) }));
    const current = () => !controller.signal.aborted && currentClient.current === client && fence.isCurrent(selection)
      && readable(client, boundary.key);
    const failure = () => { if (current()) setState(previous => ({ client, selection, status: 'error', page: null,
      invalidationRevision: invalidationRevision(previous), reconnectRevision: reconnectRevision(previous) })); };
    let remove: (() => void) | undefined;
    try {
      remove = client.jobs.schedules.watch((page, update) => {
        if (current()) setState(previous => ({ client, selection, status: 'ready', page,
          invalidationRevision: invalidationRevision(previous) + (update?.invalidated === true ? 1 : 0),
          reconnectRevision: reconnectRevision(previous) + (update?.reconnected === true ? 1 : 0) }));
      }, {
        query: { limit: query.limit ?? 25, offset: query.offset ?? 0, ...(query.control === undefined ? {} : { control: query.control }) }, signal: controller.signal,
        onError: failure,
      });
    } catch { failure(); }
    return () => { controller.abort(); remove?.(); };
  }, [client, key, boundary.key, selection, fence, revision, query.limit, query.offset, query.control]);
  const refresh = useCallback(() => {
    if (key && currentClient.current === client && fence.isCurrent(selection) && readable(client, boundary.key)) setRevision(value => value + 1);
  }, [client, key, boundary.key, selection, fence]);
  const visible = key && state.client === client && state.selection === selection ? state : null;
  const status = !key ? 'idle' : visible?.status ?? 'loading';
  return { status, page: visible?.page ?? null, invalidationRevision: visible?.invalidationRevision ?? 0,
    reconnectRevision: visible?.reconnectRevision ?? 0,
    error: status === 'error' ? 'Jobs could not be loaded. Reauthorize or retry the read.' : null, refresh };
}

/** A retained stream callback can run before React receives the boundary notification. */
function readable(client: Client | null, key: string): boolean {
  if (!client) return false;
  const internal = client as InternalClient, auth = internal.auth ?? null, revision = internal._authorizationDataBoundary?.revision ?? 0;
  return readAuthorizationScopeBoundaryKey(auth, revision) === key && (!auth
    || isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
      && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated));
}
