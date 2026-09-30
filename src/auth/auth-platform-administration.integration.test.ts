import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { MemoryEventStore, OBS_CODES } from '../observability';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { captureAuthApplicationMutationAuthority } from './auth-application-mutation-authority';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';
import type { AuthAuthorizationConfig } from './types';

interface Harness {
  app: AnyElysia;
  appRuntime: ZeroAppRuntime;
  db: ReactiveDB;
  events: MemoryEventStore;
  runtime: AuthRuntime;
  url: string;
}

interface Session {
  user: { userId: string; email: string };
  tenant: { tenantId: string; membershipId: string; kind: string };
  accessToken: string;
  refreshToken: string;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    await harness.appRuntime.dispose();
    harness.db.dispose();
  }
});

describe('protected platform administration', () => {
  test('exposes a bounded customer directory and fences tenant lifecycle mutations', async () => {
    const harness = await start();
    const owner = await register(harness, 'platform-directory-owner');
    const customerOwner = await register(harness, 'platform-directory-customer');

    expect(owner.tenant.kind).toBe('administration');
    expect(customerOwner.tenant.kind).toBe('organization');

    const config = await request(
      harness,
      'GET',
      '/auth/platform/config',
      undefined,
      owner.accessToken,
    );
    expect(config).toMatchObject({
      status: 200,
      body: {
        authorization: 'simple',
        administration: {
          tenantId: owner.tenant.tenantId,
          kind: 'administration',
          membershipId: owner.tenant.membershipId,
        },
        capabilities: {
          canManageRoles: true,
          canReadTenants: true,
          canReadTenantMembers: true,
          canManageTenants: true,
          canCreateTenants: true,
        },
      },
    });
    expect(config.body.roles.find((role: any) => role.key === 'member'))
      .toMatchObject({ administrationOnly: false, assignable: false });
    expect(config.body.roles.find((role: any) => role.key === 'administrator'))
      .toMatchObject({ administrationOnly: true, assignable: true });

    const customerDenied = await request(
      harness,
      'GET',
      '/auth/platform/config',
      undefined,
      customerOwner.accessToken,
    );
    expect(customerDenied).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });

    const listed = await request(
      harness,
      'GET',
      '/auth/platform/tenants?limit=1',
      undefined,
      owner.accessToken,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.tenants).toHaveLength(1);
    expect(listed.body.tenants[0]).toMatchObject({
      tenantId: customerOwner.tenant.tenantId,
      kind: 'organization',
      status: 'active',
      memberCount: 1,
      activeMemberCount: 1,
    });
    expect(listed.body.tenants.some((tenant: any) => (
      tenant.tenantId === owner.tenant.tenantId
    ))).toBe(false);

    const created = await request(harness, 'POST', '/auth/platform/tenants', {
      name: 'Second customer organization',
      ownerEmail: customerOwner.user.email,
    }, owner.accessToken);
    expect(created).toMatchObject({
      status: 200,
      body: {
        tenant: { kind: 'organization', status: 'active' },
        owner: {
          identity: { userId: customerOwner.user.userId },
          roles: ['owner'],
        },
      },
    });

    const pageOne = await request(
      harness,
      'GET',
      '/auth/platform/tenants?limit=1',
      undefined,
      owner.accessToken,
    );
    expect(pageOne.body.page).toMatchObject({ count: 1, hasMore: true });
    const pageTwo = await request(
      harness,
      'GET',
      `/auth/platform/tenants?limit=1&cursor=${encodeURIComponent(
        pageOne.body.page.nextCursor,
      )}`,
      undefined,
      owner.accessToken,
    );
    expect(pageTwo.status).toBe(200);
    expect(pageTwo.body.tenants).toHaveLength(1);
    expect(pageTwo.body.tenants[0].tenantId)
      .not.toBe(pageOne.body.tenants[0].tenantId);

    const invalidCursor = await request(
      harness,
      'GET',
      '/auth/platform/tenants?cursor=invalid',
      undefined,
      owner.accessToken,
    );
    expect(invalidCursor).toMatchObject({
      status: 422,
      body: { code: 'PLATFORM_TENANT_PAGE_INVALID' },
    });

    const generation = created.body.tenant.authorizationGeneration as number;
    const suspended = await request(
      harness,
      'PATCH',
      `/auth/platform/tenants/${created.body.tenant.tenantId}`,
      { status: 'suspended', expectedAuthorizationGeneration: generation },
      owner.accessToken,
    );
    expect(suspended).toMatchObject({
      status: 200,
      body: { tenant: { status: 'suspended' } },
    });
    expect(suspended.body.tenant.authorizationGeneration).toBeGreaterThan(generation);

    // Exact retry is idempotent despite carrying the generation from before
    // the successful transition.
    const retried = await request(
      harness,
      'PATCH',
      `/auth/platform/tenants/${created.body.tenant.tenantId}`,
      { status: 'suspended', expectedAuthorizationGeneration: generation },
      owner.accessToken,
    );
    expect(retried).toMatchObject({ status: 200, body: { tenant: { status: 'suspended' } } });

    const staleOpposite = await request(
      harness,
      'PATCH',
      `/auth/platform/tenants/${created.body.tenant.tenantId}`,
      { status: 'active', expectedAuthorizationGeneration: generation },
      owner.accessToken,
    );
    expect(staleOpposite).toMatchObject({
      status: 409,
      body: { code: 'TENANT_AUTHORIZATION_GENERATION_CONFLICT' },
    });

    const suspendedMembers = await request(
      harness,
      'GET',
      `/auth/platform/tenants/${created.body.tenant.tenantId}/members`,
      undefined,
      owner.accessToken,
    );
    expect(suspendedMembers).toMatchObject({
      status: 200,
      body: { members: [{ identity: { userId: customerOwner.user.userId } }] },
    });

    const protectedTarget = await request(
      harness,
      'PATCH',
      `/auth/platform/tenants/${owner.tenant.tenantId}`,
      { status: 'suspended', expectedAuthorizationGeneration: 0 },
      owner.accessToken,
    );
    expect(protectedTarget).toMatchObject({ status: 404, body: { code: 'TENANT_NOT_FOUND' } });

    expect(harness.runtime.getAuditService()!.listPlatform({
      action: 'application.tenant-created',
    }).events).toContainEqual(expect.objectContaining({
      targetId: created.body.tenant.tenantId,
    }));
    expect(harness.runtime.getAuditService()!.listPlatform({
      action: 'application.tenant-suspended',
    }).events).toContainEqual(expect.objectContaining({
      targetId: created.body.tenant.tenantId,
    }));
  }, 60_000);

  test('uses the combined admin-organization ceiling for delegated role grants', async () => {
    const harness = await start();
    const owner = await register(harness, 'platform-ceiling-owner');
    const delegate = await register(harness, 'platform-ceiling-delegate');
    const target = await register(harness, 'platform-ceiling-target');

    expect(await request(harness, 'POST', '/auth/platform/members', {
      email: delegate.user.email,
    }, owner.accessToken)).toMatchObject({
      status: 422,
      body: { code: 'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED' },
    });
    expect(await request(harness, 'POST', '/auth/platform/members', {
      email: delegate.user.email,
      roles: [],
    }, owner.accessToken)).toMatchObject({
      status: 422,
      body: { code: 'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED' },
    });
    expect(await request(harness, 'POST', '/auth/platform/members', {
      email: delegate.user.email,
      roles: [42],
    }, owner.accessToken)).toMatchObject({
      status: 422,
      body: { code: 'AUTH_VALIDATION_FAILED' },
    });

    const tenantAdministration = harness.runtime.getTenantAdministrationService()!;
    for (const roleKeys of [undefined, []] as const) {
      const authorityReached = new Error('Missing administration roles reached authority');
      let requestedPermissions: readonly string[] | undefined;
      expect(() => tenantAdministration.addMember({
        tenantId: owner.tenant.tenantId,
        email: delegate.user.email,
        roleKeys,
        assertCurrentAuthority: (permissions) => {
          requestedPermissions = permissions;
          throw authorityReached;
        },
      })).toThrow(authorityReached);
      expect(requestedPermissions).toEqual(['tenant.members:manage']);
    }
    expect(await request(harness, 'POST', '/auth/platform/members', {
      email: delegate.user.email,
      roles: ['member'],
    }, owner.accessToken)).toMatchObject({
      status: 422,
      body: { code: 'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED' },
    });
    expect(await request(harness, 'POST', '/auth/platform/invitations', {
      email: 'invalid-admin-invite@example.test',
      roles: ['manager'],
      delivery: 'manual',
    }, owner.accessToken)).toMatchObject({
      status: 422,
      body: { code: 'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED' },
    });
    const adminInvite = await request(harness, 'POST', '/auth/platform/invitations', {
      email: 'admin-invited@example.test',
      roles: ['administrator'],
      delivery: 'manual',
    }, owner.accessToken);
    expect(adminInvite.status).toBe(200);
    expect(await request(harness, 'POST', '/auth/invitations/inspect', {
      token: adminInvite.body.token,
    })).toMatchObject({
      status: 200,
      body: {
        available: true,
        tenant: { kind: 'administration' },
      },
    });

    const delegated = await request(harness, 'POST', '/auth/platform/members', {
      email: delegate.user.email,
      roles: ['access-manager'],
    }, owner.accessToken);
    expect(delegated).toMatchObject({
      status: 200,
      body: { member: { roles: ['access-manager'] } },
    });
    const delegateInAdministration = await switchTenant(
      harness,
      delegate.refreshToken,
      owner.tenant.tenantId,
    );
    const config = await request(
      harness,
      'GET',
      '/auth/platform/config',
      undefined,
      delegateInAdministration.accessToken,
    );
    expect(config.status).toBe(200);
    expect(config.body.roles.find((role: any) => role.key === 'access-manager'))
      .toMatchObject({ administrationOnly: true, grantable: true });
    expect(config.body.roles.find((role: any) => role.key === 'administrator'))
      .toMatchObject({ administrationOnly: true, grantable: false });

    const sameCeiling = await request(harness, 'POST', '/auth/platform/members', {
      email: target.user.email,
      roles: ['access-manager'],
    }, delegateInAdministration.accessToken);
    expect(sameCeiling).toMatchObject({
      status: 200,
      body: { member: { roles: ['access-manager'] } },
    });

    const escalation = await request(
      harness,
      'PATCH',
      `/auth/platform/members/${sameCeiling.body.member.membershipId}`,
      {
        roles: ['administrator'],
        expectedRoleRevision: sameCeiling.body.member.roleRevision,
      },
      delegateInAdministration.accessToken,
    );
    expect(escalation).toMatchObject({
      status: 403,
      body: { code: 'TENANT_ROLE_ESCALATION_FORBIDDEN' },
    });

    const customerSession = await switchTenant(
      harness,
      delegateInAdministration.refreshToken,
      delegate.tenant.tenantId,
    );
    expect((await request(
      harness,
      'GET',
      '/auth/platform/config',
      undefined,
      customerSession.accessToken,
    ))).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });

    const transferred = await request(
      harness,
      'POST',
      '/auth/platform/ownership/transfer',
      { membershipId: delegated.body.member.membershipId },
      owner.accessToken,
    );
    expect(transferred).toMatchObject({
      status: 200,
      body: {
        owner: { roles: ['owner'] },
        previousOwner: { roles: ['administrator'] },
      },
    });
  }, 60_000);

  test('projects delegated role authority without coupling independent lifecycle controls', async () => {
    const harness = await start({
      mode: 'advanced',
      roles: {
        'delegated-operator': {
          label: 'Delegated operator',
          permissions: [
            'tenant:read',
            'tenant.members:read',
            'tenant.members:manage',
            'tenant.invitations:read',
            'tenant.invitations:manage',
            'application.users:read',
          ],
        },
      },
    });
    const owner = await register(harness, 'platform-capability-owner');
    const delegate = await register(harness, 'platform-capability-delegate');
    const target = await register(harness, 'platform-capability-target');
    const unadded = await register(harness, 'platform-capability-unadded');

    const delegated = await request(harness, 'POST', '/auth/platform/members', {
      email: delegate.user.email,
      roles: ['delegated-operator'],
    }, owner.accessToken);
    const targetMember = await request(harness, 'POST', '/auth/platform/members', {
      email: target.user.email,
      roles: ['access-manager'],
    }, owner.accessToken);
    expect(delegated.status).toBe(200);
    expect(targetMember.status).toBe(200);

    const delegatedSession = await switchTenant(
      harness,
      delegate.refreshToken,
      owner.tenant.tenantId,
    );
    const config = await request(
      harness,
      'GET',
      '/auth/platform/config',
      undefined,
      delegatedSession.accessToken,
    );
    expect(config).toMatchObject({
      status: 200,
      body: {
        capabilities: {
          canReadMembers: true,
          canManageMembers: true,
          canManageRoles: false,
          canReadInvitations: true,
          canManageInvitations: true,
        },
      },
    });
    expect(config.body.roles.every((role: any) => role.grantable === false)).toBe(true);

    expect(await request(harness, 'POST', '/auth/platform/members', {
      email: unadded.user.email,
      roles: ['delegated-operator'],
    }, delegatedSession.accessToken)).toMatchObject({
      status: 403,
      body: { code: 'FORBIDDEN' },
    });
    expect(await request(
      harness,
      'PATCH',
      `/auth/platform/members/${targetMember.body.member.membershipId}`,
      { status: 'suspended' },
      delegatedSession.accessToken,
    )).toMatchObject({ status: 200, body: { member: { status: 'suspended' } } });
    expect(await request(
      harness,
      'PATCH',
      `/auth/platform/members/${targetMember.body.member.membershipId}`,
      { status: 'active' },
      delegatedSession.accessToken,
    )).toMatchObject({ status: 200, body: { member: { status: 'active' } } });
    expect(await request(
      harness,
      'PATCH',
      `/auth/platform/members/${targetMember.body.member.membershipId}`,
      {
        roles: ['delegated-operator'],
        expectedRoleRevision: targetMember.body.member.roleRevision,
      },
      delegatedSession.accessToken,
    )).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });

    const invitation = await request(harness, 'POST', '/auth/platform/invitations', {
      email: 'delegated-revoke@example.test',
      roles: ['administrator'],
      delivery: 'manual',
    }, owner.accessToken);
    expect(invitation.status).toBe(200);
    expect(await request(harness, 'POST', '/auth/platform/invitations', {
      email: 'delegated-issue@example.test',
      roles: ['delegated-operator'],
      delivery: 'manual',
    }, delegatedSession.accessToken)).toMatchObject({
      status: 403,
      body: { code: 'FORBIDDEN' },
    });
    expect(await request(
      harness,
      'DELETE',
      `/auth/platform/invitations/${invitation.body.invitation.invitationId}`,
      undefined,
      delegatedSession.accessToken,
    )).toMatchObject({ status: 200, body: { invitation: { status: 'revoked' } } });
    expect(await request(
      harness,
      'DELETE',
      `/auth/platform/members/${targetMember.body.member.membershipId}`,
      undefined,
      delegatedSession.accessToken,
    )).toMatchObject({ status: 200, body: { member: { status: 'removed' } } });
  }, 60_000);

  test('keeps out-of-kind assignments inert and lets only the live owner clean them up', async () => {
    const harness = await start({ mode: 'advanced' });
    const owner = await register(harness, 'platform-scope-cleanup-owner');
    const delegate = await register(harness, 'platform-scope-cleanup-delegate');
    const target = await register(harness, 'platform-scope-cleanup-target');
    const delegated = await request(harness, 'POST', '/auth/platform/members', {
      email: delegate.user.email,
      roles: ['access-manager'],
    }, owner.accessToken);
    const targetMember = await request(harness, 'POST', '/auth/platform/members', {
      email: target.user.email,
      roles: ['administrator'],
    }, owner.accessToken);
    expect(delegated.status).toBe(200);
    expect(targetMember.status).toBe(200);

    harness.db.prepare(`
      INSERT INTO _auth_tenant_membership_roles (
        assignment_id, tenant_id, membership_id, user_id, role_key,
        source, source_id, created_by, created_at, revoked_by, revoked_at
      ) VALUES (?, ?, ?, ?, 'member', 'migration', ?, ?, ?, NULL, NULL)
    `).run(
      'arole_platform_out_of_kind_test',
      owner.tenant.tenantId,
      targetMember.body.member.membershipId,
      target.user.userId,
      'platform-out-of-kind-test',
      owner.user.userId,
      Date.now(),
    );
    harness.db.prepare(`
      UPDATE _auth_tenant_memberships
      SET authorization_generation = authorization_generation + 1
      WHERE membership_id = ?
    `).run(targetMember.body.member.membershipId);

    const listed = await request(
      harness,
      'GET',
      '/auth/platform/members?search=platform-scope-cleanup-target',
      undefined,
      owner.accessToken,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.members[0].roles).toEqual(['administrator', 'member']);
    expect(harness.runtime.getAuthorizationRoleService()!.resolveTenantRoles({
      tenantId: owner.tenant.tenantId,
      membershipId: targetMember.body.member.membershipId,
      userId: target.user.userId,
    })?.roles).toEqual(['administrator']);

    const delegateSession = await switchTenant(
      harness,
      delegate.refreshToken,
      owner.tenant.tenantId,
    );
    expect(await request(
      harness,
      'PATCH',
      `/auth/platform/members/${targetMember.body.member.membershipId}`,
      {
        roles: ['administrator'],
        expectedRoleRevision: listed.body.members[0].roleRevision,
      },
      delegateSession.accessToken,
    )).toMatchObject({
      status: 403,
      body: { code: 'TENANT_ROLE_ESCALATION_FORBIDDEN' },
    });

    const cleaned = await request(
      harness,
      'PATCH',
      `/auth/platform/members/${targetMember.body.member.membershipId}`,
      {
        roles: ['administrator'],
        expectedRoleRevision: listed.body.members[0].roleRevision,
      },
      owner.accessToken,
    );
    expect(cleaned).toMatchObject({
      status: 200,
      body: { member: { roles: ['administrator'] } },
    });
    expect(await request(
      harness,
      'PATCH',
      `/auth/platform/members/${targetMember.body.member.membershipId}`,
      {
        roles: ['administrator', 'member'],
        expectedRoleRevision: cleaned.body.member.roleRevision,
      },
      owner.accessToken,
    )).toMatchObject({
      status: 422,
      body: { code: 'AUTHORIZATION_ADMINISTRATION_ROLE_REQUIRED' },
    });
  }, 60_000);

  test('revalidates application authority inside tenant lifecycle writes', async () => {
    const harness = await start();
    const owner = await register(harness, 'platform-fence-owner');
    const customer = await register(harness, 'platform-fence-customer');
    const auth = await harness.runtime.getTokenService()!.resolveAuthContext(owner.accessToken);
    if (!auth?.sessionId) throw new Error('Platform owner session was not resolved');
    const service = harness.runtime.getPlatformTenantAdministrationService()!;
    const updateTenant = service.updateTenant.bind(service);
    let intercepted = false;
    (service as any).updateTenant = (input: any) => {
      intercepted = true;
      harness.runtime.getAuthSessionService()!.revoke(
        auth.sessionId!,
        'platform-commit-fence-test',
      );
      return updateTenant(input);
    };
    let response;
    try {
      response = await request(
        harness,
        'PATCH',
        `/auth/platform/tenants/${customer.tenant.tenantId}`,
        { status: 'suspended', expectedAuthorizationGeneration: 0 },
        owner.accessToken,
      );
    } finally {
      (service as any).updateTenant = updateTenant;
    }
    expect(intercepted).toBe(true);
    expect(response!).toMatchObject({
      status: 409,
      body: { code: 'AUTHORIZATION_CHANGED' },
    });
    expect(harness.runtime.getTenancyService()!.getTenant(customer.tenant.tenantId))
      .toMatchObject({ status: 'active', authorizationGeneration: 0 });
  }, 60_000);

  test('publishes tenant lifecycle success only after the outermost commit', async () => {
    const harness = await start();
    const owner = await register(harness, 'platform-event-owner');
    const customer = await register(harness, 'platform-event-customer');
    const service = harness.runtime.getPlatformTenantAdministrationService()!;
    const assertCurrentAuthority = await applicationAuthority(harness, owner.accessToken);
    const rollback = new Error('rollback platform tenant mutation');

    harness.events.clear();
    expect(() => harness.db.transaction(() => {
      service.createTenant({
        administrationTenantId: owner.tenant.tenantId,
        name: 'Rolled back customer',
        slug: 'rolled-back-customer',
        ownerEmail: customer.user.email,
        assertCurrentAuthority,
      });
      throw rollback;
    })).toThrow(rollback);
    expect(harness.runtime.getTenancyService()!.getTenantBySlug('rolled-back-customer'))
      .toBeNull();
    expect(harness.events.query({ code: OBS_CODES.AUTH_TENANT_CREATED.code }).events)
      .toHaveLength(0);

    const created = harness.db.transaction(() => service.createTenant({
      administrationTenantId: owner.tenant.tenantId,
      name: 'Committed customer',
      slug: 'committed-customer',
      ownerEmail: customer.user.email,
      assertCurrentAuthority,
    }));
    expect(harness.events.query({ code: OBS_CODES.AUTH_TENANT_CREATED.code }).events)
      .toEqual([expect.objectContaining({
        metadata: {
          tenantId: created.tenant.tenantId,
          kind: 'organization',
        },
      })]);

    harness.events.clear();
    expect(() => harness.db.transaction(() => {
      service.updateTenant({
        administrationTenantId: owner.tenant.tenantId,
        tenantId: created.tenant.tenantId,
        status: 'suspended',
        expectedAuthorizationGeneration: created.tenant.authorizationGeneration,
        assertCurrentAuthority,
      });
      throw rollback;
    })).toThrow(rollback);
    expect(harness.runtime.getTenancyService()!.getTenant(created.tenant.tenantId))
      .toMatchObject({ status: 'active' });
    expect(harness.events.query({ code: OBS_CODES.AUTH_TENANT_SUSPENDED.code }).events)
      .toHaveLength(0);

    const mutableUpdate: Parameters<typeof service.updateTenant>[0] = {
      administrationTenantId: owner.tenant.tenantId,
      tenantId: created.tenant.tenantId,
      status: 'suspended',
      expectedAuthorizationGeneration: created.tenant.authorizationGeneration,
      assertCurrentAuthority,
    };
    mutableUpdate.assertCurrentAuthority = (permissions) => {
      mutableUpdate.administrationTenantId = 'tenant_callback_mutation';
      mutableUpdate.tenantId = customer.tenant.tenantId;
      mutableUpdate.status = 'active';
      mutableUpdate.expectedAuthorizationGeneration = 999;
      return assertCurrentAuthority(permissions);
    };
    const updated = harness.db.transaction(() => service.updateTenant(mutableUpdate));
    expect(updated.tenant.status).toBe('suspended');
    expect(harness.runtime.getTenancyService()!.getTenant(customer.tenant.tenantId))
      .toMatchObject({ status: 'active' });
    expect(harness.events.query({ code: OBS_CODES.AUTH_TENANT_SUSPENDED.code }).events)
      .toEqual([expect.objectContaining({
        metadata: { tenantId: created.tenant.tenantId },
      })]);
    service.updateTenant({
      administrationTenantId: owner.tenant.tenantId,
      tenantId: created.tenant.tenantId,
      status: 'suspended',
      expectedAuthorizationGeneration: created.tenant.authorizationGeneration,
      assertCurrentAuthority,
    });
    expect(harness.events.query({ code: OBS_CODES.AUTH_TENANT_SUSPENDED.code }).events)
      .toHaveLength(1);
  }, 60_000);
});

async function start(
  authorization: AuthAuthorizationConfig = 'simple',
): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  const appRuntime = new ZeroAppRuntime(`platform-administration-${crypto.randomUUID()}`);
  const events = new MemoryEventStore({ maxEvents: 100 });
  appRuntime.set(ZERO_OBSERVABILITY_RUNTIME, {
    sink: events,
    store: events,
    config: { console: false },
  });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    runtime: appRuntime,
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
    appRuntime,
    db,
    events,
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

async function applicationAuthority(harness: Harness, accessToken: string) {
  const tokens = harness.runtime.getTokenService()!;
  const auth = await tokens.resolveAuthContext(accessToken);
  if (!auth) throw new Error('Expected a current application auth context');
  return captureAuthApplicationMutationAuthority({
    auth,
    tokenService: tokens,
    kernel: harness.runtime.getAuthorizationKernel(),
    store: harness.runtime.getStore()!,
    roles: harness.runtime.getAuthorizationRoleService(),
  });
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
