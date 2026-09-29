import { describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { AuthAuditService } from './auth-audit-service';
import type { AuthAuditActor } from './auth-audit-types';
import { resolveAuthBehaviorConfig } from './auth-config';
import { defineAuthTables } from './auth-schema';
import { resolveAuthTenantOnboardingConfig } from './auth-tenant-onboarding-config';
import { AuthTenantOnboardingService } from './auth-tenant-onboarding-service';
import { createAuthorizationKernel } from './authorization-kernel';
import { AuthorizationRoleService } from './authorization-role-service';
import { AuthorizationRoleStore } from './authorization-role-store';
import { TenancyService } from './tenancy/tenancy-service';
import { defineTenancyTables } from './tenancy/tenancy-schema';
import { TenantStore } from './tenancy/tenant-store';
import type { AuthAuthorizationMode } from './types';
import { UserPropertyService } from './user-property-service';
import { UserStore } from './user-store';

describe('tenant onboarding null role-selection boundary', () => {
  test('rejects explicit null invitation roles without persisting an invitation', async () => {
    const harness = createHarness('simple');
    try {
      const owner = await createUser(harness, 'invitation-owner');
      const tenant = harness.tenancy.createTenant({
        name: 'Invitation Boundary',
        slug: 'invitation-boundary',
        ownerUserId: owner.userId,
      });

      expect(() => harness.service.issueInvitation({
        tenantId: tenant.tenant.tenantId,
        email: 'invited@example.test',
        roleKeys: null as never,
        assertCurrentAuthority: authority(
          owner.userId,
          tenant.ownerMembership.membershipId,
          tenant.tenant.tenantId,
          'simple',
        ),
      })).toThrow(expect.objectContaining({
        code: 'TENANT_ROLE_SELECTION_INVALID',
        status: 422,
      }));
      expect(countRows(harness.db, '_auth_tenant_invitations')).toBe(0);

      const omitted = harness.service.issueInvitation({
        tenantId: tenant.tenant.tenantId,
        email: 'invited@example.test',
        assertCurrentAuthority: authority(
          owner.userId,
          tenant.ownerMembership.membershipId,
          tenant.tenant.tenantId,
          'simple',
        ),
      });
      expect(omitted.invitation.roles).toEqual(['member']);
    } finally {
      harness.db.dispose();
    }
  });

  test('uses the immutable invitation role snapshot across authority revalidation', async () => {
    const harness = createHarness('simple');
    try {
      const owner = await createUser(harness, 'snapshot-invitation-owner');
      const tenant = harness.tenancy.createTenant({
        name: 'Invitation Snapshot',
        slug: 'invitation-snapshot',
        ownerUserId: owner.userId,
      });
      const currentAuthority = authority(
        owner.userId,
        tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId,
        'simple',
      );
      const callerRoleKeys = ['member'];
      const auditRequest = {
        requestId: 'original-invitation-request',
        correlationId: 'original-invitation-correlation',
      };
      let requiredPermissions: readonly string[] = [];

      const created = harness.service.issueInvitation({
        tenantId: tenant.tenant.tenantId,
        email: 'snapshot-invited@example.test',
        roleKeys: callerRoleKeys,
        auditRequest,
        assertCurrentAuthority: (permissions) => {
          requiredPermissions = permissions;
          callerRoleKeys[0] = 'reviewer';
          auditRequest.requestId = 'mutated-invitation-request';
          auditRequest.correlationId = 'mutated-invitation-correlation';
          return currentAuthority();
        },
      });

      expect(requiredPermissions).toEqual(['tenant.invitations:manage']);
      expect(callerRoleKeys).toEqual(['reviewer']);
      expect(created.invitation.roles).toEqual(['member']);
      expect(harness.db.prepare(`
        SELECT request_id, correlation_id FROM _auth_audit_events
        WHERE action = 'tenant.invitation-issued' AND target_id = ?
      `).get(created.invitation.invitationId)).toEqual({
        request_id: 'original-invitation-request',
        correlation_id: 'original-invitation-correlation',
      });
    } finally {
      harness.db.dispose();
    }
  });

  test('rejects null selectable approval roles without admitting the applicant', async () => {
    const harness = createHarness('advanced');
    try {
      const owner = await createUser(harness, 'approval-owner');
      const applicant = await createUser(harness, 'approval-applicant');
      const tenant = harness.tenancy.createTenant({
        name: 'Approval Boundary',
        slug: 'approval-boundary',
        ownerUserId: owner.userId,
      });
      const assertCurrentAuthority = authority(
        owner.userId,
        tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId,
        'advanced',
      );
      harness.service.submitJoinRequest({
        userId: applicant.userId,
        tenantSlug: tenant.tenant.slug,
      });
      const pending = harness.service.listJoinRequests({
        tenantId: tenant.tenant.tenantId,
        status: 'pending',
        approvalScope: assertCurrentAuthority().scope,
      }).requests[0]!;
      expect(pending.approvalPolicy.roleSelection.mode).toBe('selectable');

      expect(() => harness.service.approveJoinRequest({
        tenantId: tenant.tenant.tenantId,
        joinRequestId: pending.joinRequestId,
        expectedRequestRevision: pending.requestRevision,
        roleKeys: null as never,
        assertCurrentAuthority,
      })).toThrow(expect.objectContaining({
        code: 'TENANT_ROLE_SELECTION_INVALID',
        status: 422,
      }));
      expect(harness.tenancy.getMembership(
        tenant.tenant.tenantId,
        applicant.userId,
      )).toBeNull();
      expect(harness.db.prepare(`
        SELECT status, reviewed_by, approved_membership_id
        FROM _auth_tenant_join_requests WHERE join_request_id = ?
      `).get(pending.joinRequestId)).toEqual({
        status: 'pending',
        reviewed_by: null,
        approved_membership_id: null,
      });
    } finally {
      harness.db.dispose();
    }
  });

  test('detaches submit audit attribution before identity proof admission', async () => {
    const harness = createHarness('simple');
    try {
      const owner = await createUser(harness, 'snapshot-submit-owner');
      const applicant = await createUser(harness, 'snapshot-submit-applicant');
      const tenant = harness.tenancy.createTenant({
        name: 'Submit Snapshot',
        slug: 'submit-snapshot',
        ownerUserId: owner.userId,
      });
      const auditActor: AuthAuditActor = {
        userId: applicant.userId,
        provenance: 'authenticated-request',
      };
      const auditRequest = {
        requestId: 'original-submit-request',
        correlationId: 'original-submit-correlation',
      };

      harness.service.submitJoinRequest({
        userId: applicant.userId,
        tenantSlug: tenant.tenant.slug,
        auditActor,
        auditRequest,
        admitIdentityProof: () => {
          auditActor.userId = 'mutated-actor';
          auditActor.provenance = 'system';
          auditRequest.requestId = 'mutated-submit-request';
          auditRequest.correlationId = 'mutated-submit-correlation';
          return true;
        },
      });

      expect(harness.db.prepare(`
        SELECT actor_user_id, actor_provenance, request_id, correlation_id
        FROM _auth_audit_events WHERE action = 'tenant.join-request-submitted'
      `).get()).toEqual({
        actor_user_id: applicant.userId,
        actor_provenance: 'authenticated-request',
        request_id: 'original-submit-request',
        correlation_id: 'original-submit-correlation',
      });
    } finally {
      harness.db.dispose();
    }
  });

  test('detaches invitation acceptance audit attribution before identity proof', async () => {
    const harness = createHarness('simple');
    try {
      const owner = await createUser(harness, 'snapshot-accept-owner');
      const applicant = await createUser(harness, 'snapshot-accept-applicant');
      const tenant = harness.tenancy.createTenant({
        name: 'Acceptance Snapshot',
        slug: 'acceptance-snapshot',
        ownerUserId: owner.userId,
      });
      const invitation = harness.service.issueInvitation({
        tenantId: tenant.tenant.tenantId,
        email: applicant.email,
        assertCurrentAuthority: authority(
          owner.userId,
          tenant.ownerMembership.membershipId,
          tenant.tenant.tenantId,
          'simple',
        ),
      });
      const auditActor: AuthAuditActor = {
        userId: applicant.userId,
        provenance: 'authenticated-request',
      };
      const auditRequest = {
        requestId: 'original-acceptance-request',
        correlationId: 'original-acceptance-correlation',
      };

      const accepted = harness.service.acceptInvitationForUser(
        invitation.token,
        applicant.userId,
        () => {
          auditActor.userId = 'mutated-acceptance-actor';
          auditActor.provenance = 'system';
          auditRequest.requestId = 'mutated-acceptance-request';
          auditRequest.correlationId = 'mutated-acceptance-correlation';
          return true;
        },
        { actor: auditActor, request: auditRequest },
      );

      expect(accepted.membership.userId).toBe(applicant.userId);
      expect(harness.db.prepare(`
        SELECT actor_user_id, actor_provenance, request_id, correlation_id
        FROM _auth_audit_events WHERE action = 'tenant.invitation-accepted'
      `).get()).toEqual({
        actor_user_id: applicant.userId,
        actor_provenance: 'authenticated-request',
        request_id: 'original-acceptance-request',
        correlation_id: 'original-acceptance-correlation',
      });
    } finally {
      harness.db.dispose();
    }
  });

  test('captures invitation account input before password hashing yields', async () => {
    const harness = createHarness('simple');
    try {
      const owner = await createUser(harness, 'snapshot-account-owner');
      const tenant = harness.tenancy.createTenant({
        name: 'Account Snapshot',
        slug: 'account-snapshot',
        ownerUserId: owner.userId,
      });
      const invitation = harness.service.issueInvitation({
        tenantId: tenant.tenant.tenantId,
        email: 'snapshot-account@example.test',
        assertCurrentAuthority: authority(
          owner.userId,
          tenant.ownerMembership.membershipId,
          tenant.tenant.tenantId,
          'simple',
        ),
      });
      let releaseHash!: () => void;
      let markHashStarted!: () => void;
      const hashStarted = new Promise<void>((resolve) => {
        markHashStarted = resolve;
      });
      const hashGate = new Promise<void>((resolve) => {
        releaseHash = resolve;
      });
      const credentials = (harness.users as unknown as {
        credentials: { hashPassword: (password: string) => Promise<string> };
      }).credentials;
      const hashPassword = credentials.hashPassword.bind(credentials);
      credentials.hashPassword = async (password) => {
        markHashStarted();
        await hashGate;
        return hashPassword(password);
      };
      const properties = { department: 'original' };
      const auditRequest = {
        requestId: 'original-account-request',
        correlationId: 'original-account-correlation',
      };
      const input = {
        token: invitation.token,
        username: 'snapshot-account',
        email: 'snapshot-account@example.test',
        password: 'original-password',
        firstName: 'Original',
        lastName: 'Account',
        mfaRequired: false,
        properties,
        auditRequest,
        deferAcceptance: false,
      };

      const pending = harness.service.createInvitationAccount(input);
      await hashStarted;
      input.token = 'zinv_mutated-invalid-token';
      input.username = 'mutated-account';
      input.email = 'mutated-account@example.test';
      input.password = 'mutated-password';
      input.firstName = 'Mutated';
      input.lastName = 'Caller';
      input.mfaRequired = true;
      input.deferAcceptance = true;
      properties.department = 'mutated';
      auditRequest.requestId = 'mutated-account-request';
      auditRequest.correlationId = 'mutated-account-correlation';
      releaseHash();

      const accepted = await pending;
      expect(accepted).toMatchObject({
        tenant: { tenantId: tenant.tenant.tenantId },
        user: {
          username: 'snapshot-account',
          email: 'snapshot-account@example.test',
          firstName: 'Original',
          lastName: 'Account',
          mfaRequired: false,
          properties: { department: 'original' },
        },
      });
      expect(harness.db.prepare(`
        SELECT request_id, correlation_id FROM _auth_audit_events
        WHERE action = 'tenant.invitation-accepted'
      `).get()).toEqual({
        request_id: 'original-account-request',
        correlation_id: 'original-account-correlation',
      });
    } finally {
      harness.db.dispose();
    }
  });

  test('uses immutable approval inputs across authority revalidation', async () => {
    const harness = createHarness('advanced');
    try {
      const owner = await createUser(harness, 'snapshot-approval-owner');
      const applicant = await createUser(harness, 'snapshot-approval-applicant');
      const tenant = harness.tenancy.createTenant({
        name: 'Approval Snapshot',
        slug: 'approval-snapshot',
        ownerUserId: owner.userId,
      });
      const currentAuthority = authority(
        owner.userId,
        tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId,
        'advanced',
      );
      harness.service.submitJoinRequest({
        userId: applicant.userId,
        tenantSlug: tenant.tenant.slug,
      });
      const pending = harness.service.listJoinRequests({
        tenantId: tenant.tenant.tenantId,
        status: 'pending',
        approvalScope: currentAuthority().scope,
      }).requests[0]!;
      const callerRoleKeys = ['member'];
      const auditRequest = {
        requestId: 'original-approval-request',
        correlationId: 'original-approval-correlation',
      };
      let approvalInput!: Parameters<
        AuthTenantOnboardingService['approveJoinRequest']
      >[0];
      approvalInput = {
        tenantId: tenant.tenant.tenantId,
        joinRequestId: pending.joinRequestId,
        expectedRequestRevision: pending.requestRevision,
        roleKeys: callerRoleKeys,
        auditRequest,
        assertCurrentAuthority: () => {
          callerRoleKeys[0] = 'reviewer';
          auditRequest.requestId = 'mutated-approval-request';
          auditRequest.correlationId = 'mutated-approval-correlation';
          approvalInput.tenantId = 'mutated-tenant';
          approvalInput.joinRequestId = 'mutated-request';
          approvalInput.expectedRequestRevision += 1;
          approvalInput.roleKeys = ['reviewer'];
          return currentAuthority();
        },
      };

      const approved = harness.service.approveJoinRequest(approvalInput);
      expect(callerRoleKeys).toEqual(['reviewer']);
      expect(approved).toMatchObject({
        status: 'approved',
        membership: { roles: ['member'] },
      });
      expect(harness.tenancy.getMembership(
        tenant.tenant.tenantId,
        applicant.userId,
      )).toMatchObject({ status: 'active' });
      expect(harness.db.prepare(`
        SELECT request_id, correlation_id FROM _auth_audit_events
        WHERE action = 'tenant.join-request-approved' AND target_id = ?
      `).get(pending.joinRequestId)).toEqual({
        request_id: 'original-approval-request',
        correlation_id: 'original-approval-correlation',
      });
    } finally {
      harness.db.dispose();
    }
  });

  test('uses immutable denial identifiers across authority revalidation', async () => {
    const harness = createHarness('simple');
    try {
      const owner = await createUser(harness, 'snapshot-denial-owner');
      const applicant = await createUser(harness, 'snapshot-denial-applicant');
      const tenant = harness.tenancy.createTenant({
        name: 'Denial Snapshot',
        slug: 'denial-snapshot',
        ownerUserId: owner.userId,
      });
      const currentAuthority = authority(
        owner.userId,
        tenant.ownerMembership.membershipId,
        tenant.tenant.tenantId,
        'simple',
      );
      harness.service.submitJoinRequest({
        userId: applicant.userId,
        tenantSlug: tenant.tenant.slug,
      });
      const pending = harness.service.listJoinRequests({
        tenantId: tenant.tenant.tenantId,
        status: 'pending',
      }).requests[0]!;
      let denialInput!: Parameters<AuthTenantOnboardingService['denyJoinRequest']>[0];
      denialInput = {
        tenantId: tenant.tenant.tenantId,
        joinRequestId: pending.joinRequestId,
        expectedRequestRevision: pending.requestRevision,
        assertCurrentAuthority: () => {
          denialInput.tenantId = 'mutated-tenant';
          denialInput.joinRequestId = 'mutated-request';
          denialInput.expectedRequestRevision += 1;
          return currentAuthority();
        },
      };

      expect(harness.service.denyJoinRequest(denialInput).status).toBe('denied');
      expect(harness.db.prepare(`
        SELECT status FROM _auth_tenant_join_requests WHERE join_request_id = ?
      `).get(pending.joinRequestId)).toEqual({ status: 'denied' });
    } finally {
      harness.db.dispose();
    }
  });
});

function createHarness(mode: AuthAuthorizationMode) {
  const db = createReactiveDB({ mode: 'memory' });
  defineAuthTables(db);
  defineTenancyTables(db);
  const auth = resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode,
      roles: { reviewer: { permissions: [] } },
    },
    bootstrap: 'public',
    registration: { mode: 'disabled' },
  });
  const users = new UserStore(db);
  const kernel = createAuthorizationKernel({
    tenancy: auth.tenancy,
    authorization: auth.authorization,
    userProperties: auth.userProperties,
  });
  const audit = new AuthAuditService(db, resolveAuthAuditConfig(undefined));
  let roles: AuthorizationRoleService | null = null;
  const tenancy = new TenancyService(new TenantStore(db, {
    onOwnerCreated: (input) => roles?.establishTenantOwner(input),
    onOwnerRoleChanged: (input) => roles?.syncTenantOwnerRole(input),
  }));
  if (mode === 'advanced') {
    roles = new AuthorizationRoleService(
      db,
      new AuthorizationRoleStore(db),
      kernel,
      users,
      tenancy,
      audit,
    );
  }
  const service = new AuthTenantOnboardingService(
    db,
    resolveAuthTenantOnboardingConfig(undefined),
    kernel,
    users,
    new UserPropertyService(auth),
    tenancy,
    roles,
    audit,
  );
  return { db, users, tenancy, service };
}

async function createUser(
  harness: ReturnType<typeof createHarness>,
  username: string,
) {
  return harness.users.createUser({
    username,
    email: `${username}@example.test`,
    password: 'password123',
    role: username.includes('owner') ? 'admin' : 'user',
    status: 'active',
    emailVerifiedAt: Date.now(),
  });
}

function authority(
  userId: string,
  membershipId: string,
  tenantId: string,
  mode: AuthAuthorizationMode,
) {
  return () => ({
    auth: {
      userId,
      email: `${userId}@example.test`,
      role: 'admin',
    },
    scope: {
      tenancy: 'multi' as const,
      mode,
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

function countRows(db: ReactiveDB, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
