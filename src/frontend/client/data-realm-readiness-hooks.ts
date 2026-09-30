'use client';

import * as React from 'react';
import {
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  type DataRealmReadinessSnapshot,
  type DataRealmReadinessStatus,
} from '../../auth/data-realm-readiness-types';
import { useAuth } from './auth-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import { FetchError, type InternalClient } from './sdk';
import { reportAuthClientActionFailure } from './auth-action-observability';

export type DataRealmReadinessUiStatus =
  | 'disabled'
  | 'loading'
  | 'error'
  | DataRealmReadinessStatus;

export interface UseDataRealmReadinessOptions {
  /** Disable the query and treat the gate as intentionally bypassed. */
  enabled?: boolean;
  /** Fallback poll cadence; server-provided `pollAfterMs` takes precedence. */
  pollIntervalMs?: number;
}

/** Minimal presentation contract accepted by packaged tenant controls. */
export interface DataRealmReadinessControl {
  readonly status: DataRealmReadinessUiStatus;
  readonly isReady: boolean;
  readonly isPending: boolean;
  readonly canRetry: boolean;
  readonly errorCode: string | null;
  retry(): Promise<void>;
}

export interface UseDataRealmReadinessResult
  extends DataRealmReadinessControl {
  readonly snapshot: DataRealmReadinessSnapshot | null;
  readonly isLoading: boolean;
  readonly isProvisioning: boolean;
  readonly isFailed: boolean;
  refresh(): Promise<void>;
}

interface ReadinessHookState {
  readonly boundaryKey: string | null;
  readonly snapshot: DataRealmReadinessSnapshot | null;
  readonly transportErrorCode: string | null;
  readonly transportFailed: boolean;
  readonly loading: boolean;
  readonly retrying: boolean;
}

const INITIAL_STATE: ReadinessHookState = Object.freeze({
  boundaryKey: null,
  snapshot: null,
  transportErrorCode: null,
  transportFailed: false,
  loading: false,
  retrying: false,
});

/**
 * Observe readiness for the currently authenticated, server-derived realm.
 * Results are fenced to the full Guardian authorization scope and are never
 * reused across login, logout, or tenant replacement.
 */
export function useDataRealmReadiness(
  options: UseDataRealmReadinessOptions = {},
): UseDataRealmReadinessResult {
  const client = useClientMaybe();
  const internalClient = client as InternalClient | null;
  const auth = useAuth();
  const boundary = useAuthorizationScopeBoundary(client);
  const enabled = options.enabled !== false;
  const authEnabled = internalClient?.auth !== null && internalClient?.auth !== undefined;
  const shouldLoad = enabled && Boolean(client) && authEnabled
    && auth.isAuthenticated && boundary.ready;
  const fallbackPollMs = clampPollInterval(options.pollIntervalMs);
  const [state, setState] = React.useState<ReadinessHookState>(INITIAL_STATE);
  const requestRevision = React.useRef(0);
  const activeAbort = React.useRef<AbortController | null>(null);
  const boundaryKeyRef = React.useRef(boundary.key);
  const boundaryReadyRef = React.useRef(boundary.ready);
  const stateRef = React.useRef(state);
  boundaryKeyRef.current = boundary.key;
  boundaryReadyRef.current = boundary.ready;
  stateRef.current = state;

  const load = React.useCallback(async (
    operation: 'inspect' | 'retry',
  ): Promise<void> => {
    if (!client || !shouldLoad) return;
    const capturedBoundaryKey = boundary.key;
    const previousSnapshot = stateRef.current.boundaryKey === capturedBoundaryKey
      ? stateRef.current.snapshot
      : null;
    const revision = ++requestRevision.current;
    activeAbort.current?.abort();
    const controller = new AbortController();
    activeAbort.current = controller;
    setState((current) => ({
      ...current,
      boundaryKey: capturedBoundaryKey,
      transportErrorCode: null,
      transportFailed: false,
      loading: current.snapshot === null && operation === 'inspect',
      retrying: operation === 'retry',
    }));

    try {
      const snapshot = operation === 'retry'
        ? await client.dataRealm.retry(controller.signal)
        : await client.dataRealm.getReadiness(controller.signal);
      if (!isCurrentRequest()) return;
      setState({
        boundaryKey: capturedBoundaryKey,
        snapshot,
        transportErrorCode: null,
        transportFailed: false,
        loading: false,
        retrying: false,
      });
    } catch (cause) {
      if (controller.signal.aborted || !isCurrentRequest()) return;
      reportAuthClientActionFailure('dataRealmReadiness', cause, { codeOnly: true });
      const retainedSnapshot = retainDataRealmReadinessSnapshotAfterFailure(
        operation,
        previousSnapshot,
      );
      setState({
        boundaryKey: capturedBoundaryKey,
        // Clone a pending snapshot so the polling effect schedules another
        // bounded idempotent retry after a transient transport failure.
        snapshot: retainedSnapshot ? Object.freeze({ ...retainedSnapshot }) : null,
        transportErrorCode: dataRealmReadinessErrorCode(cause),
        transportFailed: true,
        loading: false,
        retrying: false,
      });
    } finally {
      if (activeAbort.current === controller) activeAbort.current = null;
    }

    function isCurrentRequest(): boolean {
      return revision === requestRevision.current
        && boundaryReadyRef.current
        && boundaryKeyRef.current === capturedBoundaryKey;
    }
  }, [boundary.key, client, shouldLoad]);

  React.useEffect(() => {
    if (!shouldLoad) {
      requestRevision.current += 1;
      activeAbort.current?.abort();
      activeAbort.current = null;
      setState(INITIAL_STATE);
      return;
    }
    void load('inspect').catch(() => undefined);
    return () => {
      requestRevision.current += 1;
      activeAbort.current?.abort();
      activeAbort.current = null;
    };
  }, [load, shouldLoad]);

  const visibleState = state.boundaryKey === boundary.key ? state : INITIAL_STATE;
  React.useEffect(() => {
    const snapshot = visibleState.snapshot;
    const status = snapshot?.status;
    if (!snapshot || !shouldLoad
      || (status !== 'provisioning' && status !== 'retrying')) return;
    const delay = snapshot.pollAfterMs ?? fallbackPollMs;
    const operation = dataRealmReadinessPollOperation(snapshot);
    const timeout = window.setTimeout(() => {
      void load(operation).catch(() => undefined);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [fallbackPollMs, load, shouldLoad, visibleState.snapshot]);

  const refresh = React.useCallback(async () => {
    await load('inspect');
  }, [load]);
  const retry = React.useCallback(async () => {
    const retryFailedRealm = visibleState.snapshot?.status === 'failed'
      && visibleState.snapshot.retryable;
    await load(retryFailedRealm ? 'retry' : 'inspect');
  }, [load, visibleState.snapshot]);

  const status = resolveUiStatus({
    enabled,
    hasClient: Boolean(client),
    authEnabled,
    authenticated: auth.isAuthenticated,
    boundaryReady: boundary.ready,
    state: visibleState,
  });
  const isReady = status === 'ready' || status === 'not-required'
    || status === 'disabled' && !enabled;
  const isPending = status === 'loading' || status === 'provisioning'
    || status === 'retrying';
  const isFailed = status === 'failed' || status === 'error';
  const errorCode = visibleState.snapshot?.errorCode
    ?? visibleState.transportErrorCode;

  return React.useMemo(() => ({
    status,
    snapshot: visibleState.snapshot,
    isReady,
    isPending,
    isLoading: status === 'loading',
    isProvisioning: status === 'provisioning' || status === 'retrying',
    isFailed,
    canRetry: status === 'error'
      || (status === 'failed' && Boolean(visibleState.snapshot?.retryable)),
    errorCode,
    refresh,
    retry,
  }), [
    errorCode,
    isFailed,
    isPending,
    isReady,
    refresh,
    retry,
    status,
    visibleState.snapshot,
  ]);
}

/** @internal Public-safe code extraction used by focused contract tests. */
export function dataRealmReadinessErrorCode(cause: unknown): string | null {
  if (cause instanceof FetchError && isRecord(cause.body)) {
    return normalizeErrorCode(cause.body.code);
  }
  if (isRecord(cause)) return normalizeErrorCode(cause.code);
  return null;
}

/** @internal Pending provisioning advances through the idempotent retry route. */
export function dataRealmReadinessPollOperation(
  snapshot: Pick<DataRealmReadinessSnapshot, 'status'>,
): 'inspect' | 'retry' {
  return snapshot.status === 'provisioning' || snapshot.status === 'retrying'
    ? 'retry'
    : 'inspect';
}

/** @internal Preserve only an in-progress realm across a transient retry failure. */
export function retainDataRealmReadinessSnapshotAfterFailure(
  operation: 'inspect' | 'retry',
  snapshot: DataRealmReadinessSnapshot | null,
): DataRealmReadinessSnapshot | null {
  if (operation !== 'retry' || !snapshot) return null;
  return snapshot.status === 'provisioning' || snapshot.status === 'retrying'
    ? snapshot
    : null;
}

function resolveUiStatus(input: {
  enabled: boolean;
  hasClient: boolean;
  authEnabled: boolean;
  authenticated: boolean;
  boundaryReady: boolean;
  state: ReadinessHookState;
}): DataRealmReadinessUiStatus {
  if (!input.enabled) return 'disabled';
  if (!input.hasClient) return 'loading';
  if (!input.authEnabled) return 'not-required';
  if (!input.boundaryReady) return 'loading';
  if (!input.authenticated) return 'disabled';
  if (input.state.retrying) return 'retrying';
  if (input.state.loading) return 'loading';
  if (input.state.snapshot) return input.state.snapshot.status;
  if (input.state.transportFailed) return 'error';
  return 'loading';
}

function clampPollInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DATA_REALM_READINESS_DEFAULT_POLL_MS;
  }
  return Math.min(
    DATA_REALM_READINESS_MAX_POLL_MS,
    Math.max(DATA_REALM_READINESS_MIN_POLL_MS, Math.round(value)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeErrorCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.test(value)
    ? value
    : null;
}
