import { describe, expect, test } from 'bun:test';

import { defineDatabaseRealm } from '../../databases/database-realm';
import type {
  RegisteredResourceDefinition,
  ResourceRegistry,
} from '../../resources/resource-registry';
import {
  assertTenantDatabaseRealmSchemaSubset,
  resolveTenantDatabaseResourceTopology,
} from './tenant-database-topology';

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
    expect(Object.isFrozen(topology)).toBe(true);
    expect(Object.isFrozen(topology.syncCatalog.documents)).toBe(true);
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

    expect(() => resolveTenantDatabaseResourceTopology(registry, realm))
      .toThrow('missing: documents; extra: global_plans');
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
