/** Add only private content ownership/media namespace metadata; posts live exclusively in their Fabric realm. */
import type { Migration } from '../types';
export const migration: Migration = {
  version: '048', description: 'Private Fabric blog owner and Storage namespace', safety: 'safe',
  up(db) {
    const statements = [
      ['_blog_content_owner', 'CREATE TABLE IF NOT EXISTS _blog_content_owner (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,root_hash TEXT NOT NULL,realm_fingerprint TEXT NOT NULL,established INTEGER NOT NULL CHECK(established IN (0,1)))'],
      ['_blog_media_namespace', 'CREATE TABLE IF NOT EXISTS _blog_media_namespace (id INTEGER PRIMARY KEY CHECK(id=1),drive_id TEXT NOT NULL UNIQUE)'],
      ['_blog_media_leases', 'CREATE TABLE IF NOT EXISTS _blog_media_leases (id TEXT PRIMARY KEY,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL)'],
      ['_blog_metrics_key', 'CREATE TABLE IF NOT EXISTS _blog_metrics_key (id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL)'],
    ];
    const normalize = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
    for (const [name, sql] of statements) {
      const row = db.query('SELECT type,sql FROM sqlite_master WHERE name=?').get(name!) as { type: string; sql: string } | null;
      if (row && (row.type !== 'table' || !row.sql || normalize(row.sql) !== normalize(sql!))) throw new Error('Blog content owner schema collision');
    }
    for (const [, sql] of statements) db.exec(sql!);
  },
};
