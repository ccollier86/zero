'use client';

/**
 * route-auth-context.tsx
 *
 * Provides the browser with the auth requirement for the currently rendered
 * file route. This file owns route-auth context only; token refresh and route
 * policy decisions stay in AppProvider and auth-policy helpers.
 */

import {
  createContext,
  createElement,
  useContext,
} from 'react';
import type { ReactNode } from 'react';
import {
  mergeRouteAuthRequirements,
  type EffectiveRouteAuthRequirement,
  type RouteAuthRequirement,
} from '../router/auth-policy';

interface RouteModuleWithConfig {
  config?: {
    auth?: RouteAuthRequirement;
  };
}

const RouteAuthContext = createContext<EffectiveRouteAuthRequirement>(false);

export interface RouteAuthProviderProps {
  /** Effective page/layout auth requirement for the active route. */
  requirement: EffectiveRouteAuthRequirement;
  children: ReactNode;
}

/** Provide the active file route's merged auth requirement to app providers. */
export function RouteAuthProvider({
  requirement,
  children,
}: RouteAuthProviderProps) {
  return createElement(RouteAuthContext.Provider, { value: requirement }, children);
}

/** Read the active file route's merged auth requirement. */
export function useRouteAuthRequirement(): EffectiveRouteAuthRequirement {
  return useContext(RouteAuthContext);
}

/** Extract and merge auth requirements from root-to-leaf route modules. */
export function getRouteAuthRequirementFromModules(
  modules: readonly RouteModuleWithConfig[],
): EffectiveRouteAuthRequirement {
  return mergeRouteAuthRequirements(modules.map((module) => module.config?.auth));
}
