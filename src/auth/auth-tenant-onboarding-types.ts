import type { TenantKind, TenantMembershipStatus } from './tenancy/tenancy-types';
import type {
  AuthEmailTemplateResult,
  ResolvedAuthEmailBranding,
} from './auth-email-templates';

/** Durable invitation lifecycle. Expired is materialized, never inferred as usable. */
export type AuthTenantInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'revoked'
  | 'expired';

/** Retained applicant/reviewer lifecycle for one tenant and identity. */
export type AuthTenantJoinRequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'cancelled';

export type AuthTenantInvitationDeliveryMode = 'manual' | 'email';

/** One bounded TXT lookup. Implementations must not follow caller-selected names. */
export type AuthVerifiedDomainTxtResolver = (
  hostname: string,
) => Promise<readonly (readonly string[])[]>;

/** Developer-authored exact company-domain request-onboarding policy. */
export interface AuthVerifiedDomainOnboardingConfig {
  /** Opt in to the complete server capability. Default: false. */
  enabled?: boolean;
  /** Non-system role choices a tenant may fix on its request policy. */
  allowedRequestRoles?: readonly string[];
  /** Initial fixed request role. Must be in allowedRequestRoles. Default: member. */
  defaultRequestRole?: string;
  /** One-time DNS challenge lifetime. Default: 24h. */
  challengeTTL?: string;
  /** Minimum interval between DNS checks for one claim. Default: 30s. */
  dnsCheckCooldown?: string;
  /** Time until a successful DNS proof must be checked again. Default: 7d. */
  reverifyInterval?: string;
  /** Admission grace after a verification lease expires. Default: 3d. */
  gracePeriod?: string;
  /** Retry interval after a leased reverification failure. Default: 1h. */
  reverifyRetryInterval?: string;
  /** Freshness required of explicit mailbox proof. Default: 30m. */
  mailboxProofMaxAge?: string;
  /** Dedicated mailbox-link lifetime. Default: 30m. */
  mailboxLinkTTL?: string;
  /** Proof-bound admission continuation lifetime. Default: 10m. */
  admissionTTL?: string;
  /** Cooldown after an administrator denies/cancels a request. Default: 7d. */
  deniedRetryCooldown?: string;
  /** Public app-relative page receiving the dedicated mailbox link. */
  mailboxLandingPath?: string;
  /** Additional exact shared mailbox domains to reject. */
  sharedMailboxDomains?: readonly string[];
  /** Server-owned resolver seam. Primarily useful for private DNS/test adapters. */
  resolveTxt?: AuthVerifiedDomainTxtResolver;
  /** Wall-clock bound for one resolver call. Default: 5s. */
  dnsTimeout?: string;
  /** Maximum TXT answers accepted from a resolver. Default: 32. */
  maxTxtAnswers?: number;
  /** Maximum joined bytes accepted across TXT answers. Default: 8192. */
  maxTxtBytes?: number;
  /** Maximum retained exact domain claims per tenant. Default: 20. */
  maxClaimsPerTenant?: number;
}

/** Server-only template context for an emailed tenant invitation. */
export interface AuthTenantInvitationEmailTemplateContext {
  branding: ResolvedAuthEmailBranding;
  recipient: string;
  tenant: { tenantId: string; name: string; slug: string; kind: TenantKind };
  invitation: {
    invitationId: string;
    roles: readonly string[];
    expiresAt: number;
  };
  actionUrl: string;
  defaultSubject: string;
  defaultText: string;
  defaultHtml: string;
}

export type AuthTenantInvitationEmailTemplate = (
  context: AuthTenantInvitationEmailTemplateContext,
) => AuthEmailTemplateResult | Promise<AuthEmailTemplateResult>;

/** Developer-authored multi-tenant onboarding policy. */
export interface AuthTenantOnboardingConfig {
  invitations?: {
    /** Default: true in multi-tenant mode. */
    enabled?: boolean;
    /** Default invitation lifetime. Default: `7d`. */
    defaultTTL?: string;
    /** Hard ceiling for an issuer-selected lifetime. Default: `30d`. */
    maxTTL?: string;
    /** Permit an invitation to create its exact email-bound identity. Default: true. */
    accountCreation?: boolean;
    /** Delivery policy. Manual is the headless default until email is enabled. */
    delivery?: {
      /** Defaults to `email` when email delivery is enabled, otherwise `manual`. */
      default?: AuthTenantInvitationDeliveryMode;
      /** Permit an authorized issuer to request a one-time copyable token. Default: true. */
      allowManual?: boolean;
      email?: {
        /** Enable durable outbox delivery. Default: false. */
        enabled?: boolean;
        /** App-relative invitation landing page. Default: `/accept-invitation`. */
        landingPath?: string;
        /** 32-byte base64url operator key used to wrap durable outbox data keys. */
        encryptionKey?: string;
        /** Previous wrapping keys accepted only to atomically rewrap during rotation. */
        previousEncryptionKeys?: string[];
        /** Optional app-authored invitation email template. */
        template?: AuthTenantInvitationEmailTemplate;
      };
    };
  };
  joinRequests?: {
    /** Default: true in multi-tenant mode. */
    enabled?: boolean;
  };
  /** Exact verified-company-domain request onboarding. Multi-tenant only. */
  verifiedDomains?: AuthVerifiedDomainOnboardingConfig;
}

/** Fully validated server policy. */
export interface ResolvedAuthTenantOnboardingConfig {
  readonly invitations: {
    readonly enabled: boolean;
    readonly defaultTTLms: number;
    readonly maxTTLms: number;
    readonly accountCreation: boolean;
    readonly delivery: {
      readonly default: AuthTenantInvitationDeliveryMode;
      readonly allowManual: boolean;
      readonly email: {
        readonly enabled: boolean;
        readonly landingPath: string;
        readonly encryptionKey?: string;
        readonly previousEncryptionKeys: readonly string[];
        readonly template?: AuthTenantInvitationEmailTemplate;
      };
    };
  };
  readonly joinRequests: {
    readonly enabled: boolean;
  };
  readonly verifiedDomains: {
    readonly enabled: boolean;
    readonly admission: 'request-to-join';
    readonly allowedRequestRoles: readonly string[];
    readonly defaultRequestRole: string;
    readonly challengeTTLms: number;
    readonly dnsCheckCooldownMs: number;
    readonly reverifyIntervalMs: number;
    readonly gracePeriodMs: number;
    readonly reverifyRetryIntervalMs: number;
    readonly mailboxProofMaxAgeMs: number;
    readonly mailboxLinkTTLms: number;
    readonly admissionTTLms: number;
    readonly deniedRetryCooldownMs: number;
    readonly mailboxLandingPath: string;
    readonly sharedMailboxDomains: readonly string[];
    readonly resolveTxt?: AuthVerifiedDomainTxtResolver;
    readonly dnsTimeoutMs: number;
    readonly maxTxtAnswers: number;
    readonly maxTxtBytes: number;
    readonly maxClaimsPerTenant: number;
  };
}

/** Internal invitation record. The raw bearer secret is deliberately absent. */
export interface AuthTenantInvitationRecord {
  invitationId: string;
  tenantId: string;
  email: string;
  roleKeys: readonly string[];
  /** Immutable issuance-time authority ceiling; never serialized publicly. */
  grantSnapshotJson: string | null;
  /** Integrity fingerprint for the canonical grant snapshot. */
  grantSnapshotFingerprint: string | null;
  status: AuthTenantInvitationStatus;
  issuedBy: string;
  acceptedByUserId: string | null;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
}

/** Safe active-tenant control-plane projection. */
export interface AuthTenantInvitation {
  invitationId: string;
  email: string;
  roles: readonly string[];
  status: AuthTenantInvitationStatus;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
}

/** Returned exactly once when a tenant manager issues an invitation. */
export interface AuthTenantInvitationCreated {
  invitation: AuthTenantInvitation;
  token: string;
}

/** Internal delivery projection; never serialized by an admin/public route. */
export interface AuthTenantInvitationDelivery {
  invitationId: string;
  recipient: string;
  roles: readonly string[];
  expiresAt: number;
  tenant: { tenantId: string; name: string; slug: string; kind: TenantKind };
}

/** Non-enumerating public invitation inspection result. */
export type AuthTenantInvitationInspection =
  | { available: false }
  | {
      available: true;
      tenant: { name: string; slug: string; kind: TenantKind };
      /** Whether the invitation's live role set crosses the platform-control boundary. */
      platformAuthority: boolean;
      emailHint: string;
      expiresAt: number;
      account: 'sign-in' | 'create';
    };

/** Internal retained join-request record. */
export interface AuthTenantJoinRequestRecord {
  joinRequestId: string;
  tenantId: string;
  userId: string;
  email: string;
  status: AuthTenantJoinRequestStatus;
  requestRevision: number;
  requestedAt: number;
  createdAt: number;
  updatedAt: number;
  reviewedAt: number | null;
  reviewedBy: string | null;
  lastDecision: 'approved' | 'denied' | null;
  approvedMembershipId: string | null;
}

/** Minimal role metadata that is safe to expose to a tenant reviewer. */
export interface AuthTenantJoinRequestApprovalRole {
  key: string;
  label: string;
}

/**
 * Actor-specific role behavior for one join request.
 *
 * `fixed` is reserved for policy/provenance-bound assignments, while `default`
 * preserves the ordinary server default without introducing a reviewer choice.
 * `selectable` contains only roles inside the live reviewer's grant ceiling.
 */
export type AuthTenantJoinRequestRoleSelection =
  | {
      mode: 'fixed' | 'default';
      roles: readonly AuthTenantJoinRequestApprovalRole[];
    }
  | {
      mode: 'selectable';
      defaultRoleKeys: readonly string[];
      maxRoleCount: number;
      roles: readonly AuthTenantJoinRequestApprovalRole[];
    };

export interface AuthTenantJoinRequestApprovalPolicy {
  /** Authority hint for UI actions only; the approval mutation rechecks authority. */
  canApprove: boolean;
  roleSelection: AuthTenantJoinRequestRoleSelection;
}

/** Reviewer-safe identity and retained request projection. */
export interface AuthTenantJoinRequest {
  joinRequestId: string;
  applicant: {
    userId: string;
    username: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  status: AuthTenantJoinRequestStatus;
  requestRevision: number;
  requestedAt: number;
  createdAt: number;
  updatedAt: number;
  reviewedAt: number | null;
  lastDecision: 'approved' | 'denied' | null;
  membership: null | {
    membershipId: string;
    status: TenantMembershipStatus;
    roles: readonly string[];
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

export interface AuthTenantRoleGrantCeiling {
  tenant: {
    allPermissions?: boolean;
    permissions: readonly string[];
  };
  application?: {
    allPermissions?: boolean;
    permissions: readonly string[];
  } | null;
}
