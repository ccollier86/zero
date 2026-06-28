import { createStore } from '@xstate/store';

// ─── Auth Store ────────────────────────────────────────────────────────────

export interface AuthUser {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
  properties: Record<string, string>;
  createdAt: number;
  updatedAt: number | null;
}

interface AuthStoreContext {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;
}

function createAuthStore() {
  const initial: AuthStoreContext = {
    user: null,
    accessToken: null,
    refreshToken: null,
    isLoading: false as boolean,
    error: null,
  };

  return createStore({
    context: initial,
    on: {
      'auth.loading': (ctx: AuthStoreContext): AuthStoreContext => ({
        ...ctx,
        isLoading: true,
        error: null,
      }),
      'auth.success': (
        ctx: AuthStoreContext,
        event: { user: AuthUser; accessToken: string; refreshToken: string }
      ): AuthStoreContext => ({
        ...ctx,
        user: event.user,
        accessToken: event.accessToken,
        refreshToken: event.refreshToken,
        isLoading: false,
        error: null,
      }),
      'auth.error': (
        ctx: AuthStoreContext,
        event: { error: string }
      ): AuthStoreContext => ({
        ...ctx,
        isLoading: false,
        error: event.error,
      }),
      'auth.logout': (ctx: AuthStoreContext): AuthStoreContext => ({
        ...ctx,
        user: null,
        accessToken: null,
        refreshToken: null,
        isLoading: false,
        error: null,
      }),
      'auth.refresh': (
        ctx: AuthStoreContext,
        event: { accessToken: string; refreshToken: string }
      ): AuthStoreContext => ({
        ...ctx,
        accessToken: event.accessToken,
        refreshToken: event.refreshToken,
      }),
      'auth.properties.patch': (
        ctx: AuthStoreContext,
        event: { properties: Record<string, string> }
      ): AuthStoreContext => ctx.user
        ? {
            ...ctx,
            user: {
              ...ctx.user,
              properties: {
                ...ctx.user.properties,
                ...event.properties,
              },
            },
          }
        : ctx,
      'auth.properties.replace': (
        ctx: AuthStoreContext,
        event: { properties: Record<string, string> }
      ): AuthStoreContext => ctx.user
        ? {
            ...ctx,
            user: {
              ...ctx.user,
              properties: event.properties,
            },
          }
        : ctx,
      'auth.properties.delete': (
        ctx: AuthStoreContext,
        event: { key: string }
      ): AuthStoreContext => {
        if (!ctx.user) return ctx;
        const properties = { ...ctx.user.properties };
        delete properties[event.key];
        return {
          ...ctx,
          user: {
            ...ctx.user,
            properties,
          },
        };
      },
      'auth.clearError': (ctx: AuthStoreContext): AuthStoreContext => ({
        ...ctx,
        error: null,
      }),
    },
  });
}

export type AuthStore = ReturnType<typeof createAuthStore>;

// ─── Auth Client ───────────────────────────────────────────────────────────

const REFRESH_TOKEN_KEY = '__platform_refresh_token';

export interface RegisterParams {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthPublicConfig {
  registration: {
    mode: 'public' | 'admin-only' | 'disabled';
    bootstrapRequired: boolean;
    publicRegistrationEnabled: boolean;
    userCount?: number;
  };
  accountEmails?: {
    adminCreatedUser: boolean;
    passwordReset: boolean;
    passwordChangedNotice: boolean;
  };
}

export interface AuthActionTokenInfo {
  valid: boolean;
  type: 'account_setup' | 'password_reset' | 'admin_password_reset' | 'email_verification';
  expiresAt: number;
  user: {
    userId: string;
    username: string;
    email: string;
  };
}

export const AUTH_DISABLED_MESSAGE =
  '[client] Auth is disabled for this SDK client. Enable auth in createApp({ auth: true }) and <AppProvider auth>, or remove auth-only UI/actions.';

export function createAuthDisabledError(): Error {
  return new Error(AUTH_DISABLED_MESSAGE);
}

function getAuthResponseError(res: Response, body: unknown, fallback: string): string {
  if (res.status === 404) {
    return '[client] Auth route not found. Enable auth in createApp({ auth: true }) or disable frontend auth.';
  }

  if (body && typeof body === 'object' && 'error' in body) {
    return String((body as { error?: unknown }).error ?? fallback);
  }

  return fallback;
}

/**
 * AuthClient — manages authentication state, token lifecycle,
 * and auto-refresh. Powered by @xstate/store.
 *
 * - Access token stored in memory (JS closure — not in localStorage)
 * - Refresh token stored in localStorage for session persistence
 * - Auto-refresh on 401 responses via fetchWithAuth()
 * - Token rotation on every refresh (old refresh token invalidated)
 */
export class AuthClient {
  readonly store: AuthStore;
  private baseUrl: string;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.store = createAuthStore();

    // Restore session from stored refresh token
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (stored) {
        // Set loading so components show a loading state (not "logged out")
        // while we refresh the token and fetch user data
        this.send('auth.loading', {});
        this.send('auth.refresh', { accessToken: '', refreshToken: stored });
        this.restoreSession().catch(() => {
          localStorage.removeItem(REFRESH_TOKEN_KEY);
          this.send('auth.logout', {});
        });
      }
    }
  }

  // ─── Getters ──────────────────────────────────────────────────────

  get user(): AuthUser | null {
    return this.ctx.user;
  }

  get isAuthenticated(): boolean {
    return this.ctx.user !== null;
  }

  get isLoading(): boolean {
    return this.ctx.isLoading;
  }

  get error(): string | null {
    return this.ctx.error;
  }

  get accessToken(): string | null {
    return this.ctx.accessToken;
  }

  // ─── Actions ──────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<AuthUser> {
    this.send('auth.loading', {});

    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = getAuthResponseError(res, body, 'Login failed');
      this.send('auth.error', { error: msg });
      throw new Error(msg);
    }

    const data = await res.json();
    this.send('auth.success', {
      user: data.user,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });

    this.persistRefreshToken(data.refreshToken);
    return data.user;
  }

  async register(params: RegisterParams): Promise<AuthUser> {
    this.send('auth.loading', {});

    const res = await fetch(`${this.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = getAuthResponseError(res, body, 'Registration failed');
      this.send('auth.error', { error: msg });
      throw new Error(msg);
    }

    const data = await res.json();
    this.send('auth.success', {
      user: data.user,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });

    this.persistRefreshToken(data.refreshToken);
    return data.user;
  }

  async getConfig(): Promise<AuthPublicConfig> {
    const res = await fetch(`${this.baseUrl}/auth/config`);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(getAuthResponseError(res, body, 'Failed to load auth config'));
    }

    return res.json();
  }

  /**
   * Request a password reset email.
   *
   * The backend always returns a generic success response so callers do not
   * learn whether an email address exists.
   */
  async forgotPassword(email: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(getAuthResponseError(res, body, 'Failed to request password reset'));
    }
  }

  /** Inspect a reset/setup token without consuming it. */
  async inspectActionToken(token: string): Promise<AuthActionTokenInfo> {
    const res = await fetch(`${this.baseUrl}/auth/action-token/${encodeURIComponent(token)}`);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(getAuthResponseError(res, body, 'Invalid or expired action token'));
    }

    return res.json();
  }

  /** Complete a password reset from an emailed reset token. */
  async resetPassword(token: string, newPassword: string): Promise<AuthUser> {
    return this.completePasswordAction('/auth/reset-password', token, newPassword);
  }

  /** Complete first-password setup from an emailed setup token. */
  async setupPassword(token: string, newPassword: string): Promise<AuthUser> {
    return this.completePasswordAction('/auth/setup-password', token, newPassword);
  }

  async logout(): Promise<void> {
    const { refreshToken } = this.ctx;
    if (refreshToken) {
      fetch(`${this.baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }

    this.send('auth.logout', {});
    this.clearRefreshToken();
  }

  /**
   * Refresh the access token. Deduplicates concurrent calls.
   */
  async refresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this._doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Fetch with auto-refresh — if 401, refresh token and retry once.
   */
  async fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    const doFetch = (token: string | null) =>
      fetch(url, {
        ...init,
        headers: {
          ...init?.headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

    let res = await doFetch(this.accessToken);

    if (res.status === 401 && this.ctx.refreshToken) {
      const refreshed = await this.refresh();
      if (refreshed) {
        res = await doFetch(this.accessToken);
      }
    }

    return res;
  }

  /**
   * Change password. Issues fresh tokens on success.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await this.fetchWithAuth(`${this.baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(getAuthResponseError(res, body, 'Failed to change password'));
    }

    const data = await res.json();
    this.send('auth.refresh', {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    this.persistRefreshToken(data.refreshToken);
  }

  private async completePasswordAction(
    path: '/auth/reset-password' | '/auth/setup-password',
    token: string,
    newPassword: string
  ): Promise<AuthUser> {
    this.send('auth.loading', {});

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = getAuthResponseError(res, body, 'Failed to update password');
      this.send('auth.error', { error: msg });
      throw new Error(msg);
    }

    const data = await res.json();
    this.send('auth.success', {
      user: data.user,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });

    this.persistRefreshToken(data.refreshToken);
    return data.user;
  }

  // ─── Property KV ─────────────────────────────────────────────────

  async setProperty(key: string, value: unknown): Promise<void> {
    const res = await this.fetchWithAuth(
      `${this.baseUrl}/auth/me/properties/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Failed to set property' }));
      throw new Error(body.error ?? 'Failed to set property');
    }
    this.send('auth.properties.patch', {
      properties: { [key]: serializeAuthPropertyValue(value) },
    });
  }

  async getProperty(key: string): Promise<string | null> {
    const res = await this.fetchWithAuth(
      `${this.baseUrl}/auth/me/properties/${encodeURIComponent(key)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Failed to get property' }));
      throw new Error(body.error ?? 'Failed to get property');
    }
    const data = await res.json();
    this.send('auth.properties.patch', {
      properties: { [key]: data.value },
    });
    return data.value;
  }

  async getProperties(): Promise<Record<string, string>> {
    const res = await this.fetchWithAuth(`${this.baseUrl}/auth/me/properties`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Failed to get properties' }));
      throw new Error(body.error ?? 'Failed to get properties');
    }
    const data = await res.json();
    this.send('auth.properties.replace', { properties: data.properties });
    return data.properties;
  }

  async deleteProperty(key: string): Promise<void> {
    const res = await this.fetchWithAuth(
      `${this.baseUrl}/auth/me/properties/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Failed to delete property' }));
      throw new Error(body.error ?? 'Failed to delete property');
    }
    this.send('auth.properties.delete', { key });
  }

  /** Subscribe to auth state changes. Returns unsubscribe. */
  subscribe(callback: () => void): () => void {
    const sub = this.store.subscribe(callback);
    return () => sub.unsubscribe();
  }

  /**
   * Restore a full session: refresh tokens, then fetch user profile.
   * Called on page load when a stored refresh token exists.
   * Sets auth.success (with user) on success, auth.logout on failure.
   */
  private async restoreSession(): Promise<void> {
    const refreshed = await this.refresh();
    if (!refreshed) {
      this.send('auth.logout', {});
      this.clearRefreshToken();
      return;
    }

    // Tokens refreshed — now fetch user profile
    try {
      const res = await this.fetchWithAuth(`${this.baseUrl}/auth/me`);
      if (!res.ok) {
        this.send('auth.logout', {});
        this.clearRefreshToken();
        return;
      }

      const user = await res.json();
      this.send('auth.success', {
        user,
        accessToken: this.ctx.accessToken!,
        refreshToken: this.ctx.refreshToken!,
      });
    } catch {
      this.send('auth.logout', {});
      this.clearRefreshToken();
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private get ctx(): AuthStoreContext {
    return this.store.getSnapshot().context as AuthStoreContext;
  }

  /** Type-safe send wrapper. */
  private send(type: string, payload: Record<string, unknown>): void {
    (this.store as any).send({ type, ...payload });
  }

  private async _doRefresh(): Promise<boolean> {
    const { refreshToken } = this.ctx;
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        this.send('auth.logout', {});
        this.clearRefreshToken();
        return false;
      }

      const data = await res.json();
      this.send('auth.refresh', {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      this.persistRefreshToken(data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  private persistRefreshToken(token: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REFRESH_TOKEN_KEY, token);
    }
  }

  private clearRefreshToken(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  }
}

function serializeAuthPropertyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? String(value);
}
