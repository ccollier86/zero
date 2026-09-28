/**
 * Stable browser auth façade for Zero.
 *
 * Route families, session state, and public contracts live in focused modules;
 * this class composes them while preserving the established AuthClient API.
 */

import { AuthAccountTransport } from './auth-account-transport';
import type { AuthAuthenticationAttempt } from './auth-authentication-attempt';
import { AuthActionTransport } from './auth-action-transport';
import { AuthAdminTransport } from './auth-admin-transport';
import { AuthAuthorizationController } from './auth-authorization-controller';
import { AuthAuthorizationTransport } from './auth-authorization-transport';
import {
  AuthDomainOnboardingTransport,
  AuthTenantDomainTransport,
} from './auth-domain-transport';
import type {
  AuthAuthorizationSnapshot,
  AuthAuthorizationState,
} from './auth-authorization-types';
import type {
  AuthDomainOnboardingAdmissionResult,
  AuthDomainOnboardingCompletion,
  AuthTenantDomainAdministration,
  AuthTenantDomainChallengeResult,
  AuthTenantDomainClaimResult,
  AuthTenantDomainPolicyUpdate,
  AuthTenantDomainReleaseInput,
  AuthTenantDomainReleaseResult,
} from './auth-domain-types';
import { AuthApplicationAdministrationTransport } from './auth-application-administration-transport';
import type { AuthApplicationAdminSdkSurface } from './auth-application-administration-types';
import { AuthAuditTransport } from './auth-audit-transport';
import type { AuthAuditSdkSurface } from './auth-audit-types';
import {
  AuthClientError,
  createAuthClientError,
  resolveAuthRequestUrl,
} from './auth-errors';
import { AuthMfaTransport } from './auth-mfa-transport';
import { AuthPropertyTransport } from './auth-property-transport';
import {
  AuthSessionController,
  AuthSessionSynchronizationError,
} from './auth-session';
import { AuthTenantTransport } from './auth-tenant-transport';
import { AuthTenantAdministrationTransport } from './auth-tenant-administration-transport';
import { AuthTenantOnboardingTransport } from './auth-tenant-onboarding-transport';
import type { BrowserAuthCoordinationEnvironment } from './auth-browser-coordination';
import type { AuthStore } from './auth-store';
import type {
  AuthActionTokenInfo,
  AuthCompletionResult,
  AuthEmailVerificationRequiredResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthPasswordUpdatedResult,
  AuthPublicConfig,
  AuthRegistrationResult,
  AuthSessionResult,
  AuthSessionTransitionState,
  AuthTenantListResult,
  AuthTenantCreateParams,
  AuthTenantSummary,
  AuthTenantAddMemberParams,
  AuthTenantAdministrationConfig,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
  AuthTenantUpdateMemberParams,
  AuthTenantAcceptInvitationParams,
  AuthTenantInvitationAcceptanceResult,
  AuthTenantInvitationInspection,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantDenyJoinRequestParams,
  AuthTenantJoinRequestListParams,
  AuthTenantJoinRequestPage,
  AuthTenantReviewJoinRequestParams,
  AuthUser,
  RegisterParams,
} from './auth-types';
import type {
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaResetResult,
  AuthAdminUpdateUserParams,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthAdminUserMfaStatus,
} from './auth-admin-types';

export {
  AUTH_DISABLED_MESSAGE,
  AuthClientError,
  createAuthDisabledError,
} from './auth-errors';
export { AuthSessionSynchronizationError } from './auth-session';
export {
  isAuthEmailVerificationRequiredResult,
  isAuthTenantOnboardingRequiredResult,
  isAuthTenantSelectionRequiredResult,
} from './auth-types';
export type { AuthStore } from './auth-store';
export {
  hasAnyAuthorizationPermission,
  hasAuthorizationPermission,
  hasEveryAuthorizationPermission,
} from './auth-authorization-types';
export type {
  AuthAuthorizationIdentitySnapshot,
  AuthAuthorizationScopeSnapshot,
  AuthAuthorizationSnapshot,
  AuthAuthorizationState,
  AuthAuthorizationStatus,
} from './auth-authorization-types';
export type {
  AuthDomainOnboardingAdmissionResult,
  AuthDomainOnboardingCompletion,
  AuthDomainOnboardingPendingRequest,
  AuthDomainOnboardingStatus,
  AuthDomainOnboardingTenantSummary,
  AuthTenantDomainAdministration,
  AuthTenantDomainChallengeResult,
  AuthTenantDomainClaim,
  AuthTenantDomainClaimResult,
  AuthTenantDomainClaimStatus,
  AuthTenantDomainDnsChallenge,
  AuthTenantDomainPolicy,
  AuthTenantDomainPolicyUpdate,
  AuthTenantDomainReleaseInput,
  AuthTenantDomainReleaseResult,
  AuthTenantDomainRequestRole,
} from './auth-domain-types';
export type {
  AuthApplicationAdministrationConfig,
  AuthApplicationAdminSdkSurface,
  AuthApplicationOwnershipTransferResult,
  AuthApplicationRoleDescriptor,
  AuthApplicationRoleMutationResult,
  AuthApplicationUser,
  AuthApplicationUserIdentity,
  AuthApplicationUserListParams,
  AuthApplicationUserPage,
  AuthApplicationUserStatus,
} from './auth-application-administration-types';
export type {
  AuthAuditActorProvenance,
  AuthAuditEvent,
  AuthAuditExport,
  AuthAuditMetadata,
  AuthAuditMetadataValue,
  AuthAuditOutcome,
  AuthAuditPage,
  AuthAuditPruneResult,
  AuthAuditQuery,
  AuthAuditReadScope,
  AuthAuditScopeKind,
  AuthAuditSdkSurface,
} from './auth-audit-types';
export type {
  AuthActionTokenInfo,
  AuthCompletionResult,
  AuthEmailVerificationRequiredResult,
  AuthMfaChallenge,
  AuthMfaChallengeRequiredResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupRequiredResult,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthPasswordUpdatedResult,
  AuthPublicConfig,
  AuthRegistrationResult,
  AuthRegistrationTenant,
  AuthSessionResult,
  AuthSessionTransitionOperation,
  AuthSessionTransitionState,
  AuthTenantListResult,
  AuthTenantCreateParams,
  AuthTenantOnboardingRequiredResult,
  AuthTenantSelectionRequiredResult,
  AuthTenantSummary,
  AuthTenantAddMemberParams,
  AuthTenantAdministrationConfig,
  AuthTenantMember,
  AuthTenantMemberIdentity,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantMembershipStatus,
  AuthTenantOwnershipTransferResult,
  AuthTenantRoleDescriptor,
  AuthTenantUpdateMemberParams,
  AuthTenantAcceptInvitationParams,
  AuthTenantInvitation,
  AuthTenantInvitationAcceptanceResult,
  AuthTenantInvitationInspection,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantInvitationStatus,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestApprovalPolicy,
  AuthTenantJoinRequestApprovalRole,
  AuthTenantJoinRequestListParams,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestRoleSelection,
  AuthTenantJoinRequestStatus,
  AuthTenantDenyJoinRequestParams,
  AuthTenantReviewJoinRequestParams,
  AuthUser,
  AuthUserPropertyConfig,
  RegisterParams,
} from './auth-types';
export type {
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaRequirement,
  AuthAdminMfaResetResult,
  AuthAdminSdkSurface,
  AuthAdminUpdateUserParams,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthAdminUserMfaStatus,
  AuthAdminUserPage,
  AuthAdminUserPropertyConfig,
} from './auth-admin-types';

export interface AuthAuthorizationScopeLifecycle {
  beginTransition(): void;
  completeTransition(): Promise<void> | void;
  abortTransition(): Promise<void> | void;
  reconcileTransition?(): Promise<void> | void;
  beginRequest(): number;
  assertRequestCurrent(epoch: number): void;
  registerRequestCancellation?(
    epoch: number,
    cancel: () => void,
  ): () => void;
}

export interface AuthClientOptions {
  /** SDK-owned cache/transport barrier for tenant authorization changes. */
  authorizationScopeLifecycle?: AuthAuthorizationScopeLifecycle;
  /** @internal Deterministic browser primitive injection for SDK tests/hosts. */
  browserAuthCoordination?: BrowserAuthCoordinationEnvironment;
  /** Browser authorization hint revalidation interval. Set to 0 to disable polling. */
  authorizationRevalidationIntervalMs?: number;
}

type AuthenticatedTransportResult = { status: number };

const authenticatedResponseScopeAssertions = new WeakMap<Response, () => void>();

const RESPONSE_BODY_READ_METHODS = new Set<PropertyKey>([
  'arrayBuffer',
  'blob',
  'bytes',
  'formData',
  'json',
  'text',
]);

interface GuardedResponseMetadata {
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly type: ResponseType;
  readonly url: string;
}

/**
 * Keep a fetch Response usable as a Response while refusing to surface body
 * bytes after the browser has crossed an authorization-scope boundary.
 *
 * Fetch resolves when headers arrive, not when the body has finished. Merely
 * checking the epoch around `await fetch()` therefore leaves a window where a
 * previous tenant's body can complete after a tenant switch. The guarded
 * stream checks immediately before and after every source read, and the proxy
 * checks public Response access plus body-reader completion.
 */
function guardResponseAuthorizationScope(
  response: Response,
  assertCurrent: () => void,
): Response {
  assertCurrent();

  const metadata: GuardedResponseMetadata = {
    ok: response.ok,
    redirected: response.redirected,
    status: response.status,
    statusText: response.statusText,
    type: response.type,
    url: response.url,
  };

  if (!response.body) {
    return proxyGuardedResponse(response, metadata, assertCurrent);
  }

  const guardedBody = createAuthorizationScopeGuardedStream(
    response.body,
    assertCurrent,
  );
  // The Response constructor rejects opaque status 0. Preserve it through the
  // proxy metadata while using a valid internal status for body consumption.
  const internalStatus = response.status >= 200 && response.status <= 599
    ? response.status
    : 200;
  const guardedResponse = new Response(guardedBody, {
    headers: response.headers,
    status: internalStatus,
    statusText: internalStatus === response.status ? response.statusText : undefined,
  });
  return proxyGuardedResponse(guardedResponse, metadata, assertCurrent);
}

interface ComposedAbortSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

/**
 * Couple a caller-owned abort signal to the authorization-scope signal without
 * retaining either listener after the network attempt settles.
 */
function composeAuthorizationScopeSignal(
  callerSignal: AbortSignal | null | undefined,
  authorizationScopeSignal: AbortSignal,
): ComposedAbortSignal {
  if (!callerSignal || callerSignal === authorizationScopeSignal) {
    return { signal: authorizationScopeSignal, dispose: () => {} };
  }

  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  const abortFromCaller = () => abortFrom(callerSignal);
  const abortFromScope = () => abortFrom(authorizationScopeSignal);

  if (callerSignal.aborted) abortFrom(callerSignal);
  else callerSignal.addEventListener('abort', abortFromCaller, { once: true });

  if (authorizationScopeSignal.aborted) abortFrom(authorizationScopeSignal);
  else authorizationScopeSignal.addEventListener('abort', abortFromScope, { once: true });

  return {
    signal: controller.signal,
    dispose() {
      callerSignal.removeEventListener('abort', abortFromCaller);
      authorizationScopeSignal.removeEventListener('abort', abortFromScope);
    },
  };
}

function createAuthorizationScopeGuardedStream(
  source: ReadableStream<Uint8Array>,
  assertCurrent: () => void,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let finished = false;

  const releaseReader = () => {
    if (!reader) return;
    try {
      reader.releaseLock();
    } catch {
      // A cancelled/errored stream may already have released its lock.
    }
    reader = null;
  };

  const cancelSource = async (reason: unknown) => {
    if (!reader) reader = source.getReader();
    try {
      await reader.cancel(reason);
    } finally {
      releaseReader();
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        assertCurrent();
        if (!reader) reader = source.getReader();
        const chunk = await reader.read();
        assertCurrent();
        if (chunk.done) {
          finished = true;
          releaseReader();
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        finished = true;
        try {
          await cancelSource(error);
        } catch {
          // Preserve the authorization-boundary error, not cancellation noise.
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      await cancelSource(reason);
    },
  });
}

function proxyGuardedResponse(
  response: Response,
  metadata: GuardedResponseMetadata,
  assertCurrent: () => void,
): Response {
  return new Proxy(response, {
    get(target, property) {
      assertCurrent();

      if (property === 'url'
        || property === 'redirected'
        || property === 'type'
        || property === 'status'
        || property === 'statusText'
        || property === 'ok') {
        return metadata[property];
      }

      if (property === 'clone') {
        return () => {
          assertCurrent();
          return proxyGuardedResponse(target.clone(), metadata, assertCurrent);
        };
      }

      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;

      if (RESPONSE_BODY_READ_METHODS.has(property)) {
        return async (...args: unknown[]) => {
          assertCurrent();
          const result = await Reflect.apply(value, target, args);
          assertCurrent();
          return result;
        };
      }

      return value.bind(target);
    },
  });
}

/**
 * Manages browser authentication state and delegates route families to focused
 * transports. Access tokens remain in memory; refresh tokens are persisted and
 * rotated by the session controller.
 */
export class AuthClient {
  readonly store: AuthStore;
  /** Single/advanced application-role control plane. */
  readonly applicationAdmin: AuthApplicationAdminSdkSurface;
  /** Authorized durable auth/control-plane audit access. */
  readonly audit: AuthAuditSdkSurface;
  private readonly session: AuthSessionController;
  private readonly authorizationController: AuthAuthorizationController;
  private readonly account: AuthAccountTransport;
  private readonly actions: AuthActionTransport;
  private readonly mfa: AuthMfaTransport;
  private readonly properties: AuthPropertyTransport;
  private readonly tenants: AuthTenantTransport;
  private readonly tenantAdministration: AuthTenantAdministrationTransport;
  private readonly tenantOnboarding: AuthTenantOnboardingTransport;
  private readonly tenantDomains: AuthTenantDomainTransport;
  private readonly domainOnboarding: AuthDomainOnboardingTransport;
  private readonly admin: AuthAdminTransport;

  constructor(
    private readonly baseUrl: string,
    private readonly options: AuthClientOptions = {},
  ) {
    this.session = new AuthSessionController(baseUrl, {
      scopeLifecycle: options.authorizationScopeLifecycle,
      coordination: options.browserAuthCoordination,
    });
    this.store = this.session.store;
    const authorizationTransport = new AuthAuthorizationTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      createResponseError: createAuthClientError,
      assertResponseCurrent: (response) => this.assertAuthenticatedResponseCurrent(response),
    });
    this.authorizationController = new AuthAuthorizationController({
      load: (signal) => authorizationTransport.getCurrent(signal),
      readSession: () => ({
        user: this.session.user,
        activeTenant: this.session.activeTenant,
        accessToken: this.session.accessToken,
        isLoading: this.session.isLoading,
        transition: this.session.sessionTransition,
      }),
      subscribeSession: (callback) => this.session.subscribe(callback),
      expireSession: () => this.session.expireSession(),
      revalidateIntervalMs: options.authorizationRevalidationIntervalMs,
    });

    this.account = new AuthAccountTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      beginAuthentication: () => this.beginAuthenticationAttempt(),
      failAuthentication: (message, attempt) => {
        attempt.assertCurrent();
        this.session.failAuthentication(message);
      },
      completeAuthentication: (result, attempt) => (
        this.session.completeAuthentication(result, attempt.assertCurrent)
      ),
      updateTokens: (accessToken, refreshToken, response) => (
        this.session.updateTokens(
          accessToken,
          refreshToken,
          undefined,
          () => this.assertAuthenticatedResponseCurrent(response),
        )
      ),
    });
    this.actions = new AuthActionTransport({
      baseUrl,
      beginAuthentication: () => this.beginAuthenticationAttempt(),
      failAuthentication: (message, attempt) => {
        attempt.assertCurrent();
        this.session.failAuthentication(message);
      },
      completeAuthentication: (result, attempt) => (
        this.session.completeAuthentication(result, attempt.assertCurrent)
      ),
    });
    this.mfa = new AuthMfaTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      optionalAuthenticatedFetch: (url, init) => {
        return this.fetchWithOptionalAuth(url, init);
      },
      assertResponseCurrent: (response) => this.assertAuthenticatedResponseCurrent(response),
      beginAuthentication: () => this.beginAuthenticationAttempt(),
      failAuthentication: (message, attempt) => {
        attempt.assertCurrent();
        this.session.failAuthentication(message);
      },
      completeAuthentication: (result, attempt) => (
        this.session.completeAuthentication(result, attempt.assertCurrent)
      ),
    });
    this.properties = new AuthPropertyTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      patchProperties: (response, values) => {
        this.assertAuthenticatedResponseCurrent(response);
        this.session.patchProperties(values);
      },
      replaceProperties: (response, values) => {
        this.assertAuthenticatedResponseCurrent(response);
        this.session.replaceProperties(values);
      },
      removeProperty: (response, key) => {
        this.assertAuthenticatedResponseCurrent(response);
        this.session.deleteProperty(key);
      },
    });
    this.tenants = new AuthTenantTransport({
      baseUrl,
      getRefreshToken: () => this.session.refreshToken,
      getRevision: () => this.session.revision,
      runCredentialOperation: (operation) => (
        this.session.runCredentialOperation(operation)
      ),
      commitScopeAuthentication: (result) => (
        this.session.commitScopeAuthentication(result)
      ),
      expireSessionAtRevision: (revision) => (
        this.session.expireSessionAtRevision(revision)
      ),
      beginScopeTransition: (operation) => this.session.beginScopeTransition(operation),
      completeScopeTransition: () => this.session.completeScopeTransition(),
      abortScopeTransition: () => this.session.abortScopeTransition(),
    });
    this.tenantAdministration = new AuthTenantAdministrationTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      createResponseError: createAuthClientError,
      assertResponseCurrent: (response) => this.assertAuthenticatedResponseCurrent(response),
      expireSession: (response) => {
        this.assertAuthenticatedResponseCurrent(response);
        this.session.expireSession();
      },
    });
    this.applicationAdmin = new AuthApplicationAdministrationTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      createResponseError: createAuthClientError,
      assertResponseCurrent: (response) => this.assertAuthenticatedResponseCurrent(response),
      refreshAuthorization: async (response) => {
        const assertCurrent = () => this.assertAuthenticatedResponseCurrent(response);
        let responseScopeInvalidated = false;
        const consumeResponseScope = () => {
          assertCurrent();
          responseScopeInvalidated = true;
        };
        assertCurrent();
        // The server mutation is already committed. A best-effort refresh
        // gives Sync/ephemeral clients a fresh bearer and reconnect signal;
        // HTTP authority is live even if a transient refresh cannot complete.
        await this.session.refresh(assertCurrent, consumeResponseScope);
        return !responseScopeInvalidated;
      },
    });
    this.audit = new AuthAuditTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      createResponseError: createAuthClientError,
      assertResponseCurrent: (response) => this.assertAuthenticatedResponseCurrent(response),
    });
    this.tenantOnboarding = new AuthTenantOnboardingTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      optionalAuthenticatedFetch: (url, init) => this.fetchWithOptionalAuth(url, init),
      createResponseError: createAuthClientError,
      assertResponseCurrent: (response) => this.assertAuthenticatedResponseCurrent(response),
      beginAuthentication: () => this.beginAuthenticationAttempt(),
      failAuthentication: (message, attempt) => {
        attempt.assertCurrent();
        this.session.failAuthentication(message);
      },
      completeAuthentication: (result, attempt) => (
        this.session.completeAuthentication(result, attempt.assertCurrent)
      ),
    });
    this.tenantDomains = new AuthTenantDomainTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      createResponseError: createAuthClientError,
      assertResponseCurrent: (response) => this.assertAuthenticatedResponseCurrent(response),
    });
    this.domainOnboarding = new AuthDomainOnboardingTransport({
      baseUrl,
      optionalAuthenticatedFetch: (url, init) => this.fetchWithOptionalAuth(url, init),
      createResponseError: createAuthClientError,
      assertResponseCurrent: (response) => this.assertAuthenticatedResponseCurrent(response),
    });
    this.admin = new AuthAdminTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.fetchWithAuth(url, init),
      createResponseError: createAuthClientError,
      assertResponseCurrent: (response) => this.assertAuthenticatedResponseCurrent(response),
      createTimeoutError: () => new AuthClientError(
        'Admin auth request timed out. Check the server and try again.',
        408,
        'ADMIN_REQUEST_TIMEOUT',
        null,
      ),
    });
  }

  get user(): AuthUser | null {
    return this.session.user;
  }

  get isAuthenticated(): boolean {
    return this.session.isAuthenticated;
  }

  get activeTenant(): AuthTenantSummary | null {
    return this.session.activeTenant;
  }

  get isLoading(): boolean {
    return this.session.isLoading;
  }

  get error(): string | null {
    return this.session.error;
  }

  /** Current authorization-scope transition/recovery phase. */
  get sessionTransition(): AuthSessionTransitionState {
    return this.session.sessionTransition;
  }

  get accessToken(): string | null {
    return this.session.accessToken;
  }

  /** @internal Opaque browser-local authorization family for UI cache fences. */
  get authorizationScopeKey(): string | null {
    return this.session.authorizationScopeKey;
  }

  /** Last server-validated browser authorization hint, or null while unavailable. */
  get authorization(): AuthAuthorizationSnapshot | null {
    return this.authorizationController.getSnapshot().snapshot;
  }

  /** Observable load/revocation state for the current authorization hint. */
  get authorizationState(): AuthAuthorizationState {
    return this.authorizationController.getSnapshot();
  }

  /** Load the snapshot when absent, otherwise return the current matching value. */
  getAuthorization(): Promise<AuthAuthorizationSnapshot | null> {
    return this.authorizationController.ensureCurrent();
  }

  /** Force a live server read of the current identity and scope. */
  refreshAuthorization(): Promise<AuthAuthorizationSnapshot | null> {
    return this.authorizationController.refresh();
  }

  subscribeAuthorization(callback: () => void): () => void {
    return this.authorizationController.subscribe(callback);
  }

  login(username: string, password: string): Promise<AuthCompletionResult> {
    return this.account.login(username, password);
  }

  register(params: RegisterParams): Promise<AuthRegistrationResult> {
    return this.account.register(params);
  }

  getConfig(): Promise<AuthPublicConfig> {
    return this.account.getConfig();
  }

  forgotPassword(email: string, nativeContinuation?: string): Promise<void> {
    return this.account.forgotPassword(email, nativeContinuation);
  }

  resendVerificationEmail(email: string, nativeContinuation?: string): Promise<void> {
    return this.account.resendVerificationEmail(email, nativeContinuation);
  }

  verifyEmail(token: string): Promise<AuthCompletionResult> {
    return this.actions.verifyEmail(token);
  }

  inspectActionToken(token: string): Promise<AuthActionTokenInfo> {
    return this.runAuthorizationScopeOperation(() => (
      this.actions.inspectActionToken(token)
    ));
  }

  resetPassword(token: string, newPassword: string): Promise<AuthCompletionResult> {
    return this.actions.resetPassword(token, newPassword);
  }

  setupPassword(token: string, newPassword: string): Promise<AuthCompletionResult> {
    return this.actions.setupPassword(token, newPassword);
  }

  listMfaMethods(): Promise<{ methods: AuthMfaMethod[]; required: boolean }> {
    return this.mfa.listMfaMethods();
  }

  startMfaSetup(params: {
    setupToken?: string;
    method: AuthMfaMethodType;
    label?: string;
  }): Promise<AuthMfaSetupStartResult> {
    return this.mfa.startMfaSetup(params);
  }

  verifyMfaSetup(params: {
    verificationToken: string;
    code: string;
  }): Promise<AuthMfaSetupVerifyResult> {
    return this.mfa.verifyMfaSetup(params);
  }

  verifyMfaChallenge(params: {
    challengeToken: string;
    code: string;
  }): Promise<AuthCompletionResult> {
    return this.mfa.verifyMfaChallenge(params);
  }

  selectTenant(continuation: string, tenantId: string): Promise<AuthSessionResult> {
    return this.runScopeChangingOperation((consumeStartingScope) => (
      this.tenants.selectTenant(continuation, tenantId, consumeStartingScope)
    ));
  }

  listTenants(): Promise<AuthTenantListResult> {
    return this.runAuthorizationScopeOperation((attempt) => (
      this.tenants.listTenants(attempt.signal, attempt.assertCurrent)
    ));
  }

  createTenant(params: AuthTenantCreateParams): Promise<AuthSessionResult> {
    return this.runScopeChangingOperation((consumeStartingScope) => (
      this.tenants.createTenant(params, consumeStartingScope)
    ));
  }

  switchTenant(tenantId: string): Promise<AuthSessionResult> {
    return this.runScopeChangingOperation((consumeStartingScope) => (
      this.tenants.switchTenant(tenantId, consumeStartingScope)
    ));
  }

  getTenantAdministrationConfig(): Promise<AuthTenantAdministrationConfig> {
    return this.tenantAdministration.getConfig();
  }

  listTenantMembers(
    params: AuthTenantMemberListParams = {},
  ): Promise<AuthTenantMemberPage> {
    return this.tenantAdministration.listMembers(params);
  }

  addTenantMember(
    params: AuthTenantAddMemberParams,
  ): Promise<AuthTenantMemberMutationResult> {
    return this.tenantAdministration.addMember(params);
  }

  updateTenantMember(
    membershipId: string,
    params: AuthTenantUpdateMemberParams,
  ): Promise<AuthTenantMemberMutationResult> {
    return this.tenantAdministration.updateMember(membershipId, params);
  }

  removeTenantMember(membershipId: string): Promise<AuthTenantMemberMutationResult> {
    return this.tenantAdministration.removeMember(membershipId);
  }

  transferTenantOwnership(
    membershipId: string,
  ): Promise<AuthTenantOwnershipTransferResult> {
    return this.tenantAdministration.transferOwnership(membershipId);
  }

  inspectTenantInvitation(token: string): Promise<AuthTenantInvitationInspection> {
    return this.tenantOnboarding.inspectInvitation(token);
  }

  acceptTenantInvitation(
    params: AuthTenantAcceptInvitationParams,
  ): Promise<AuthTenantInvitationAcceptanceResult> {
    return this.tenantOnboarding.acceptInvitation(params);
  }

  submitTenantJoinRequest(
    tenantSlug: string,
    continuation?: string,
  ): Promise<{ submitted: true }> {
    return this.tenantOnboarding.submitJoinRequest({ tenantSlug, continuation });
  }

  listTenantInvitations(
    params: AuthTenantInvitationListParams = {},
  ): Promise<AuthTenantInvitationPage> {
    return this.tenantOnboarding.listInvitations(params);
  }

  issueTenantInvitation(
    params: AuthTenantIssueInvitationParams,
  ): Promise<AuthTenantIssueInvitationResult> {
    return this.tenantOnboarding.issueInvitation(params);
  }

  revokeTenantInvitation(invitationId: string) {
    return this.tenantOnboarding.revokeInvitation(invitationId);
  }

  listTenantJoinRequests(
    params: AuthTenantJoinRequestListParams = {},
  ): Promise<AuthTenantJoinRequestPage> {
    return this.tenantOnboarding.listJoinRequests(params);
  }

  approveTenantJoinRequest(
    joinRequestId: string,
    params: AuthTenantReviewJoinRequestParams,
  ) {
    return this.tenantOnboarding.approveJoinRequest(joinRequestId, params);
  }

  denyTenantJoinRequest(
    joinRequestId: string,
    params: AuthTenantDenyJoinRequestParams,
  ) {
    return this.tenantOnboarding.denyJoinRequest(joinRequestId, params);
  }

  getTenantDomainAdministration(signal?: AbortSignal): Promise<AuthTenantDomainAdministration> {
    return this.tenantDomains.getAdministration(signal);
  }

  createTenantDomainClaim(domain: string): Promise<AuthTenantDomainChallengeResult> {
    return this.tenantDomains.createClaim(domain);
  }

  issueTenantDomainChallenge(
    claimId: string,
    expectedRevision: string,
  ): Promise<AuthTenantDomainChallengeResult> {
    return this.tenantDomains.issueChallenge(claimId, expectedRevision);
  }

  verifyTenantDomainClaim(
    claimId: string,
    expectedRevision: string,
  ): Promise<AuthTenantDomainClaimResult> {
    return this.tenantDomains.verifyClaim(claimId, expectedRevision);
  }

  updateTenantDomainPolicy(
    claimId: string,
    update: AuthTenantDomainPolicyUpdate,
  ): Promise<AuthTenantDomainClaimResult> {
    return this.tenantDomains.updatePolicy(claimId, update);
  }

  releaseTenantDomainClaim(
    claimId: string,
    input: AuthTenantDomainReleaseInput,
  ): Promise<AuthTenantDomainReleaseResult> {
    return this.tenantDomains.releaseClaim(claimId, input);
  }

  startDomainOnboarding(identityContinuation?: string): Promise<{ accepted: true }> {
    return this.domainOnboarding.start(identityContinuation);
  }

  completeDomainOnboarding(proofToken: string): Promise<AuthDomainOnboardingCompletion> {
    return this.domainOnboarding.complete(proofToken);
  }

  admitDomainOnboarding(
    continuation: string,
    identityContinuation?: string,
  ): Promise<AuthDomainOnboardingAdmissionResult> {
    return this.domainOnboarding.admit(continuation, identityContinuation);
  }

  logout(): Promise<void> {
    return this.runScopeChangingOperation((consumeStartingScope) => (
      this.session.logout(consumeStartingScope)
    ));
  }

  expireSession(): void {
    this.session.expireSession();
  }

  refresh(): Promise<boolean> {
    const attempt = this.beginAuthorizationScopeAttempt();
    let startingScopeConsumed = false;
    const consumeStartingScope = () => {
      attempt.assertCurrent();
      startingScopeConsumed = true;
      attempt.dispose();
    };
    return this.session.refresh(attempt.assertCurrent, consumeStartingScope)
      .then((result) => {
        if (!startingScopeConsumed) attempt.assertCurrent();
        return result;
      })
      .finally(() => attempt.dispose());
  }

  /** Retry a committed transition's local Sync baseline reconciliation. */
  reconcileSession(): Promise<void> {
    return this.session.reconcileSession();
  }

  /**
   * Fence a credential-issuing request to the browser scope in which it
   * started. The final assertion is repeated inside the credential lock by
   * AuthSessionController before any session state can be replaced.
   */
  private beginAuthenticationAttempt(markLoading = true): AuthAuthenticationAttempt {
    const attempt = this.beginAuthorizationScopeAttempt();
    if (markLoading) this.session.beginAuthentication();
    return attempt;
  }

  private async runAuthorizationScopeOperation<T>(
    operation: (attempt: AuthAuthenticationAttempt) => Promise<T>,
  ): Promise<T> {
    const attempt = this.beginAuthorizationScopeAttempt();
    try {
      attempt.assertCurrent();
      const result = await operation(attempt);
      attempt.assertCurrent();
      return result;
    } finally {
      attempt.dispose();
    }
  }

  private async runScopeChangingOperation<T>(
    operation: (consumeStartingScope: () => void) => Promise<T>,
  ): Promise<T> {
    const attempt = this.beginAuthorizationScopeAttempt();
    const consumeStartingScope = () => {
      attempt.assertCurrent();
      // The operation now owns the lifecycle transition, so its preflight
      // request must no longer cancel itself when beginTransition() runs.
      attempt.dispose();
    };
    try {
      return await operation(consumeStartingScope);
    } finally {
      attempt.dispose();
    }
  }

  private beginAuthorizationScopeAttempt(): AuthAuthenticationAttempt {
    const lifecycle = this.options.authorizationScopeLifecycle;
    const epoch = lifecycle?.beginRequest();
    const sessionScope = this.session.captureAuthorizationScope();
    const assertCurrent = () => {
      if (epoch !== undefined && lifecycle) lifecycle.assertRequestCurrent(epoch);
      this.session.assertAuthorizationScopeCurrent(sessionScope);
    };
    const controller = new AbortController();
    const unregisterCancellation = epoch !== undefined && lifecycle
      ? lifecycle.registerRequestCancellation?.(epoch, () => {
        try {
          assertCurrent();
        } catch (error) {
          controller.abort(error);
          return;
        }
        controller.abort();
      }) ?? (() => {})
      : () => {};
    let disposed = false;

    return {
      signal: controller.signal,
      assertCurrent,
      dispose() {
        if (disposed) return;
        disposed = true;
        unregisterCancellation();
      },
    };
  }

  private assertAuthenticatedResponseCurrent(response: Response): void {
    authenticatedResponseScopeAssertions.get(response)?.();
  }

  async fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    const requestUrl = resolveAuthRequestUrl(this.baseUrl, url);
    const guarded = await this.requestWithAuthTransport(async (
      accessToken,
      assertCurrent,
      authorizationScopeSignal,
    ) => {
      assertCurrent();
      const headers = new Headers(init?.headers);
      if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
      const composed = composeAuthorizationScopeSignal(
        init?.signal,
        authorizationScopeSignal,
      );
      try {
        const response = await fetch(requestUrl, {
          ...init,
          headers,
          signal: composed.signal,
        });
        assertCurrent();
        const scopedResponse = guardResponseAuthorizationScope(response, assertCurrent);
        authenticatedResponseScopeAssertions.set(scopedResponse, assertCurrent);
        return {
          status: response.status,
          response: scopedResponse,
        };
      } finally {
        composed.dispose();
      }
    });
    return guarded.response;
  }

  async fetchWithOptionalAuth(url: string, init?: RequestInit): Promise<Response> {
    const requestUrl = resolveAuthRequestUrl(this.baseUrl, url);
    const attempt = this.beginAuthorizationScopeAttempt();
    const composed = composeAuthorizationScopeSignal(init?.signal, attempt.signal);

    try {
      attempt.assertCurrent();
      const headers = new Headers(init?.headers);
      if (this.session.accessToken && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${this.session.accessToken}`);
      }
      const response = await fetch(requestUrl, {
        ...init,
        headers,
        signal: composed.signal,
      });
      attempt.assertCurrent();
      const scopedResponse = guardResponseAuthorizationScope(
        response,
        attempt.assertCurrent,
      );
      authenticatedResponseScopeAssertions.set(scopedResponse, attempt.assertCurrent);
      return scopedResponse;
    } finally {
      composed.dispose();
      attempt.dispose();
    }
  }

  /**
   * @internal Run a non-fetch browser transport with the same restoration,
   * refresh, retry, and authorization-scope guarantees as fetchWithAuth().
   */
  async requestWithAuthTransport<T extends AuthenticatedTransportResult>(
    request: (
      accessToken: string | null,
      assertAuthorizationScopeCurrent: () => void,
      authorizationScopeSignal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    const scopeAttempt = this.beginAuthorizationScopeAttempt();
    const assertCurrent = scopeAttempt.assertCurrent;
    let startingScopeConsumed = false;
    const assertResponseCurrent = () => {
      if (!startingScopeConsumed) assertCurrent();
    };
    const consumeStartingScope = () => {
      assertCurrent();
      startingScopeConsumed = true;
      scopeAttempt.dispose();
    };

    try {
      const result = await this.session.requestWithAuth(async (accessToken) => {
        assertResponseCurrent();
        const attempt = await request(
          accessToken,
          assertResponseCurrent,
          scopeAttempt.signal,
        );
        assertResponseCurrent();
        return attempt;
      }, consumeStartingScope);
      assertResponseCurrent();
      return result;
    } finally {
      scopeAttempt.dispose();
    }
  }

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.account.changePassword(currentPassword, newPassword);
  }

  setProperty(key: string, value: unknown): Promise<void> {
    return this.properties.setProperty(key, value);
  }

  getProperty(key: string): Promise<string | null> {
    return this.properties.getProperty(key);
  }

  getProperties(): Promise<Record<string, string>> {
    return this.properties.getProperties();
  }

  deleteProperty(key: string): Promise<void> {
    return this.properties.deleteProperty(key);
  }

  subscribe(callback: () => void): () => void {
    return this.session.subscribe(callback);
  }

  /** @internal Release cross-tab listeners when the SDK client disconnects. */
  dispose(): void {
    this.authorizationController.dispose();
    this.session.dispose();
  }

  getAdminConfig(): Promise<AuthAdminConfig> {
    return this.admin.getAdminConfig();
  }

  listAdminUsers(
    params: AuthAdminUserListParams = {},
  ): Promise<AuthAdminUserListResult> {
    return this.admin.listAdminUsers(params);
  }

  getAdminUser(userId: string): Promise<AuthUser> {
    return this.admin.getAdminUser(userId);
  }

  createAdminUser(
    params: AuthAdminCreateUserParams,
  ): Promise<{ user: AuthUser; setupEmailSent: boolean }> {
    return this.admin.createAdminUser(params);
  }

  updateAdminUser(userId: string, params: AuthAdminUpdateUserParams): Promise<AuthUser> {
    return this.admin.updateAdminUser(userId, params);
  }

  setAdminUserProperty(userId: string, key: string, value: unknown): Promise<void> {
    return this.admin.setAdminUserProperty(userId, key, value);
  }

  deleteAdminUserProperty(userId: string, key: string): Promise<void> {
    return this.admin.deleteAdminUserProperty(userId, key);
  }

  deleteAdminUser(userId: string): Promise<void> {
    return this.admin.deleteAdminUser(userId);
  }

  sendAdminSetupEmail(userId: string): Promise<boolean> {
    return this.admin.sendAdminSetupEmail(userId);
  }

  sendAdminPasswordReset(userId: string): Promise<void> {
    return this.admin.sendAdminPasswordReset(userId);
  }

  clearAdminPasswordChangeRequirement(userId: string): Promise<AuthUser> {
    return this.admin.clearAdminPasswordChangeRequirement(userId);
  }

  resetAdminPassword(userId: string, password: string): Promise<void> {
    return this.admin.resetAdminPassword(userId, password);
  }

  suspendAdminUser(userId: string): Promise<AuthUser> {
    return this.admin.suspendAdminUser(userId);
  }

  activateAdminUser(userId: string): Promise<AuthUser> {
    return this.admin.activateAdminUser(userId);
  }

  revokeAdminUserSessions(userId: string): Promise<void> {
    return this.admin.revokeAdminUserSessions(userId);
  }

  getAdminUserMfa(userId: string): Promise<AuthAdminUserMfaStatus> {
    return this.admin.getAdminUserMfa(userId);
  }

  requireAdminUserMfa(userId: string): Promise<AuthUser> {
    return this.admin.requireAdminUserMfa(userId);
  }

  clearAdminUserMfaRequirement(userId: string): Promise<AuthUser> {
    return this.admin.clearAdminUserMfaRequirement(userId);
  }

  resetAdminUserMfa(userId: string): Promise<AuthAdminMfaResetResult> {
    return this.admin.resetAdminUserMfa(userId);
  }

  sendAdminVerificationEmail(userId: string): Promise<void> {
    return this.admin.sendAdminVerificationEmail(userId);
  }

  verifyAdminUserEmail(userId: string): Promise<AuthUser> {
    return this.admin.verifyAdminUserEmail(userId);
  }
}
