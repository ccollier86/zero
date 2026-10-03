import { describe, expect, test } from 'bun:test';

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { DatabaseError } from '../databases/database-error';
import { defineDatabaseRealm } from '../databases/database-realm';
import { dataStudioActorFixtureRealm } from '../databases/test-fixtures/data-studio-actor-realm';
import {
  allOf,
  defineResource,
  globalRealm,
  ResourceRegistry,
  type RegisteredResourceDefinition,
  type ResourceDefinition,
  type ResourceDefinitionOptions,
} from '../resources';
import type { DeclaredSyncMode, TableSchema } from '../sync/types';
import {
  DATA_STUDIO_PERMISSION_REGISTRY,
  DATA_STUDIO_ROLE_FRAGMENTS,
} from './data-studio-access';
import {
  assertDataStudioInstallationPreflight,
  resolveDataStudioInstallation,
} from './data-studio-installation';
import { DATA_STUDIO_RESOURCES } from './data-studio-resources';
import { DATA_STUDIO_REALM_CONTRIBUTION } from './data-studio-realm-contribution';
import {
  DATA_STUDIO_CELLS_TABLE_NAME,
  DATA_STUDIO_COLUMN_STATS_TABLE_NAME,
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_TABLES_TABLE_NAME,
  DATA_STUDIO_TENANT_TABLES,
} from './data-studio-tenant-schema';

const AUTH_CONFIG = resolveAuthBehaviorConfig({
  tenancy: 'multi',
  authorization: {
    mode: 'advanced',
    permissions: DATA_STUDIO_PERMISSION_REGISTRY,
    roles: {
      'data-studio-manager': DATA_STUDIO_ROLE_FRAGMENTS.manager,
    },
  },
});

describe('Data Studio installation admission', () => {
  test('does not activate preflight without a Data Studio Resource declaration', () => {
    expect(assertDataStudioInstallationPreflight({
      resources: [],
      authEnabled: false,
      tenancyMode: 'single',
      authorizationMode: 'simple',
      databaseTopology: { mode: 'single' },
    })).toBe(false);
    expect(assertDataStudioInstallationPreflight({
      resources: [{ table: 'data_studio_tables_app_owned' }],
      authEnabled: false,
      tenancyMode: 'single',
      authorizationMode: 'simple',
      databaseTopology: { mode: 'single' },
    })).toBe(false);
  });

  test('admits the exact Guardian and Fabric profile when any feature Resource is declared', () => {
    expect(assertDataStudioInstallationPreflight({
      resources: [DATA_STUDIO_RESOURCES[0]!],
      authEnabled: true,
      tenancyMode: 'multi',
      authorizationMode: 'advanced',
      databaseTopology: {
        mode: 'multiple',
        tenantIsolation: 'tenant-database',
      },
    })).toBe(true);
  });

  test('fails with a safe Data Studio config error for every unsupported profile axis', () => {
    const supported = {
      resources: [DATA_STUDIO_RESOURCES[0]!],
      authEnabled: true,
      tenancyMode: 'multi' as const,
      authorizationMode: 'advanced' as const,
      databaseTopology: {
        mode: 'multiple' as const,
        tenantIsolation: 'tenant-database' as const,
      },
    };
    const unsupported = [
      { ...supported, authEnabled: false },
      { ...supported, tenancyMode: 'single' as const },
      { ...supported, authorizationMode: 'simple' as const },
      { ...supported, databaseTopology: { mode: 'single' as const } },
      {
        ...supported,
        databaseTopology: {
          mode: 'multiple' as const,
          tenantIsolation: 'shared-row' as const,
        },
      },
    ];

    for (const input of unsupported) {
      const error = captureConfigError(() =>
        assertDataStudioInstallationPreflight(input));
      expect(error.message).toBe(
        'Data Studio resources require Guardian multi-tenancy, advanced authorization, and Fabric tenant-database isolation.',
      );
      expect(error.details).toEqual({
        component: 'data-studio-installation',
        reason: 'profile-required',
      });
    }
  });

  test('keeps the optional feature absent when neither fragment is installed', () => {
    expect(resolveDataStudioInstallation(
      {},
      emptyRegistry(),
      null,
      new Map(),
    )).toBe(false);
  });

  test('does not reserve matching application table names without feature Resources', () => {
    expect(resolveDataStudioInstallation(
      { [DATA_STUDIO_TABLES_TABLE_NAME]: DATA_STUDIO_TENANT_TABLES.data_studio_tables },
      emptyRegistry(),
      null,
      new Map(),
    )).toBe(false);
  });

  test('admits the exact official fragments through a real Resource registry', () => {
    expect(resolveOfficialInstallation()).toBe(true);
  });

  test('admits the legitimate composed realm and preserves official handler identities', () => {
    expect(dataStudioActorFixtureRealm.queries).toMatchObject(
      DATA_STUDIO_REALM_CONTRIBUTION.queries,
    );
    expect(dataStudioActorFixtureRealm.commands).toMatchObject(
      DATA_STUDIO_REALM_CONTRIBUTION.commands,
    );
    for (const [name, handler] of Object.entries(DATA_STUDIO_REALM_CONTRIBUTION.queries)) {
      expect(dataStudioActorFixtureRealm.queries[name]).toBe(handler);
    }
    for (const [name, handler] of Object.entries(DATA_STUDIO_REALM_CONTRIBUTION.commands)) {
      expect(dataStudioActorFixtureRealm.commands[name]).toBe(handler);
    }
    expect(resolveDataStudioInstallation(
      DATA_STUDIO_TENANT_TABLES,
      createRegistry(),
      dataStudioActorFixtureRealm,
      dataStudioSyncModes(),
    )).toBe(true);
  });

  test('requires every table, Resource, actor query, and actor command', () => {
    const queryEntries = Object.entries(DATA_STUDIO_REALM_CONTRIBUTION.queries);
    const commandEntries = Object.entries(DATA_STUDIO_REALM_CONTRIBUTION.commands);
    const partialCases = [
      {
        tables: Object.fromEntries(
          Object.entries(DATA_STUDIO_TENANT_TABLES).slice(0, -1),
        ),
        resources: createRegistry(),
        realm: DATA_STUDIO_REALM_CONTRIBUTION,
      },
      {
        tables: DATA_STUDIO_TENANT_TABLES,
        resources: createRegistry(DATA_STUDIO_RESOURCES.slice(0, -1)),
        realm: DATA_STUDIO_REALM_CONTRIBUTION,
      },
      {
        tables: DATA_STUDIO_TENANT_TABLES,
        resources: createRegistry(),
        realm: null,
      },
      {
        tables: DATA_STUDIO_TENANT_TABLES,
        resources: createRegistry(),
        realm: {
          tables: DATA_STUDIO_TENANT_TABLES,
          queries: Object.fromEntries(queryEntries.slice(0, -1)),
          commands: DATA_STUDIO_REALM_CONTRIBUTION.commands,
        },
      },
      {
        tables: DATA_STUDIO_TENANT_TABLES,
        resources: createRegistry(),
        realm: {
          tables: DATA_STUDIO_TENANT_TABLES,
          queries: DATA_STUDIO_REALM_CONTRIBUTION.queries,
          commands: Object.fromEntries(commandEntries.slice(0, -1)),
        },
      },
    ];

    for (const input of partialCases) {
      const error = captureConfigError(() => resolveDataStudioInstallation(
        input.tables,
        input.resources,
        input.realm,
        dataStudioSyncModes(),
      ));
      expect(error.message).toBe(
        'Data Studio must install its complete table, resource, and actor realm fragments together.',
      );
      expect(error.details).toEqual({
        component: 'data-studio-installation',
        reason: 'fragment-incomplete',
      });
    }
  });

  test('rejects modified fixed table SQL in both app and realm catalogs', () => {
    const alteredTables = replaceTableSchema(
      DATA_STUDIO_COLUMN_STATS_TABLE_NAME,
      Object.freeze({
        ...DATA_STUDIO_TENANT_TABLES[DATA_STUDIO_COLUMN_STATS_TABLE_NAME],
        value_count: 'integer not null default 0',
      }),
    );
    const error = captureConfigError(() => resolveDataStudioInstallation(
      alteredTables,
      createRegistry(),
      realmFor(alteredTables),
      dataStudioSyncModes(),
    ));
    expectContractFailure(error, 'table-contract-mismatch', DATA_STUDIO_COLUMN_STATS_TABLE_NAME);
  });

  test('rejects a table clone which strips required Guardian reference metadata', () => {
    const alteredTables = replaceTableSchema(
      DATA_STUDIO_TABLES_TABLE_NAME,
      Object.freeze({
        ...DATA_STUDIO_TENANT_TABLES[DATA_STUDIO_TABLES_TABLE_NAME],
      }),
    );
    const error = captureConfigError(() => resolveDataStudioInstallation(
      alteredTables,
      createRegistry(),
      realmFor(alteredTables),
      dataStudioSyncModes(),
    ));
    expectContractFailure(error, 'table-contract-mismatch', DATA_STUDIO_TABLES_TABLE_NAME);
  });

  test('rejects altered Resource exposure through a real registry', () => {
    const resource = resourceFor(DATA_STUDIO_CELLS_TABLE_NAME);
    expectResourceMismatch(replaceResource(resource.table, redefineResource(resource, {
      exposure: 'all',
    })), resource.table);
  });

  test('rejects altered Resource actions through a real registry', () => {
    const resource = resourceFor(DATA_STUDIO_CELLS_TABLE_NAME);
    expectResourceMismatch(replaceResource(resource.table, redefineResource(resource, {
      actions: ['list', 'get', 'create'],
      policy: {
        ...resource.policy,
        create: resource.policy.list!,
      },
    })), resource.table);
  });

  test('rejects altered Resource field projections through a real registry', () => {
    const resource = resourceFor(DATA_STUDIO_ROWS_TABLE_NAME);
    expectResourceMismatch(replaceResource(resource.table, redefineResource(resource, {
      fields: {
        ...resource.fields!,
        read: [...resource.fields!.read, 'values_json'],
      },
    })), resource.table);
  });

  test('rejects a semantically equivalent but replaced Resource policy', () => {
    const resource = resourceFor(DATA_STUDIO_ROWS_TABLE_NAME);
    const replacement = allOf(resource.policy.list!);
    expectResourceMismatch(replaceResource(resource.table, redefineResource(resource, {
      policy: replacement,
    })), resource.table);
  });

  test('rejects altered Resource name through a real registry', () => {
    const resource = resourceFor(DATA_STUDIO_CELLS_TABLE_NAME);
    expectResourceMismatch(replaceResource(resource.table, redefineResource(resource, {
      name: 'replacement-cells',
    })), resource.table);
  });

  test('rejects altered Resource realm and normalized storage through a real registry', () => {
    const resource = resourceFor(DATA_STUDIO_CELLS_TABLE_NAME);
    expectResourceMismatch(replaceResource(resource.table, redefineResource(resource, {
      realm: globalRealm(),
    })), resource.table);
  });

  test('rejects normalized storage drift independently of the logical realm', () => {
    const registry = createRegistry();
    const table = DATA_STUDIO_CELLS_TABLE_NAME;
    const catalog = {
      hasTable: (name: string) => registry.hasTable(name),
      getByTable: (name: string): RegisteredResourceDefinition | null => {
        const registered = registry.getByTable(name);
        if (!registered || name !== table) return registered;
        return Object.freeze({ ...registered, storage: Object.freeze({ kind: 'unscoped' }) });
      },
    };
    const error = captureConfigError(() => resolveDataStudioInstallation(
      DATA_STUDIO_TENANT_TABLES,
      catalog,
      DATA_STUDIO_REALM_CONTRIBUTION,
      dataStudioSyncModes(),
    ));
    expectContractFailure(error, 'resource-contract-mismatch', table);
  });

  test('rejects an altered Resource primary key admitted against an altered registry schema', () => {
    const resource = resourceFor(DATA_STUDIO_CELLS_TABLE_NAME);
    const alteredCellSchema = Object.freeze({
      ...DATA_STUDIO_TENANT_TABLES[DATA_STUDIO_CELLS_TABLE_NAME],
      cell_id: 'text not null',
      row_record_id: 'text primary key',
    });
    const registryTables = replaceTableSchema(DATA_STUDIO_CELLS_TABLE_NAME, alteredCellSchema);
    const alteredResources = replaceResource(resource.table, redefineResource(resource, {
      primaryKey: 'row_record_id',
    }));
    const registry = createRegistry(alteredResources, registryTables);
    const error = captureConfigError(() => resolveDataStudioInstallation(
      DATA_STUDIO_TENANT_TABLES,
      registry,
      DATA_STUDIO_REALM_CONTRIBUTION,
      dataStudioSyncModes(),
    ));
    expectContractFailure(error, 'resource-contract-mismatch', resource.table);
  });

  test('rejects replacement query and command handlers with official names', () => {
    const queryName = Object.keys(DATA_STUDIO_REALM_CONTRIBUTION.queries)[0]!;
    const commandName = Object.keys(DATA_STUDIO_REALM_CONTRIBUTION.commands)[0]!;
    const replacementQueryRealm = defineDatabaseRealm({
      name: 'data-studio-replacement-query',
      version: '1',
      tables: DATA_STUDIO_TENANT_TABLES,
      queries: {
        ...DATA_STUDIO_REALM_CONTRIBUTION.queries,
        [queryName]: () => null,
      },
      commands: DATA_STUDIO_REALM_CONTRIBUTION.commands,
    });
    const replacementCommandRealm = defineDatabaseRealm({
      name: 'data-studio-replacement-command',
      version: '1',
      tables: DATA_STUDIO_TENANT_TABLES,
      queries: DATA_STUDIO_REALM_CONTRIBUTION.queries,
      commands: {
        ...DATA_STUDIO_REALM_CONTRIBUTION.commands,
        [commandName]: () => null,
      },
    });

    for (const realm of [replacementQueryRealm, replacementCommandRealm]) {
      const error = captureConfigError(() => resolveDataStudioInstallation(
        DATA_STUDIO_TENANT_TABLES,
        createRegistry(),
        realm,
        dataStudioSyncModes(),
      ));
      expectContractFailure(error, 'handler-contract-mismatch');
    }
  });

  test('requires full catalog and lazy row client Sync modes', () => {
    const invalidModes = [
      dataStudioSyncModes({ [DATA_STUDIO_TABLES_TABLE_NAME]: 'lazy' }),
      dataStudioSyncModes({ [DATA_STUDIO_ROWS_TABLE_NAME]: 'full' }),
      dataStudioSyncModes({ [DATA_STUDIO_TABLES_TABLE_NAME]: 'auto' }),
      dataStudioSyncModes({ [DATA_STUDIO_ROWS_TABLE_NAME]: 'auto' }),
    ];

    for (const modes of invalidModes) {
      const error = captureConfigError(() => resolveDataStudioInstallation(
        DATA_STUDIO_TENANT_TABLES,
        createRegistry(),
        DATA_STUDIO_REALM_CONTRIBUTION,
        modes,
      ));
      expect(error.details).toMatchObject({
        component: 'data-studio-installation',
        reason: 'client-sync-mode-mismatch',
      });
      expect(new Set<string>([
        DATA_STUDIO_TABLES_TABLE_NAME,
        DATA_STUDIO_ROWS_TABLE_NAME,
      ]).has(String(error.details?.table))).toBe(true);
    }
  });
});

function resolveOfficialInstallation(): boolean {
  return resolveDataStudioInstallation(
    DATA_STUDIO_TENANT_TABLES,
    createRegistry(),
    DATA_STUDIO_REALM_CONTRIBUTION,
    dataStudioSyncModes(),
  );
}

function createRegistry(
  resources: readonly ResourceDefinition[] = DATA_STUDIO_RESOURCES,
  tables: Readonly<Record<string, TableSchema>> = DATA_STUDIO_TENANT_TABLES,
): ResourceRegistry {
  const registry = new ResourceRegistry();
  registry.register(resources, {
    tables: tables as Record<string, TableSchema>,
    authConfig: AUTH_CONFIG,
    tenancyMode: 'multi',
    tenantIsolation: 'tenant-database',
    managedTables: resources.map((resource) => resource.table),
  });
  return registry.seal();
}

function emptyRegistry(): ResourceRegistry {
  return new ResourceRegistry().seal();
}

function dataStudioSyncModes(
  overrides: Readonly<Record<string, DeclaredSyncMode>> = {},
): ReadonlyMap<string, DeclaredSyncMode> {
  return new Map<string, DeclaredSyncMode>([
    [DATA_STUDIO_TABLES_TABLE_NAME, 'full'],
    [DATA_STUDIO_ROWS_TABLE_NAME, 'lazy'],
    ...Object.entries(overrides),
  ]);
}

function resourceFor(table: string): ResourceDefinition {
  const resource = DATA_STUDIO_RESOURCES.find((candidate) => candidate.table === table);
  if (!resource) throw new Error(`Missing Data Studio Resource fixture for ${table}.`);
  return resource;
}

function redefineResource(
  resource: ResourceDefinition,
  overrides: Partial<ResourceDefinitionOptions<string>>,
): ResourceDefinition {
  return defineResource({
    name: resource.name,
    table: resource.table,
    primaryKey: resource.primaryKey,
    exposure: resource.exposure,
    realm: resource.realm,
    actions: resource.actions,
    fields: resource.fields,
    policy: resource.policy,
    ...overrides,
  });
}

function replaceResource(
  table: string,
  replacement: ResourceDefinition,
): readonly ResourceDefinition[] {
  return DATA_STUDIO_RESOURCES.map((resource) =>
    resource.table === table ? replacement : resource);
}

function replaceTableSchema(
  table: string,
  replacement: Readonly<TableSchema>,
): Readonly<Record<string, Readonly<TableSchema>>> {
  return Object.freeze({
    ...DATA_STUDIO_TENANT_TABLES,
    [table]: replacement,
  });
}

function realmFor(tables: Readonly<Record<string, Readonly<TableSchema>>>) {
  return defineDatabaseRealm({
    name: 'data-studio-altered-tables',
    version: '1',
    tables,
    queries: DATA_STUDIO_REALM_CONTRIBUTION.queries,
    commands: DATA_STUDIO_REALM_CONTRIBUTION.commands,
  });
}

function expectResourceMismatch(
  resources: readonly ResourceDefinition[],
  table: string,
): void {
  const error = captureConfigError(() => resolveDataStudioInstallation(
    DATA_STUDIO_TENANT_TABLES,
    createRegistry(resources),
    DATA_STUDIO_REALM_CONTRIBUTION,
    dataStudioSyncModes(),
  ));
  expectContractFailure(error, 'resource-contract-mismatch', table);
}

function expectContractFailure(
  error: DatabaseError,
  reason: string,
  table?: string,
): void {
  expect(error.code).toBe('DATABASE_CONFIG_INVALID');
  expect(error.retryable).toBe(false);
  expect(error.outcome).toBe('not-started');
  expect(error.details).toEqual({
    component: 'data-studio-installation',
    reason,
    ...(table === undefined ? {} : { table }),
  });
}

function captureConfigError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    const databaseError = error as DatabaseError;
    expect(databaseError.code).toBe('DATABASE_CONFIG_INVALID');
    return databaseError;
  }
  throw new Error('Expected Data Studio installation admission to fail.');
}
