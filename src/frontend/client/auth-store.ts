/** XState store for browser authentication and current-user properties. */

import { createStore } from '@xstate/store';
import type {
  AuthSessionTransitionState,
  AuthTenantSummary,
  AuthUser,
} from './auth-types';

export interface AuthStoreContext {
  user: AuthUser | null;
  activeTenant: AuthTenantSummary | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;
  sessionTransition: AuthSessionTransitionState;
}

export function createAuthStore() {
  const initial: AuthStoreContext = {
    user: null,
    activeTenant: null,
    accessToken: null,
    refreshToken: null,
    isLoading: false as boolean,
    error: null,
    sessionTransition: {
      phase: 'idle',
      operation: null,
      revision: 0,
      recoverable: false,
      error: null,
    },
  };

  return createStore({
    context: initial,
    on: {
      'auth.loading': (context: AuthStoreContext): AuthStoreContext => ({
        ...context,
        isLoading: true,
        error: null,
      }),
      'auth.success': (
        context: AuthStoreContext,
        event: {
          user: AuthUser;
          activeTenant?: AuthTenantSummary;
          accessToken: string;
          refreshToken: string;
        },
      ): AuthStoreContext => ({
        ...context,
        user: event.user,
        activeTenant: event.activeTenant ?? null,
        accessToken: event.accessToken,
        refreshToken: event.refreshToken,
        isLoading: false,
        error: null,
      }),
      'auth.error': (
        context: AuthStoreContext,
        event: { error: string },
      ): AuthStoreContext => ({
        ...context,
        isLoading: false,
        error: event.error,
      }),
      'auth.logout': (context: AuthStoreContext): AuthStoreContext => ({
        ...context,
        user: null,
        activeTenant: null,
        accessToken: null,
        refreshToken: null,
        isLoading: false,
        error: null,
      }),
      'auth.refresh': (
        context: AuthStoreContext,
        event: {
          accessToken: string;
          refreshToken: string;
          activeTenant?: AuthTenantSummary;
        },
      ): AuthStoreContext => ({
        ...context,
        accessToken: event.accessToken,
        refreshToken: event.refreshToken,
        activeTenant: event.activeTenant ?? context.activeTenant,
      }),
      'auth.properties.patch': (
        context: AuthStoreContext,
        event: { properties: Record<string, string> },
      ): AuthStoreContext => context.user
        ? {
            ...context,
            user: {
              ...context.user,
              properties: { ...context.user.properties, ...event.properties },
            },
          }
        : context,
      'auth.properties.replace': (
        context: AuthStoreContext,
        event: { properties: Record<string, string> },
      ): AuthStoreContext => context.user
        ? {
            ...context,
            user: { ...context.user, properties: event.properties },
          }
        : context,
      'auth.properties.delete': (
        context: AuthStoreContext,
        event: { key: string },
      ): AuthStoreContext => {
        if (!context.user) return context;
        const properties = { ...context.user.properties };
        delete properties[event.key];
        return {
          ...context,
          user: { ...context.user, properties },
        };
      },
      'auth.clearError': (context: AuthStoreContext): AuthStoreContext => ({
        ...context,
        error: null,
      }),
      'auth.transition': (
        context: AuthStoreContext,
        event: { transition: AuthSessionTransitionState },
      ): AuthStoreContext => ({
        ...context,
        sessionTransition: event.transition,
      }),
    },
  });
}

export type AuthStore = ReturnType<typeof createAuthStore>;

export function sendAuthStoreEvent(
  store: AuthStore,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  // XState's event union is inferred correctly at each handler but cannot be
  // indexed by a runtime type string used by the session coordinator.
  (store as any).send({ type, ...payload });
}
