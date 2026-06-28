'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useSyncExternalStore,
  createElement,
} from 'react';
import type { ReactNode } from 'react';
import { prefetchRoute } from './client-router';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RouterState {
  pathname: string;
  params: Record<string, string>;
}

export interface RouterActions {
  push: (path: string) => void;
  replace: (path: string) => void;
  back: () => void;
  prefetch: (path: string) => void;
  isNavigating: boolean;
  setParams: (params: Record<string, string>) => void;
  setIsNavigating: (v: boolean) => void;
}

interface RouterContextValue {
  state: RouterState;
  actions: RouterActions;
}

// ─── Context ───────────────────────────────────────────────────────────────

const RouterContext = createContext<RouterContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────────

export interface RouterProviderProps {
  /** Initial pathname from SSR */
  initialPathname?: string;
  /** Initial params from SSR */
  initialParams?: Record<string, string>;
  children: ReactNode;
}

/**
 * Client-side router provider.
 * Manages URL state and provides navigation functions.
 * Listens for popstate events (browser back/forward).
 */
export function RouterProvider({
  initialPathname,
  initialParams,
  children,
}: RouterProviderProps) {
  // Subscribe to browser URL changes
  const pathname = useSyncExternalStore(
    subscribeToUrl,
    () => window.location.pathname,
    () => initialPathname ?? '/',
  );

  const [params, setParams] = useState<Record<string, string>>(initialParams ?? {});
  const [isNavigating, setIsNavigating] = useState(false);

  const push = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const replace = useCallback((path: string) => {
    window.history.replaceState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const back = useCallback(() => {
    window.history.back();
  }, []);

  const prefetch = useCallback((path: string) => {
    prefetchRoute(path);
  }, []);

  const value: RouterContextValue = {
    state: { pathname, params },
    actions: { push, replace, back, prefetch, isNavigating, setParams, setIsNavigating },
  };

  return createElement(RouterContext.Provider, { value }, children);
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

/**
 * Get the current route params.
 *
 * @example
 * ```tsx
 * const { id } = useParams<{ id: string }>();
 * ```
 */
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  const ctx = useRouterContext();
  return ctx.state.params as T;
}

/** Get the current URL pathname. */
export function usePathname(): string {
  const ctx = useRouterContext();
  return ctx.state.pathname;
}

/**
 * Get router navigation actions.
 *
 * @example
 * ```tsx
 * const { push, back, isNavigating } = useRouter();
 * ```
 */
export function useRouter(): RouterActions {
  const ctx = useRouterContext();
  return ctx.actions;
}

/**
 * Check if we're already inside a RouterProvider.
 * Used by AppProvider to avoid creating a duplicate provider.
 */
export function useHasRouter(): boolean {
  return useContext(RouterContext) !== null;
}

// ─── Internal ──────────────────────────────────────────────────────────────

function useRouterContext(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter/useParams/usePathname must be used within <RouterProvider>');
  }
  return ctx;
}

/** Subscribe to popstate events for useSyncExternalStore. */
function subscribeToUrl(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}
