'use client';
/** Native live jobs pages. Authorization/selection replacement masks old content during render, not after an effect. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClientMaybe, shouldUseSsrFallback } from './client-context';
import { AuthorizationScopeBoundaryFence, useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import type { JobPageOptions, JobSchedulePage } from '../../jobs/contracts';

export interface UseJobSchedulesResult {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly page: JobSchedulePage | null;
  readonly error: string | null;
  /** Reconcile authorized reads only. Never resubmits an enqueue or control. */
  refresh(): void;
}
export function useJobSchedules(query: JobPageOptions = {}): UseJobSchedulesResult {
  const client = useClientMaybe(), ssr = shouldUseSsrFallback(client, 'useJobSchedules'), boundary = useAuthorizationScopeBoundary(client);
  const [revision, setRevision] = useState(0);
  const fence = useRef(new AuthorizationScopeBoundaryFence()).current;
  const key = !ssr && boundary.ready ? JSON.stringify([boundary.key, query.limit ?? 25, query.offset ?? 0, query.control ?? null]) : null;
  const selection = fence.update(key ?? 'unselected');
  const [state, setState] = useState<{ selection: number; status: 'loading' | 'ready' | 'error'; page: JobSchedulePage | null }>({ selection: 0, status: 'loading', page: null });
  useEffect(() => {
    if (!client || !key) return;
    const controller = new AbortController();
    setState({ selection, status: 'loading', page: null });
    const current = () => !controller.signal.aborted && fence.isCurrent(selection);
    let remove: (() => void) | undefined;
    try {
      remove = client.jobs.schedules.watch(page => { if (current()) setState({ selection, status: 'ready', page }); }, {
        query: { limit: query.limit ?? 25, offset: query.offset ?? 0, ...(query.control === undefined ? {} : { control: query.control }) }, signal: controller.signal,
        onError() { if (current()) setState({ selection, status: 'error', page: null }); },
      });
    } catch { if (current()) setState({ selection, status: 'error', page: null }); }
    return () => { controller.abort(); remove?.(); };
  }, [client, key, selection, fence, revision, query.limit, query.offset, query.control]);
  const refresh = useCallback(() => { if (key && fence.isCurrent(selection)) setRevision(value => value + 1); }, [key, selection, fence]);
  const visible = key && state.selection === selection ? state : null;
  const status = !key ? 'idle' : visible?.status ?? 'loading';
  return { status, page: visible?.page ?? null, error: status === 'error' ? 'Jobs could not be loaded. Reauthorize or retry the read.' : null, refresh };
}
