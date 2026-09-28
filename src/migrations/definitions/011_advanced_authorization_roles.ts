/** Add durable advanced-role assignments, revisions, and owner lifecycle guards. */

import type { Database } from 'bun:sqlite';
import { defineAuthorizationRoleTables } from '../../auth/authorization-role-schema';
import { defineTenancyTables } from '../../auth/tenancy/tenancy-schema';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '011',
  description: 'Advanced authorization role assignments and owner guards',
  safety: 'safe',

  up(db: Database) {
    const schemaDb = db as unknown as ReactiveDB;
    // Re-run the additive tenancy helper so upgraded installs receive the
    // global-account last-owner triggers introduced with this migration.
    defineTenancyTables(schemaDb, { registrationProvisioning: false });
    // Registration provisioning receipts are introduced by migration 015.
    // Keep this historical schema self-contained so owner mutations at an 011
    // migration target never reference a table which does not exist yet.
    defineAuthorizationRoleTables(schemaDb, { registrationProvisioning: false });
  },
};
