/**
 * auth-admin-types.ts
 *
 * Public browser contracts for Zero's administrator-facing auth API. These
 * types describe transport payloads and the top-level SDK surface only; route
 * execution lives in auth-admin-transport.ts and auth session state remains in
 * auth-client.ts.
 */

import type {
  AuthMfaMethod,
  AuthPublicConfig,
  AuthUser,
  AuthUserPropertyConfig,
} from './auth-types';

export interface AuthAdminConfig {
  /** Present on current servers; optional for compatibility with older payloads. */
  tenancy?: AuthPublicConfig['tenancy'];
  /** Present on current servers; optional for compatibility with older payloads. */
  authorization?: AuthPublicConfig['authorization'];
  /** Present on current servers; optional for compatibility with older payloads. */
  bootstrap?: AuthPublicConfig['bootstrap'];
  registration: AuthPublicConfig['registration'];
  email: {
    enabled: boolean;
    provider: string;
    hasPublicUrl: boolean;
  };
  accountEmails: {
    adminCreatedUser: boolean;
    passwordReset: boolean;
    passwordChangedNotice: boolean;
    emailVerification?: boolean;
    manualPasswordReset: boolean;
    actionTokenTTL: string;
    requestCooldown: string;
    resetPath: string;
    setupPath: string;
  };
  account: {
    requireEmailVerification: boolean;
    emailVerificationPath: string;
    emailVerificationReady: boolean;
    allowAdminMarkEmailVerified: boolean;
  };
  mfa?: AuthPublicConfig['mfa'] & {
    challengeTTL: string;
    challengeCooldown: string;
    maxAttempts: number;
    totp: {
      issuer?: string;
      qrRobustness: 'L' | 'M' | 'Q' | 'H';
      encryptionConfigured: boolean;
      ready: boolean;
    };
    emailOtpReady: boolean;
  };
  capabilities: {
    manualPasswordReset: boolean;
    setupEmail: boolean;
    passwordResetEmail: boolean;
    emailVerification: boolean;
    adminMarkEmailVerified: boolean;
    mfa: boolean;
    suspendUsers: boolean;
    promoteAdmins: boolean;
    userProperties: boolean;
  };
  userProperties: Record<string, AuthAdminUserPropertyConfig>;
  strictUserProperties: boolean;
}

export interface AuthAdminUserPropertyConfig extends AuthUserPropertyConfig {}

export interface AuthAdminUserListParams {
  limit?: number;
  offset?: number;
  search?: string;
  role?: string;
  status?: AuthUser['status'];
}

export interface AuthAdminUserPage {
  limit: number;
  offset: number;
  count: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface AuthAdminUserListResult {
  users: AuthUser[];
  page: AuthAdminUserPage;
}

export type AuthAdminMfaRequirement = 'user' | 'global' | 'admin-role' | 'none';

/** Public-safe MFA state returned to an administrator for one user. */
export interface AuthAdminUserMfaStatus {
  methods: AuthMfaMethod[];
  required: boolean;
  requirement: AuthAdminMfaRequirement;
}

/** Result of removing a user's enrolled and pending MFA state. */
export interface AuthAdminMfaResetResult {
  ok: true;
  deletedMethods: number;
  invalidatedChallenges: number;
}

export interface AuthAdminCreateUserParams {
  username: string;
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  passwordChangeRequired?: boolean;
  mfaRequired?: boolean;
  sendSetupEmail?: boolean;
  properties?: Record<string, unknown>;
}

export interface AuthAdminUpdateUserParams {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: AuthUser['status'];
  passwordChangeRequired?: boolean;
  mfaRequired?: boolean;
  properties?: Record<string, unknown>;
}

/** Admin-auth methods exposed by the top-level Zero SDK client. */
export interface AuthAdminSdkSurface {
  /** Load admin-only auth/user-management config. Requires an admin user. */
  getAuthAdminConfig(): Promise<AuthAdminConfig>;

  /** List users through the admin auth API. Requires an admin user. */
  listAuthAdminUsers(params?: AuthAdminUserListParams): Promise<AuthAdminUserListResult>;

  /** Load one user through the admin auth API. Requires an admin user. */
  getAuthAdminUser(userId: string): Promise<AuthUser>;

  /** Create a user through the admin auth API. Requires an admin user. */
  createAuthAdminUser(
    params: AuthAdminCreateUserParams,
  ): Promise<{ user: AuthUser; setupEmailSent: boolean }>;

  /** Update a user through the admin auth API. Requires an admin user. */
  updateAuthAdminUser(userId: string, params: AuthAdminUpdateUserParams): Promise<AuthUser>;

  /** Set or replace one user property through the admin auth API. */
  setAuthAdminUserProperty(userId: string, key: string, value: unknown): Promise<void>;

  /** Delete one user property through the admin auth API. */
  deleteAuthAdminUserProperty(userId: string, key: string): Promise<void>;

  /** Delete a user through the admin auth API. Requires an admin user. */
  deleteAuthAdminUser(userId: string): Promise<void>;

  /** Send an account setup email for an admin-created user. */
  sendAuthAdminSetupEmail(userId: string): Promise<boolean>;

  /** Send a password reset email for a user. */
  sendAuthAdminPasswordReset(userId: string): Promise<void>;

  /** Clear another user's existing password-change gate as a recovery action. */
  clearAuthAdminPasswordChangeRequirement(userId: string): Promise<AuthUser>;

  /** Directly replace a user's password when manual admin reset is enabled. */
  resetAuthAdminPassword(userId: string, password: string): Promise<void>;

  /** Suspend a user and revoke their sessions. */
  suspendAuthAdminUser(userId: string): Promise<AuthUser>;

  /** Reactivate a suspended user. */
  activateAuthAdminUser(userId: string): Promise<AuthUser>;

  /** Revoke all active refresh tokens for a user. */
  revokeAuthAdminUserSessions(userId: string): Promise<void>;

  /** Load public-safe MFA status for one user. */
  getAuthAdminUserMfa(userId: string): Promise<AuthAdminUserMfaStatus>;

  /** Require MFA for one user and invalidate existing sessions. */
  requireAuthAdminUserMfa(userId: string): Promise<AuthUser>;

  /** Clear the per-user MFA requirement and invalidate existing sessions. */
  clearAuthAdminUserMfaRequirement(userId: string): Promise<AuthUser>;

  /** Reset enrolled MFA methods and pending challenges for one user. */
  resetAuthAdminUserMfa(userId: string): Promise<AuthAdminMfaResetResult>;

  /** Send an email-verification link to one user. */
  sendAuthAdminVerificationEmail(userId: string): Promise<void>;

  /** Mark a user email verified when the app explicitly permits the override. */
  verifyAuthAdminUserEmail(userId: string): Promise<AuthUser>;
}
