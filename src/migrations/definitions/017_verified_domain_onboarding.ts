/** Add exact verified-company-domain request onboarding persistence. */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';
import { defineVerifiedDomainTables } from './017_verified_domain_schema';

export const migration: Migration = {
  version: '017',
  description: 'Add verified company-domain request onboarding',
  safety: 'safe',

  up(db: Database) {
    defineVerifiedDomainTables(db as unknown as ReactiveDB);
  },
};
