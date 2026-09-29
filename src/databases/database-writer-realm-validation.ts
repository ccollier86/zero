/** Physical runtime-to-realm schema compatibility validation. */

import { quoteSqlIdentifier } from '../sync/identity';
import {
  databaseDeclaredTypeAffinity,
  isSupportedDatabaseRowIdentityAffinity,
} from '../sync/row-identity';
import { DatabaseError } from './database-error';
import type { DatabaseOperationCatalog } from './database-operations';
import type { DatabaseRealm } from './database-realm';
import { isPortableDatabaseRealmValueAffinity } from './database-realm-schema-admission';
import type { DatabaseRuntime } from './database-runtime';

export function assertDatabaseWriterRealmMatchesRuntime(
  runtime: DatabaseRuntime,
  realm: DatabaseRealm,
  catalog: DatabaseOperationCatalog,
): void {
  for (const [table, schema] of Object.entries(realm.tables)) {
    try {
      if (!runtime.db.hasTable(table)) throw new Error('missing table');
      const expectedColumns = Object.keys(schema).filter(
        (name) => name !== '_identity',
      );
      const actualColumns = runtime.db.getColumns(table);
      const expectedPrimaryKey = catalog.primaryKeys?.[table];
      const columnInfo = runtime.db.prepare(
        `PRAGMA main.table_xinfo(${quoteSqlIdentifier(table)})`,
      );
      let physicalColumns: Array<{ name: string; type: string; hidden: number }>;
      try {
        physicalColumns = columnInfo.all() as typeof physicalColumns;
      } finally {
        columnInfo.finalize();
      }
      if (expectedColumns.length !== actualColumns.length
        || expectedColumns.some((column, index) => column !== actualColumns[index])
        || !expectedPrimaryKey
        || runtime.db.getPrimaryKey(table) !== expectedPrimaryKey
        || physicalColumns.length !== expectedColumns.length
        || physicalColumns.some((column) => column.hidden !== 0
          || !isPortableDatabaseRealmValueAffinity(
            databaseDeclaredTypeAffinity(column.type),
          )
          || (column.name === expectedPrimaryKey
            && !isSupportedDatabaseRowIdentityAffinity(
              databaseDeclaredTypeAffinity(column.type),
            )))) {
        throw new Error('table contract differs');
      }
    } catch (cause) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database runtime does not match its realm schema.',
        { cause },
      );
    }
  }
}
