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

// ─── Configuration ─────────────────────────────────────────────────────────

/**
 * Configuration for createAuthPlugin().
 */
export interface AuthPluginConfig {
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
