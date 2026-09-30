import { describe, expect, test } from 'bun:test';

import { defineDatabaseRealm } from '../../databases/database-realm';
import { DatabaseError } from '../../databases/database-error';
import type {
  RegisteredResourceDefinition,
  ResourceRegistry,
} from '../../resources/resource-registry';
import {
  assertTenantDatabaseRealmSchemaSubset,
  resolveTenantDatabaseResourceTopology,
} from './tenant-database-topology';
import {
  allOf,
  authenticatedOnly,
  tenantKindPolicy,
} from '../../resources/resource-policy';

describe('tenant database resource topology', () => {
  test('accepts only a schema-identical subset of application tables', () => {
    const appTables = {
      documents: {
        document_id: 'text primary key',
        title: 'text not null',
      },
      global_plans: {
        plan_id: 'text primary key',
        name: 'text not null',
      },
    };
    const subset = defineDatabaseRealm({
      name: 'tenant-schema-subset',
      version: '1',
      tables: { documents: appTables.documents },
    });
    expect(() => assertTenantDatabaseRealmSchemaSubset(subset, appTables))
      .not.toThrow();

    const drifted = defineDatabaseRealm({
      name: 'tenant-schema-drift',
      version: '1',
      tables: {
        documents: {
          document_id: 'text primary key',
          title: 'text',
        },
      },
    });
    expect(() => assertTenantDatabaseRealmSchemaSubset(drifted, appTables))
      .toThrow('table schemas must match');

    const unknown = defineDatabaseRealm({
      name: 'tenant-schema-unknown',
      version: '1',
      tables: { foreign_records: { id: 'text primary key' } },
    });
    expect(() => assertTenantDatabaseRealmSchemaSubset(unknown, appTables))
      .toThrow('foreign_records');
  });

  test('classifies tenant topology failures through the database contract', () => {
    const appTables = {
      documents: {
        document_id: 'text primary key',
        title: 'text not null',
      },
    };
    const drifted = defineDatabaseRealm({
      name: 'tenant-schema-error-contract',
      version: '1',
      tables: {
        documents: {
          document_id: 'text primary key',
          title: 'text',
        },
      },
    });
    expect(captureDatabaseError(() => {
      assertTenantDatabaseRealmSchemaSubset(drifted, appTables);
    })).toMatchObject({
      code: 'DATABASE_SCHEMA_MISMATCH',
      retryable: false,
      outcome: 'not-started',
      details: { component: 'tenant-database-topology' },
    });

    const unknown = defineDatabaseRealm({
      name: 'tenant-config-error-contract',
      version: '1',
      tables: { foreign_records: { id: 'text primary key' } },
    });
    expect(captureDatabaseError(() => {
      assertTenantDatabaseRealmSchemaSubset(unknown, appTables);
    })).toMatchObject({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
      details: { component: 'tenant-database-topology' },
    });
  });

  test('builds a Sync catalog only for physically isolated Sync resources', () => {
    const realm = defineDatabaseRealm({
      name: 'tenant-resource-topology',
      version: '1',
      tables: {
        documents: {
          document_id: 'text primary key',
          owner_id: 'text not null',
          title: 'text not null',
          _identity: ['owner_id', 'title'],
        },
        private_notes: {
          note_id: 'text primary key',
          body: 'text not null',
        },
      },
    });
    const registry = fakeRegistry([
      resource('documents', 'all', 'tenant-database', 'document_id'),
      resource('private_notes', 'http', 'tenant-database', 'note_id'),
      resource('plans', 'all', 'global', 'plan_id'),
    ]);

    const topology = resolveTenantDatabaseResourceTopology(registry, realm);

    expect(topology.tables).toEqual(['documents', 'private_notes']);
    expect(topology.syncTables).toEqual(['documents']);
    expect(topology.syncCatalog).toEqual({
      documents: {
        primaryKey: 'document_id',
        columns: ['document_id', 'owner_id', 'title'],
        identity: ['owner_id', 'title'],
      },
    });
    expect(topology.eligibleTenantKinds).toEqual([
      'organization',
      'administration',
    ]);
    expect(Object.isFrozen(topology)).toBe(true);
    expect(Object.isFrozen(topology.syncCatalog.documents)).toBe(true);
  });

  test('derives a conservative tenant-kind admission boundary from resource policies', () => {
    const realm = defineDatabaseRealm({
      name: 'tenant-kind-topology',
      version: '1',
      tables: {
        organization_documents: { id: 'text primary key' },
      },
    });
    const organizationOnly = {
      ...resource(
        'organization_documents',
        'all',
        'tenant-database',
        'id',
      ),
      policy: Object.fromEntries(
        ['list', 'get', 'create', 'update', 'delete'].map((action) => [
          action,
          allOf(authenticatedOnly(), tenantKindPolicy('organization')),
        ]),
      ),
    } as unknown as RegisteredResourceDefinition;

    expect(resolveTenantDatabaseResourceTopology(
      fakeRegistry([organizationOnly]),
      realm,
    ).eligibleTenantKinds).toEqual(['organization']);
  });

  test('rejects missing tenant tables and global tables duplicated in the realm', () => {
    const realm = defineDatabaseRealm({
      name: 'tenant-resource-mismatch',
      version: '1',
      tables: {
        global_plans: { plan_id: 'text primary key' },
      },
    });
    const registry = fakeRegistry([
      resource('documents', 'all', 'tenant-database', 'document_id'),
      resource('global_plans', 'all', 'global', 'plan_id'),
    ]);

    const error = captureDatabaseError(() => {
      resolveTenantDatabaseResourceTopology(registry, realm);
    });
    expect(error.message).toContain('missing: documents; extra: global_plans');
    expect(error).toMatchObject({
      code: 'DATABASE_SCHEMA_MISMATCH',
      retryable: false,
      outcome: 'not-started',
      details: { component: 'tenant-database-topology' },
    });
  });
});

function fakeRegistry(
  resources: readonly RegisteredResourceDefinition[],
): Pick<ResourceRegistry, 'list'> {
  return { list: () => [...resources] };
}

function resource(
  table: string,
  exposure: 'internal' | 'http' | 'sync' | 'all',
  storage: 'tenant-database' | 'global',
  primaryKey: string,
): RegisteredResourceDefinition {
  return {
    kind: 'resource',
    name: table,
    table,
    primaryKey,
    realm: storage === 'global'
      ? { kind: 'global' }
      : { kind: 'tenant', field: 'tenant_id' },
    storage: storage === 'global'
      ? { kind: 'global' }
      : { kind: 'tenant', isolation: 'tenant-database' },
    exposure: {
      kind: exposure,
      http: exposure === 'http' || exposure === 'all',
      sync: exposure === 'sync' || exposure === 'all',
    },
    actions: ['list', 'get', 'create', 'update', 'delete'],
    fields: null,
    policy: {},
  } as unknown as RegisteredResourceDefinition;
}

function captureDatabaseError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}
