import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import type { TokenService } from '../auth/token-service';
import type { AuthContext, AuthContextAuthorityReference } from '../auth/types';
import { createReactiveDB } from '../sync/reactive-db';
import { createWorkflowPlugin } from './workflow.plugin';

const TENANT_ID = 'tenant_workflow_access';

describe('multi-tenant workflow HTTP ownership', () => {
  test('requires tenant authority instead of trusting the global admin role', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'simple',
        roles: {
          owner: { allPermissions: true },
          member: { permissions: [] },
          workflow_manager: { permissions: ['workflows:manage'] },
        },
      },
    }));
    const contexts = new Map<string, AuthContext>([
      ['owner', context('owner-user', 'user', 'owner', 'owner-membership')],
      ['platform-admin', context(
        'platform-admin-user',
        'admin',
        'member',
        'admin-membership',
      )],
      ['workflow-manager', context(
        'workflow-manager-user',
        'user',
        'workflow_manager',
        'manager-membership',
      )],
    ]);
    const tokens = fakeTokenService(contexts);
    const properties = { getProperties: () => ({}) };
    const app = new Elysia().use(createWorkflowPlugin({
      db,
      getTokenService: () => tokens,
      authorization: {
        getAuthorizationKernel: () => kernel,
        getPropertyStore: () => properties,
      },
      onRegistryCreated(registry) {
        registry.registerHandler('tenant-access-proof', async ({ execution }) => ({
          tenantId: execution.tenantId,
        }));
        registry.create({
          name: 'tenant-access-proof',
          steps: [{ name: 'Proof', handler: 'tenant-access-proof' }],
        });
      },
    }));
    app.listen(0);
    const baseUrl = `http://localhost:${app.server!.port}`;

    try {
      const ownerWorkflow = await start(baseUrl, 'owner');
      const adminWorkflow = await start(baseUrl, 'platform-admin');

      expect((await request(baseUrl, 'GET', `/workflows/${ownerWorkflow}`, 'owner')).status)
        .toBe(200);
      expect((await request(
        baseUrl,
        'GET',
        `/workflows/${ownerWorkflow}`,
        'platform-admin',
      )).status).toBe(404);

      const adminList = await request(baseUrl, 'GET', '/workflows', 'platform-admin');
      expect((adminList.body as Array<Record<string, unknown>>)
        .map((row) => row.instance_id)).toEqual([adminWorkflow]);

      expect((await request(
        baseUrl,
        'GET',
        `/workflows/${ownerWorkflow}`,
        'workflow-manager',
      )).status).toBe(200);
      const managerList = await request(baseUrl, 'GET', '/workflows', 'workflow-manager');
      expect(new Set((managerList.body as Array<Record<string, unknown>>)
        .map((row) => row.instance_id))).toEqual(new Set([ownerWorkflow, adminWorkflow]));

      // Tenant owner/allPermissions can also administer peer workflows.
      expect((await request(
        baseUrl,
        'GET',
        `/workflows/${adminWorkflow}`,
        'owner',
      )).status).toBe(200);
    } finally {
      await app.stop();
      db.dispose();
    }
  });
});

function context(
  userId: string,
  platformRole: string,
  tenantRole: string,
  membershipId: string,
): AuthContext {
  return {
    userId,
    email: `${userId}@example.test`,
    role: platformRole,
    sessionKind: 'web',
    sessionId: `session_${userId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: TENANT_ID,
    tenantId: TENANT_ID,
    membershipId,
    tenantRole,
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

function fakeTokenService(contexts: Map<string, AuthContext>): TokenService {
  return {
    async resolveAuthContext(token: string) {
      return contexts.get(token) ?? null;
    },
    captureAuthContextAuthority(auth: AuthContext) {
      return reference(auth);
    },
    resolveAuthContextAuthority(authority: AuthContextAuthorityReference) {
      const current = [...contexts.values()].find(
        (candidate) => candidate.sessionId === authority.sessionId,
      );
      return current && JSON.stringify(reference(current)) === JSON.stringify(authority)
        ? current
        : null;
    },
  } as TokenService;
}

function reference(auth: AuthContext): AuthContextAuthorityReference {
  return Object.freeze({
    version: 1,
    userId: auth.userId,
    platformRole: auth.role,
    authGeneration: 0,
    sessionKind: auth.sessionKind!,
    sessionId: auth.sessionId!,
    mfaVerifiedAt: auth.mfaVerifiedAt ?? null,
    sessionGeneration: auth.sessionGeneration ?? null,
    clientId: auth.clientId ?? null,
    identityScopes: Object.freeze([...(auth.scope ?? [])]),
    sessionScopeKind: auth.sessionScopeKind!,
    sessionScopeId: auth.sessionScopeId!,
    tenantId: auth.tenantId ?? null,
    tenantKind: auth.tenantKind ?? null,
    membershipId: auth.membershipId ?? null,
    tenantRole: auth.tenantRole ?? null,
    tenantAuthorizationGeneration: auth.tenantAuthorizationGeneration ?? null,
    membershipAuthorizationGeneration:
      auth.membershipAuthorizationGeneration ?? null,
    authorizationAssignmentRevision:
      auth.authorizationAssignmentRevision ?? null,
  });
}

async function start(baseUrl: string, token: string): Promise<string> {
  const response = await request(baseUrl, 'POST', '/workflows', token, {
    name: 'tenant-access-proof',
    input: {},
  });
  expect(response.status).toBe(200);
  return String((response.body as Record<string, unknown>).instanceId);
}

async function request(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as unknown,
  };
}
