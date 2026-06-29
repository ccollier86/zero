# Phase 5: Resource And Policy API Plan

Status: planned, slices 1-5 implemented

Phase 5 introduces a high-level resource contract for common data-driven apps.
The goal is to let app code declare tables, actions, and authorization policy
once, then reuse that policy for generated CRUD routes, `/api/data`, sync
mutations, doctor checks, and later frontend resource hooks.

This phase must start with the authorization model. Resource endpoints are only
useful if they are hard to misconfigure.

## Core Resource Shape

```ts
import {
  adminOnly,
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
      adminOnly(),
    ),
    create: ownerPolicy({ userField: 'created_by', create: 'stamp' }),
    update: anyOf(ownerPolicy({ userField: 'created_by' }), adminOnly()),
    delete: adminOnly(),
  },
});
```

Resource API is optional. Raw endpoints, routers, middleware, and direct service
usage remain supported.

## Trusted User Properties

Metadata policies can only use trusted auth user properties.

Current auth config already has typed `userProperties` and `editableBy`.
Phase 5 slice 1 extends that config with a policy trust flag:

```ts
auth: {
  userProperties: {
    department: {
      type: 'enum',
      values: ['accounting', 'support', 'management'],
      editableBy: 'admin',
      useInPolicies: true,
    },
    theme: {
      type: 'enum',
      values: ['light', 'dark'],
      editableBy: 'user',
      useInPolicies: false,
    },
  },
}
```

Rules:

1. `metadataPolicy()` may reference only configured user property keys.
2. The referenced key must have `useInPolicies: true`.
3. `useInPolicies: true` is invalid for `editableBy: 'user'`.
4. `editableBy: 'admin'`, `'system'`, and `'none'` are acceptable trust
   sources when explicitly opted into policies.
5. Public `/auth/config` must not expose admin-only policy metadata.
6. Admin config may expose the flag so admin UI can explain which properties
   are policy-relevant.

This prevents using self-editable preferences such as `theme` or
`notificationsEnabled` as authorization claims.

## Policy Primitives

Initial policy helpers:

```ts
adminOnly()
authenticatedOnly()
publicReadUserWrite()
readOnly()

ownerPolicy({
  userField: 'owner_id',
  create: 'stamp' | 'require' | 'forbid',
})

metadataPolicy({
  department: ['accounting', 'management'],
})

anyOf(policyA, policyB)
allOf(policyA, policyB)
customPolicy(async (ctx) => boolean | PolicyDecision)
```

Owner policy behavior:

1. `list`: produce a row constraint when possible, such as
   `owner_id = auth.userId`.
2. `get/update/delete`: load the row, then evaluate `row[userField]`.
3. `create: 'stamp'`: set `input[userField] = auth.userId`.
4. `create: 'require'`: require caller input to match `auth.userId`.
5. `create: 'forbid'`: deny creates under this policy.

Default should be `create: 'stamp'` for safer generated endpoints.

Metadata policy behavior:

1. Evaluate against `auth.user.properties`.
2. Validate every referenced key against trusted auth property config before
   endpoints or policies are registered.
3. Does not automatically scope row queries unless a future row-column mapping
   is declared.

Admin overrides should be explicit. `ownerPolicy()` should not silently grant
admin access unless wrapped with `anyOf(ownerPolicy(...), adminOnly())`.

## Evaluator Context

Resource policy evaluation should be framework-independent and unit-testable:

```ts
type ResourceAction = 'list' | 'get' | 'create' | 'update' | 'delete';

type ResourcePolicyContext = {
  action: ResourceAction;
  user: {
    userId: string;
    role: string;
    properties: Record<string, string>;
  } | null;
  resource: ResourceDefinition;
  row?: Record<string, unknown>;
  input?: Record<string, unknown>;
  authConfig: {
    userProperties: Record<string, ResolvedUserPropertyFieldConfig>;
  };
};
```

The evaluator should return a structured decision:

```ts
type PolicyDecision = {
  allowed: boolean;
  reason?: string;
  constraints?: DataConstraint[];
  stampedInput?: Record<string, unknown>;
};
```

Reasons should be stable enough for doctor/tests but not leak sensitive row
details to clients.

## Systems That Need Changes

### Auth Config

Files likely involved:

1. `src/auth/types.ts`
2. `src/auth/auth-config.ts`
3. `src/auth/auth.plugin.ts`
4. `src/auth/auth-admin.plugin.ts`
5. Auth config docs/tests

Changes:

1. Done: add `useInPolicies?: boolean` to authored user property config.
2. Done: add `useInPolicies: boolean` to resolved config.
3. Done: normalize default to `false`.
4. Done: reject `useInPolicies: true` when `editableBy: 'user'`.
5. Done: keep public config exposing only user-editable fields; do not leak
   policy-only metadata to public clients.

### Existing Middleware Policy

Middleware property matchers currently use configured user properties. Phase 5
should align them with the trusted-property rule so route middleware and
resource policy use the same security model.

Implementation options:

1. Strict implementation: require `useInPolicies: true` for middleware property
   matchers too.
2. Compatibility implementation: warn through doctor first, then enforce in
   strict mode.

Preferred: enforce for new resource policies immediately; update middleware
policy with a migration-friendly warning/strict path if needed.

### Resource Registry And Definitions

New focused files should own:

1. Resource definition types.
2. Policy helper constructors.
3. Policy validation.
4. Policy evaluation.
5. Resource registry/load integration.

Keep route generation separate from policy evaluation.

### CRUD Route Generation

Implemented in slice 4. Generated CRUD is mounted by default at
`/api/resources/:resource` and `/api/resources/:resource/:id`, and can be
disabled with `resourceRoutes: false` or customized with
`resourceRoutes: { prefix, defaultLimit, maxLimit }`.

Generated CRUD should compile to Zero endpoint/router primitives and Elysia
validation:

1. Done: `list` validates pagination/filter/sort input, applies policy
   constraints, and runs parameterized SQL.
2. Done: `get` loads by primary key, then evaluates policy with row.
3. Done: `create` validates input, applies create policy/stamping, writes through
   `zero.db.create()`.
4. Done: `update` loads existing row, evaluates policy, strips primary key
   changes, and writes through `zero.db.update()`.
5. Done: `delete` loads existing row, evaluates policy, and writes through
   `zero.db.delete()`.
6. Done: metadata policies hydrate trusted user properties from the auth store.
7. Done: generated route writes flow through ReactiveDB change emission.

### `/api/data`

Resource policy should be able to protect generic data reads:

Implemented in slice 5 for lazy list reads:

1. Done: unknown/unregistered tables keep existing sync read policy behavior.
2. Done: registered resources evaluate `list` policy and add safe read
   constraints to SQL.
3. Done: policy constraints are ANDed with caller filters and sort/pagination
   validation stays schema-backed.
4. Done: metadata policies hydrate trusted auth user properties through the auth
   store when auth is enabled.
5. Done: registered resources without `list` fail closed.
6. Later: `get`-style data access should evaluate row policy after loading if a
   generic point-read data endpoint is added.
7. Later: doctor should warn when a registered resource cannot safely apply its
   list policy to `/api/data`.

### Sync Policy

Resource policy should compose with the existing sync policy:

Implemented in slice 6:

1. Done: read/subscription policy uses resource table registration after the
   existing sync read policy.
2. Done: unconstrained resource `list` policies remain sync-safe for full-table
   snapshots, catchup, and live broadcasts.
3. Done: row-constrained resource `list` policies become per-connection row
   filters for snapshots, catchup, and live changes.
4. Done: direct sync `INSERT`/`UPDATE`/`DELETE` maps to resource
   `create`/`update`/`delete` policies.
5. Done: owner `create: 'stamp'` is applied server-side before direct sync
   inserts write to ReactiveDB.
6. Done: update/delete load the existing row before evaluating row-level
   resource policy.
7. Done: platform protected tables remain protected by default.
8. Done: updates that move a row out of a user's filter are projected as
   `DELETE` changes so local stores do not retain stale rows.

### Doctor

Doctor should check:

1. Resource table exists.
2. Primary key matches schema.
3. Owner field exists.
4. Metadata policy keys exist in `auth.userProperties`.
5. Metadata policy keys have `useInPolicies: true`.
6. No policy key is self-editable.
7. Public write/delete policies are explicit.
8. Owner/list constraints have useful indexes.
9. `/api/data` and sync behavior is clear for each resource.

## Implementation Slices

1. **Trusted User Property Contract**
   Implemented. Added `useInPolicies`, normalization, validation, docs, and
   tests.

2. **Resource Policy Core**
   Implemented. Added policy helper types, constructors, trusted metadata
   validation, owner constraints/stamping, any/all composition, custom policy
   fail-closed behavior, public exports, and evaluator unit tests.

3. **Resource Definition And Registry**
   Implemented. Added `defineResource()`, inline `createApp({ resources })`,
   `server/resources` discovery, process resource registry, `zero.resources`,
   and registration-time validation for table/pk/action/policy issues.

4. **CRUD Generation**
   Implemented. Added generated `/api/resources` CRUD routes, list
   filter/sort/pagination, policy constraint SQL translation, create stamping,
   primary-key-safe updates, ReactiveDB writes, route config, public exports,
   and createApp integration tests.

5. **`/api/data` Integration**
   Implemented for lazy list reads. Added resource list policy evaluation to
   `/api/data`, owner constraint SQL translation, metadata policy hydration,
   no-list fail-closed behavior, and focused data-query tests.

6. **Sync Policy Integration**
   Implemented. Composes resource policy with WebSocket read and mutation
   policy. Row-constrained resources use per-connection row-filtered sync, and
   direct sync creates apply owner stamping.

7. **Doctor And Docs**
   Add resource/policy doctor checks and update Start Here, framework docs,
   auth docs, data API docs, and sync docs.

## Acceptance Criteria

1. Resource API is optional and does not break raw endpoints.
2. Policy evaluation is server-side and framework-independent.
3. Metadata policy cannot use unknown or self-editable user properties.
4. Owner policy supports query constraints and safe create stamping.
5. Generated CRUD routes enforce policy for every action.
6. `/api/data` and sync understand registered resource policy or fail closed
   when policy cannot be safely applied.
7. Doctor explains unsafe resource policy config and can fail in strict mode.
8. Tests cover auth property trust, policy evaluator decisions, generated CRUD,
   `/api/data`, sync mutation decisions, and doctor warnings.
