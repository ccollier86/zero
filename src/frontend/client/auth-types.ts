/** Public contracts shared by the browser auth client and focused transports. */

export interface AuthUser {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
  emailVerifiedAt: number | null;
  emailVerificationRequired: boolean;
  mfaRequired: boolean;
  properties: Record<string, string>;
  createdAt: number;
  updatedAt: number | null;
}

export interface RegisterParams {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  /** Optional MFA enrollment request when app MFA policy is optional. */
  mfaEnrollment?: boolean;
  /** Validated local continuation for a pending native registration. */
  nativeContinuation?: string;
  /** Operator-held secret accepted only while creating the first admin. */
  bootstrapSecret?: string;
  /** Initial organization name when the server advertises multi-tenancy. */
  organizationName?: string;
  /** Optional organization URL slug; the server derives one when omitted. */
  organizationSlug?: string;
}

/** Organization created alongside a multi-tenant self-registration. */
export interface AuthRegistrationTenant {
  tenantId: string;
  kind: 'administration' | 'organization';
  membershipId: string;
  slug: string;
  name: string;
  role: string | null;
}

export type AuthMfaMethodType = 'email' | 'totp';

export interface AuthMfaMethod {
  methodId: string;
  type: AuthMfaMethodType;
  label: string | null;
  status: 'pending' | 'active' | 'disabled';
  isPrimary: boolean;
  createdAt: number;
  verifiedAt: number | null;
  lastUsedAt: number | null;
}

export interface AuthMfaChallenge {
  challengeId: string;
  methodType: AuthMfaMethodType;
  expiresAt: number;
  delivery: 'email' | 'authenticator';
}

/** Public-safe active-tenant projection. */
export interface AuthTenantSummary {
  tenantId: string;
  kind: 'administration' | 'organization';
  slug: string;
  name: string;
  role: string | null;
}

/** Identity is proven, but one live tenant must be selected before session issue. */
export interface AuthTenantSelectionRequiredResult {
  user: AuthUser;
  tenantSelectionRequired: true;
  tenantSelection: {
    continuation: string;
    expiresAt: number;
    tenants: AuthTenantSummary[];
  };
}

/** Identity is proven, but onboarding must establish an active membership. */
export interface AuthTenantOnboardingRequiredResult {
  user: AuthUser;
  tenantOnboardingRequired: true;
  onboarding: {
    reason: 'no_active_tenant_membership';
    /** Fully-authenticated, single-use proof for invitation/join onboarding. */
    continuation: string;
    expiresAt: number;
    tenantCreation?: {
      allowed: boolean;
      continuation?: string;
      expiresAt?: number;
    };
  };
}

export interface AuthTenantCreateParams {
  name: string;
  slug?: string;
  /** Pre-session proof returned by an onboarding-required auth result. */
  continuation?: string;
}

export interface AuthTenantListResult {
  activeTenantId: string;
  tenants: AuthTenantSummary[];
}

export type AuthTenantMembershipStatus = 'active' | 'suspended' | 'removed';

/** Safe tenant member identity; global account-security fields are never included. */
export interface AuthTenantMemberIdentity {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface AuthTenantMember {
  membershipId: string;
  identity: AuthTenantMemberIdentity;
  status: AuthTenantMembershipStatus;
  roles: string[];
  /** Optimistic-concurrency token for this retained tenant-role set. */
  roleRevision: string;
  joinedAt: number;
  updatedAt: number;
}

export interface AuthTenantMemberPage {
  members: AuthTenantMember[];
  page: {
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface AuthTenantMemberListParams {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: AuthTenantMembershipStatus;
}

export interface AuthTenantRoleDescriptor {
  key: string;
  label: string;
  description?: string;
  /** Role is valid only inside the protected administration organization. */
  administrationOnly: boolean;
  permissions: string[];
  allPermissions: boolean;
  system: boolean;
  assignable: boolean;
  grantable: boolean;
}

export interface AuthTenantAdministrationConfig {
  tenancy: 'multi';
  authorization: 'simple' | 'advanced';
  terminology: { singular: string; plural: string };
  tenant: {
    tenantId: string;
    kind: 'administration' | 'organization';
    slug: string;
    name: string;
  };
  actor: {
    membershipId: string;
    roles: string[];
    permissions: string[];
    allPermissions: boolean;
  };
  capabilities: {
    canReadMembers: boolean;
    canManageMembers: boolean;
    canReadRoles: boolean;
    canManageRoles: boolean;
    canTransferOwnership: boolean;
    canReadInvitations: boolean;
    canManageInvitations: boolean;
    canReviewJoinRequests: boolean;
  };
  roles: AuthTenantRoleDescriptor[];
}

export interface AuthTenantMemberMutationResult {
  member: AuthTenantMember;
  actorSessionInvalidated: boolean;
}

export interface AuthTenantOwnershipTransferResult {
  owner: AuthTenantMember;
  previousOwner: AuthTenantMember;
  actorSessionInvalidated: true;
}

export interface AuthTenantAddMemberParams {
  email: string;
  /** Omit for Zero's default `member` role. */
  roles?: string[];
}

export interface AuthTenantUpdateMemberParams {
  status?: Extract<AuthTenantMembershipStatus, 'active' | 'suspended'>;
  /** One role in simple mode; zero or more assignable roles in advanced mode. */
  roles?: string[];
  /** Required by direct SDK calls whenever `roles` is present. Hooks fill it in. */
  expectedRoleRevision?: string;
}

export type AuthTenantInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'revoked'
  | 'expired';

export interface AuthTenantInvitation {
  invitationId: string;
  email: string;
  roles: string[];
  status: AuthTenantInvitationStatus;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
}

export interface AuthTenantInvitationPage {
  invitations: AuthTenantInvitation[];
  page: {
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface AuthTenantInvitationListParams {
  status?: AuthTenantInvitationStatus;
  limit?: number;
  cursor?: string;
}

export interface AuthTenantIssueInvitationParams {
  email: string;
  roles?: string[];
  expiresIn?: string;
  delivery?: 'manual' | 'email';
}

export type AuthTenantIssueInvitationResult =
  | {
      invitation: AuthTenantInvitation;
      delivery: { mode: 'manual' };
      /** Returned exactly once and only after explicitly selecting manual delivery. */
      token: string;
    }
  | {
      invitation: AuthTenantInvitation;
      delivery: { mode: 'email'; status: 'queued' };
    };

export type AuthTenantInvitationInspection =
  | { available: false }
  | {
      available: true;
      tenant: {
        name: string;
        slug: string;
        kind: 'administration' | 'organization';
      };
      /** True only when the invitation grants explicit platform-control authority. */
      platformAuthority: boolean;
      emailHint: string;
      expiresAt: number;
      account: 'sign-in' | 'create';
    };

export type AuthTenantAcceptInvitationParams =
  | { token: string; continuation?: string }
  | {
      token: string;
      username: string;
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      mfaEnrollment?: boolean;
    };

export type AuthTenantInvitationAcceptanceResult =
  | (AuthCompletionResult & {
      invitationAccepted: true;
      acceptedTenant: {
        tenantId: string;
        membershipId: string;
        name: string;
        slug: string;
        kind: 'administration' | 'organization';
      };
    })
  | (AuthCompletionResult & {
      /** Complete MFA, then accept again with `onboarding.continuation`. */
      invitationAcceptancePending: true;
    });

export type AuthTenantJoinRequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'cancelled';

export interface AuthTenantJoinRequestApprovalRole {
  key: string;
  label: string;
}

export type AuthTenantJoinRequestRoleSelection =
  | {
      mode: 'fixed' | 'default';
      roles: AuthTenantJoinRequestApprovalRole[];
    }
  | {
      mode: 'selectable';
      defaultRoleKeys: string[];
      maxRoleCount: number;
      roles: AuthTenantJoinRequestApprovalRole[];
    };

export interface AuthTenantJoinRequestApprovalPolicy {
  /** Display hint only. The server rechecks live authority on approval. */
  canApprove: boolean;
  roleSelection: AuthTenantJoinRequestRoleSelection;
}

export interface AuthTenantJoinRequest {
  joinRequestId: string;
  applicant: AuthTenantMemberIdentity;
  status: AuthTenantJoinRequestStatus;
  requestRevision: number;
  requestedAt: number;
  createdAt: number;
  updatedAt: number;
  reviewedAt: number | null;
  lastDecision: 'approved' | 'denied' | null;
  membership: null | {
    membershipId: string;
    status: AuthTenantMembershipStatus;
    roles: string[];
  };
  reactivationRequired: boolean;
  approvalPolicy: AuthTenantJoinRequestApprovalPolicy;
}

export interface AuthTenantJoinRequestPage {
  requests: AuthTenantJoinRequest[];
  page: {
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface AuthTenantJoinRequestListParams {
  status?: AuthTenantJoinRequestStatus;
  limit?: number;
  cursor?: string;
}

export interface AuthTenantReviewJoinRequestParams {
  /** Optimistic-concurrency fence copied from the loaded request. */
  expectedRequestRevision: number;
  roles?: string[];
  reactivateMembership?: boolean;
}

export interface AuthTenantDenyJoinRequestParams {
  /** Optimistic-concurrency fence copied from the loaded request. */
  expectedRequestRevision: number;
}

export type AuthSessionTransitionOperation =
  | 'restore'
  | 'external-session'
  | 'authentication'
  | 'tenant-select'
  | 'tenant-create'
  | 'tenant-switch'
  | 'logout';

/** Secret-free outcome of explicitly restoring the current browser session. */
export type AuthSessionRecoveryResult =
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'retryable'; readonly error: string };

/** Observable phase for an authorization-scope replacement. */
export interface AuthSessionTransitionState {
  phase:
    | 'idle'
    | 'preparing'
    | 'committed'
    | 'reconciling'
    | 'recovery-required';
  operation: AuthSessionTransitionOperation | null;
  revision: number;
  recoverable: boolean;
  error: string | null;
}

export interface AuthMfaSetupRequiredResult {
  user: AuthUser;
  mfaSetupRequired: true;
  mfaSetupToken: string;
  mfa: {
    methods: AuthMfaMethodType[];
    allowUserChoice: boolean;
  };
}

export interface AuthMfaChallengeRequiredResult {
  user: AuthUser;
  mfaChallengeRequired: true;
  mfaChallenge: {
    method: AuthMfaMethod;
    challenge?: AuthMfaChallenge;
    challengeToken: string;
  };
}

export interface AuthSessionResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  mfaSetupRequired?: false;
  mfaChallengeRequired?: false;
  tenantSelectionRequired?: false;
  tenantOnboardingRequired?: false;
  activeTenant?: AuthTenantSummary;
}

/** Password recovery/setup completed; a fresh login must start a new session. */
export interface AuthPasswordUpdatedResult {
  user: AuthUser;
  passwordUpdated: true;
  signInRequired: true;
}

/** Registration completed but the account must verify its email before sign-in. */
export interface AuthEmailVerificationRequiredResult {
  user: AuthUser & {
    emailVerifiedAt: null;
    emailVerificationRequired: true;
  };
}

export type AuthCompletionResult =
  | AuthSessionResult
  | AuthMfaSetupRequiredResult
  | AuthMfaChallengeRequiredResult
  | AuthPasswordUpdatedResult
  | AuthEmailVerificationRequiredResult
  | AuthTenantSelectionRequiredResult
  | AuthTenantOnboardingRequiredResult;

/** Registration completion, including the atomically created organization when applicable. */
export type AuthRegistrationResult = AuthCompletionResult & {
  tenant?: AuthRegistrationTenant;
};

export interface AuthMfaSetupStartResult {
  setupRequired: boolean;
  method: AuthMfaMethod;
  challenge?: AuthMfaChallenge;
  totp?: {
    secret: string;
    otpauthUrl: string;
    issuer: string;
    accountName: string;
  };
  verificationToken: string;
}

export type AuthMfaSetupVerifyResult =
  | AuthSessionResult
  | AuthTenantSelectionRequiredResult
  | AuthTenantOnboardingRequiredResult
  | {
      ok: true;
      method: AuthMfaMethod;
      methods: AuthMfaMethod[];
    };

export interface AuthUserPropertyConfig {
  key: string;
  type: 'string' | 'enum' | 'boolean' | 'number';
  label?: string;
  values?: string[];
  default?: string;
  editableBy: 'user' | 'admin' | 'system' | 'none';
  useInPolicies?: boolean;
  description?: string;
}

export interface AuthPublicConfig {
  /** Resolved tenancy capability. Missing on older Zero servers means single. */
  tenancy?: {
    mode: 'single' | 'multi';
    terminology?: {
      singular: string;
      plural: string;
    };
    creation?: {
      mode: 'authenticated' | 'platform-admin' | 'disabled';
    };
    onboarding?: {
      invitations: {
        enabled: boolean;
        accountCreation: boolean;
        delivery: {
          default: 'manual' | 'email';
          manual: boolean;
          email: boolean;
        };
      };
      joinRequests: { enabled: boolean };
      /** Public capability only; matching and target discovery remain server-side. */
      verifiedDomains?: {
        enabled: boolean;
        admission: 'request-to-join';
      };
    };
  };
  /** Resolved authorization capability. Missing on older Zero servers means simple. */
  authorization?: {
    mode: 'simple' | 'advanced';
  };
  /** Public-safe Guardian API-key capability. Missing on older Zero servers means disabled. */
  apiKeys?: {
    enabled: boolean;
    selfService: boolean;
    administratorIssuance: boolean;
    defaultTTL: string;
    maxTTL: string;
    maxActivePerUser: number;
  };
  /** Public-safe installation setup state. The configured secret is omitted. */
  bootstrap?: {
    required: boolean;
    mode: 'secret' | 'public' | 'disabled';
    available: boolean;
    secretRequired: boolean;
  };
  registration: {
    mode: 'public' | 'admin-only' | 'disabled';
    bootstrapRequired: boolean;
    /** Whether either bootstrap or ordinary self-registration can proceed. */
    registrationEnabled?: boolean;
    publicRegistrationEnabled: boolean;
    userCount?: number;
  };
  accountEmails?: {
    adminCreatedUser: boolean;
    passwordReset: boolean;
    passwordChangedNotice: boolean;
    emailVerification?: boolean;
  };
  account?: {
    requireEmailVerification: boolean;
    emailVerificationPath: string;
    emailVerificationReady: boolean;
  };
  mfa?: {
    enabled: boolean;
    policy: 'optional' | 'required' | 'admin-required';
    methods: Array<'email' | 'totp'>;
    availableMethods: Array<'email' | 'totp'>;
    allowUserChoice: boolean;
    allowMultipleMethods: boolean;
    rememberDevice: boolean;
    recoveryCodes: boolean;
    ready: boolean;
  };
  userProperties?: Record<string, AuthUserPropertyConfig>;
  strictUserProperties?: boolean;
}

export interface AuthActionTokenInfo {
  valid: boolean;
  type: 'account_setup' | 'password_reset' | 'admin_password_reset' | 'email_verification';
  expiresAt: number;
  user: {
    userId: string;
    username: string;
    email: string;
  };
}

export function isAuthSessionResult(value: unknown): value is AuthSessionResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthSessionResult>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    Boolean(candidate.user)
  );
}

export function isAuthTenantSelectionRequiredResult(
  value: unknown,
): value is AuthTenantSelectionRequiredResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthTenantSelectionRequiredResult>;
  return candidate.tenantSelectionRequired === true
    && Boolean(candidate.user)
    && Boolean(candidate.tenantSelection)
    && typeof candidate.tenantSelection?.continuation === 'string'
    && Array.isArray(candidate.tenantSelection?.tenants);
}

export function isAuthTenantOnboardingRequiredResult(
  value: unknown,
): value is AuthTenantOnboardingRequiredResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthTenantOnboardingRequiredResult>;
  return candidate.tenantOnboardingRequired === true
    && candidate.onboarding?.reason === 'no_active_tenant_membership'
    && Boolean(candidate.user);
}

export function isAuthEmailVerificationRequiredResult(
  value: unknown,
): value is AuthEmailVerificationRequiredResult {
  if (!value || typeof value !== 'object' || isAuthSessionResult(value)) return false;
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return false;
  const candidate = user as Partial<AuthUser>;
  return candidate.emailVerificationRequired === true && candidate.emailVerifiedAt === null;
}
