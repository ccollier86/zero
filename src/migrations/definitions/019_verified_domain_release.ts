/** Preserve domain history while allowing an explicitly released name to be reclaimed. */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';
import { defineVerifiedDomainReleaseTables } from './017_verified_domain_schema';

export const migration: Migration = {
  version: '019',
  description: 'Add quarantined verified-domain claim release lifecycle',
  // SQLite cannot remove an inline UNIQUE constraint in place. The upgrade is
  // transactional and parity-tested, but it rebuilds the claim graph, so a
  // file-backed production database must have the migrator's verified backup.
  safety: 'guarded',
  backupRequired: true,

  up(db: Database) {
    defineVerifiedDomainReleaseTables(db as unknown as ReactiveDB);
  },
};
