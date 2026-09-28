'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { AuthClient } from './auth-client';
import type { AuthSessionTransitionState } from './auth-types';
import type { Client, InternalClient } from './sdk';
import { useClientMaybe } from './client-context';

const NOOP_UNSUBSCRIBE = () => {};
const SSR_BOUNDARY_KEY = JSON.stringify(['ssr']);

export interface AuthorizationScopeBoundary {
  /** Changes synchronously before, during, and after a scope replacement. */
  readonly key: string;
  /** Stable identity of the committed browser authorization family and scope. */
  readonly scopeKey: string;
  /** False while old data must be masked and new requests must remain frozen. */
  readonly stable: boolean;
  /** False during initial stored-session restoration as well as transitions. */
  readonly ready: boolean;
  readonly phase: AuthSessionTransitionState['phase'];
}

/** A committed or recoverable scope may safely back UI reads. */
export function isAuthorizationScopeStable(
  transition: AuthSessionTransitionState,
): boolean {
  return transition.phase === 'idle' || transition.phase === 'recovery-required';
}

/**
 * Shared browser cache boundary for every Zero-owned hook.
 *
 * The opaque scope key changes on ordinary login, logout, tenant replacement,
 * and cross-tab session replacement while remaining stable across refresh-token
 * rotation inside the same authorization family. Transition phase/revision are
 * included so subscribers synchronously hide old data at `preparing`, before
 * the replacement credential is committed.
 */
export function readAuthorizationScopeBoundaryKey(auth: AuthClient | null): string {
  if (!auth) return JSON.stringify(['auth-disabled']);
  const transition = auth.sessionTransition;
  return JSON.stringify([
    auth.authorizationScopeKey,
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
    auth.isLoading,
    transition.phase,
    transition.revision,
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
  const auth = (client as InternalClient | null)?.auth ?? null;
  const subscribe = useCallback(
    (callback: () => void) => auth ? auth.subscribe(callback) : NOOP_UNSUBSCRIBE,
    [auth],
  );
  const getSnapshot = useCallback(
    () => readAuthorizationScopeBoundaryKey(auth),
    [auth],
  );
  const key = useSyncExternalStore(subscribe, getSnapshot, () => SSR_BOUNDARY_KEY);
  const phase = auth?.sessionTransition.phase ?? 'idle';
  const stable = auth ? isAuthorizationScopeStable(auth.sessionTransition) : true;

  return {
    key,
    scopeKey: readAuthorizationScopeIdentityKey(auth),
    stable,
    ready: stable && !(auth?.isLoading ?? false),
    phase,
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
