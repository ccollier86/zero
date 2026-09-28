/** Add crash-safe registration provisioning and exact owner rollback guards. */

import type { Database } from 'bun:sqlite';
import { defineAuthorizationRoleTables } from '../../auth/authorization-role-schema';
import { defineRegistrationProvisioningTable } from '../../auth/registration-provisioning-schema';
import { defineRegistrationIntentTable } from '../../auth/registration-intent-schema';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';

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
