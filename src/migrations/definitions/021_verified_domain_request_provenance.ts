/** Fence verified-domain evidence to the exact retained join-request revision. */

import type { Database } from 'bun:sqlite';
import { ensureVerifiedDomainJoinRequestProvenanceBinding } from '../../auth/verified-domain-schema';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '021',
  description: 'Bind verified-domain provenance to join-request revisions',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    ensureVerifiedDomainJoinRequestProvenanceBinding(db as unknown as ReactiveDB);
  },
};
