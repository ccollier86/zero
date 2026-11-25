/** Pure metadata admission only: no SQLite, filesystem, migrations or outputs. */
import { expect, test } from 'bun:test';
import { defineDatabaseRealm } from './database-realm';
import { admitDatabaseRealmMigrationTableStages, DATABASE_REALM_MIGRATION_HISTORY_MAX_BYTES } from './database-realm-migration-tables';
import { cloneDatabaseSerializableValue } from './database-operations';
import type { Migration } from '../migrations/migrator';

function fixture(count = 64) {
  const tables = { items: { id: 'TEXT PRIMARY KEY', ...Object.fromEntries(Array.from({ length: 200 }, (_, i) => ['field_' + i, 'TEXT'])) } };
  const migrations: Migration[] = Array.from({ length: count }, (_, index) => ({ version: String(index + 1).padStart(3, '0'), description: 'Synthetic metadata stage', up() {} }));
  const stages = migrations.map(migration => ({ version: migration.version, tables }));
  return { tables, migrations, stages };
}

test('cumulative native schema metadata may exceed one request node budget without widening actor operation limits', () => {
  const f = fixture();
  expect(() => cloneDatabaseSerializableValue(f.stages)).toThrow(expect.objectContaining({ code: 'DATABASE_PAYLOAD_LIMIT' }));
  const realm = defineDatabaseRealm({ name: 'synthetic.large-stage-history', version: '64', tables: f.tables,
    migrations: f.migrations, migrationTableStages: f.stages });
  expect(realm.migrationTableStages).toHaveLength(64);
  expect(realm.migrationTableStages![63]!.tables).toEqual(f.tables);
  expect(Object.isFrozen(realm.migrationTableStages)).toBe(true);
  // Configuration admission does not grant a larger data/request envelope.
  expect(() => cloneDatabaseSerializableValue(f.stages)).toThrow(expect.objectContaining({ code: 'DATABASE_PAYLOAD_LIMIT' }));
});

test('history admission still rejects holes, custom fields, accessors and proxies without invoking them', () => {
  const f = fixture(2); let touched = false;
  const sparse = [f.stages[0], ,], extended = Object.assign([...f.stages], { extra: true });
  const accessor = [...f.stages]; Object.defineProperty(accessor, '0', { enumerable: true, get() { touched = true; throw new Error('PRIVATE_CONFIG'); } });
  const proxy = new Proxy([...f.stages], { get() { touched = true; throw new Error('PRIVATE_CONFIG'); } });
  const inner = [{ version: '001', get tables() { touched = true; throw new Error('PRIVATE_CONFIG'); } }, f.stages[1]];
  for (const value of [sparse, extended, accessor, proxy, inner]) {
    expect(() => admitDatabaseRealmMigrationTableStages(value, f.migrations)).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
  }
  expect(touched).toBe(false);
});

test('configuration has a separate finite aggregate byte budget and keeps exact stage/SQL/schema checks', () => {
  expect(DATABASE_REALM_MIGRATION_HISTORY_MAX_BYTES).toBe(16 * 1024 * 1024);
  const f = fixture(2);
  expect(() => admitDatabaseRealmMigrationTableStages([{ ...f.stages[0], version: 'wrong' }, f.stages[1]], f.migrations)).toThrow();
  expect(() => admitDatabaseRealmMigrationTableStages([{ ...f.stages[0], tables: { items: { id: 'TEXT PRIMARY KEY', danger: 'TEXT); DROP TABLE items; --' } } }, f.stages[1]], f.migrations)).toThrow();
  expect(() => admitDatabaseRealmMigrationTableStages(f.stages, f.migrations, { different: { id: 'TEXT PRIMARY KEY' } })).toThrow();
  const tooLarge = Array.from({ length: 20 }, (_, index) => ({ version: String(index), tables: { items: { id: 'TEXT PRIMARY KEY', text: 'X'.repeat(900_000) } } }));
  const migrations = tooLarge.map(stage => ({ version: stage.version, description: 'Synthetic bounded metadata', up() {} }));
  expect(() => admitDatabaseRealmMigrationTableStages(tooLarge, migrations)).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
});
