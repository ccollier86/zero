// ─── Auth Plugin ──────────────────────────────────────────────────────────
export {
  createAuthPlugin,
  getAuthStore,
  getMfaChallengeService,
  getMfaMethodStore,
  getMfaService,
  getTokenService,
} from './auth.plugin';
export { createAuthMiddleware } from './auth.middleware';
export { installAuthStopBarrier } from './auth-stop-lifecycle';

// ─── Services ─────────────────────────────────────────────────────────────
export { UserStore } from './user-store';
export { TokenService } from './token-service';
export { AuthActionTokenService } from './action-token-service';
export { AccountEmailService } from './account-email-service';
export { MfaMethodStore } from './mfa-method-store';
export { MfaService } from './mfa-service';
export { MfaChallengeStore } from './mfa-challenge-store';
export { MfaChallengeService } from './mfa-challenge-service';
export type {
  AdminMfaConfig,
  MfaReadiness,
  MfaReadinessInput,
  PublicMfaConfig,
} from './mfa-service';
export {
  defineAuthConfig,
  isPolicyTrustedUserProperty,
  resolveAuthBehaviorConfig,
} from './auth-config';
export {
  defineAuthEmailTemplates,
  resolveAuthEmailBranding,
} from './auth-email-templates';
export { UserPropertyService } from './user-property-service';

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  AuthEmailBrandingConfig,
  AuthEmailTemplate,
  AuthEmailTemplateContext,
  AuthEmailTemplateKey,
  AuthEmailTemplateResult,
  AuthEmailTemplates,
  ResolvedAuthEmailBranding,
} from './auth-email-templates';

export type {
  AuthContext,
  UserRecord,
  TokenPair,
  AccessTokenPayload,
  AuthTransitionPurpose,
  AuthTransitionTokenPayload,
  RefreshTokenRecord,
  AuthActionTokenRecord,
  AuthActionTokenType,
  AuthMfaChallengeRecord,
  AuthMfaConfig,
  AuthMfaMethodRecord,
  AuthMfaMethodStatus,
  AuthMfaMethodType,
  AuthMfaPolicy,
  AuthMfaQrRobustness,
  UserStatus,
  AuthPluginConfig,
  TokenServiceConfig,
  AuthAccountConfig,
  AuthAccountEmailConfig,
  AuthBehaviorConfig,
  AuthMfaTotpConfig,
  AuthRegistrationConfig,
  AuthRegistrationMode,
  ResolvedAuthAccountConfig,
  ResolvedAuthAccountEmailConfig,
  ResolvedAuthMfaConfig,
  ResolvedAuthMfaTotpConfig,
  UserPropertyFieldConfig,
  UserPropertyFieldType,
  UserPropertyEditableBy,
  ResolvedAuthBehaviorConfig,
  ResolvedUserPropertyFieldConfig,
} from './types';

export { AuthError, AUTH_DEFAULTS } from './types';
export {
  defineNativeAuthConfig,
  resolveNativeAuthConfig,
} from './native';
export type {
  NativeAuthClientConfig,
  NativeAuthConfig,
  NativeAuthorizationRequestPolicyConfig,
  NativeAuthorizationSourceContext,
  NativeAuthorizationSourceResolver,
  NativeIdentityScope,
  NativeRefreshRotationPolicyConfig,
  NativeRedirectKind,
  ResolvedNativeAuthClientConfig,
  ResolvedNativeAuthConfig,
  ResolvedNativeAuthorizationRequestPolicy,
  ResolvedNativeRefreshRotationPolicy,
} from './native';
