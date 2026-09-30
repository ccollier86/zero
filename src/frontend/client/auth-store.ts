/** XState store for browser authentication and current-user properties. */

import { createStore } from '@xstate/store';
import type { AuthUser } from './auth-types';

export interface AuthStoreContext {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  isRestoring: boolean;
  error: string | null;
}

export function createAuthStore() {
  const initial: AuthStoreContext = {
    user: null,
    accessToken: null,
    refreshToken: null,
    isLoading: false as boolean,
    isRestoring: false as boolean,
    error: null,
  };

  return createStore({
    context: initial,
    on: {
      'auth.loading': (context: AuthStoreContext): AuthStoreContext => ({
        ...context,
        isLoading: true,
        isRestoring: false,
        error: null,
      }),
      'auth.restoring': (context: AuthStoreContext): AuthStoreContext => ({
        ...context,
        isLoading: true,
        isRestoring: true,
        error: null,
      }),
      'auth.success': (
        context: AuthStoreContext,
        event: { user: AuthUser; accessToken: string; refreshToken: string },
      ): AuthStoreContext => ({
        ...context,
        user: event.user,
        accessToken: event.accessToken,
        refreshToken: event.refreshToken,
        isLoading: false,
        isRestoring: false,
        error: null,
      }),
      'auth.error': (
        context: AuthStoreContext,
        event: { error: string },
      ): AuthStoreContext => ({
        ...context,
        isLoading: false,
        isRestoring: false,
        error: event.error,
      }),
      'auth.logout': (context: AuthStoreContext): AuthStoreContext => ({
        ...context,
        user: null,
        accessToken: null,
        refreshToken: null,
        isLoading: false,
        isRestoring: false,
        error: null,
      }),
      'auth.refresh': (
        context: AuthStoreContext,
        event: { accessToken: string; refreshToken: string },
      ): AuthStoreContext => ({
        ...context,
        accessToken: event.accessToken,
        refreshToken: event.refreshToken,
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
