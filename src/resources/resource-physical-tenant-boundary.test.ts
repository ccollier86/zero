import { describe, expect, test } from 'bun:test';

import type { AuthContext } from '../auth/types';
import type { UserStore } from '../auth/user-store';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createReactiveDB } from '../sync/reactive-db';
import { defineResource, tenantRealm } from './resource-definition';
import { authenticatedOnly } from './resource-policy-helpers';
import { createResourceRegistry } from './resource-registry';
import { ResourceCrudService } from './resource-crud-service';
import { ResourceSyncPolicyService } from './resource-sync-policy';
import {
  isResourceTenantRowScope,
  rejectResourceRealmUpdate,
  resolveResourceRealm,
  resourceRealmConstraint,
  resourceRowMatchesRealm,
  stampResourceCreateRealm,
} from './resource-realm';

const tables = {
  documents: {
    id: 'text primary key',
    title: 'text not null',
  },
};

describe('physical tenant resource boundary', () => {
  test('requires durable tenant authority without adding row-level ownership fields', () => {
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'documents',
        exposure: 'http',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      tenantIsolation: 'tenant-database',
      managedTables: ['documents'],
    });
    const resource = registry.getByTable('documents')!;

    expect(resolveResourceRealm(resource, {
      tenantId: 'tenant-a',
    })).toMatchObject({
      ok: false,
      code: 'resource-tenant-context-required',
    });

    const resolved = resolveResourceRealm(resource, tenantAuth('tenant-a'));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('Expected tenant realm resolution.');
    expect(resolved.scope).toMatchObject({
      kind: 'tenant',
      isolation: 'tenant-database',
      tenantId: 'tenant-a',
    });
    expect(resolved.scope).not.toHaveProperty('field');
    expect(isResourceTenantRowScope(resolved.scope)).toBe(false);

    expect(resourceRealmConstraint(resolved.scope)).toEqual([]);
    expect(resourceRowMatchesRealm({ id: 'doc-1' }, resolved.scope)).toBe(true);
    expect(resourceRowMatchesRealm({
      id: 'doc-2',
      tenant_id: 'another-tenant',
    }, resolved.scope)).toBe(true);

    const createInput = { id: 'doc-3', title: 'Physical boundary' };
    expect(stampResourceCreateRealm(createInput, resolved.scope)).toEqual({
      ok: true,
      input: createInput,
    });
    expect(rejectResourceRealmUpdate({
      tenant_id: 'ordinary-app-value',
    }, resolved.scope)).toEqual({ ok: true });
  });

  test('binds physical tenant files to exact resolved API-key authority', () => {
    const resource = createPhysicalRegistry().getByTable('documents')!;
    const first = resolveResourceRealm(resource, apiKeyTenantAuth('tenant-a', 'key-a', 1));
    const second = resolveResourceRealm(resource, apiKeyTenantAuth('tenant-a', 'key-b', 1));
    const regenerated = resolveResourceRealm(resource, apiKeyTenantAuth('tenant-a', 'key-a', 2));

    expect(first).toMatchObject({
      ok: true,
      scope: {
        isolation: 'tenant-database',
        tenantId: 'tenant-a',
      },
    });
    if (!first.ok || !second.ok || !regenerated.ok) {
      throw new Error('Expected resolved API-key tenant realms.');
    }
    expect(first.scope?.fingerprint).not.toBe(second.scope?.fingerprint);
    expect(first.scope?.fingerprint).not.toBe(regenerated.scope?.fingerprint);

    expect(resolveResourceRealm(resource, {
      ...apiKeyTenantAuth('tenant-a', 'key-a', 1),
      sessionKind: 'native',
      clientId: 'contradictory-native-client',
      sessionId: 'contradictory-native-family',
    })).toMatchObject({
      ok: false,
      code: 'resource-tenant-context-required',
    });
  });

  test('classifies and authorizes physical resources for actor-backed Sync', async () => {
    const registry = createPhysicalRegistry('sync');
    const service = new ResourceSyncPolicyService({
      registry,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: new Set(['documents']),
    });
    const authContext = tenantAuth('tenant-a');

    expect(service.classifyManagedTableDataPlane('documents')).toBe('tenant');
    expect(service.classifyManagedTableDataPlane('unknown')).toBeNull();

    const access = await service.resolveTableAccess({
      tableNames: ['documents'],
      authContext,
    });
    expect(access.readableTables.has('documents')).toBeTrue();
    expect(await service.authorizeMutation({
      table: 'documents',
      op: 'INSERT',
      row: { id: 'doc-1', title: 'Actor tenant plane' },
      authContext,
      loadRow: () => null,
    })).toMatchObject({
      ok: true,
      row: { id: 'doc-1', title: 'Actor tenant plane' },
    });
  });

  test('invalidates the captured read authority when trusted user properties change', async () => {
    let department = 'clinical';
    const store = {
      getUserById() {
        return {
          userId: 'user-1',
          email: 'user@example.test',
          role: 'user',
          status: 'active',
          passwordChangeRequired: false,
          emailVerificationRequired: false,
          emailVerifiedAt: null,
          properties: { department },
        };
      },
    } as unknown as UserStore;
    const service = new ResourceSyncPolicyService({
      registry: createPhysicalRegistry('sync'),
      authConfig: resolveAuthBehaviorConfig({
        userProperties: {
          department: {
            type: 'string',
            editableBy: 'admin',
            useInPolicies: true,
          },
        },
      }),
      getUserStore: () => store,
      tenancyMode: 'multi',
      managedTables: new Set(['documents']),
    });
    const authContext = tenantAuth('tenant-a');
    const access = await service.resolveTableAccess({
      tableNames: ['documents'],
      authContext,
    });
    const fingerprint = access.readAuthorityFingerprint;

    expect(typeof fingerprint).toBe('string');
    expect(service.validateReadAuthorityAtDelivery(
      authContext,
      fingerprint!,
    )).toBeTrue();

    department = 'billing';
    expect(service.validateReadAuthorityAtDelivery(
      authContext,
      fingerprint!,
    )).toBeFalse();
  });

  test('fails closed instead of falling through to the default database', async () => {
    const registry = createPhysicalRegistry();
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', tables.documents);
    const service = new ResourceCrudService({
      db,
      registry,
      tables,
      authConfig: { userProperties: {} },
    });
    const context = { authContext: tenantAuth('tenant-a') };

    try {
      expect(await service.create('documents', {
        id: 'doc-1',
        title: 'No discriminator',
      }, context)).toMatchObject({
        ok: false,
        status: 403,
        body: {
          code: 'resource-authority-changed',
        },
      });
      expect(db.get('documents', 'doc-1')).toBeNull();
      expect(await service.list('documents', {}, context)).toMatchObject({
        ok: false,
        status: 403,
        body: {
          code: 'resource-authority-changed',
        },
      });
    } finally {
      db.dispose();
    }
  });

  test('classifies authority revoked during custom tenant capability acquisition', async () => {
    const registry = createPhysicalRegistry();
    const db = createReactiveDB({ mode: 'memory' });
    const authContext = tenantAuth('tenant-a');
    let durableAuth: AuthContext | null = authContext;
    const service = new ResourceCrudService({
      db,
      registry,
      tables,
      authConfig: { userProperties: {} },
      getTenantDatabaseClient: async ({ assertCurrentAuthoritySync }) => {
        durableAuth = null;
        assertCurrentAuthoritySync();
        throw new Error('unreachable');
      },
    });

    try {
      expect(await service.list('documents', {}, {
        authContext,
        revalidateAuthContext: async () => authContext,
        resolveAuthContextAtCommit: () => durableAuth,
      })).toEqual({
        ok: false,
        status: 403,
        body: {
          error: 'Resource authorization changed during the request',
          code: 'resource-authority-changed',
        },
      });
    } finally {
      db.dispose();
    }
  });
});

function createPhysicalRegistry(exposure: 'http' | 'sync' = 'http') {
  return createResourceRegistry({
    resources: [defineResource({
      table: 'documents',
      exposure,
      realm: tenantRealm(),
      policy: authenticatedOnly(),
    })],
    tables,
    authConfig: { userProperties: {} },
    tenancyMode: 'multi',
    tenantIsolation: 'tenant-database',
    managedTables: ['documents'],
  });
}

function tenantAuth(tenantId: string): AuthContext {
  return {
    userId: 'user-1',
    email: 'user@example.test',
    role: 'user',
    sessionKind: 'web',
    sessionId: `session-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership-${tenantId}`,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

function apiKeyTenantAuth(
  tenantId: string,
  credentialId: string,
  authGeneration: number,
): AuthContext {
  return {
    userId: 'api-key-user',
    email: 'api-key@example.test',
    role: 'user',
    credentialKind: 'api-key',
    credentialId,
    authGeneration,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership-${tenantId}`,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}
