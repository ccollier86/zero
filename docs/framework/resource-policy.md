# Resource Policy Core

Zero resource policy is the framework-independent authorization core for the
resource API. It is available today for server-side code and registered
resource definitions. Generated CRUD routes, `/api/data`, sync mutations, and
doctor checks will reuse this contract in later Phase 5 slices.

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
`created_by = auth.userId`. Generated CRUD and `/api/data` will translate those
constraints in later slices. For `create: 'stamp'`, the decision includes
`stampedInput`, which generated endpoints can write instead of trusting caller
input.

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

This document covers resource definitions and the policy core. Phase 5
follow-up slices will add generated CRUD routes, `/api/data` integration, sync
policy integration, and doctor checks.
