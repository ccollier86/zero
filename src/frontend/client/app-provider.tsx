'use client';

/**
 * app-provider.tsx
 *
 * Composes the frontend SDK, sync, router, error, and modal providers. This
 * file owns provider wiring and client config resolution only; auth transport
 * remains inside the SDK client.
 */

import { createElement, Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClientTableDef, SyncMode } from '../../sync/types';
import type { Client, InternalClient } from './sdk';
import { createClient, getClient } from './sdk';
import { useAuth } from './auth-hooks';
import { useAuthorization } from './authorization-hooks';
import { ClientProvider } from './client-context';
import { RouterProvider, useHasRouter, usePathname, useRouter } from './router-context';
import { SyncProvider } from '../../sync/client/hooks';
import { ErrorBoundary } from './error-boundary';
import { ModalManager, modals } from '../../modals';
import { toast } from 'sonner';
import { FRONTEND_OBS_CODES, emitFrontendCode } from './observability';
import { useRouteAuthRequirement } from './route-auth-context';
import {
  readAuthorizationScopeBoundaryKey,
  useAuthorizationScopeBoundary,
} from './authorization-scope-hooks';
import {
  authorizationScopeTransitionMessage,
  resolveAuthorizationScopeDisplay,
  resolveAuthorizationScopeReloadAction,
  resolveHydrationScopeMatch,
} from './authorization-scope-display';
import {
  shouldRequireAuthForRoute,
  type RouteAuthMode,
} from '../router/auth-policy';
import {
  readBrowserRouteAuthorizationBoundary,
  routeAuthorizationBoundaryMatches,
  type RouteAuthorizationBoundary,
} from '../router/authorization-route-boundary';

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
  routeAuth?: RouteAuthMode;
  loginPath?: string;
}

/** Minimal hydration payload used by the root authorization guard. */
interface BrowserAuthorizationRouteData {
  authorizationBoundary?: RouteAuthorizationBoundary | null;
}

function getBrowserPlatformConfig(): BrowserPlatformConfig {
  if (typeof window === 'undefined') return {};
  return (window as Window & { __PLATFORM_CONFIG__?: BrowserPlatformConfig }).__PLATFORM_CONFIG__ ?? {};
}

function getBrowserAuthorizationRouteData(): BrowserAuthorizationRouteData | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & {
    __ROUTE_DATA__?: BrowserAuthorizationRouteData;
  }).__ROUTE_DATA__;
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
  /** Route auth strategy. Defaults to injected server config. */
  routeAuth?: RouteAuthMode;
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
  routeAuth,
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
  const resolvedPublicPaths = publicPaths ?? platformConfig.publicPaths ?? ['/login', '/register', '/forgot-password', '/reset-password', '/setup-password', '/verify-email'];
  const resolvedRouteAuth = routeAuth ?? platformConfig.routeAuth ?? 'protected-by-default';
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
        AuthRouteGuard,
        {
          loginPath: resolvedLoginPath,
          publicPaths: resolvedPublicPaths,
          routeAuth: resolvedRouteAuth,
          children,
        },
      )
    : children;

  const modalTree = createElement(ModalManager, { children: guardedChildren });
  const authorizationScopedTree = authEnabled
    ? createElement(AuthorizationScopeGuard, { client, children: modalTree })
    : modalTree;

  let tree: ReactNode = createElement(
    ClientProvider,
    { client, children:
      createElement(
        SyncProvider,
        {
          client: internal._syncClient,
          stateClient: internal.state,
          children: authorizationScopedTree,
        }
      )
    }
  );

  // Wrap in RouterProvider only if not already inside one.
  // The generated client entry calls hydrate-runtime, which provides the outer RouterProvider.
  if (!hasRouter) {
    tree = createElement(RouterProvider, { initialPathname, initialParams, children: tree });
  }

  return createElement(ErrorBoundary, { fallback: errorFallback }, tree);
}

/**
 * Prevent app component state and server loader data from crossing an auth
 * scope replacement. The subtree is synchronously hidden at transition start.
 * Installed hydration routes then reload the current URL once the replacement
 * scope is committed so server loaders/page-session policy run for that scope.
 */
function AuthorizationScopeGuard({
  client,
  children,
}: {
  client: Client;
  children?: ReactNode;
}) {
  const boundary = useAuthorizationScopeBoundary(client);
  const auth = (client as InternalClient).auth;
  const authorizationState = useAuthorization();
  const [scopeRecoveryRequired, setScopeRecoveryRequired] = useState(false);
  const displayedScopeRef = useRef<string | null>(null);
  // AppProvider is a standalone public export. Do not rely on the ambient
  // Window augmentation declared by the separately exported hydration runtime;
  // package consumers may typecheck this module without importing that entry.
  const routeData = getBrowserAuthorizationRouteData();
  const hasHydrationRoute = Boolean(routeData);
  const browserRouteBoundary = {
    ...readBrowserRouteAuthorizationBoundary(auth),
    scopeRevision: authorizationState.authorization?.scope?.revision ?? null,
    authorizationReady: authorizationState.isReady,
  };
  const hydrationScopeMatches = resolveHydrationScopeMatch(
    hasHydrationRoute,
    routeData?.authorizationBoundary
      ? routeAuthorizationBoundaryMatches(
        routeData.authorizationBoundary,
        browserRouteBoundary,
      )
      : undefined,
  );
  const display = resolveAuthorizationScopeDisplay({
    displayedScopeKey: displayedScopeRef.current,
    currentScopeKey: boundary.scopeKey,
    ready: boundary.ready,
    hasHydrationRoute,
    hydrationScopeMatches,
  });
  displayedScopeRef.current = display.displayedScopeKey;
  const requiresRouteReload = display.reload;
  const reloadKey = JSON.stringify([
    typeof window === 'undefined' ? '' : window.location.pathname,
    routeData?.authorizationBoundary ?? null,
    browserRouteBoundary,
  ]);
  useEffect(() => {
    if (!auth) return;
    let observedBoundaryKey = readAuthorizationScopeBoundaryKey(auth);
    return auth.subscribe(() => {
      const nextBoundaryKey = readAuthorizationScopeBoundaryKey(auth);
      if (nextBoundaryKey === observedBoundaryKey) return;
      observedBoundaryKey = nextBoundaryKey;
      // Scope teardown is synchronous and deliberately does not invoke modal
      // close callbacks that may still capture previous-tenant actions.
      modals.discardAll();
      toast.dismiss();
    });
  }, [auth]);

  useEffect(() => {
    const marker = '__zeroAuthorizationBoundaryReload';
    const historyState = isPlainHistoryState(window.history.state)
      ? window.history.state
      : {};
    if (!requiresRouteReload) {
      setScopeRecoveryRequired(false);
      if (marker in historyState) {
        const nextState = { ...historyState };
        delete nextState[marker];
        window.history.replaceState(nextState, '');
      }
      return;
    }
    const action = resolveAuthorizationScopeReloadAction({
      recordedReloadKey: typeof historyState[marker] === 'string'
        ? historyState[marker]
        : null,
      reloadKey,
      serverUserId: routeData?.authorizationBoundary?.userId ?? null,
      browserUserId: browserRouteBoundary.userId,
    });
    // A same-document history marker makes a persistent cookie/session
    // disagreement fail closed without creating an infinite reload loop.
    if (action === 'show-recovery') {
      setScopeRecoveryRequired(true);
      return;
    }
    setScopeRecoveryRequired(false);
    window.history.replaceState({ ...historyState, [marker]: reloadKey }, '');
    void (async () => {
      if (action === 'clear-page-session-and-reload') {
        // No browser credential exists to supersede the server-only page
        // session. Use the normal logout route to clear its HttpOnly cookie.
        await auth?.logout().catch(() => undefined);
      }
      window.location.reload();
    })();
  }, [auth, browserRouteBoundary.userId, reloadKey, requiresRouteReload,
    routeData?.authorizationBoundary?.userId]);

  const retryScopeRecovery = async () => {
    const historyState = isPlainHistoryState(window.history.state)
      ? { ...window.history.state }
      : {};
    delete historyState.__zeroAuthorizationBoundaryReload;
    window.history.replaceState(historyState, '');
    setScopeRecoveryRequired(false);
    if (routeData?.authorizationBoundary?.userId && !browserRouteBoundary.userId) {
      await auth?.logout().catch(() => undefined);
    }
    window.location.reload();
  };

  if (scopeRecoveryRequired) {
    return createElement(
      'main',
      { role: 'alert', 'data-zero-auth-recovery': true },
      createElement('h1', null, 'Session refresh required'),
      createElement(
        'p',
        null,
        'The browser and server sessions still disagree. Retry to safely clear the stale page session.',
      ),
      createElement('button', { type: 'button', onClick: retryScopeRecovery }, 'Retry session'),
    );
  }
  if (!display.render) {
    return createElement(
      'main',
      {
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': true,
        'aria-busy': true,
        'data-zero-auth-transition': true,
        className: 'grid min-h-screen place-items-center p-6 text-sm text-muted-foreground',
      },
      authorizationScopeTransitionMessage(auth?.sessionTransition.operation ?? null),
    );
  }
  return createElement(Fragment, { key: display.displayedScopeKey }, children);
}

function isPlainHistoryState(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function AuthRouteGuard({
  loginPath,
  publicPaths,
  routeAuth,
  children,
}: {
  loginPath: string;
  publicPaths: string[];
  routeAuth: RouteAuthMode;
  children?: ReactNode;
}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const routeRequirement = useRouteAuthRequirement();
  const routeRequiresAuth = shouldRequireAuthForRoute({
    routeAuth,
    pathname,
    publicPaths,
    routeRequirement,
  });
  const routeRequiresAdmin = routeRequirement === 'admin';

  useEffect(() => {
    if (isLoading || !routeRequiresAuth || isAuthenticated) return;

    const from = `${pathname}${window.location.search}${window.location.hash}`;
    const target = withRedirectParam(loginPath, from);
    emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_AUTH_SESSION_REDIRECT, {
      metadata: { from: pathname, to: loginPath },
    });
    router.replace(target);
  }, [isAuthenticated, isLoading, loginPath, pathname, routeRequiresAuth, router]);

  if (!isLoading && routeRequiresAuth && !isAuthenticated) {
    return null;
  }

  if (!isLoading && routeRequiresAdmin && isAuthenticated && user?.role !== 'admin') {
    return null;
  }

  return createElement(Fragment, null, children);
}

function withRedirectParam(loginPath: string, from: string): string {
  const [path, query = ''] = loginPath.split('?');
  const params = new URLSearchParams(query);
  if (from && from !== path) params.set('redirect', from);
  const nextQuery = params.toString();
  return nextQuery ? `${path}?${nextQuery}` : path;
}
