/**
 * Browser auth session coordinator.
 *
 * Owns the XState store, URL-scoped refresh-token persistence, cross-tab
 * rotation, automatic refresh, and authenticated fetch behavior. Route
 * transports report their results through this controller.
 */

import {
  BrowserAuthCoordinationError,
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
import { AuthSessionRecoveryRequest } from './auth-session-recovery-request';
import type { AuthStore, AuthStoreContext } from './auth-store';
import { isAuthSessionResult } from './auth-types';
import type {
  AuthCompletionResult,
  AuthSessionResult,
  AuthSessionRecoveryResult,
  AuthSessionTransitionOperation,
  AuthSessionTransitionState,
  AuthTenantSummary,
  AuthUser,
} from './auth-types';

const SESSION_RECOVERY_UNAVAILABLE = 'Unable to verify the browser session. Please retry.';

/** Only a definitive auth denial retires proof; outages/protocol errors do not. */
function isRejectedSessionResponse(response: Pick<Response, 'status'>): boolean {
  return response.status === 401 || response.status === 403;
}

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
  /** @internal Synthetic tests only; public clients keep the 15-second bound. */
  recoveryRequestTimeoutMs?: number;
}

/** @internal Per-operation capability; never retained beyond its issuing exchange. */
export interface AuthCredentialIssuanceLease {
  readonly signal: AbortSignal;
  completeAuthentication(data: AuthCompletionResult, assertCurrent?: () => void): Promise<AuthCompletionResult>;
  updateTokens(accessToken: string, refreshToken: string, activeTenant?: AuthTenantSummary, assertCurrent?: () => void): Promise<void>;
  requestWithAuth<T extends { status: number }>(
    request: (accessToken: string | null) => Promise<T>,
    consumeStartingScope?: () => void,
  ): Promise<T>;
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
  private authenticationRevision = 0;
  private acknowledgedPageCleanupRevision: number | null = null;
  private scopeId: string | null = null;
  private transitionOperation: AuthSessionTransitionOperation | null = null;
  private readonly recoveryRequests = new Set<AuthSessionRecoveryRequest>();
  private readonly credentialIssuanceIntents = new Map<AuthSessionRecoveryRequest, () => boolean>();
  private readonly recoveryRequestTimeoutMs?: number;
  private disposed = false;

  constructor(
    private readonly baseUrl: string,
    options: AuthSessionControllerOptions = {},
  ) {
    this.store = createAuthStore();
    this.scopeLifecycle = options.scopeLifecycle;
    this.recoveryRequestTimeoutMs = options.recoveryRequestTimeoutMs;
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

  get authenticationContinuation(): AuthCompletionResult | null {
    return this.context.authenticationContinuation;
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

  /** A retained credential can be retried; this is not authenticated authority. */
  get hasRecoverableSession(): boolean {
    return this.context.refreshToken !== null;
  }

  /** @internal Actual server cleanup receipt for this exact anonymous revision. */
  get hasAcknowledgedPageSessionCleanup(): boolean {
    const durable = this.coordinator.readCredential();
    return !this.disposed && this.acknowledgedPageCleanupRevision !== null
      && this.acknowledgedPageCleanupRevision === this.credentialRevision
      && durable?.revision === this.credentialRevision
      && durable.scopeId === null && durable.refreshToken === null
      && this.scopeId === null && this.context.user === null
      && this.context.accessToken === null && this.context.refreshToken === null;
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
    if (this.disposed || this.scopeId !== expectedScopeId || storedScopeId !== expectedScopeId) {
      throw new Error('[client] Discarded a response from a previous authorization scope.');
    }
  }

  beginAuthentication(): void {
    this.authenticationRevision += 1;
    // Intent replacement is synchronous, independent of store notification
    // deduplication. Only this client's uncommitted issuance is cancelled.
    for (const [request, isConsumed] of this.credentialIssuanceIntents) {
      if (!isConsumed()) request.cancel();
    }
    this.send('auth.loading');
  }

  /** @internal Fence anonymous attempts which cannot yet have a family id. */
  captureAuthenticationAttempt(): () => void {
    const revision = this.authenticationRevision;
    return () => {
      if (this.disposed || this.authenticationRevision !== revision) {
        throw new DOMException('Authentication attempt was replaced', 'AbortError');
      }
    };
  }

  failAuthentication(error: string): void {
    this.send('auth.error', { error });
  }

  clearAuthenticationContinuation(): void {
    this.send('auth.continuation.clear');
  }

  /** Commit an ordinary login/registration/MFA completion under the tab lock. */
  async completeAuthentication(
    data: AuthCompletionResult,
    assertRequestCurrent: () => void = () => {},
  ): Promise<AuthCompletionResult> {
    return this.runCredentialOperation(() => this.completeAuthenticationLocked(data, assertRequestCurrent));
  }

  private async completeAuthenticationLocked(
    data: AuthCompletionResult,
    assertRequestCurrent: () => void,
    finishNetwork: () => void = () => {},
  ): Promise<AuthCompletionResult> {
    // Reconciliation while waiting for the cross-tab lock may have adopted
    // a newer session. Refuse to let this older network result replace it.
    assertRequestCurrent();
    // An identity-only continuation does not establish an authorization
    // scope. When the browser is already anonymous, keep the calling auth
    // form mounted so it can render the one-time MFA/tenant continuation;
    // there is no credential, Sync plane, or cached tenant data to purge.
    if (!isAuthSessionResult(data) && !this.hasAuthorizationScope()) {
      this.send('auth.continuation', { result: data });
      finishNetwork();
      return data;
    }
    let transitionStarted = false;
    let committed = false;
    try {
      this.beginScopeTransition('authentication');
      transitionStarted = true;
      if (isAuthSessionResult(data)) {
        this.installSession(data, 'session', true);
      } else {
        this.commitLogout();
        // The authorization subtree remounts after the purge barrier. Keep
        // the one-time identity result in memory so the new form instance
        // can continue MFA/tenant binding without replaying credentials.
        this.send('auth.continuation', { result: data });
      }
      finishNetwork();
      this.markScopeTransitionCommitted();
      committed = true;
      await this.completeScopeTransition();
      return data;
    } catch (error) {
      if (!committed && transitionStarted) await this.abortScopeTransition();
      if (!committed) {
        this.send('auth.error', { error: 'Unable to complete authentication' });
      }
      throw error;
    }
  }

  /** Own every cookie-producing HTTP exchange through parsing and local commit. */
  async runCredentialIssuance<T>(
    assertRequestCurrent: () => void,
    operation: (lease: AuthCredentialIssuanceLease) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const request = this.createRecoveryRequest();
    let scopeConsumed = false;
    this.credentialIssuanceIntents.set(request, () => scopeConsumed);
    const cancel = () => request.cancel();
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    this.recoveryRequests.add(request);
    try {
      return await request.waitForAdmission(admit => this.runCredentialOperation(async () => {
        assertRequestCurrent();
        let active = true, consumed = false;
        try {
          return await request.runCredentialExchange(async (ownedSignal, finishNetwork) => {
            const assertOwned = () => {
              ownedSignal.throwIfAborted();
              if (!active || this.disposed) throw new DOMException('Credential exchange was retired', 'AbortError');
              if (!consumed) assertRequestCurrent();
            };
            const lease: AuthCredentialIssuanceLease = {
              signal: ownedSignal,
              completeAuthentication: async (data, assertCurrent = () => {}) => {
                assertOwned(); assertCurrent();
                scopeConsumed = true;
                consumed = true;
                return this.completeAuthenticationLocked(data, () => { assertOwned(); assertCurrent(); }, finishNetwork);
              },
              updateTokens: async (accessToken, refreshToken, activeTenant, assertCurrent = () => {}) => {
                assertOwned(); assertCurrent();
                this.updateTokensLocked(accessToken, refreshToken, activeTenant);
                finishNetwork();
              },
              requestWithAuth: async (transport, consumeStartingScope = () => {}) => {
                assertOwned();
                let response = await transport(this.accessToken);
                assertOwned();
                if (response.status !== 401) return response;
                const consume = () => { assertOwned(); consumeStartingScope(); scopeConsumed = true; consumed = true; };
                if (this.context.refreshToken) {
                  const refreshed = await this.performRefreshLocked(0, consume, assertOwned, request);
                  assertOwned();
                  if (refreshed && this.accessToken) response = await transport(this.accessToken);
                } else if (this.context.user) {
                  await this.commitLogoutWithScopeBarrier('logout', consume);
                }
                assertOwned();
                return response;
              },
            };
            assertOwned();
            return operation(lease);
          });
        } finally { active = false; }
      }, true, admit));
    } finally {
      this.credentialIssuanceIntents.delete(request);
      signal?.removeEventListener('abort', cancel);
      request.cancel();
      this.recoveryRequests.delete(request);
    }
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
      this.updateTokensLocked(accessToken, refreshToken, activeTenant);
    });
  }

  private updateTokensLocked(accessToken: string, refreshToken: string, activeTenant?: AuthTenantSummary): void {
    const scopeId = this.scopeId ?? this.coordinator.createScopeId();
    const record = this.coordinator.commitSession(refreshToken, scopeId, 'refresh');
    this.adoptRecord(record);
    this.send('auth.refresh', { accessToken, refreshToken, activeTenant });
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
    assertAdmittedCurrent: () => void = () => {},
  ): Promise<T> {
    return this.coordinator.runExclusive(async () => {
      // Recovery can time out while queued. Its abandoned callback must not
      // adopt credentials or begin replacement-scope reconciliation later.
      assertAdmittedCurrent();
      if (adoptStoredCredential) await this.reconcileStoredCredentialBeforeOperation();
      return operation();
    });
  }

  async logout(
    assertStartingScopeCurrent: () => void = () => {},
    consumeStartingScope: () => void = assertStartingScopeCurrent,
  ): Promise<void> {
    const request = this.createRecoveryRequest();
    this.recoveryRequests.add(request);
    let consumed = false;
    try {
      await request.waitForAdmission((admit) => this.runCredentialOperation(async () => {
        // A retained logout intent must not survive adoption of another tab's
        // replacement account while it waited for the credential lock.
        assertStartingScopeCurrent();
        // A peer may have rotated this same family while logout was queued.
        // Adopt only its newer proof; replacement families remain fenced out.
        this.adoptStoredCredential();
        assertStartingScopeCurrent();
        const refreshToken = this.context.refreshToken;
        // The HttpOnly page cookie must be cleared server-side even when local
        // token state is absent. Local logout still succeeds offline.
        const cleanup = await this.notifyServerLogout(request, refreshToken).catch(() => undefined);
        assertStartingScopeCurrent();
        await this.commitLogoutWithScopeBarrier('logout', () => {
          consumeStartingScope();
          consumed = true;
        }, cleanup?.ok ?? false);
      }, false, () => { admit(); assertStartingScopeCurrent(); }));
    } catch (cause) {
      if (!consumed) assertStartingScopeCurrent();
      throw cause;
    } finally {
      request.cancel();
      this.recoveryRequests.delete(request);
    }
  }

  /** Clear local state after a rejected or no-longer-trusted session. */
  expireSession(): void {
    const expectedRevision = this.credentialRevision;
    void this.expireIfRevision(expectedRevision).catch(() => undefined);
  }

  /** Expire only if the credential observed by a request is still current. */
  expireSessionAtRevision(expectedRevision: number): Promise<void> {
    return this.expireIfRevision(expectedRevision);
  }

  /**
   * @internal Retire a definitively rejected authorization session and its page
   * cookie under the exact originating proof. Returns null when a newer proof
   * owns the browser, true for acknowledged server cleanup, or false when only
   * local retirement is confirmed. The public expireSession() stays local-only.
   */
  async expireRejectedPageSessionAtRevision(
    expectedRevision: number,
    expectedScope: string | null,
  ): Promise<boolean | null> {
    const originatingTransition = this.context.sessionTransition;
    const originatingAuthentication = this.authenticationRevision;
    const request = this.createRecoveryRequest();
    this.recoveryRequests.add(request);
    const ownsProof = () => {
      const durable = this.coordinator.readCredential();
      return !this.disposed
        && this.credentialRevision === expectedRevision
        && this.authenticationRevision === originatingAuthentication
        && this.scopeId === expectedScope
        && durable?.revision === expectedRevision
        && durable.scopeId === expectedScope;
    };
    try {
      return await request.waitForAdmission((admit) => this.runCredentialOperation(async () => {
        if (!ownsProof() || !this.hasAuthorizationScope()
          || this.context.isLoading || this.context.isRestoring
          || this.context.sessionTransition !== originatingTransition) return null;
        // A definite denial fences reads, writes and cached data before the
        // logout transport yields. Cookie cleanup is not permission to keep
        // using the rejected authority while its response is pending.
        this.beginScopeTransition('logout');
        let committed = false;
        try {
          let cleanupConfirmed = false;
          try {
            cleanupConfirmed = (await this.notifyServerLogout(request, this.context.refreshToken)).ok;
          } catch {
            // A rejected session must still retire locally during an outage.
            // The false result reports that remote cookie cleanup is unconfirmed.
          }
          if (!ownsProof()) {
            await this.abortScopeTransition();
            return null;
          }
          this.commitLogout();
          if (cleanupConfirmed) this.acknowledgedPageCleanupRevision = this.credentialRevision;
          this.markScopeTransitionCommitted();
          committed = true;
          await this.completeScopeTransition();
          return cleanupConfirmed;
        } catch (cause) {
          if (!committed) await this.abortScopeTransition();
          throw cause;
        }
      }, false, admit));
    } finally {
      request.cancel();
      this.recoveryRequests.delete(request);
    }
  }

  /** Refresh the access token, deduplicating concurrent calls in this tab. */
  async refresh(
    assertRequestCurrent: () => void = () => {},
    consumeStartingScope: () => void = () => {},
    signal?: AbortSignal,
  ): Promise<boolean> {
    assertRequestCurrent();
    signal?.throwIfAborted();
    if (this.refreshPromise) {
      const result = await this.refreshPromise;
      assertRequestCurrent();
      signal?.throwIfAborted();
      return result;
    }
    let startingScopeConsumed = false;
    const consumeCurrentStartingScope = () => {
      assertRequestCurrent();
      consumeStartingScope();
      startingScopeConsumed = true;
    };
    const request = this.createRecoveryRequest();
    const cancel = () => request.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    this.recoveryRequests.add(request);
    this.refreshPromise = request.waitForAdmission((admit) => this.runCredentialOperation(() => {
      assertRequestCurrent();
      return this.performRefreshLocked(0, consumeCurrentStartingScope, assertRequestCurrent, request);
    }, true, () => { admit(); assertRequestCurrent(); })).catch((cause) => {
      if (!startingScopeConsumed) assertRequestCurrent();
      if (cause instanceof BrowserAuthCoordinationError
        || cause instanceof DOMException && cause.name === 'TimeoutError') return false;
      throw cause;
    }).finally(() => {
      request.cancel();
      signal?.removeEventListener('abort', cancel);
      this.recoveryRequests.delete(request);
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
   * Retry the current rotating proof and hydrate its user behind the existing
   * purge barrier. Rejection settles sign-out; transient failures retain proof.
   * A replacement family or disposal rejects rather than publishing stale work.
   */
  async recoverSession(
    assertStartingScopeCurrent: () => void = () => {},
    consumeStartingScope: () => void = assertStartingScopeCurrent,
  ): Promise<AuthSessionRecoveryResult> {
    if (this.restorePromise) await this.restorePromise;
    assertStartingScopeCurrent();
    const recoveryRequest = this.createRecoveryRequest();
    this.recoveryRequests.add(recoveryRequest);
    try {
      return await recoveryRequest.waitForAdmission((admit) => this.runCredentialOperation(async () => {
        assertStartingScopeCurrent();
        if (!this.hasRecoverableSession && !this.hasAuthorizationScope()) {
          return { kind: 'signed-out' };
        }
        const scope = this.scopeId;
        const assertCurrent = () => this.assertAuthorizationScopeCurrent(scope);
        consumeStartingScope();
        this.beginScopeTransition('restore');
        this.send('auth.restoring');
        let committed = false;
        let retiredScope: string | null | undefined;
        let retiredRevision: number | undefined;
        try {
          const refreshed = await this.performRefreshLocked(0, () => {}, assertCurrent, recoveryRequest);
          if (!this.hasRecoverableSession) {
            // A definitive refresh denial may have retired the scope itself.
            // Clear any legacy identity-only state as well, without reusing
            // its consumed starting-scope assertion after our own logout.
            if (this.user || this.accessToken || this.activeTenant) this.commitLogout();
            retiredScope = this.scopeId;
            retiredRevision = this.credentialRevision;
            this.markScopeTransitionCommitted();
            committed = true;
            await this.completeScopeTransition();
            this.assertAuthorizationScopeCurrent(retiredScope);
            if (this.credentialRevision !== retiredRevision) throw new Error('The session changed during recovery.');
            return { kind: 'signed-out' };
          }
          assertCurrent();
          if (!refreshed || !this.accessToken) {
            this.send('auth.error', { error: SESSION_RECOVERY_UNAVAILABLE });
            await this.abortScopeTransition();
            return { kind: 'retryable', error: SESSION_RECOVERY_UNAVAILABLE };
          }
          this.markScopeTransitionCommitted();
          committed = true;
          const hydrationRevision = this.credentialRevision;
          const hydrationToken = this.accessToken;
          const assertHydrationCurrent = () => {
            assertCurrent();
            if (hydrationRevision !== this.credentialRevision
              || hydrationToken !== this.accessToken
              || this.coordinator.readCredential()?.revision !== hydrationRevision) {
              throw new Error('[client] Discarded a response from a previous authorization scope.');
            }
          };
          const { response, body } = await recoveryRequest.request(`${this.baseUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${hydrationToken}` },
            cache: 'no-store',
          });
          assertHydrationCurrent();
          if (!response.ok) {
            if (isRejectedSessionResponse(response)) {
              this.commitLogout();
              retiredScope = this.scopeId;
              retiredRevision = this.credentialRevision;
              await this.completeScopeTransition();
              this.assertAuthorizationScopeCurrent(retiredScope);
              if (this.credentialRevision !== retiredRevision) throw new Error('The session changed during recovery.');
              return { kind: 'signed-out' };
            }
            this.send('auth.error', { error: SESSION_RECOVERY_UNAVAILABLE });
            await this.completeScopeTransition();
            assertHydrationCurrent();
            return { kind: 'retryable', error: SESSION_RECOVERY_UNAVAILABLE };
          }
          const user = parseAuthUser(body);
          if (this.user && user.userId !== this.user.userId) {
            throw new Error('The recovered session identity did not match.');
          }
          this.send('auth.success', {
            user,
            activeTenant: this.activeTenant ?? undefined,
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
          });
          await this.completeScopeTransition();
          assertHydrationCurrent();
          return { kind: 'authenticated' };
        } catch (cause) {
          // Never classify a retired family/disposed controller as an outage.
          try {
            if (retiredScope !== undefined) {
              this.assertAuthorizationScopeCurrent(retiredScope);
              if (this.credentialRevision !== retiredRevision) throw new Error('The session changed during recovery.');
            } else assertCurrent();
          } catch (stale) {
            if (!committed) await this.abortScopeTransition();
            else if (this.sessionTransition.phase !== 'idle') {
              await this.completeScopeTransition().catch(() => undefined);
            }
            throw stale;
          }
          this.send('auth.error', { error: SESSION_RECOVERY_UNAVAILABLE });
          if (!committed) await this.abortScopeTransition();
          else if (this.sessionTransition.phase !== 'idle'
            && !(cause instanceof AuthSessionSynchronizationError)) {
            await this.completeScopeTransition();
          }
          return { kind: 'retryable', error: SESSION_RECOVERY_UNAVAILABLE };
        }
      }, false, () => { admit(); assertStartingScopeCurrent(); }));
    } catch (cause) {
      assertStartingScopeCurrent();
      if (!(cause instanceof BrowserAuthCoordinationError)
        && !(cause instanceof DOMException && cause.name === 'TimeoutError')) throw cause;
      return { kind: 'retryable', error: SESSION_RECOVERY_UNAVAILABLE };
    } finally {
      recoveryRequest.cancel();
      this.recoveryRequests.delete(recoveryRequest);
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
    for (const request of this.recoveryRequests) request.cancel();
    this.unsubscribeSignals();
    this.coordinator.dispose();
  }

  private get context(): AuthStoreContext {
    return this.store.getSnapshot().context as AuthStoreContext;
  }

  private hasAuthorizationScope(): boolean {
    return Boolean(
      this.scopeId
      || this.context.user
      || this.context.accessToken
      || this.context.refreshToken
      || this.context.activeTenant,
    );
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
    const scope = this.scopeId;
    const assertCurrent = () => this.assertAuthorizationScopeCurrent(scope);
    const request = this.createRecoveryRequest();
    this.recoveryRequests.add(request);
    try {
      // Rotation and identity hydration are one credential operation. Releasing
      // the cross-tab lock between them lets a legitimate same-family rotation
      // supersede the exact proof before /me can commit, falsely turning an
      // ordinary startup into a session-recovery error. Keep the existing exact
      // proof fences and bounded reads; do not accept an older hydration result.
      await request.waitForAdmission((admit) => this.runCredentialOperation(async () => {
        assertCurrent();
        const refreshed = await this.performRefreshLocked(0, () => {}, assertCurrent, request);
        if (!refreshed || !this.accessToken) {
          // Definitively rejected refresh proof already committed logout.
          // Temporary failures leave the persisted proof for explicit retry.
          if (this.context.refreshToken) {
            assertCurrent();
            this.send('auth.error', { error: 'Unable to restore the browser session' });
          }
          return;
        }
        const revision = this.credentialRevision;
        const assertHydrationCurrent = () => {
          assertCurrent();
          if (revision !== this.credentialRevision
            || this.coordinator.readCredential()?.revision !== revision) {
            throw new Error('[client] Discarded a response from a previous authorization scope.');
          }
        };
        const { response, body } = await request.request(`${this.baseUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
        });
        assertHydrationCurrent();
        if (!response.ok) {
          if (isRejectedSessionResponse(response)) {
            // The startup operation already owns the non-reentrant tab lock.
            // Clear its newly minted page cookie here before publishing logout;
            // acquiring another credential operation would deadlock admission.
            const cleared = await this.notifyServerLogout(request, this.context.refreshToken);
            assertHydrationCurrent();
            if (!cleared.ok) throw new Error('Unable to clear the restored page session');
            await this.commitLogoutWithScopeBarrier('logout', () => {});
          } else this.send('auth.error', { error: 'Unable to restore the browser session' });
          return;
        }
        const user = parseAuthUser(body);
        assertHydrationCurrent();
        this.send('auth.success', {
          user,
          activeTenant: this.context.activeTenant ?? undefined,
          accessToken: this.context.accessToken!,
          refreshToken: this.context.refreshToken!,
        });
      }, false, () => { admit(); assertCurrent(); }));
    } catch {
      // An outage, malformed body or unconfirmed page-cookie cleanup must not
      // discard the rotating proof or falsely claim a settled sign-out.
      try { assertCurrent(); } catch { return; }
      if (this.context.refreshToken && !this.context.user) {
        this.send('auth.error', { error: 'Unable to restore the browser session' });
      }
    } finally {
      request.cancel();
      this.recoveryRequests.delete(request);
    }
  }

  private notifyServerLogout(
    request: AuthSessionRecoveryRequest,
    refreshToken: string | null,
  ): Promise<Response> {
    // Logout has no user-facing response body. Its acknowledged HTTP outcome
    // is enough; a stalled unused JSON body must not block local retirement.
    return request.run((signal) => fetch(`${this.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      signal,
      cache: 'no-store',
    }));
  }

  private createRecoveryRequest(): AuthSessionRecoveryRequest {
    return new AuthSessionRecoveryRequest(this.recoveryRequestTimeoutMs);
  }

  private async performRefreshLocked(
    attempt: number,
    consumeStartingScope: () => void,
    assertRequestCurrent: () => void,
    recoveryRequest: AuthSessionRecoveryRequest,
  ): Promise<boolean> {
    assertRequestCurrent();
    this.adoptStoredCredential();
    const refreshToken = this.context.refreshToken;
    const attemptRevision = this.credentialRevision;
    if (!refreshToken) return false;

    try {
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      };
      const recovered = await recoveryRequest.request(`${this.baseUrl}/auth/refresh`, init);
      const { response } = recovered;
      assertRequestCurrent();

      const latest = this.coordinator.readCredential();
      if ((latest?.revision ?? 0) !== attemptRevision
        || latest?.refreshToken !== refreshToken) {
        this.adoptStoredCredential();
        return attempt < 1 && this.context.refreshToken
          ? this.performRefreshLocked(attempt + 1, consumeStartingScope, assertRequestCurrent, recoveryRequest)
          : Boolean(this.accessToken);
      }

      if (!response.ok) {
        if (!isRejectedSessionResponse(response)) {
          this.send('auth.error', { error: 'Unable to refresh the browser session' });
          return false;
        }
        // The rejected proof belongs to the request's own starting scope.
        // Let its caller consume that scope before this intentional logout so
        // a final stale-response assertion does not reject the useful 401.
        await this.commitLogoutWithScopeBarrier('logout', consumeStartingScope);
        return false;
      }

      let data;
      try {
        data = parseAuthRefreshResponse(recovered.body);
        assertRequestCurrent();
      } catch {
        assertRequestCurrent();
        this.send('auth.error', { error: 'Invalid refresh response' });
        return false;
      }

      // Parsing a streaming body can outlive a same-family rotation from a
      // peer. Do not replace its newer proof with this older response.
      const latestAfterBody = this.coordinator.readCredential();
      if ((latestAfterBody?.revision ?? 0) !== attemptRevision
        || latestAfterBody?.refreshToken !== refreshToken) {
        this.adoptStoredCredential();
        return attempt < 1 && this.context.refreshToken
          ? this.performRefreshLocked(attempt + 1, consumeStartingScope, assertRequestCurrent, recoveryRequest)
          : Boolean(this.accessToken);
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
      assertRequestCurrent();
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
      await this.commitLogoutWithScopeBarrier('logout', consumeStartingScope);
    });
  }

  /** Commit one logout tombstone behind the same purge/reconnect barrier. */
  private async commitLogoutWithScopeBarrier(
    operation: AuthSessionTransitionOperation,
    consumeStartingScope: () => void,
    acknowledgedPageCleanup = false,
  ): Promise<void> {
    consumeStartingScope();
    // Replacement-session reconciliation already owns the barrier. A refresh
    // rejection inside it must update the committed credential without trying
    // to open a nested transition; the outer operation completes the purge.
    if (this.transitionOperation
      && this.context.sessionTransition.phase !== 'recovery-required') {
      this.commitLogout();
      if (acknowledgedPageCleanup) this.acknowledgedPageCleanupRevision = this.credentialRevision;
      return;
    }

    let transitionStarted = false;
    let committed = false;
    try {
      this.beginScopeTransition(operation);
      transitionStarted = true;
      this.commitLogout();
      if (acknowledgedPageCleanup) this.acknowledgedPageCleanupRevision = this.credentialRevision;
      this.markScopeTransitionCommitted();
      committed = true;
      await this.completeScopeTransition();
    } catch (cause) {
      if (transitionStarted && !committed) await this.abortScopeTransition();
      throw cause;
    }
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
    if (signal.scopeId !== this.scopeId) {
      for (const request of this.recoveryRequests) request.cancel();
    }
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
    // The persisted proof already belongs to a replacement family. Drop A's
    // in-memory identity/tenant behind the barrier without writing a logout
    // tombstone over B's recoverable credential.
    if (!sameScope) this.send('auth.logout');
    this.send('auth.loading');
    this.send('auth.refresh', { accessToken: '', refreshToken: stored.refreshToken });

    const request = this.createRecoveryRequest();
    this.recoveryRequests.add(request);
    const scope = this.scopeId;
    const assertCurrent = () => {
      this.assertAuthorizationScopeCurrent(scope);
      if (this.coordinator.readCredential()?.scopeId !== scope) {
        throw new DOMException('The replacement browser session was retired', 'AbortError');
      }
    };
    try {
      const refreshed = await this.performRefreshLocked(0, () => {}, assertCurrent, request);
      if (!refreshed || !this.accessToken) {
        // Definitive denial already settled the intentional logout barrier.
        if (!this.hasRecoverableSession && this.sessionTransition.phase === 'idle') return;
        assertCurrent();
        this.markScopeTransitionCommitted();
        if (this.context.refreshToken) {
          await this.failCommittedScopeTransition(
            new Error('Unable to restore the replacement browser session'),
          );
        }
        await this.completeScopeTransition();
        return;
      }

      assertCurrent();
      this.markScopeTransitionCommitted();
      const revision = this.credentialRevision, token = this.accessToken;
      const assertHydrationCurrent = () => {
        assertCurrent();
        if (revision !== this.credentialRevision || token !== this.accessToken
          || this.coordinator.readCredential()?.revision !== revision) {
          throw new DOMException('The replacement browser session was retired', 'AbortError');
        }
      };
      try {
        const { response, body } = await request.request(`${this.baseUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assertHydrationCurrent();
        if (!response.ok) {
          if (isRejectedSessionResponse(response)) this.commitLogout();
          else throw new Error('Unable to restore the replacement browser session');
        } else {
          const user = parseAuthUser(body);
          this.send('auth.success', {
            user,
            activeTenant: this.context.activeTenant ?? undefined,
            accessToken: this.context.accessToken!,
            refreshToken: this.context.refreshToken!,
          });
        }
      } catch (cause) {
        assertHydrationCurrent();
        await this.failCommittedScopeTransition(cause);
      }
      await this.completeScopeTransition();
    } finally {
      request.cancel();
      this.recoveryRequests.delete(request);
    }
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
    this.send('auth.error', { error: 'Unable to restore the replacement browser session' });
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
