/** Repair draft native-auth FKs and add bounded-storage support columns/indexes. */

import type { Database } from 'bun:sqlite';
import { repairNativeAuthSchema } from '../../auth/oidc/native-auth-schema-repair';
import { createNativeAuthIndexStatements } from '../../auth/oidc/native-auth-schema-sql';
import { REGISTRATION_INTENT_TABLE_SQL } from '../../auth/registration-intent-schema';
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
