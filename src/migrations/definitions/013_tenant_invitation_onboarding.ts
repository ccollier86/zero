/** Add durable tenant invitations and retained join requests. */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';
import {
  defineAuthTenantOnboardingTablesV013 as defineAuthTenantOnboardingTables,
} from './013_tenant_onboarding_schema';

export const migration: Migration = {
  version: '013',
  description: 'Tenant invitations and retained join-request onboarding',
  safety: 'safe',

  up(db: Database) {
    defineAuthTenantOnboardingTables(db as unknown as ReactiveDB);
  },
};
