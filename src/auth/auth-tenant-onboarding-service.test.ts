import { afterEach, describe, expect, test } from 'bun:test';
import { hashToken } from '../tokens/token-utils';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveAuthBehaviorConfig } from './auth-config';
import { defineAuthTables } from './auth-schema';
import { resolveAuthTenantOnboardingConfig } from './auth-tenant-onboarding-config';
import { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import { AuthAuditService } from './auth-audit-service';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { createAuthorizationKernel } from './authorization-kernel';
import { TenancyService } from './tenancy/tenancy-service';
import { defineTenancyTables } from './tenancy/tenancy-schema';
import { TenantStore } from './tenancy/tenant-store';
import { UserPropertyService } from './user-property-service';
import { UserStore } from './user-store';
import { AuthError } from './types';

interface Harness {
  db: ReactiveDB;
  users: UserStore;
  tenancy: TenancyService;
  service: AuthTenantOnboardingService;
  now: { value: number };
}

const active: ReactiveDB[] = [];

afterEach(() => {
  for (const db of active.splice(0)) db.dispose();
});

describe('tenant invitation onboarding service', () => {
  test('fails cached onboarding reads and transaction writes after a profile change', async () => {
    const harness = await createHarness();
    const owner = await user(harness, 'profile-owner');
    const tenant = harness.tenancy.createTenant({
      name: 'Profile Tenant',
      slug: 'profile-tenant',
      ownerUserId: owner.userId,
    });
    let current = true;
    harness.users.setRuntimeProfileGuard(() => {
      if (!current) throw new Error('AUTH_PROFILE_CHANGED');
    });
    expect(harness.service.listInvitations({
      tenantId: tenant.tenant.tenantId,
    }).invitations).toEqual([]);

    current = false;
    expect(() => harness.service.listInvitations({
      tenantId: tenant.tenant.tenantId,
    })).toThrow('AUTH_PROFILE_CHANGED');
    expect(() => harness.service.issueInvitation({
      tenantId: tenant.tenant.tenantId,
      email: 'blocked@example.test',
      assertCurrentAuthority: authority(
        owner.userId,
        tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId,
      ),
    })).toThrow('AUTH_PROFILE_CHANGED');
    expect(harness.db.prepare(`SELECT COUNT(*) AS count
      FROM _auth_tenant_invitations`).get()).toEqual({ count: 0 });
  });

  test('hashes one-time invitation secrets and atomically admits the exact email', async () => {
    const harness = await createHarness();
    const owner = await user(harness, 'owner');
    const invited = await user(harness, 'invited');
    const tenant = harness.tenancy.createTenant({
      name: 'Alpha Clinic',
      slug: 'alpha-clinic',
      ownerUserId: owner.userId,
    });

    const created = harness.service.issueInvitation({
      tenantId: tenant.tenant.tenantId,
      email: ' Invited@Example.Test ',
      assertCurrentAuthority: authority(owner.userId, tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId),
    });
    expect(created.token).toStartWith('zinv_');
    expect(created.invitation).toMatchObject({
      email: 'invited@example.test',
      roles: ['member'],
      status: 'pending',
    });
    const stored = harness.db.prepare(`
      SELECT token_hash, role_keys_json FROM _auth_tenant_invitations
      WHERE invitation_id = ?
    `).get(created.invitation.invitationId) as {
      token_hash: string;
      role_keys_json: string;
    };
    expect(stored.token_hash).toBe(hashToken(created.token));
    expect(stored.token_hash).not.toContain(created.token);
    expect(JSON.parse(stored.role_keys_json)).toEqual(['member']);
    expect(harness.service.inspectInvitation(created.token)).toMatchObject({
      available: true,
      tenant: { name: 'Alpha Clinic', slug: 'alpha-clinic' },
      account: 'sign-in',
    });

    const accepted = harness.service.acceptInvitationForUser(
      created.token,
      invited.userId,
    );
    expect(accepted.membership).toMatchObject({
      tenantId: tenant.tenant.tenantId,
      userId: invited.userId,
      roleKey: 'member',
      status: 'active',
    });
    expect(() => harness.service.acceptInvitationForUser(
      created.token,
      invited.userId,
    )).toThrow('Invitation is unavailable');
    expect(harness.service.inspectInvitation(created.token)).toEqual({ available: false });
  });

  test('keeps invalid, expired, revoked, mismatched, and protected-role grants fail closed', async () => {
    const harness = await createHarness();
    const owner = await user(harness, 'owner');
    const invited = await user(harness, 'invited');
    const wrong = await user(harness, 'wrong');
    const tenant = harness.tenancy.createTenant({
      name: 'Alpha', slug: 'alpha', ownerUserId: owner.userId,
    });
    const issue = (email = invited.email) => harness.service.issueInvitation({
      tenantId: tenant.tenant.tenantId,
      email,
      ttlMs: 1_000,
      assertCurrentAuthority: authority(owner.userId, tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId),
    });

    expect(() => harness.service.issueInvitation({
      tenantId: tenant.tenant.tenantId,
      email: invited.email,
      roleKeys: ['owner'],
      assertCurrentAuthority: authority(owner.userId, tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId),
    })).toThrow('Protected roles');

    const mismatch = issue();
    expect(() => harness.service.acceptInvitationForUser(
      mismatch.token,
      wrong.userId,
    )).toThrow('Invitation is unavailable');
    expect(harness.service.inspectInvitation(mismatch.token)).toMatchObject({ available: true });

    const replacement = issue();
    expect(harness.service.inspectInvitation(mismatch.token)).toEqual({ available: false });
    harness.now.value += 1_001;
    expect(harness.service.inspectInvitation(replacement.token)).toEqual({ available: false });
    expect(harness.service.listInvitations({
      tenantId: tenant.tenant.tenantId,
      status: 'expired',
    }).invitations).toHaveLength(1);

    const revocable = issue();
    const revoked = harness.service.revokeInvitation({
      tenantId: tenant.tenant.tenantId,
      invitationId: revocable.invitation.invitationId,
      assertCurrentAuthority: authority(owner.userId, tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId),
    });
    expect(revoked.status).toBe('revoked');
    expect(harness.service.inspectInvitation(revocable.token)).toEqual({ available: false });
    expect(() => harness.service.acceptInvitationForUser(
      'zinv_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      invited.userId,
    )).toThrow('Invitation is unavailable');
  });

  test('creates an invitation-bound account without consulting public registration', async () => {
    const harness = await createHarness();
    const owner = await user(harness, 'owner');
    const tenant = harness.tenancy.createTenant({
      name: 'Alpha', slug: 'alpha', ownerUserId: owner.userId,
    });
    const created = harness.service.issueInvitation({
      tenantId: tenant.tenant.tenantId,
      email: 'new@example.test',
      assertCurrentAuthority: authority(owner.userId, tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId),
    });
    const accepted = await harness.service.createInvitationAccount({
      token: created.token,
      username: 'new-person',
      email: 'NEW@example.test',
      password: 'password123',
      mfaRequired: false,
      properties: {},
    });
    if ('invitationAcceptancePending' in accepted) {
      throw new Error('Expected immediate invitation acceptance');
    }
    expect(accepted.user).toMatchObject({
      username: 'new-person',
      email: 'new@example.test',
      role: 'user',
      emailVerificationRequired: false,
    });
    expect(accepted.user.emailVerifiedAt).toBeNumber();
    expect(accepted.membership.tenantId).toBe(tenant.tenant.tenantId);

    const collision = await user(harness, 'collision');
    const collisionInvite = harness.service.issueInvitation({
      tenantId: tenant.tenant.tenantId,
      email: collision.email,
      assertCurrentAuthority: authority(owner.userId, tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId),
    });
    await expect(harness.service.createInvitationAccount({
      token: collisionInvite.token,
      username: 'collision-new',
      email: collision.email,
      password: 'password123',
      mfaRequired: false,
      properties: {},
    })).rejects.toMatchObject({ code: 'TENANT_INVITATION_ACCOUNT_AUTH_REQUIRED' });
    expect(harness.tenancy.getMembership(tenant.tenant.tenantId, collision.userId)).toBeNull();
  });

  test('retains idempotent join requests and scopes review by the active tenant', async () => {
    const harness = await createHarness();
    const alphaOwner = await user(harness, 'alpha-owner');
    const betaOwner = await user(harness, 'beta-owner');
    const applicant = await user(harness, 'applicant');
    const alpha = harness.tenancy.createTenant({
      name: 'Alpha', slug: 'alpha', ownerUserId: alphaOwner.userId,
    });
    const beta = harness.tenancy.createTenant({
      name: 'Beta', slug: 'beta', ownerUserId: betaOwner.userId,
    });

    expect(harness.service.submitJoinRequest({
      userId: applicant.userId,
      tenantSlug: 'alpha',
    })).toEqual({ submitted: true });
    harness.service.submitJoinRequest({ userId: applicant.userId, tenantSlug: 'alpha' });
    expect(harness.service.submitJoinRequest({
      userId: applicant.userId,
      tenantSlug: 'does-not-exist',
    })).toEqual({ submitted: true });

    const page = harness.service.listJoinRequests({
      tenantId: alpha.tenant.tenantId,
      status: 'pending',
    });
    expect(page.requests).toHaveLength(1);
    const request = page.requests[0]!;
    expect(request).toMatchObject({
      applicant: { userId: applicant.userId, email: applicant.email },
      status: 'pending',
      requestRevision: 1,
      membership: null,
      approvalPolicy: {
        canApprove: false,
        roleSelection: { mode: 'default', roles: [{ key: 'member', label: 'Member' }] },
      },
    });

    expect(() => harness.service.approveJoinRequest({
      tenantId: beta.tenant.tenantId,
      joinRequestId: request.joinRequestId,
      expectedRequestRevision: request.requestRevision,
      assertCurrentAuthority: authority(betaOwner.userId, beta.ownerMembership.membershipId,
        beta.tenant.tenantId),
    })).toThrow('Join request not found');

    expect(() => harness.service.approveJoinRequest({
      tenantId: alpha.tenant.tenantId,
      joinRequestId: request.joinRequestId,
      expectedRequestRevision: request.requestRevision,
      roleKeys: ['member'],
      assertCurrentAuthority: authority(alphaOwner.userId, alpha.ownerMembership.membershipId,
        alpha.tenant.tenantId),
    })).toThrow('server-owned default role');

    const approved = harness.service.approveJoinRequest({
      tenantId: alpha.tenant.tenantId,
      joinRequestId: request.joinRequestId,
      expectedRequestRevision: request.requestRevision,
      assertCurrentAuthority: authority(alphaOwner.userId, alpha.ownerMembership.membershipId,
        alpha.tenant.tenantId),
    });
    expect(approved).toMatchObject({
      status: 'approved',
      membership: { status: 'active', roles: ['member'] },
      approvalPolicy: {
        canApprove: true,
        roleSelection: { mode: 'default', roles: [{ key: 'member', label: 'Member' }] },
      },
    });
    expect(harness.service.approveJoinRequest({
      tenantId: alpha.tenant.tenantId,
      joinRequestId: request.joinRequestId,
      expectedRequestRevision: request.requestRevision,
      assertCurrentAuthority: authority(alphaOwner.userId, alpha.ownerMembership.membershipId,
        alpha.tenant.tenantId),
    })).toEqual(approved);
  });

  test('rejects stale approve and deny decisions after a request reopens', async () => {
    const harness = await createHarness();
    const owner = await user(harness, 'revision-owner');
    const applicant = await user(harness, 'revision-applicant');
    const tenant = harness.tenancy.createTenant({
      name: 'Revision', slug: 'revision', ownerUserId: owner.userId,
    });
    const assertCurrentAuthority = authority(
      owner.userId,
      tenant.ownerMembership.membershipId,
      tenant.tenant.tenantId,
    );
    harness.service.submitJoinRequest({
      userId: applicant.userId,
      tenantSlug: tenant.tenant.slug,
    });
    const first = harness.service.listJoinRequests({
      tenantId: tenant.tenant.tenantId,
      status: 'pending',
    }).requests[0]!;
    const denied = harness.service.denyJoinRequest({
      tenantId: tenant.tenant.tenantId,
      joinRequestId: first.joinRequestId,
      expectedRequestRevision: first.requestRevision,
      assertCurrentAuthority,
    });
    expect(harness.service.denyJoinRequest({
      tenantId: tenant.tenant.tenantId,
      joinRequestId: first.joinRequestId,
      expectedRequestRevision: first.requestRevision,
      assertCurrentAuthority,
    })).toEqual(denied);
    harness.service.submitJoinRequest({
      userId: applicant.userId,
      tenantSlug: tenant.tenant.slug,
    });
    const reopened = harness.service.listJoinRequests({
      tenantId: tenant.tenant.tenantId,
      status: 'pending',
    }).requests[0]!;
    expect(reopened.requestRevision).toBe(first.requestRevision + 1);

    for (const decide of [
      () => harness.service.approveJoinRequest({
        tenantId: tenant.tenant.tenantId,
        joinRequestId: first.joinRequestId,
        expectedRequestRevision: first.requestRevision,
        assertCurrentAuthority,
      }),
      () => harness.service.denyJoinRequest({
        tenantId: tenant.tenant.tenantId,
        joinRequestId: first.joinRequestId,
        expectedRequestRevision: first.requestRevision,
        assertCurrentAuthority,
      }),
    ]) {
      try {
        decide();
        throw new Error('Expected stale join-request decision to fail');
      } catch (error) {
        expect(error).toMatchObject({
          code: 'TENANT_JOIN_REQUEST_REVISION_CONFLICT',
          status: 409,
        });
      }
    }
    expect(harness.service.listJoinRequests({
      tenantId: tenant.tenant.tenantId,
      status: 'pending',
    }).requests[0]!.requestRevision).toBe(reopened.requestRevision);
  });

  test('fences invitation and join-review mutations at their transaction boundary', async () => {
    const harness = await createHarness();
    const owner = await user(harness, 'fence-owner');
    const invited = await user(harness, 'fence-invited');
    const applicant = await user(harness, 'fence-applicant');
    const tenant = harness.tenancy.createTenant({
      name: 'Fence', slug: 'fence', ownerUserId: owner.userId,
    });
    const current = authority(
      owner.userId,
      tenant.ownerMembership.membershipId,
      tenant.tenant.tenantId,
    );
    const changed = () => {
      throw new AuthError(
        'Authorization changed before the operation could commit',
        'AUTHORIZATION_CHANGED',
        409,
      );
    };

    expect(() => harness.service.issueInvitation({
      tenantId: tenant.tenant.tenantId,
      email: invited.email,
      assertCurrentAuthority: changed,
    })).toThrow('Authorization changed');
    expect(harness.service.listInvitations({
      tenantId: tenant.tenant.tenantId,
    }).invitations).toHaveLength(0);

    const invitation = harness.service.issueInvitation({
      tenantId: tenant.tenant.tenantId,
      email: invited.email,
      assertCurrentAuthority: current,
    });
    expect(() => harness.service.revokeInvitation({
      tenantId: tenant.tenant.tenantId,
      invitationId: invitation.invitation.invitationId,
      assertCurrentAuthority: changed,
    })).toThrow('Authorization changed');
    expect(harness.service.listInvitations({
      tenantId: tenant.tenant.tenantId,
      status: 'pending',
    }).invitations).toHaveLength(1);

    harness.service.submitJoinRequest({
      userId: applicant.userId,
      tenantSlug: tenant.tenant.slug,
    });
    const pending = harness.service.listJoinRequests({
      tenantId: tenant.tenant.tenantId,
      status: 'pending',
    }).requests[0]!;
    expect(() => harness.service.approveJoinRequest({
      tenantId: tenant.tenant.tenantId,
      joinRequestId: pending.joinRequestId,
      expectedRequestRevision: pending.requestRevision,
      assertCurrentAuthority: changed,
    })).toThrow('Authorization changed');
    expect(harness.tenancy.getMembership(
      tenant.tenant.tenantId,
      applicant.userId,
    )).toBeNull();
    expect(() => harness.service.denyJoinRequest({
      tenantId: tenant.tenant.tenantId,
      joinRequestId: pending.joinRequestId,
      expectedRequestRevision: pending.requestRevision,
      assertCurrentAuthority: changed,
    })).toThrow('Authorization changed');
    expect(harness.service.listJoinRequests({
      tenantId: tenant.tenant.tenantId,
      status: 'pending',
    }).requests).toHaveLength(1);
  });
});

async function createHarness(): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  active.push(db);
  defineAuthTables(db);
  defineTenancyTables(db);
  const auth = resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: 'simple',
    bootstrap: 'public',
    registration: { mode: 'disabled' },
  });
  const users = new UserStore(db);
  const tenancy = new TenancyService(new TenantStore(db));
  const kernel = createAuthorizationKernel({
    tenancy: auth.tenancy,
    authorization: auth.authorization,
    userProperties: auth.userProperties,
  });
  const now = { value: 1_700_000_000_000 };
  return {
    db,
    users,
    tenancy,
    now,
    service: new AuthTenantOnboardingService(
      db,
      resolveAuthTenantOnboardingConfig(undefined),
      kernel,
      users,
      new UserPropertyService(auth),
      tenancy,
      null,
      new AuthAuditService(db, resolveAuthAuditConfig(undefined)),
      () => now.value,
    ),
  };
}

async function user(harness: Harness, key: string) {
  return harness.users.createUser({
    username: key,
    email: `${key}@example.test`,
    password: 'password123',
    role: key.includes('owner') ? 'admin' : 'user',
    status: 'active',
    emailVerifiedAt: Date.now(),
  });
}

function authority(userId: string, membershipId: string, tenantId: string) {
  return () => ({
    auth: {
      userId,
      email: `${userId}@example.test`,
      role: 'admin',
    },
    scope: {
      tenancy: 'multi' as const,
      mode: 'simple' as const,
      scopeKind: 'tenant' as const,
      scopeId: tenantId,
      tenantId,
      membershipId,
      roles: ['owner'],
      permissions: [],
      allPermissions: true,
      revision: 'test',
    },
  });
}
