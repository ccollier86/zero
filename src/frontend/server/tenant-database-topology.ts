/**
 * Resolve the application tables that physically belong to tenant databases.
 *
 * The resource registry is the authoritative realm classification. The actor
 * realm is an execution/schema artifact and must match that classification;
 * otherwise a global table could be duplicated into every tenant file or a
 * tenant table could silently remain in the shared default database.
 */

import type { DatabaseRealm } from '../../databases/database-realm';
import {
  DatabaseError,
  type DatabaseErrorCode,
} from '../../databases/database-error';
import {
  hashSchemaSnapshot,
  snapshotDeclaredTables,
} from '../../migrations/schema-snapshot';
import type {
  RegisteredResourceDefinition,
  ResourceRegistry,
} from '../../resources/resource-registry';
import { getPolicyEligibleTenantKinds } from '../../resources/resource-policy-inspection';
import type { TenantKind } from '../../auth/tenancy/tenancy-types';
import type { SyncTenantDataPlaneTable } from '../../sync/sync-tenant-data-plane';
import type { TableSchema } from '../../sync/types';

export interface TenantDatabaseResourceTopology {
  /** Every physical tenant table, including internal and HTTP-only resources. */
  readonly tables: readonly string[];
  /** Physical tenant tables exposed through the realtime Sync transport. */
  readonly syncTables: readonly string[];
  /** Trusted server catalog used to route and validate tenant Sync tables. */
  readonly syncCatalog: Readonly<Record<string, SyncTenantDataPlaneTable>>;
  /** Tenant purposes which at least one physical resource policy may admit. */
  readonly eligibleTenantKinds: readonly TenantKind[];
}

/**
 * Validate the portion of createApp({ tables }) packaged into the actor realm.
 * Exact resource ownership is checked after async resource modules load; this
 * earlier check only permits a schema-identical subset and rejects unknown
 * actor tables without requiring filesystem or resource-loader work.
 */
export function assertTenantDatabaseRealmSchemaSubset(
  realm: Pick<DatabaseRealm, 'tables' | 'schemaChecksum'>,
  appTables: Readonly<Record<string, TableSchema>>,
): void {
  const realmNames = Object.keys(realm.tables);
  const unknown = realmNames.filter((table) => !Object.hasOwn(appTables, table));
  if (unknown.length > 0) {
    throw tenantTopologyError(
      '[app] databaseTopology tenant realm contains tables not declared by '
      + `createApp({ tables }): ${unknown.sort(compareText).join(', ')}.`,
      'DATABASE_CONFIG_INVALID',
    );
  }

  const expected: Record<string, TableSchema> = Object.create(null);
  for (const table of realmNames) expected[table] = appTables[table]!;
  const checksum = hashSchemaSnapshot(snapshotDeclaredTables(expected));
  if (realm.schemaChecksum !== checksum) {
    throw tenantTopologyError(
      '[app] databaseTopology tenant realm table schemas must match the '
      + 'corresponding createApp({ tables }) declarations.',
      'DATABASE_SCHEMA_MISMATCH',
    );
  }
}

/**
 * Validate the actor realm against registered resource ownership and build the
 * narrow table catalog that may cross the tenant Sync adapter boundary.
 */
export function resolveTenantDatabaseResourceTopology(
  registry: Pick<ResourceRegistry, 'list'>,
  realm: Pick<DatabaseRealm, 'tables'>,
): TenantDatabaseResourceTopology {
  const resources = registry.list();
  const physical = resources.filter(isPhysicalTenantResource);
  const expected = physical.map((resource) => resource.table).sort(compareText);
  const actual = Object.keys(realm.tables).sort(compareText);

  if (!sameStrings(expected, actual)) {
    const missing = expected.filter((table) => !actual.includes(table));
    const extra = actual.filter((table) => !expected.includes(table));
    throw tenantTopologyError(
      '[app] databaseTopology tenant realm tables must exactly match '
      + 'tenant-owned resource tables.'
      + describeDifference(missing, extra),
      'DATABASE_SCHEMA_MISMATCH',
    );
  }

  const syncCatalog: Record<string, SyncTenantDataPlaneTable> = Object.create(null);
  const eligibleTenantKinds = new Set<TenantKind>();
  for (const resource of physical) {
    const policies = resource.actions
      .map((action) => resource.policy[action])
      .filter((policy) => policy !== undefined);
    // A malformed/legacy registry with no action policy must not be mistaken
    // for a proof that no tenant kind is eligible. Registry validation rejects
    // this in managed apps; keeping the topology conservative makes this
    // helper safe when used independently in tests or diagnostics.
    if (policies.length === 0) {
      eligibleTenantKinds.add('organization');
      eligibleTenantKinds.add('administration');
    }
    for (const policy of policies) {
      for (const kind of getPolicyEligibleTenantKinds(policy!)) {
        eligibleTenantKinds.add(kind);
      }
    }
    if (!resource.exposure.sync) continue;
    const schema = realm.tables[resource.table];
    if (!schema) {
      // The exact-set check above makes this unreachable, but keep the catalog
      // construction fail-closed if it is ever reused independently.
      throw tenantTopologyError(
        `[app] Tenant Sync table "${resource.table}" is missing from the database realm.`,
        'DATABASE_SCHEMA_MISMATCH',
      );
    }
    const columns = Object.keys(schema).filter((field) => field !== '_identity');
    if (!columns.includes(resource.primaryKey)) {
      throw tenantTopologyError(
        `[app] Tenant Sync table "${resource.table}" does not declare its resource primary key.`,
        'DATABASE_SCHEMA_MISMATCH',
      );
    }
    const identity = Array.isArray(schema._identity)
      ? Object.freeze([...schema._identity])
      : undefined;
    syncCatalog[resource.table] = Object.freeze({
      primaryKey: resource.primaryKey,
      columns: Object.freeze(columns),
      ...(identity ? { identity } : {}),
    });
  }

  const syncTables = Object.keys(syncCatalog).sort(compareText);
  return Object.freeze({
    tables: Object.freeze(expected),
    syncTables: Object.freeze(syncTables),
    syncCatalog: Object.freeze(syncCatalog),
    eligibleTenantKinds: Object.freeze(
      (['organization', 'administration'] as const)
        .filter((kind) => eligibleTenantKinds.has(kind)),
    ),
  });
}

function isPhysicalTenantResource(
  resource: RegisteredResourceDefinition,
): boolean {
  return resource.storage.kind === 'tenant'
    && resource.storage.isolation === 'tenant-database';
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function describeDifference(
  missing: readonly string[],
  extra: readonly string[],
): string {
  const details = [
    missing.length > 0 ? ` missing: ${missing.join(', ')}` : '',
    extra.length > 0 ? ` extra: ${extra.join(', ')}` : '',
  ].filter(Boolean);
  return details.length > 0 ? ` (${details.join(';').trim()})` : '';
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tenantTopologyError(
  message: string,
  code: Extract<
    DatabaseErrorCode,
    'DATABASE_CONFIG_INVALID' | 'DATABASE_SCHEMA_MISMATCH'
  >,
): DatabaseError {
  return new DatabaseError(code, message, {
    retryable: false,
    outcome: 'not-started',
    details: { component: 'tenant-database-topology' },
  });
}
