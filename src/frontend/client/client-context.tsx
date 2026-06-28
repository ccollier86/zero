/**
 * client-context.tsx
 *
 * Owns the React context that exposes the browser SDK client to frontend
 * hooks. This file wires client creation and SSR fallback policy only; it
 * does not own auth actions, data subscriptions, or UI rendering.
 */

import {
  createContext,
  createElement,
  useContext,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import type { Client, ClientConfig } from './sdk';
import { createClient, getClient } from './sdk';

const ClientContext = createContext<Client | null>(null);

/**
 * Return true when a client-only hook should use its SSR fallback.
 *
 * Throws in the browser when a hook is missing `<AppProvider>` or
 * `<ClientProvider>` so wiring mistakes are caught during development.
 */
export function shouldUseSsrFallback(client: Client | null, hookName: string): boolean {
  if (client) return false;

  if (typeof window !== 'undefined') {
    throw new Error(`${hookName} must be used within <AppProvider> or <ClientProvider>.`);
  }

  return true;
}

/**
 * Return true when running during server rendering.
 */
export function useIsServer(): boolean {
  return typeof window === 'undefined';
}

/**
 * Read the SDK client from React context.
 *
 * Throws in the browser when no provider exists. During SSR this returns null
 * at runtime so higher-level hooks can expose safe fallback values.
 */
export function useClient(): Client {
  const client = useContext(ClientContext);
  if (!client && typeof window !== 'undefined') {
    throw new Error('useClient must be used within <AppProvider> or <ClientProvider>.');
  }
  return client!;
}

/**
 * Read the SDK client from React context without throwing.
 *
 * Use this from SSR-safe hooks that can return an empty/loading fallback until
 * the browser provider is available after hydration.
 */
export function useClientMaybe(): Client | null {
  return useContext(ClientContext);
}

export interface ClientProviderProps {
  /** Pre-created client instance, OR config to create one. */
  client?: Client;
  /** Config to auto-create a client. Ignored when `client` is provided. */
  config?: ClientConfig;
  children: ReactNode;
}

/**
 * Provide one SDK client instance to descendant frontend hooks.
 *
 * Accepts either a pre-created client or enough config to create/reuse the
 * shared browser singleton.
 */
export function ClientProvider({ client: clientProp, config, children }: ClientProviderProps) {
  const clientRef = useRef<Client | null>(null);

  if (!clientRef.current) {
    if (clientProp) {
      clientRef.current = clientProp;
    } else if (config) {
      clientRef.current = getClient() ?? createClient(config);
    } else {
      throw new Error('ClientProvider requires either `client` or `config` prop');
    }
  }

  return createElement(ClientContext.Provider, { value: clientRef.current }, children);
}
