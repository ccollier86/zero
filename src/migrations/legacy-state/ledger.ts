/** Partition historical records by approved registry identity, keeping original rows/IDs. */
import type { Database } from 'bun:sqlite';
import { migrations } from '../index';
import { LEGACY_LEDGER_TABLES, LEGACY_SYSTEM_CHECKSUMS, LEGACY_SYSTEM_VERSIONS } from './catalog';
import { failLegacyState } from './contracts';
import { quoteLegacyIdentifier as q } from './evidence';

export function admitLegacyLedgers(db: Database, app: Readonly<Record<string, string>>): string[] {
  const knownSystem = new Map(LEGACY_SYSTEM_VERSIONS.map((version, index) => [version, LEGACY_SYSTEM_CHECKSUMS[index]!]));
  const systemVersions = new Set(migrations.map(migration => migration.version));
  for (const [version, checksum] of Object.entries(app)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version) || !/^[a-f0-9]{64}$/.test(checksum) || systemVersions.has(version)) failLegacyState('LEGACY_STATE_LEDGER_INVALID');
  }
  const found = new Set<string>();
  for (const table of ['_migrations', '_zero_migrations']) {
    if (!hasTable(db, table)) continue;
    const rows = db.query<{ version: string; checksum: string }, []>(`SELECT version,checksum FROM ${q(table)}`).all();
    for (const row of rows) {
      const expected = knownSystem.get(row.version as typeof LEGACY_SYSTEM_VERSIONS[number]) ?? app[row.version];
      if (!expected || row.checksum !== expected) failLegacyState('LEGACY_STATE_LEDGER_INVALID');
      found.add(row.version);
    }
  }
  if (LEGACY_SYSTEM_VERSIONS.some(version => !found.has(version))) failLegacyState('LEGACY_STATE_LEDGER_INVALID');
  // A failure attempt does not replace the latest durable applied/rolled-back state.
  for (const version of found) {
    const latest = hasTable(db, '_zero_migrations')
      ? db.query<{ status: string; direction: string }, [string]>(`SELECT status,direction FROM _zero_migrations WHERE version=? AND status IN ('applied','rolled_back') ORDER BY id DESC LIMIT 1`).get(version) : null;
    const legacy = hasTable(db, '_migrations') ? db.query('SELECT 1 FROM _migrations WHERE version=?').get(version) : null;
    if (latest ? latest.status !== 'applied' || latest.direction !== 'up' || !legacy : !legacy) failLegacyState('LEGACY_STATE_LEDGER_INVALID');
  }
  for (const table of ['_zero_schema_history', '_zero_migration_artifacts']) {
    if (!hasTable(db, table)) continue;
    const versions = db.query<{ migration_version: string }, []>(`SELECT DISTINCT migration_version FROM ${q(table)}`).all();
    if (versions.some(row => !found.has(row.migration_version))) failLegacyState('LEGACY_STATE_LEDGER_INVALID');
  }
  return [...found].filter(version => !knownSystem.has(version as typeof LEGACY_SYSTEM_VERSIONS[number])).sort();
}

export function partitionLegacyLedgers(db: Database, versions: readonly string[]): void {
  const placeholders = versions.map(() => '?').join(',') || 'NULL';
  for (const table of LEGACY_LEDGER_TABLES) {
    if (!hasTable(db, table)) continue;
    const column = table === '_migrations' || table === '_zero_migrations' ? 'version' : 'migration_version';
    db.query(`DELETE FROM ${q(table)} WHERE ${q(column)} NOT IN (${placeholders})`).run(...versions);
  }
}

export function hasTable(db: Database, name: string): boolean {
  return !!db.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name);
}
