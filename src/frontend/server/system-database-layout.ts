/** Fail-closed compatibility fence for deliberate offline system separation. */

import { DatabaseError } from '../../databases/database-error';
import type { PlatformSQLiteService } from '../../persistence';

export const LEGACY_SYSTEM_TABLE_SENTINELS = Object.freeze([
  '_auth_tenants',
  '_auth_sessions',
  '_auth_config',
  '_auth_api_keys',
  '_credentials',
  '_refresh_tokens',
  '_zero_action_tokens',
  '_zero_resume_tokens',
]);

interface SQLiteSchemaReader {
  query(sql: string): {
    get(...bindings: unknown[]): unknown;
    all(...bindings: unknown[]): unknown[];
  };
}

/** Inspect the schema without changing the database. */
export function hasLegacySystemLayout(database: SQLiteSchemaReader): boolean {
  for (const table of LEGACY_SYSTEM_TABLE_SENTINELS) {
    if (database.query(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    ).get(table)) return true;
  }
  // `users` is a common application-owned table name, especially with auth
  // disabled. It is not authority evidence on its own. Real Guardian layouts
  // include at least one private companion table above; exact ID-only anchor
  // tables are likewise valid application-plane state after the split.
  return false;
}

/**
 * Refuse to serve an old combined layout. Moving authority rows online would
 * create an unsafe partial-cutover window, so the source database is left
 * untouched for the explicit offline apply/verify/rollback workflow.
 */
export function assertApplicationDatabaseHasNoLegacySystemLayout(
  sqlite: PlatformSQLiteService,
): void {
  if (hasLegacySystemLayout(sqlite.raw)) throwLegacyCombinedLayout();
}

function throwLegacyCombinedLayout(): never {
  throw new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Application database contains a legacy combined Zero system layout; an offline system-database split is required before startup.',
    {
      retryable: false,
      outcome: 'not-started',
      details: {
        layout: 'legacy-combined',
        requiredAction: 'split-system-database',
      },
    },
  );
}
