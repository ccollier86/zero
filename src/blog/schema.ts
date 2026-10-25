/** Fixed SYSTEM author-directory metadata; canonical accounts/roles are never copied. */
import type { ReactiveDB } from '../sync/reactive-db';
export const BLOG_SCHEMA = [
  {
    name: '_blog_policy',
    type: 'table',
    sql: 'CREATE TABLE IF NOT EXISTS _blog_policy (\n  singleton INTEGER PRIMARY KEY CHECK (singleton=1), fingerprint TEXT NOT NULL, generation INTEGER NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740990)\n)',
  },
  {
    name: '_blog_sites',
    type: 'table',
    sql: 'CREATE TABLE IF NOT EXISTS _blog_sites (\n  site_id TEXT PRIMARY KEY, scope_key TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE,\n  name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740990)\n)',
  },
  {
    name: '_blog_authors',
    type: 'table',
    sql: "CREATE TABLE IF NOT EXISTS _blog_authors (\n  author_id TEXT PRIMARY KEY, site_id TEXT NOT NULL, user_id TEXT,\n  status TEXT NOT NULL CHECK (status IN ('active','suspended','revoked')),\n  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740990),\n  slug TEXT NOT NULL, draft_json TEXT NOT NULL CHECK (json_valid(draft_json)),\n  published_slug TEXT, published_json TEXT CHECK (published_json IS NULL OR json_valid(published_json)),\n  updated_at INTEGER NOT NULL CHECK (updated_at>=0),\n  UNIQUE(site_id,user_id), UNIQUE(site_id,slug), UNIQUE(site_id,published_slug),\n  FOREIGN KEY (site_id) REFERENCES _blog_sites(site_id),\n  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL\n)",
  },
  {
    name: 'idx_blog_author_page',
    type: 'index',
    sql: 'CREATE INDEX IF NOT EXISTS idx_blog_author_page ON _blog_authors(site_id,author_id)',
  },
] as const;
export function inspectBlogSchema(
  db: Pick<ReactiveDB, 'prepare'>,
): 'ready' | 'missing' | 'invalid' {
  let missing = false;
  for (const object of BLOG_SCHEMA) {
    const row = db
      .prepare('SELECT type,sql FROM sqlite_master WHERE name=?')
      .get(object.name) as { type: string; sql: string } | null;
    if (!row) {
      missing = true;
      continue;
    }
    if (
      row.type !== object.type ||
      !row.sql ||
      normalizeBlogSql(row.sql) !== normalizeBlogSql(object.sql)
    )
      return 'invalid';
  }
  return missing ? 'missing' : 'ready';
}
export function reconcileBlogSchema(db: ReactiveDB, allowed: boolean) {
  const state = inspectBlogSchema(db);
  if (!allowed || state !== 'missing') return state;
  return db.transaction(() => {
    if (inspectBlogSchema(db) === 'missing')
      for (const object of BLOG_SCHEMA) db.exec(object.sql);
    return inspectBlogSchema(db);
  });
}
export function normalizeBlogSql(sql: string) {
  return sql
    .replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
