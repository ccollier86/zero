/**
 * Browser auth session coordinator.
 *
 * Owns the XState store, URL-scoped refresh-token persistence, cross-tab
 * rotation, automatic refresh, and authenticated fetch behavior. Route
 * transports report their results through this controller.
 */

import {
  BrowserAuthCoordinator,
  type BrowserAuthCoordinationEnvironment,
  type BrowserAuthCredentialRecord,
  type BrowserAuthSignal,
  type BrowserAuthSignalKind,
} from './auth-browser-coordination';
import { resolveAuthRequestUrl } from './auth-errors';
import {
  parseAuthRefreshResponse,
  parseAuthUser,
} from './auth-completion-parser';
import { createAuthStore, sendAuthStoreEvent } from './auth-store';
import type { AuthStore, AuthStoreContext } from './auth-store';
import { isAuthSessionResult } from './auth-types';
import type {
  AuthCompletionResult,
  AuthSessionResult,
  AuthSessionTransitionOperation,
  AuthSessionTransitionState,
  AuthTenantSummary,
  AuthUser,
} from './auth-types';

export interface AuthSessionScopeLifecycle {
  beginTransition(): void;
  completeTransition(): Promise<void> | void;
  abortTransition(): Promise<void> | void;
  reconcileTransition?: () => Promise<void> | void;
}

export class AuthSessionSynchronizationError extends Error {
  readonly code = 'AUTH_SCOPE_SYNCHRONIZATION_REQUIRED';
  readonly recoverable = true;
  readonly committed = true;

  constructor(
    readonly operation: AuthSessionTransitionOperation,
    readonly revision: number,
    cause: unknown,
  ) {
    super(
      'The new authentication session was committed, but local synchronization '
      + 'did not finish. The new session remains active and can be reconciled safely.',
      { cause },
    );
    this.name = 'AuthSessionSynchronizationError';
  }
}

export interface AuthSessionControllerOptions {
  scopeLifecycle?: AuthSessionScopeLifecycle;
  coordination?: BrowserAuthCoordinationEnvironment;
}

export class AuthSessionController {
  readonly store: AuthStore;

  private readonly coordinator: BrowserAuthCoordinator;
  private readonly scopeLifecycle?: AuthSessionScopeLifecycle;
  private readonly unsubscribeSignals: () => void;
  private refreshPromise: Promise<boolean> | null = null;
  private restorePromise: Promise<void> | null = null;
  private externalReconciliation: Promise<void> = Promise.resolve();
  private credentialRevision = 0;
  private scopeId: string | null = null;
  private transitionOperation: AuthSessionTransitionOperation | null = null;
  private disposed = false;

  constructor(
    private readonly baseUrl: string,
    options: AuthSessionControllerOptions = {},
  ) {
    this.store = createAuthStore();
    this.scopeLifecycle = options.scopeLifecycle;
    this.coordinator = new BrowserAuthCoordinator(baseUrl, options.coordination);
    this.unsubscribeSignals = this.coordinator.subscribe((signal) => {
      this.queueExternalSignal(signal);
    });
    this.restoreStoredSession();
  }

  get user(): AuthUser | null {
    return this.context.user;
  }

  get activeTenant(): AuthTenantSummary | null {
    return this.context.activeTenant;
  }

  get isAuthenticated(): boolean {
    return this.context.user !== null;
  }

  get isLoading(): boolean {
    return this.context.isLoading;
  }

  get isRestoring(): boolean {
    return this.context.isRestoring;
  }

  get error(): string | null {
    return this.context.error;
  }

  get sessionTransition(): AuthSessionTransitionState {
    return this.context.sessionTransition;
  }

  get accessToken(): string | null {
    return this.context.accessToken;
  }

  /** Internal proof used only by refresh-family lifecycle transports. */
  get refreshToken(): string | null {
    return this.context.refreshToken;
  }

  get revision(): number {
    return this.credentialRevision;
  }

  /** Opaque browser-local authorization family identifier for cache fencing. */
  get authorizationScopeKey(): string | null {
    return this.scopeId;
  }

  /** Capture the current browser authorization family without exposing proof. */
  captureAuthorizationScope(): string | null {
    return this.scopeId;
  }

  /**
   * Reject work whose originating authorization family was replaced locally
   * or in another tab. Reading durable coordination state closes the window
   * before an external signal has reached this tab's event loop.
   */
  assertAuthorizationScopeCurrent(expectedScopeId: string | null): void {
    const storedScopeId = this.coordinator.readCredential()?.scopeId ?? null;
    if (this.scopeId !== expectedScopeId || storedScopeId !== expectedScopeId) {
      throw new Error('[client] Discarded a response from a previous authorization scope.');
    }
  }

  beginAuthentication(): void {
    this.send('auth.loading');
  }

  failAuthentication(error: string): void {
    this.send('auth.error', { error });
  }

  /** Commit an ordinary login/registration/MFA completion under the tab lock. */
  async completeAuthentication(
    data: AuthCompletionResult,
    assertRequestCurrent: () => void = () => {},
  ): Promise<AuthCompletionResult> {
    return this.runCredentialOperation(async () => {
      // Reconciliation while waiting for the cross-tab lock may have adopted
      // a newer session. Refuse to let this older network result replace it.
      assertRequestCurrent();
      this.beginScopeTransition('authentication');
      let committed = false;
      try {
        if (isAuthSessionResult(data)) {
          this.installSession(data, 'session', true);
        } else {
          this.commitLogout();
        }
        this.markScopeTransitionCommitted();
        committed = true;
        await this.completeScopeTransition();
        return data;
      } catch (error) {
        if (!committed) await this.abortScopeTransition();
        throw error;
      }
    });
  }

  /**
   * Install a result while a tenant transport already owns the credential
   * lock. Tenant selection/creation/switch always establishes a new scope id.
   */
  commitScopeAuthentication(data: AuthSessionResult): AuthSessionResult {
    this.installSession(data, 'scope', true);
    this.markScopeTransitionCommitted();
    return data;
  }

  async updateTokens(
    accessToken: string,
    refreshToken: string,
    activeTenant?: AuthTenantSummary,
    assertRequestCurrent: () => void = () => {},
  ): Promise<void> {
    await this.runCredentialOperation(async () => {
      assertRequestCurrent();
      const scopeId = this.scopeId ?? this.coordinator.createScopeId();
      const record = this.coordinator.commitSession(refreshToken, scopeId, 'refresh');
      this.adoptRecord(record);
      this.send('auth.refresh', { accessToken, refreshToken, activeTenant });
    });
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

  /** Serialize a refresh-family operation and re-read its committed proof. */
  runCredentialOperation<T>(
    operation: () => Promise<T>,
    adoptStoredCredential = true,
  ): Promise<T> {
    return this.coordinator.runExclusive(async () => {
      if (adoptStoredCredential) await this.reconcileStoredCredentialBeforeOperation();
      return operation();
    });
  }

  async logout(assertStartingScopeCurrent: () => void = () => {}): Promise<void> {
    await this.runCredentialOperation(async () => {
      // A retained logout intent must not survive adoption of another tab's
      // replacement account while it waited for the credential lock.
      assertStartingScopeCurrent();
      const refreshToken = this.context.refreshToken;
      // The HttpOnly page cookie must be cleared server-side even when local
      // token state is absent. Local logout still succeeds offline.
      await fetch(`${this.baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      }).catch(() => undefined);

      this.beginScopeTransition('logout');
      this.commitLogout();
      this.markScopeTransitionCommitted();
      await this.completeScopeTransition();
    });
  }

  /** Clear local state after a rejected or no-longer-trusted session. */
  expireSession(): void {
    const expectedRevision = this.credentialRevision;
    this.send('auth.logout');
    void this.coordinator.runExclusive(async () => {
      const current = this.coordinator.readCredential();
      if ((current?.revision ?? 0) !== expectedRevision) {
        // A newer signal will reconcile the replacement session. Do not mark
        // its revision observed here before that purge/restore barrier runs.
        return;
      }
      this.commitLogout();
    }).catch(() => undefined);
  }

  /** Expire only if the credential observed by a request is still current. */
  expireSessionAtRevision(expectedRevision: number): Promise<void> {
    return this.expireIfRevision(expectedRevision);
  }

  /** Refresh the access token, deduplicating concurrent calls in this tab. */
  async refresh(
    assertRequestCurrent: () => void = () => {},
    consumeStartingScope: () => void = () => {},
  ): Promise<boolean> {
    assertRequestCurrent();
    if (this.refreshPromise) {
      const result = await this.refreshPromise;
      assertRequestCurrent();
      return result;
    }
    let startingScopeConsumed = false;
    const consumeCurrentStartingScope = () => {
      assertRequestCurrent();
      consumeStartingScope();
      startingScopeConsumed = true;
    };
    this.refreshPromise = this.runCredentialOperation(() => {
      assertRequestCurrent();
      return this.performRefreshLocked(0, consumeCurrentStartingScope);
    });
    try {
      const result = await this.refreshPromise;
      if (!startingScopeConsumed) assertRequestCurrent();
      return result;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Run one authenticated transport, refreshing and retrying once on 401.
   *
   * This is intentionally transport-agnostic so browser integrations that
   * need XMLHttpRequest (for upload progress) retain the exact same session
   * restoration, refresh-family, and stale-credential behavior as fetch().
   */
  async requestWithAuth<T extends { status: number }>(
    request: (accessToken: string | null) => Promise<T>,
    consumeStartingScope: () => void = () => {},
  ): Promise<T> {
    // Constructor restoration may already be rotating the stored proof. Wait
    // rather than knowingly issuing one unauthenticated request first.
    await this.waitForActiveRestore();

    const requestRevision = this.credentialRevision;
    const requestToken = this.accessToken;
    let response = await request(requestToken);
    if (response.status !== 401) return response;

    // A late 401 from an older scope must never clear or rotate the newer one.
    if (requestRevision !== this.credentialRevision || requestToken !== this.accessToken) {
      return this.accessToken ? request(this.accessToken) : response;
    }

    if (this.context.refreshToken) {
      const refreshed = await this.refresh(() => {}, consumeStartingScope);
      if (refreshed && this.accessToken) return request(this.accessToken);
      return response;
    }

    if (this.context.user) {
      await this.expireIfRevision(requestRevision, consumeStartingScope);
    }
    return response;
  }

  /** Fetch with the bearer token, refreshing and retrying once on 401. */
  async fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    const requestUrl = resolveAuthRequestUrl(this.baseUrl, url);
    return this.requestWithAuth((token) => {
      const headers = new Headers(init?.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return fetch(requestUrl, { ...init, headers });
    });
  }

  /**
   * Wait only for constructor-started credential restoration when it is the
   * reason a stored session has no access token yet. Optional transports use
   * this barrier without turning an anonymous browser into an auth-required
   * request or starting a new refresh of their own.
   */
  async waitForActiveRestore(): Promise<void> {
    const restore = this.restorePromise;
    if (!this.accessToken && this.context.refreshToken && restore) await restore;
  }

  /** Attach the current bearer token when present, without requiring one. */
  async fetchWithOptionalAuth(url: string, init?: RequestInit): Promise<Response> {
    const requestUrl = resolveAuthRequestUrl(this.baseUrl, url);
    await this.waitForActiveRestore();
    const headers = new Headers(init?.headers);
    if (this.accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    return fetch(requestUrl, { ...init, headers });
  }

  beginScopeTransition(operation: AuthSessionTransitionOperation): void {
    this.transitionOperation = operation;
    this.setTransition('preparing', operation, false, null);
    try {
      this.scopeLifecycle?.beginTransition();
    } catch (error) {
      this.transitionOperation = null;
      this.setTransition('idle', null, false, null);
      throw error;
    }
  }

  markScopeTransitionCommitted(): void {
    const operation = this.requireTransitionOperation();
    this.setTransition('committed', operation, false, null);
  }

  async completeScopeTransition(): Promise<void> {
    const operation = this.requireTransitionOperation();
    this.setTransition('reconciling', operation, false, null);
    try {
      await this.scopeLifecycle?.completeTransition();
      this.transitionOperation = null;
      this.setTransition('idle', null, false, null);
    } catch (cause) {
      const error = new AuthSessionSynchronizationError(
        operation,
        this.credentialRevision,
        cause,
      );
      this.setTransition('recovery-required', operation, true, error.message);
      throw error;
    }
  }

  async abortScopeTransition(): Promise<void> {
    // Abort is valid only before credential commit. A committed transition is
    // never rolled back to its now-revoked refresh family.
    if (this.context.sessionTransition.phase !== 'preparing') return;
    await this.scopeLifecycle?.abortTransition();
    this.transitionOperation = null;
    this.setTransition('idle', null, false, null);
  }

  /** Retry only the local baseline barrier; credentials are already committed. */
  async reconcileSession(): Promise<void> {
    const transition = this.context.sessionTransition;
    if (transition.phase !== 'recovery-required' || !transition.operation) return;
    this.setTransition('reconciling', transition.operation, false, null);
    try {
      await this.scopeLifecycle?.reconcileTransition?.();
      this.transitionOperation = null;
      this.setTransition('idle', null, false, null);
    } catch (cause) {
      const error = new AuthSessionSynchronizationError(
        transition.operation,
        this.credentialRevision,
        cause,
      );
      this.setTransition(
        'recovery-required',
        transition.operation,
        true,
        error.message,
      );
      throw error;
    }
  }

  subscribe(callback: () => void): () => void {
    const subscription = this.store.subscribe(callback);
    return () => subscription.unsubscribe();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeSignals();
    this.coordinator.dispose();
  }

  private get context(): AuthStoreContext {
    return this.store.getSnapshot().context as AuthStoreContext;
  }

  private send(type: string, payload: Record<string, unknown> = {}): void {
    sendAuthStoreEvent(this.store, type, payload);
  }

  private restoreStoredSession(): void {
    const stored = this.coordinator.readCredential();
    if (!stored) return;
    this.adoptRecord(stored);
    if (!stored.refreshToken) return;

    this.send('auth.restoring');
    this.send('auth.refresh', { accessToken: '', refreshToken: stored.refreshToken });
    // Deferring one microtask lets createClient finish wiring Sync/state/
    // ephemeral lifecycle callbacks before restoration can publish state.
    this.restorePromise = Promise.resolve()
      .then(() => this.restoreSession())
      .finally(() => {
        this.restorePromise = null;
      });
    void this.restorePromise.catch(() => undefined);
  }

  private async restoreSession(): Promise<void> {
    const refreshed = await this.refresh();
    if (!refreshed || !this.accessToken) {
      // Rejected proof commits logout inside performRefreshLocked. A transient
      // network failure retains the rotating proof for a later retry, but the
      // startup restoration state must still finish.
      if (this.context.refreshToken) {
        this.send('auth.error', { error: 'Unable to restore the browser session' });
      }
      return;
    }

    const revision = this.credentialRevision;
    try {
      const response = await fetch(`${this.baseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (revision !== this.credentialRevision) return;
      if (!response.ok) {
        await this.expireIfRevision(revision);
        return;
      }

      const user = parseAuthUser(await response.json());
      if (revision !== this.credentialRevision) return;
      this.send('auth.success', {
        user,
        activeTenant: this.context.activeTenant ?? undefined,
        accessToken: this.context.accessToken!,
        refreshToken: this.context.refreshToken!,
      });
    } catch {
      // A transient /auth/me failure does not revoke the committed rotating
      // credential. Leave it available for the next explicit restoration.
      this.send('auth.error', { error: 'Unable to restore the browser session' });
    }
  }

  private async performRefreshLocked(
    attempt = 0,
    consumeStartingScope: () => void = () => {},
  ): Promise<boolean> {
    this.adoptStoredCredential();
    const refreshToken = this.context.refreshToken;
    const attemptRevision = this.credentialRevision;
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      const latest = this.coordinator.readCredential();
      if ((latest?.revision ?? 0) !== attemptRevision
        || latest?.refreshToken !== refreshToken) {
        this.adoptStoredCredential();
        return attempt < 1 && this.context.refreshToken
          ? this.performRefreshLocked(attempt + 1, consumeStartingScope)
          : Boolean(this.accessToken);
      }

      if (!response.ok) {
        // The rejected proof belongs to the request's own starting scope.
        // Let its caller consume that scope before this intentional logout so
        // a final stale-response assertion does not reject the useful 401.
        consumeStartingScope();
        this.commitLogout();
        return false;
      }

      let data;
      try {
        data = parseAuthRefreshResponse(await response.json());
      } catch {
        this.send('auth.error', { error: 'Invalid refresh response' });
        return false;
      }

      const scopeId = this.scopeId ?? this.coordinator.createScopeId();
      const record = this.coordinator.commitSession(data.refreshToken, scopeId, 'refresh');
      this.adoptRecord(record);
      this.send('auth.refresh', {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        activeTenant: data.activeTenant,
      });
      return true;
    } catch {
      return false;
    }
  }

  private installSession(
    data: AuthSessionResult,
    kind: Exclude<BrowserAuthSignalKind, 'logout'>,
    replaceScope: boolean,
  ): void {
    const scopeId = replaceScope || !this.scopeId
      ? this.coordinator.createScopeId()
      : this.scopeId;
    const record = this.coordinator.commitSession(data.refreshToken, scopeId, kind);
    this.adoptRecord(record);
    this.send('auth.success', {
      user: data.user,
      activeTenant: data.activeTenant,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
  }

  private commitLogout(): void {
    const record = this.coordinator.commitLogout();
    this.adoptRecord(record);
    this.send('auth.logout');
  }

  private async expireIfRevision(
    expectedRevision: number,
    consumeStartingScope: () => void = () => {},
  ): Promise<void> {
    await this.runCredentialOperation(async () => {
      if (this.credentialRevision !== expectedRevision) return;
      consumeStartingScope();
      this.commitLogout();
    });
  }

  private adoptStoredCredential(): void {
    const record = this.coordinator.readCredential();
    if (!record || record.revision < this.credentialRevision) return;
    if (record.revision === this.credentialRevision
      && record.refreshToken === this.context.refreshToken) return;
    // A scope/tombstone replacement must pass through the asynchronous purge
    // barrier. A synchronous proof adoption is safe only within one scope.
    if (record.scopeId !== this.scopeId || !record.refreshToken) return;
    this.adoptRecord(record);
    // Keep the current in-memory access token/user when only another tab
    // rotated the same scope's proof.
    this.send('auth.refresh', {
      accessToken: this.context.accessToken ?? '',
      refreshToken: record.refreshToken,
    });
  }

  private adoptRecord(record: BrowserAuthCredentialRecord): void {
    this.credentialRevision = record.revision;
    this.scopeId = record.scopeId;
  }

  private queueExternalSignal(signal: BrowserAuthSignal): void {
    if (this.disposed || signal.revision <= this.credentialRevision) return;
    this.externalReconciliation = this.externalReconciliation
      .catch(() => undefined)
      .then(() => this.reconcileExternalSignal(signal));
    void this.externalReconciliation.catch(() => undefined);
  }

  private async reconcileExternalSignal(signal: BrowserAuthSignal): Promise<void> {
    await this.runCredentialOperation(async () => {
      const stored = this.coordinator.readCredential();
      if (!stored || stored.revision <= this.credentialRevision) return;
      await this.reconcileStoredCredentialLocked(stored, signal.kind);
    }, false);
  }

  private async reconcileStoredCredentialBeforeOperation(): Promise<void> {
    const stored = this.coordinator.readCredential();
    if (!stored || stored.revision <= this.credentialRevision) return;
    const kind: BrowserAuthSignalKind = !stored.refreshToken
      ? 'logout'
      : stored.scopeId === this.scopeId
        ? 'refresh'
        : 'scope';
    await this.reconcileStoredCredentialLocked(stored, kind);
  }

  private async reconcileStoredCredentialLocked(
    stored: BrowserAuthCredentialRecord,
    kind: BrowserAuthSignalKind,
  ): Promise<void> {
    if (!stored.refreshToken) {
      this.beginScopeTransition('external-session');
      this.adoptRecord(stored);
      this.send('auth.logout');
      this.markScopeTransitionCommitted();
      await this.completeScopeTransition();
      return;
    }

    const sameScope = stored.scopeId === this.scopeId;
    if (sameScope
      && kind === 'refresh'
      && this.context.user
      && this.context.accessToken) {
      this.adoptRecord(stored);
      this.send('auth.refresh', {
        accessToken: this.context.accessToken,
        refreshToken: stored.refreshToken,
      });
      return;
    }

    this.beginScopeTransition('external-session');
    this.adoptRecord(stored);
    this.send('auth.loading');
    this.send('auth.refresh', { accessToken: '', refreshToken: stored.refreshToken });

    const refreshed = await this.performRefreshLocked();
    if (!refreshed || !this.accessToken) {
      this.markScopeTransitionCommitted();
      if (this.context.refreshToken) {
        await this.failCommittedScopeTransition(
          new Error('Unable to restore the replacement browser session'),
        );
      }
      await this.completeScopeTransition();
      return;
    }

    this.markScopeTransitionCommitted();
    try {
      const response = await fetch(`${this.baseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!response.ok) {
        this.commitLogout();
      } else {
        const user = parseAuthUser(await response.json());
        this.send('auth.success', {
          user,
          activeTenant: this.context.activeTenant ?? undefined,
          accessToken: this.context.accessToken!,
          refreshToken: this.context.refreshToken!,
        });
      }
    } catch (cause) {
      await this.failCommittedScopeTransition(cause);
    }
    await this.completeScopeTransition();
  }

  private async failCommittedScopeTransition(cause: unknown): Promise<never> {
    const operation = this.requireTransitionOperation();
    try {
      await this.scopeLifecycle?.completeTransition();
    } catch {
      // The original restoration failure remains the useful cause.
    }
    const error = new AuthSessionSynchronizationError(
      operation,
      this.credentialRevision,
      cause,
    );
    this.setTransition('recovery-required', operation, true, error.message);
    throw error;
  }

  private setTransition(
    phase: AuthSessionTransitionState['phase'],
    operation: AuthSessionTransitionOperation | null,
    recoverable: boolean,
    error: string | null,
  ): void {
    this.send('auth.transition', {
      transition: {
        phase,
        operation,
        revision: this.credentialRevision,
        recoverable,
        error,
      } satisfies AuthSessionTransitionState,
    });
  }

  private requireTransitionOperation(): AuthSessionTransitionOperation {
    if (!this.transitionOperation) {
      throw new Error('[client] No authorization scope transition is active.');
    }
    return this.transitionOperation;
  }
}
