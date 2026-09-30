import type { ReactiveDB } from '../sync/reactive-db';
import type { EmailRuntime } from '../email/types';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { PlatformTokenService } from '../tokens/token-service';
import type { AuthRuntime } from './auth-runtime';
import type { AuthSessionService } from './auth-session-service';
import type {
  AuthRequestAdmissionConfig,
  ResolvedAuthRequestAdmissionConfig,
} from './auth-request-admission-types';
import type {
  AuthTenantOnboardingConfig,
  ResolvedAuthTenantOnboardingConfig,
} from './auth-tenant-onboarding-types';
import type {
  AuthEmailBrandingConfig,
  AuthEmailTemplates,
} from './auth-email-templates';
import type { NativeAuthConfig, ResolvedNativeAuthConfig } from './native/types';
import type { AuthAuditConfig, ResolvedAuthAuditConfig } from './auth-audit-types';
import type { TenantKind } from './tenancy/tenancy-types';
import type { AuthPlatformCodeEmitter } from './auth-observability';

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
  /** Authentication mechanism admitted for this request. Omitted legacy contexts are sessions. */
  credentialKind?: 'session' | 'api-key';
  /** Stable server-side credential identifier; never a raw bearer secret. */
  credentialId?: string;
  /** Exact user security generation validated by this request credential. */
  authGeneration?: number;
  /** Present when the bearer was issued to a registered native public client. */
  clientId?: string;
  /** Browser access remains `web`; native OIDC access is explicitly attributed. */
  sessionKind?: 'web' | 'native';
  /** OIDC identity scopes only; app permissions still come from Zero policy. */
  scope?: readonly string[];
  /** Opaque durable parent-session or native refresh-family id. */
  sessionId?: string;
  /** Server-resolved durable MFA assurance for this exact session family. */
  mfaVerifiedAt?: number;
  /** Durable parent generation carried by browser access credentials. */
  sessionGeneration?: number;
  /** Live server-validated authorization scope for this browser session. */
  sessionScopeKind?: 'application' | 'tenant';
  sessionScopeId?: string;
  /** Present only after a live tenant and membership generation check. */
  tenantId?: string;
  membershipId?: string;
  /** Live purpose of the active tenant; never accepted from bearer claims. */
  tenantKind?: TenantKind;
  tenantRole?: string | null;
  tenantAuthorizationGeneration?: number;
  membershipAuthorizationGeneration?: number;
  /** Live advanced-role assignment revision; never accepted from token input. */
  authorizationAssignmentRevision?: string;
}

/**
 * Secret-free handle that lets trusted background runtimes re-resolve the
 * exact live authority which originally admitted an authenticated request.
 *
 * This is not a bearer credential: it contains no access/refresh token and
 * cannot create a new session. The opaque session id is useful only for a
 * server-side lookup which must also match the user, client, security
 * generation, scope generations, and assignment revision captured here.
 */
export interface AuthContextAuthorityReference {
  readonly version: 1;
  readonly userId: string;
  readonly platformRole: string;
  readonly authGeneration: number;
  readonly sessionKind: 'web' | 'native';
  readonly sessionId: string;
  readonly mfaVerifiedAt: number | null;
  readonly sessionGeneration: number | null;
  readonly clientId: string | null;
  readonly identityScopes: readonly string[];
  readonly sessionScopeKind: 'application' | 'tenant';
  readonly sessionScopeId: string;
  readonly tenantId: string | null;
  readonly membershipId: string | null;
  readonly tenantKind: TenantKind | null;
  readonly tenantRole: string | null;
  readonly tenantAuthorizationGeneration: number | null;
  readonly membershipAuthorizationGeneration: number | null;
  readonly authorizationAssignmentRevision: string | null;
}

// ─── User Record ───────────────────────────────────────────────────────────

/** Account status enforced by login, refresh, and admin lifecycle routes. */
export type UserStatus = 'active' | 'suspended';

/**
 * Sanitized user projection returned by authorized auth APIs (no secrets).
 * This is not a globally public Sync row. Maps from the `users` table plus
 * joined `user_properties`.
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
  sessionKind?: 'web' | 'native';
  /** Durable browser parent generation. Native families use their own store. */
  sessionGeneration?: number;
  scope?: readonly string[];
  audience?: string;
  jti?: string;
  /** Opaque `sid`: durable browser parent session or native refresh family. */
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
  /**
   * Opaque binding to the exact live session authority that began a profile
   * MFA enrollment. The same live authority must present the token to finish.
   */
  profileAuthorityFingerprint?: string;
}

/**
 * Refresh token record from the `_refresh_tokens` table.
 */
export interface RefreshTokenRecord {
  tokenId: string;
  userId: string;
  /** Null only for refresh rows created before durable parent sessions. */
  sessionId: string | null;
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

/** Developer-authored policy for user-bound Guardian API keys. */
export interface AuthApiKeyOptions {
  /** Master capability switch. Default: false. */
  enabled?: boolean;
  /** Allow eligible users to create and manage their own keys. Default: false. */
  selfService?: boolean;
  /** Allow authorized app/tenant administrators to issue keys for eligible users. Default: false. */
  administratorIssuance?: boolean;
  /** Optional live scope-role eligibility allowlist. Omit to allow every otherwise eligible user. */
  eligibleScopeRoles?: readonly string[];
  /** Default finite key lifetime. Default: '30d'. */
  defaultTTL?: string;
  /** Maximum finite key lifetime. Default: '90d'. */
  maxTTL?: string;
  /** Maximum active keys for one user in one authorization scope. Default: 10. */
  maxActivePerUser?: number;
}

/** Compact capability switch or extensible API-key policy. */
export type AuthApiKeyConfig = boolean | AuthApiKeyOptions;

/** Fully validated server-side API-key policy. */
export interface ResolvedAuthApiKeyConfig {
  readonly enabled: boolean;
  readonly selfService: boolean;
  readonly administratorIssuance: boolean;
  readonly eligibleScopeRoles?: readonly string[];
  readonly defaultTTL: string;
  readonly defaultTTLms: number;
  readonly maxTTL: string;
  readonly maxTTLms: number;
  readonly maxActivePerUser: number;
}

/** How an empty installation may create its one bootstrap administrator. */
export type AuthBootstrapMode = 'secret' | 'public' | 'disabled';

/** Developer-authored first-administrator bootstrap ceremony. */
export interface AuthBootstrapOptions {
  /**
   * `secret` requires the request to present the configured high-entropy
   * secret. `public` preserves the legacy first-registration-wins behavior and
   * must be selected explicitly. `disabled` requires trusted provisioning.
   * Default: `secret`.
   */
  mode?: AuthBootstrapMode;
  /**
   * Operator-held secret required by `mode: 'secret'`. Use at least 32
   * characters and inject it from deployment secrets rather than source.
   * An omitted secret leaves bootstrap safely unavailable.
   */
  secret?: string;
}

/** Compact or extensible first-administrator bootstrap configuration. */
export type AuthBootstrapConfig = AuthBootstrapMode | AuthBootstrapOptions;

/** Normalized server-only bootstrap configuration. Never expose `secret`. */
export interface ResolvedAuthBootstrapConfig {
  mode: AuthBootstrapMode;
  secret?: string;
}

/** Whether authorization operates in one application scope or tenant scopes. */
export type AuthTenancyMode = 'single' | 'multi';

/** Who may create a new tenant after installation bootstrap has completed. */
export type AuthTenantCreationMode = 'authenticated' | 'platform-admin' | 'disabled';

/** App-authored names used by packaged tenant UI. */
export interface AuthTenantTerminologyConfig {
  /** Lowercase singular noun. Default: 'organization'. */
  singular?: string;
  /** Lowercase plural noun. Default: 'organizations'. */
  plural?: string;
}

/** App ceiling for post-bootstrap tenant creation. */
export interface AuthTenantCreationConfig {
  /** Default in multi mode: 'authenticated'. */
  mode?: AuthTenantCreationMode;
}

/** Explicit one-time adoption of an existing tenant as platform administration. */
export interface AuthAdministrationTenantConfig {
  /** Exact internal tenant id. Slugs are deliberately not accepted as adoption authority. */
  adoptTenantId?: string;
}

/** Developer-authored tenancy capability selection. */
export interface AuthTenancyOptions {
  /** Tenancy capability mode. Default: 'single'. */
  mode?: AuthTenancyMode;
  /** Packaged UI vocabulary. Available only in multi mode. */
  terminology?: AuthTenantTerminologyConfig;
  /** Who may create another tenant after bootstrap. Available only in multi mode. */
  creation?: AuthTenantCreationConfig;
  /** Invitation and join-request onboarding. Available only in multi mode. */
  onboarding?: AuthTenantOnboardingConfig;
  /** Protected administration-organization bootstrap/adoption policy. */
  administration?: AuthAdministrationTenantConfig;
}

/** Compact or extensible tenancy capability configuration. */
export type AuthTenancyConfig = AuthTenancyMode | AuthTenancyOptions;

/** Normalized tenancy capability selection. */
export interface ResolvedAuthTenancyConfig {
  readonly mode: AuthTenancyMode;
  readonly terminology: Readonly<Required<AuthTenantTerminologyConfig>>;
  readonly creation: Readonly<Required<AuthTenantCreationConfig>>;
  /** Present only in multi-tenant mode. */
  readonly onboarding?: ResolvedAuthTenantOnboardingConfig;
  /** Present only in multi-tenant mode when exact adoption is configured. */
  readonly administration?: Readonly<AuthAdministrationTenantConfig>;
}

/** Whether authorization uses current simple roles or advanced RBAC. */
export type AuthAuthorizationMode = 'simple' | 'advanced';

/** Stable, application-declared capability key such as `patients:read`. */
export type PermissionKey = string;

/** Data/control-plane authority realm in which a permission can be exercised. */
export type AuthPermissionScope = 'application' | 'tenant';

/** Developer-authored metadata for one statically declared permission. */
export interface AuthPermissionConfig {
  /** Human-readable control-plane label. Defaults to the permission key. */
  label?: string;
  /** Optional bounded help text for future administrative UI. */
  description?: string;
  /**
   * Permission realm. Defaults to `application` in single mode and `tenant`
   * in multi mode. Application permissions in multi mode are usable only
   * through a live administration-organization membership.
   */
  scope?: AuthPermissionScope;
}

/** Deterministically normalized permission metadata. */
export interface ResolvedAuthPermissionConfig {
  readonly key: PermissionKey;
  readonly label: string;
  readonly description?: string;
  readonly scope: AuthPermissionScope;
}

/** Static role template expanded inside the current authorization scope. */
export interface AuthRoleTemplateConfig {
  /** Human-readable control-plane label. Defaults to the role key. */
  label?: string;
  /** Optional bounded help text for future administrative UI. */
  description?: string;
  /** Declared permissions granted by this role. */
  permissions?: readonly PermissionKey[];
  /** Grant every statically declared permission without using a wildcard key. */
  allPermissions?: boolean;
  /** Marks a framework/application protected role template. */
  system?: boolean;
}

/** Deterministically normalized static role template. */
export interface ResolvedAuthRoleTemplateConfig {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly permissions: readonly PermissionKey[];
  readonly allPermissions: boolean;
  readonly system: boolean;
}

/** Explicit one-time adoption target for an existing single/advanced app. */
export interface AuthAuthorizationOwnerAdoptionConfig {
  /** Exact existing internal user id. Mutually exclusive with email. */
  userId?: string;
  /** Exact canonical existing email. Mutually exclusive with userId. */
  email?: string;
}

/** Developer-authored authorization capability selection. */
export interface AuthAuthorizationOptions {
  /** Authorization capability mode. Default: 'simple'. */
  mode?: AuthAuthorizationMode;
  /**
   * Monotonic version for role/permission semantics. Default: 1.
   * Increment this before deploying any semantic registry change.
   */
  registryVersion?: number;
  /** Canonical application/framework permission registry. */
  permissions?: Record<PermissionKey, AuthPermissionConfig>;
  /** Static application role templates. */
  roles?: Record<string, AuthRoleTemplateConfig>;
  /**
   * Explicitly adopt one existing identity as protected application owner when
   * upgrading an installed single-tenant app to advanced authorization.
   */
  ownerAdoption?: AuthAuthorizationOwnerAdoptionConfig;
  /**
   * One-time trust assertion for an unmarked legacy multi/simple database.
   * Use only when upgrading that exact database to multi/advanced; remove it
   * after Zero persists the installed profile marker.
   */
  legacySimpleRoleAdoption?: true;
}

/** Compact or extensible authorization capability configuration. */
export type AuthAuthorizationConfig =
  | AuthAuthorizationMode
  | AuthAuthorizationOptions;

/** Normalized authorization capability selection. */
export interface ResolvedAuthAuthorizationConfig {
  readonly mode: AuthAuthorizationMode;
  readonly registryVersion: number;
  readonly permissions: Readonly<Record<PermissionKey, ResolvedAuthPermissionConfig>>;
  readonly roles: Readonly<Record<string, ResolvedAuthRoleTemplateConfig>>;
  readonly ownerAdoption?: Readonly<AuthAuthorizationOwnerAdoptionConfig> | null;
  readonly legacySimpleRoleAdoption?: true;
}

/** Configuration for ordinary registration after installation bootstrap. */
export interface AuthRegistrationConfig {
  /** Public registration mode after bootstrap. Default: 'public'. */
  mode?: AuthRegistrationMode;
}

/** Registration behavior accepted by legacy resolved-config test doubles. */
export interface ResolvedAuthRegistrationConfig {
  mode: AuthRegistrationMode;
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
  /** Durable authorization/control-plane audit retention. */
  audit?: AuthAuditConfig;
  /** Application or tenant-scoped authorization. Default: 'single'. */
  tenancy?: AuthTenancyConfig;
  /** Simple current roles or advanced RBAC. Default: 'simple'. */
  authorization?: AuthAuthorizationConfig;
  /** Ordinary account registration behavior after installation bootstrap. */
  registration?: AuthRegistrationConfig;
  /** Installation bootstrap ceremony. Default: secret-gated and unavailable. */
  bootstrap?: AuthBootstrapConfig;
  /** Durable source/identifier admission for public bootstrap, registration, and login. */
  requestAdmission?: AuthRequestAdmissionConfig;
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
  /** User-bound, explicitly scoped API credentials. Disabled by default. */
  apiKeys?: AuthApiKeyConfig;
}

/** Normalized auth behavior config used by backend services and routes. */
export interface ResolvedAuthBehaviorConfig {
  /** Durable authorization/control-plane audit retention. */
  audit: ResolvedAuthAuditConfig;
  /**
   * Normalized by resolveAuthBehaviorConfig(). Optional on this legacy public
   * interface so existing hand-built test doubles remain source-compatible.
   */
  tenancy?: ResolvedAuthTenancyConfig;
  /** See tenancy compatibility note above. */
  authorization?: ResolvedAuthAuthorizationConfig;
  /** Present on normalized current config; absent means the safe secret mode. */
  bootstrap?: ResolvedAuthBootstrapConfig;
  /** Present on normalized current config; omitted only by legacy test doubles. */
  requestAdmission?: ResolvedAuthRequestAdmissionConfig;
  registration: ResolvedAuthRegistrationConfig;
  account: ResolvedAuthAccountConfig;
  mfa: ResolvedAuthMfaConfig;
  accountEmails: ResolvedAuthAccountEmailConfig;
  branding: AuthEmailBrandingConfig;
  emails: AuthEmailTemplates;
  userProperties: Record<string, ResolvedUserPropertyFieldConfig>;
  strictUserProperties: boolean;
  nativeApps: ResolvedNativeAuthConfig;
  apiKeys: ResolvedAuthApiKeyConfig;
}

/** Exact return contract of resolveAuthBehaviorConfig(). */
export interface NormalizedAuthBehaviorConfig extends ResolvedAuthBehaviorConfig {
  tenancy: ResolvedAuthTenancyConfig;
  authorization: ResolvedAuthAuthorizationConfig;
  bootstrap: ResolvedAuthBootstrapConfig;
  requestAdmission: ResolvedAuthRequestAdmissionConfig;
}

/**
 * Configuration for createAuthPlugin().
 */
export interface AuthPluginConfig extends AuthBehaviorConfig {
  /** Shared ReactiveDB instance — auth defines its tables here */
  db: ReactiveDB;

  /** Managed app-local service/lifecycle container. */
  runtime?: ZeroAppRuntime;

  /** Fixed app-local email boundary; preferred for direct plugin composition. */
  emailRuntime?: EmailRuntime;

  /** Lazy app-local email boundary; useful when plugin startup order matters. */
  getEmailRuntime?: () => EmailRuntime;

  /** Fixed app-local platform action-token service. `null` selects legacy storage. */
  platformTokenService?: PlatformTokenService | null;

  /** Lazy app-local platform action-token dependency. */
  getPlatformTokenService?: () => PlatformTokenService | null;

  /**
   * Receives this plugin's app-local runtime at composition time.
   * Advanced integrations should normally prefer services on `ZeroAppRuntime`.
   */
  onRuntimeCreated?: (runtime: AuthRuntime) => void;

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

  /** App-local durable browser-session authority. Defaults to single mode. */
  authSessionService?: AuthSessionService;

  /** App-local observability boundary for transaction invariant failures. */
  emitCode?: AuthPlatformCodeEmitter;
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
