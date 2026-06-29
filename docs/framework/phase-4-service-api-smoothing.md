# Phase 4: Service API Smoothing

Status: implemented

Phase 4 makes app-owned backend code easier to read by adding conservative
canonical aliases across core services. Existing method names remain supported;
new docs and generated examples should prefer the canonical names where the
resource is obvious.

## Naming Rule

Use these names when they fit the service:

| Name | Meaning |
| --- | --- |
| `create()` | Create or insert one domain object. |
| `get()` | Read one domain object or status row. |
| `list()` | Read many domain objects or status rows. |
| `update()` | Update one domain object. |
| `delete()` | Delete one domain object. |
| `run()` | Execute an operation now. |
| `start()` | Begin a long-lived process. |
| `stop()` | Stop or cancel a long-lived process. |
| `status()` | Inspect runtime/provider/index state. |

Do not force every service into every method. If `create()` would be
ambiguous, group by resource first.

## Backend Services

| Service | Canonical API | Existing API Still Supported |
| --- | --- | --- |
| `zero.db` / `ReactiveDB` | `create(table, row)`, `get(table, id)`, `list(table)`, `update(table, id, partial)`, `delete(table, id)` | `insert()`, `queryOne()`, `query()` |
| `zero.auth.store` / `UserStore` | `create(params)`, `get(userId)`, `list(options?)`, `update(userId, partial)`, `delete(userId)` | `createUser()`, `getUserById()`, `listUsers()`, `updateUser()`, `deleteUser()` |
| `zero.notifications` | `create(params)`, `get(id)`, `list(userId, role)`, `delete(id)` | `broadcast()`, `notify()`, `notifyUsers()`, `notifyRole()`, `getById()`, `getForUser()`, `deleteNotification()` |
| `zero.scheduler` | `create(def)`, `get(name)`, `list()`, `run(name)`, `delete(name)`, `stop()` | `register()`, `getStatus()`, `listJobs()`, `trigger()`, `unregister()`, `stopAll()` |
| `zero.workflows` | `run(name, input?, startedBy?)`, `get(instanceId)`, `list(filter?)`, `stop(instanceId)` | `start()`, `getInstance()`, `listInstances()`, `cancel()` |
| `zero.workflowRegistry` | `create(definition)`, `get(name)`, `list()` | `registerWorkflow()`, `getWorkflow()`, `listWorkflows()` |
| `zero.ai` | `status()`, `getStatus()` | `status()` |
| `zero.vector` | `list()`, `search()`, `get()`, `status()`, `getStatus()` | `listIndexes()`, `query()`, `fetch()`, `stats()` |
| `zero.vector.scope(...)` | `search()`, `get()`, `status()` | `query()`, `fetch()`, `stats()` |
| `Migrator` | `run()`, `rollback()`, `list()` | `status()` |
| `zero.email` | `send()` | No alias needed. |
| `zero.observability` | `emitCode()`, `emitEvent()`, `info()`, `warn()`, `error()` | Existing sink/runtime helpers remain. |

## Storage Grouping

Storage owns multiple resources, so Phase 4 intentionally avoids ambiguous
top-level aliases such as `storage.create()`. Use the grouped APIs:

```ts
const storage = zero.storage;
if (!storage) throw new Error('Storage is not enabled.');

const drive = storage.drives.create(user.userId, { name: 'Reports' });
const folder = storage.objects.createFolder(drive.drive_id, '/q2', user.userId);

const permission = storage.permissions.grant(drive.drive_id, {
  grantType: 'role',
  grantValue: 'manager',
  permission: 'read',
});
```

Existing methods such as `createDrive()`, `getFileInfo()`, `listFolder()`,
`grantPermission()`, and `checkAccess()` remain supported for compatibility.

## Example Endpoint

```ts
import { defineEndpoint, t } from '@zero/framework/server';

export default defineEndpoint({
  method: 'POST',
  path: '/api/customers',
  auth: 'user',
  body: t.Object({
    name: t.String(),
  }),
  handler: ({ body, user, zero }) => {
    return zero.db.create('customers', {
      customer_id: crypto.randomUUID(),
      owner_id: user.userId,
      name: body.name,
      created_at: Date.now(),
    }).row;
  },
});
```

## Compatibility Policy

Phase 4 adds aliases only. It does not remove or rename existing public
methods. Existing applications should continue to compile and run.

Future generated docs and scaffolds should use:

1. `zero.db.create/get/list/update/delete` for app tables.
2. `zero.auth.store?.create/get/list/update/delete` when directly managing
   users from backend code.
3. `zero.vector.search/get/status` for vector reads.
4. `zero.scheduler.create/run/list` for jobs.
5. `zero.workflows.run/get/list/stop` for workflow instances.
6. `zero.storage.drives`, `zero.storage.objects`, and
   `zero.storage.permissions` for backend storage tasks.
