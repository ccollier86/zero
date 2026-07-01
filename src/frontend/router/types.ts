import type { ReactNode } from 'react';

// ─── Route Definition ──────────────────────────────────────────────────────

/**
 * A route module as exported from app/ files.
 *
 * - `page.tsx` exports: default (component), loader?, meta?
 * - `layout.tsx` exports: default (layout component)
 * - `route.ts` exports: GET?, POST?, PUT?, DELETE?, PATCH?
 * - `not-found.tsx` exports: default (404 component)
 */
export interface RouteModule {
  /** The default export — React component for pages/layouts */
  default?: (props: { children?: ReactNode; params?: Record<string, string> }) => ReactNode;
  /** Data loader — runs on server before render */
  loader?: (ctx: LoaderContext) => unknown | Promise<unknown>;
  /** Page metadata */
  meta?: PageMeta | ((params: Record<string, string>) => PageMeta);
  /** API route handlers */
  GET?: ApiHandler;
  POST?: ApiHandler;
  PUT?: ApiHandler;
  DELETE?: ApiHandler;
  PATCH?: ApiHandler;
}

// ─── Route Tree ────────────────────────────────────────────────────────────

/**
 * A node in the route tree. Each node may have:
 * - A page (renders at this URL)
 * - A layout (wraps this node + children)
 * - An API route (handles HTTP methods)
 * - Children (nested segments)
 */
export interface RouteNode {
  /** URL segment (e.g., 'about', '[id]', '(marketing)') */
  segment: string;
  /** Absolute file path to page.tsx, if present */
  pagePath?: string;
  /** Absolute file path to layout.tsx, if present */
  layoutPath?: string;
  /** Absolute file path to not-found.tsx, if present */
  notFoundPath?: string;
  /** Absolute file path to route.ts (API route), if present */
  apiRoutePath?: string;
  /** Child route nodes keyed by segment name */
  children: Map<string, RouteNode>;
  /** Whether this segment is a URL-less route group, e.g. `(public)`. */
  isGroup: boolean;
  /** Whether this segment is dynamic (e.g., [id]) */
  isDynamic: boolean;
  /** Parameter name for dynamic segments (e.g., 'id') */
  paramName?: string;
  /** Whether this is a catch-all segment (e.g., [...path]) */
  isCatchAll: boolean;
}

// ─── Match Result ──────────────────────────────────────────────────────────

/**
 * Result of matching a URL against the route tree.
 */
export interface MatchResult {
  /** URL pattern (e.g., '/posts/[id]') — used for client manifest lookup */
  pattern: string;
  /** Extracted URL parameters */
  params: Record<string, string>;
  /** Ordered list of layout paths from root to leaf (for nesting) */
  layouts: string[];
  /** The matched page path, or null for 404 */
  pagePath: string | null;
  /** The not-found path closest to the match point */
  notFoundPath?: string;
  /** The matched API route path, or null */
  apiRoutePath: string | null;
}

// ─── Loader & API ──────────────────────────────────────────────────────────

/** Context passed to route loaders. */
export interface LoaderContext {
  params: Record<string, string>;
  request: Request;
  /** Authenticated user context (populated by auth middleware). */
  auth?: {
    userId: string;
    role?: string;
    [key: string]: unknown;
  };
  /** Create a redirect Response. */
  redirect: (url: string, status?: number) => Response;
}

/** API route handler signature. */
export type ApiHandler = (ctx: LoaderContext) => Response | Promise<Response>;

/** Page metadata for <head>. */
export interface PageMeta {
  title?: string;
  description?: string;
  [key: string]: unknown;
}

// ─── Route Config ─────────────────────────────────────────────────────────

/**
 * Optional config export from page/route modules.
 *
 * Controls route-level middleware behavior:
 *
 * @example
 * ```tsx
 * // app/admin/page.tsx
 * export const config: RouteConfig = {
 *   auth: 'required',
 *   revalidate: 60, // ISR: cache for 60 seconds
 * };
 * ```
 */
export interface RouteConfig {
  /** Auth requirement for this route. */
  auth?: boolean | 'required' | 'admin';
  /** ISR revalidation interval in seconds. 0 = no cache. */
  revalidate?: number;
  /** Custom middleware — runs before loader/render. Return a Response to short-circuit. */
  middleware?: (ctx: LoaderContext) => Response | void | Promise<Response | void>;
}

// ─── Router Configuration ──────────────────────────────────────────────────

export interface RouterConfig {
  /** Root directory for file-based routes. Default: './app' */
  appDir: string;
  /** Output directory for client bundles. Default: './.build' */
  outDir: string;
}
