'use client';

/**
 * hydrate-runtime.tsx
 *
 * Owns Zero's browser hydration runtime. This file consumes an app-generated
 * route manifest and wires React hydration, client routing, and frontend
 * observability only; it does not scan route files or generate build artifacts.
 */

import { createRoot, hydrateRoot } from 'react-dom/client';
import {
  createElement,
  useEffect,
  useRef,
  useState,
  startTransition,
} from 'react';
import type { ReactNode } from 'react';
import type { SyncDataPlaneName, SyncMode } from '../../sync/types';
import type { RouteAuthorizationBoundary } from '../router/authorization-route-boundary';
import { registerRoute, navigateTo } from './client-router';
import { RouterProvider } from './router-context';
import { ErrorBoundary } from './error-boundary';
import { usePathname, useRouter } from './router-context';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from './observability';
import {
  RouteAuthProvider,
  getRouteAuthRequirementFromModules,
} from './route-auth-context';
import type { EffectiveRouteAuthRequirement } from '../router/auth-policy';

export interface HydrationManifestEntry {
  pattern: string;
  load: () => Promise<RouteModuleWithConfig>;
  layouts: Array<() => Promise<RouteModuleWithConfig>>;
}

export interface HydrationManifest {
  routes: HydrationManifestEntry[];
  serverRoutes: string[];
}

declare global {
  interface Window {
    __ROUTE_DATA__?: {
      pattern: string;
      params: Record<string, string>;
      loaderData: unknown;
      authorizationBoundary?: RouteAuthorizationBoundary | null;
      renderMode?: 'client' | 'ssr';
    };
    __PLATFORM_CONFIG__?: {
      url: string;
      auth?: boolean;
      stateSync?: boolean;
      tableSyncModes?: Record<string, SyncMode>;
      tableSyncPlanes?: Record<string, SyncDataPlaneName>;
      managedTableNames?: string[];
      publicPaths?: string[];
      routeAuth?: 'protected-by-default' | 'explicit';
      loginPath?: string;
      postLoginPath?: string;
    };
  }
}

interface ShellState {
  Page: (props: any) => ReactNode;
  layouts: Array<(props: { children?: ReactNode; params?: Record<string, string> }) => ReactNode>;
  params: Record<string, string>;
  loaderData: unknown;
  routeAuthRequirement: EffectiveRouteAuthRequirement;
}

interface ShellProps {
  initialPage: (props: any) => ReactNode;
  initialLayouts: Array<(props: any) => ReactNode>;
  initialParams: Record<string, string>;
  initialLoaderData: unknown;
  initialRouteAuthRequirement: EffectiveRouteAuthRequirement;
  serverRoutes: string[];
}

interface RouteModuleWithConfig {
  default?: (props: any) => ReactNode;
  config?: {
    auth?: boolean | 'required' | 'admin';
  };
}

function hasDefaultComponent(
  component: RouteModuleWithConfig['default'],
): component is NonNullable<RouteModuleWithConfig['default']> {
  return Boolean(component);
}

/**
 * Hydrate the server-rendered app with an app-generated route manifest.
 *
 * The manifest is generated outside framework source so installed package mode
 * can keep Zero internals in node_modules while app routes stay app-owned.
 */
export async function startHydration(manifest: HydrationManifest): Promise<void> {
  registerManifestRoutes(manifest.routes);

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    emitFrontendCode(OBS_CODES.FRONTEND_HYDRATE_MISSING_ROOT);
    return;
  }

  const routeData = window.__ROUTE_DATA__;

  if (!routeData) {
    emitFrontendCode(OBS_CODES.FRONTEND_HYDRATE_MISSING_ROUTE_DATA);
    return;
  }

  const entry = manifest.routes.find((route) => route.pattern === routeData.pattern);
  if (!entry) {
    emitFrontendCode(OBS_CODES.FRONTEND_HYDRATE_MISSING_MANIFEST_ENTRY, {
      metadata: { pattern: routeData.pattern },
    });
    return;
  }

  try {
    const [pageMod, ...layoutMods] = await Promise.all([
      entry.load(),
      ...entry.layouts.map((loadLayout) => loadLayout()),
    ]);

    const Page = pageMod.default;
    if (!Page) {
      emitFrontendCode(OBS_CODES.FRONTEND_HYDRATE_MISSING_PAGE_EXPORT, {
        metadata: { pattern: routeData.pattern },
      });
      return;
    }

    const layoutComponents = layoutMods
      .map((module) => module.default)
      .filter(hasDefaultComponent);
    const routeAuthRequirement = getRouteAuthRequirementFromModules([
      ...layoutMods,
      pageMod,
    ]);

    const shell = createElement(Shell, {
      initialPage: Page,
      initialLayouts: layoutComponents,
      initialParams: routeData.params,
      initialLoaderData: routeData.loaderData,
      initialRouteAuthRequirement: routeAuthRequirement,
      serverRoutes: manifest.serverRoutes,
    });

    const app = createElement(
      ErrorBoundary,
      {
        children: createElement(
          RouterProvider,
          {
            initialPathname: location.pathname,
            initialParams: routeData.params,
            children: shell,
          }
        ),
      }
    );

    if (routeData.renderMode === 'client') {
      createRoot(rootEl).render(app);
      return;
    }

    hydrateRoot(rootEl, app);
  } catch (err) {
    emitFrontendCode(OBS_CODES.FRONTEND_HYDRATE_FAILED, {
      error: err,
    });
  }
}

/** Register app routes with the client router before navigation begins. */
function registerManifestRoutes(routes: HydrationManifestEntry[]): void {
  for (const entry of routes) {
    registerRoute(entry.pattern, entry.load, entry.layouts);
  }
}

/**
 * Holds the current page and layout chain for client-side navigation.
 *
 * The root layout remains responsible for AppProvider ownership; hydration only
 * provides routing and error boundaries around the server-rendered tree.
 */
function Shell({
  initialPage,
  initialLayouts,
  initialParams,
  initialLoaderData,
  initialRouteAuthRequirement,
  serverRoutes,
}: ShellProps) {
  const [current, setCurrent] = useState<ShellState>({
    Page: initialPage,
    layouts: initialLayouts,
    params: initialParams,
    loaderData: initialLoaderData,
    routeAuthRequirement: initialRouteAuthRequirement,
  });

  const pathname = usePathname();
  const { setParams, setIsNavigating } = useRouter();
  const prevPathname = useRef(pathname);
  const navigationGeneration = useRef(0);

  useEffect(() => {
    if (pathname === prevPathname.current) return;
    prevPathname.current = pathname;
    const generation = ++navigationGeneration.current;
    let active = true;
    const isCurrentNavigation = () => active
      && generation === navigationGeneration.current
      && window.location.pathname === pathname;

    if (isServerRoute(pathname, serverRoutes)) {
      // History has already committed the safe local destination. Reload that
      // complete URL instead of dropping its query or fragment via pathname.
      window.location.reload();
      return;
    }

    setIsNavigating(true);

    navigateTo(pathname).then((result) => {
      if (!isCurrentNavigation()) return;
      if (!result) {
        window.location.reload();
        return;
      }

      const layoutComponents = result.layoutModules
        .map((module) => module.default)
        .filter(hasDefaultComponent);
      const routeAuthRequirement = getRouteAuthRequirementFromModules([
        ...result.layoutModules,
        result.module,
      ]);

      startTransition(() => {
        if (!isCurrentNavigation()) return;
        const next = {
          Page: result.module.default,
          layouts: layoutComponents,
          params: result.params,
          loaderData: undefined,
          routeAuthRequirement,
        };
        setCurrent((previous) => isCurrentNavigation() ? next : previous);
        setParams(result.params);
        setIsNavigating(false);
      });
    }).catch(() => {
      if (isCurrentNavigation()) setIsNavigating(false);
    });
    return () => { active = false; };
  }, [pathname, serverRoutes, setParams, setIsNavigating]);

  let element: ReactNode = createElement(current.Page, {
    params: current.params,
    data: current.loaderData,
  });

  for (let i = current.layouts.length - 1; i >= 0; i--) {
    const Layout = current.layouts[i];
    element = createElement(Layout, { params: current.params }, element);
  }

  return createElement(RouteAuthProvider, {
    requirement: current.routeAuthRequirement,
    children: element,
  });
}

/** Return whether navigation must fall back to a full server request. */
function isServerRoute(pathname: string, serverRoutes: string[]): boolean {
  for (const pattern of serverRoutes) {
    if (matchesPattern(pattern, pathname)) return true;
  }
  return false;
}

/** Match a route pattern with dynamic and catch-all segments against a path. */
function matchesPattern(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true;

  const patternParts = pattern.replace(/^\/|\/$/g, '').split('/');
  const pathParts = pathname.replace(/^\/|\/$/g, '').split('/');

  if (patternParts.length !== pathParts.length) {
    if (!patternParts.some((part) => part.startsWith('[...'))) return false;
  }

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    if (patternPart.startsWith('[...')) return true;
    if (patternPart.startsWith('[') && patternPart.endsWith(']')) continue;
    if (patternPart !== pathParts[i]) return false;
  }

  return true;
}
