import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import type { TokenService } from '../auth/token-service';
import type { AuthContext, AuthContextAuthorityReference } from '../auth/types';
import { createSchedulerPlugin } from '../scheduler';
import { createReactiveDB } from '../sync/reactive-db';
import { createWorkflowPlugin } from './workflow.plugin';
import { flow, step } from './workflow-dsl';

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
    const app = new Elysia()
      // Scheduler routes are outside this harness; avoid installing a second
      // incomplete auth facade ahead of the workflow's Guardian-aware one.
      .use(createSchedulerPlugin({ getTokenService: () => null }))
      .use(createWorkflowPlugin({
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

  test('isolates tenant-authored definition CRUD, names, versions, and starts by scope', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'simple',
        roles: {
          workflow_manager: { permissions: ['workflows:manage'] },
          clinician: { permissions: [] },
          member: { permissions: [] },
        },
      },
    }));
    const alphaTenant = 'tenant_alpha';
    const betaTenant = 'tenant_beta';
    const contexts = new Map<string, AuthContext>([
      ['alpha', context(
        'alpha-manager', 'user', 'workflow_manager', 'alpha-membership', alphaTenant,
      )],
      ['beta', context(
        'beta-manager', 'user', 'workflow_manager', 'beta-membership', betaTenant,
      )],
      ['alpha-clinician', context(
        'alpha-clinician', 'user', 'clinician', 'alpha-clinician-membership', alphaTenant,
      )],
      ['alpha-member', context(
        'alpha-member', 'user', 'member', 'alpha-member-membership', alphaTenant,
      )],
    ]);
    const app = new Elysia()
      .use(createSchedulerPlugin({ getTokenService: () => null }))
      .use(createWorkflowPlugin({
        db,
        getTokenService: () => fakeTokenService(contexts),
        authorization: {
          getAuthorizationKernel: () => kernel,
          getPropertyStore: () => ({ getProperties: () => ({}) }),
        },
        onRegistryCreated(registry) {
          registry.registerActivity({
            name: 'database-noop',
            version: '1',
            databaseCallable: true,
            default: true,
            handler: async ({ input }) => input,
          });
          registry.create({
            name: 'shared-name',
            version: 7,
            flow: flow(step('global-code', 'database-noop')),
          });
        },
      }));
    app.listen(0);
    const baseUrl = `http://localhost:${app.server!.port}`;
    const graph = (label: string) => ({
      schemaVersion: 1,
      entry: 'complete',
      nodes: [{
        id: 'complete',
        kind: 'activity',
        label,
        activity: { name: 'database-noop', version: '1' },
      }],
      edges: [],
    });

    try {
      const alpha = await request(
        baseUrl,
        'POST',
        '/workflows/admin/definitions/publish',
        'alpha',
        { name: 'shared-name', graph: graph('Alpha only') },
      );
      const beta = await request(
        baseUrl,
        'POST',
        '/workflows/admin/definitions/publish',
        'beta',
        { name: 'shared-name', graph: graph('Beta only') },
      );
      expect(alpha.status).toBe(200);
      expect(beta.status).toBe(200);
      expect(alpha.body).toMatchObject({ version: { version: 1 } });
      expect(beta.body).toMatchObject({ version: { version: 1 } });
      const alphaDefinitionId = String((alpha.body as Record<string, unknown>).definitionId);
      const betaDefinitionId = String((beta.body as Record<string, unknown>).definitionId);
      expect(alphaDefinitionId).not.toBe(betaDefinitionId);

      const alphaVisible = await request(baseUrl, 'GET', '/workflows/definitions', 'alpha');
      const betaVisible = await request(baseUrl, 'GET', '/workflows/definitions', 'beta');
      expect(alphaVisible.body).toEqual([
        { name: 'shared-name', steps: [{ name: 'Alpha only' }] },
      ]);
      expect(betaVisible.body).toEqual([
        { name: 'shared-name', steps: [{ name: 'Beta only' }] },
      ]);

      const crossScope = await request(
        baseUrl,
        'GET',
        `/workflows/admin/definitions/${alphaDefinitionId}/versions`,
        'beta',
      );
      expect(crossScope).toEqual({
        status: 404,
        body: { error: 'Workflow not found', code: 'WORKFLOW_NOT_FOUND' },
      });

      const alphaRun = await request(baseUrl, 'POST', '/workflows', 'alpha', {
        name: 'shared-name', input: { scope: 'alpha' },
      });
      const betaRun = await request(baseUrl, 'POST', '/workflows', 'beta', {
        name: 'shared-name', input: { scope: 'beta' },
      });
      expect(alphaRun.status).toBe(200);
      expect(betaRun.status).toBe(200);
      expect(db.queryOne(
        'workflow_instances',
        String((alphaRun.body as Record<string, unknown>).instanceId),
      )).toMatchObject({ tenant_id: alphaTenant, definition_id: alphaDefinitionId });
      expect(db.queryOne(
        'workflow_instances',
        String((betaRun.body as Record<string, unknown>).instanceId),
      )).toMatchObject({ tenant_id: betaTenant, definition_id: betaDefinitionId });
      expect((await request(baseUrl, 'POST', '/workflows', 'alpha', {
        name: 'shared-name', input: {}, version: 7,
      })).status).toBe(404);

      const restricted = await request(
        baseUrl,
        'POST',
        '/workflows/admin/definitions/publish',
        'alpha',
        {
          name: 'clinician-only',
          graph: graph('Clinician task'),
          access: { start: ['clinician'] },
        },
      );
      expect(restricted.status).toBe(200);
      const clinicianCatalog = await request(
        baseUrl, 'GET', '/workflows/definitions', 'alpha-clinician',
      );
      const memberCatalog = await request(
        baseUrl, 'GET', '/workflows/definitions', 'alpha-member',
      );
      expect((clinicianCatalog.body as Array<Record<string, unknown>>)
        .map((entry) => entry.name)).toContain('clinician-only');
      expect((memberCatalog.body as Array<Record<string, unknown>>)
        .map((entry) => entry.name)).not.toContain('clinician-only');
      expect((await request(baseUrl, 'POST', '/workflows', 'alpha-clinician', {
        name: 'clinician-only', input: {},
      })).status).toBe(200);
      expect((await request(baseUrl, 'POST', '/workflows', 'alpha-member', {
        name: 'clinician-only', input: {},
      })).status).toBe(404);
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
  tenantId = TENANT_ID,
): AuthContext {
  return {
    userId,
    email: `${userId}@example.test`,
    role: platformRole,
    sessionKind: 'web',
    sessionId: `session_${userId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
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
