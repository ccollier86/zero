/** Admission of named app-data operations, independent of physical topology. */
import { DatabaseError } from '../../databases/database-error';
import { defineDatabaseRealm, type DatabaseRealm } from '../../databases/database-realm';
import type { TableSchema } from '../../sync/types';
import type { ResolvedAppDatabaseTopologyConfig } from './database-topology-types';
import { assertTenantDatabaseRealmSchemaSubset } from './tenant-database-topology';

export function resolveAppDataRealm(
  input: DatabaseRealm | undefined,
  tables: Readonly<Record<string, TableSchema>>,
  topology: ResolvedAppDatabaseTopologyConfig,
): DatabaseRealm | undefined {
  if (input === undefined) return undefined;
  let admitted: DatabaseRealm;
  try {
    // Re-admit and detach definitions; don't trust a caller-supplied checksum.
    admitted = defineDatabaseRealm({
      name: input.name, version: input.version, tables: input.tables,
      queries: input.queries, commands: input.commands,
      migrations: input.migrations, automations: input.automations,
    });
    if (admitted.fingerprint !== input.fingerprint) throw new Error('invalid realm identity');
  } catch (cause) {
    throw new DatabaseError('DATABASE_CONFIG_INVALID', '[app] dataRealm must be created with defineDatabaseRealm().', { cause });
  }
  assertTenantDatabaseRealmSchemaSubset(admitted, tables, 'dataRealm');
  if (topology.mode === 'multiple' && topology.tenantIsolation === 'tenant-database'
    && admitted.fingerprint !== topology.realm.fingerprint) {
    throw new DatabaseError('DATABASE_SCHEMA_MISMATCH', '[app] dataRealm must match the tenant databaseTopology.realm.');
  }
  return admitted;
}
