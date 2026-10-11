/** Advanced client routing and pure routing contracts. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Client Router (for advanced use) ───────────────────────────────────
export {
  registerRoute,
  matchClientRoute,
  navigateTo,
  prefetchRoute,
} from '../../client/client-router';

// ─── Router Types ────────────────────────────────────────────────────────
export type {
  EffectiveRouteAuthRequirement,
  RouteAuthMode,
  RouteAuthRequirement,
} from '../../router/auth-policy';
export {
  isPublicPath,
  mergeRouteAuthRequirements,
  normalizeRouteAuthRequirement,
  resolveRouteAuthMode,
  shouldRequireAuthForRoute,
} from '../../router/auth-policy';

export type {
  RouteModule,
  RouteNode,
  MatchResult,
  LoaderContext,
  ApiHandler,
  PageMeta,
  RouterConfig,
  RouteConfig,
} from '../../router/types';
