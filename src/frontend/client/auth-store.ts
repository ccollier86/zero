/** XState store for browser authentication and current-user properties. */

import { createStore } from '@xstate/store';
import type {
  AuthCompletionResult,
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
  isRestoring: boolean;
  error: string | null;
  authenticationContinuation: AuthCompletionResult | null;
  sessionTransition: AuthSessionTransitionState;
}

export function createAuthStore() {
  const initial: AuthStoreContext = {
    user: null,
    activeTenant: null,
    accessToken: null,
    refreshToken: null,
    isLoading: false as boolean,
    isRestoring: false as boolean,
    error: null,
    authenticationContinuation: null,
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
        isRestoring: false,
        error: null,
        authenticationContinuation: null,
      }),
      'auth.continuation': (
        context: AuthStoreContext,
        event: { result: AuthCompletionResult },
      ): AuthStoreContext => ({
        ...context,
        isLoading: false,
        isRestoring: false,
        error: null,
        authenticationContinuation: event.result,
      }),
      'auth.restoring': (context: AuthStoreContext): AuthStoreContext => ({
        ...context,
        isLoading: true,
        isRestoring: true,
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
        isRestoring: false,
        error: null,
        authenticationContinuation: null,
      }),
      'auth.error': (
        context: AuthStoreContext,
        event: { error: string },
      ): AuthStoreContext => ({
        ...context,
        isLoading: false,
        isRestoring: false,
        error: event.error,
        authenticationContinuation: null,
      }),
      'auth.logout': (context: AuthStoreContext): AuthStoreContext => ({
        ...context,
        user: null,
        activeTenant: null,
        accessToken: null,
        refreshToken: null,
        isLoading: false,
        isRestoring: false,
        error: null,
        authenticationContinuation: null,
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
      'auth.continuation.clear': (context: AuthStoreContext): AuthStoreContext => ({
        ...context,
        authenticationContinuation: null,
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
