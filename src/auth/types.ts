import type { ReactiveDB } from '../sync/reactive-db';
import type {
  AuthEmailBrandingConfig,
  AuthEmailTemplates,
} from './auth-email-templates';
import type { NativeAuthConfig, ResolvedNativeAuthConfig } from './native/types';

// ─── Auth Context ──────────────────────────────────────────────────────────

/**
 * Derived by auth middleware on every request.
 * Available to all route handlers via Elysia context.
 * `null` when the request has no valid Bearer token.
 */
export interface AuthContext {
  userId: string;
  email: string;
  role: string;
  /** Present when the bearer was issued to a registered native public client. */
  clientId?: string;
  /** Browser access remains `web`; native OIDC access is explicitly attributed. */
  sessionKind?: 'web' | 'native';
  /** OIDC identity scopes only; app permissions still come from Zero policy. */
  scope?: readonly string[];
  /** Opaque native refresh-family id. Present only for native app sessions. */
  sessionId?: string;
}

// ─── User Record ───────────────────────────────────────────────────────────

/** Account status enforced by login, refresh, and admin lifecycle routes. */
export type UserStatus = 'active' | 'suspended';

/**
 * Public user record — safe to expose (no password hash).
 * Maps from the `users` table + joined `user_properties`.
 */
export interface UserRecord {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: UserStatus;
  passwordChangeRequired: boolean;
  emailVerifiedAt: number | null;
  emailVerificationRequired: boolean;
  mfaRequired: boolean;
  createdAt: number;
  updatedAt: number | null;
  properties: Record<string, string>;
}

// ─── Token Types ───────────────────────────────────────────────────────────

/**
 * Token pair returned from login/register/refresh.
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Payload extracted from a verified access token (JWT claims).
 */
export interface AccessTokenPayload {
  sub: string;
  /** Legacy web tokens carry identity; native tokens hydrate it from UserStore. */
  email?: string;
  role?: string;
  /** Per-user security generation used to durably invalidate bearer tokens. */
  authGeneration: number;
  clientId?: string;
  sessionKind?: 'native';
  scope?: readonly string[];
  audience?: string;
  jti?: string;
  /** OIDC `sid`, bound to a live native refresh-token family. */
  sessionId?: string;
}

/** Short-lived auth transition token purpose. */
export type AuthTransitionPurpose = 'mfa_setup' | 'mfa_challenge';

/**
 * Payload extracted from a verified transition token.
 *
 * Transition tokens are not app sessions. They are used only by auth routes
 * while a user is completing MFA setup or an MFA login challenge.
 */
export interface AuthTransitionTokenPayload {
  sub: string;
  email: string;
  role: string;
  /** Per-user security generation used to invalidate unfinished auth flows. */
  authGeneration: number;
  purpose: AuthTransitionPurpose;
  methodId?: string;
  methodType?: AuthMfaMethodType;
  challengeId?: string;
  flow?: 'auth' | 'profile';
}

/**
 * Refresh token record from the `_refresh_tokens` table.
 */
export interface RefreshTokenRecord {
  tokenId: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
  revokedAt: number | null;
}

/** One-time auth action token purpose. */
export type AuthActionTokenType =
  | 'account_setup'
  | 'password_reset'
  | 'admin_password_reset'
  | 'email_verification';

/** Internal hashed auth action token record. Raw tokens are never stored. */
export interface AuthActionTokenRecord {
  tokenId: string;
  userId: string;
  type: AuthActionTokenType;
  tokenHash: string;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
  createdBy: string | null;
  metadata: Record<string, unknown>;
}

// ─── MFA Types ────────────────────────────────────────────────────────────

/** MFA methods supported by Zero core. */
export type AuthMfaMethodType = 'email' | 'totp';

/** MFA enforcement policy configured by the app. */
export type AuthMfaPolicy = 'optional' | 'required' | 'admin-required';

/** Lifecycle state for an enrolled MFA method. */
export type AuthMfaMethodStatus = 'pending' | 'active' | 'disabled';

/** QR error correction level used when rendering authenticator setup. */
export type AuthMfaQrRobustness = 'L' | 'M' | 'Q' | 'H';

/** Stored MFA method metadata. Secrets are never exposed by public routes. */
export interface AuthMfaMethodRecord {
  methodId: string;
  userId: string;
  type: AuthMfaMethodType;
  label: string | null;
  status: AuthMfaMethodStatus;
  isPrimary: boolean;
  secretCiphertext: string | null;
  createdAt: number;
  verifiedAt: number | null;
  disabledAt: number | null;
  lastUsedAt: number | null;
  metadata: Record<string, unknown>;
}

/** Stored MFA challenge metadata. OTP code hashes are never exposed publicly. */
export interface AuthMfaChallengeRecord {
  challengeId: string;
  userId: string;
  methodId: string | null;
  methodType: AuthMfaMethodType;
  codeHash: string | null;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  consumedAt: number | null;
  createdAt: number;
  metadata: Record<string, unknown>;
}

// ─── Configuration ─────────────────────────────────────────────────────────

/** Public registration mode after the first-user bootstrap account exists. */
export type AuthRegistrationMode = 'public' | 'admin-only' | 'disabled';

/** Configuration for public registration and first-user bootstrap. */
export interface AuthRegistrationConfig {
  /** Public registration mode after bootstrap. Default: 'public'. */
  mode?: AuthRegistrationMode;
}

/** Auth/account lifecycle email switches. */
export interface AuthAccountEmailConfig {
  /** Send setup links for admin-created accounts when possible. Default: false. */
  adminCreatedUser?: boolean;
  /** Enable user/admin password reset email flows. Default: true. */
  passwordReset?: boolean;
  /**
   * @deprecated Reserved for a future committed password-change notification
   * flow. Configured values currently normalize to false.
   */
  passwordChangedNotice?: boolean;
  /** Allow direct admin password replacement. Default: true for compatibility. */
  manualPasswordReset?: boolean;
  /** One-time action token TTL. Supports `s`, `m`, `h`, and `d`. Default: '1h'. */
  actionTokenTTL?: string;
  /** Cooldown between active action emails for the same user/type. Default: '5m'. */
  requestCooldown?: string;
  /** Public reset page path appended to app.publicUrl. Default: '/reset-password'. */
  resetPath?: string;
  /** Public setup page path appended to app.publicUrl. Default: '/setup-password'. */
  setupPath?: string;
}

/** Normalized auth/account lifecycle email switches. */
export interface ResolvedAuthAccountEmailConfig {
  adminCreatedUser: boolean;
  passwordReset: boolean;
  passwordChangedNotice: boolean;
  manualPasswordReset: boolean;
  actionTokenTTL: string;
  requestCooldown: string;
  resetPath: string;
  setupPath: string;
}

/** Account lifecycle policy that affects whether users can receive sessions. */
export interface AuthAccountConfig {
  /** Require public-registered users to verify email before receiving tokens. Default: false. */
  requireEmailVerification?: boolean;
  /** Public email verification page path appended to app.publicUrl. Default: '/verify-email'. */
  emailVerificationPath?: string;
  /** Allow admins to mark another user's email verified without a token. Default: false. */
  allowAdminMarkEmailVerified?: boolean;
}

/** Normalized account lifecycle policy. */
export interface ResolvedAuthAccountConfig {
  requireEmailVerification: boolean;
  emailVerificationPath: string;
  allowAdminMarkEmailVerified: boolean;
}

/** Authenticator/TOTP configuration for Zero's self-hosted MFA method. */
export interface AuthMfaTotpConfig {
  /** Issuer shown in authenticator apps. Defaults to app.name. */
  issuer?: string;
  /** Secret used to encrypt authenticator seeds at rest. */
  encryptionKey?: string;
  /** QR error correction level for authenticator setup codes. Default: 'M'. */
  qrRobustness?: AuthMfaQrRobustness;
}

/** Developer-authored MFA behavior config. */
export interface AuthMfaConfig {
  /** Enable MFA features. Default: false. */
  enabled?: boolean;
  /** Global MFA enforcement policy. Default: 'optional'. */
  policy?: AuthMfaPolicy;
  /** Allowed MFA methods. Default: ['email', 'totp']. */
  methods?: AuthMfaMethodType[];
  /** Let users pick email or authenticator during enrollment. Default: true. */
  allowUserChoice?: boolean;
  /** Allow multiple active methods per user. Default: false for v1 simplicity. */
  allowMultipleMethods?: boolean;
  /** Remember-device support is reserved for a later MFA slice. Default: false. */
  rememberDevice?: boolean;
  /** MFA challenge TTL. Supports `s`, `m`, `h`, and `d`. Default: '10m'. */
  challengeTTL?: string;
  /** Cooldown between email OTP challenge sends. Default: '1m'. */
  challengeCooldown?: string;
  /** Maximum verification attempts per challenge. Default: 5. */
  maxAttempts?: number;
  /** Recovery-code support is reserved for a later MFA slice. Default: false. */
  recoveryCodes?: boolean;
  /** Self-hosted authenticator/TOTP settings. */
  totp?: AuthMfaTotpConfig;
}

/** Normalized authenticator/TOTP configuration. */
export interface ResolvedAuthMfaTotpConfig {
  issuer?: string;
  encryptionKey?: string;
  qrRobustness: AuthMfaQrRobustness;
}

/** Normalized MFA behavior config. */
export interface ResolvedAuthMfaConfig {
  enabled: boolean;
  policy: AuthMfaPolicy;
  methods: AuthMfaMethodType[];
  allowUserChoice: boolean;
  allowMultipleMethods: boolean;
  rememberDevice: boolean;
  challengeTTL: string;
  challengeCooldown: string;
  maxAttempts: number;
  recoveryCodes: boolean;
  totp: ResolvedAuthMfaTotpConfig;
}

/** Supported configured user property field types. */
export type UserPropertyFieldType = 'string' | 'enum' | 'boolean' | 'number';

/** Which actor may edit a configured user property field. */
export type UserPropertyEditableBy = 'user' | 'admin' | 'system' | 'none';

/** Developer-authored config for one user key/value property. */
export interface UserPropertyFieldConfig {
  /** Field value type used for validation and admin UI controls. */
  type?: UserPropertyFieldType;
  /** Optional admin/profile UI label. */
  label?: string;
  /** Allowed values for enum fields. */
  values?: string[];
  /** Default value applied on user creation and optional lazy backfill. */
  default?: string | number | boolean;
  /** Who may update this field through platform routes. Default: 'user'. */
  editableBy?: UserPropertyEditableBy;
  /**
   * Whether backend authorization policies may use this property as a trusted
   * claim. Only admin/system/none-editable fields may opt in.
   */
  useInPolicies?: boolean;
  /** Optional admin/profile UI helper text. */
  description?: string;
}

/** Normalized user property field config. */
export interface ResolvedUserPropertyFieldConfig {
  key: string;
  type: UserPropertyFieldType;
  label?: string;
  values?: string[];
  default?: string;
  editableBy: UserPropertyEditableBy;
  useInPolicies: boolean;
  description?: string;
}

/** Developer-authored auth behavior config. */
export interface AuthBehaviorConfig {
  /** Public registration and first-user bootstrap behavior. */
  registration?: AuthRegistrationConfig;
  /** Account lifecycle policy that affects token issuance. */
  account?: AuthAccountConfig;
  /** MFA policy and enabled methods. */
  mfa?: AuthMfaConfig;
  /** Account lifecycle email behavior. */
  accountEmails?: AuthAccountEmailConfig;
  /** Branding values used by auth pages and auth/account lifecycle emails. */
  branding?: AuthEmailBrandingConfig;
  /** App-authored auth email template overrides. */
  emails?: AuthEmailTemplates;
  /** Configured user key/value property fields. */
  userProperties?: Record<string, UserPropertyFieldConfig>;
  /** Whether unknown current-user property writes should be rejected. Default: false. */
  strictUserProperties?: boolean;
  /** Registered desktop/mobile public clients using OIDC Authorization Code + PKCE. */
  nativeApps?: NativeAuthConfig;
}

/** Normalized auth behavior config used by backend services and routes. */
export interface ResolvedAuthBehaviorConfig {
  registration: {
    mode: AuthRegistrationMode;
  };
  account: ResolvedAuthAccountConfig;
  mfa: ResolvedAuthMfaConfig;
  accountEmails: ResolvedAuthAccountEmailConfig;
  branding: AuthEmailBrandingConfig;
  emails: AuthEmailTemplates;
  userProperties: Record<string, ResolvedUserPropertyFieldConfig>;
  strictUserProperties: boolean;
  nativeApps: ResolvedNativeAuthConfig;
}

/**
 * Configuration for createAuthPlugin().
 */
export interface AuthPluginConfig extends AuthBehaviorConfig {
  /** Shared ReactiveDB instance — auth defines its tables here */
  db: ReactiveDB;

  /** Access token TTL in jose duration format (default: '15m') */
  accessTokenTTL?: string;

  /** Refresh token TTL in jose duration format (default: '7d') */
  refreshTokenTTL?: string;

  /** Canonical native OIDC issuer, supplied by createApp from app.publicUrl. */
  nativeIssuer?: string;

  /** Audience required by native JWT access tokens. */
  nativeAudience?: string;

  /** App login route used by the external-browser authorization flow. */
  loginPath?: string;

  /** App registration route used when native authorization requests sign-up. */
  registrationPath?: string;
}

/**
 * Configuration for TokenService.create().
 */
export interface TokenServiceConfig {
  /** Shared ReactiveDB — for _auth_config and _refresh_tokens access */
  db: ReactiveDB;

  /** Access token TTL (default: '15m') */
  accessTokenTTL?: string;

  /** Refresh token TTL (default: '7d') */
  refreshTokenTTL?: string;

  /** Canonical issuer and audience accepted for native access tokens. */
  nativeIssuer?: string;
  nativeAudience?: string;
}

// ─── Error ─────────────────────────────────────────────────────────────────

/**
 * Structured error for auth operations.
 * Provides machine-readable code + HTTP status.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ─── Constants ─────────────────────────────────────────────────────────────

export const AUTH_DEFAULTS = {
  accessTokenTTL: '15m',
  refreshTokenTTL: '7d',
  accessTokenTTLEnvKey: 'ACCESS_TOKEN_TTL',
  refreshTokenTTLEnvKey: 'REFRESH_TOKEN_TTL',
  signingKeyEnvKey: 'AUTH_SIGNING_KEY',
} as const;
