'use client';

import { hydrateRoot } from 'react-dom/client';
import {
  createElement,
  useState,
  useEffect,
  useRef,
  startTransition,
} from 'react';
import type { ReactNode } from 'react';
import type { SyncMode } from '../../sync/types';
import { routes, serverRoutes } from './_generated/route-manifest';
import { registerRoute, navigateTo } from './client-router';
import { RouterProvider } from './router-context';
import { ErrorBoundary } from './error-boundary';
import { usePathname, useRouter } from './router-context';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from './observability';

// ─── Types ─────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    __ROUTE_DATA__?: {
      pattern: string;
      params: Record<string, string>;
      loaderData: unknown;
    };
    __PLATFORM_CONFIG__?: {
      url: string;
      auth?: boolean;
      stateSync?: boolean;
      tableSyncModes?: Record<string, SyncMode>;
    };
  }
}

// ─── Register routes from manifest ─────────────────────────────────────────

for (const entry of routes) {
  registerRoute(entry.pattern, entry.load, entry.layouts);
}

// ─── Shell Component ───────────────────────────────────────────────────────

interface ShellState {
  Page: (props: any) => ReactNode;
  layouts: Array<(props: { children?: ReactNode; params?: Record<string, string> }) => ReactNode>;
  params: Record<string, string>;
  loaderData: unknown;
}

interface ShellProps {
  initialPage: (props: any) => ReactNode;
  initialLayouts: Array<(props: any) => ReactNode>;
  initialParams: Record<string, string>;
  initialLoaderData: unknown;
}

/**
 * Shell holds the current page + layouts in state.
 * On client-side navigation, it swaps the page component
 * while keeping shared layouts mounted.
 */
function Shell({ initialPage, initialLayouts, initialParams, initialLoaderData }: ShellProps) {
  const [current, setCurrent] = useState<ShellState>({
    Page: initialPage,
    layouts: initialLayouts,
    params: initialParams,
    loaderData: initialLoaderData,
  });

  const pathname = usePathname();
  const { setParams, setIsNavigating } = useRouter();
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (pathname === prevPathname.current) return;
    prevPathname.current = pathname;

    // Server-only pages: full page navigation (no client JS for that page)
    if (isServerRoute(pathname)) {
      window.location.href = pathname;
      return;
    }

    setIsNavigating(true);

    navigateTo(pathname).then((result) => {
      if (!result) {
        // Unknown route — fall back to full page navigation
        window.location.href = pathname;
        return;
      }

      const layoutComponents = result.layoutModules
        .map((m) => m.default)
        .filter(Boolean);

      startTransition(() => {
        setCurrent({
          Page: result.module.default,
          layouts: layoutComponents,
          params: result.params,
          loaderData: undefined,
        });
        setParams(result.params);
        setIsNavigating(false);
      });
    }).catch(() => {
      setIsNavigating(false);
    });
  }, [pathname, setParams, setIsNavigating]);

  // Nest layouts around page: outermost layout wraps innermost
  let element: ReactNode = createElement(current.Page, {
    params: current.params,
    data: current.loaderData,
  });

  for (let i = current.layouts.length - 1; i >= 0; i--) {
    const Layout = current.layouts[i];
    element = createElement(Layout, { params: current.params }, element);
  }

  return element;
}

// ─── Hydration Entry ───────────────────────────────────────────────────────

/**
 * Hydrate the server-rendered HTML.
 *
 * Only wraps in RouterProvider + ErrorBoundary.
 * The app's root layout is responsible for providing AppProvider
 * (with correct table definitions from the app's schema imports).
 *
 * Previously, hydrate.tsx also wrapped in AppProvider using tables from
 * __PLATFORM_CONFIG__ — but those are server table schemas (SQL column defs),
 * NOT ClientTableDef objects. The singleton client created here would have
 * tables without _pk fields, causing "Unknown table" errors on insert.
 */
async function hydrate() {
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

  // Find the manifest entry matching the server-rendered pattern
  const entry = routes.find((r: { pattern: string }) => r.pattern === routeData.pattern);
  if (!entry) {
    emitFrontendCode(OBS_CODES.FRONTEND_HYDRATE_MISSING_MANIFEST_ENTRY, {
      metadata: { pattern: routeData.pattern },
    });
    return;
  }

  try {
    // Load page + layouts in parallel
    const [pageMod, ...layoutMods] = await Promise.all([
      entry.load(),
      ...entry.layouts.map((l: () => Promise<{ default: any }>) => l()),
    ]);

    const Page = pageMod.default;
    if (!Page) {
      emitFrontendCode(OBS_CODES.FRONTEND_HYDRATE_MISSING_PAGE_EXPORT, {
        metadata: { pattern: routeData.pattern },
      });
      return;
    }

    const layoutComponents = layoutMods
      .map((m: { default: any }) => m.default)
      .filter(Boolean);

    // RouterProvider + ErrorBoundary only.
    // AppProvider (SDK client, sync, auth) is provided by the app's root layout.
    const shell = createElement(Shell, {
      initialPage: Page,
      initialLayouts: layoutComponents,
      initialParams: routeData.params,
      initialLoaderData: routeData.loaderData,
    });

    hydrateRoot(
      rootEl,
      createElement(
        ErrorBoundary,
        { children:
          createElement(
            RouterProvider,
            {
              initialPathname: location.pathname,
              initialParams: routeData.params,
              children: shell,
            }
          )
        }
      )
    );
  } catch (err) {
    emitFrontendCode(OBS_CODES.FRONTEND_HYDRATE_FAILED, {
      error: err,
    });
  }
}

// ─── Server Route Detection ───────────────────────────────────────────────

/**
 * Check if a pathname matches a server-only route.
 * Server routes don't have client JS — navigation to them
 * requires a full page request.
 */
function isServerRoute(pathname: string): boolean {
  for (const pattern of serverRoutes) {
    if (matchesPattern(pattern, pathname)) return true;
  }
  return false;
}

function matchesPattern(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true;
  // Simple dynamic segment matching for server route patterns
  const patternParts = pattern.replace(/^\/|\/$/g, '').split('/');
  const pathParts = pathname.replace(/^\/|\/$/g, '').split('/');
  if (patternParts.length !== pathParts.length) {
    // Check for catch-all
    if (!patternParts.some((p) => p.startsWith('[...'))) return false;
  }
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp.startsWith('[...')) return true; // catch-all matches rest
    if (pp.startsWith('[') && pp.endsWith(']')) continue; // dynamic segment matches any
    if (pp !== pathParts[i]) return false;
  }
  return true;
}

// Auto-hydrate when the script loads
hydrate();
