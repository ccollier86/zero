import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { AuthContext } from '../auth/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineResource, tenantRealm } from './resource-definition';
import { authenticatedOnly, customPolicy } from './resource-policy-helpers';
import { ResourceRegistry } from './resource-registry';
import { ResourceCrudService } from './resource-crud-service';
import { ResourceSyncPolicyService } from './resource-sync-policy';

const tables = {
  documents: {
    id: 'text primary key',
    tenant_id: 'text collate nocase not null',
    title: 'text not null',
  },
};

let db: ReactiveDB;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  db.defineTable('documents', tables.documents);
});

afterEach(() => db.dispose());

describe('tenant resource CRUD boundary', () => {
  test('scopes list/get/create/update/delete independently of discretionary policy', async () => {
    const service = createService(authenticatedOnly());
    const tenantA = tenantAuth('tenant-a');
    const tenantB = tenantAuth('tenant-b');

    db.insert('documents', { id: 'a-1', tenant_id: 'tenant-a', title: 'A' });
    db.insert('documents', { id: 'shared-guess', tenant_id: 'tenant-b', title: 'B' });
    db.insert('documents', {
      id: 'case-variant', tenant_id: 'TENANT-A', title: 'Must remain isolated',
    });

    const listA = await service.list('documents', {}, { authContext: tenantA });
    expect(listA.status).toBe(200);
    expect(successRows(listA).map((row) => row.id)).toEqual(['a-1']);

    const hiddenGet = await service.get('documents', 'shared-guess', {
      authContext: tenantA,
    });
    expect(hiddenGet).toMatchObject({
      ok: false,
      status: 404,
      body: { code: 'not-found' },
    });

    // The table deliberately declares NOCASE. Managed scope checks still use
    // storage-class/BINARY equality for list and point operations.
    expect(await service.get('documents', 'case-variant', {
      authContext: tenantA,
    })).toMatchObject({ ok: false, status: 404, body: { code: 'not-found' } });
    expect(await service.update('documents', 'case-variant', {
      title: 'Must not update',
    }, { authContext: tenantA })).toMatchObject({ ok: false, status: 404 });
    expect(await service.delete('documents', 'case-variant', {
      authContext: tenantA,
    })).toMatchObject({ ok: false, status: 404 });
    expect(db.get('documents', 'case-variant')).toEqual({
      id: 'case-variant',
      tenant_id: 'TENANT-A',
      title: 'Must remain isolated',
    });

    const created = await service.create('documents', {
      id: 'a-2',
      title: 'Stamped',
    }, { authContext: tenantA });
    expect(created).toMatchObject({
      ok: true,
      status: 201,
      body: { row: { id: 'a-2', tenant_id: 'tenant-a', title: 'Stamped' } },
    });

    const conflictingCreate = await service.create('documents', {
      id: 'bad-scope',
      tenant_id: 'tenant-b',
      title: 'Rejected',
    }, { authContext: tenantA });
    expect(conflictingCreate).toMatchObject({
      ok: false,
      status: 400,
      body: { code: 'resource-tenant-conflict' },
    });

    // Tenant A cannot turn a guessed tenant-B primary key into a replace.
    const collision = await service.create('documents', {
      id: 'shared-guess',
      title: 'Overwrite attempt',
    }, { authContext: tenantA });
    expect(collision).toMatchObject({
      ok: false,
      status: 409,
      body: { code: 'resource-conflict' },
    });
    expect(db.get('documents', 'shared-guess')).toEqual({
      id: 'shared-guess',
      tenant_id: 'tenant-b',
      title: 'B',
    });

    expect(await service.update('documents', 'shared-guess', {
      title: 'Hidden update',
    }, { authContext: tenantA })).toMatchObject({ ok: false, status: 404 });
    expect(await service.delete('documents', 'shared-guess', {
      authContext: tenantA,
    })).toMatchObject({ ok: false, status: 404 });

    expect(await service.update('documents', 'a-2', {
      tenant_id: 'tenant-a',
      title: 'Even equal scope is server-managed',
    }, { authContext: tenantA })).toMatchObject({
      ok: false,
      status: 400,
      body: { code: 'resource-tenant-immutable' },
    });

    expect(await service.update('documents', 'a-2', {
      title: 'Updated A',
    }, { authContext: tenantA })).toMatchObject({
      ok: true,
      body: { row: { tenant_id: 'tenant-a', title: 'Updated A' } },
    });
    expect(await service.delete('documents', 'a-2', {
      authContext: tenantA,
    })).toMatchObject({ ok: true, status: 200 });
    expect(db.get('documents', 'a-2')).toBeNull();

    const listB = await service.list('documents', {}, { authContext: tenantB });
    expect(successRows(listB).map((row) => row.id)).toEqual(['shared-guess']);
  });

  test('requires a complete durable tenant session instead of a caller tenant hint', async () => {
    const service = createService(authenticatedOnly());
    const identityOnly = {
      userId: 'shared-user',
      email: 'shared@example.test',
      role: 'admin',
      tenantId: 'tenant-a',
    } satisfies AuthContext;

    expect(await service.list('documents', {}, {
      authContext: identityOnly,
    })).toMatchObject({
      ok: false,
      status: 403,
      body: { code: 'resource-tenant-context-required' },
    });
  });

  test('accepts a live native tenant family without requiring a browser generation', async () => {
    const service = createService(authenticatedOnly());
    const native = nativeTenantAuth('tenant-native');
    db.insert('documents', {
      id: 'native-document',
      tenant_id: 'tenant-native',
      title: 'Native',
    });

    expect(await service.list('documents', {}, { authContext: native })).toMatchObject({
      ok: true,
      body: { rows: [{ id: 'native-document', tenant_id: 'tenant-native' }] },
    });
    expect(await service.create('documents', {
      id: 'native-created',
      title: 'Created by native',
    }, { authContext: native })).toMatchObject({
      ok: true,
      status: 201,
      body: { row: { id: 'native-created', tenant_id: 'tenant-native' } },
    });
    expect(await service.get('documents', 'native-created', {
      authContext: native,
    })).toMatchObject({
      ok: true,
      body: { row: { id: 'native-created', tenant_id: 'tenant-native' } },
    });
    expect(await service.update('documents', 'native-created', {
      title: 'Updated by native',
    }, { authContext: native })).toMatchObject({
      ok: true,
      body: { row: { title: 'Updated by native', tenant_id: 'tenant-native' } },
    });
    expect(await service.delete('documents', 'native-created', {
      authContext: native,
    })).toMatchObject({ ok: true, status: 200 });
    expect(db.get('documents', 'native-created')).toBeNull();
    expect(await service.list('documents', {}, {
      authContext: { ...native, clientId: undefined },
    })).toMatchObject({
      ok: false,
      status: 403,
      body: { code: 'resource-tenant-context-required' },
    });
    expect(await service.list('documents', {}, {
      authContext: { ...native, sessionGeneration: 0 },
    })).toMatchObject({
      ok: false,
      status: 403,
      body: { code: 'resource-tenant-context-required' },
    });
    expect(await service.list('documents', {}, {
      authContext: {
        ...native,
        sessionKind: undefined,
        sessionGeneration: 0,
      },
    })).toMatchObject({
      ok: false,
      status: 403,
      body: { code: 'resource-tenant-context-required' },
    });
    expect(await service.list('documents', {}, {
      authContext: {
        ...tenantAuth('tenant-native'),
        sessionKind: 'unknown' as never,
      },
    })).toMatchObject({
      ok: false,
      status: 403,
      body: { code: 'resource-tenant-context-required' },
    });
  });

  test('shares native tenant realm proof with the Sync policy adapter', async () => {
    const registry = createRegistry(authenticatedOnly());
    const service = new ResourceSyncPolicyService({
      registry,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: new Set(['documents']),
    });
    const native = nativeTenantAuth('tenant-native');

    const access = await service.resolveTableAccess({
      tableNames: ['documents'],
      authContext: native,
    });
    expect(access.readableTables.has('documents')).toBeTrue();
    expect(access.rowFilters.get('documents')?.matches({
      id: 'own', tenant_id: 'tenant-native', title: 'Own',
    })).toBeTrue();
    expect(access.rowFilters.get('documents')?.matches({
      id: 'other', tenant_id: 'tenant-other', title: 'Other',
    })).toBeFalse();

    const created = await service.authorizeMutation({
      table: 'documents',
      op: 'INSERT',
      row: { id: 'native-create', title: 'Native create' },
      authContext: native,
      loadRow: () => null,
    });
    expect(created).toMatchObject({
      ok: true,
      row: { id: 'native-create', tenant_id: 'tenant-native' },
      scope: { field: 'tenant_id', value: 'tenant-native' },
    });

    const invalid = await service.resolveTableAccess({
      tableNames: ['documents'],
      authContext: { ...native, clientId: undefined },
    });
    expect(invalid.readableTables.has('documents')).toBeFalse();
  });

  test('keeps the tenant predicate in the final update statement after async policy work', async () => {
    db.insert('documents', { id: 'race', tenant_id: 'tenant-a', title: 'Original' });
    const racingPolicy = customPolicy(async ({ action }) => {
      if (action === 'update') {
        await Promise.resolve();
        db.prepare('UPDATE documents SET tenant_id = ? WHERE id = ?')
          .run('tenant-b', 'race');
      }
      return true;
    }, { name: 'test-realm-race' });
    const service = createService(racingPolicy);

    const result = await service.update('documents', 'race', {
      title: 'Must not cross boundary',
    }, { authContext: tenantAuth('tenant-a') });
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(db.get('documents', 'race')).toEqual({
      id: 'race',
      tenant_id: 'tenant-b',
      title: 'Original',
    });
  });

  test('rejects a same-tenant row change after row policy evaluation', async () => {
    db.insert('documents', { id: 'same-tenant-race', tenant_id: 'tenant-a', title: 'Original' });
    const racingPolicy = customPolicy(async ({ action }) => {
      if (action === 'update') {
        await Promise.resolve();
        db.prepare('UPDATE documents SET title = ? WHERE id = ?')
          .run('Changed while policy yielded', 'same-tenant-race');
      }
      return true;
    }, { name: 'test-row-snapshot-race' });
    const service = createService(racingPolicy);

    const result = await service.update('documents', 'same-tenant-race', {
      title: 'Must not overwrite newer state',
    }, { authContext: tenantAuth('tenant-a') });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: { code: 'resource-row-changed' },
    });
    expect(db.get('documents', 'same-tenant-race')?.title)
      .toBe('Changed while policy yielded');
  });

  test('rechecks durable authority inside the SQLite write transaction', async () => {
    db.insert('documents', { id: 'authority-race', tenant_id: 'tenant-a', title: 'Original' });
    const service = createService(customPolicy(async () => {
      await Promise.resolve();
      return true;
    }, { name: 'test-commit-authority-race' }));
    const authContext = tenantAuth('tenant-a');
    let commitChecks = 0;

    const result = await service.update('documents', 'authority-race', {
      title: 'Must not commit',
    }, {
      authContext,
      revalidateAuthContext: async () => authContext,
      resolveAuthContextAtCommit: () => {
        commitChecks += 1;
        return null;
      },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      body: { code: 'resource-authority-changed' },
    });
    expect(commitChecks).toBe(1);
    expect(db.get('documents', 'authority-race')?.title).toBe('Original');
  });

  test('rolls back scoped writes when a database trigger tries to escape the realm', async () => {
    const service = createService(authenticatedOnly());
    const tenantA = tenantAuth('tenant-a');
    db.exec(`
      CREATE TRIGGER documents_escape_insert
      AFTER INSERT ON documents
      WHEN NEW.id = 'escape-create'
      BEGIN
        UPDATE documents SET tenant_id = 'tenant-b' WHERE id = NEW.id;
      END
    `);

    const created = await service.create('documents', {
      id: 'escape-create',
      title: 'Must roll back',
    }, { authContext: tenantA });
    expect(created).toMatchObject({
      ok: false,
      status: 500,
      body: {
        code: 'resource-mutation-failed',
        error: 'Resource mutation failed',
      },
    });
    expect(db.get('documents', 'escape-create')).toBeNull();

    db.insert('documents', {
      id: 'escape-update', tenant_id: 'tenant-a', title: 'Original',
    });
    db.exec(`
      CREATE TRIGGER documents_escape_update
      AFTER UPDATE OF title ON documents
      WHEN NEW.id = 'escape-update'
      BEGIN
        UPDATE documents SET tenant_id = 'tenant-b' WHERE id = NEW.id;
      END
    `);
    const updated = await service.update('documents', 'escape-update', {
      title: 'Must roll back',
    }, { authContext: tenantA });
    expect(updated).toMatchObject({
      ok: false,
      status: 500,
      body: {
        code: 'resource-mutation-failed',
        error: 'Resource mutation failed',
      },
    });
    expect(db.get('documents', 'escape-update')).toEqual({
      id: 'escape-update', tenant_id: 'tenant-a', title: 'Original',
    });

    db.insert('documents', {
      id: 'escape-delete', tenant_id: 'tenant-a', title: 'Original',
    });
    db.exec(`
      CREATE TRIGGER documents_escape_delete
      AFTER DELETE ON documents
      WHEN OLD.id = 'escape-delete'
      BEGIN
        INSERT INTO documents (id, tenant_id, title)
        VALUES (OLD.id, 'tenant-b', OLD.title);
      END
    `);
    const deleted = await service.delete('documents', 'escape-delete', {
      authContext: tenantA,
    });
    expect(deleted).toMatchObject({
      ok: false,
      status: 500,
      body: {
        code: 'resource-mutation-failed',
        error: 'Resource mutation failed',
      },
    });
    expect(db.get('documents', 'escape-delete')).toEqual({
      id: 'escape-delete', tenant_id: 'tenant-a', title: 'Original',
    });
  });
});

function createService(policy: ReturnType<typeof authenticatedOnly>) {
  const registry = createRegistry(policy);
  return new ResourceCrudService({
    db,
    registry,
    tables,
    authConfig: { userProperties: {} },
  });
}

function createRegistry(policy: ReturnType<typeof authenticatedOnly>) {
  const registry = new ResourceRegistry();
  registry.register(defineResource({
    table: 'documents',
    exposure: 'all',
    realm: tenantRealm(),
    policy,
  }), {
    tables,
    authConfig: { userProperties: {} },
    tenancyMode: 'multi',
    managedTables: ['documents'],
  });
  return registry;
}

function tenantAuth(tenantId: string): AuthContext {
  return {
    userId: 'shared-user',
    email: 'shared@example.test',
    role: 'admin',
    sessionKind: 'web',
    sessionId: `session-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership-${tenantId}`,
    tenantRole: 'owner',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

function nativeTenantAuth(tenantId: string): AuthContext {
  return {
    userId: 'native-user',
    email: 'native@example.test',
    role: 'user',
    clientId: 'com.example.native',
    sessionKind: 'native',
    sessionId: `native-family-${tenantId}`,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `native-membership-${tenantId}`,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

function successRows(result: Awaited<ReturnType<ResourceCrudService['list']>>): Array<Record<string, unknown>> {
  if (!result.ok) throw new Error(`Expected success, received ${result.status}`);
  return (result.body as { rows: Array<Record<string, unknown>> }).rows;
}
