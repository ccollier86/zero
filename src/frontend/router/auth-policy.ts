/**
 * auth-policy.ts
 *
 * Defines file-router auth policy helpers shared by server rendering and the
 * browser AppProvider. This file owns route auth decisions only; it does not
 * verify tokens, redirect browsers, or render protected UI.
 */

/** Global route-auth strategy used when app auth is enabled. */
export type RouteAuthMode = 'protected-by-default' | 'explicit';

/** Auth requirement supported by page and layout route config. */
export type RouteAuthRequirement = boolean | 'required' | 'admin' | undefined;

/** Normalized auth requirement used by route-aware client guards. */
export type EffectiveRouteAuthRequirement = false | 'required' | 'admin';

/** Return true when a pathname is covered by a public path prefix. */
export function isPublicPath(pathname: string, publicPaths: readonly string[]): boolean {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Return the global route auth mode after applying createApp defaults.
 *
 * Authless apps use `explicit` because there is no auth guard to apply.
 * Auth-enabled apps keep the existing protected-by-default behavior unless an
 * app explicitly opts into route-owned auth boundaries.
 */
export function resolveRouteAuthMode(
  mode: RouteAuthMode | undefined,
  authEnabled: boolean,
): RouteAuthMode {
  if (mode) return mode;
  return authEnabled ? 'protected-by-default' : 'explicit';
}

/** Normalize one page/layout auth config value. */
export function normalizeRouteAuthRequirement(
  requirement: RouteAuthRequirement,
): EffectiveRouteAuthRequirement {
  if (requirement === 'admin') return 'admin';
  if (requirement === true || requirement === 'required') return 'required';
  return false;
}

/**
 * Merge a root-to-leaf list of page/layout auth requirements.
 *
 * Parent layout requirements are not escapable by children. `admin` is the
 * strongest requirement, followed by authenticated user access.
 */
export function mergeRouteAuthRequirements(
  requirements: readonly RouteAuthRequirement[],
): EffectiveRouteAuthRequirement {
  let merged: EffectiveRouteAuthRequirement = false;

  for (const requirement of requirements) {
    const normalized = normalizeRouteAuthRequirement(requirement);
    if (normalized === 'admin') return 'admin';
    if (normalized === 'required') merged = 'required';
  }

  return merged;
}

/**
 * Return whether the current route should require an authenticated user.
 *
 * Route config wins in every mode. In protected-by-default mode, all non-public
 * paths are also protected. In explicit mode, only route config protects pages.
 */
export function shouldRequireAuthForRoute(input: {
  routeAuth: RouteAuthMode;
  pathname: string;
  publicPaths: readonly string[];
  routeRequirement?: EffectiveRouteAuthRequirement;
}): boolean {
  if (input.routeRequirement === 'required' || input.routeRequirement === 'admin') {
    return true;
  }

  if (input.routeAuth === 'protected-by-default') {
    return !isPublicPath(input.pathname, input.publicPaths);
  }

  return false;
}
