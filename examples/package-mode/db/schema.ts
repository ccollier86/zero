/**
 * schema.ts
 *
 * App-owned database schema for the package-mode fixture. This file owns model
 * declarations only; runtime plugin composition remains in zero.config.ts.
 */

import { defineTable, field } from '@zero/framework/schema';

export const customers = defineTable(
  'customers',
  {
    name: field.text({ label: 'Name', required: true, tableVisible: true }),
    owner_id: field.text({ label: 'Owner', tableVisible: false }),
    created_at: field.number({ label: 'Created At', integer: true, tableVisible: true }),
  },
  {
    pk: 'customer_id',
    sync: 'auto',
  }
);

/**
 * Shared app table definitions.
 *
 * `createApp()` extracts `.serverTable`; `AppProvider` extracts `.clientTable`.
 * Keeping one object avoids server/client schema drift in package-mode apps.
 */
export const tables = {
  customers,
};

/** Raw server tables for lower-level tests or direct sync plugin usage. */
export const serverTables = {
  customers: customers.serverTable,
};
