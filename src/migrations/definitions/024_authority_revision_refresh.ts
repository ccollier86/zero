/** Immutable trigger replacement primitive for migrations 024 and 025. */

import type { Database } from 'bun:sqlite';

export function replaceAuthorityUpdateTrigger(input: {
  readonly db: Database;
  readonly table: string;
  readonly updateColumns: readonly string[];
  readonly version: number;
}): void {
  const { db, table, updateColumns, version } = input;
  if (!tableExists(db, '_auth_authority_revision') || !tableExists(db, table)) return;
  const safeName = table.replace(/[^A-Za-z0-9_]/g, '_');
  const triggerName = quoteIdentifier(
    `trg_zero_authority_${safeName}_update_v${version}`,
  );
  const updateClause = updateColumns.length > 0
    ? ` OF ${updateColumns.map(quoteIdentifier).join(', ')}`
    : '';
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${triggerName}
    AFTER UPDATE${updateClause} ON ${quoteIdentifier(table)}
    BEGIN
      UPDATE _auth_authority_revision
      SET revision = revision + 1
      WHERE singleton = 1;
    END
  `);
  for (let previous = 1; previous < version; previous += 1) {
    db.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(
      `trg_zero_authority_${safeName}_update_v${previous}`,
    )}`);
  }
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = ? LIMIT 1`).get(table));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
