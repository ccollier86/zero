'use client';

/** Memory-only display receipt across AppProvider's required scope remount. Never grants authority or persists a proof/password. */
import { useCallback, useSyncExternalStore } from 'react';
import type { Client, InternalClient } from '../../frontend/client/sdk';
import type { AuthActionTokenInfo, AuthCompletionResult, AuthPasswordUpdatedResult } from '../../frontend/client/auth-types';
import { reportAuthClientActionFailure } from '../../frontend/client/auth-action-observability';
import { isConfirmedPasswordUpdate } from './password-action-recovery';

interface Receipt { token: string; action: 'reset' | 'setup'; result: AuthPasswordUpdatedResult }
interface Store { receipt: Receipt | null; listeners: Set<() => void> }
const stores = new WeakMap<Client, Store>();
const noop = () => {};
function storeFor(client: Client): Store {
  let store = stores.get(client);
  if (!store) { store = { receipt: null, listeners: new Set() }; stores.set(client, store); }
  return store;
}

/** Bind only a confirmed exact-account SDK result, including after its originating view was intentionally retired. */
export function rememberPasswordActionCompletion(client: Client | null, token: string, action: 'reset' | 'setup',
  info: AuthActionTokenInfo, result: AuthCompletionResult | null): void {
  const auth = (client as InternalClient | null)?.auth;
  if (!client || !auth || !isConfirmedPasswordUpdate(result, info) || auth.isAuthenticated
    || auth.authenticationContinuation !== result) return;
  const store = storeFor(client);
  // At most one consumed proof/result per client. It is not serialized to the
  // auth store, storage, logs, DOM or network and is not an operation replay key.
  store.receipt = { token, action, result };
  for (const listener of [...store.listeners]) {
    try { listener(); }
    catch { reportAuthClientActionFailure('passwordActionReceiptListener', null, { codeOnly: true }); }
  }
}

/** Display-only receipt lookup. Replaced authority/results are never adopted as a new link's success. */
export function readPasswordActionCompletion(client: Client | null, token: string, mode: 'auto' | 'reset' | 'setup') {
  const auth = (client as InternalClient | null)?.auth;
  if (!client || !auth || auth.isAuthenticated) return null;
  const receipt = stores.get(client)?.receipt;
  return receipt && receipt.token === token && (mode === 'auto' || receipt.action === mode)
    && auth.authenticationContinuation === receipt.result ? receipt.result : null;
}

/** A fresh link/client or a replaced SDK continuation cannot inherit another operation's success. */
export function usePasswordActionCompletion(client: Client | null, token: string, mode: 'auto' | 'reset' | 'setup') {
  const subscribe = useCallback((listener: () => void) => {
    if (!client) return noop;
    const store = storeFor(client); store.listeners.add(listener);
    return () => { store.listeners.delete(listener); };
  }, [client]);
  const snapshot = useCallback(() => {
    return readPasswordActionCompletion(client, token, mode);
  }, [client, token, mode]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
