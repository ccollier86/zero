'use client';

/**
 * app-provider.tsx
 *
 * Composes the frontend SDK, sync, router, error, and modal providers. This
 * file owns provider wiring and client config resolution only; auth transport
 * remains inside the SDK client.
 */

import { createElement, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  SyncDataPlaneName,
  SyncMode,
} from '../../sync/types';
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
  isHydrationScopeRecoverySettled,
  resolveAuthorizationScopeDisplay,
  resolveAuthorizationScopeReloadAction,
  resolveHydrationScopeMatch,
  resolveHydratedAuthorizationWork,
} from './authorization-scope-display';
import {
  AuthorizationScopeRecoveryController,
  type AuthorizationScopeRecoveryOperation,
} from './authorization-scope-recovery';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { Button } from '../../components/ui/button';
import {
  shouldRequireAuthForRoute,
  type RouteAuthMode,
} from '../router/auth-policy';
import {
  readBrowserRouteAuthorizationBoundary,
  routeAuthorizationBoundaryMatches,
  routeAuthorizationIdentityMatches,
  type RouteAuthorizationBoundary,
} from '../router/authorization-route-boundary';
import {
  resolveProviderSyncConfig,
  type ProviderTableInput,
} from './app-provider-sync-config';
import {
  authenticatedLoginDestination,
  comparableAuthPathname,
  configuredAuthPathname,
  loginRedirectLocation,
  normalizeConfiguredAuthPath,
} from '../router/auth-navigation';
import { AuthorizationHintRecovery } from './authorization-hint-recovery';

// ─── AppProvider ───────────────────────────────────────────────────────────

/**
 * Table definition input — accepts raw ClientTableDef OR defineTable() output.
 * The provider auto-detects and extracts `.clientTable` when needed.
 */
type TableInput = ProviderTableInput;

interface BrowserPlatformConfig {
  url?: string;
  auth?: boolean;
  email?: boolean;
  stateSync?: boolean;
  presence?: boolean;
  tableSyncModes?: Record<string, SyncMode>;
  /** Server-owned Sync-visible application table routing catalog. */
  tableSyncPlanes?: Record<string, SyncDataPlaneName>;
  /** All server-managed application tables, including non-Sync resources. */
  managedTableNames?: string[];
  publicPaths?: string[];
  routeAuth?: RouteAuthMode;
  loginPath?: string;
  postLoginPath?: string;
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
  /** Defaults to the server's Guardian presence policy; false suppresses this browser's tracker/feed. */
  presence?: boolean;
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
  /** Safe fallback after login or an authenticated visit to login. Default: '/'. */
  postLoginPath?: string;
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
  presence,
  initialPathname,
  initialParams,
  publicPaths,
  routeAuth,
  loginPath,
  postLoginPath,
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
  const presenceEnabled = presence ?? platformConfig.presence ?? false;
  if (presenceEnabled && (!authEnabled || platformConfig.presence === false)) {
    throw new Error('[app] presence requires auth and server-enabled Guardian presence.');
  }
  const resolvedPublicPaths = publicPaths ?? platformConfig.publicPaths ?? ['/login', '/register', '/forgot-password', '/reset-password', '/setup-password', '/verify-email', '/verify-contact', '/complete-profile'];
  const resolvedRouteAuth = routeAuth ?? platformConfig.routeAuth ?? 'protected-by-default';
  const resolvedLoginPath = normalizeConfiguredAuthPath(
    loginPath ?? platformConfig.loginPath ?? '/login',
    'loginPath',
  );
  const resolvedPostLoginPath = normalizeConfiguredAuthPath(
    postLoginPath ?? platformConfig.postLoginPath ?? '/',
    'postLoginPath',
  );
  const resolvedLoginPathname = comparableAuthPathname(configuredAuthPathname(
    resolvedLoginPath,
    'loginPath',
  ));
  const resolvedPostLoginPathname = comparableAuthPathname(configuredAuthPathname(
    resolvedPostLoginPath,
    'postLoginPath',
  ));
  const legacyRootNoop = postLoginPath === undefined
    && resolvedLoginPathname === '/'
    && resolvedPostLoginPathname === '/';
  if (
    (loginPath !== undefined || postLoginPath !== undefined)
    && resolvedPostLoginPathname === resolvedLoginPathname
    && !legacyRootNoop
  ) {
    throw new Error('[app] postLoginPath must not resolve to loginPath.');
  }
  assertAppProviderConfig(authEnabled, stateSyncEnabled, auth, stateSync, platformConfig);
  const resolvedSyncConfig = resolveProviderSyncConfig(
    tables,
    platformConfig.tableSyncModes,
    platformConfig.tableSyncPlanes,
    platformConfig.managedTableNames,
  );

  // Create or reuse the SDK client (singleton)
  if (!clientRef.current) {
    clientRef.current = getClient() ?? createClient({
      url,
      tables: resolvedSyncConfig.tables,
      ...(resolvedSyncConfig.tableSyncPlanes
        ? { tableSyncPlanes: resolvedSyncConfig.tableSyncPlanes }
        : {}),
      auth: authEnabled,
      stateSync: stateSyncEnabled,
      presence: presenceEnabled,
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
          postLoginPath: resolvedPostLoginPath,
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
  const internal = client as InternalClient;
  const auth = internal.auth;
  const authorizationDataBoundary = internal._authorizationDataBoundary;
  const authorizationState = useAuthorization();
  const [scopeRecovery, setScopeRecovery] = useState<{
    scopeKey: string | null;
    operation: AuthorizationScopeRecoveryOperation | null;
    error: string | null;
    explicit?: boolean;
  } | null>(null);
  const recoveryControllerRef = useRef<AuthorizationScopeRecoveryController | null>(null);
  if (!recoveryControllerRef.current) {
    recoveryControllerRef.current = new AuthorizationScopeRecoveryController();
  }
  const recoveryController = recoveryControllerRef.current;
  const displayedScopeRef = useRef<string | null>(null);
  const hintRecoveryScopeRef = useRef<string | null>(null);
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
  const recoveryScopeKey = auth?.authorizationScopeKey ?? null;
  // Only the document and opaque credential family identify the bounded
  // attempt. Provisional hint status/revisions must not reset the loop guard.
  const readReloadKey = useCallback(() => JSON.stringify([
    typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}`,
    auth?.authorizationScopeKey ?? null,
  ]), [auth]);
  const reloadKey = readReloadKey();
  const recoverySettled = isHydrationScopeRecoverySettled({
    ready: boundary.ready,
    isRestoring: auth?.isRestoring ?? false,
    isLoading: auth?.isLoading ?? false,
    hasHydrationRoute,
    hydrationScopeMatches,
    browserUserId: browserRouteBoundary.userId,
    browserHasRecoverableSession: auth?.hasRecoverableSession ?? false,
    authorizationReady: browserRouteBoundary.authorizationReady,
  });
  const authorizationWork = resolveHydratedAuthorizationWork({
    hasHydrationRoute, stable: boundary.stable, ready: boundary.ready,
    isRestoring: auth?.isRestoring ?? false, isLoading: auth?.isLoading ?? false,
    requiresRouteReload, browserUserId: browserRouteBoundary.userId,
    browserHasRecoverableSession: auth?.hasRecoverableSession ?? false,
    authorizationStatus: auth?.authorizationState.status ?? 'unauthenticated',
    routeIdentityMatches: Boolean(routeData?.authorizationBoundary
      && routeAuthorizationIdentityMatches(routeData.authorizationBoundary, browserRouteBoundary)),
    acknowledgedPageCleanup: auth?.hasAcknowledgedPageSessionCleanup ?? false,
  });
  const needsRecovery = authorizationWork === 'recover-session' || authorizationWork === 'reload-route';
  const hintRecoveryKey = JSON.stringify([
    boundary.scopeKey, boundary.dataRevision, auth?.sessionTransition.revision ?? 0,
  ]);
  if (authorizationWork === 'retry-access') hintRecoveryScopeRef.current = hintRecoveryKey;
  else if (authorizationWork === 'none' || needsRecovery
    || hintRecoveryScopeRef.current !== hintRecoveryKey) hintRecoveryScopeRef.current = null;
  const recoveryPending = Boolean(auth && recoveryController.isPendingFor(auth));
  const currentRecovery = scopeRecovery?.scopeKey === recoveryScopeKey
    || (scopeRecovery?.operation && recoveryPending) ? scopeRecovery : null;

  useEffect(() => {
    recoveryController.activate();
    setScopeRecovery(null);
    return () => recoveryController.retire();
  }, [auth, recoveryController]);

  const runScopeRecovery = useCallback((operation: AuthorizationScopeRecoveryOperation, explicit = false) => {
    if (!auth) return;
    const scopeKey = auth.authorizationScopeKey;
    void recoveryController.run({
      client: auth,
      scopeKey,
      operation,
      onStart: () => {
        recordAuthorizationScopeReload(readReloadKey());
        setScopeRecovery({ scopeKey, operation, error: null, explicit });
      },
      onReload: () => {
        // A rejected proof/sign-out intentionally replaces the family with
        // anonymous. Preserve the bound for that outcome too if cookie clearing
        // was unavailable; never pretend a local logout wiped a remote cookie.
        recordAuthorizationScopeReload(readReloadKey());
        window.location.reload();
      },
      onRetryable: (error, cause) => {
        reportAuthClientActionFailure('hydratedSessionRecovery', cause, { codeOnly: true });
        setScopeRecovery({ scopeKey, operation: null, error });
      },
    });
  }, [auth, readReloadKey, recoveryController]);
  useEffect(() => {
    if (!auth) return;
    let observedBoundaryKey = readAuthorizationScopeBoundaryKey(
      auth,
      authorizationDataBoundary.revision,
    );
    const discardScopedOverlays = () => {
      const nextBoundaryKey = readAuthorizationScopeBoundaryKey(
        auth,
        authorizationDataBoundary.revision,
      );
      if (nextBoundaryKey === observedBoundaryKey) return;
      observedBoundaryKey = nextBoundaryKey;
      // Scope teardown is synchronous and deliberately does not invoke modal
      // close callbacks that may still capture previous-tenant actions.
      modals.discardAll();
      toast.dismiss();
    };
    const unsubscribeAuth = auth.subscribe(discardScopedOverlays);
    const unsubscribeAuthorizationData = authorizationDataBoundary.subscribe(
      discardScopedOverlays,
    );
    return () => {
      unsubscribeAuth();
      unsubscribeAuthorizationData();
    };
  }, [auth, authorizationDataBoundary]);

  useEffect(() => {
    const marker = '__zeroAuthorizationBoundaryReload';
    const historyState = isPlainHistoryState(window.history.state)
      ? window.history.state
      : {};
    // Restoring/provisional access is not a verified agreement. In particular,
    // a failed restore may have no user yet still retain retryable proof.
    if (!requiresRouteReload && recoverySettled && !recoveryPending) {
      setScopeRecovery(null);
      if (marker in historyState) {
        const nextState = { ...historyState };
        delete nextState[marker];
        window.history.replaceState(nextState, '');
      }
      return;
    }
    if (!needsRecovery || recoveryPending) return;
    const action = resolveAuthorizationScopeReloadAction({
      recordedReloadKey: typeof historyState[marker] === 'string'
        ? historyState[marker]
        : null,
      reloadKey,
      serverUserId: routeData?.authorizationBoundary?.userId ?? null,
      browserUserId: browserRouteBoundary.userId,
      browserHasRecoverableSession: auth?.hasRecoverableSession ?? false,
    });
    // A same-document history marker makes a persistent cookie/session
    // disagreement fail closed without creating an infinite reload loop.
    if (action === 'show-recovery') {
      setScopeRecovery((previous) => previous?.scopeKey === recoveryScopeKey
        ? previous
        : { scopeKey: recoveryScopeKey, operation: null, error: null });
      return;
    }
    if (authorizationWork === 'reload-route') {
      // Reload stale loader authority, or the core's acknowledged sign-out
      // receipt. Neither requires another credential/cookie-clearing writer.
      recordAuthorizationScopeReload(reloadKey);
      window.location.reload();
      return;
    }
    if (!auth) {
      recordAuthorizationScopeReload(reloadKey);
      window.location.reload();
      return;
    }
    runScopeRecovery(action === 'clear-page-session-and-reload' ? 'sign-out' : 'recover');
  }, [auth, authorizationWork, browserRouteBoundary.userId, recoveryPending, needsRecovery,
    recoveryScopeKey, recoverySettled, reloadKey, requiresRouteReload,
    routeData?.authorizationBoundary?.userId, runScopeRecovery]);

  if (hintRecoveryScopeRef.current === hintRecoveryKey && auth && !recoveryPending && !currentRecovery) {
    return createElement(AuthorizationHintRecovery, {
      key: hintRecoveryKey, auth, dataBoundary: authorizationDataBoundary,
      checking: auth.authorizationState.status === 'loading' || auth.authorizationState.status === 'refreshing',
    });
  }
  if (currentRecovery && (currentRecovery.operation === null || currentRecovery.explicit)) {
    const pending = currentRecovery.operation !== null;
    return createElement(
      'main',
      {
        role: 'alert', 'data-zero-auth-recovery': true,
        className: 'grid min-h-screen place-content-center gap-4 px-6 py-10 text-foreground',
      },
      createElement('h1', { className: 'text-lg font-semibold tracking-tight' }, 'Session refresh required'),
      createElement(
        'p',
        { className: 'max-w-md text-sm leading-relaxed text-muted-foreground' },
        'This page could not be matched to your current session. Retry to refresh it safely, or sign out.',
      ),
      currentRecovery.error && createElement('p', {
        className: 'max-w-md text-sm text-destructive',
      }, currentRecovery.error),
      createElement('div', { className: 'flex flex-wrap items-center gap-2' },
        createElement(Button, {
          type: 'button', size: 'sm', disabled: pending,
          onClick: () => runScopeRecovery('recover', true),
        }, currentRecovery.operation === 'recover' ? 'Refreshing session…' : 'Retry session'),
        createElement(Button, {
          type: 'button', size: 'sm', variant: 'outline', disabled: pending,
          onClick: () => runScopeRecovery('sign-out', true),
        }, currentRecovery.operation === 'sign-out' ? 'Signing out…' : 'Sign out'),
      ),
      pending && createElement('p', {
        role: 'status', 'aria-live': 'polite', className: 'text-sm text-muted-foreground',
      }, currentRecovery.operation === 'sign-out' ? 'Signing out securely…' : 'Refreshing your secure session…'),
    );
  }
  if (!display.render || needsRecovery || recoveryPending || currentRecovery) {
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
      currentRecovery?.operation === 'recover' ? 'Refreshing your secure session…'
        : currentRecovery?.operation === 'sign-out' ? 'Signing out securely…'
          : authorizationScopeTransitionMessage(auth?.sessionTransition.operation ?? null),
    );
  }
  return createElement(Fragment, { key: display.displayedScopeKey }, children);
}

function isPlainHistoryState(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordAuthorizationScopeReload(reloadKey: string): void {
  const historyState = isPlainHistoryState(window.history.state) ? window.history.state : {};
  window.history.replaceState({ ...historyState, __zeroAuthorizationBoundaryReload: reloadKey }, '');
}

function AuthRouteGuard({
  loginPath,
  postLoginPath,
  publicPaths,
  routeAuth,
  children,
}: {
  loginPath: string;
  postLoginPath: string;
  publicPaths: string[];
  routeAuth: RouteAuthMode;
  children?: ReactNode;
}) {
  const { isAuthenticated, isLoading, isRestoring, user } = useAuth();
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
  const isLoginRoute = comparableAuthPathname(pathname) === comparableAuthPathname(
    configuredAuthPathname(loginPath, 'loginPath'),
  );
  const authenticatedDestination = !isLoading && isAuthenticated && isLoginRoute
    ? authenticatedLoginDestination({
        loginPath,
        postLoginPath,
        search: window.location.search,
      })
    : null;

  useEffect(() => {
    if (isLoading) return;

    if (authenticatedDestination) {
      router.replace(authenticatedDestination, { bypassGuards: true });
      return;
    }

    if (!routeRequiresAuth || isAuthenticated) return;

    const from = `${pathname}${window.location.search}${window.location.hash}`;
    const target = loginRedirectLocation(loginPath, from);
    emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_AUTH_SESSION_REDIRECT, {
      metadata: { from: pathname, to: loginPath },
    });
    router.replace(target, { bypassGuards: true });
  }, [
    isAuthenticated,
    authenticatedDestination,
    isLoading,
    isLoginRoute,
    loginPath,
    pathname,
    postLoginPath,
    routeRequiresAuth,
    router,
  ]);

  if (isRestoring && isLoginRoute) {
    return null;
  }

  if (authenticatedDestination) {
    return null;
  }

  if (!isLoading && routeRequiresAuth && !isAuthenticated) {
    return null;
  }

  if (!isLoading && routeRequiresAdmin && isAuthenticated && user?.role !== 'admin') {
    return null;
  }

  return createElement(Fragment, null, children);
}
