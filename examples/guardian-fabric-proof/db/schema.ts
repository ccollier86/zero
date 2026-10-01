/**
 * Shared application schema for the Guardian + Fabric proof app.
 *
 * There is deliberately no tenant_id column. Fabric derives the tenant from
 * live Guardian authority and selects the physical tenant database instead.
 * The two identity references point at ID-only local anchors maintained from
 * Guardian; neither anchor is an authorization source.
 */

import { defineTable, field } from '@zero/framework/schema';

export const tasks = defineTable(
  'tasks',
  {
    title: field.text({
      label: 'Task',
      required: true,
      minLength: 1,
      maxLength: 200,
      tableVisible: true,
    }),
    status: field.select(
      [
        { label: 'Open', value: 'open' },
        { label: 'Complete', value: 'complete' },
      ],
      { label: 'Status', required: true, tableVisible: true },
    ),
    created_at: field.number({
      label: 'Created at',
      description: 'Server-stamped creation time.',
      integer: true,
      required: true,
      tableVisible: true,
    }),
    created_by_user_id: field.guardianUser({
      label: 'Created by',
      description: 'Server-stamped Guardian user attribution.',
    }),
    assigned_membership_id: field.guardianMembership({
      label: 'Assigned member',
      description: 'Server-stamped active workspace membership.',
    }),
  },
  { pk: 'task_id', sync: 'full' },
);

export const tables = { tasks };

/** Exact physical schema installed in every tenant database. */
export const tenantServerTables = { tasks: tasks.serverTable };
