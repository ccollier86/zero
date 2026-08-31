/**
 * Browser auth session coordinator.
 *
 * Owns the XState store, refresh-token persistence, automatic refresh, and
 * authenticated fetch behavior. Route-specific account and MFA calls live in
 * focused transports and report their results back through this coordinator.
 */

import { createAuthStore, sendAuthStoreEvent } from './auth-store';
import type { AuthStore, AuthStoreContext } from './auth-store';
import { isAuthSessionResult } from './auth-types';
import type { AuthCompletionResult, AuthUser } from './auth-types';

const REFRESH_TOKEN_KEY = '__platform_refresh_token';

export class AuthSessionController {
  readonly store: AuthStore;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(private readonly baseUrl: string) {
    this.store = createAuthStore();
    this.restoreStoredSession();
  }

  get user(): AuthUser | null {
    return this.context.user;
  }

  get isAuthenticated(): boolean {
    return this.context.user !== null;
  }

  get isLoading(): boolean {
    return this.context.isLoading;
  }

  get error(): string | null {
    return this.context.error;
  }

  get accessToken(): string | null {
    return this.context.accessToken;
  }

  beginAuthentication(): void {
    this.send('auth.loading');
  }

  failAuthentication(error: string): void {
    this.send('auth.error', { error });
  }

  completeAuthentication(data: AuthCompletionResult): AuthCompletionResult {
    if (isAuthSessionResult(data)) {
      this.send('auth.success', {
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      this.persistRefreshToken(data.refreshToken);
      return data;
    }

    this.send('auth.logout');
    this.clearRefreshToken();
    return data;
  }

  updateTokens(accessToken: string, refreshToken: string): void {
    this.send('auth.refresh', { accessToken, refreshToken });
    this.persistRefreshToken(refreshToken);
  }

  patchProperties(properties: Record<string, string>): void {
    this.send('auth.properties.patch', { properties });
  }

  replaceProperties(properties: Record<string, string>): void {
    this.send('auth.properties.replace', { properties });
  }

  deleteProperty(key: string): void {
    this.send('auth.properties.delete', { key });
  }

  async logout(): Promise<void> {
    const { refreshToken } = this.context;
    // The HttpOnly page cookie must be cleared server-side even when local
    // token state is already absent. Local logout still succeeds offline.
    await fetch(`${this.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    }).catch(() => undefined);

    this.expireSession();
  }

  /** Clear local state after a rejected or no-longer-trusted session. */
  expireSession(): void {
    this.send('auth.logout');
    this.clearRefreshToken();
  }

  /** Refresh the access token, deduplicating concurrent refresh calls. */
  async refresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /** Fetch with the bearer token, refreshing and retrying once on 401. */
  async fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    // A request can arrive while constructor-driven session restoration is
    // already rotating the stored refresh token. Wait for that shared refresh
    // instead of knowingly sending one unauthenticated request first.
    if (!this.accessToken && this.context.refreshToken && this.refreshPromise) {
      await this.refreshPromise;
    }

    const doFetch = (token: string | null) => {
      const headers = new Headers(init?.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);

      return fetch(url, {
        ...init,
        headers,
      });
    };

    let response = await doFetch(this.accessToken);
    if (response.status === 401 && this.context.refreshToken) {
      const refreshed = await this.refresh();
      if (refreshed) response = await doFetch(this.accessToken);
      else this.expireSession();
    } else if (response.status === 401 && this.context.user) {
      this.expireSession();
    }

    return response;
  }

  /** Attach the current bearer token when present, without requiring one. */
  async fetchWithOptionalAuth(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (this.accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    return fetch(url, { ...init, headers });
  }

  subscribe(callback: () => void): () => void {
    const subscription = this.store.subscribe(callback);
    return () => subscription.unsubscribe();
  }

  private get context(): AuthStoreContext {
    return this.store.getSnapshot().context as AuthStoreContext;
  }

  private send(type: string, payload: Record<string, unknown> = {}): void {
    sendAuthStoreEvent(this.store, type, payload);
  }

  private restoreStoredSession(): void {
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!stored) return;

    this.send('auth.loading');
    this.send('auth.refresh', { accessToken: '', refreshToken: stored });
    this.restoreSession().catch(() => this.expireSession());
  }

  private async restoreSession(): Promise<void> {
    const refreshed = await this.refresh();
    if (!refreshed) {
      this.expireSession();
      return;
    }

    try {
      const response = await this.fetchWithAuth(`${this.baseUrl}/auth/me`);
      if (!response.ok) {
        this.expireSession();
        return;
      }

      const user = await response.json();
      this.send('auth.success', {
        user,
        accessToken: this.context.accessToken!,
        refreshToken: this.context.refreshToken!,
      });
    } catch {
      this.expireSession();
    }
  }

  private async performRefresh(): Promise<boolean> {
    const { refreshToken } = this.context;
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        this.expireSession();
        return false;
      }

      const data = await response.json();
      this.updateTokens(data.accessToken, data.refreshToken);
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
