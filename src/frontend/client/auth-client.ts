/**
 * Stable browser auth façade for Zero.
 *
 * Route families, session state, and public contracts live in focused modules;
 * this class composes them while preserving the established AuthClient API.
 */

import { AuthAccountTransport } from './auth-account-transport';
import { AuthActionTransport } from './auth-action-transport';
import { AuthAdminTransport } from './auth-admin-transport';
import { AuthClientError, createAuthClientError } from './auth-errors';
import { AuthMfaTransport } from './auth-mfa-transport';
import { AuthPropertyTransport } from './auth-property-transport';
import { AuthSessionController } from './auth-session';
import type { AuthStore } from './auth-store';
import type {
  AuthActionTokenInfo,
  AuthCompletionResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthPasswordUpdatedResult,
  AuthPublicConfig,
  AuthSessionResult,
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
export type { AuthStore } from './auth-store';
export type {
  AuthActionTokenInfo,
  AuthCompletionResult,
  AuthMfaChallenge,
  AuthMfaChallengeRequiredResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupRequiredResult,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthPasswordUpdatedResult,
  AuthPublicConfig,
  AuthSessionResult,
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

/**
 * Manages browser authentication state and delegates route families to focused
 * transports. Access tokens remain in memory; refresh tokens are persisted and
 * rotated by the session controller.
 */
export class AuthClient {
  readonly store: AuthStore;
  private readonly session: AuthSessionController;
  private readonly account: AuthAccountTransport;
  private readonly actions: AuthActionTransport;
  private readonly mfa: AuthMfaTransport;
  private readonly properties: AuthPropertyTransport;
  private readonly admin: AuthAdminTransport;

  constructor(baseUrl: string) {
    this.session = new AuthSessionController(baseUrl);
    this.store = this.session.store;

    this.account = new AuthAccountTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.session.fetchWithAuth(url, init),
      beginAuthentication: () => this.session.beginAuthentication(),
      failAuthentication: (message) => this.session.failAuthentication(message),
      completeAuthentication: (result) => this.session.completeAuthentication(result),
      updateTokens: (accessToken, refreshToken) => {
        this.session.updateTokens(accessToken, refreshToken);
      },
    });
    this.actions = new AuthActionTransport({
      baseUrl,
      beginAuthentication: () => this.session.beginAuthentication(),
      failAuthentication: (message) => this.session.failAuthentication(message),
      completeAuthentication: (result) => this.session.completeAuthentication(result),
    });
    this.mfa = new AuthMfaTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.session.fetchWithAuth(url, init),
      optionalAuthenticatedFetch: (url, init) => {
        return this.session.fetchWithOptionalAuth(url, init);
      },
      completeAuthentication: (result) => this.session.completeAuthentication(result),
    });
    this.properties = new AuthPropertyTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.session.fetchWithAuth(url, init),
      patchProperties: (values) => this.session.patchProperties(values),
      replaceProperties: (values) => this.session.replaceProperties(values),
      removeProperty: (key) => this.session.deleteProperty(key),
    });
    this.admin = new AuthAdminTransport({
      baseUrl,
      authenticatedFetch: (url, init) => this.session.fetchWithAuth(url, init),
      createResponseError: createAuthClientError,
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

  get isLoading(): boolean {
    return this.session.isLoading;
  }

  get isRestoring(): boolean {
    return this.session.isRestoring;
  }

  get error(): string | null {
    return this.session.error;
  }

  get accessToken(): string | null {
    return this.session.accessToken;
  }

  login(username: string, password: string): Promise<AuthCompletionResult> {
    return this.account.login(username, password);
  }

  register(params: RegisterParams): Promise<AuthCompletionResult> {
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
    return this.actions.inspectActionToken(token);
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
  }): Promise<AuthSessionResult> {
    return this.mfa.verifyMfaChallenge(params);
  }

  logout(): Promise<void> {
    return this.session.logout();
  }

  expireSession(): void {
    this.session.expireSession();
  }

  refresh(): Promise<boolean> {
    return this.session.refresh();
  }

  fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    return this.session.fetchWithAuth(url, init);
  }

  fetchWithOptionalAuth(url: string, init?: RequestInit): Promise<Response> {
    return this.session.fetchWithOptionalAuth(url, init);
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
