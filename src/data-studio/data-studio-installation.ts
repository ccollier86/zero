/** Admission for the opt-in Data Studio server surface. */

import type {
  AuthAuthorizationMode,
  AuthTenancyMode,
} from '../auth/types';
import { DatabaseError } from '../databases/database-error';
import type { DatabaseRealm } from '../databases/database-realm';
import { getGuardianTableReferences } from '../schema/guardian-references';
import type { ResourceDefinition } from '../resources/resource-definition';
import type {
  RegisteredResourceDefinition,
  ResourceRegistry,
  ResourceTenantIsolation,
} from '../resources/resource-registry';
import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type DeclaredSyncMode,
  type SyncTableMutationValidator,
  type TableSchema,
} from '../sync/types';
import {
  DATA_STUDIO_COMMAND_NAMES,
  DATA_STUDIO_QUERY_NAMES,
} from './data-studio-operation-contracts';
import { DATA_STUDIO_REALM_CONTRIBUTION } from './data-studio-realm-contribution';
import { DATA_STUDIO_RESOURCES } from './data-studio-resources';
import { DATA_STUDIO_TENANT_TABLES } from './data-studio-tenant-schema';

const DATA_STUDIO_TABLE_NAMES = Object.freeze(
  Object.keys(DATA_STUDIO_TENANT_TABLES) as Array<keyof typeof DATA_STUDIO_TENANT_TABLES>,
);
const DATA_STUDIO_TABLE_NAME_SET = new Set<string>(DATA_STUDIO_TABLE_NAMES);
const DATA_STUDIO_QUERY_NAME_LIST = Object.freeze(
  Object.values(DATA_STUDIO_QUERY_NAMES),
);
const DATA_STUDIO_COMMAND_NAME_LIST = Object.freeze(
  Object.values(DATA_STUDIO_COMMAND_NAMES),
);
const DATA_STUDIO_RESOURCE_BY_TABLE = new Map(
  DATA_STUDIO_RESOURCES.map((resource) => [resource.table, resource] as const),
);
const DATA_STUDIO_CLIENT_SYNC_MODES = Object.freeze({
  data_studio_tables: 'full',
  data_studio_rows: 'lazy',
} satisfies Readonly<Record<string, DeclaredSyncMode>>);
const RESOURCE_POLICY_ACTIONS = Object.freeze([
  'list',
  'get',
  'create',
  'update',
  'delete',
] as const);

type DataStudioRealmCatalog = Pick<DatabaseRealm, 'tables' | 'queries' | 'commands'>;
type DataStudioResourceCatalog = Pick<ResourceRegistry, 'getByTable' | 'hasTable'>;

export interface DataStudioInstallationPreflightInput {
  readonly resources: readonly Pick<ResourceDefinition, 'table'>[];
  readonly authEnabled: boolean;
  readonly tenancyMode: AuthTenancyMode;
  readonly authorizationMode: AuthAuthorizationMode;
  readonly databaseTopology:
    | Readonly<{ mode: 'single' }>
    | Readonly<{
        mode: 'multiple';
        tenantIsolation: ResourceTenantIsolation;
      }>;
}

/**
 * Fail with the feature-specific profile requirement before generic Resource
 * validation can obscure an attempted Data Studio installation.
 *
 * A Resource declaration is the sole opt-in signal. Application tables with
 * matching names remain backwards-compatible and do not activate this check.
 */
export function assertDataStudioInstallationPreflight(
  input: DataStudioInstallationPreflightInput,
): boolean {
  const requested = input.resources.some((resource) =>
    DATA_STUDIO_TABLE_NAME_SET.has(resource.table));
  if (!requested) return false;

  const physicalTenantTopology = input.databaseTopology.mode === 'multiple'
    && input.databaseTopology.tenantIsolation === 'tenant-database';
  if (input.authEnabled
    && input.tenancyMode === 'multi'
    && input.authorizationMode === 'advanced'
    && physicalTenantTopology) return true;

  throw new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Data Studio resources require Guardian multi-tenancy, advanced authorization, and Fabric tenant-database isolation.',
    {
      retryable: false,
      outcome: 'not-started',
      details: {
        component: 'data-studio-installation',
        reason: 'profile-required',
      },
    },
  );
}

/**
 * Return whether the complete Data Studio data plane is installed.
 *
 * Resource declarations are the opt-in signal. Matching application table
 * names alone remain backwards-compatible; once any Data Studio Resource is
 * declared, the complete table/resource bundle and actor handler catalog are
 * required before request routes can report the feature as enabled.
 */
export function resolveDataStudioInstallation(
  tables: Readonly<Record<string, TableSchema>>,
  resources: DataStudioResourceCatalog,
  realm: DataStudioRealmCatalog | null,
  declaredSyncModes: ReadonlyMap<string, DeclaredSyncMode>,
): boolean {
  const declaredTables = DATA_STUDIO_TABLE_NAMES.filter((name) =>
    Object.hasOwn(tables, name));
  const declaredResources = DATA_STUDIO_TABLE_NAMES.filter((name) =>
    resources.hasTable(name));

  if (declaredResources.length === 0) return false;
  const hasQueries = realm !== null && DATA_STUDIO_QUERY_NAME_LIST.every((name) =>
    Object.hasOwn(realm.queries, name));
  const hasCommands = realm !== null && DATA_STUDIO_COMMAND_NAME_LIST.every((name) =>
    Object.hasOwn(realm.commands, name));
  if (declaredTables.length === DATA_STUDIO_TABLE_NAMES.length
    && declaredResources.length === DATA_STUDIO_TABLE_NAMES.length
    && hasQueries
    && hasCommands) {
    assertOfficialTableContracts(tables, realm!);
    assertOfficialClientSyncModes(declaredSyncModes);
    assertOfficialResourceContracts(resources);
    assertOfficialHandlerContracts(realm!);
    return true;
  }

  throw installationInvalid(
    'Data Studio must install its complete table, resource, and actor realm fragments together.',
    'fragment-incomplete',
  );
}

function assertOfficialTableContracts(
  tables: Readonly<Record<string, TableSchema>>,
  realm: DataStudioRealmCatalog,
): void {
  for (const table of DATA_STUDIO_TABLE_NAMES) {
    const expected = DATA_STUDIO_TENANT_TABLES[table]!;
    if (!sameTableSchema(tables[table], expected)
      || !sameTableSchema(realm.tables[table], expected)) {
      throw installationInvalid(
        'Data Studio must install its official fixed table schemas without modification.',
        'table-contract-mismatch',
        table,
      );
    }
  }
}

function assertOfficialClientSyncModes(
  declaredSyncModes: ReadonlyMap<string, DeclaredSyncMode>,
): void {
  for (const [table, expected] of Object.entries(DATA_STUDIO_CLIENT_SYNC_MODES)) {
    if (declaredSyncModes.get(table) !== expected) {
      throw installationInvalid(
        'Data Studio requires full catalog metadata and lazy row metadata Sync modes.',
        'client-sync-mode-mismatch',
        table,
      );
    }
  }
}

function assertOfficialResourceContracts(resources: DataStudioResourceCatalog): void {
  for (const table of DATA_STUDIO_TABLE_NAMES) {
    const expected = DATA_STUDIO_RESOURCE_BY_TABLE.get(table)!;
    const actual = resources.getByTable(table);
    if (!actual || !sameResourceContract(actual, expected)) {
      throw installationInvalid(
        'Data Studio must install its official normalized Resource contracts without modification.',
        'resource-contract-mismatch',
        table,
      );
    }
  }
}

function assertOfficialHandlerContracts(realm: DataStudioRealmCatalog): void {
  const queriesMatch = DATA_STUDIO_QUERY_NAME_LIST.every((name) =>
    realm.queries[name] === DATA_STUDIO_REALM_CONTRIBUTION.queries[name]);
  const commandsMatch = DATA_STUDIO_COMMAND_NAME_LIST.every((name) =>
    realm.commands[name] === DATA_STUDIO_REALM_CONTRIBUTION.commands[name]);
  if (queriesMatch && commandsMatch) return;
  throw installationInvalid(
    'Data Studio must install its official actor query and command handlers without replacement.',
    'handler-contract-mismatch',
  );
}

function sameResourceContract(
  actual: RegisteredResourceDefinition,
  expected: ResourceDefinition,
): boolean {
  return actual.name === expected.name
    && actual.table === expected.table
    && actual.primaryKey === expected.primaryKey
    && actual.exposure.kind === expected.exposure
    && actual.storage.kind === 'tenant'
    && actual.storage.isolation === 'tenant-database'
    && sameRealm(actual.realm, expected.realm)
    && sameStrings(actual.actions, expected.actions)
    && sameFieldContract(actual.fields, expected.fields)
    && RESOURCE_POLICY_ACTIONS.every((action) =>
      actual.policy[action] === expected.policy[action]);
}

function sameRealm(
  actual: RegisteredResourceDefinition['realm'],
  expected: ResourceDefinition['realm'],
): boolean {
  if (!actual || !expected || actual.kind !== expected.kind) return false;
  return actual.kind === 'global'
    ? true
    : expected.kind === 'tenant' && actual.field === expected.field;
}

function sameFieldContract(
  actual: RegisteredResourceDefinition['fields'],
  expected: ResourceDefinition['fields'],
): boolean {
  if (actual === undefined || expected === undefined) return actual === expected;
  return sameStrings(actual.read, expected.read)
    && sameStrings(actual.create, expected.create)
    && sameStrings(actual.update, expected.update)
    && sameStrings(actual.filter, expected.filter)
    && sameStrings(actual.sort, expected.sort);
}

function sameTableSchema(
  actual: Readonly<TableSchema> | undefined,
  expected: Readonly<TableSchema>,
): boolean {
  if (!actual) return false;
  const actualNames = Object.getOwnPropertyNames(actual);
  const expectedNames = Object.getOwnPropertyNames(expected);
  if (actualNames.length !== expectedNames.length
    || expectedNames.some((name) => !Object.hasOwn(actual, name))) return false;
  for (const name of expectedNames) {
    const left = actual[name];
    const right = expected[name];
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || !sameStrings(left, right)) {
        return false;
      }
    } else if (left !== right) {
      return false;
    }
  }

  const actualSymbols = Object.getOwnPropertySymbols(actual);
  const expectedSymbols = Object.getOwnPropertySymbols(expected);
  if (actualSymbols.length !== expectedSymbols.length
    || expectedSymbols.some((symbol) => !actualSymbols.includes(symbol))) return false;
  if (!sameGuardianReferences(actual, expected)) return false;
  return sameMutationValidator(
    actual[SYNC_TABLE_MUTATION_VALIDATOR],
    expected[SYNC_TABLE_MUTATION_VALIDATOR],
  );
}

function sameGuardianReferences(
  actual: Readonly<TableSchema>,
  expected: Readonly<TableSchema>,
): boolean {
  const left = getGuardianTableReferences(actual);
  const right = getGuardianTableReferences(expected);
  return left.length === right.length && left.every((reference, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && reference.field === candidate.field
      && reference.kind === candidate.kind
      && reference.table === candidate.table
      && reference.column === candidate.column
      && reference.onDelete === candidate.onDelete;
  });
}

function sameMutationValidator(
  actual: Readonly<SyncTableMutationValidator> | undefined,
  expected: Readonly<SyncTableMutationValidator> | undefined,
): boolean {
  if (actual === undefined || expected === undefined) return actual === expected;
  return actual.primaryKey === expected.primaryKey
    && sameStrings(actual.fieldNames, expected.fieldNames)
    && actual.decodeRow === expected.decodeRow
    && actual.encodeRow === expected.encodeRow
    && actual.validateRow === expected.validateRow;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function installationInvalid(
  message: string,
  reason?: string,
  table?: string,
): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    message,
    {
      retryable: false,
      outcome: 'not-started',
      details: {
        component: 'data-studio-installation',
        ...(reason === undefined ? {} : { reason }),
        ...(table === undefined ? {} : { table }),
      },
    },
  );
}
