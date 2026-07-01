// ─── Client-Side Route Matching ────────────────────────────────────────────

import type { ReactNode } from 'react';

/** Route module shape loaded by the browser route manifest. */
export interface ClientRouteModule {
  default?: (props: any) => ReactNode;
  config?: {
    auth?: boolean | 'required' | 'admin';
  };
}

/**
 * A client-side route entry (generated from the route tree at build time
 * or discovered from the server's route manifest).
 */
export interface ClientRoute {
  /** URL pattern (e.g., '/posts/[id]') */
  pattern: string;
  /** Compiled regex for matching */
  regex: RegExp;
  /** Param names extracted from the pattern */
  paramNames: string[];
  /** Dynamic import function for the page module */
  load: () => Promise<ClientRouteModule>;
  /** Dynamic import functions for layout modules (root → leaf order) */
  layouts: Array<() => Promise<ClientRouteModule>>;
  /** Whether this is a catch-all route */
  isCatchAll: boolean;
}

/** Client-side match result. */
export interface ClientMatch {
  route: ClientRoute;
  params: Record<string, string>;
}

// ─── Route Registry ────────────────────────────────────────────────────────

const routes: ClientRoute[] = [];
const moduleCache = new Map<string, ClientRouteModule>();

/**
 * Register a client-side route.
 * Called during initialization to populate the route table.
 */
export function registerRoute(
  pattern: string,
  load: () => Promise<ClientRouteModule>,
  layouts: Array<() => Promise<ClientRouteModule>> = []
): void {
  const { regex, paramNames, isCatchAll } = compilePattern(pattern);
  routes.push({ pattern, regex, paramNames, load, layouts, isCatchAll });
}

/**
 * Match a pathname against registered routes.
 *
 * Priority:
 * 1. Exact static match
 * 2. Dynamic segments
 * 3. Catch-all
 */
export function matchClientRoute(pathname: string): ClientMatch | null {
  // Sort: static first, then dynamic, then catch-all
  const sorted = [...routes].sort((a, b) => {
    if (a.isCatchAll !== b.isCatchAll) return a.isCatchAll ? 1 : -1;
    const aDynamic = a.paramNames.length > 0;
    const bDynamic = b.paramNames.length > 0;
    if (aDynamic !== bDynamic) return aDynamic ? 1 : -1;
    return 0;
  });

  for (const route of sorted) {
    const match = route.regex.exec(pathname);
    if (match) {
      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = match[i + 1] ?? '';
      }
      return { route, params };
    }
  }

  return null;
}

/**
 * Load a route's module (with caching).
 */
export async function loadRouteModule(route: ClientRoute): Promise<ClientRouteModule> {
  const cached = moduleCache.get(route.pattern);
  if (cached) return cached;

  const mod = await route.load();
  moduleCache.set(route.pattern, mod);
  return mod;
}

/**
 * Load layout modules for a route (with caching).
 */
export async function loadLayoutModules(route: ClientRoute): Promise<ClientRouteModule[]> {
  return Promise.all(
    route.layouts.map(async (load, i) => {
      const key = `${route.pattern}::layout::${i}`;
      const cached = moduleCache.get(key);
      if (cached) return cached;
      const mod = await load();
      moduleCache.set(key, mod);
      return mod;
    })
  );
}

/**
 * Prefetch a route's module + layouts into the cache without rendering.
 */
export function prefetchRoute(pathname: string): void {
  const match = matchClientRoute(pathname);
  if (match) {
    loadRouteModule(match.route).catch(() => {});
    loadLayoutModules(match.route).catch(() => {});
  }
}

/**
 * Navigate to a new URL — match route, load module + layouts.
 * Returns the loaded module, layout modules, params, and matched route, or null for unknown routes.
 */
export async function navigateTo(
  pathname: string
): Promise<{
  module: ClientRouteModule & { default: any };
  layoutModules: ClientRouteModule[];
  params: Record<string, string>;
  route: ClientRoute;
} | null> {
  const match = matchClientRoute(pathname);
  if (!match) return null;

  const [mod, layoutMods] = await Promise.all([
    loadRouteModule(match.route),
    loadLayoutModules(match.route),
  ]);

  if (!mod.default) return null;

  return {
    module: mod as ClientRouteModule & { default: any },
    layoutModules: layoutMods,
    params: match.params,
    route: match.route,
  };
}

/** Clear the module cache — for hot reload. */
export function clearModuleCache(): void {
  moduleCache.clear();
}

// ─── Internal ──────────────────────────────────────────────────────────────

interface CompiledPattern {
  regex: RegExp;
  paramNames: string[];
  isCatchAll: boolean;
}

/**
 * Compile a route pattern into a regex.
 *
 * @example
 * '/posts/[id]'      → /^\/posts\/([^/]+)\/?$/
 * '/docs/[...path]'  → /^\/docs\/(.+)\/?$/
 * '/'                → /^\/\/?$/
 */
function compilePattern(pattern: string): CompiledPattern {
  const paramNames: string[] = [];
  let isCatchAll = false;

  if (pattern === '/') {
    return { regex: /^\/?$/, paramNames, isCatchAll };
  }

  const segments = pattern.replace(/^\/|\/$/g, '').split('/');
  let regexStr = '^';

  for (const segment of segments) {
    regexStr += '\\/';

    if (segment.startsWith('[...') && segment.endsWith(']')) {
      // Catch-all: matches remaining path
      const name = segment.slice(4, -1);
      paramNames.push(name);
      regexStr += '(.+)';
      isCatchAll = true;
    } else if (segment.startsWith('[') && segment.endsWith(']')) {
      // Dynamic segment
      const name = segment.slice(1, -1);
      paramNames.push(name);
      regexStr += '([^/]+)';
    } else {
      // Static segment
      regexStr += escapeRegex(segment);
    }
  }

  regexStr += '\\/?$';

  return { regex: new RegExp(regexStr), paramNames, isCatchAll };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
