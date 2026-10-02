/**
 * Client-safe application schema shared by the server and React UI.
 *
 * Physical tenant isolation is intentional here: `tasks` has no `tenant_id`
 * column because the authenticated tenant selects the database file itself.
 */

import { defineTable, field } from '@zero/framework/schema';

export const tasks = defineTable(
  'tasks',
  {
    title: field.text({
      label: 'Task',
      required: true,
      maxLength: 160,
      tableVisible: true,
    }),
    completed: field.boolean({
      label: 'Completed',
      required: true,
      defaultValue: false,
      tableVisible: true,
    }),
    created_at: field.number({
      label: 'Created',
      required: true,
      integer: true,
      tableVisible: true,
      sortable: true,
    }),
  },
  { pk: 'task_id', sync: 'full' },
);

/** App table definitions consumed by createApp() and AppProvider. */
export const tables = { tasks } as const;

/** Exact actor-side schema for every tenant database. */
export const tenantServerTables = { tasks: tasks.serverTable } as const;
