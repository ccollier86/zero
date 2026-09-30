/** Declarative RBAC, credential, field, exposure, and tenant-realm policy. */

import {
  allOf,
  anyOf,
  authorizationPolicy,
  defineResource,
  defineResourceFields,
  tenantKindPolicy,
  tenantRealm,
} from '@zero/framework/server';
import { guardianActorPolicy } from '@zero/framework/resources';

import { tasks } from '../../db/schema';

const readableTaskFields = [
  'task_id',
  'title',
  'status',
  'created_at',
  'created_by_user_id',
  'assigned_membership_id',
] as const;

const taskFields = defineResourceFields({
  read: readableTaskFields,
  create: ['title', 'status', 'created_at'],
  update: ['title', 'status'],
  filter: readableTaskFields,
  sort: readableTaskFields,
});

const customerWorkspace = tenantKindPolicy('organization');
const currentGuardianActor = guardianActorPolicy({
  userField: 'created_by_user_id',
  membershipField: 'assigned_membership_id',
});

const readEveryTask = allOf(
  authorizationPolicy({
    user: 'required',
    tenant: 'required',
    credentials: ['session', 'api-key'],
    permission: 'tasks:read:any',
  }),
  customerWorkspace,
);

const readOwnTasks = allOf(
  authorizationPolicy({
    user: 'required',
    tenant: 'required',
    credentials: ['session', 'api-key'],
    permission: 'tasks:read',
  }),
  customerWorkspace,
  currentGuardianActor,
);

const createOwnTask = allOf(
  authorizationPolicy({
    user: 'required',
    tenant: 'required',
    credentials: ['session', 'api-key'],
    permission: 'tasks:create',
  }),
  customerWorkspace,
  currentGuardianActor,
);

const updateOwnTask = allOf(
  authorizationPolicy({
    user: 'required',
    tenant: 'required',
    credentials: ['session', 'api-key'],
    permission: 'tasks:update:own',
  }),
  customerWorkspace,
  currentGuardianActor,
);

const manageEveryTask = allOf(
  authorizationPolicy({
    user: 'required',
    tenant: 'required',
    credentials: ['session', 'api-key'],
    permission: 'tasks:manage',
  }),
  customerWorkspace,
);

const readTasks = anyOf(readEveryTask, readOwnTasks);
const updateTasks = anyOf(manageEveryTask, updateOwnTask);

export const tasksResource = defineResource({
  table: tasks,
  exposure: 'all',
  realm: tenantRealm(),
  fields: taskFields,
  policy: {
    list: readTasks,
    get: readTasks,
    create: createOwnTask,
    update: updateTasks,
    delete: manageEveryTask,
  },
});

export default tasksResource;
