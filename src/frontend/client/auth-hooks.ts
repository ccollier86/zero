/**
 * auth-hooks.ts
 *
 * React hooks for browser auth state and user-owned auth actions. This file
 * owns UI-facing auth state shape only; token transport and backend policy
 * enforcement remain inside AuthClient and server auth plugins.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { InternalClient } from './sdk';
import type {
  AuthActionTokenInfo,
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaRequirement,
  AuthAdminMfaResetResult,
  AuthAdminUpdateUserParams,
  AuthAdminUserMfaStatus,
  AuthAdminUserPropertyConfig,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthCompletionResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthPasswordUpdatedResult,
  AuthSessionResult,
  AuthPublicConfig,
  AuthUserPropertyConfig,
  AuthUser,
  RegisterParams,
} from './auth-client';
import { createAuthDisabledError } from './auth-client';
import { shouldUseSsrFallback, useClientMaybe } from './client-context';

export type {
  AuthActionTokenInfo,
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaRequirement,
  AuthAdminMfaResetResult,
  AuthAdminUpdateUserParams,
  AuthAdminUserMfaStatus,
  AuthAdminUserPropertyConfig,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthCompletionResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthPasswordUpdatedResult,
  AuthSessionResult,
  AuthPublicConfig,
  AuthUserPropertyConfig,
  AuthUser,
  RegisterParams,
};

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True only while a persisted browser session is being restored. */
  isRestoring: boolean;
  error: string | null;
}

export interface AuthActions {
  login: (username: string, password: string) => Promise<AuthCompletionResult | null>;
  register: (params: RegisterParams) => Promise<AuthCompletionResult | null>;
  getConfig: () => Promise<AuthPublicConfig | null>;
  forgotPassword: (email: string, nativeContinuation?: string) => Promise<void>;
  resendVerificationEmail: (email: string, nativeContinuation?: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<AuthCompletionResult | null>;
  inspectActionToken: (token: string) => Promise<AuthActionTokenInfo | null>;
  resetPassword: (token: string, newPassword: string) => Promise<AuthCompletionResult | null>;
  setupPassword: (token: string, newPassword: string) => Promise<AuthCompletionResult | null>;
  listMfaMethods: () => Promise<{ methods: AuthMfaMethod[]; required: boolean } | null>;
  startMfaSetup: (params: {
    setupToken?: string;
    method: AuthMfaMethodType;
    label?: string;
  }) => Promise<AuthMfaSetupStartResult | null>;
  verifyMfaSetup: (params: {
    verificationToken: string;
    code: string;
  }) => Promise<AuthMfaSetupVerifyResult | null>;
  verifyMfaChallenge: (params: {
    challengeToken: string;
    code: string;
  }) => Promise<AuthSessionResult | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setProperty: (key: string, value: unknown) => Promise<void>;
  getProperty: (key: string) => Promise<string | null>;
  getProperties: () => Promise<Record<string, string>>;
  deleteProperty: (key: string) => Promise<void>;
}

const NOOP_UNSUB = () => {};
const SSR_AUTH_NOOP = async () => {};
const SSR_AUTH_SNAPSHOT = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoading: false as boolean,
  isRestoring: false as boolean,
  error: null,
};

/** SSR-safe no-op defaults for auth hooks. */
const SSR_AUTH_DEFAULTS: AuthState & AuthActions = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  isRestoring: false,
  error: null,
  login: SSR_AUTH_NOOP as any,
  register: SSR_AUTH_NOOP as any,
  getConfig: async () => null,
  forgotPassword: SSR_AUTH_NOOP as any,
  resendVerificationEmail: SSR_AUTH_NOOP as any,
  verifyEmail: async () => null,
  inspectActionToken: async () => null,
  resetPassword: async () => null,
  setupPassword: async () => null,
  listMfaMethods: async () => null,
  startMfaSetup: async () => null,
  verifyMfaSetup: async () => null,
  verifyMfaChallenge: async () => null,
  logout: SSR_AUTH_NOOP as any,
  refresh: SSR_AUTH_NOOP as any,
  changePassword: SSR_AUTH_NOOP as any,
  setProperty: SSR_AUTH_NOOP as any,
  getProperty: async () => null,
  getProperties: async () => ({}),
  deleteProperty: SSR_AUTH_NOOP as any,
};

/**
 * Subscribe to auth state and expose user-facing auth actions.
 *
 * Returns safe unauthenticated defaults during SSR. In the browser, throws the
 * standard auth-disabled error when an auth-only action runs without auth.
 */
export function useAuth(): AuthState & AuthActions {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authDisabled = client !== null && authClient === null;

  const subscribe = useCallback(
    (cb: () => void) => authClient ? authClient.subscribe(cb) : NOOP_UNSUB,
    [authClient],
  );

  const state = useSyncExternalStore(
    subscribe,
    () => authClient ? authClient.store.getSnapshot().context : SSR_AUTH_SNAPSHOT,
    () => SSR_AUTH_SNAPSHOT,
  );

  const login = useCallback(
    async (username: string, password: string) => {
      if (authClient) return authClient.login(username, password);
      else if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const register = useCallback(
    async (params: RegisterParams) => {
      if (authClient) return authClient.register(params);
      else if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const logout = useCallback(
    async () => {
      if (authClient) await authClient.logout();
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const getConfig = useCallback(
    async () => {
      if (authClient) return authClient.getConfig();
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const forgotPassword = useCallback(
    async (email: string, nativeContinuation?: string) => {
      if (authClient) await authClient.forgotPassword(email, nativeContinuation);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const resendVerificationEmail = useCallback(
    async (email: string, nativeContinuation?: string) => {
      if (authClient) await authClient.resendVerificationEmail(email, nativeContinuation);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const verifyEmail = useCallback(
    async (token: string) => {
      if (authClient) return authClient.verifyEmail(token);
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const inspectActionToken = useCallback(
    async (token: string) => {
      if (authClient) return authClient.inspectActionToken(token);
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const resetPassword = useCallback(
    async (token: string, newPassword: string) => {
      if (authClient) return authClient.resetPassword(token, newPassword);
      else if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const setupPassword = useCallback(
    async (token: string, newPassword: string) => {
      if (authClient) return authClient.setupPassword(token, newPassword);
      else if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const listMfaMethods = useCallback(
    async () => {
      if (authClient) return authClient.listMfaMethods();
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const startMfaSetup = useCallback(
    async (params: {
      setupToken?: string;
      method: AuthMfaMethodType;
      label?: string;
    }) => {
      if (authClient) return authClient.startMfaSetup(params);
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const verifyMfaSetup = useCallback(
    async (params: {
      verificationToken: string;
      code: string;
    }) => {
      if (authClient) return authClient.verifyMfaSetup(params);
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const verifyMfaChallenge = useCallback(
    async (params: {
      challengeToken: string;
      code: string;
    }) => {
      if (authClient) return authClient.verifyMfaChallenge(params);
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const refresh = useCallback(
    async () => {
      if (authClient) await authClient.refresh();
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (authClient) await authClient.changePassword(currentPassword, newPassword);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const setProperty = useCallback(
    async (key: string, value: unknown) => {
      if (authClient) await authClient.setProperty(key, value);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const getProperty = useCallback(
    async (key: string) => {
      if (authClient) return authClient.getProperty(key);
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const getProperties = useCallback(
    async () => {
      if (authClient) return authClient.getProperties();
      if (authDisabled) throw createAuthDisabledError();
      return {};
    },
    [authClient, authDisabled],
  );

  const deleteProperty = useCallback(
    async (key: string) => {
      if (authClient) await authClient.deleteProperty(key);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  if (!authClient && !authDisabled && shouldUseSsrFallback(client, 'useAuth')) {
    return SSR_AUTH_DEFAULTS;
  }

  return {
    user: state.user,
    isAuthenticated: state.user !== null,
    isLoading: state.isLoading,
    isRestoring: state.isRestoring,
    error: state.error,
    login,
    register,
    getConfig,
    forgotPassword,
    resendVerificationEmail,
    verifyEmail,
    inspectActionToken,
    resetPassword,
    setupPassword,
    listMfaMethods,
    startMfaSetup,
    verifyMfaSetup,
    verifyMfaChallenge,
    logout,
    refresh,
    changePassword,
    setProperty,
    getProperty,
    getProperties,
    deleteProperty,
  };
}

export interface AuthConfigState {
  config: AuthPublicConfig | null;
  isLoading: boolean;
  error: string | null;
  canRegister: boolean;
  bootstrapRequired: boolean;
  reload: () => Promise<void>;
}

/**
 * Load public auth configuration for auth UI.
 *
 * Mirrors backend registration and user-property policy so login/register
 * surfaces adapt without hard-coding app policy in components.
 */
export function useAuthConfig(): AuthConfigState {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authDisabled = client !== null && authClient === null;
  const [config, setConfig] = useState<AuthPublicConfig | null>(null);
  const [isLoading, setIsLoading] = useState(() => authClient !== null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!authClient) {
      setConfig(null);
      setIsLoading(false);
      setError(authDisabled ? createAuthDisabledError().message : null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      setConfig(await authClient.getConfig());
    } catch (err) {
      setConfig(null);
      setError(err instanceof Error ? err.message : 'Failed to load auth config');
    } finally {
      setIsLoading(false);
    }
  }, [authClient, authDisabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (shouldUseSsrFallback(client, 'useAuthConfig')) {
    return {
      config: null,
      isLoading: false,
      error: null,
      canRegister: false,
      bootstrapRequired: false,
      reload,
    };
  }

  return {
    config,
    isLoading,
    error,
    canRegister: config?.registration.publicRegistrationEnabled ?? false,
    bootstrapRequired: config?.registration.bootstrapRequired ?? false,
    reload,
  };
}

/**
 * Return the current authenticated user, or null when logged out/loading.
 */
export function useCurrentUser(): AuthUser | null {
  const { user } = useAuth();
  return user;
}

/**
 * Require an authenticated user and redirect unauthenticated browsers.
 *
 * This is a UI navigation helper only. Server plugins and policies remain the
 * source of truth for protecting data and routes.
 */
export function useRequireAuth(redirectTo = '/login'): AuthUser | null {
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && typeof window !== 'undefined') {
      window.history.pushState(null, '', redirectTo);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [isLoading, isAuthenticated, redirectTo]);

  return user;
}

export interface UseUserPropertyOptions<T> {
  /** Value used when the property is not currently set. */
  defaultValue?: T;
  /** Convert the stored string to the UI value. Defaults to string passthrough. */
  parse?: (value: string | null) => T;
  /** Convert the UI value before sending it to AuthClient. */
  serialize?: (value: T) => unknown;
}

export interface UseUserPropertyResult<T> {
  value: T | null;
  rawValue: string | null;
  isLoading: boolean;
  error: string | null;
  setValue: (value: T) => Promise<void>;
  refresh: () => Promise<void>;
  remove: () => Promise<void>;
}

function parseUserProperty<T>(
  rawValue: string | null,
  defaultValue: T | undefined,
  parse: ((value: string | null) => T) | undefined,
): T | null {
  if (rawValue === null) return defaultValue ?? null;
  if (parse) return parse(rawValue);
  return rawValue as T;
}

/**
 * Read and update one current-user property.
 *
 * This is intended for user-editable app preferences and UI gates backed by
 * the auth property config. It is not an authorization boundary.
 */
export function useUserProperty<T = string>(
  key: string,
  options: UseUserPropertyOptions<T> = {},
): UseUserPropertyResult<T> {
  const auth = useAuth();
  const { defaultValue, parse, serialize } = options;
  const rawValue = auth.user?.properties[key] ?? null;
  const value = useMemo(
    () => parseUserProperty(rawValue, defaultValue, parse),
    [rawValue, defaultValue, parse],
  );

  const setValue = useCallback(
    async (nextValue: T) => {
      await auth.setProperty(key, serialize ? serialize(nextValue) : nextValue);
    },
    [auth.setProperty, key, serialize],
  );

  const refresh = useCallback(
    async () => {
      await auth.getProperty(key);
    },
    [auth.getProperty, key],
  );

  const remove = useCallback(
    async () => {
      await auth.deleteProperty(key);
    },
    [auth.deleteProperty, key],
  );

  return {
    value,
    rawValue,
    isLoading: auth.isLoading,
    error: auth.error,
    setValue,
    refresh,
    remove,
  };
}
