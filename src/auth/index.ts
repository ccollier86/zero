// ─── Auth Plugin ──────────────────────────────────────────────────────────
export { createAuthPlugin, getAuthStore, getTokenService } from './auth.plugin';
export { createAuthMiddleware } from './auth.middleware';

// ─── Services ─────────────────────────────────────────────────────────────
export { UserStore } from './user-store';
export { TokenService } from './token-service';

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  AuthContext,
  UserRecord,
  TokenPair,
  AccessTokenPayload,
  RefreshTokenRecord,
  AuthPluginConfig,
  TokenServiceConfig,
} from './types';

export { AuthError, AUTH_DEFAULTS } from './types';
