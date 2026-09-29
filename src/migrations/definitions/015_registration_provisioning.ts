/** Add crash-safe registration provisioning and exact owner rollback guards. */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';
import {
  defineAuthorizationRoleTablesV011 as defineAuthorizationRoleTables,
} from './011_advanced_authorization_schema';
import {
  defineRegistrationIntentTableV015 as defineRegistrationIntentTable,
  defineRegistrationProvisioningTableV015 as defineRegistrationProvisioningTable,
} from './015_registration_provisioning_schema';

export const migration: Migration = {
  version: '015',
  description: 'Crash-safe registration provisioning and protected-owner rollback',
  safety: 'safe',

  up(db: Database) {
    defineRegistrationIntentTable(db as unknown as ReactiveDB);
    defineRegistrationProvisioningTable(db as unknown as ReactiveDB);
    // Runtime schema setup repairs the same exact triggers. Calling the shared
    // definition here also upgrades databases which run migrations offline.
    defineAuthorizationRoleTables(db as unknown as ReactiveDB);
  },
};
