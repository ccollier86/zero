/** Runtime compatibility repair for framework tables created before tenancy. */

import type { ReactiveDB } from '../sync/reactive-db';

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Add a nullable tenant discriminator when an older framework table already
 * exists. Fresh tables receive the column through their normal definition;
 * managed apps also run the versioned migration before plugin composition.
 */
export function ensureNullableTenantColumn(
  db: ReactiveDB,
  table: string,
): void {
  if (!SAFE_IDENTIFIER.test(table)) {
    throw new Error(`Unsafe framework table identifier: ${table}`);
  }
  const exists = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table);
  if (!exists) return;

  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === 'tenant_id')) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT`);
}
