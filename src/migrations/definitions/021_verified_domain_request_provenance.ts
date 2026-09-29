/** Fence verified-domain evidence to the exact retained join-request revision. */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';
import {
  ensureVerifiedDomainJoinRequestProvenanceBinding,
} from './017_verified_domain_schema';

export const migration: Migration = {
  version: '021',
  description: 'Bind verified-domain provenance to join-request revisions',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    ensureVerifiedDomainJoinRequestProvenanceBinding(db as unknown as ReactiveDB);
  },
};
