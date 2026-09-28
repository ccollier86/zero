/** Persist and invalidate the exact installed auth capability profile. */

import type { Database } from 'bun:sqlite';
import { installAuthAuthorityRevision } from '../../auth/auth-authority-revision';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '023',
  description: 'Persist installed authentication profile identity',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    // Frozen v023 table contract. Runtime schema helpers may evolve without
    // silently changing this historical migration's behavior or checksum.
    db.exec(`
      CREATE TABLE IF NOT EXISTS _auth_installed_profile (
        singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
        version        INTEGER NOT NULL CHECK (version = 1),
        generation     INTEGER NOT NULL CHECK (generation >= 1),
        tenancy        TEXT NOT NULL CHECK (tenancy IN ('single', 'multi')),
        authorization  TEXT NOT NULL CHECK (authorization IN ('simple', 'advanced')),
        updated_at     INTEGER NOT NULL CHECK (updated_at >= 0)
      )
    `);
    const reactive = db as unknown as ReactiveDB;
    // Migration 020 predates this authority-bearing table. Re-running the
    // idempotent installer adds its insert/update/delete triggers immediately.
    installAuthAuthorityRevision(reactive);
  },
};
