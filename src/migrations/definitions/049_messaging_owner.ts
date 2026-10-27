/** Add private ownership/Storage namespace receipts only. Existing identities, migrations and app tables are untouched. */
import type { Migration } from '../types';
export const migration: Migration = { version: '049', description: 'Private scoped Fabric messaging ownership', safety: 'safe', up(db) {
  const statements = [
    ['_messaging_owners', 'CREATE TABLE IF NOT EXISTS _messaging_owners (id TEXT PRIMARY KEY,scope_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,root_hash TEXT NOT NULL,realm_fingerprint TEXT NOT NULL,established INTEGER NOT NULL CHECK(established IN (0,1)))'],
    ['_messaging_storage', 'CREATE TABLE IF NOT EXISTS _messaging_storage (id INTEGER PRIMARY KEY CHECK(id=1),drive_id TEXT NOT NULL UNIQUE)'],
  ];
  const normalize = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
  for (const [name, sql] of statements) {
    const row = db.query('SELECT type,sql FROM sqlite_master WHERE name=?').get(name!) as { type: string; sql: string } | null;
    if (row && (row.type !== 'table' || !row.sql || normalize(row.sql) !== normalize(sql!))) throw new Error('Messaging ownership schema collision');
  }
  for (const [, sql] of statements) db.exec(sql!);
} };
