/**
 * Adapts resolved createApp database automation configuration to the focused
 * Doctor checker. Runtime health and live actor fingerprints remain optional
 * inputs for direct checkDatabaseAutomations() callers.
 */

import type {
  AppConfig,
  AppTableInput,
  ResolvedConfig,
} from '../frontend/server/types';
import { resolveSQLiteStorageConfig } from '../persistence/storage-config';
import type { TableSchema } from '../sync/types';
import type { PlatformDoctorFindingSink } from './platform-doctor-contracts';
import {
  checkDatabaseAutomations,
  type DatabaseAutomationInfrastructureSnapshot,
} from './platform-doctor-database-automations';

/** Check pinned and Fabric registries admitted by the resolved app config. */
export function checkConfiguredDatabaseAutomations(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  if (resolved.databaseAutomations) {
    const mode = resolved.db.sqlite?.mode
      ?? resolveSQLiteStorageConfig(resolved.db).mode;
    checkDatabaseAutomations({
      registry: resolved.databaseAutomations,
      tables: resolved.tables,
      infrastructure: managedInfrastructure(mode !== 'ephemeral'),
      path: 'databaseAutomations',
    }, findings);
  }

  const topology = resolved.databaseTopology;
  if (topology.mode !== 'multiple' || !topology.realm.automations) return;
  checkDatabaseAutomations({
    realm: topology.realm,
    infrastructure: managedInfrastructure(true),
    path: 'databaseTopology.realm.automations',
  }, findings);
}

/**
 * Preserve focused automation diagnostics when another cross-feature config
 * invariant prevents full createApp resolution. This is intentionally a
 * read-only best-effort projection of already-declared registries; the normal
 * resolved pass remains authoritative whenever resolution succeeds.
 */
export function checkUnresolvedDatabaseAutomations(
  config: AppConfig,
  findings: PlatformDoctorFindingSink,
): void {
  const tables = normalizeDeclaredTables(config.tables);
  if (config.databaseAutomations) {
    try {
      const mode = config.db.sqlite?.mode
        ?? resolveSQLiteStorageConfig(config.db).mode;
      checkDatabaseAutomations({
        registry: config.databaseAutomations,
        tables,
        infrastructure: managedInfrastructure(mode !== 'ephemeral'),
        path: 'databaseAutomations',
      }, findings);
    } catch {
      // The primary config.invalid finding owns malformed unresolved input.
      // Never expose a caught config value or error from this fallback pass.
    }
  }

  const topology = config.databaseTopology;
  if (topology?.mode === 'multiple' && topology.realm.automations) {
    try {
      checkDatabaseAutomations({
        realm: topology.realm,
        infrastructure: managedInfrastructure(true),
        path: 'databaseTopology.realm.automations',
      }, findings);
    } catch {
      // See the privacy boundary above; resolveConfig reports the root defect.
    }
  }
}

function normalizeDeclaredTables(
  tables: Readonly<Record<string, AppTableInput>>,
): Readonly<Record<string, Readonly<TableSchema>>> {
  const normalized: Record<string, Readonly<TableSchema>> = {};
  for (const [name, definition] of Object.entries(tables)) {
    const wrapped = 'serverTable' in definition
      ? definition as Exclude<AppTableInput, TableSchema>
      : undefined;
    normalized[name] = wrapped?.serverTable ?? definition as TableSchema;
  }
  return Object.freeze(normalized);
}

function managedInfrastructure(
  durableStorage: boolean,
): DatabaseAutomationInfrastructureSnapshot {
  return Object.freeze({
    storage: durableStorage ? 'durable' : 'ephemeral',
    outbox: durableStorage ? 'durable' : 'absent',
    dispatcherEnabled: true,
  });
}
