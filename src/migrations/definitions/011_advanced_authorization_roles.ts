/** Add the frozen v011 advanced-role assignments and owner guards. */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';
import {
  defineAuthTenancyTablesV009 as defineTenancyTables,
} from './009_auth_tenancy_schema';
import {
  defineAuthorizationRoleTablesV011 as defineAuthorizationRoleTables,
} from './011_advanced_authorization_schema';

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
