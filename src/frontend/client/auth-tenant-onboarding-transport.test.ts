import { describe, expect, test } from 'bun:test';
import {
  AuthTenantOnboardingTransport,
  parseTenantInvitationAcceptance,
  parseTenantInvitationInspection,
} from './auth-tenant-onboarding-transport';

describe('tenant invitation browser parsing', () => {
  test('preserves the server-derived tenant kind on inspection and acceptance', () => {
    const inspection = parseTenantInvitationInspection({
      available: true,
      tenant: {
        name: 'Platform administration',
        slug: 'platform--administration',
        kind: 'administration',
      },
      platformAuthority: true,
      emailHint: 'a***@example.test',
      expiresAt: 1_800_000_000_000,
      account: 'sign-in',
    });
    expect(inspection.available && inspection.tenant.kind).toBe('administration');
    expect(inspection.available && inspection.platformAuthority).toBe(true);

    const accepted = parseTenantInvitationAcceptance({
      ...sessionCompletion(),
      invitationAccepted: true,
      acceptedTenant: {
        tenantId: 'tenant_admin',
        membershipId: 'membership_owner',
        name: 'Platform administration',
        slug: 'platform--administration',
        kind: 'administration',
      },
    });
    expect('acceptedTenant' in accepted && accepted.acceptedTenant.kind)
      .toBe('administration');
  });

  test('accepts the concealed and pending shapes', () => {
    expect(parseTenantInvitationInspection({ available: false }))
      .toEqual({ available: false });
    expect('invitationAcceptancePending' in parseTenantInvitationAcceptance({
      ...mfaSetupCompletion(),
      invitationAcceptancePending: true,
    })).toBe(true);
  });

  test('rejects unknown fields, invalid kinds, and malformed accepted tenants', () => {
    expect(() => parseTenantInvitationInspection({
      available: false,
      tenant: null,
    })).toThrow('invalid tenant invitation response');
    expect(() => parseTenantInvitationInspection({
      available: true,
      tenant: { name: 'Acme', slug: 'acme', kind: 'platform' },
      platformAuthority: false,
      emailHint: 'a***@example.test',
      expiresAt: 1,
      account: 'sign-in',
    })).toThrow('invalid tenant invitation response');
    expect(() => parseTenantInvitationInspection({
      available: true,
      tenant: { name: 'Acme', slug: 'acme', kind: 'organization' },
      platformAuthority: true,
      emailHint: 'a***@example.test',
      expiresAt: 1,
      account: 'sign-in',
    })).toThrow('invalid tenant invitation response');
    expect(() => parseTenantInvitationAcceptance({
      ...sessionCompletion(),
      invitationAccepted: true,
      acceptedTenant: {
        tenantId: 'tenant:bad',
        membershipId: 'membership_owner',
        name: 'Acme',
        slug: 'acme',
        kind: 'organization',
      },
    })).toThrow('invalid tenant invitation response');
    expect(() => parseTenantInvitationAcceptance({
      ...mfaSetupCompletion(),
      invitationAcceptancePending: true,
      acceptedTenant: null,
    })).toThrow('invalid tenant invitation response');
    expect(() => parseTenantInvitationAcceptance({
      accessToken: 'access',
      refreshToken: 'refresh',
      invitationAccepted: true,
      acceptedTenant: {
        tenantId: 'tenant_acme',
        membershipId: 'membership_owner',
        name: 'Acme',
        slug: 'acme',
        kind: 'organization',
      },
    })).toThrow('invalid tenant invitation response');
  });

  test('fails closed on malformed invitation administration responses', async () => {
    const page = onboardingTransport(async () => Response.json({
      invitations: [invitation()],
      page: { limit: 25, count: 1, hasMore: false, nextCursor: null },
    }));
    await expect(page.listInvitations()).resolves.toMatchObject({
      invitations: [{ invitationId: 'invitation-1' }],
    });

    const malformed = onboardingTransport(async () => Response.json({
      invitations: [invitation()],
      page: { limit: 25, count: 0, hasMore: false, nextCursor: null },
    }));
    await expect(malformed.listInvitations()).rejects.toThrow(
      'invalid tenant-administration response',
    );

    const badSubmission = onboardingTransport(
      async () => Response.json({ submitted: false }),
    );
    await expect(badSubmission.submitJoinRequest({ tenantSlug: 'acme' }))
      .rejects.toThrow('invalid tenant-administration response');
  });
});

function onboardingTransport(
  send: (url: string, init?: RequestInit) => Promise<Response>,
): AuthTenantOnboardingTransport {
  return new AuthTenantOnboardingTransport({
    baseUrl: 'https://zero.test',
    authenticatedFetch: send,
    optionalAuthenticatedFetch: send,
    createResponseError: (_response, _body, fallback) => new Error(fallback),
    assertResponseCurrent() {},
    beginAuthentication: (() => { throw new Error('not used'); }) as never,
    failAuthentication() {},
    completeAuthentication: (async (result) => result),
  });
}

function invitation() {
  return {
    invitationId: 'invitation-1', email: 'person@example.test', roles: ['member'],
    status: 'pending', expiresAt: 50, createdAt: 1, updatedAt: 1,
    acceptedAt: null, revokedAt: null,
  };
}

function sessionCompletion() {
  return {
    user: authUser(),
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    activeTenant: {
      tenantId: 'tenant_admin',
      kind: 'administration',
      slug: 'platform--administration',
      name: 'Platform administration',
      role: 'owner',
    },
  };
}

function mfaSetupCompletion() {
  return {
    user: authUser(),
    mfaSetupRequired: true,
    mfaSetupToken: 'setup-token',
    mfa: { methods: ['totp'], allowUserChoice: false },
  };
}

function authUser() {
  return {
    userId: 'user-1',
    username: 'owner',
    email: 'owner@example.test',
    firstName: 'Platform',
    lastName: 'Owner',
    role: 'admin',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: 1,
    emailVerificationRequired: false,
    mfaRequired: false,
    properties: {},
    createdAt: 1,
    updatedAt: null,
  };
}
