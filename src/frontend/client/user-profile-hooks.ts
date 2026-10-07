'use client';

/** Own-profile query/acknowledgment state, partitioned by the complete Guardian boundary. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateUserProfileInput, UserProfileSnapshot } from '../../auth/auth-user-profile-types';
import { useAuth, useAuthConfig } from './auth-hooks';
import { useClientMaybe } from './client-context';
import { isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import type { InternalClient } from './sdk';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { getAuthConfigController } from './auth-config-controller';
import { userProfilePolicyKey } from './user-profile-policy';
import { userProfileError } from './user-profile-errors';
import { AuthClientError } from './auth-errors';

export interface UseUserProfileOptions {
  enabled?: boolean;
  /** Connected profile editors retain drafts while refreshing policy, but may not write through an unknown/new policy. */
  capabilityKey?: string;
}
export interface UseUserProfileResult {
  snapshot: UserProfileSnapshot | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  refresh(): Promise<void>;
  update(input: UpdateUserProfileInput, signal?: AbortSignal): Promise<UserProfileSnapshot>;
}
interface ProfileState {
  key: string | null;
  policyKey?: string;
  snapshot: UserProfileSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}
const EMPTY: ProfileState = { key: null, snapshot: null, loading: false, saving: false, error: null };

/** A current request boundary does not prove a reply belongs to the current account. */
function assertOwnProfile(snapshot: UserProfileSnapshot, userId: string | undefined): void {
  if (snapshot.userId !== userId) throw new AuthClientError(
    'Profile response did not belong to this account.', 200, 'AUTH_PROFILE_RESPONSE_INVALID', null,
  );
}

export function useUserProfile(options: UseUserProfileOptions = {}): UseUserProfileResult {
  const client = useClientMaybe(), auth = useAuth(), boundary = useAuthorizationScopeBoundary(client);
  const config = useAuthConfig(), policyKey = options.capabilityKey;
  const enabled = options.enabled !== false && Boolean(client) && auth.isAuthenticated && boundary.ready;
  const [state, setState] = useState<ProfileState>(EMPTY);
  const requests = useRef(new Set<AbortController>()), sequence = useRef(0), write = useRef<object | null>(null);
  const mounted = useRef(true), latest = useRef({ enabled, key: boundary.key, policyKey });
  latest.current = { enabled, key: boundary.key, policyKey };
  const currentScope = useCallback((key: string) => {
    const internal = client as InternalClient | null;
    const liveAuth = internal?.auth, revision = internal?._authorizationDataBoundary?.revision ?? 0;
    if (!liveAuth || latest.current.policyKey !== policyKey) return false;
    if (policyKey !== undefined) {
      const policy = getAuthConfigController(liveAuth).getSnapshot();
      if (policy.status !== 'ready' || userProfilePolicyKey(policy.config?.userProfile) !== policyKey) return false;
    }
    return mounted.current && latest.current.enabled
      && latest.current.key === key
      && readAuthorizationScopeBoundaryKey(liveAuth ?? null, revision) === key
      && liveAuth.isAuthenticated
      && isAuthorizationScopeReady(liveAuth.sessionTransition, liveAuth.isRestoring)
      && isAuthorizationDataReady(revision, liveAuth.authorizationState.status, liveAuth.isAuthenticated);
  }, [client, policyKey]);
  const current = useCallback((key: string, controller: AbortController) => !controller.signal.aborted && currentScope(key), [currentScope]);
  const refresh = useCallback(async () => {
    if (!client || !enabled) return;
    const key = boundary.key, ticket = ++sequence.current, controller = new AbortController();
    if (!current(key, controller)) return;
    requests.current.add(controller);
    setState(old => ({ ...(old.key === key && old.policyKey === policyKey ? old : EMPTY), key, policyKey, loading: true, error: null }));
    try {
      const snapshot = await client.userProfile.get(controller.signal);
      if (ticket !== sequence.current || !current(key, controller)) return;
      assertOwnProfile(snapshot, (client as InternalClient).auth?.user?.userId);
      setState(old => ({ ...old, key, policyKey, snapshot, loading: false, error: null }));
    } catch (cause) {
      if (ticket !== sequence.current || !current(key, controller)) return;
      reportAuthClientActionFailure('userProfile', cause, { codeOnly: true });
      setState(old => ({ ...old, key, policyKey, loading: false, error: userProfileError(cause) }));
    } finally { requests.current.delete(controller); }
  }, [boundary.key, client, current, enabled]);
  const update = useCallback(async (input: UpdateUserProfileInput, signal?: AbortSignal) => {
    if (!client || !enabled) throw new DOMException('Profile scope is no longer available.', 'AbortError');
    if (write.current) throw new Error('A profile save is already pending.');
    const key = boundary.key, controller = new AbortController(), token = {};
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    if (!current(key, controller)) {
      signal?.removeEventListener('abort', abort);
      throw new DOMException('Profile scope is no longer available.', 'AbortError');
    }
    write.current = token; requests.current.add(controller); ++sequence.current;
    setState(old => ({ ...(old.key === key && old.policyKey === policyKey ? old : EMPTY), key, policyKey, saving: true, error: null }));
    try {
      const snapshot = await client.userProfile.update(input, controller.signal);
      if (!current(key, controller)) throw new DOMException('Profile scope changed.', 'AbortError');
      assertOwnProfile(snapshot, (client as InternalClient).auth?.user?.userId);
      ++sequence.current;
      setState({ key, policyKey, snapshot, saving: false, loading: false, error: null });
      return snapshot;
    } catch (cause) {
      if (!current(key, controller)) throw new DOMException('Profile scope changed.', 'AbortError');
      reportAuthClientActionFailure('userProfile', cause, { codeOnly: true });
      setState(old => ({ ...old, key, policyKey, saving: false, error: userProfileError(cause) }));
      throw cause;
    } finally {
      requests.current.delete(controller); signal?.removeEventListener('abort', abort);
      if (write.current === token) {
        write.current = null;
        // Cancellation in the same readable scope must release pending UI too.
        // A retired/replaced operation cannot clear another account's save state.
        if (currentScope(key)) setState(old => old.key === key ? { ...old, saving: false } : old);
      }
    }
  }, [boundary.key, client, current, currentScope, enabled]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const controller of requests.current) controller.abort(); requests.current.clear(); };
  }, []);
  useEffect(() => {
    if (enabled) void refresh(); else setState(EMPTY);
    return () => {
      ++sequence.current; write.current = null;
      for (const controller of requests.current) controller.abort(); requests.current.clear();
    };
  }, [enabled, refresh]);
  useEffect(() => {
    if (policyKey === undefined || config.status === 'ready') return;
    ++sequence.current; write.current = null;
    for (const controller of requests.current) controller.abort(); requests.current.clear();
    setState(old => ({ ...old, loading: false, saving: false }));
  }, [config.status, policyKey]);
  const visible = enabled && state.key === boundary.key && state.policyKey === policyKey ? state : EMPTY;
  return { snapshot: visible.snapshot, isLoading: visible.loading || enabled && visible.snapshot === null && visible.error === null,
    isSaving: visible.saving, error: visible.error, refresh, update };
}
