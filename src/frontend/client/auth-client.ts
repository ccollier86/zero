import { createStore } from '@xstate/store';

// ─── Auth Store ────────────────────────────────────────────────────────────

export interface AuthUser {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
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

  // ─── Property KV ─────────────────────────────────────────────────

  async setProperty(key: string, value: string): Promise<void> {
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
    return data.value;
  }

  async getProperties(): Promise<Record<string, string>> {
    const res = await this.fetchWithAuth(`${this.baseUrl}/auth/me/properties`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Failed to get properties' }));
      throw new Error(body.error ?? 'Failed to get properties');
    }
    const data = await res.json();
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
