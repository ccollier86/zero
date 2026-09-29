/** Add the durable authority revision clock used by multi-runtime Sync. */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';
import {
  installAuthAuthorityRevisionV020 as installAuthAuthorityRevision,
} from './020_auth_authority_revision_schema';

export const migration: Migration = {
  version: '020',
  description: 'Add cross-runtime authorization invalidation revision',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    installAuthAuthorityRevision(db as unknown as ReactiveDB);
  },
};
