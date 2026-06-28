'use client';

/**
 * app-provider.tsx
 *
 * Composes the frontend SDK, sync, router, error, and modal providers. This
 * file owns provider wiring and client config resolution only; auth transport
 * remains inside the SDK client.
 */

import { createElement, Fragment, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ClientTableDef, SyncMode } from '../../sync/types';
import type { Client, InternalClient } from './sdk';
import { createClient, getClient } from './sdk';
import { useAuth } from './auth-hooks';
import { ClientProvider } from './client-context';
import { RouterProvider, useHasRouter, usePathname, useRouter } from './router-context';
import { SyncProvider } from '../../sync/client/hooks';
import { ErrorBoundary } from './error-boundary';
import { ModalManager } from '../../modals';
import { FRONTEND_OBS_CODES, emitFrontendCode } from './observability';

// ─── AppProvider ───────────────────────────────────────────────────────────

/**
 * Table definition input — accepts raw ClientTableDef OR defineTable() output.
 * The provider auto-detects and extracts `.clientTable` when needed.
 */
type TableInput = ClientTableDef | { clientTable: ClientTableDef };

interface BrowserPlatformConfig {
  url?: string;
  auth?: boolean;
  email?: boolean;
  stateSync?: boolean;
  tableSyncModes?: Record<string, SyncMode>;
  publicPaths?: string[];
  loginPath?: string;
}

function getBrowserPlatformConfig(): BrowserPlatformConfig {
  if (typeof window === 'undefined') return {};
  return (window as Window & { __PLATFORM_CONFIG__?: BrowserPlatformConfig }).__PLATFORM_CONFIG__ ?? {};
}

/** Return true when a table input is a defineTable() result. */
function hasClientTable(def: TableInput): def is { clientTable: ClientTableDef } {
  return typeof (def as { clientTable?: unknown }).clientTable === 'object'
    && (def as { clientTable?: unknown }).clientTable !== null;
}

function assertAppProviderConfig(
  auth: boolean,
  stateSync: boolean,
  explicitAuth: boolean | undefined,
  explicitStateSync: boolean | undefined,
  platformConfig: BrowserPlatformConfig,
): void {
  if (stateSync && !auth) {
    throw new Error('[app] AppProvider stateSync requires auth: true because server state is keyed by authenticated user.');
  }

  if (explicitAuth === true && platformConfig.auth === false) {
    throw new Error('[app] AppProvider auth=true but the server was created with auth disabled. Enable createApp({ auth: true }) or set <AppProvider auth={false}>.');
  }

  if (explicitStateSync === true && platformConfig.stateSync === false) {
    throw new Error('[app] AppProvider stateSync=true but the server was created with stateSync disabled. Enable createApp({ stateSync: true, auth: true }) or set <AppProvider stateSync={false}>.');
  }
}

/**
 * Normalize table input and overlay resolved server sync modes before creating
 * the SDK client. This keeps auto-lazy decisions consistent across SSR,
 * websocket snapshots, and browser-side subscribe messages.
 */
function resolveProviderTables(
  tables: Record<string, TableInput>,
  tableSyncModes: Record<string, SyncMode> | undefined,
): Record<string, ClientTableDef> {
  const resolved: Record<string, ClientTableDef> = {};

  for (const [name, def] of Object.entries(tables)) {
    const clientTable = hasClientTable(def) ? def.clientTable : def;
    const syncMode = tableSyncModes?.[name];
    resolved[name] = syncMode ? { ...clientTable, _sync: syncMode } : clientTable;
  }

  return resolved;
}

export interface AppProviderProps {
  /** Server URL (HTTP). WebSocket URL derived automatically. */
  url: string;
  /**
   * Table definitions — pass defineTable() output directly.
   * No need to extract `.clientTable` — the provider handles it.
   *
   * @example
   * ```tsx
   * // Just pass your table definitions:
   * <AppProvider url="..." tables={{ todos: todosTable, users: usersTable }}>
   *
   * // Raw ClientTableDef still works:
   * <AppProvider url="..." tables={{ todos: { _pk: 'id', title: 'text' } }}>
   * ```
   */
  tables: Record<string, TableInput>;
  /** Enable auth. Defaults to injected server config, otherwise false. */
  auth?: boolean;
  /** Enable per-user state sync. Defaults to injected server config, otherwise false. */
  stateSync?: boolean;
  /** Initial URL pathname from SSR. */
  initialPathname?: string;
  /** Initial route params from SSR. */
  initialParams?: Record<string, string>;
  /** Paths that do not require auth. Defaults to injected server config. */
  publicPaths?: string[];
  /** Login route for client-side auth redirects. Defaults to injected server config. */
  loginPath?: string;
  /** Custom error fallback component. */
  errorFallback?: (props: { error: Error; reset: () => void }) => ReactNode;
  children?: ReactNode;
}

/**
 * Root provider that wraps an app with all platform features.
 *
 * SSR-safe: during server rendering, only provides RouterProvider.
 * All client-only providers (Client, Sync) are deferred until hydration.
 * Hooks like useAuth, useCollection, useRow return safe defaults during SSR
 * so components render without throwing.
 *
 * Includes a platform ErrorBoundary that catches render errors and
 * shows a styled error page instead of a white screen.
 *
 * Composes (outer → inner):
 * 1. ErrorBoundary — catches render errors
 * 2. RouterProvider — client-side navigation (works in SSR via initialPathname)
 * 3. ClientProvider — SDK client (auth, collections, state) [client only]
 * 4. SyncProvider — wired to the same SyncClient [client only]
 * 5. ModalManager — renders modal stack, provides portal for `modals.*` API [client only]
 *
 * @example
 * ```tsx
 * <AppProvider
 *   url="http://localhost:3000"
 *   tables={{ todos: { _pk: 'id', id: 'text', title: 'text', done: 'integer' } }}
 *   auth
 *   stateSync
 * >
 *   <App />
 * </AppProvider>
 * ```
 */
export function AppProvider({
  url,
  tables,
  auth,
  stateSync,
  initialPathname,
  initialParams,
  publicPaths,
  loginPath,
  errorFallback,
  children,
}: AppProviderProps) {
  // useRef + useHasRouter must be called unconditionally (Rules of Hooks)
  const clientRef = useRef<Client | null>(null);
  const hasRouter = useHasRouter();

  // SSR: provide router context + error boundary only.
  // Client hooks (useAuth, useCollection, etc.) return safe defaults
  // during SSR — no ClientOnly wrapper needed.
  if (typeof window === 'undefined') {
    const inner = hasRouter
      ? children
      : createElement(RouterProvider, { initialPathname, initialParams, children });
    return createElement(ErrorBoundary, { fallback: errorFallback }, inner);
  }

  const platformConfig = getBrowserPlatformConfig();
  const authEnabled = auth ?? platformConfig.auth ?? false;
  const stateSyncEnabled = stateSync ?? platformConfig.stateSync ?? false;
  const resolvedPublicPaths = publicPaths ?? platformConfig.publicPaths ?? ['/login', '/register', '/forgot-password'];
  const resolvedLoginPath = loginPath ?? platformConfig.loginPath ?? '/login';
  assertAppProviderConfig(authEnabled, stateSyncEnabled, auth, stateSync, platformConfig);
  const resolvedTables = resolveProviderTables(tables, platformConfig.tableSyncModes);

  // Create or reuse the SDK client (singleton)
  if (!clientRef.current) {
    clientRef.current = getClient() ?? createClient({
      url,
      tables: resolvedTables,
      auth: authEnabled,
      stateSync: stateSyncEnabled,
      autoConnect: true,
    });
  }
  const client = clientRef.current;

  // Innermost: Client > Sync > ModalManager > children
  //
  // SyncProvider receives the same SyncClient the SDK client owns.
  // This means collection hooks and lower-level SyncProvider hooks operate on
  // the same underlying data -- one WebSocket, one store.
  //
  // ModalManager renders the modal stack portal — must be inside providers
  // so modals can access auth, collections, router, etc.
  const internal = client as InternalClient;
  const guardedChildren = authEnabled
    ? createElement(
        Fragment,
        null,
        createElement(AuthSessionRedirector, {
          loginPath: resolvedLoginPath,
          publicPaths: resolvedPublicPaths,
        }),
        children,
      )
    : children;

  let tree: ReactNode = createElement(
    ClientProvider,
    { client, children:
      createElement(
        SyncProvider,
        {
          client: internal._syncClient,
          stateClient: internal.state,
          children: createElement(ModalManager, { children: guardedChildren }),
        }
      )
    }
  );

  // Wrap in RouterProvider only if not already inside one
  // (hydrate.tsx provides the outer RouterProvider)
  if (!hasRouter) {
    tree = createElement(RouterProvider, { initialPathname, initialParams, children: tree });
  }

  return createElement(ErrorBoundary, { fallback: errorFallback }, tree);
}

function AuthSessionRedirector({
  loginPath,
  publicPaths,
}: {
  loginPath: string;
  publicPaths: string[];
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    if (isPublicPath(pathname, publicPaths)) return;

    const from = `${pathname}${window.location.search}${window.location.hash}`;
    const target = withRedirectParam(loginPath, from);
    emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_AUTH_SESSION_REDIRECT, {
      metadata: { from: pathname, to: loginPath },
    });
    router.replace(target);
  }, [isAuthenticated, isLoading, loginPath, pathname, publicPaths, router]);

  return null;
}

function isPublicPath(pathname: string, publicPaths: string[]): boolean {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function withRedirectParam(loginPath: string, from: string): string {
  const [path, query = ''] = loginPath.split('?');
  const params = new URLSearchParams(query);
  if (from && from !== path) params.set('redirect', from);
  const nextQuery = params.toString();
  return nextQuery ? `${path}?${nextQuery}` : path;
}
