import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { hashToken } from '../tokens/token-utils';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';
import { captureAuthTenantMutationAuthority } from './auth-tenant-mutation-authority';
import { generateTotpCode } from './mfa-totp';
import type { AuthAuthorizationConfig } from './types';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
  owner: Session;
}

interface Session {
  user: { userId: string; email: string };
  tenant: { tenantId: string; membershipId: string; slug?: string };
  accessToken: string;
  refreshToken: string;
}

interface HttpResult {
  status: number;
  body: Record<string, any>;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

describe('tenant invitation and join-request HTTP ceremonies', () => {
  test('creates an invite-bound account while ordinary public registration stays disabled', async () => {
    const harness = await start();
    const issued = await request(harness, 'POST', '/auth/tenant/invitations', {
      email: 'new-person@example.test',
      expiresIn: '2d',
    }, harness.owner.accessToken);
    expect(issued.status).toBe(200);
    expect(issued.body.invitation).toMatchObject({
      email: 'new-person@example.test',
      roles: ['member'],
      status: 'pending',
    });
    expect(issued.body.token).toStartWith('zinv_');
    const persisted = harness.db.prepare(`
      SELECT token_hash FROM _auth_tenant_invitations WHERE invitation_id = ?
    `).get(issued.body.invitation.invitationId) as { token_hash: string };
    expect(persisted.token_hash).toBe(hashToken(issued.body.token));
    expect(JSON.stringify(persisted)).not.toContain(issued.body.token);

    const inspect = await request(harness, 'POST', '/auth/invitations/inspect', {
      token: issued.body.token,
    });
    expect(inspect).toMatchObject({
      status: 200,
      body: {
        available: true,
        tenant: { name: 'Owner organization', slug: 'owner-organization' },
        account: 'create',
      },
    });

    const accepted = await request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.body.token,
      username: 'new-person',
      email: 'NEW-PERSON@example.test',
      password: 'password123',
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      invitationAccepted: true,
      user: { username: 'new-person', email: 'new-person@example.test', role: 'user' },
      activeTenant: { tenantId: harness.owner.tenant.tenantId, role: 'member' },
      acceptedTenant: {
        tenantId: harness.owner.tenant.tenantId,
        name: 'Owner organization',
      },
    });
    expect(accepted.body.accessToken).toBeString();
    expect(accepted.body.refreshToken).toBeString();
    await expect(harness.runtime.getTokenService()!.resolveAuthContext(
      accepted.body.accessToken,
    )).resolves.toMatchObject({
      userId: accepted.body.user.userId,
      tenantId: harness.owner.tenant.tenantId,
      membershipId: accepted.body.acceptedTenant.membershipId,
    });

    const replay = await request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.body.token,
    }, accepted.body.accessToken);
    expect(replay).toMatchObject({
      status: 400,
      body: { code: 'TENANT_INVITATION_UNAVAILABLE' },
    });
    const registration = await request(harness, 'POST', '/auth/register', {
      username: 'ordinary',
      email: 'ordinary@example.test',
      password: 'password123',
    });
    expect(registration).toMatchObject({
      status: 403,
      body: { code: 'REGISTRATION_DISABLED' },
    });
  }, 60_000);

  test('requires the exact existing identity and consumes a continuation once', async () => {
    const harness = await start();
    const existing = await createIdentity(harness, 'existing');
    const wrong = await createIdentity(harness, 'wrong');
    const issued = await issue(harness, existing.email);
    harness.runtime.getStore()!.updateUser(existing.userId, { mfaRequired: true });

    const passwordOnly = await request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.token,
      email: existing.email,
      password: 'password123',
    });
    expect(passwordOnly).toMatchObject({
      status: 401,
      body: { code: 'TENANT_INVITATION_IDENTITY_PROOF_REQUIRED' },
    });
    expect(harness.runtime.getTenancyService()!.getMembership(
      harness.owner.tenant.tenantId,
      existing.userId,
    )).toBeNull();
    harness.runtime.getStore()!.updateUser(existing.userId, { mfaRequired: false });
    const wrongLogin = await request(harness, 'POST', '/auth/login', {
      username: wrong.email,
      password: 'password123',
    });
    const mismatch = await request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.token,
      continuation: wrongLogin.body.onboarding.tenantCreation.continuation,
    });
    expect(mismatch).toMatchObject({
      status: 400,
      body: { code: 'TENANT_INVITATION_UNAVAILABLE' },
    });
    expect((await request(harness, 'POST', '/auth/invitations/inspect', {
      token: issued.token,
    })).body.available).toBe(true);

    const collision = await request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.token,
      username: 'duplicate-attempt',
      email: existing.email,
      password: 'password123',
    });
    expect(collision).toMatchObject({
      status: 409,
      body: { code: 'TENANT_INVITATION_ACCOUNT_AUTH_REQUIRED' },
    });

    const login = await request(harness, 'POST', '/auth/login', {
      username: existing.email,
      password: 'password123',
    });
    expect(login.body.tenantOnboardingRequired).toBe(true);
    const continuation = login.body.onboarding.tenantCreation.continuation;
    const accepted = await request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.token,
      continuation,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.activeTenant.tenantId).toBe(harness.owner.tenant.tenantId);

    const reused = await request(harness, 'POST', '/auth/tenant-join-requests', {
      tenantSlug: 'owner-organization',
      continuation,
    });
    expect(reused).toMatchObject({
      status: 400,
      body: { code: 'TENANT_ONBOARDING_PROOF_INVALID' },
    });
  }, 60_000);

  test('keeps a new account invitation pending until required MFA completes', async () => {
    const harness = await startRequiredMfa();
    const service = harness.runtime.getTenantOnboardingService()!;
    const issued = service.issueInvitation({
      tenantId: harness.owner.tenant.tenantId,
      email: 'mfa-invited@example.test',
      assertCurrentAuthority: await ownerMutationAuthority(harness),
    });
    const pending = await request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.token,
      username: 'mfa-invited',
      email: 'mfa-invited@example.test',
      password: 'password123',
    });
    expect(pending).toMatchObject({
      status: 200,
      body: {
        invitationAcceptancePending: true,
        mfaSetupRequired: true,
      },
    });
    expect(pending.body.invitationAccepted).toBeUndefined();
    const invited = harness.runtime.getStore()!.getUserByEmail(
      'mfa-invited@example.test',
    )!;
    expect(harness.runtime.getTenancyService()!.getMembership(
      harness.owner.tenant.tenantId,
      invited.userId,
    )).toBeNull();
    expect(harness.db.prepare(`
      SELECT status, accepted_by_user_id FROM _auth_tenant_invitations
      WHERE invitation_id = ?
    `).get(issued.invitation.invitationId)).toEqual({
      status: 'pending',
      accepted_by_user_id: null,
    });

    const setup = await request(harness, 'POST', '/auth/mfa/setup', {
      setupToken: pending.body.mfaSetupToken,
      method: 'totp',
    });
    expect(setup.status).toBe(200);
    const verified = await request(harness, 'POST', '/auth/mfa/setup/verify', {
      verificationToken: setup.body.verificationToken,
      code: generateTotpCode({ secret: setup.body.totp.secret }),
    });
    expect(verified).toMatchObject({
      status: 200,
      body: {
        tenantOnboardingRequired: true,
        onboarding: {
          reason: 'no_active_tenant_membership',
          tenantCreation: { allowed: false },
        },
      },
    });
    expect(verified.body.onboarding.continuation).toStartWith('zct_');
    expect(verified.body.accessToken).toBeUndefined();

    const accepted = await request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.token,
      continuation: verified.body.onboarding.continuation,
    });
    expect(accepted).toMatchObject({
      status: 200,
      body: {
        invitationAccepted: true,
        activeTenant: { tenantId: harness.owner.tenant.tenantId },
      },
    });
    expect(accepted.body.accessToken).toBeString();
    expect(harness.runtime.getTenancyService()!.getMembership(
      harness.owner.tenant.tenantId,
      invited.userId,
    )).toMatchObject({ status: 'active', roleKey: 'member' });

    const replay = await request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.token,
      continuation: verified.body.onboarding.continuation,
    });
    expect(replay).toMatchObject({
      status: 400,
      body: { code: 'TENANT_ONBOARDING_PROOF_INVALID' },
    });
  }, 60_000);

  test('serializes concurrent acceptance and leaves one winning membership', async () => {
    const harness = await start();
    const existing = await createIdentity(harness, 'concurrent');
    const issued = await issue(harness, existing.email);
    const secondaryOwner = await createIdentity(harness, 'concurrent-secondary', 'admin');
    const secondary = harness.runtime.getTenancyService()!.createTenant({
      name: 'Secondary', slug: 'secondary', ownerUserId: secondaryOwner.userId,
    });
    harness.runtime.getTenancyService()!.addMembership({
      tenantId: secondary.tenant.tenantId,
      userId: existing.userId,
      roleKey: 'member',
      createdBy: secondaryOwner.userId,
    });
    const login = await request(harness, 'POST', '/auth/login', {
      username: existing.email,
      password: 'password123',
    });
    expect(login.body.accessToken).toBeString();
    const accept = () => request(harness, 'POST', '/auth/invitations/accept', {
      token: issued.token,
    }, login.body.accessToken);
    const results = await Promise.all([accept(), accept()]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    expect(harness.runtime.getTenancyService()!.getMembership(
      harness.owner.tenant.tenantId,
      existing.userId,
    )).toMatchObject({ status: 'active', roleKey: 'member' });
    expect((harness.db.prepare(`
      SELECT COUNT(*) AS count FROM _auth_tenant_memberships
      WHERE tenant_id = ? AND user_id = ?
    `).get(harness.owner.tenant.tenantId, existing.userId) as { count: number }).count)
      .toBe(1);
  }, 60_000);

  test('isolates opaque ids, rejects owner injection, and requires explicit re-admission', async () => {
    const harness = await start();
    const applicant = await createIdentity(harness, 'applicant');
    const membership = harness.runtime.getTenancyService()!.addMembership({
      tenantId: harness.owner.tenant.tenantId,
      userId: applicant.userId,
      roleKey: 'member',
      createdBy: harness.owner.user.userId,
    });
    const suspended = harness.runtime.getTenancyService()!.suspendMembership(
      membership.membershipId,
    );
    expect(suspended.status).toBe('suspended');

    const login = await request(harness, 'POST', '/auth/login', {
      username: applicant.email,
      password: 'password123',
    });
    const continuation = login.body.onboarding.tenantCreation.continuation;
    const submitted = await request(harness, 'POST', '/auth/tenant-join-requests', {
      tenantSlug: 'owner-organization',
      continuation,
      tenantId: 'forged-tenant',
    });
    // Elysia strips unknown input; the slug resolver and server-owned tenant
    // row remain the only target authority.
    expect(submitted.status).toBe(202);

    const loginAgain = await request(harness, 'POST', '/auth/login', {
      username: applicant.email,
      password: 'password123',
    });
    const validSubmit = await request(harness, 'POST', '/auth/tenant-join-requests', {
      tenantSlug: 'owner-organization',
      continuation: loginAgain.body.onboarding.tenantCreation.continuation,
    });
    expect(validSubmit.status).toBe(202);
    const listed = await request(
      harness,
      'GET',
      '/auth/tenant/join-requests?status=pending',
      undefined,
      harness.owner.accessToken,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.requests).toHaveLength(1);
    expect(listed.body.requests[0].approvalPolicy).toEqual({
      canApprove: true,
      roleSelection: {
        mode: 'default',
        roles: [{ key: 'member', label: 'Member' }],
      },
    });
    const joinRequestId = listed.body.requests[0].joinRequestId;
    const requestRevision = listed.body.requests[0].requestRevision;

    const missingApproveRevision = await request(
      harness,
      'POST',
      `/auth/tenant/join-requests/${joinRequestId}/approve`,
      {},
      harness.owner.accessToken,
    );
    expect(missingApproveRevision.status).toBe(422);
    const missingDenyRevision = await request(
      harness,
      'POST',
      `/auth/tenant/join-requests/${joinRequestId}/deny`,
      {},
      harness.owner.accessToken,
    );
    expect(missingDenyRevision.status).toBe(422);

    const ownerInjection = await request(
      harness,
      'POST',
      `/auth/tenant/join-requests/${joinRequestId}/approve`,
      { expectedRequestRevision: requestRevision, roles: ['owner'], reactivateMembership: true },
      harness.owner.accessToken,
    );
    expect(ownerInjection).toMatchObject({
      status: 409,
      body: { code: 'TENANT_JOIN_REQUEST_ROLE_SERVER_OWNED' },
    });
    const implicit = await request(
      harness,
      'POST',
      `/auth/tenant/join-requests/${joinRequestId}/approve`,
      { expectedRequestRevision: requestRevision },
      harness.owner.accessToken,
    );
    expect(implicit).toMatchObject({
      status: 409,
      body: { code: 'TENANT_JOIN_REACTIVATION_REQUIRED' },
    });

    const betaOwner = await createIdentity(harness, 'beta-owner', 'admin');
    const beta = harness.runtime.getTenancyService()!.createTenant({
      name: 'Beta', slug: 'beta', ownerUserId: betaOwner.userId,
    });
    const betaLogin = await request(harness, 'POST', '/auth/login', {
      username: betaOwner.email,
      password: 'password123',
    });
    expect(betaLogin.status).toBe(200);
    const crossTenant = await request(
      harness,
      'POST',
      `/auth/tenant/join-requests/${joinRequestId}/approve`,
      { expectedRequestRevision: requestRevision },
      betaLogin.body.accessToken,
    );
    expect(crossTenant).toMatchObject({
      status: 404,
      body: { code: 'TENANT_JOIN_REQUEST_NOT_FOUND' },
    });
    expect(betaLogin.body.activeTenant.tenantId).toBe(beta.tenant.tenantId);

    const approved = await request(
      harness,
      'POST',
      `/auth/tenant/join-requests/${joinRequestId}/approve`,
      { expectedRequestRevision: requestRevision, reactivateMembership: true },
      harness.owner.accessToken,
    );
    expect(approved).toMatchObject({
      status: 200,
      body: {
        request: {
          status: 'approved',
          membership: { status: 'active' },
          approvalPolicy: {
            canApprove: true,
            roleSelection: { mode: 'default', roles: [{ key: 'member' }] },
          },
        },
      },
    });
    const live = harness.runtime.getTenancyService()!.getMembershipById(
      membership.membershipId,
    )!;
    expect(live.authorizationGeneration).toBeGreaterThan(
      suspended.authorizationGeneration,
    );
    expect(live.roleKey).toBe('member');

    const idempotent = await request(
      harness,
      'POST',
      `/auth/tenant/join-requests/${joinRequestId}/approve`,
      { expectedRequestRevision: requestRevision, reactivateMembership: true },
      harness.owner.accessToken,
    );
    expect(idempotent.status).toBe(200);
    expect(idempotent.body.request).toEqual(approved.body.request);
  }, 60_000);

  test('projects only live-ceiling role choices and preserves them after approval', async () => {
    const harness = await start({
      mode: 'advanced',
      permissions: {
        'billing:manage': { label: 'Manage billing' },
      },
      roles: {
        reviewer: {
          label: 'Join reviewer',
          permissions: [
            'tenant:read',
            'tenant.members:read',
            'tenant.roles:read',
            'tenant.roles:manage',
            'tenant.join-requests:review',
          ],
        },
        'limited-reviewer': {
          label: 'Limited reviewer',
          permissions: ['tenant.join-requests:review'],
        },
        'billing-admin': {
          label: 'Billing administrator',
          permissions: ['billing:manage'],
        },
      },
    });
    const reviewer = await createIdentity(harness, 'approval-reviewer');
    const added = await request(harness, 'POST', '/auth/tenant/members', {
      email: reviewer.email,
      roles: ['reviewer'],
    }, harness.owner.accessToken);
    expect(added.status).toBe(200);
    const reviewerLogin = await request(harness, 'POST', '/auth/login', {
      username: reviewer.email,
      password: 'password123',
    });
    expect(reviewerLogin.status).toBe(200);

    const manager = await createIdentity(harness, 'approval-manager');
    const managerAdded = await request(harness, 'POST', '/auth/tenant/members', {
      email: manager.email,
      roles: ['manager'],
    }, harness.owner.accessToken);
    expect(managerAdded.status).toBe(200);
    const managerLogin = await request(harness, 'POST', '/auth/login', {
      username: manager.email,
      password: 'password123',
    });
    expect(managerLogin.status).toBe(200);

    const limitedReviewer = await createIdentity(harness, 'approval-limited-reviewer');
    const limitedAdded = await request(harness, 'POST', '/auth/tenant/members', {
      email: limitedReviewer.email,
      roles: ['limited-reviewer'],
    }, harness.owner.accessToken);
    expect(limitedAdded.status).toBe(200);
    const limitedLogin = await request(harness, 'POST', '/auth/login', {
      username: limitedReviewer.email,
      password: 'password123',
    });
    expect(limitedLogin.status).toBe(200);

    const applicant = await createIdentity(harness, 'approval-applicant');
    harness.runtime.getTenantOnboardingService()!.submitJoinRequest({
      userId: applicant.userId,
      tenantSlug: harness.owner.tenant.slug!,
    });
    const managerList = await request(
      harness,
      'GET',
      '/auth/tenant/join-requests?status=pending',
      undefined,
      managerLogin.body.accessToken,
    );
    expect(managerList.status).toBe(200);
    expect(managerList.body.requests[0].approvalPolicy).toEqual({
      canApprove: true,
      roleSelection: {
        mode: 'default',
        roles: [{ key: 'member', label: 'Member' }],
      },
    });
    const limitedList = await request(
      harness,
      'GET',
      '/auth/tenant/join-requests?status=pending',
      undefined,
      limitedLogin.body.accessToken,
    );
    expect(limitedList.status).toBe(200);
    expect(limitedList.body.requests[0].approvalPolicy).toEqual({
      canApprove: false,
      roleSelection: {
        mode: 'default',
        roles: [{ key: 'member', label: 'Member' }],
      },
    });
    const listed = await request(
      harness,
      'GET',
      '/auth/tenant/join-requests?status=pending',
      undefined,
      reviewerLogin.body.accessToken,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.requests).toHaveLength(1);
    const pending = listed.body.requests[0];
    expect(pending.approvalPolicy).toEqual({
      canApprove: true,
      roleSelection: {
        mode: 'selectable',
        defaultRoleKeys: ['member'],
        maxRoleCount: 32,
        roles: [
          { key: 'limited-reviewer', label: 'Limited reviewer' },
          { key: 'member', label: 'Member' },
          { key: 'reviewer', label: 'Join reviewer' },
        ],
      },
    });

    const escalation = await request(
      harness,
      'POST',
      `/auth/tenant/join-requests/${pending.joinRequestId}/approve`,
      { expectedRequestRevision: pending.requestRevision, roles: ['billing-admin'] },
      reviewerLogin.body.accessToken,
    );
    expect(escalation).toMatchObject({
      status: 403,
      body: { code: 'TENANT_ROLE_ESCALATION_FORBIDDEN' },
    });

    const approved = await request(
      harness,
      'POST',
      `/auth/tenant/join-requests/${pending.joinRequestId}/approve`,
      { expectedRequestRevision: pending.requestRevision, roles: ['member'] },
      reviewerLogin.body.accessToken,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.request.approvalPolicy).toEqual(pending.approvalPolicy);
    expect(approved.body.request.membership.roles).toEqual(['member']);
  }, 60_000);

  test('scopes invitation revocation to the live tenant', async () => {
    const harness = await start();
    const issued = await issue(harness, 'target@example.test');
    const betaOwner = await createIdentity(harness, 'revoke-beta-owner', 'admin');
    harness.runtime.getTenancyService()!.createTenant({
      name: 'Revoke Beta', slug: 'revoke-beta', ownerUserId: betaOwner.userId,
    });
    const login = await request(harness, 'POST', '/auth/login', {
      username: betaOwner.email,
      password: 'password123',
    });
    const cross = await request(
      harness,
      'DELETE',
      `/auth/tenant/invitations/${issued.invitation.invitationId}`,
      undefined,
      login.body.accessToken,
    );
    expect(cross).toMatchObject({
      status: 404,
      body: { code: 'TENANT_INVITATION_NOT_FOUND' },
    });
    expect((await request(harness, 'POST', '/auth/invitations/inspect', {
      token: issued.token,
    })).body.available).toBe(true);
  }, 60_000);

  test('rejects invitation revocation when the actor session is revoked after HTTP auth', async () => {
    const harness = await start();
    const issued = await issue(harness, 'commit-boundary@example.test');
    const auth = await harness.runtime.getTokenService()!.resolveAuthContext(
      harness.owner.accessToken,
    );
    if (!auth?.sessionId) throw new Error('Owner session authority was not resolved');
    const sessionId = auth.sessionId;

    const service = harness.runtime.getTenantOnboardingService()!;
    const revokeInvitation = service.revokeInvitation.bind(service);
    let intercepted = false;
    (service as any).revokeInvitation = (input: any) => {
      intercepted = true;
      harness.runtime.getAuthSessionService()!.revoke(
        sessionId,
        'commit-boundary-test',
      );
      return revokeInvitation(input);
    };
    let result: HttpResult;
    try {
      result = await request(
        harness,
        'DELETE',
        `/auth/tenant/invitations/${issued.invitation.invitationId}`,
        undefined,
        harness.owner.accessToken,
      );
    } finally {
      (service as any).revokeInvitation = revokeInvitation;
    }

    expect(intercepted).toBe(true);
    expect(result!).toMatchObject({
      status: 409,
      body: { code: 'AUTHORIZATION_CHANGED' },
    });
    expect((await request(harness, 'POST', '/auth/invitations/inspect', {
      token: issued.token,
    }))).toMatchObject({
      status: 200,
      body: { available: true },
    });
  }, 60_000);

  test('revalidates bearer identity before invitation acceptance and join-request commit', async () => {
    const harness = await start();
    const existing = await createIdentity(harness, 'identity-commit');
    const secondaryOwner = await createIdentity(
      harness,
      'identity-commit-owner',
      'admin',
    );
    const secondary = harness.runtime.getTenancyService()!.createTenant({
      name: 'Identity Commit Secondary',
      slug: 'identity-commit-secondary',
      ownerUserId: secondaryOwner.userId,
    });
    harness.runtime.getTenancyService()!.addMembership({
      tenantId: secondary.tenant.tenantId,
      userId: existing.userId,
      roleKey: 'member',
      createdBy: secondaryOwner.userId,
    });
    const issued = await issue(harness, existing.email);
    const service = harness.runtime.getTenantOnboardingService()!;

    const loginForAcceptance = await request(harness, 'POST', '/auth/login', {
      username: existing.email,
      password: 'password123',
    });
    const acceptanceAuth = await harness.runtime.getTokenService()!.resolveAuthContext(
      loginForAcceptance.body.accessToken,
    );
    if (!acceptanceAuth?.sessionId) {
      throw new Error('Invitation identity session authority was not resolved');
    }
    const acceptInvitation = service.acceptInvitationForUser.bind(service);
    (service as any).acceptInvitationForUser = (...args: any[]) => {
      harness.runtime.getAuthSessionService()!.revoke(
        acceptanceAuth.sessionId!,
        'identity-commit-boundary-test',
      );
      return acceptInvitation(...args as Parameters<typeof acceptInvitation>);
    };
    let acceptance: HttpResult;
    try {
      acceptance = await request(harness, 'POST', '/auth/invitations/accept', {
        token: issued.token,
      }, loginForAcceptance.body.accessToken);
    } finally {
      (service as any).acceptInvitationForUser = acceptInvitation;
    }
    expect(acceptance!).toMatchObject({
      status: 400,
      body: { code: 'TENANT_INVITATION_UNAVAILABLE' },
    });
    expect(harness.runtime.getTenancyService()!.getMembership(
      harness.owner.tenant.tenantId,
      existing.userId,
    )).toBeNull();
    expect((await request(harness, 'POST', '/auth/invitations/inspect', {
      token: issued.token,
    })).body.available).toBe(true);

    const loginForJoin = await request(harness, 'POST', '/auth/login', {
      username: existing.email,
      password: 'password123',
    });
    const joinAuth = await harness.runtime.getTokenService()!.resolveAuthContext(
      loginForJoin.body.accessToken,
    );
    if (!joinAuth?.sessionId) {
      throw new Error('Join-request identity session authority was not resolved');
    }
    const submitJoinRequest = service.submitJoinRequest.bind(service);
    (service as any).submitJoinRequest = (input: any) => {
      harness.runtime.getAuthSessionService()!.revoke(
        joinAuth.sessionId!,
        'identity-commit-boundary-test',
      );
      return submitJoinRequest(input);
    };
    let submitted: HttpResult;
    try {
      submitted = await request(harness, 'POST', '/auth/tenant-join-requests', {
        tenantSlug: 'owner-organization',
      }, loginForJoin.body.accessToken);
    } finally {
      (service as any).submitJoinRequest = submitJoinRequest;
    }
    expect(submitted!).toMatchObject({
      status: 400,
      body: { code: 'TENANT_ONBOARDING_PROOF_INVALID' },
    });
    expect(service.listJoinRequests({
      tenantId: harness.owner.tenant.tenantId,
      status: 'pending',
    }).requests).toEqual([]);
  }, 60_000);

  test('re-resolves actor properties before invitation issue and join-request review commits', async () => {
    const harness = await start();
    const service = harness.runtime.getTenantOnboardingService()!;
    const store = harness.runtime.getStore()!;
    let propertyRevision = 0;
    const changeActorProperty = () => store.setProperty(
      harness.owner.user.userId,
      'commit-boundary-revision',
      String(++propertyRevision),
    );

    const issueInvitation = service.issueInvitation.bind(service);
    (service as any).issueInvitation = (input: any) => {
      changeActorProperty();
      return issueInvitation(input);
    };
    let issueResult: HttpResult;
    try {
      issueResult = await request(harness, 'POST', '/auth/tenant/invitations', {
        email: 'commit-boundary-issue@example.test',
      }, harness.owner.accessToken);
    } finally {
      (service as any).issueInvitation = issueInvitation;
    }
    expect(issueResult!).toMatchObject({
      status: 409,
      body: { code: 'AUTHORIZATION_CHANGED' },
    });
    expect(service.listInvitations({
      tenantId: harness.owner.tenant.tenantId,
    }).invitations).toHaveLength(0);

    const applicant = await createIdentity(harness, 'commit-boundary-applicant');
    service.submitJoinRequest({
      userId: applicant.userId,
      tenantSlug: harness.owner.tenant.slug!,
    });
    const pending = service.listJoinRequests({
      tenantId: harness.owner.tenant.tenantId,
      status: 'pending',
    }).requests[0]!;

    const approveJoinRequest = service.approveJoinRequest.bind(service);
    (service as any).approveJoinRequest = (input: any) => {
      changeActorProperty();
      return approveJoinRequest(input);
    };
    let approveResult: HttpResult;
    try {
      approveResult = await request(
        harness,
        'POST',
        `/auth/tenant/join-requests/${pending.joinRequestId}/approve`,
        { expectedRequestRevision: pending.requestRevision },
        harness.owner.accessToken,
      );
    } finally {
      (service as any).approveJoinRequest = approveJoinRequest;
    }
    expect(approveResult!).toMatchObject({
      status: 409,
      body: { code: 'AUTHORIZATION_CHANGED' },
    });
    expect(harness.runtime.getTenancyService()!.getMembership(
      harness.owner.tenant.tenantId,
      applicant.userId,
    )).toBeNull();

    const denyJoinRequest = service.denyJoinRequest.bind(service);
    (service as any).denyJoinRequest = (input: any) => {
      changeActorProperty();
      return denyJoinRequest(input);
    };
    let denyResult: HttpResult;
    try {
      denyResult = await request(
        harness,
        'POST',
        `/auth/tenant/join-requests/${pending.joinRequestId}/deny`,
        { expectedRequestRevision: pending.requestRevision },
        harness.owner.accessToken,
      );
    } finally {
      (service as any).denyJoinRequest = denyJoinRequest;
    }
    expect(denyResult!).toMatchObject({
      status: 409,
      body: { code: 'AUTHORIZATION_CHANGED' },
    });
    expect(service.listJoinRequests({
      tenantId: harness.owner.tenant.tenantId,
      status: 'pending',
    }).requests).toHaveLength(1);
  }, 60_000);
});

async function start(
  authorization: AuthAuthorizationConfig = 'simple',
): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy: {
      mode: 'multi',
      creation: { mode: 'authenticated' },
      onboarding: {
        invitations: { defaultTTL: '1d', maxTTL: '7d', accountCreation: true },
        joinRequests: { enabled: true },
      },
    },
    authorization,
    bootstrap: 'public',
    registration: { mode: 'disabled' },
    onRuntimeCreated(created) { runtime = created; },
  }));
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  const partial = {
    app,
    db,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  };
  const deadline = Date.now() + 2_000;
  while (!createdRuntime.getStore() || !createdRuntime.getTenantOnboardingService()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for auth runtime');
    await Bun.sleep(5);
  }
  const bootstrap = await request(partial, 'POST', '/auth/register', {
    username: 'owner',
    email: 'owner@example.test',
    password: 'password123',
    organizationName: 'Owner organization',
  });
  if (bootstrap.status !== 200) {
    throw new Error(`Bootstrap failed: ${JSON.stringify(bootstrap.body)}`);
  }
  const harness: Harness = {
    ...partial,
    owner: {
      user: bootstrap.body.user,
      tenant: bootstrap.body.tenant,
      accessToken: bootstrap.body.accessToken,
      refreshToken: bootstrap.body.refreshToken,
    },
  };
  active.push(harness);
  return harness;
}

async function ownerMutationAuthority(harness: Harness) {
  if (!harness.owner.accessToken) {
    const { user, tenant } = harness.owner;
    return () => ({
      auth: { userId: user.userId, email: user.email, role: 'admin' },
      scope: {
        tenancy: 'multi' as const,
        mode: 'simple' as const,
        scopeKind: 'tenant' as const,
        scopeId: tenant.tenantId,
        tenantId: tenant.tenantId,
        membershipId: tenant.membershipId,
        roles: ['owner'],
        permissions: [],
        allPermissions: true,
        revision: 'test',
      },
    });
  }
  const tokenService = harness.runtime.getTokenService()!;
  const auth = await tokenService.resolveAuthContext(harness.owner.accessToken);
  if (!auth) throw new Error('Owner authorization is unavailable');
  return captureAuthTenantMutationAuthority({
    auth,
    tokenService,
    kernel: harness.runtime.getAuthorizationKernel(),
    store: harness.runtime.getStore()!,
    roles: harness.runtime.getAuthorizationRoleService(),
  });
}

async function startRequiredMfa(): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy: {
      mode: 'multi',
      creation: { mode: 'disabled' },
      onboarding: {
        invitations: { accountCreation: true },
        joinRequests: { enabled: true },
      },
    },
    authorization: 'simple',
    bootstrap: 'disabled',
    registration: { mode: 'disabled' },
    mfa: {
      enabled: true,
      policy: 'required',
      methods: ['totp'],
      totp: { encryptionKey: 'tenant-invitation-mfa-test-key' },
    },
    onRuntimeCreated(created) { runtime = created; },
  }));
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  const deadline = Date.now() + 2_000;
  while (!createdRuntime.getStore() || !createdRuntime.getTenantOnboardingService()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for auth runtime');
    await Bun.sleep(5);
  }
  const store = createdRuntime.getStore()!;
  const tenancy = createdRuntime.getTenancyService()!;
  const ownerRegistration = await store.createRegistrationUser({
    username: 'mfa-owner',
    email: 'mfa-owner@example.test',
    password: 'password123',
    status: 'active',
  }, () => ({
    role: 'admin' as const,
    requireEmailVerification: false,
    mfaRequired: false,
  }), (owner) => {
    const created = tenancy.createTenant({
      name: 'MFA organization',
      slug: 'mfa-organization',
      ownerUserId: owner.userId,
    });
    return { tenantId: created.tenant.tenantId };
  }, { provisional: true });
  if (!ownerRegistration.provisioning?.tenantId) {
    throw new Error('MFA owner bootstrap did not create its organization');
  }
  store.finalizeRegistrationProvisioning(ownerRegistration.provisioning);
  const owner = ownerRegistration.user;
  const tenantId = ownerRegistration.provisioning.tenantId;
  const ownerMembership = tenancy.getMembership(tenantId, owner.userId);
  if (!ownerMembership) throw new Error('MFA owner membership was not created');
  const harness: Harness = {
    app,
    db,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
    owner: {
      user: owner,
      tenant: {
        tenantId,
        membershipId: ownerMembership.membershipId,
      },
      accessToken: '',
      refreshToken: '',
    },
  };
  active.push(harness);
  return harness;
}

async function createIdentity(
  harness: Harness,
  key: string,
  role: 'admin' | 'user' = 'user',
) {
  return harness.runtime.getStore()!.createUser({
    username: key,
    email: `${key}@example.test`,
    password: 'password123',
    role,
    status: 'active',
    emailVerifiedAt: Date.now(),
  });
}

async function issue(harness: Harness, email: string) {
  const result = await request(harness, 'POST', '/auth/tenant/invitations', {
    email,
  }, harness.owner.accessToken);
  expect(result.status).toBe(200);
  return result.body as {
    invitation: { invitationId: string };
    token: string;
  };
}

async function request(
  harness: Pick<Harness, 'url'>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  bearer?: string,
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetch(`${harness.url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}
