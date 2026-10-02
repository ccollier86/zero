'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { AuthClient } from './auth-client';
import type { AuthSessionTransitionState } from './auth-types';
import type { Client, InternalClient } from './sdk';
import type { AuthorizationDataBoundarySource } from './authorization-data-boundary';
import { useClientMaybe } from './client-context';
import {
  isAuthorizationDataReady,
  isAuthorizationScopeReady,
  isAuthorizationScopeStable,
} from './authorization-scope-readiness';

export {
  isAuthorizationDataReady,
  isAuthorizationScopeReady,
  isAuthorizationScopeStable,
} from './authorization-scope-readiness';

const NOOP_UNSUBSCRIBE = () => {};
const SSR_BOUNDARY_KEY = JSON.stringify(['ssr']);

export interface AuthorizationScopeBoundary {
  /** Changes synchronously before, during, and after a scope replacement. */
  readonly key: string;
  /** Stable identity of the committed browser authorization family and scope. */
  readonly scopeKey: string;
  /** Monotonic local cache fence for same-scope server authority changes. */
  readonly dataRevision: number;
  /** False while old data must be masked and new requests must remain frozen. */
  readonly stable: boolean;
  /** False during initial stored-session restoration as well as transitions. */
  readonly ready: boolean;
  readonly phase: AuthSessionTransitionState['phase'];
}

/**
 * Shared browser cache boundary for every Zero-owned hook.
 *
 * The opaque scope key changes on ordinary login, logout, tenant replacement,
 * cross-tab session replacement, and a server-declared same-scope read-authority
 * change while remaining stable across an ordinary refresh-token rotation.
 * Transition phase/revision are included so subscribers synchronously hide old
 * data at `preparing`, before the replacement credential is committed.
 */
export function readAuthorizationScopeBoundaryKey(
  auth: AuthClient | null,
  dataRevision = 0,
): string {
  if (!auth) return JSON.stringify(['auth-disabled', dataRevision]);
  const transition = auth.sessionTransition;
  const authorizationStatus = auth.authorizationState?.status ?? null;
  const dataReady = isAuthorizationDataReady(
    dataRevision,
    authorizationStatus,
    auth.isAuthenticated,
  );
  const dataValidation = dataRevision === 0 && dataReady
    ? 'initial'
    : dataReady
      ? 'validated'
      : 'unvalidated';
  return JSON.stringify([
    auth.authorizationScopeKey,
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
    auth.isLoading,
    transition.phase,
    transition.revision,
    dataRevision,
    dataValidation,
  ]);
}

/** Stable key used to remount a complete app subtree after scope replacement. */
export function readAuthorizationScopeIdentityKey(auth: AuthClient | null): string {
  if (!auth) return JSON.stringify(['auth-disabled']);
  return JSON.stringify([
    auth.authorizationScopeKey,
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
  ]);
}

/** Return true only when a callback still belongs to the current readable scope. */
export function isAuthorizationScopeCallbackCurrent(
  currentKey: string,
  ready: boolean,
  capturedKey: string,
): boolean {
  return ready && currentKey === capturedKey;
}

/**
 * Subscribe a React surface to the SDK's complete authorization boundary.
 *
 * Public callers normally omit `clientOverride` and read the nearest
 * ClientProvider. The returned keys are opaque cache-partition identifiers;
 * this surface never exposes access or refresh credentials.
 */
export function useAuthorizationScopeBoundary(
  clientOverride?: Client | null,
): AuthorizationScopeBoundary {
  const contextClient = useClientMaybe();
  if (clientOverride === undefined && !contextClient && typeof window !== 'undefined') {
    throw new Error(
      'useAuthorizationScopeBoundary must be used within <AppProvider> or <ClientProvider>.',
    );
  }
  const client = clientOverride === undefined ? contextClient : clientOverride;
  const internal = client as InternalClient | null;
  const auth = internal?.auth ?? null;
  const dataBoundary = internal?._authorizationDataBoundary ?? null;
  const subscribe = useCallback(
    (callback: () => void) => subscribeToAuthorizationBoundary(
      auth,
      dataBoundary,
      callback,
    ),
    [auth, dataBoundary],
  );
  const getSnapshot = useCallback(
    () => readAuthorizationScopeBoundaryKey(auth, dataBoundary?.revision ?? 0),
    [auth, dataBoundary],
  );
  const key = useSyncExternalStore(subscribe, getSnapshot, () => SSR_BOUNDARY_KEY);
  const phase = auth?.sessionTransition.phase ?? 'idle';
  const stable = auth ? isAuthorizationScopeStable(auth.sessionTransition) : true;
  const dataRevision = dataBoundary?.revision ?? 0;
  const ready = auth
    ? isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
      && isAuthorizationDataReady(
        dataRevision,
        auth.authorizationState.status,
        auth.isAuthenticated,
      )
    : true;

  return {
    key,
    scopeKey: readAuthorizationScopeIdentityKey(auth),
    dataRevision,
    stable,
    ready,
    phase,
  };
}

function subscribeToAuthorizationBoundary(
  auth: AuthClient | null,
  dataBoundary: AuthorizationDataBoundarySource | null,
  callback: () => void,
): () => void {
  const unsubscribeAuth = auth?.subscribe(callback) ?? NOOP_UNSUBSCRIBE;
  const unsubscribeAuthorization = auth?.subscribeAuthorization(callback)
    ?? NOOP_UNSUBSCRIBE;
  const unsubscribeData = dataBoundary?.subscribe(callback) ?? NOOP_UNSUBSCRIBE;
  return () => {
    unsubscribeAuth();
    unsubscribeAuthorization();
    unsubscribeData();
  };
}

/** Monotonic async-result fence shared by authorization-scoped React hooks. */
export class AuthorizationScopeBoundaryFence {
  private key: string | undefined;
  private revision = 0;

  update(key: string): number {
    if (key !== this.key) {
      this.key = key;
      this.revision += 1;
    }
    return this.revision;
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }
}
