import { describe, expect, test } from 'bun:test';
import { TenantAdministrationBoundaryFence } from './tenant-administration-hooks';
import {
  domainOnboardingBoundaryKey,
  removeReleasedDomainClaim,
} from './domain-onboarding-hooks';

describe('verified-domain hook boundary fencing', () => {
  test('separates replacement accounts, active tenants, and pre-session identities', () => {
    const accountA = domainOnboardingBoundaryKey('account-a', 'tenant-1', 'identity-1');
    expect(accountA).not.toBe(
      domainOnboardingBoundaryKey('account-b', 'tenant-1', 'identity-1'),
    );
    expect(accountA).not.toBe(
      domainOnboardingBoundaryKey('account-a', 'tenant-2', 'identity-1'),
    );
    expect(accountA).not.toBe(
      domainOnboardingBoundaryKey('account-a', 'tenant-1', 'identity-2'),
    );
    expect(domainOnboardingBoundaryKey(
      'account-a', 'tenant-1', 'identity-1', true, 'session-family-a',
    )).not.toBe(domainOnboardingBoundaryKey(
      'account-a', 'tenant-1', 'identity-1', true, 'session-family-b',
    ));
    expect(domainOnboardingBoundaryKey(
      'account-a',
      'tenant-1',
      'identity-1',
      false,
    )).toBeNull();
  });

  test('invalidates late proof and admission completions after a boundary change', () => {
    const fence = new TenantAdministrationBoundaryFence();
    const proofForAccountA = fence.update(
      domainOnboardingBoundaryKey('account-a', 'tenant-1', 'identity-1'),
    );
    expect(fence.isCurrent(proofForAccountA)).toBe(true);

    const proofForAccountB = fence.update(
      domainOnboardingBoundaryKey('account-b', 'tenant-1', 'identity-2'),
    );
    expect(fence.isCurrent(proofForAccountA)).toBe(false);
    expect(fence.isCurrent(proofForAccountB)).toBe(true);

    const switchedTenant = fence.update(
      domainOnboardingBoundaryKey('account-b', 'tenant-2', 'identity-2'),
    );
    expect(fence.isCurrent(proofForAccountB)).toBe(false);
    expect(fence.isCurrent(switchedTenant)).toBe(true);

    const unstableTransition = fence.update(null);
    expect(fence.isCurrent(switchedTenant)).toBe(false);
    expect(fence.isCurrent(unstableTransition)).toBe(true);
  });

  test('removes only the claim named by a committed release receipt', () => {
    const first = claim('claim-1', 'one.com');
    const second = claim('claim-2', 'two.com');
    const administration = {
      actor: {
        capabilities: {
          canReadDomains: true,
          canCreateDomains: true,
          canVerifyDomains: true,
          canManagePolicy: true,
          canReleaseDomains: true,
        },
      },
      requestRoles: [],
      claims: [first, second],
    } as const;

    const updated = removeReleasedDomainClaim(administration, 'claim-1');
    expect(updated.claims).toEqual([second]);
    expect(updated.actor).toBe(administration.actor);
    expect(Object.isFrozen(updated)).toBe(true);
    expect(Object.isFrozen(updated.claims)).toBe(true);
  });
});

function claim(claimId: string, domain: string) {
  return {
    claimId,
    domain,
    status: 'pending',
    proofMethod: 'dns-txt',
    verifiedAt: null,
    lastCheckedAt: null,
    nextCheckAt: null,
    validUntil: null,
    challengeExpiresAt: 2,
    policy: {
      enabled: false,
      admission: 'request-to-join',
      requestRoleKey: null,
      revision: 'vdp_1',
    },
    revision: 'vdc_1',
    createdAt: 1,
    updatedAt: 1,
  } as const;
}
