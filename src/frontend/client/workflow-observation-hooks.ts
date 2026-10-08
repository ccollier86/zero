'use client';

/**
 * Optional readiness for one durable workflow. Reads through the authenticated
 * SDK and observes supplied live projections; never polls, writes the sync store,
 * starts/replays work, or distinguishes forbidden from nonexistent resources.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkflowClientInstanceRecord } from '../../workflows/types';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from './observability';
import { FetchError } from './sdk';
import { shouldUseSsrFallback, useClientMaybe } from './client-context';
import { AuthorizationScopeBoundaryFence, useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useStatus } from './data-hooks';

/** Missing local rows and a connected WebSocket are not authoritative availability. */
export type WorkflowObservationStatus = 'idle' | 'loading' | 'ready' | 'unavailable'
  | 'reconnecting' | 'offline' | 'error' | 'retired';

/** Safe observation of the selected run; status reads do not imply completion. */
export interface UseWorkflowObservationResult {
  readonly status: WorkflowObservationStatus;
  readonly instance: WorkflowClientInstanceRecord | null;
  readonly connected: boolean;
  readonly isLoading: boolean;
  /** Explicit read reconciliation only; never retries a start or mutation. */
  reload(): void;
}

interface ReadState {
  readonly selection: number;
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  readonly instance: WorkflowClientInstanceRecord | null;
}
const EMPTY: ReadState = Object.freeze({ selection: 0, status: 'idle', instance: null });
const noop = () => {};
function subscribeOnline(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.addEventListener) return noop;
  window.addEventListener('online', callback); window.addEventListener('offline', callback);
  return () => { window.removeEventListener('online', callback); window.removeEventListener('offline', callback); };
}
const onlineSnapshot = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * Pair with useWorkflow/useWorkflowRun and pass its current instance to avoid
 * duplicate collection subscriptions. An absent projection gets one authorized
 * read; reconnect/explicit reload reconciles it with current server authority.
 */
export function useWorkflowObservation(
  instanceId: string | null,
  liveInstance: WorkflowClientInstanceRecord | null,
): UseWorkflowObservationResult {
  const client = useClientMaybe();
  const ssr = shouldUseSsrFallback(client, 'useWorkflowObservation');
  const boundary = useAuthorizationScopeBoundary(client);
  const { connected } = useStatus();
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [read, setRead] = useState<ReadState>(EMPTY);
  const request = useRef(0);
  const previousConnected = useRef(connected);
  const selectionFence = useRef(new AuthorizationScopeBoundaryFence()).current;
  const mounted = useRef(false);
  const key = instanceId && boundary.ready && !ssr ? JSON.stringify([boundary.key, instanceId]) : null;
  // Identity strings can repeat (A -> B -> A). Retained snapshots/callbacks
  // belong to this selection incarnation, not merely to the same run ID.
  const selection = selectionFence.update(key ?? 'unselected');
  const live = liveInstance?.instance_id === instanceId && boundary.ready ? liveInstance : null;
  const hasLive = live !== null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current++; };
  }, []);

  useEffect(() => {
    const operation = ++request.current;
    const reconnected = connected && !previousConnected.current;
    previousConnected.current = connected;
    if (!client || !instanceId || !key) { setRead(EMPTY); return; }
    if (hasLive && !reconnected && reloadRevision === 0) {
      setRead({ selection, status: 'ready', instance: null });
      return;
    }
    const controller = new AbortController();
    setRead({ selection, status: 'loading', instance: null });
    void client.fetch<WorkflowClientInstanceRecord>(`/workflows/${encodeURIComponent(instanceId)}`, { signal: controller.signal })
      .then(instance => {
        if (!mounted.current || controller.signal.aborted || operation !== request.current || !selectionFence.isCurrent(selection)) return;
        if (!instance || instance.instance_id !== instanceId
          || !['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'].includes(instance.status)) {
          throw new Error('Invalid workflow observation response.');
        }
        setRead({ selection, status: 'ready', instance });
      })
      .catch(error => {
        if (!mounted.current || controller.signal.aborted || operation !== request.current || !selectionFence.isCurrent(selection)) return;
        if (error instanceof FetchError && error.status === 404) {
          setRead({ selection, status: 'unavailable', instance: null });
          return;
        }
        emitFrontendCode(OBS_CODES.FRONTEND_WORKFLOW_OBSERVATION_FAILED, { metadata: { action: 'read' } });
        setRead({ selection, status: 'error', instance: null });
      });
    return () => { controller.abort(); if (operation === request.current) request.current++; };
  }, [client, instanceId, key, selection, selectionFence, connected, hasLive, reloadRevision]);

  const reload = useCallback(() => {
    if (mounted.current && key && selectionFence.isCurrent(selection)) setReloadRevision(revision => revision + 1);
  }, [key, selection, selectionFence]);
  const visible = read.selection === selection ? read : EMPTY;
  let status: WorkflowObservationStatus;
  if (!instanceId) status = 'idle';
  else if (!boundary.stable) status = 'retired';
  else if (!key) status = 'loading';
  else if (!online) status = 'offline';
  else if (!connected) status = 'reconnecting';
  else if (visible.status === 'unavailable' || visible.status === 'error') status = visible.status;
  else if (hasLive || visible.status === 'ready') status = 'ready';
  else status = 'loading';
  const instance = key && visible.status !== 'unavailable' ? live ?? visible.instance : null;
  return { status, instance, connected, isLoading: status === 'loading' || visible.status === 'loading', reload };
}
