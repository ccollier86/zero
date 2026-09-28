/** Add durable tenant invitations and retained join requests. */

import type { Database } from 'bun:sqlite';
import { defineAuthTenantOnboardingTables } from '../../auth/auth-tenant-onboarding-schema';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '013',
  description: 'Tenant invitations and retained join-request onboarding',
  safety: 'safe',

  up(db: Database) {
    defineAuthTenantOnboardingTables(db as unknown as ReactiveDB);
  },
};
