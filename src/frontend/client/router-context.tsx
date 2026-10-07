'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  createElement,
} from 'react';
import type { ReactNode } from 'react';
import { prefetchRoute } from './client-router';
import { RouterNavigation, type NavigationGuard, type NavigationOptions } from './router-navigation';
import { emitFrontendCode } from './observability';
import { OBS_CODES } from '../../observability/codes';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RouterState {
  pathname: string;
  params: Record<string, string>;
}

export interface RouterActions {
  push: (path: string, options?: NavigationOptions) => void;
  replace: (path: string, options?: NavigationOptions) => void;
  back: (options?: NavigationOptions) => void;
  prefetch: (path: string) => void;
  isNavigating: boolean;
  setParams: (params: Record<string, string>) => void;
  setIsNavigating: (v: boolean) => void;
}

interface RouterContextValue {
  state: RouterState;
  actions: RouterActions;
  navigation: RouterNavigation;
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
  const navigationRef = useRef<RouterNavigation | null>(null);
  if (!navigationRef.current) navigationRef.current = new RouterNavigation(initialPathname ?? '/', () => {
    emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, { metadata: { surface: 'navigation-guard', stage: 'admission' } });
  });
  const navigation = navigationRef.current;
  // Publish only admitted URLs. Temporary history rollback never unmounts a draft.
  const pathname = useSyncExternalStore(
    navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot,
  );

  const [params, setParams] = useState<Record<string, string>>(initialParams ?? {});
  const [isNavigating, setIsNavigating] = useState(false);

  const push = useCallback((path: string, options?: NavigationOptions) => navigation.push(path, options), [navigation]);

  const replace = useCallback((path: string, options?: NavigationOptions) => navigation.replace(path, options), [navigation]);

  const back = useCallback((options?: NavigationOptions) => navigation.back(options), [navigation]);

  const prefetch = useCallback((path: string) => {
    prefetchRoute(path);
  }, []);

  const value: RouterContextValue = {
    state: { pathname, params },
    actions: { push, replace, back, prefetch, isNavigating, setParams, setIsNavigating },
    navigation,
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

/** Opt-in pre-navigation admission. Safely no-ops in standalone forms without a router. */
export function useNavigationGuard(guard: NavigationGuard, enabled = true): void {
  const context = useContext(RouterContext), latest = useRef({ guard, enabled });
  latest.current = { guard, enabled };
  useEffect(() => {
    if (!context || !enabled) return;
    return context.navigation.register(() => latest.current.enabled ? latest.current.guard() : true);
  }, [context?.navigation, enabled]);
}
export type { NavigationGuard, NavigationOptions } from './router-navigation';
