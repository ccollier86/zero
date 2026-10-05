import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createAuthMiddleware } from './auth.middleware';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';
import type { AuthBehaviorConfig } from './types';

const API_KEY_PROBE_ACCESS = {
  user: 'required',
  credentials: ['session', 'api-key'],
} as const;

const APPLICATION_RECORD_ACCESS = {
  user: 'required',
  credentials: ['session', 'api-key'],
  permission: 'records:read',
} as const;

const TENANT_RECORD_ACCESS = {
  user: 'required',
  tenant: 'required',
  credentials: ['session', 'api-key'],
  permission: 'records:read',
} as const;

interface Harness {
  readonly app: AnyElysia;
  readonly db: ReactiveDB;
  readonly runtime: AuthRuntime;
  readonly url: string;
}

interface Session {
  readonly user: { readonly userId: string; readonly email: string };
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tenant?: { readonly tenantId: string; readonly membershipId: string };
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
  }
});

describe('Guardian API keys in advanced authorization profiles', () => {
  test('administration-only eligibility allows bound user keys without weakening customer or credential fences', async () => {
    const harness = await start('multi', ['administrator']);
    const owner = await register(harness, 'admin-eligible-owner', 'Administration');
    const subject = await register(harness, 'admin-eligible-user', 'Subject workspace');
    const customer = await register(harness, 'customer-eligible-user', 'Customer');
    const membershipId = addOrganizationMember(harness, owner, subject, ['administrator', 'record-reader']);
    const adminSession = await switchTenant(harness, subject.refreshToken, owner.tenant!.tenantId);
    const issued = await request(harness, 'POST', '/auth/api-keys', { label: 'Administration-scoped user automation' }, adminSession.accessToken);
    expect(issued).toMatchObject({ status: 200, body: { apiKey: {
      userId: subject.user.userId, scopeKind: 'tenant', tenantId: owner.tenant!.tenantId,
      membershipId, status: 'active',
    } } });
    const secret = issued.body.secret as string;
    expect(await request(harness, 'GET', '/api/records', undefined, secret)).toMatchObject({
      status: 200, body: { tenantId: owner.tenant!.tenantId, credentialKind: 'api-key' },
    });
    // Platform management is deliberately session-only, even for an eligible
    // user whose live role projects platform authority.
    expect(await request(harness, 'GET', '/auth/admin/users', undefined, secret)).toMatchObject({ status: 401, body: { code: 'UNAUTHORIZED' } });
    expect(await request(harness, 'POST', '/auth/api-keys', { label: 'Cannot bootstrap a credential from a key' }, secret)).toMatchObject({ status: 401, body: { code: 'UNAUTHORIZED' } });
    expect((await request(harness, 'POST', '/auth/tenant/members', {
      email: subject.user.email, roles: ['administrator'],
    }, customer.accessToken)).status).toBe(422);
    expect((await request(harness, 'POST', '/auth/api-keys', { label: 'Customer owner not on allowlist' }, customer.accessToken)).status).toBe(403);

    replaceTenantRoles(harness, owner, membershipId, ['administrator']);
    expect((await request(harness, 'GET', '/api/records', undefined, secret)).status).toBe(403);
    expect((await request(harness, 'GET', '/api/api-key-probe', undefined, secret)).status).toBe(200);
    replaceTenantRoles(harness, owner, membershipId, ['record-reader']);
    expect((await request(harness, 'GET', '/api/api-key-probe', undefined, secret)).status).toBe(401);
    expect((await request(harness, 'GET', '/api/records', undefined, secret)).status).toBe(401);
    // Removing platform authority also fences the old administration session;
    // use the unchanged owner session to inspect the key's live disposition.
    expect((await request(harness, 'GET', '/auth/api-keys', undefined, adminSession.accessToken)).status).toBe(401);
    const unavailable = await request(harness, 'GET', `/auth/tenant/members/${membershipId}/api-keys`, undefined, owner.accessToken);
    expect(unavailable).toMatchObject({ status: 200, body: { apiKeys: [{ status: 'unavailable' }] } });
  }, 60_000);

  test('single/advanced reuses live permissions, eligibility, and administrator authority', async () => {
    const harness = await start('single');
    const owner = await register(harness, 'single-owner');
    const target = await register(harness, 'single-target');
    const auditor = await register(harness, 'single-key-auditor');
    const manager = await register(harness, 'single-key-manager');
    const roles = harness.runtime.getAuthorizationRoleService()!;

    roles.replaceApplicationRoles({
      userId: target.user.userId,
      roleKeys: ['automation', 'record-reader'],
      changedBy: owner.user.userId,
    });
    roles.replaceApplicationRoles({
      userId: auditor.user.userId,
      roleKeys: ['key-auditor'],
      changedBy: owner.user.userId,
    });
    roles.replaceApplicationRoles({
      userId: manager.user.userId,
      roleKeys: ['key-manager'],
      changedBy: owner.user.userId,
    });

    const selfIssued = await request(
      harness,
      'POST',
      '/auth/api-keys',
      { label: 'Advanced application automation' },
      target.accessToken,
    );
    expect(selfIssued).toMatchObject({
      status: 200,
      body: {
        apiKey: {
          userId: target.user.userId,
          scopeKind: 'application',
          status: 'active',
        },
      },
    });

    expect(await request(
      harness,
      'GET',
      '/api/records',
      undefined,
      selfIssued.body.secret,
    )).toMatchObject({
      status: 200,
      body: {
        userId: target.user.userId,
        credentialKind: 'api-key',
      },
    });

    roles.replaceApplicationRoles({
      userId: target.user.userId,
      roleKeys: ['automation'],
      changedBy: owner.user.userId,
    });
    expect((await request(
      harness,
      'GET',
      '/api/records',
      undefined,
      selfIssued.body.secret,
    )).status).toBe(403);
    expect((await request(
      harness,
      'GET',
      '/api/api-key-probe',
      undefined,
      selfIssued.body.secret,
    )).status).toBe(200);

    roles.replaceApplicationRoles({
      userId: target.user.userId,
      roleKeys: ['automation', 'record-reader'],
      changedBy: owner.user.userId,
    });
    expect((await request(
      harness,
      'GET',
      '/api/records',
      undefined,
      selfIssued.body.secret,
    )).status).toBe(200);

    roles.replaceApplicationRoles({
      userId: target.user.userId,
      roleKeys: ['record-reader'],
      changedBy: owner.user.userId,
    });
    expect((await request(
      harness,
      'GET',
      '/api/api-key-probe',
      undefined,
      selfIssued.body.secret,
    )).status).toBe(401);

    const unavailable = await request(
      harness,
      'GET',
      `/auth/admin/users/${target.user.userId}/api-keys`,
      undefined,
      auditor.accessToken,
    );
    expect(unavailable).toMatchObject({
      status: 200,
      body: {
        apiKeys: [{ keyId: selfIssued.body.apiKey.keyId, status: 'unavailable' }],
        capabilities: { canIssue: false, canRotate: false, canRevoke: false },
      },
    });
    const managerUnavailable = await request(
      harness,
      'GET',
      `/auth/admin/users/${target.user.userId}/api-keys`,
      undefined,
      manager.accessToken,
    );
    expect(managerUnavailable.body.capabilities).toEqual({
      canIssue: false,
      canRotate: false,
      canRevoke: true,
    });

    const ineligibleIssue = await request(
      harness,
      'POST',
      `/auth/admin/users/${target.user.userId}/api-keys`,
      { label: 'Ineligible target' },
      manager.accessToken,
    );
    expect(ineligibleIssue).toMatchObject({
      status: 403,
      body: { code: 'AUTH_API_KEY_SUBJECT_INELIGIBLE' },
    });

    roles.replaceApplicationRoles({
      userId: target.user.userId,
      roleKeys: ['automation', 'record-reader'],
      changedBy: owner.user.userId,
    });
    const auditorPage = await request(
      harness,
      'GET',
      `/auth/admin/users/${target.user.userId}/api-keys`,
      undefined,
      auditor.accessToken,
    );
    expect(auditorPage.body.capabilities).toEqual({
      canIssue: false,
      canRotate: false,
      canRevoke: false,
    });
    const managerPage = await request(
      harness,
      'GET',
      `/auth/admin/users/${target.user.userId}/api-keys`,
      undefined,
      manager.accessToken,
    );
    expect(managerPage.body.capabilities).toEqual({
      canIssue: true,
      canRotate: true,
      canRevoke: true,
    });
    expect((await request(
      harness,
      'POST',
      `/auth/admin/users/${target.user.userId}/api-keys`,
      { label: 'Auditor cannot issue' },
      auditor.accessToken,
    )).status).toBe(403);

    const administratorIssued = await request(
      harness,
      'POST',
      `/auth/admin/users/${target.user.userId}/api-keys`,
      { label: 'Manager-issued key' },
      manager.accessToken,
    );
    expect(administratorIssued).toMatchObject({
      status: 200,
      body: {
        apiKey: {
          userId: target.user.userId,
          createdVia: 'administrator',
          status: 'active',
        },
      },
    });

    const administratorKeyId = administratorIssued.body.apiKey.keyId;
    expect((await request(
      harness,
      'POST',
      `/auth/admin/api-keys/${administratorKeyId}/rotate`,
      { label: 'Auditor cannot rotate' },
      auditor.accessToken,
    )).status).toBe(403);
    expect((await request(
      harness,
      'DELETE',
      `/auth/admin/api-keys/${administratorKeyId}`,
      undefined,
      auditor.accessToken,
    )).status).toBe(403);

    const rotated = await request(
      harness,
      'POST',
      `/auth/admin/api-keys/${administratorKeyId}/rotate`,
      { label: 'Manager-rotated key' },
      manager.accessToken,
    );
    expect(rotated).toMatchObject({
      status: 200,
      body: {
        apiKey: {
          userId: target.user.userId,
          createdVia: 'administrator',
          status: 'active',
        },
      },
    });
    expect(rotated.body.apiKey.keyId).not.toBe(administratorKeyId);

    const revoked = await request(
      harness,
      'DELETE',
      `/auth/admin/api-keys/${rotated.body.apiKey.keyId}`,
      undefined,
      manager.accessToken,
    );
    expect(revoked).toMatchObject({ status: 200, body: { status: 'revoked' } });
  }, 60_000);

  test('multi/advanced binds live tenant roles and tenant-administrator authority', async () => {
    const harness = await start('multi');
    const platform = await register(harness, 'platform-owner', 'Platform Administration');
    const owner = await register(harness, 'tenant-owner', 'Advanced Tenant');
    const target = await register(harness, 'tenant-target', 'Target Home');
    const auditor = await register(harness, 'tenant-key-auditor', 'Auditor Home');
    const manager = await register(harness, 'tenant-key-manager', 'Manager Home');
    const tenantId = owner.tenant!.tenantId;

    const targetMembershipId = addOrganizationMember(
      harness,
      owner,
      target,
      ['automation', 'record-reader'],
    );
    const auditorMembershipId = addOrganizationMember(
      harness,
      owner,
      auditor,
      ['key-auditor'],
    );
    const managerMembershipId = addOrganizationMember(
      harness,
      owner,
      manager,
      ['key-manager'],
    );
    const targetTenantSession = await switchTenant(harness, target.refreshToken, tenantId);
    const auditorTenantSession = await switchTenant(harness, auditor.refreshToken, tenantId);
    const managerTenantSession = await switchTenant(harness, manager.refreshToken, tenantId);

    const selfIssued = await request(
      harness,
      'POST',
      '/auth/api-keys',
      { label: 'Advanced tenant automation' },
      targetTenantSession.accessToken,
    );
    expect(selfIssued).toMatchObject({
      status: 200,
      body: {
        apiKey: {
          userId: target.user.userId,
          scopeKind: 'tenant',
          scopeId: tenantId,
          tenantId,
          membershipId: targetMembershipId,
          status: 'active',
        },
      },
    });
    expect(await request(
      harness,
      'GET',
      '/api/records',
      undefined,
      selfIssued.body.secret,
    )).toMatchObject({
      status: 200,
      body: {
        userId: target.user.userId,
        credentialKind: 'api-key',
        tenantId,
      },
    });

    replaceTenantRoles(harness, owner, targetMembershipId, ['automation']);
    expect((await request(
      harness,
      'GET',
      '/api/records',
      undefined,
      selfIssued.body.secret,
    )).status).toBe(403);
    expect((await request(
      harness,
      'GET',
      '/api/api-key-probe',
      undefined,
      selfIssued.body.secret,
    )).status).toBe(200);

    replaceTenantRoles(
      harness,
      owner,
      targetMembershipId,
      ['automation', 'record-reader'],
    );
    expect((await request(
      harness,
      'GET',
      '/api/records',
      undefined,
      selfIssued.body.secret,
    )).status).toBe(200);

    replaceTenantRoles(harness, owner, targetMembershipId, ['record-reader']);
    expect((await request(
      harness,
      'GET',
      '/api/api-key-probe',
      undefined,
      selfIssued.body.secret,
    )).status).toBe(401);

    const unavailable = await request(
      harness,
      'GET',
      `/auth/tenant/members/${targetMembershipId}/api-keys`,
      undefined,
      auditorTenantSession.accessToken,
    );
    expect(unavailable).toMatchObject({
      status: 200,
      body: {
        apiKeys: [{ keyId: selfIssued.body.apiKey.keyId, status: 'unavailable' }],
        capabilities: { canIssue: false, canRotate: false, canRevoke: false },
      },
    });
    const managerUnavailable = await request(
      harness,
      'GET',
      `/auth/tenant/members/${targetMembershipId}/api-keys`,
      undefined,
      managerTenantSession.accessToken,
    );
    expect(managerUnavailable.body.capabilities).toEqual({
      canIssue: false,
      canRotate: false,
      canRevoke: true,
    });

    const platformDirectory = await request(
      harness,
      'GET',
      '/auth/platform/api-keys',
      undefined,
      platform.accessToken,
    );
    expect(platformDirectory).toMatchObject({
      status: 200,
      body: {
        capabilities: { canIssue: false, canRotate: true, canRevoke: true },
      },
    });
    const ineligiblePlatformTarget = await request(
      harness,
      'GET',
      `/auth/platform/tenants/${tenantId}/members/${targetMembershipId}/api-keys`,
      undefined,
      platform.accessToken,
    );
    expect(ineligiblePlatformTarget).toMatchObject({
      status: 200,
      body: {
        capabilities: { canIssue: false, canRotate: false, canRevoke: true },
      },
    });

    const ineligibleIssue = await request(
      harness,
      'POST',
      `/auth/tenant/members/${targetMembershipId}/api-keys`,
      { label: 'Ineligible target' },
      managerTenantSession.accessToken,
    );
    expect(ineligibleIssue).toMatchObject({
      status: 403,
      body: { code: 'AUTH_API_KEY_SUBJECT_INELIGIBLE' },
    });

    replaceTenantRoles(
      harness,
      owner,
      targetMembershipId,
      ['automation', 'record-reader'],
    );
    const auditorPage = await request(
      harness,
      'GET',
      `/auth/tenant/members/${targetMembershipId}/api-keys`,
      undefined,
      auditorTenantSession.accessToken,
    );
    expect(auditorPage.body.capabilities).toEqual({
      canIssue: false,
      canRotate: false,
      canRevoke: false,
    });
    const managerPage = await request(
      harness,
      'GET',
      `/auth/tenant/members/${targetMembershipId}/api-keys`,
      undefined,
      managerTenantSession.accessToken,
    );
    expect(managerPage.body.capabilities).toEqual({
      canIssue: true,
      canRotate: true,
      canRevoke: true,
    });
    const eligiblePlatformTarget = await request(
      harness,
      'GET',
      `/auth/platform/tenants/${tenantId}/members/${targetMembershipId}/api-keys`,
      undefined,
      platform.accessToken,
    );
    expect(eligiblePlatformTarget.body.capabilities).toEqual({
      canIssue: true,
      canRotate: true,
      canRevoke: true,
    });
    expect((await request(
      harness,
      'POST',
      `/auth/tenant/members/${targetMembershipId}/api-keys`,
      { label: 'Auditor cannot issue' },
      auditorTenantSession.accessToken,
    )).status).toBe(403);

    const administratorIssued = await request(
      harness,
      'POST',
      `/auth/tenant/members/${targetMembershipId}/api-keys`,
      { label: 'Tenant manager-issued key' },
      managerTenantSession.accessToken,
    );
    expect(administratorIssued).toMatchObject({
      status: 200,
      body: {
        apiKey: {
          userId: target.user.userId,
          tenantId,
          membershipId: targetMembershipId,
          createdVia: 'administrator',
          status: 'active',
        },
      },
    });

    const administratorKeyId = administratorIssued.body.apiKey.keyId;
    expect((await request(
      harness,
      'POST',
      `/auth/tenant/api-keys/${administratorKeyId}/rotate`,
      { label: 'Auditor cannot rotate' },
      auditorTenantSession.accessToken,
    )).status).toBe(403);
    expect((await request(
      harness,
      'DELETE',
      `/auth/tenant/api-keys/${administratorKeyId}`,
      undefined,
      auditorTenantSession.accessToken,
    )).status).toBe(403);

    const rotated = await request(
      harness,
      'POST',
      `/auth/tenant/api-keys/${administratorKeyId}/rotate`,
      { label: 'Tenant manager-rotated key' },
      managerTenantSession.accessToken,
    );
    expect(rotated).toMatchObject({
      status: 200,
      body: {
        apiKey: {
          userId: target.user.userId,
          tenantId,
          membershipId: targetMembershipId,
          status: 'active',
        },
      },
    });
    expect(rotated.body.apiKey.keyId).not.toBe(administratorKeyId);

    const revoked = await request(
      harness,
      'DELETE',
      `/auth/tenant/api-keys/${rotated.body.apiKey.keyId}`,
      undefined,
      managerTenantSession.accessToken,
    );
    expect(revoked).toMatchObject({ status: 200, body: { status: 'revoked' } });
    expect(auditorMembershipId).not.toBe(managerMembershipId);
  }, 60_000);
});

async function start(tenancy: 'single' | 'multi', eligibleScopeRoles: readonly string[] = ['automation']): Promise<Harness> {
  const db = createReactiveDB({ mode: 'memory' });
  let runtime: AuthRuntime | null = null;
  const config: AuthBehaviorConfig = {
    tenancy,
    authorization: {
      mode: 'advanced',
      permissions: {
        'records:read': { label: 'Read records' },
      },
      roles: tenancy === 'single' ? {
        automation: { permissions: [] },
        'record-reader': { permissions: ['records:read'] },
        'key-auditor': { permissions: ['application.roles:read'] },
        'key-manager': {
          permissions: ['application.roles:read', 'application.roles:manage'],
        },
      } : {
        automation: { permissions: [] },
        'record-reader': { permissions: ['records:read'] },
        'key-auditor': { permissions: ['tenant.members:read'] },
        'key-manager': {
          permissions: ['tenant.members:read', 'tenant.members:manage'],
        },
      },
    },
    apiKeys: {
      enabled: true,
      selfService: true,
      administratorIssuance: true,
      eligibleScopeRoles,
    },
  };
  const recordAccess = tenancy === 'single'
    ? APPLICATION_RECORD_ACCESS
    : TENANT_RECORD_ACCESS;
  const app = new Elysia()
    .use(createAuthPlugin({
      db,
      bootstrap: 'public',
      registration: { mode: 'public' },
      ...config,
      onRuntimeCreated(created) {
        runtime = created;
      },
    }))
    .use(createAuthMiddleware(
      () => runtime?.getTokenService() ?? null,
      {
        getRequestCredentialResolver: () => (
          runtime?.getRequestCredentialResolver() ?? null
        ),
        getAuthorizationKernel: () => runtime?.getAuthorizationKernel() ?? null,
        getPropertyStore: () => runtime?.getStore() ?? null,
        getRoleAssignments: () => runtime?.getAuthorizationRoleService() ?? null,
      },
    ))
    .get('/api/api-key-probe', (context: any) => ({
      userId: context.authContext.userId,
      credentialKind: context.authContext.credentialKind,
      tenantId: context.authContext.tenantId ?? null,
    }), { zeroAuth: API_KEY_PROBE_ACCESS })
    .get('/api/records', (context: any) => ({
      userId: context.authContext.userId,
      credentialKind: context.authContext.credentialKind,
      tenantId: context.authContext.tenantId ?? null,
    }), { zeroAuth: recordAccess });
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  const harness: Harness = {
    app,
    db,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  return harness;
}

async function register(
  harness: Harness,
  name: string,
  organizationName?: string,
): Promise<Session> {
  const response = await request(harness, 'POST', '/auth/register', {
    username: name,
    email: `${name}@example.test`,
    password: 'password123',
    ...(organizationName ? { organizationName } : {}),
  });
  expect(response.status).toBe(200);
  return response.body as Session;
}

function addOrganizationMember(
  harness: Harness,
  owner: Session,
  subject: Session,
  roleKeys: readonly string[],
): string {
  const tenancy = harness.runtime.getTenancyService()!;
  const tenantId = owner.tenant!.tenantId;
  const membership = tenancy.addMembership({
    tenantId,
    userId: subject.user.userId,
    roleKey: 'member',
    createdBy: owner.user.userId,
  });
  harness.runtime.getAuthorizationRoleService()!.replaceTenantRoles({
    tenantId,
    membershipId: membership.membershipId,
    roleKeys,
    changedBy: owner.user.userId,
  });
  return membership.membershipId;
}

function replaceTenantRoles(
  harness: Harness,
  owner: Session,
  membershipId: string,
  roleKeys: readonly string[],
): void {
  harness.runtime.getAuthorizationRoleService()!.replaceTenantRoles({
    tenantId: owner.tenant!.tenantId,
    membershipId,
    roleKeys,
    changedBy: owner.user.userId,
  });
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
  return response.body as { accessToken: string; refreshToken: string };
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
  const text = await response.text();
  let parsed: Record<string, any> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, any>;
    } catch {
      parsed = { error: text };
    }
  }
  return {
    status: response.status,
    body: parsed,
  };
}
