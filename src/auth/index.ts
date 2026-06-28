// ─── Auth Plugin ──────────────────────────────────────────────────────────
export { createAuthPlugin, getAuthStore, getTokenService } from './auth.plugin';
export { createAuthMiddleware } from './auth.middleware';

// ─── Services ─────────────────────────────────────────────────────────────
export { UserStore } from './user-store';
export { TokenService } from './token-service';
export { AuthActionTokenService } from './action-token-service';
export { AccountEmailService } from './account-email-service';
export { defineAuthConfig, resolveAuthBehaviorConfig } from './auth-config';
export { UserPropertyService } from './user-property-service';

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  AuthContext,
  UserRecord,
  TokenPair,
  AccessTokenPayload,
  RefreshTokenRecord,
  AuthActionTokenRecord,
  AuthActionTokenType,
  UserStatus,
  AuthPluginConfig,
  TokenServiceConfig,
  AuthAccountEmailConfig,
  AuthBehaviorConfig,
  AuthRegistrationConfig,
  AuthRegistrationMode,
  ResolvedAuthAccountEmailConfig,
  UserPropertyFieldConfig,
  UserPropertyFieldType,
  UserPropertyEditableBy,
  ResolvedAuthBehaviorConfig,
  ResolvedUserPropertyFieldConfig,
} from './types';

export { AuthError, AUTH_DEFAULTS } from './types';
