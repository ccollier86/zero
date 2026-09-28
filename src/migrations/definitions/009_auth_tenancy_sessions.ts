/**
 * Add the durable tenant control plane and browser authorization-session boundary.
 *
 * The runtime schema helpers are deliberately reused here so fresh databases,
 * upgraded databases, and compatibility startup all enforce the same columns,
 * checks, and indexes. Existing refresh rows remain unbound (`session_id` is
 * nullable); single-tenant runtime may adopt them for their remaining lifetime,
 * while multi-tenant runtime fails them closed until an explicit scope is chosen.
 */

import type { Database } from 'bun:sqlite';
import {
  defineAuthSessionContinuationTables,
} from '../../auth/auth-session-continuation-schema';
import { defineAuthSessionTables } from '../../auth/auth-session-schema';
import { defineTenancyTables } from '../../auth/tenancy/tenancy-schema';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '009',
  description: 'Tenant control plane and durable browser auth sessions',
  safety: 'safe',

  up(db: Database) {
    // These schema helpers use only the SQLite-compatible exec/prepare/
    // transaction surface. Keeping the one narrow adapter here avoids a second
    // hand-copied schema that could drift from AuthRuntime startup.
    const schemaDb = db as unknown as ReactiveDB;
    defineTenancyTables(schemaDb, { registrationProvisioning: false });
    defineAuthSessionTables(schemaDb);
    defineAuthSessionContinuationTables(schemaDb);
  },
};
