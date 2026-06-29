# Resource Policy Core

Zero resource policy is the framework-independent authorization core for the
resource API. It is available today for server-side code and registered
resource definitions. Generated CRUD routes use this contract today; `/api/data`,
sync mutations, and doctor checks will reuse it in later Phase 5 slices.

Import from the server surface:

```ts
import {
  adminOnly,
  allOf,
  anyOf,
  defineResource,
  evaluateResourcePolicy,
  getResourceRegistry,
  metadataPolicy,
  ownerPolicy,
  validateResourcePolicy,
} from '@zero/framework/server';
```

Or from the focused subpath:

```ts
import { defineResource, ownerPolicy } from '@zero/framework/resources';
```

## Resource Definitions

Declare app-owned resources inline in `zero.config.ts` or in conventional
`server/resources` modules:

```ts
// server/resources/tickets.ts
import {
  adminOnly,
  anyOf,
  defineResource,
  metadataPolicy,
  ownerPolicy,
} from '@zero/framework/server';

export default defineResource({
  table: 'tickets',
  primaryKey: 'ticket_id',
  actions: ['list', 'get', 'create', 'update', 'delete'],
  policy: {
    list: metadataPolicy({ department: ['support', 'management'] }),
    get: anyOf(
      ownerPolicy({ userField: 'created_by' }),
      metadataPolicy({ department: ['support', 'management'] }),
      adminOnly()
    ),
    create: ownerPolicy({ userField: 'created_by', create: 'stamp' }),
    update: anyOf(ownerPolicy({ userField: 'created_by' }), adminOnly()),
    delete: adminOnly(),
  },
});
```

`createApp()` loads `server/resources` by default and also accepts inline
definitions:

```ts
createApp({
  db: { mode: 'memory' },
  tables,
  resources: [
    defineResource({
      table: 'tickets',
      policy: ownerPolicy({ userField: 'created_by' }),
    }),
  ],
});
```

Resource modules may export `default`, `resource`, or `resources`.
Set `serverResourcesDir: false` to disable filesystem discovery.

Registration validates:

- resource names and backing tables are unique;
- the table exists in `createApp({ tables })`;
- the configured or inferred primary key matches the table schema;
- every declared action has a policy;
- nested policy validation passes, including trusted metadata checks.

Read registered resources from server code:

```ts
const tickets = getResourceRegistry().getByTable('tickets');
```

App-owned route handlers can also use `zero.resources`.

## Generated CRUD Routes

When `createApp()` has registered resources, Zero mounts generated CRUD routes
by default:

| Action | Method and path |
| --- | --- |
| `list` | `GET /api/resources/:resource` |
| `get` | `GET /api/resources/:resource/:id` |
| `create` | `POST /api/resources/:resource` |
| `update` | `PATCH /api/resources/:resource/:id` |
| `delete` | `DELETE /api/resources/:resource/:id` |

The `:resource` segment is the resource name. It defaults to the backing table
name unless `defineResource({ name })` is provided.

Disable generated routes when a resource should only feed custom routes,
`/api/data` policy, or future sync policy integration:

```ts
createApp({
  db: { mode: 'memory' },
  tables,
  resources,
  resourceRoutes: false,
});
```

Or customize route behavior:

```ts
createApp({
  db: { mode: 'memory' },
  tables,
  resources,
  resourceRoutes: {
    prefix: '/api/domain',
    defaultLimit: 50,
    maxLimit: 500,
  },
});
```

Generated list routes support the same practical query controls as lazy data
reads:

```txt
GET /api/resources/tickets?filter=status:open&order=created_at&dir=desc&limit=50&offset=0
GET /api/resources/tickets?filter=priority:gte:3&filter=status:in:open,pending
```

Supported filter operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`,
`contains`, and `in`. Column names are validated against the table schema and
values are parameterized.

CRUD policy behavior:

- `list` evaluates the resource list policy, then translates returned
  constraints such as `owner_id = user.userId` into SQL.
- `get`, `update`, and `delete` load the row first, then evaluate row-level
  policy.
- `create` evaluates create policy before writing. `ownerPolicy()` defaults to
  `create: 'stamp'`, so caller-provided owner fields are overwritten with the
  authenticated user id.
- `update` strips primary key changes before writing.
- writes go through ReactiveDB, so generated route mutations still emit normal
  sync/change events.
- `metadataPolicy()` hydrates trusted user properties from the auth user store
  when auth is enabled.

## `/api/data` Integration

Resolved lazy tables are still queried through `GET /api/data`, and unregistered
tables keep the existing sync read policy behavior. When a lazy table is also a
registered resource, `/api/data` evaluates the resource `list` policy after the
sync read policy and before SQL execution.

For registered resources:

- a missing or unsupported `list` action fails closed;
- denied resource policy returns the policy status/message;
- `ownerPolicy()` list constraints are translated into SQL and ANDed with
  caller filters;
- `anyOf(ownerPolicy(...), adminOnly())` lets admins read all rows while owners
  only read their rows;
- `metadataPolicy()` hydrates trusted user properties from the auth user store;
- unsafe or unknown constraint columns fail closed instead of running a broad
  query.

Example:

```txt
GET /api/data?table=tickets&filter=status:open&order=created_at&dir=desc
```

If `tickets` is registered with `ownerPolicy({ userField: 'created_by' })`, the
effective SQL filters include both `status = 'open'` and
`created_by = auth.userId`.

## Trusted Metadata

`metadataPolicy()` may only use configured auth user properties that opt into
policy use:

```ts
auth: {
  userProperties: {
    department: {
      type: 'enum',
      values: ['support', 'management'],
      editableBy: 'admin',
      useInPolicies: true,
    },
    theme: {
      type: 'enum',
      values: ['light', 'dark'],
      editableBy: 'user',
    },
  },
}
```

The policy core rejects unknown keys and keys without `useInPolicies: true`.
Auth config also rejects `useInPolicies: true` on self-editable user fields, so
preferences such as `theme` cannot become trusted authorization claims.

## Policy Helpers

```ts
const policy = anyOf(
  ownerPolicy({ userField: 'created_by', create: 'stamp' }),
  allOf(
    metadataPolicy({ department: ['support', 'management'] }),
    adminOnly()
  )
);
```

Available helpers:

- `adminOnly()`: requires authenticated `role === 'admin'`.
- `authenticatedOnly()`: requires any authenticated user.
- `readOnly()`: allows public `list` and `get`, denies writes.
- `publicReadUserWrite()`: allows public reads, requires auth for writes.
- `ownerPolicy({ userField, create })`: checks row ownership, returns list
  constraints, and defaults creates to `create: 'stamp'`.
- `metadataPolicy(requirements)`: checks trusted auth user properties.
- `anyOf(...policies)`: OR composition with constraint preservation.
- `allOf(...policies)`: AND composition with constraint and stamp merging.
- `customPolicy(fn)`: callback escape hatch; thrown errors fail closed and flow
  through Zero observability.

## Evaluation

```ts
const decision = await evaluateResourcePolicy(policy, {
  action: 'update',
  user: {
    userId: auth.userId,
    role: auth.role,
    properties: userProperties,
  },
  resource: {
    table: 'tickets',
    primaryKey: 'ticket_id',
  },
  row: ticketRow,
  input: updateInput,
  authConfig: resolvedAuthConfig,
});

if (!decision.allowed) {
  throw new Error(decision.reason ?? 'forbidden');
}
```

Decisions are structured:

```ts
type ResourcePolicyDecision = {
  allowed: boolean;
  reason?: string;
  status?: number;
  constraints?: ResourceDataConstraint[];
  stampedInput?: Record<string, unknown>;
};
```

`ownerPolicy()` returns a field equality constraint for `list`, for example
`created_by = auth.userId`. Generated CRUD and `/api/data` translate those
constraints today; sync integrations will reuse the same decision shape later. For
`create: 'stamp'`, the decision includes `stampedInput`, which generated
endpoints write instead of trusting caller input.

## Validation

Validate policies before registration:

```ts
const issues = validateResourcePolicy(policy, {
  authConfig: resolvedAuthConfig,
});

if (issues.length > 0) {
  throw new Error(issues[0].message);
}
```

Validation currently checks:

- metadata keys exist in `auth.userProperties`;
- metadata keys have `useInPolicies: true`;
- owner policy has a non-empty `userField`;
- `anyOf()` and `allOf()` have at least one child policy.

## Current Limits

This document covers resource definitions, generated CRUD routes, `/api/data`
read integration, and the policy core. Phase 5 follow-up slices will add sync
policy integration and doctor checks.
