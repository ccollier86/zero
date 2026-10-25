/** Frozen v1.3 ownership and physical contracts, not table-prefix guesses. */
import { Database } from 'bun:sqlite';
import { migrations } from '../index';
import { hashMigration } from '../schema-snapshot';
import { failLegacyState } from './contracts';
import { quoteLegacyIdentifier as q, sha256 } from './evidence';
import { defineLegacyRuntimeReference, LEGACY_APPLICATION_RUNTIME_TABLES } from './runtime-state';

export const LEGACY_LEDGER_TABLES = ['_migrations', '_zero_migrations', '_zero_schema_history', '_zero_migration_artifacts'] as const;
export const LEGACY_DERIVED_TABLES = ['_changes', '_change_sequence'] as const;
export const LEGACY_SYSTEM_VERSIONS = ['001', '002', '003', '004', '005', '006', '007'] as const;
export const LEGACY_SYSTEM_CHECKSUMS = [
  '94e93cee7f534ac564840b2f72af00b6fec9cfb4f6bce70e51faa4bf21681596',
  '7f1b6b0974b3f06d0d164d38fddf8594441bdf09496264a0cbd7619de6e03264',
  'd1ac0ebbe5485f5d49576a1f96709be1ff725450d12e76e06b850caa51274bcc',
  'e075b12038c1814667815aa7404f8e6ea640705c2da85fc65d84f23be6630a06',
  'fe84c55ca4d576fbd41f05c5bba5a0e6584733343a911a61a91370c196e0b93a',
  '4ffe14ae8c3ec90f317dbe93971aaad41434a74a526279f5245d2adbbc662366',
  'bd0a4322186613734ae550e8504964cf3111c69a245a1cc2db2cd1aacadb873a',
] as const;

let reference: Database | undefined;
function referenceSchema(): Database {
  if (reference) return reference;
  const db = new Database(':memory:', { strict: true });
  try {
    for (let i = 0; i < 7; i++) {
      const migration = migrations[i]!;
      if (migration.version !== LEGACY_SYSTEM_VERSIONS[i] || hashMigration(migration) !== LEGACY_SYSTEM_CHECKSUMS[i]) failLegacyState('LEGACY_STATE_SOURCE_UNSUPPORTED');
      migration.up(db);
    }
    // v1.3 UserStore installs this authority-bearing runtime table separately.
    db.exec(`CREATE TABLE _auth_user_generations (
      user_id TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )`);
    defineLegacyRuntimeReference(db);
    reference = db;
    return db;
  } catch (error) { db.close(); throw error; }
}

export function legacySystemTables(): readonly string[] {
  return referenceSchema().query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(row => row.name)
    .filter(name => !(LEGACY_APPLICATION_RUNTIME_TABLES as readonly string[]).includes(name));
}

/** Exact old column/FK contracts; extra lookup indexes do not change row ownership. */
export function assertLegacySystemSchema(db: Database, table: string): void {
  const expected = structuralShape(referenceSchema(), table), actual = structuralShape(db, table);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) failLegacyState('LEGACY_STATE_SOURCE_UNSUPPORTED');
  if (db.query("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").get(table)) failLegacyState('LEGACY_STATE_SOURCE_UNSUPPORTED');
}

function structuralShape(db: Database, table: string): unknown {
  const normalize = (rows: unknown[][]) => rows.map(row => row.map(value => typeof value === 'bigint' ? Number(value) : value));
  // Defaults, identifiers and quoted literals are case-sensitive evidence. Only
  // SQL type/action keywords may be normalized, never all string values.
  const columns = normalize(db.query(`PRAGMA table_xinfo(${q(table)})`).values()).map(row => row.map((value, index) => index === 2 && typeof value === 'string' ? value.toUpperCase() : value));
  const foreignKeys = normalize(db.query(`PRAGMA foreign_key_list(${q(table)})`).values());
  const uniqueIndexes = db.query<{ name: string; unique: number | bigint }, []>(`PRAGMA index_list(${q(table)})`).all()
    .filter(row => Number(row.unique) === 1)
    .map(row => normalize(db.query(`PRAGMA index_xinfo(${q(row.name)})`).values())).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // The source is a frozen migration profile, not arbitrary equivalent DDL.
  // Token comparison preserves quoted literals while ignoring indentation and
  // keyword case, and also catches changed CHECK/collation/conflict contracts.
  const sql = (db.query<{ sql: string }, [string]>("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table)!.sql)
    .match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_]*|[^\s]/g)
    ?.map(token => /^[A-Za-z_]/.test(token) ? token.toUpperCase() : token);
  return { columns, foreignKeys, uniqueIndexes, sql };
}

export function targetMigrationRegistrySha256(): string {
  return sha256(JSON.stringify(migrations.map(migration => [migration.version, hashMigration(migration)])));
}
