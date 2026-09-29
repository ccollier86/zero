/** Public transport-neutral contracts for verified-domain onboarding. */

export type AuthTenantDomainClaimStatus = 'pending' | 'verified' | 'grace' | 'lost';

export interface AuthTenantDomainClaimProjection {
  claimId: string;
  domain: string;
  status: AuthTenantDomainClaimStatus;
  proofMethod: 'dns-txt';
  verifiedAt: number | null;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  validUntil: number | null;
  challengeExpiresAt: number | null;
  policy: {
    enabled: boolean;
    admission: 'request-to-join';
    requestRoleKey: string | null;
    revision: string;
  };
  revision: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuthTenantDomainChallengeResult {
  claim: AuthTenantDomainClaimProjection;
  challenge: {
    recordType: 'TXT';
    name: string;
    value: string;
    expiresAt: number;
  };
}

export interface AuthTenantDomainReleaseResult {
  release: {
    claimId: string;
    domain: string;
    releasedAt: number;
    quarantineUntil: number;
  };
}

export type AuthDomainOnboardingCompletion =
  | {
      option: { action: 'request-to-join'; tenant: { name: string; slug: string } };
      continuation: string;
      expiresAt: number;
    }
  | {
      option: {
        action: 'request-pending';
        tenant: { name: string; slug: string };
        request: { joinRequestId: string; status: 'pending'; createdAt: number };
      };
    }
  | { option: { action: 'unavailable' } };

export interface DomainMailboxJobBinding {
  userId: string;
  email: string;
  emailGeneration: number;
  authGeneration: number;
  identityKind: 'session' | 'continuation';
  identityContinuationId: string | null;
}

export interface DomainAdmissionIdentityBinding {
  userId: string;
  authGeneration: number;
  identityKind: 'session' | 'continuation';
  identityContinuationId: string | null;
}
