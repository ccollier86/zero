/** Read-only preflight for the strict preset's source-transaction durability, before managed files are opened. */
import { resolveSQLiteStorageConfig } from '../../persistence/storage-config';
import { LoggingError } from '../../logging/logging-error';
import type { ReactiveDBConfig } from '../../sync/types';
import type { ResolvedConfig } from './types';

export function assertManagedLoggingDurability(config: Pick<ResolvedConfig, 'logging' | 'auth' | 'db' | 'systemDb' | 'databaseTopology'>): void {
  if (!config.logging || !config.logging.policy.complianceRequested) return;
  if (config.auth === false) fail('The compliance logging preset requires managed Guardian authentication.');
  for (const [name, database] of [['db', config.db], ['systemDb', config.systemDb]] as const) {
    if (!durableFile(database)) fail(`Compliance logging requires ${name} in file mode with synchronous FULL or EXTRA; hot/ephemeral control sources are not qualified.`);
  }
  const topology = config.databaseTopology;
  if (topology.mode === 'multiple') {
    // A hybrid selector may choose any admitted hot policy. Do not promise
    // same-commit durability when periodic/final snapshots intentionally defer it.
    if (topology.placement.hot && topology.placement.hot.durability !== 'on-write') fail('Compliance logging requires on-write durability for managed Fabric hot placement.');
    if (topology.sqlite.synchronous !== 'FULL' && topology.sqlite.synchronous !== 'EXTRA') fail('Compliance logging requires Fabric sqlite.synchronous FULL or EXTRA.');
  }
}

function durableFile(database: ReactiveDBConfig): boolean {
  if (database.database && !database.sqlite) return false;
  if (database.sqlite) {
    if (database.sqlite.mode !== 'file') return false;
    // The supplied service is already owned by the caller. Verify its actual
    // setting rather than accepting a second config which did not open it.
    const value = database.sqlite.raw.query<{ synchronous: number }, []>('PRAGMA synchronous').get()?.synchronous;
    return value === 2 || value === 3;
  }
  const resolved = resolveSQLiteStorageConfig(database);
  return resolved.mode === 'file' && (resolved.synchronous === 'FULL' || resolved.synchronous === 'EXTRA');
}

function fail(message: string): never { throw new LoggingError('LOGGING_CONFIG_INVALID', message); }
