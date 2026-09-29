/**
 * Canonical keyset-list SQL shared by writer fallbacks and WAL readers.
 *
 * Explicit BINARY collation keeps pagination stable even when an application
 * declares a different collation on its textual primary key. Both execution
 * lanes must use the same ordering and cursor comparison contract.
 */

import { quoteSqlIdentifier } from '../sync/identity';

export function createDatabaseListQuerySql(
  table: string,
  primaryKey: string,
  hasCursor: boolean,
): string {
  const tableSql = quoteSqlIdentifier(table);
  const primaryKeySql = quoteSqlIdentifier(primaryKey);
  return `SELECT * FROM main.${tableSql} `
    + (hasCursor ? `WHERE ${primaryKeySql} COLLATE BINARY > ? ` : '')
    + `ORDER BY ${primaryKeySql} COLLATE BINARY ASC LIMIT ?`;
}
