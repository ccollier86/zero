import type { ReactiveDB } from '../sync/reactive-db';

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
  email: string;
  role: string;
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
  /** Send notification email after password changes. Default: false. */
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
  description?: string;
}

/** Developer-authored auth behavior config. */
export interface AuthBehaviorConfig {
  /** Public registration and first-user bootstrap behavior. */
  registration?: AuthRegistrationConfig;
  /** Account lifecycle email behavior. */
  accountEmails?: AuthAccountEmailConfig;
  /** Configured user key/value property fields. */
  userProperties?: Record<string, UserPropertyFieldConfig>;
  /** Whether unknown current-user property writes should be rejected. Default: false. */
  strictUserProperties?: boolean;
}

/** Normalized auth behavior config used by backend services and routes. */
export interface ResolvedAuthBehaviorConfig {
  registration: {
    mode: AuthRegistrationMode;
  };
  accountEmails: ResolvedAuthAccountEmailConfig;
  userProperties: Record<string, ResolvedUserPropertyFieldConfig>;
  strictUserProperties: boolean;
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
