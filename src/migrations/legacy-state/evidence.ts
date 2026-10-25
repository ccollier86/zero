/** Typed value checksums, never row projections or diagnostic payloads. */
import { Database } from 'bun:sqlite';
import { failLegacyState } from './contracts';

export function quoteLegacyIdentifier(value: string): string { return '"' + value.replaceAll('"', '""') + '"'; }
export function validLegacyIdentifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value); }
export function sha256(value: string): string { return new Bun.CryptoHasher('sha256').update(value).digest('hex'); }

export function openLegacyRead(path: string): Database {
  const db = new Database(path, { readonly: true, strict: true, safeIntegers: true, create: false });
  try { db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN'); return db; }
  catch (error) { db.close(); throw error; }
}

/** End explicit read snapshots before closing; do not strand WAL read locks. */
export function closeLegacyRead(db: Database): void {
  try { if (db.inTransaction) db.exec('ROLLBACK'); } finally { db.close(); }
}

export function assertLegacyIntegrity(db: Database): void {
  const result = db.query('PRAGMA integrity_check').values();
  if (result.length !== 1 || result[0]?.[0] !== 'ok' || db.query('PRAGMA foreign_key_check').get()) failLegacyState('LEGACY_STATE_INTEGRITY_FAILED');
}

export function legacyTableColumns(db: Database, table: string): string[] {
  const rows = db.query<{ name: string; hidden: bigint }, []>(`PRAGMA table_xinfo(${quoteLegacyIdentifier(table)})`).all();
  if (!rows.length || rows.some(row => Number(row.hidden) !== 0)) failLegacyState('LEGACY_STATE_SOURCE_UNSUPPORTED');
  return rows.map(row => row.name);
}

export function legacyRowsEvidence(db: Database, table: string, columns = legacyTableColumns(db, table), where?: { column: string; values: readonly string[] }): { rows: number; rowsSha256: string } {
  const hash = new Bun.CryptoHasher('sha256').update('zero-legacy-typed-rows-v1\n' + JSON.stringify(columns));
  const fields = columns.map(quoteLegacyIdentifier);
  const predicate = where ? ` WHERE ${quoteLegacyIdentifier(where.column)} IN (${where.values.map(() => '?').join(',') || 'NULL'})` : '';
  const statement = db.query(`SELECT ${fields.join(',')} FROM ${quoteLegacyIdentifier(table)}${predicate} ORDER BY ${fields.map(field => `typeof(${field}), ${field} COLLATE BINARY`).join(',')}`);
  const real = Buffer.allocUnsafe(8);
  let rows = 0;
  try {
    for (const row of statement.iterate(...(where?.values ?? [])) as Iterable<Record<string, unknown>>) {
      hash.update('\nrow\n');
      for (const column of columns) {
        const value = row[column];
        if (value instanceof Uint8Array) { hash.update(`blob:${value.byteLength}:`); hash.update(value); }
        else if (typeof value === 'number') { real.writeDoubleBE(value); hash.update('float64:'); hash.update(real); }
        else {
          const encoded = JSON.stringify([value === null ? 'null' : typeof value, typeof value === 'bigint' ? value.toString() : value]);
          hash.update(`scalar:${Buffer.byteLength(encoded)}:`); hash.update(encoded);
        }
      }
      rows++;
    }
  } finally { statement.finalize(); }
  return { rows, rowsSha256: hash.digest('hex') };
}

export function legacySchemaSha256(db: Database, table: string): string {
  return sha256(JSON.stringify(db.query('SELECT type, name, sql FROM sqlite_schema WHERE tbl_name=? ORDER BY type,name').values(table)));
}
