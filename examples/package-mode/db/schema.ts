/**
 * schema.ts
 *
 * App-owned database schema. This file owns model declarations only; runtime
 * plugin composition remains in zero.config.ts.
 */

// Start empty. Add defineTable() models here as your app grows.
//
// Example:
// import { defineTable, field } from '@zero/framework/schema';
//
// export const tasks = defineTable(
//   'tasks',
//   {
//     title: field.text({ label: 'Title', required: true, tableVisible: true }),
//     created_at: field.number({ label: 'Created At', integer: true }),
//   },
//   { pk: 'task_id', sync: 'auto' }
// );

/**
 * Shared app table definitions.
 *
 * `createApp()` extracts `.serverTable`; `AppProvider` extracts `.clientTable`.
 * Keeping one object avoids server/client schema drift in package-mode apps.
 */
export const tables = {};

/** Raw server tables for lower-level tests or direct sync plugin usage. */
export const serverTables = {};
