/** Add the durable authority revision clock used by multi-runtime Sync. */

import type { Database } from 'bun:sqlite';
import { installAuthAuthorityRevision } from '../../auth/auth-authority-revision';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '020',
  description: 'Add cross-runtime authorization invalidation revision',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    installAuthAuthorityRevision(db as unknown as ReactiveDB);
  },
};
