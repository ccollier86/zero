/** Additive attachment I/O ownership only. Preserve all prior migrations and private Storage identities. */
import type { Migration } from '../types';
export const migration: Migration = { version: '050', description: 'Messaging private attachment I/O leases', safety: 'safe', up(db) {
  const sql = 'CREATE TABLE IF NOT EXISTS _messaging_blob_leases (id TEXT PRIMARY KEY,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL)';
  const prior = db.query('SELECT type,sql FROM sqlite_master WHERE name=?').get('_messaging_blob_leases') as { type: string; sql: string } | null;
  const normalize = (s: string) => s.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
  if (prior && (prior.type !== 'table' || !prior.sql || normalize(prior.sql) !== normalize(sql))) throw new Error('Messaging attachment lease schema collision');
  db.exec(sql);
} };
