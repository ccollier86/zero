'use client';

/** Own-avatar query, acknowledged mutations and private object URLs. Guardian/config retirement cancels every request. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserAvatarSnapshot } from '../../auth/auth-user-avatar-types';
import type { AuthUserAvatarTransport } from './auth-user-avatar-transport';
import type { InternalClient } from './sdk';
import { useAuth } from './auth-hooks';
import { useClientMaybe } from './client-context';
import { getAuthConfigController } from './auth-config-controller';
import { isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey, useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { userAvatarError } from './user-avatar-errors';

interface AvatarState { key: string | null; policyKey?: string; snapshot: UserAvatarSnapshot | null; loading: boolean; saving: boolean; error: string | null }
const EMPTY: AvatarState = { key: null, snapshot: null, loading: false, saving: false, error: null };
export interface UseUserAvatarOptions { enabled?: boolean; capabilityKey?: string }
/** No arbitrary user id is accepted; private avatar bytes are rendered only in the current own-account scope. */
export function useUserAvatar(options: UseUserAvatarOptions = {}) {
  const client = useClientMaybe(), auth = useAuth(), boundary = useAuthorizationScopeBoundary(client);
  const enabled = options.enabled !== false && Boolean(client) && auth.isAuthenticated && boundary.ready, policyKey = options.capabilityKey;
  const [state, setState] = useState<AvatarState>(EMPTY), [url, setUrl] = useState<{ key: string; policyKey?: string; assetId: string; value: string } | null>(null);
  const mounted = useRef(true), latest = useRef({ enabled, key: boundary.key, policyKey }); latest.current = { enabled, key: boundary.key, policyKey };
  const requests = useRef(new Set<AbortController>()), sequence = useRef(0), write = useRef<object | null>(null);
  const current = useCallback((key: string) => {
    const internal = client as InternalClient | null, live = internal?.auth, revision = internal?._authorizationDataBoundary?.revision ?? 0;
    if (!live || !mounted.current || !latest.current.enabled || latest.current.key !== key || latest.current.policyKey !== policyKey) return false;
    if (policyKey !== undefined) {
      const policy = getAuthConfigController(live).getSnapshot();
      if (policy.status !== 'ready' || JSON.stringify(policy.config?.userProfile?.avatars) !== policyKey) return false;
    }
    return live.isAuthenticated && readAuthorizationScopeBoundaryKey(live, revision) === key
      && isAuthorizationScopeReady(live.sessionTransition, live.isRestoring)
      && isAuthorizationDataReady(revision, live.authorizationState.status, live.isAuthenticated);
  }, [client, policyKey]);
  const refresh = useCallback(async () => {
    if (!client || !enabled) return;
    const key = boundary.key, ticket = ++sequence.current, controller = new AbortController();
    if (!current(key)) return;
    requests.current.add(controller); setState(old => ({ ...(old.key === key && old.policyKey === policyKey ? old : EMPTY), key, policyKey, loading: true, error: null }));
    try {
      const snapshot = await client.userAvatar.get(controller.signal);
      if (controller.signal.aborted || ticket !== sequence.current || !current(key)) return;
      if (snapshot.userId !== (client as InternalClient).auth?.user?.userId) throw new Error('Avatar response belongs to another account.');
      setState(old => ({ ...old, key, policyKey, snapshot, loading: false, error: null }));
    } catch (cause) {
      if (controller.signal.aborted || ticket !== sequence.current || !current(key)) return;
      reportAuthClientActionFailure('userAvatar', cause, { codeOnly: true });
      setState(old => ({ ...old, key, policyKey, loading: false, error: userAvatarError(cause) }));
    } finally { requests.current.delete(controller); }
  }, [boundary.key, client, current, enabled]);
  const mutate = useCallback(async (operation: (api: AuthUserAvatarTransport, signal: AbortSignal) => Promise<UserAvatarSnapshot>, signal?: AbortSignal) => {
    const key = boundary.key, controller = new AbortController(), token = {};
    if (!client || !enabled || !current(key) || signal?.aborted) throw retiredAvatar();
    if (write.current) throw new Error('An avatar save is already pending.');
    const abort = () => controller.abort(signal?.reason); signal?.addEventListener('abort', abort, { once: true });
    write.current = token; requests.current.add(controller); ++sequence.current;
    setState(old => ({ ...(old.key === key && old.policyKey === policyKey ? old : EMPTY), key, policyKey, saving: true, error: null }));
    try {
      const snapshot = await operation(client.userAvatar, controller.signal);
      if (controller.signal.aborted || !current(key)) throw retiredAvatar();
      if (snapshot.userId !== (client as InternalClient).auth?.user?.userId) throw new Error('Avatar response belongs to another account.');
      ++sequence.current; setState({ key, policyKey, snapshot, loading: false, saving: false, error: null }); return snapshot;
    } catch (cause) {
      if (controller.signal.aborted || !current(key)) throw retiredAvatar();
      reportAuthClientActionFailure('userAvatar', cause, { codeOnly: true });
      setState(old => ({ ...old, key, policyKey, saving: false, error: userAvatarError(cause) })); throw cause;
    } finally {
      requests.current.delete(controller); signal?.removeEventListener('abort', abort);
      if (write.current === token) { write.current = null; if (current(key)) setState(old => old.key === key ? { ...old, saving: false } : old); }
    }
  }, [boundary.key, client, current, enabled]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; for (const request of requests.current) request.abort(); requests.current.clear();
  }; }, []);
  useEffect(() => {
    if (enabled) void refresh(); else setState(EMPTY);
    return () => { ++sequence.current; write.current = null; for (const request of requests.current) request.abort(); requests.current.clear(); };
  }, [enabled, refresh]);
  const visible = enabled && state.key === boundary.key && state.policyKey === policyKey ? state : EMPTY;
  const asset = visible.snapshot?.asset;
  useEffect(() => {
    if (!client || !asset || !enabled) { setUrl(null); return; }
    const key = boundary.key, controller = new AbortController(); let objectUrl: string | undefined;
    requests.current.add(controller); setUrl(null);
    void client.userAvatar.deliver(asset, controller.signal).then(blob => {
      if (controller.signal.aborted || !current(key)) return;
      objectUrl = URL.createObjectURL(blob); setUrl({ key, policyKey, assetId: asset.id, value: objectUrl });
    }).catch(cause => {
      if (controller.signal.aborted || !current(key)) return;
      reportAuthClientActionFailure('userAvatar', cause, { codeOnly: true });
      setState(old => old.key === key ? { ...old, error: userAvatarError(cause) } : old);
    });
    return () => { controller.abort(); requests.current.delete(controller); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset?.id, asset?.deliveryPath, boundary.key, client, current, enabled]);
  return { snapshot: visible.snapshot, imageUrl: url?.key === boundary.key && url.policyKey === policyKey && url.assetId === asset?.id ? url.value : null,
    isLoading: visible.loading || enabled && visible.snapshot === null && visible.error === null,
    isSaving: visible.saving, error: visible.error, refresh, mutate };
}
export type UseUserAvatarResult = ReturnType<typeof useUserAvatar>;
function retiredAvatar() { return new DOMException('Avatar scope is no longer available.', 'AbortError'); }
