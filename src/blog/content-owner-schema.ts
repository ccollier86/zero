/** SYSTEM contains only private Fabric ownership/media namespace receipts, never post bodies. */
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from '../auth/types';
import { normalizeBlogSql } from './schema';
export const BLOG_CONTENT_OWNER_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS _blog_content_owner (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,root_hash TEXT NOT NULL,realm_fingerprint TEXT NOT NULL,established INTEGER NOT NULL CHECK(established IN (0,1)))',
  'CREATE TABLE IF NOT EXISTS _blog_media_namespace (id INTEGER PRIMARY KEY CHECK(id=1),drive_id TEXT NOT NULL UNIQUE)',
  'CREATE TABLE IF NOT EXISTS _blog_media_leases (id TEXT PRIMARY KEY,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS _blog_metrics_key (id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL)',
] as const;
/** Exact read-only admission shared by startup and Doctor; never creates metadata. */
export function inspectBlogContentOwnerSchema(db: Pick<ReactiveDB, 'prepare'>): 'ready' | 'missing' | 'invalid' {
  const names = ['_blog_content_owner', '_blog_media_namespace', '_blog_media_leases', '_blog_metrics_key'];
  let missing = false;
  for (const [i, name] of names.entries()) {
    const row = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(name) as { type: string; sql: string } | null;
    if (!row) missing = true;
    else if (row.type !== 'table' || normalizeBlogSql(row.sql) !== normalizeBlogSql(BLOG_CONTENT_OWNER_SCHEMA[i]!)) return 'invalid';
  }
  return missing ? 'missing' : 'ready';
}
/** Explicit additive installation only; migrate:false may inspect but never provision missing metadata. */
export function installBlogContentOwnerSchema(db: ReactiveDB, allowed: boolean): boolean {
  const state = inspectBlogContentOwnerSchema(db);
  if (state === 'invalid') throw new AuthError('Blog content ownership metadata is incompatible.', 'BLOG_STATE_INVALID', 500);
  if (allowed) for (const statement of BLOG_CONTENT_OWNER_SCHEMA) db.exec(statement);
  return state === 'ready' || allowed;
}
