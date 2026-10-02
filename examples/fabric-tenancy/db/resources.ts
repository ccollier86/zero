/** Declarative Resource and RBAC boundary for the tenant-owned task table. */

import {
  authorizationPolicy,
  defineResource,
  defineResourceFields,
  tenantRealm,
} from '@zero/framework/server';
import { tasks } from './schema';

const canReadTasks = authorizationPolicy({
  tenant: 'required',
  permission: 'tasks:read',
});

const canWriteTasks = authorizationPolicy({
  tenant: 'required',
  permission: 'tasks:write',
});

export const taskResource = defineResource({
  table: tasks,
  exposure: 'all',
  realm: tenantRealm(),
  fields: defineResourceFields({
    read: ['task_id', 'title', 'completed', 'created_at'],
    create: ['title', 'completed', 'created_at'],
    update: ['title', 'completed'],
    filter: ['task_id', 'title', 'completed', 'created_at'],
    sort: ['title', 'completed', 'created_at'],
  }),
  policy: {
    list: canReadTasks,
    get: canReadTasks,
    create: canWriteTasks,
    update: canWriteTasks,
    delete: canWriteTasks,
  },
});

export const resources = [taskResource] as const;
