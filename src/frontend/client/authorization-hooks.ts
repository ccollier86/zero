'use client';

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  hasAnyAuthorizationPermission,
  hasAuthorizationPermission,
  hasEveryAuthorizationPermission,
} from './auth-authorization-types';
import type {
  AuthAuthorizationSnapshot,
  AuthAuthorizationState,
  AuthAuthorizationStatus,
} from './auth-authorization-types';
import { createAuthDisabledError } from './auth-errors';
import type { InternalClient } from './sdk';
import { useClientMaybe } from './client-context';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from './authorization-scope-hooks';

const NOOP_UNSUBSCRIBE = () => {};
const SSR_AUTHORIZATION_STATE: AuthAuthorizationState = Object.freeze({
  status: 'unauthenticated',
  snapshot: null,
  error: null,
});
const DISABLED_AUTHORIZATION_STATE: AuthAuthorizationState = Object.freeze({
  status: 'disabled',
  snapshot: null,
  error: null,
});
const MASKED_AUTHORIZATION_STATE: AuthAuthorizationState = Object.freeze({
  status: 'loading',
  snapshot: null,
  error: null,
});

export interface UseAuthorizationResult {
  /** Current sanitized UI hint. Backend policy remains authoritative. */
  authorization: AuthAuthorizationSnapshot | null;
  status: AuthAuthorizationStatus;
  isLoading: boolean;
  isRefreshing: boolean;
  isReady: boolean;
  error: string | null;
  refresh(): Promise<AuthAuthorizationSnapshot | null>;
}

/** Observe the live, identity/scope-bound browser authorization projection. */
export function useAuthorization(): UseAuthorizationResult {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const disabled = client !== null && authClient === null;
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const subscribe = useCallback(
    (callback: () => void) => authClient
      ? authClient.subscribeAuthorization(callback)
      : NOOP_UNSUBSCRIBE,
    [authClient],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => authClient?.authorizationState
      ?? (disabled ? DISABLED_AUTHORIZATION_STATE : SSR_AUTHORIZATION_STATE),
    () => SSR_AUTHORIZATION_STATE,
  );
  const refresh = useCallback(async () => {
    if (authClient) {
      if (!isAuthorizationScopeCallbackCurrent(
        boundaryKeyRef.current,
        boundaryReadyRef.current,
        callbackBoundaryKey,
      )) throw staleAuthorizationOperation();
      const result = await authClient.refreshAuthorization();
      if (!isAuthorizationScopeCallbackCurrent(
        boundaryKeyRef.current,
        boundaryReadyRef.current,
        callbackBoundaryKey,
      )) throw staleAuthorizationOperation();
      return result;
    }
    if (disabled) throw createAuthDisabledError();
    return null;
  }, [authClient, callbackBoundaryKey, disabled]);

  const visibleState = authorizationBoundary.ready
    ? state
    : MASKED_AUTHORIZATION_STATE;

  return useMemo(() => ({
    authorization: visibleState.snapshot,
    status: visibleState.status,
    isLoading: visibleState.status === 'loading',
    isRefreshing: visibleState.status === 'refreshing',
    isReady: visibleState.status === 'ready' || visibleState.status === 'refreshing',
    error: visibleState.error,
    refresh,
  }), [refresh, visibleState]);
}

function staleAuthorizationOperation(): Error {
  return new Error('The authorization scope changed before the authorization refresh completed.');
}

/** False while loading, unauthenticated, stale-after-error, or revoked. */
export function useHasPermission(permission: string): boolean {
  const current = useAuthorization();
  return current.isReady
    && hasAuthorizationPermission(current.authorization, permission);
}

/** Require every listed permission; an empty list deliberately fails closed. */
export function useHasAllPermissions(permissions: readonly string[]): boolean {
  const current = useAuthorization();
  return current.isReady
    && hasEveryAuthorizationPermission(current.authorization, permissions);
}

/** Require at least one listed permission; an empty list deliberately fails closed. */
export function useHasAnyPermission(permissions: readonly string[]): boolean {
  const current = useAuthorization();
  return current.isReady
    && hasAnyAuthorizationPermission(current.authorization, permissions);
}
