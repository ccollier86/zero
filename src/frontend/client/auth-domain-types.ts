/** Browser-safe contracts for verified-company-domain request onboarding. */

export type AuthTenantDomainClaimStatus =
  | 'pending'
  | 'verified'
  | 'grace'
  | 'lost';

export interface AuthTenantDomainClaim {
  claimId: string;
  domain: string;
  status: AuthTenantDomainClaimStatus;
  proofMethod: 'dns-txt';
  verifiedAt: number | null;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  validUntil: number | null;
  challengeExpiresAt: number | null;
  policy: AuthTenantDomainPolicy;
  /** Opaque optimistic-concurrency marker. */
  revision: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuthTenantDomainRequestRole {
  key: string;
  label: string;
  description?: string;
}

export interface AuthTenantDomainPolicy {
  enabled: boolean;
  admission: 'request-to-join';
  requestRoleKey: string | null;
  /** Opaque optimistic-concurrency marker. */
  revision: string;
}

export interface AuthTenantDomainAdministration {
  actor: {
    capabilities: {
      canReadDomains: boolean;
      canCreateDomains: boolean;
      canVerifyDomains: boolean;
      canManagePolicy: boolean;
      canReleaseDomains: boolean;
    };
  };
  requestRoles: readonly AuthTenantDomainRequestRole[];
  claims: readonly AuthTenantDomainClaim[];
}

/** Plaintext DNS material returned once when a challenge is issued/rotated. */
export interface AuthTenantDomainDnsChallenge {
  recordType: 'TXT';
  name: string;
  value: string;
  expiresAt: number;
}

export interface AuthTenantDomainChallengeResult {
  claim: AuthTenantDomainClaim;
  challenge: AuthTenantDomainDnsChallenge;
}

export interface AuthTenantDomainClaimResult {
  claim: AuthTenantDomainClaim;
}

export interface AuthTenantDomainPolicyUpdate {
  enabled: boolean;
  requestRoleKey: string | null;
  expectedRevision: string;
}

export interface AuthTenantDomainReleaseInput {
  expectedRevision: string;
  expectedPolicyRevision: string;
  confirmDomain: string;
}

export interface AuthTenantDomainReleaseResult {
  release: {
    claimId: string;
    domain: string;
    releasedAt: number;
    quarantineUntil: number;
  };
}

export interface AuthDomainOnboardingTenantSummary {
  name: string;
  slug: string;
}

export interface AuthDomainOnboardingPendingRequest {
  joinRequestId: string;
  status: 'pending';
  createdAt: number;
}

export type AuthDomainOnboardingCompletion =
  | {
      option: {
        action: 'request-to-join';
        tenant: AuthDomainOnboardingTenantSummary;
      };
      /** Opaque, short-lived, single-use proof. */
      continuation: string;
      expiresAt: number;
    }
  | {
      option: {
        action: 'request-pending';
        tenant: AuthDomainOnboardingTenantSummary;
        request: AuthDomainOnboardingPendingRequest;
      };
    }
  | {
      option: { action: 'unavailable' };
    };

export interface AuthDomainOnboardingAdmissionResult {
  request: AuthDomainOnboardingPendingRequest & {
    tenant: AuthDomainOnboardingTenantSummary;
  };
}

export type AuthDomainOnboardingStatus =
  | 'idle'
  | 'starting'
  | 'proof-pending'
  | 'completing'
  | 'ready'
  | 'admitting'
  | 'submitted'
  | 'error';
