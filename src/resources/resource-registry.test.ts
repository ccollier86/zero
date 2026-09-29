/**
 * resource-registry.test.ts
 *
 * Verifies resource definition normalization and registration-time validation.
 * These tests do not generate routes or touch SQLite; CRUD/data/sync behavior
 * is covered by later resource integration slices.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import {
  defineResource,
  globalRealm,
  isResourceDefinition,
  tenantRealm,
} from './resource-definition';
import { defineTable } from '../schema/define-schema';
import { field } from '../schema/field-types';
import { createReactiveDB } from '../sync/reactive-db';
import {
  ResourceRegistry,
  ResourceRegistryError,
  assertResourceStorageRealms,
  clearResourceRegistry,
  configureResourceRegistry,
  createResourceRegistry,
  getResourceRegistry,
  validateResourceDefinitions,
  validateResourceStorageRealms,
} from './resource-registry';
import {
  adminOnly,
  anyOf,
  authenticatedOnly,
  metadataPolicy,
  ownerPolicy,
  readOnly,
} from './resource-policy-helpers';
import { getPolicyMetadataKeys, getPolicyOwnerFields } from './resource-policy-inspection';

const tables = {
  tickets: {
    ticket_id: 'text primary key',
    title: 'text not null',
    created_by: 'text not null',
  },
  projects: {
    id: 'text primary key',
    name: 'text not null',
  },
};

const authConfig = resolveAuthBehaviorConfig({
  userProperties: {
    department: {
      type: 'enum',
      values: ['support', 'management'],
      editableBy: 'admin',
      useInPolicies: true,
    },
    theme: {
      type: 'enum',
      values: ['light', 'dark'],
      editableBy: 'user',
    },
  },
});

afterEach(() => clearResourceRegistry());

describe('resource definitions and registry', () => {
  test('accepts a typed table without adding server policy to its client-safe shape', () => {
    const patients = defineTable('patients', {
      tenant_id: field.text({ required: true }),
      name: field.text({ required: true }),
    }, { sync: 'lazy' });
    const policy = authenticatedOnly();
    const resource = defineResource({
      table: patients,
      exposure: 'all',
      realm: tenantRealm(),
      policy,
    });

    expect(resource.table).toBe('patients');
    expect(resource.primaryKey).toBe('id');
    expect(resource.realm).toEqual({ kind: 'tenant', field: 'tenant_id' });
    expect(Object.isFrozen(resource)).toBe(true);
    expect(Object.isFrozen(resource.realm)).toBe(true);
    expect('realm' in patients).toBe(false);
    expect('policy' in patients).toBe(false);
    expect('exposure' in patients).toBe(false);
    expect('realm' in patients.clientTable).toBe(false);
    expect('policy' in patients.clientTable).toBe(false);
    expect('exposure' in patients.clientTable).toBe(false);
    expect(JSON.stringify(patients.clientTable)).not.toContain('"realm"');
    expect(JSON.stringify(patients.clientTable)).not.toContain('"policy"');
    expect(JSON.stringify(patients.serverTable)).not.toContain('policy');
    expect(JSON.stringify(patients.serverTable)).not.toContain('realm');
    expect(JSON.stringify(patients.serverTable)).not.toContain('exposure');

    const registry = new ResourceRegistry();
    registry.register(resource, {
      tables: { patients: patients.serverTable },
      authConfig,
      tenancyMode: 'multi',
      managedTables: ['patients'],
    });
    expect(registry.getByTable('patients')?.realm).toEqual({
      kind: 'tenant',
      field: 'tenant_id',
    });
    expect(registry.getByTable('patients')?.storage).toEqual({
      kind: 'tenant',
      isolation: 'shared-row',
      field: 'tenant_id',
    });
  });

  test('normalizes tenant-database resources without requiring a row discriminator', () => {
    const physicalTables = {
      documents: {
        id: 'text primary key',
        title: 'text not null',
      },
    };
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'documents',
        exposure: 'http',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables: physicalTables,
      authConfig,
      tenancyMode: 'multi',
      tenantIsolation: 'tenant-database',
      managedTables: ['documents'],
    });

    const resource = registry.getByTable('documents');
    expect(resource?.realm).toEqual({ kind: 'tenant', field: 'tenant_id' });
    expect(resource?.storage).toEqual({
      kind: 'tenant',
      isolation: 'tenant-database',
    });
    expect(Object.isFrozen(resource?.storage)).toBe(true);
    expect(registry.getTenantIsolation()).toBe('tenant-database');

    const db = createReactiveDB({ mode: 'memory' });
    try {
      // Physical tenant tables do not exist in the shared default database.
      // Their actor realm is the authoritative schema boundary.
      expect(validateResourceStorageRealms(registry, db)).toEqual([]);
      expect(() => assertResourceStorageRealms(registry, db)).not.toThrow();
    } finally {
      db.dispose();
    }
  });

  test('accepts physical tenant resources exposed through actor-backed Sync', () => {
    for (const exposure of ['sync', 'all'] as const) {
      const issues = validateResourceDefinitions([defineResource({
        table: 'documents',
        exposure,
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })], {
        tables: {
          documents: {
            id: 'text primary key',
            title: 'text not null',
          },
        },
        authConfig,
        tenancyMode: 'multi',
        tenantIsolation: 'tenant-database',
        managedTables: ['documents'],
      });
      expect(issues).not.toContainEqual(expect.objectContaining({
        resource: 'documents',
        severity: 'error',
      }));
    }
  });

  test('fails closed for incompatible or mixed tenant isolation contexts', () => {
    const resource = defineResource({
      table: 'projects',
      exposure: 'all',
      realm: tenantRealm(),
      policy: authenticatedOnly(),
    });

    expect(() => createResourceRegistry({
      resources: [resource],
      tables,
      authConfig,
      tenancyMode: 'single',
      tenantIsolation: 'tenant-database',
    })).toThrow(ResourceRegistryError);

    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: 'projects',
      policy: readOnly(),
    }), { tables, authConfig });
    expect(() => registry.register(defineResource({
      table: 'tickets',
      exposure: 'all',
      realm: globalRealm(),
      policy: readOnly(),
    }), {
      tables,
      authConfig,
      tenancyMode: 'multi',
      tenantIsolation: 'tenant-database',
    })).toThrow(ResourceRegistryError);
  });

  test('rejects fake NOT NULL text and verifies the actual SQLite discriminator', () => {
    const nullableDefinitions = [
      "text default 'not null'",
      'text /* NOT NULL */',
      'text check (tenant_id is not null)',
      'text not1 null',
      'text "not" null',
      'text-- hidden through bare CR\rnot null\n',
      'text not\u00a0null',
      'text, injected text not null',
    ];
    for (const definition of nullableDefinitions) {
      const issues = validateResourceDefinitions([defineResource({
        table: 'documents',
        exposure: 'all',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })], {
        tables: {
          documents: {
            id: 'text primary key',
            tenant_id: definition,
          },
        },
        authConfig,
        tenancyMode: 'multi',
      });
      expect(issues.map((entry) => entry.code)).toContain(
        'resource-tenant-field-nullable',
      );
    }

    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'documents',
        exposure: 'all',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables: {
        documents: {
          id: 'text primary key',
          tenant_id: 'text not null',
        },
      },
      authConfig,
      tenancyMode: 'multi',
    });
    const db = createReactiveDB({ mode: 'memory' });
    try {
      // Simulate an old durable schema. defineTable() cannot repair it because
      // SQLite preserves an existing table for CREATE TABLE IF NOT EXISTS.
      db.exec('CREATE TABLE documents (id text primary key, tenant_id text)');
      db.defineTable('documents', {
        id: 'text primary key',
        tenant_id: 'text not null',
      });

      expect(validateResourceStorageRealms(registry, db).map((entry) => entry.code))
        .toContain('resource-tenant-storage-field-nullable');
      expect(() => assertResourceStorageRealms(registry, db)).toThrow(
        'Apply the required schema migration',
      );
    } finally {
      db.dispose();
    }
  });

  test('rejects fake declared primary-key text and mismatched durable SQLite keys', () => {
    const fakePrimaryKeys = [
      "text default 'primary key'",
      'text /* PRIMARY KEY */',
      'text check (value != "primary key")',
      'text primary1 key',
      'text unique, primary key (id, tenant_id)',
      'text unique-- hidden through bare CR\rprimary key\n',
      'text\u00a0primary key unique',
      'text prımary key unique',
    ];
    for (const definition of fakePrimaryKeys) {
      const issues = validateResourceDefinitions([defineResource({
        table: 'documents',
        exposure: 'all',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })], {
        tables: {
          documents: {
            id: definition,
            tenant_id: 'text not null',
          },
        },
        authConfig,
        tenancyMode: 'multi',
      });
      expect(issues.map((entry) => entry.code)).toContain(
        'resource-primary-key-missing',
      );
    }

    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'documents',
        exposure: 'all',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables: {
        documents: {
          id: 'text primary key',
          tenant_id: 'text not null',
        },
      },
      authConfig,
      tenancyMode: 'multi',
    });
    const db = createReactiveDB({ mode: 'memory' });
    try {
      // Inspect an old durable schema directly. ReactiveDB.defineTable()
      // itself now rejects this mismatch while preparing its PK-targeted
      // upsert, but startup storage validation must still report the precise
      // resource migration issue before transports serve it.
      db.exec('CREATE TABLE documents (id text not null, tenant_id text not null)');

      expect(validateResourceStorageRealms(registry, db)).toContainEqual(
        expect.objectContaining({
          code: 'resource-storage-primary-key-mismatch',
          metadata: {
            expected: 'id',
            actual: [],
          },
        }),
      );
      expect(() => assertResourceStorageRealms(registry, db)).toThrow(
        'Actual SQLite resource validation failed',
      );
    } finally {
      db.dispose();
    }
  });

  test('requires actual tenant-leading indexes and tenant-scoped business uniqueness', () => {
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'documents',
        exposure: 'all',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables: {
        documents: {
          id: 'text primary key',
          tenant_id: 'text not null',
          slug: 'text not null unique',
        },
      },
      authConfig,
      tenancyMode: 'multi',
    });
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.exec(`
        CREATE TABLE documents (
          id text primary key,
          tenant_id text not null,
          slug text not null unique
        );
        CREATE INDEX idx_documents_tenant_partial
          ON documents (tenant_id) WHERE slug <> '';
      `);

      const unsafeCodes = validateResourceStorageRealms(registry, db)
        .map((entry) => entry.code);
      expect(unsafeCodes).toContain('resource-tenant-storage-index-missing');
      expect(unsafeCodes).toContain('resource-tenant-storage-unique-unscoped');

      db.exec(`
        DROP TABLE documents;
        CREATE TABLE documents (
          id text primary key,
          tenant_id text collate nocase not null,
          slug text not null,
          UNIQUE (tenant_id, slug)
        );
        CREATE INDEX idx_documents_tenant ON documents (tenant_id);
      `);
      // A declared collation is safe because managed realm predicates enforce
      // storage-class plus BINARY equality instead of inheriting it.
      expect(validateResourceStorageRealms(registry, db)).toEqual([]);
    } finally {
      db.dispose();
    }
  });

  test('requires tenant-consistent composite foreign keys between tenant resources', () => {
    const registry = createResourceRegistry({
      resources: [
        defineResource({
          table: 'projects',
          exposure: 'all',
          realm: tenantRealm(),
          policy: authenticatedOnly(),
        }),
        defineResource({
          table: 'documents',
          exposure: 'all',
          realm: tenantRealm(),
          policy: authenticatedOnly(),
        }),
      ],
      tables: {
        projects: {
          id: 'text primary key',
          tenant_id: 'text not null',
        },
        documents: {
          id: 'text primary key',
          tenant_id: 'text not null',
          project_id: 'text not null',
        },
      },
      authConfig,
      tenancyMode: 'multi',
    });
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.exec(`
        CREATE TABLE projects (
          id text primary key,
          tenant_id text not null,
          UNIQUE (tenant_id, id)
        );
        CREATE INDEX idx_projects_tenant ON projects (tenant_id);
        CREATE TABLE documents (
          id text primary key,
          tenant_id text not null,
          project_id text not null,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        );
        CREATE INDEX idx_documents_tenant ON documents (tenant_id);
      `);

      expect(validateResourceStorageRealms(registry, db)).toContainEqual(
        expect.objectContaining({
          code: 'resource-tenant-storage-foreign-key-unscoped',
          resource: 'documents',
        }),
      );

      db.exec(`
        DROP TABLE documents;
        CREATE TABLE documents (
          id text primary key,
          tenant_id text not null,
          project_id text not null,
          FOREIGN KEY (tenant_id, project_id)
            REFERENCES projects(tenant_id, id)
        );
        CREATE INDEX idx_documents_tenant ON documents (tenant_id);
      `);

      expect(validateResourceStorageRealms(registry, db)).toEqual([]);
    } finally {
      db.dispose();
    }
  });

  test('seals factory registries after complete startup validation', () => {
    const registry = createResourceRegistry({
      resources: [defineResource({
        table: 'projects',
        exposure: 'all',
        realm: globalRealm(),
        policy: readOnly(),
      })],
      tables,
      authConfig,
      tenancyMode: 'multi',
      managedTables: ['projects'],
    });

    expect(registry.isSealed()).toBe(true);
    expect(() => registry.register(defineResource({
      table: 'tickets',
      realm: globalRealm(),
      policy: readOnly(),
    }), { tables, authConfig })).toThrow('sealed after startup validation');
  });

  test('snapshots and freezes policy inputs used by the sealed registry', () => {
    const ownerOptions = { userField: 'created_by' };
    const metadataRequirements = {
      department: { in: ['support'] },
    };
    const owner = ownerPolicy(ownerOptions);
    const metadata = metadataPolicy(metadataRequirements);
    const resource = defineResource({
      table: 'tickets',
      actions: ['list'],
      policy: { list: anyOf(owner, metadata) },
    });

    ownerOptions.userField = 'title';
    metadataRequirements.department.in[0] = 'management';

    expect(getPolicyOwnerFields(resource.policy.list!)).toEqual(['created_by']);
    expect(getPolicyMetadataKeys(resource.policy.list!)).toEqual(['department']);
    expect(Object.isFrozen(resource.policy.list)).toBe(true);
    expect(Object.isFrozen(resource.policy.list?.diagnostics)).toBe(true);
    expect(Object.isFrozen(resource.policy.list?.diagnostics?.children)).toBe(true);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  test('fails multi-mode registration for missing or unsafe managed-table realms', () => {
    const multiTables = {
      tenant_docs: {
        id: 'text primary key',
        tenant_id: 'text not null',
        title: 'text not null',
      },
      nullable_docs: {
        id: 'text primary key',
        tenant_id: 'text',
      },
      shared_catalog: {
        id: 'text primary key',
        label: 'text not null',
      },
    };
    const resources = [
      defineResource({
        table: 'tenant_docs',
        exposure: 'all',
        policy: authenticatedOnly(),
      }),
      defineResource({
        table: 'nullable_docs',
        exposure: 'all',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      }),
    ];

    const issues = validateResourceDefinitions(resources, {
      tables: multiTables,
      authConfig,
      tenancyMode: 'multi',
      managedTables: Object.keys(multiTables),
    });
    expect(issues.map((entry) => entry.code)).toContain('resource-realm-missing');
    expect(issues.map((entry) => entry.code)).toContain('resource-tenant-field-nullable');
    expect(issues.map((entry) => entry.code)).toContain('resource-managed-table-unclassified');

    expect(() => new ResourceRegistry().register([
      defineResource({
        table: 'tenant_docs',
        exposure: 'all',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      }),
      defineResource({
        table: 'nullable_docs',
        exposure: 'all',
        realm: globalRealm(),
        policy: authenticatedOnly(),
      }),
      defineResource({
        table: 'shared_catalog',
        exposure: 'all',
        realm: globalRealm(),
        policy: authenticatedOnly(),
      }),
    ], {
      tables: multiTables,
      authConfig,
      tenancyMode: 'multi',
      managedTables: Object.keys(multiTables),
    })).not.toThrow();
  });

  test('factory preserves multi-mode managed-table validation inputs', () => {
    expect(() => createResourceRegistry({
      resources: [],
      tables: {
        documents: {
          id: 'text primary key',
          tenant_id: 'text not null',
        },
      },
      authConfig,
      tenancyMode: 'multi',
      managedTables: ['documents'],
    })).toThrow(ResourceRegistryError);

    expect(() => createResourceRegistry({
      resources: [defineResource({
        table: 'documents',
        exposure: 'all',
        realm: tenantRealm(),
        policy: authenticatedOnly(),
      })],
      tables: {
        documents: {
          id: 'text primary key',
          tenant_id: 'text not null',
        },
      },
      authConfig,
      tenancyMode: 'multi',
      managedTables: ['documents'],
    })).not.toThrow();
  });

  test('defineResource normalizes names, actions, and all-action policies', () => {
    const policy = readOnly();
    const resource = defineResource({
      table: 'tickets',
      actions: ['list', 'get'],
      policy,
    });

    expect(isResourceDefinition(resource)).toBe(true);
    expect(resource.name).toBe('tickets');
    expect(resource.actions).toEqual(['list', 'get']);
    expect(resource.policy.list).toBe(policy);
    expect(resource.policy.get).toBe(policy);
    expect(resource.policy.create).toBeUndefined();
  });

  test('normalizes immutable internal/http/sync/all exposure with a single-mode legacy default', () => {
    const expected = {
      internal: { kind: 'internal', http: false, sync: false },
      http: { kind: 'http', http: true, sync: false },
      sync: { kind: 'sync', http: false, sync: true },
      all: { kind: 'all', http: true, sync: true },
    } as const;

    for (const exposure of ['internal', 'http', 'sync', 'all'] as const) {
      const registry = createResourceRegistry({
        resources: [defineResource({
          table: 'projects',
          exposure,
          policy: readOnly(),
        })],
        tables,
        authConfig,
      });
      const normalized = registry.getByTable('projects')!.exposure;
      expect(normalized).toEqual(expected[exposure]);
      expect(Object.isFrozen(normalized)).toBe(true);
    }

    const legacy = createResourceRegistry({
      resources: [defineResource({ table: 'projects', policy: readOnly() })],
      tables,
      authConfig,
    }).getByTable('projects')!;
    expect(legacy.exposure).toEqual(expected.all);
    expect(Object.isFrozen(legacy.exposure)).toBe(true);
  });

  test('requires explicit exposure in multi mode', () => {
    const issues = validateResourceDefinitions([defineResource({
      table: 'projects',
      realm: globalRealm(),
      policy: readOnly(),
    })], {
      tables,
      authConfig,
      tenancyMode: 'multi',
      managedTables: ['projects'],
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'resource-exposure-missing',
      resource: 'projects',
    }));
  });

  test('rejects invalid runtime exposure values through the public registry path', () => {
    const forged = {
      ...defineResource({
        table: 'projects',
        realm: globalRealm(),
        policy: readOnly(),
      }),
      exposure: 'weird',
    } as unknown as ReturnType<typeof defineResource>;
    for (const tenancyMode of ['single', 'multi'] as const) {
      const options = {
        resources: [forged],
        tables,
        authConfig,
        tenancyMode,
        managedTables: ['projects'],
      };
      expect(validateResourceDefinitions(options.resources, options))
        .toContainEqual(expect.objectContaining({
          code: 'resource-exposure-invalid',
          resource: 'projects',
        }));
      expect(() => createResourceRegistry(options)).toThrow(ResourceRegistryError);
    }

    expect(() => defineResource({
      table: 'projects',
      exposure: 'weird' as 'all',
      policy: readOnly(),
    })).toThrow('Unknown resource exposure');
  });

  test('treats explicit empty actions as none and rejects unused policy-map keys', () => {
    const resource = defineResource({
      table: 'projects',
      exposure: 'internal',
      actions: [],
      policy: readOnly(),
    });
    expect(resource.actions).toEqual([]);
    expect(resource.policy).toEqual({});

    expect(() => defineResource({
      table: 'projects',
      actions: ['get'],
      policy: { list: readOnly() },
    })).toThrow('policy action "list" is not listed in actions');
  });

  test('registry resolves primary keys from table schema and exposes lookups', () => {
    const resource = defineResource({
      name: 'ticket',
      table: 'tickets',
      actions: ['list', 'get', 'create'],
      policy: {
        list: ownerPolicy({ userField: 'created_by' }),
        get: ownerPolicy({ userField: 'created_by' }),
        create: ownerPolicy({ userField: 'created_by' }),
      },
    });

    const registry = new ResourceRegistry();
    registry.register(resource, { tables, authConfig });

    expect(registry.list()).toHaveLength(1);
    expect(registry.get('ticket')?.primaryKey).toBe('ticket_id');
    expect(registry.getByTable('tickets')?.name).toBe('ticket');
    expect(registry.hasTable('tickets')).toBe(true);
  });

  test('configureResourceRegistry replaces the process registry', () => {
    const resource = defineResource({
      table: 'projects',
      actions: ['list', 'get'],
      policy: readOnly(),
    });

    const registry = configureResourceRegistry({
      resources: [resource],
      tables,
      authConfig,
    });

    expect(getResourceRegistry()).toBe(registry);
    expect(getResourceRegistry().getByTable('projects')?.primaryKey).toBe('id');
  });

  test('validation catches missing tables, mismatched primary keys, missing action policies, and metadata issues', () => {
    const invalid = [
      defineResource({
        table: 'missing',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        table: 'tickets',
        primaryKey: 'id',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        name: 'ticket-writes',
        table: 'tickets',
        actions: ['list', 'delete'],
        policy: {
          list: adminOnly(),
        },
      }),
      defineResource({
        name: 'theme-resource',
        table: 'projects',
        actions: ['list'],
        policy: metadataPolicy({ theme: 'dark' }),
      }),
      defineResource({
        name: 'project-owner',
        table: 'projects',
        actions: ['list'],
        policy: ownerPolicy({ userField: 'owner_id' }),
      }),
    ];

    const issues = validateResourceDefinitions(invalid, { tables, authConfig });
    expect(issues.map((issue) => issue.code)).toContain('resource-table-missing');
    expect(issues.map((issue) => issue.code)).toContain('resource-primary-key-mismatch');
    expect(issues.map((issue) => issue.code)).toContain('resource-policy-missing');
    expect(issues.map((issue) => issue.code)).toContain('metadata-property-untrusted');
    expect(issues.map((issue) => issue.code)).toContain('resource-owner-field-missing');
  });

  test('registry rejects duplicate resource names and tables', () => {
    const resources = [
      defineResource({
        name: 'ticket',
        table: 'tickets',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        name: 'ticket',
        table: 'projects',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        name: 'project-ticket',
        table: 'tickets',
        actions: ['list'],
        policy: readOnly(),
      }),
    ];

    expect(() =>
      new ResourceRegistry().register(resources, { tables, authConfig })
    ).toThrow(ResourceRegistryError);
  });
});
