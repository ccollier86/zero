'use client';

/** Own-contact snapshots and complete mutations, fenced before admission and after every async result. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserContactSnapshot } from '../../auth/auth-user-contact-types';
import { useAuth } from './auth-hooks';
import { useClientMaybe } from './client-context';
import type { InternalClient } from './sdk';
import { isAuthorizationDataReady, isAuthorizationScopeReady, readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import type { AuthUserContactTransport } from './auth-user-contact-transport';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { userContactError } from './user-contact-errors';
import { getAuthConfigController } from './auth-config-controller';

interface ContactState { key: string | null; policyKey?: string; snapshot: UserContactSnapshot | null; loading: boolean; saving: boolean; error: string | null }
const EMPTY: ContactState = { key: null, snapshot: null, loading: false, saving: false, error: null };
export interface UseUserContactsOptions {
  enabled?: boolean;
  /** Connected settings can retire an old capability projection even within the same identity scope. */
  capabilityKey?: string;
}
export function useUserContacts(options: UseUserContactsOptions = {}) {
  const client = useClientMaybe(), auth = useAuth(), boundary = useAuthorizationScopeBoundary(client);
  const enabled = options.enabled !== false && Boolean(client) && auth.isAuthenticated && boundary.ready;
  const [state, setState] = useState<ContactState>(EMPTY);
  const policyKey = options.capabilityKey;
  const mounted = useRef(true), latest = useRef({ enabled, key: boundary.key, policyKey }); latest.current = { enabled, key: boundary.key, policyKey };
  const requests = useRef(new Set<AbortController>()), sequence = useRef(0), write = useRef<object | null>(null);
  const currentScope = useCallback((key: string) => {
    const internal = client as InternalClient | null, live = internal?.auth, revision = internal?._authorizationDataBoundary?.revision ?? 0;
    if (!live || latest.current.policyKey !== policyKey) return false;
    if (policyKey !== undefined) {
      const config = getAuthConfigController(live).getSnapshot();
      if (config.status !== 'ready' || JSON.stringify(config.config?.userProfile?.contacts) !== policyKey) return false;
    }
    return mounted.current && latest.current.enabled && latest.current.key === key
      && readAuthorizationScopeBoundaryKey(live ?? null, revision) === key && live!.isAuthenticated
      && isAuthorizationScopeReady(live!.sessionTransition, live!.isRestoring)
      && isAuthorizationDataReady(revision, live!.authorizationState.status, live!.isAuthenticated);
  }, [client, policyKey]);
  const refresh = useCallback(async () => {
    if (!client || !enabled) return;
    const key = boundary.key, controller = new AbortController(), ticket = ++sequence.current;
    if (!currentScope(key)) return;
    requests.current.add(controller); setState(old => ({ ...(old.key === key && old.policyKey === policyKey ? old : EMPTY), key, policyKey, loading: true, error: null }));
    try {
      const snapshot = await client.userContacts.get(controller.signal);
      if (controller.signal.aborted || ticket !== sequence.current || !currentScope(key)) return;
      if (snapshot.userId !== (client as InternalClient).auth?.user?.userId) throw new Error('Contact response does not belong to this account.');
      setState(old => ({ ...old, key, policyKey, snapshot, loading: false, error: null }));
    } catch (cause) {
      if (controller.signal.aborted || ticket !== sequence.current || !currentScope(key)) return;
      reportAuthClientActionFailure('userContacts', cause, { codeOnly: true });
      setState(old => ({ ...old, key, policyKey, loading: false, error: userContactError(cause) }));
    } finally { requests.current.delete(controller); }
  }, [boundary.key, client, currentScope, enabled]);
  const mutate = useCallback(async (operation: (contacts: AuthUserContactTransport, signal: AbortSignal) => Promise<UserContactSnapshot>, signal?: AbortSignal) => {
    const key = boundary.key, controller = new AbortController(), token = {};
    if (!client || !enabled || !currentScope(key) || signal?.aborted) throw retiredContact();
    if (write.current) throw new Error('A contact update is already pending.');
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    write.current = token; requests.current.add(controller); ++sequence.current;
    setState(old => ({ ...(old.key === key && old.policyKey === policyKey ? old : EMPTY), key, policyKey, saving: true, error: null }));
    try {
      const snapshot = await operation(client.userContacts, controller.signal);
      if (controller.signal.aborted || !currentScope(key)) throw retiredContact();
      if (snapshot.userId !== (client as InternalClient).auth?.user?.userId) throw new Error('Contact response does not belong to this account.');
      ++sequence.current; setState({ key, policyKey, snapshot, loading: false, saving: false, error: null }); return snapshot;
    } catch (cause) {
      if (controller.signal.aborted || !currentScope(key)) throw retiredContact();
      reportAuthClientActionFailure('userContacts', cause, { codeOnly: true });
      setState(old => ({ ...old, key, policyKey, saving: false, error: userContactError(cause) })); throw cause;
    } finally {
      requests.current.delete(controller); signal?.removeEventListener('abort', abort);
      if (write.current === token) { write.current = null; if (currentScope(key)) setState(old => old.key === key ? { ...old, saving: false } : old); }
    }
  }, [boundary.key, client, currentScope, enabled]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; for (const request of requests.current) request.abort(); requests.current.clear();
  }; }, []);
  useEffect(() => {
    if (enabled) void refresh(); else setState(EMPTY);
    return () => { ++sequence.current; write.current = null; for (const request of requests.current) request.abort(); requests.current.clear(); };
  }, [enabled, refresh]);
  const visible = enabled && state.key === boundary.key && state.policyKey === policyKey ? state : EMPTY;
  return { snapshot: visible.snapshot, isLoading: visible.loading || enabled && visible.snapshot === null && visible.error === null,
    isSaving: visible.saving, error: visible.error, refresh, mutate };
}
export type UseUserContactsResult = ReturnType<typeof useUserContacts>;
function retiredContact() { return new DOMException('Contact scope is no longer available.', 'AbortError'); }
