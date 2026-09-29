/** Repair draft native-auth FKs and add bounded-storage support columns/indexes. */

import type { Database } from 'bun:sqlite';
import {
  createNativeAuthHardeningIndexStatementsV006 as createNativeAuthIndexStatements,
  LEGACY_REGISTRATION_INTENT_TABLE_SQL_V006 as REGISTRATION_INTENT_TABLE_SQL,
  repairNativeAuthSchemaV006 as repairNativeAuthSchema,
} from './006_native_auth_hardening_schema';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '006',
  description: 'Native auth persistence and abuse-control hardening',
  safety: 'guarded',
  backupRequired: true,

  up(db: Database) {
    db.run('PRAGMA foreign_keys = ON');
    repairNativeAuthSchema({
      exec: (sql) => db.exec(sql),
      prepare: (sql) => ({ all: () => db.query(sql).all() }),
    });
    db.run(REGISTRATION_INTENT_TABLE_SQL);
    for (const statement of createNativeAuthIndexStatements()) db.run(statement);
  },
};
