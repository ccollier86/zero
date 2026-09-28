import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';
import type { AuthAuthorizationConfig } from './types';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
}

interface Session {
  user: { userId: string; email: string };
  tenant: { tenantId: string; membershipId: string };
  accessToken: string;
  refreshToken: string;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

describe('active-tenant member administration', () => {
  test('derives tenant scope, isolates opaque membership ids, and transfers ownership safely', async () => {
    const harness = await start('simple');
    const alpha = await register(harness, 'alpha');
    const beta = await register(harness, 'beta');
    const gamma = await register(harness, 'gamma');

    const config = await request(harness, 'GET', '/auth/tenant/config', undefined, alpha.accessToken);
    expect(config.status).toBe(200);
    expect(config.body.tenant).toMatchObject({ tenantId: alpha.tenant.tenantId });
    expect(config.body.capabilities).toMatchObject({
      canManageMembers: true,
      canTransferOwnership: true,
    });

    // Unknown input cannot select another tenant. Elysia strips the undeclared
    // field and the live alpha bearer remains the only scope source.
    const confusedDeputy = await request(harness, 'POST', '/auth/tenant/members', {
      email: beta.user.email,
      tenantId: beta.tenant.tenantId,
    }, alpha.accessToken);
    expect(confusedDeputy.status).toBe(200);
    expect(confusedDeputy.body.member.identity.userId).toBe(beta.user.userId);
    expect(harness.runtime.getTenancyService()!.getMembership(
      alpha.tenant.tenantId,
      beta.user.userId,
    )?.membershipId).toBe(confusedDeputy.body.member.membershipId);
    const added = confusedDeputy;
    expect(added.body.member).toMatchObject({
      identity: { userId: beta.user.userId, email: beta.user.email },
      status: 'active',
      roles: ['member'],
    });
    expect(added.body.member.roleRevision).toBeString();
    expect(added.body.member.identity).not.toHaveProperty('role');
    expect(added.body.member.identity).not.toHaveProperty('mfaRequired');
    expect(added.body.member.identity).not.toHaveProperty('status');

    const managerAdded = await request(harness, 'POST', '/auth/tenant/members', {
      email: gamma.user.email,
      roles: ['manager'],
    }, alpha.accessToken);
    expect(managerAdded).toMatchObject({
      status: 200,
      body: { member: { roles: ['manager'] } },
    });
    expect(harness.runtime.getAuditService()!.listTenant(alpha.tenant.tenantId, {
      action: 'tenant.member-added',
    }).events).toContainEqual(expect.objectContaining({
      targetId: managerAdded.body.member.membershipId,
      metadata: { 'role-count': 1 },
    }));

    const firstPage = await request(
      harness,
      'GET',
      '/auth/tenant/members?limit=1',
      undefined,
      alpha.accessToken,
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.page).toMatchObject({ limit: 1, count: 1, hasMore: true });
    expect(firstPage.body.page.nextCursor).toBeString();
    const secondPage = await request(
      harness,
      'GET',
      `/auth/tenant/members?limit=1&cursor=${encodeURIComponent(firstPage.body.page.nextCursor)}`,
      undefined,
      alpha.accessToken,
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.members).toHaveLength(1);
    expect(secondPage.body.members[0].membershipId)
      .not.toBe(firstPage.body.members[0].membershipId);
    const invalidCursor = await request(
      harness,
      'GET',
      '/auth/tenant/members?cursor=not-a-valid-cursor',
      undefined,
      alpha.accessToken,
    );
    expect(invalidCursor.status).toBe(422);
    expect(invalidCursor.body.code).toBe('TENANT_MEMBER_PAGE_INVALID');

    const alphaMembers = await request(
      harness,
      'GET',
      '/auth/tenant/members?limit=1&search=beta',
      undefined,
      alpha.accessToken,
    );
    expect(alphaMembers.status).toBe(200);
    expect(alphaMembers.body.members).toHaveLength(1);
    expect(alphaMembers.body.page.limit).toBe(1);

    // Beta's existing token is still bound to beta, not to its new alpha membership.
    const betaMembers = await request(
      harness,
      'GET',
      '/auth/tenant/members',
      undefined,
      beta.accessToken,
    );
    expect(betaMembers.status).toBe(200);
    expect(betaMembers.body.members).toHaveLength(1);
    expect(betaMembers.body.members[0].membershipId).toBe(beta.tenant.membershipId);

    // An opaque membership id from beta cannot be operated on through alpha.
    const crossTenant = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${beta.tenant.membershipId}`,
      { status: 'suspended' },
      alpha.accessToken,
    );
    expect(crossTenant.status).toBe(404);

    const lastOwner = await request(
      harness,
      'DELETE',
      `/auth/tenant/members/${alpha.tenant.membershipId}`,
      undefined,
      alpha.accessToken,
    );
    expect(lastOwner.status).toBe(409);
    expect(lastOwner.body.code).toBe('TENANT_OWNER_ROLE_PROTECTED');

    const ownerSuspension = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${alpha.tenant.membershipId}`,
      { status: 'suspended' },
      alpha.accessToken,
    );
    expect(ownerSuspension.status).toBe(409);
    expect(ownerSuspension.body.code).toBe('TENANT_OWNER_ROLE_PROTECTED');

    const transfer = await request(
      harness,
      'POST',
      '/auth/tenant/ownership/transfer',
      { membershipId: added.body.member.membershipId },
      alpha.accessToken,
    );
    expect(transfer.status).toBe(200);
    expect(transfer.body).toMatchObject({
      actorSessionInvalidated: true,
      owner: { membershipId: added.body.member.membershipId, roles: ['owner'] },
      previousOwner: { membershipId: alpha.tenant.membershipId, roles: ['member'] },
    });

    // Both browser and native authority resolve against the bumped membership
    // generation; this captured browser bearer immediately fails closed.
    const staleOwner = await request(
      harness,
      'GET',
      '/auth/tenant/config',
      undefined,
      alpha.accessToken,
    );
    expect(staleOwner.status).toBe(401);

    const betaInAlpha = await switchTenant(harness, beta.refreshToken, alpha.tenant.tenantId);
    const newOwnerConfig = await request(
      harness,
      'GET',
      '/auth/tenant/config',
      undefined,
      betaInAlpha.accessToken,
    );
    expect(newOwnerConfig.status).toBe(200);
    expect(newOwnerConfig.body.actor.roles).toContain('owner');
  }, 60_000);

  test('retains organization history and directs global admins to suspend identities', async () => {
    const harness = await start('simple');
    const owner = await register(harness, 'history-owner');
    const disposable = await request(harness, 'POST', '/auth/admin/users', {
      username: 'history-free',
      email: 'history-free@example.test',
      password: 'password123',
    }, owner.accessToken);
    expect(disposable.status).toBe(200);
    const deleted = await request(
      harness,
      'DELETE',
      `/auth/admin/users/${disposable.body.user.userId}`,
      undefined,
      owner.accessToken,
    );
    expect(deleted).toMatchObject({ status: 200, body: { ok: true } });
    expect(harness.runtime.getStore()!.getUserById(
      disposable.body.user.userId,
    )).toBeNull();

    const created = await request(harness, 'POST', '/auth/admin/users', {
      username: 'history-member',
      email: 'history-member@example.test',
      password: 'password123',
    }, owner.accessToken);
    expect(created.status).toBe(200);
    const userId = created.body.user.userId as string;

    const added = await request(harness, 'POST', '/auth/tenant/members', {
      email: 'history-member@example.test',
    }, owner.accessToken);
    expect(added.status).toBe(200);
    expect(added.body.member).toMatchObject({
      identity: { userId },
      status: 'active',
      roles: ['member'],
    });

    const rejected = await request(
      harness,
      'DELETE',
      `/auth/admin/users/${userId}`,
      undefined,
      owner.accessToken,
    );
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: 'USER_HAS_TENANT_HISTORY',
      error: expect.stringContaining('suspend'),
    });
    expect(harness.runtime.getStore()!.getUserById(userId)).not.toBeNull();
    expect(harness.runtime.getTenancyService()!.getMembership(
      owner.tenant.tenantId,
      userId,
    )).toMatchObject({
      membershipId: added.body.member.membershipId,
      status: 'active',
    });

    const suspended = await request(
      harness,
      'POST',
      `/auth/admin/users/${userId}/suspend`,
      {},
      owner.accessToken,
    );
    expect(suspended.status).toBe(200);
    expect(suspended.body.user).toMatchObject({ userId, status: 'suspended' });
    expect(harness.runtime.getTenancyService()!.getMembership(
      owner.tenant.tenantId,
      userId,
    )).not.toBeNull();
  }, 60_000);

  test('enforces advanced grant ceilings, protected ownership, and stale-member invalidation', async () => {
    const harness = await start({
      mode: 'advanced',
      permissions: {
        'billing:manage': { label: 'Manage billing' },
      },
      roles: {
        'role-manager': {
          label: 'Role manager',
          permissions: [
            'tenant:read',
            'tenant.members:read',
            'tenant.members:manage',
            'tenant.roles:read',
            'tenant.roles:manage',
          ],
        },
        'billing-admin': {
          label: 'Billing administrator',
          permissions: ['billing:manage'],
        },
      },
    });
    const owner = await register(harness, 'advanced-owner');
    const managerIdentity = await register(harness, 'advanced-manager');
    const memberIdentity = await register(harness, 'advanced-member');

    const managerAdded = await request(harness, 'POST', '/auth/tenant/members', {
      email: managerIdentity.user.email,
      roles: ['role-manager'],
    }, owner.accessToken);
    expect(managerAdded.status).toBe(200);
    const manager = await switchTenant(
      harness,
      managerIdentity.refreshToken,
      owner.tenant.tenantId,
    );

    const managerConfig = await request(
      harness,
      'GET',
      '/auth/tenant/config',
      undefined,
      manager.accessToken,
    );
    expect(managerConfig.status).toBe(200);
    expect(managerConfig.body.roles.find((role: any) => role.key === 'billing-admin'))
      .toMatchObject({ assignable: true, grantable: false });
    expect(managerConfig.body.roles.find((role: any) => role.key === 'member'))
      .toMatchObject({ assignable: true, grantable: true });

    const memberAdded = await request(harness, 'POST', '/auth/tenant/members', {
      email: memberIdentity.user.email,
    }, manager.accessToken);
    expect(memberAdded.status).toBe(200);

    const escalation = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${memberAdded.body.member.membershipId}`,
      {
        roles: ['billing-admin'],
        expectedRoleRevision: memberAdded.body.member.roleRevision,
      },
      manager.accessToken,
    );
    expect(escalation.status).toBe(403);
    expect(escalation.body.code).toBe('TENANT_ROLE_ESCALATION_FORBIDDEN');

    const protectedOwner = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${memberAdded.body.member.membershipId}`,
      {
        roles: ['owner'],
        expectedRoleRevision: memberAdded.body.member.roleRevision,
      },
      manager.accessToken,
    );
    expect(protectedOwner.status).toBe(409);
    expect(protectedOwner.body.code).toBe('TENANT_OWNER_ROLE_PROTECTED');

    const forgedTransfer = await request(
      harness,
      'POST',
      '/auth/tenant/ownership/transfer',
      { membershipId: memberAdded.body.member.membershipId },
      manager.accessToken,
    );
    expect(forgedTransfer.status).toBe(403);

    const member = await switchTenant(
      harness,
      memberIdentity.refreshToken,
      owner.tenant.tenantId,
    );
    const suspended = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${memberAdded.body.member.membershipId}`,
      { status: 'suspended' },
      manager.accessToken,
    );
    expect(suspended.status).toBe(200);
    const staleMember = await request(
      harness,
      'GET',
      '/auth/tenant/config',
      undefined,
      member.accessToken,
    );
    expect(staleMember.status).toBe(401);

    const transferred = await request(
      harness,
      'POST',
      '/auth/tenant/ownership/transfer',
      { membershipId: managerAdded.body.member.membershipId },
      owner.accessToken,
    );
    expect(transferred.status).toBe(200);
    expect(transferred.body.owner.roles).toEqual(['owner', 'role-manager']);
    expect(transferred.body.previousOwner.roles).toEqual(['member']);
    expect(harness.runtime.getAuthorizationRoleService()!.resolveTenantRoles({
      tenantId: owner.tenant.tenantId,
      membershipId: managerAdded.body.member.membershipId,
      userId: managerIdentity.user.userId,
    })?.roles).toEqual(['owner', 'role-manager']);
    const staleAdvancedOwner = await request(
      harness,
      'GET',
      '/auth/tenant/config',
      undefined,
      owner.accessToken,
    );
    expect(staleAdvancedOwner.status).toBe(401);
  }, 60_000);

  test('rejects stale role-set writes and lets only the live owner remove retired roles', async () => {
    const harness = await start({
      mode: 'advanced',
      permissions: {
        'records:read': { label: 'Read records' },
      },
      roles: {
        'role-manager': {
          label: 'Role manager',
          permissions: [
            'tenant:read',
            'tenant.members:read',
            'tenant.members:manage',
            'tenant.roles:read',
            'tenant.roles:manage',
            'records:read',
          ],
        },
        auditor: { label: 'Auditor', permissions: ['records:read'] },
        editor: { label: 'Editor', permissions: ['records:read'] },
      },
    });
    const owner = await register(harness, 'revision-owner');
    const managerIdentity = await register(harness, 'revision-manager');
    const targetIdentity = await register(harness, 'revision-target');
    const managerAdded = await request(harness, 'POST', '/auth/tenant/members', {
      email: managerIdentity.user.email,
      roles: ['role-manager'],
    }, owner.accessToken);
    const targetAdded = await request(harness, 'POST', '/auth/tenant/members', {
      email: targetIdentity.user.email,
    }, owner.accessToken);
    expect(managerAdded.status).toBe(200);
    expect(targetAdded.status).toBe(200);
    const initialRevision = targetAdded.body.member.roleRevision;

    const missingRevision = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${targetAdded.body.member.membershipId}`,
      { roles: ['auditor'] },
      owner.accessToken,
    );
    expect(missingRevision).toMatchObject({
      status: 422,
      body: { code: 'TENANT_ROLE_REVISION_REQUIRED' },
    });

    const firstWrite = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${targetAdded.body.member.membershipId}`,
      { roles: ['auditor'], expectedRoleRevision: initialRevision },
      owner.accessToken,
    );
    expect(firstWrite).toMatchObject({
      status: 200,
      body: { member: { roles: ['auditor'] } },
    });
    const staleWrite = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${targetAdded.body.member.membershipId}`,
      { roles: ['editor'], expectedRoleRevision: initialRevision },
      owner.accessToken,
    );
    expect(staleWrite).toMatchObject({
      status: 409,
      body: { code: 'TENANT_ROLE_REVISION_CONFLICT' },
    });

    harness.db.prepare(`
      INSERT INTO _auth_tenant_membership_roles (
        assignment_id, tenant_id, membership_id, user_id, role_key,
        source, source_id, created_by, created_at, revoked_by, revoked_at
      ) VALUES (?, ?, ?, ?, 'retired-role', 'migration', ?, ?, ?, NULL, NULL)
    `).run(
      'arole_retired_tenant_test',
      owner.tenant.tenantId,
      targetAdded.body.member.membershipId,
      targetIdentity.user.userId,
      'retired-role-test',
      owner.user.userId,
      Date.now(),
    );
    harness.db.prepare(`
      UPDATE _auth_tenant_memberships
      SET authorization_generation = authorization_generation + 1
      WHERE membership_id = ?
    `).run(targetAdded.body.member.membershipId);
    const listed = await request(
      harness,
      'GET',
      '/auth/tenant/members?search=revision-target',
      undefined,
      owner.accessToken,
    );
    expect(listed.status).toBe(200);
    const retired = listed.body.members[0];
    expect(retired.roles).toEqual(['auditor', 'retired-role']);
    expect(retired.roleRevision).not.toBe(firstWrite.body.member.roleRevision);

    const manager = await switchTenant(
      harness,
      managerIdentity.refreshToken,
      owner.tenant.tenantId,
    );
    const nonOwnerCleanup = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${retired.membershipId}`,
      { roles: ['auditor'], expectedRoleRevision: retired.roleRevision },
      manager.accessToken,
    );
    expect(nonOwnerCleanup).toMatchObject({
      status: 403,
      body: { code: 'TENANT_ROLE_ESCALATION_FORBIDDEN' },
    });
    const blockedParallelChange = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${retired.membershipId}`,
      {
        roles: ['auditor', 'editor', 'retired-role'],
        expectedRoleRevision: retired.roleRevision,
      },
      manager.accessToken,
    );
    expect(blockedParallelChange).toMatchObject({
      status: 409,
      body: { code: 'TENANT_RETIRED_ROLE_CLEANUP_REQUIRED' },
    });

    const cleaned = await request(
      harness,
      'PATCH',
      `/auth/tenant/members/${retired.membershipId}`,
      { roles: ['auditor'], expectedRoleRevision: retired.roleRevision },
      owner.accessToken,
    );
    expect(cleaned.status).toBe(200);
    expect(cleaned.body.member.roles).toEqual(['auditor']);
    expect(cleaned.body.member.roleRevision).not.toBe(retired.roleRevision);
  }, 60_000);

  test('re-resolves properties and advanced grant ceilings after request auth before commit', async () => {
    const harness = await start({
      mode: 'advanced',
      permissions: { 'records:export': { label: 'Export records' } },
      roles: {
        'role-manager': {
          label: 'Role manager',
          permissions: [
            'tenant:read',
            'tenant.members:read',
            'tenant.members:manage',
            'tenant.roles:read',
            'tenant.roles:manage',
          ],
        },
        exporter: {
          label: 'Exporter',
          permissions: ['records:export'],
        },
      },
    });
    const owner = await register(harness, 'race-owner');
    const managerIdentity = await register(harness, 'race-manager');
    const target = await register(harness, 'race-target');
    const managerAdded = await request(harness, 'POST', '/auth/tenant/members', {
      email: managerIdentity.user.email,
      roles: ['role-manager'],
    }, owner.accessToken);
    expect(managerAdded.status).toBe(200);
    const manager = await switchTenant(
      harness,
      managerIdentity.refreshToken,
      owner.tenant.tenantId,
    );

    const service = harness.runtime.getTenantAdministrationService()!;
    const originalAdd = service.addMember.bind(service);
    (service as any).addMember = (input: any) => {
      // The HTTP adapter already admitted the manager. Revoke that retained
      // role before the domain transaction reaches its commit boundary.
      harness.runtime.getAuthorizationRoleService()!.replaceTenantRoles({
        tenantId: owner.tenant.tenantId,
        membershipId: managerAdded.body.member.membershipId,
        roleKeys: ['member'],
        changedBy: owner.user.userId,
      });
      return originalAdd(input);
    };
    const staleCeiling = await request(harness, 'POST', '/auth/tenant/members', {
      email: target.user.email,
      roles: ['exporter'],
    }, manager.accessToken);
    (service as any).addMember = originalAdd;
    expect(staleCeiling).toMatchObject({
      status: 409,
      body: { code: 'AUTHORIZATION_CHANGED' },
    });
    expect(harness.runtime.getTenancyService()!.getMembership(
      owner.tenant.tenantId,
      target.user.userId,
    )).toBeNull();

    const targetAdded = await request(harness, 'POST', '/auth/tenant/members', {
      email: target.user.email,
    }, owner.accessToken);
    expect(targetAdded.status).toBe(200);
    const mutationCases = [
      {
        method: 'updateMember',
        request: () => request(
          harness,
          'PATCH',
          `/auth/tenant/members/${targetAdded.body.member.membershipId}`,
          { status: 'suspended' },
          owner.accessToken,
        ),
      },
      {
        method: 'removeMember',
        request: () => request(
          harness,
          'DELETE',
          `/auth/tenant/members/${targetAdded.body.member.membershipId}`,
          undefined,
          owner.accessToken,
        ),
      },
      {
        method: 'transferOwnership',
        request: () => request(
          harness,
          'POST',
          '/auth/tenant/ownership/transfer',
          { membershipId: targetAdded.body.member.membershipId },
          owner.accessToken,
        ),
      },
    ] as const;
    for (const [index, mutation] of mutationCases.entries()) {
      const original = (service as any)[mutation.method].bind(service);
      (service as any)[mutation.method] = (input: any) => {
        harness.runtime.getStore()!.setProperty(
          owner.user.userId,
          'commit-race',
          String(index + 1),
        );
        return original(input);
      };
      const result = await mutation.request();
      (service as any)[mutation.method] = original;
      expect(result).toMatchObject({
        status: 409,
        body: { code: 'AUTHORIZATION_CHANGED' },
      });
    }
    expect(harness.runtime.getTenancyService()!.getMembershipById(
      targetAdded.body.member.membershipId,
    )).toMatchObject({ status: 'active', roleKey: 'member' });
    expect(harness.runtime.getTenancyService()!.getMembershipById(
      owner.tenant.membershipId,
    )).toMatchObject({ status: 'active', roleKey: 'owner' });
  }, 60_000);
});

async function start(
  authorization: AuthAuthorizationConfig,
): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy: 'multi',
    authorization,
    bootstrap: 'public',
    registration: { mode: 'public' },
    onRuntimeCreated(created) {
      runtime = created;
    },
  }));
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  const harness = {
    app,
    db,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  const deadline = Date.now() + 2_000;
  while (!createdRuntime.getStore() || !createdRuntime.getTokenService()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for auth runtime');
    await Bun.sleep(5);
  }
  return harness;
}

async function register(harness: Harness, key: string): Promise<Session> {
  const response = await request(harness, 'POST', '/auth/register', {
    username: key,
    email: `${key}@example.test`,
    password: 'password123',
    organizationName: `${key} organization`,
  });
  expect(response.status).toBe(200);
  return {
    user: response.body.user,
    tenant: response.body.tenant,
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
  };
}

async function switchTenant(
  harness: Harness,
  refreshToken: string,
  tenantId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await request(harness, 'POST', '/auth/tenants/switch', {
    refreshToken,
    tenantId,
  });
  expect(response.status).toBe(200);
  return {
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
  };
}

async function request(
  harness: Harness,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  bearer?: string,
): Promise<{ status: number; body: Record<string, any> }> {
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
