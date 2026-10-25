/** offline-sqlite.ts: verifies explicitly staged offline SQLite copies and hashes table contents without disclosing row values. */
import { Database } from 'bun:sqlite';
import { lstatSync } from 'node:fs';
import { fail, regularFile } from './safety';

export interface TableEvidence {
  table: string;
  rows: number;
  columns: string[];
  schemaSha256: string;
  rowsSha256: string;
}
export interface SQLiteEvidence { schema: 1; kind: 'practiceiq-offline-sqlite'; tables: TableEvidence[] }

/**
 * Open only an existing consolidated file under source/ or candidate/. WAL,
 * SHM and rollback journals are rejected before SQLite can create sidecars.
 * The operator still owns quiescence, consistent backup and data authorization.
 */
export function inspectOfflineSQLite(root: string, path: string, required?: readonly string[]): SQLiteEvidence {
  if (!/^(?:source|candidate)\/.+\.(?:db|sqlite|sqlite3)$/.test(path)) fail('UPGRADE_OFFLINE_COPY_REQUIRED');
  const file = regularFile(root, path);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    let present = false;
    try { lstatSync(`${file}${suffix}`); present = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('UPGRADE_OFFLINE_COPY_INVALID'); }
    if (present) fail('UPGRADE_CONSOLIDATED_COPY_REQUIRED');
  }
  const db = new Database(file, { readonly: true, strict: true, create: false, safeIntegers: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN');
    const integrity = db.query('PRAGMA integrity_check').values();
    if (integrity.length !== 1 || integrity[0]?.[0] !== 'ok') fail('UPGRADE_SQLITE_INTEGRITY_FAILED');
    if (db.query('PRAGMA foreign_key_check').get()) fail('UPGRADE_SQLITE_FOREIGN_KEYS_FAILED');
    const found = db.query<{ name: string; sql: string }, []>("SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all();
    const names = required === undefined ? found.map(table => table.name) : tableNames(required);
    if (!names.length) fail('UPGRADE_TABLE_LIST_REQUIRED');
    const tables: TableEvidence[] = [];
    for (const name of names) {
      const schema = found.find(table => table.name === name);
      if (!schema || /^CREATE\s+VIRTUAL\s+TABLE/i.test(schema.sql)) fail('UPGRADE_TABLE_UNSUPPORTED_OR_MISSING');
      const metadata = db.query<{ name: string }, []>(`PRAGMA table_xinfo(${quote(name)})`).all();
      const columns = metadata.map(column => column.name);
      if (!columns.length) fail('UPGRADE_TABLE_UNSUPPORTED_OR_MISSING');
      const schemaRows = db.query('SELECT type, name, sql FROM sqlite_schema WHERE tbl_name=? ORDER BY type, name').values(name);
      const schemaSha256 = new Bun.CryptoHasher('sha256').update(JSON.stringify(schemaRows)).digest('hex');
      const hash = new Bun.CryptoHasher('sha256').update('zero-offline-typed-rows-v1\n');
      hash.update(JSON.stringify(columns));
      // Type+value ordering keeps duplicates deterministic, even for mixed SQLite types.
      const order = columns.map(column => `typeof(${quote(column)}), ${quote(column)} COLLATE BINARY`).join(', ');
      const statement = db.query<Record<string, unknown>, []>(`SELECT ${columns.map(quote).join(', ')} FROM ${quote(name)} ORDER BY ${order}`);
      let rows = 0;
      for (const row of statement.iterate()) {
        hash.update('\nrow\n');
        for (const column of columns) {
          const value = row[column];
          if (value instanceof Uint8Array) {
            hash.update(`blob:${value.byteLength}:`); hash.update(value);
          } else {
            const encoded = JSON.stringify([value === null ? 'null' : typeof value, typeof value === 'bigint' ? value.toString() : value]);
            hash.update(`scalar:${new TextEncoder().encode(encoded).byteLength}:`); hash.update(encoded);
          }
        }
        rows++;
      }
      tables.push({ table: name, rows, columns, schemaSha256, rowsSha256: hash.digest('hex') });
    }
    db.exec('ROLLBACK');
    return { schema: 1, kind: 'practiceiq-offline-sqlite', tables };
  } finally { db.close(); }
}

/** Reject empty, duplicate or unsafe table selectors rather than guessing a data map. */
export function tableNames(input: readonly string[]): string[] {
  if (!input.length || input.length > 1000 || input.some(name => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
    || new Set(input).size !== input.length) fail('UPGRADE_TABLE_LIST_INVALID');
  return [...input].sort();
}

/** Require explicit unchanged tables to have identical schema, row count and typed value checksums. */
export function compareTables(before: unknown, after: unknown, selected: readonly string[]): void {
  const read = (value: unknown): Map<string, TableEvidence> => {
    const input = value as SQLiteEvidence;
    if (!input || input.schema !== 1 || input.kind !== 'practiceiq-offline-sqlite' || !Array.isArray(input.tables)) fail('UPGRADE_SQLITE_EVIDENCE_INVALID');
    const entries = new Map<string, TableEvidence>();
    for (const table of input.tables) {
      if (!table || typeof table.table !== 'string' || !Number.isSafeInteger(table.rows) || table.rows < 0
        || !Array.isArray(table.columns) || !table.columns.length || table.columns.some(column => typeof column !== 'string')
        || !/^[a-f0-9]{64}$/.test(table.schemaSha256) || !/^[a-f0-9]{64}$/.test(table.rowsSha256)
        || entries.has(table.table)) fail('UPGRADE_SQLITE_EVIDENCE_INVALID');
      entries.set(table.table, table);
    }
    return entries;
  };
  const old = read(before), current = read(after);
  for (const name of tableNames(selected)) {
    const a = old.get(name), b = current.get(name);
    if (!a || !b || a.rows !== b.rows || a.rowsSha256 !== b.rowsSha256 || a.schemaSha256 !== b.schemaSha256
      || JSON.stringify(a.columns) !== JSON.stringify(b.columns)) fail('UPGRADE_PRESERVED_TABLE_CHANGED');
  }
}

function quote(identifier: string): string { return `"${identifier.replaceAll('"', '""')}"`; }
