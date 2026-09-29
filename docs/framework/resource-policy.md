# Resource Policy Core

Zero resource policy is the framework-independent authorization core for the
resource API. It is available today for server-side code and registered
resource definitions. Generated CRUD routes, `/api/data`, and WebSocket sync
reads/mutations all enforce registered resource policy. Platform doctor checks
reuse the same contract for static validation and safety guidance.

Import from the server surface:

```ts
import {
  adminOnly,
  allOf,
  anyOf,
  authorizationPolicy,
  defineResource,
  evaluateResourcePolicy,
  getPolicyOwnerFields,
  getResourceRegistry,
  globalRealm,
  metadataPolicy,
  ownerPolicy,
  tenantRealm,
  requiresAuthenticatedUser,
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
  exposure: 'all',
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
      exposure: 'all',
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
- policy-map keys name declared actions, so a typo or disabled action cannot
  leave an unused policy declaration;
- nested policy validation passes, including trusted metadata checks;
- multi-mode resources declare a valid client exposure and data realm;
- `authorizationPolicy()` requirements reference only roles, permissions, and
  policy-trusted properties declared by the active app authorization registry.

Omitting `actions` preserves the existing default of all five actions. An
explicit `actions: []` means none. This is useful for an internal resource that
exists only to classify a managed table; it does not silently expand to all
actions. A per-action `policy` map may contain only keys listed in `actions`.

### Reuse route RBAC directly

`authorizationPolicy()` accepts the same `AccessRequirement` used by Elysia
endpoints, file-router pages, middleware, and `context.access`:

```ts
export default defineResource({
  table: tickets,
  exposure: 'all',
  realm: tenantRealm(),
  policy: {
    list: authorizationPolicy({
      tenant: 'required',
      permission: 'tickets:read',
    }),
    get: authorizationPolicy({
      tenant: 'required',
      permission: 'tickets:read',
    }),
    create: authorizationPolicy({
      tenant: 'required',
      permission: 'tickets:write',
    }),
    update: authorizationPolicy({
      tenant: 'required',
      permission: 'tickets:write',
    }),
    delete: authorizationPolicy({
      tenant: 'required',
      permission: 'tickets:delete',
    }),
  },
});
```

The requirement is compiled against the app's server-only permission and role
ceiling during resource registration. At runtime Zero projects the live
browser/native session, tenant membership, and additive advanced assignments
through the app-local `AuthorizationKernel`. No tenant, role, or permission is
accepted from the request body, query, resource row, or browser claim.

This works in all four `single|multi` × `simple|advanced` profiles. In
advanced mode, an assignment grant or revocation is visible to generated CRUD,
`/api/data`, and Sync without app-specific adapter code. `authorizationPolicy`
also composes with row rules, for example:

```ts
list: allOf(
  authorizationPolicy({ permission: 'tickets:read' }),
  ownerPolicy({ userField: 'created_by' }),
)
```

The first branch decides capability; the second narrows the returned rows.
Tenant realm isolation is still applied separately and cannot be weakened by
either branch.

### Keep access beside the schema—on the server

It is useful to keep a table's access declaration physically next to its
schema, but the enforceable policy belongs in a server-only resource module.
`defineTable()` and `schema()` are shared with browser code for validation,
types, and generated UI; `sync: 'full' | 'lazy' | 'auto'` is a loading
decision, not an authorization rule.

Colocate the files and pass the typed table directly to the server-only
resource declaration:

```ts
// db/tickets.ts — shared schema
import { defineTable, field } from '@zero/framework/schema';

export const tickets = defineTable('tickets', {
  tenant_id: field.text({ required: true }),
  created_by: field.text({ required: true }),
  title: field.text({ required: true }),
}, { sync: 'lazy' });

// server/resources/tickets.ts — server-only policy
import { defineResource, ownerPolicy, tenantRealm } from '@zero/framework/server';
import { tickets } from '../../db/tickets';

export default defineResource({
  table: tickets,
  exposure: 'all',
  realm: tenantRealm(),
  policy: ownerPolicy({ userField: 'created_by', create: 'stamp' }),
});
```

`defineResource({ table: tickets })` derives the table name and primary key.
The normalized exposure, realm, and policy exist only in the server-owned
resource registry; Zero does not attach them to `tickets.serverTable`,
`tickets.clientTable`, or shared schema metadata. Executable policy and realms
remain server-only. A field allow-list contains names only and may be shared
explicitly with packaged forms as described below.

### Field projection and client writes

Use `fields` when a managed client must see or edit only part of a table. The
contract is an allow-list, not a list of exceptions:

```ts
// shared/ticket-fields.ts — safe in server and browser bundles
import { defineResourceFields } from '@zero/framework';

export const ticketFields = defineResourceFields({
  read: ['ticket_id', 'title', 'status', 'created_at'],
  create: ['title', 'status'],
  update: ['title', 'status'],
  filter: ['ticket_id', 'title', 'status'],
  sort: ['title', 'status', 'created_at'],
});

// server/resources/tickets.ts
defineResource({
  table: tickets,
  exposure: 'all',
  realm: tenantRealm(),
  fields: ticketFields,
  policy: ownerPolicy({ userField: 'created_by', create: 'stamp' }),
});
```

Omitting `fields` preserves the legacy all-column behavior. Once `fields` is
present:

- `read` is required. Only those columns leave generated CRUD, `/api/data`, or
  Sync. The same projection reaches full snapshots, reconnect catch-up, live
  changes, mutation acknowledgements, lazy/full caches, and cache-backed CSV
  export.
- `create` and `update` default to empty allow-lists. They apply to raw
  browser/native input before realm or policy stamping. A policy may therefore
  stamp `created_by`, and shared-row isolation may stamp `tenant_id`, without
  making either field client-writable.
- `filter` and `sort` default to `read` and must be subsets of `read`. A hidden
  field cannot be used as a filter or ordering oracle.
- an exposed resource must include its primary key in `read`, because managed
  lazy/full caches require stable public row identity. A create may still carry
  the protocol primary key even when it is not a form field; primary keys can
  never appear in `update`.
- a shared-row tenant discriminator can be readable, but it cannot appear in
  `create` or `update`. It is always derived from the current durable session.
  Physical tenant isolation has no managed discriminator; any retained tenant
  field follows the ordinary declared field policy.

Registration rejects unknown fields, mutable primary keys, missing readable
primary keys, and client-writable shared-row tenant discriminators. Definitions
and every normalized field list are frozen before the registry is sealed.

Policies continue to evaluate complete server rows and inputs. Hidden owner,
shared-row tenant, or custom-policy columns remain available internally for
constraints, row filtering, compare-and-write checks, and stamping; projection
occurs only after authorization. List SQL also selects only readable columns,
while policy constraints are compiled against the full validated table schema.

For packaged generated forms, pass the same names-only contract:

```tsx
<CrudPage
  table="tickets"
  schema={tickets.schema}
  columns={['ticket_id', 'title', 'status', 'created_at']}
  resourceFields={ticketFields}
/>
```

`CrudPage` restricts table/export columns to `read`, create forms to `create`,
and edit forms to `update`. `AutoForm` and `useForm` also accept
`includeFields` for custom composition; excluded required server fields are not
rendered, validated, or submitted. UI restriction is ergonomic only—the CRUD
and Sync mutation boundaries enforce the same allow-list independently.

Changing a Sync projection changes the socket authorization fingerprint. On
reconnect the client receives an authoritative cache replacement, so a column
removed from `read` cannot survive in an older local cache. Direct
`zero.unsafe` SQL, custom endpoints, and custom exports remain trusted server
code; use `projectResourceRow()` explicitly if such code wants this same
projection contract.

### Client exposure

`exposure` is the immutable allow-list for Zero's managed client transports.
It is independent from both the resource realm and its action policy:

| `exposure` | Generated CRUD | `GET /api/data` | WebSocket Sync |
| --- | --- | --- | --- |
| `internal` | denied | denied | denied |
| `http` | allowed | allowed | denied |
| `sync` | denied | denied | allowed |
| `all` | allowed | allowed | allowed |

Every allowed transport still evaluates the declared action policy and realm;
exposure never grants an action by itself. Requests for a non-HTTP resource are
concealed like unknown resources/tables. In particular, `/api/data` returns the
same generic `404 table-not-queryable` result before checking physical table
existence, so an internal declaration is not a table-discovery oracle.

Single-mode applications may omit `exposure`; the registry normalizes that
legacy declaration to `all`. Multi-mode applications must choose
`internal`, `http`, `sync`, or `all` explicitly. The sealed registry stores a
frozen `{ kind, http, sync }` projection. It does not publish exposure, realm,
or executable policy through the browser-safe table schema.

Table `sync: 'full' | 'lazy' | 'auto'` remains a loading strategy after Sync
has been authorized; it is not transport authorization. Because lazy Sync
hydrates through `/api/data`, a sync-only resource must be guaranteed to use
full loading. `createApp()` rejects `exposure: 'sync'` with explicit `lazy`, or
with `auto` when the effective auto action can select lazy. Use `all` when HTTP
hydration is intended, or configure guaranteed full loading. Doctor reports the
same contradiction before startup.

### Data realms

Realm classification is independent from discretionary `policy`:

```ts
// Shared reference data. This is an explicit choice in multi mode.
defineResource({
  table: countries,
  exposure: 'all',
  realm: globalRealm(), // `realm: 'global'` is equivalent
  policy: readOnly(),
});

// Tenant-owned data. `tenant_id` is the shared-row default field;
// tenant-database isolation uses the selected physical database instead.
defineResource({
  table: patients,
  exposure: 'all',
  realm: tenantRealm(), // or tenantRealm({ field: 'organization_id' })
  policy: anyOf(adminOnly(), ownerPolicy({ userField: 'assigned_to' })),
});
```

In `auth.tenancy: 'multi'`, every app table managed by `createApp()` must have
a registered resource with an explicit exposure and an explicit `global` or
`tenant` realm. Startup rejects omissions, including for `internal` resources;
that keeps a later exposure change from silently inventing a realm. Omitted
realms and exposure remain supported for existing single-tenant applications.

The resolved topology applies one tenant-isolation mode to the registry:

| Isolation | Mandatory tenant boundary |
| --- | --- |
| `shared-row` (default) | A server-owned row discriminator. The declared field (default `tenant_id`) must be a real, non-nullable column and cannot double as the row primary key. |
| `tenant-database` | Possession of the authority-derived physical database capability. The Resource remains `tenantRealm()`, but Zero adds no tenant field, stamp, predicate, or row filter. A retained `tenant_id` is business data, not the authorization boundary. |

`tenant-database` requires multi-tenant auth. Its actor realm must be a
schema-identical subset of `createApp({ tables })` and, after Resource loading,
must exactly equal all physical tenant Resources, including `internal` and
HTTP-only tables. A physical tenant Resource is deliberately absent from the
pinned control database; it cannot fall through to a same-named shadow table.
See [ReactiveDB Fabric](./multi-database-architecture.md) for actor lifecycle,
capacity, durability, snapshot, and deployment boundaries.

For default-plane Resources, Zero validates storage after opening SQLite.
Registry/Doctor validation first inspects the declaration; then `createApp()`
checks the actual `PRAGMA table_info` result. The Resource primary key must be
the table's sole primary-key column. For `shared-row` tenant Resources, the
discriminator must exist, be `NOT NULL`, and not be that primary key. This
catches an older durable table that `CREATE TABLE IF NOT EXISTS` could not
repair. Physical tenant schemas are instead owned and verified by the immutable
actor realm. Startup names the Resource and required migration; it never
silently runs a destructive table rebuild.

Startup does not require the discriminator or policy fields to declare a
particular SQLite collation. Managed shared-row realm equality and policy
equality are stricter than the table declaration: generated CRUD, `/api/data`,
and final scoped writes require the stored value to have the same SQLite
storage class and compare with `BINARY` equality. A legacy
`TEXT COLLATE NOCASE` column is therefore accepted
but a case-only tenant or owner-id variant is not authorized. The same rule
prevents numeric affinity from turning a text policy value into a match. Sync's
in-memory row matcher uses the equivalent exact string/number contract;
boolean constraints retain their documented canonical SQLite/JSON forms.
Caller-authored `filter=` expressions remain ordinary query filters and keep
the table's declared SQLite comparison semantics; they are always ANDed with
the exact server-owned constraints and cannot widen them.

The completed startup registry is sealed. Exposure, realms, and policy cannot
be appended after HTTP and Sync guards have captured the registry. Low-level
`createSyncPlugin({ tenancyMode: 'multi' })` composition also refuses to start
unless its resource-policy adapter proves both a valid exposure and a `global`
or `tenant` classification for every configured app table. `createApp()` wires
these proofs automatically.

The tenant realm is always enforced outside the Resource policy. An
`anyOf(adminOnly(), customPolicy(...))` decision can grant an action inside the
active tenant, but it cannot expose a different tenant. In `shared-row` mode
that enforcement is an ANDed server-owned row constraint; in
`tenant-database` mode it is the selected database capability. Tenant Resources
require a live durable session with matching session scope, membership, and
tenant/membership authorization generations; an arbitrary `tenantId` hint is
not sufficient.

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

Disable the generated CRUD router globally when the application supplies its
own resource endpoints:

```ts
createApp({
  db: { mode: 'memory' },
  tables,
  resources,
  resourceRoutes: false,
});
```

`resourceRoutes: false` affects only `/api/resources/*`. It does not change
`/api/data` or Sync authorization: each registered resource's `exposure`
continues to govern those transports. To disable HTTP access for one resource,
declare `exposure: 'internal'` or `exposure: 'sync'` instead.

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
values are parameterized. List queries accept at most 64 filters of at most
4,096 characters each; order identifiers are capped at 128 characters and
`dir` at four. Validation failures return the stable
`400 invalid-resource-query` category without echoing rejected values. The
same limits apply to `/api/data`, whose category is `400 invalid-data-query`.

CRUD policy behavior:

- `list` evaluates the resource list policy, then translates returned
  constraints such as `owner_id = user.userId` into storage-class/BINARY-exact
  SQL rather than inheriting a column's affinity or collation.
- in `shared-row` mode, tenant-scoped `get`, `update`, and `delete` put the
  primary-key and tenant predicates in the SQL read; cross-tenant rows are
  returned as `404`. In `tenant-database` mode the authority-bound physical
  database is selected before the row operation, so no redundant tenant
  predicate is added.
- `create` evaluates create policy before writing. `ownerPolicy()` defaults to
  `create: 'stamp'`, so caller-provided owner fields are overwritten with the
  authenticated user id.
- every registered create uses collision-safe `INSERT` semantics; a create
  policy can never replace an existing primary key and bypass update policy.
  Shared-row tenant creates additionally server-stamp the trusted tenant field
  and reject a conflicting caller value. Physical tenant creates do not invent
  a tenant field.
- `update` strips primary key changes before writing.
- a shared-row tenant discriminator is server-managed and cannot be supplied
  to an ordinary update. Final update/delete statements repeat the tenant
  predicate, closing the policy-check-to-write race. Physical tenant writes
  remain bound to the already selected actor capability.
- `get` re-reads the exact row snapshot after asynchronous policy work.
  Registered update/delete writes compare every stored column evaluated by
  policy in the final SQL statement. Same-tenant owner/status changes therefore
  return `resource-row-changed` instead of applying a stale decision.
- scoped create/update/delete runs atomically in its owning database and
  verifies the stored postcondition before commit. In shared-row mode, a
  trigger that rewrites the tenant field or recreates a deleted row makes the
  whole write roll back.
- for default/shared-row storage, the durable session, account, membership,
  assignment revision, and trusted policy properties are synchronously re-read
  inside the same SQLite transaction as the final read/write. Physical tenant
  storage cannot use a cross-file SQLite transaction: Zero instead captures
  durable control-plane authority, fences actor acquisition and dispatch, and
  rechecks before returning the actor result. A change after asynchronous
  bearer revalidation returns `resource-authority-changed`.
- generated mutations persist their idempotency receipt atomically with the
  effect in the owning database. The physical actor ledger and the
  default/shared-row ledger have equivalent replay semantics and independent
  bounded retention contracts.
- writes go through ReactiveDB, so generated route mutations still emit normal
  sync/change events.
- `metadataPolicy()` hydrates trusted user properties from the auth user store
  when auth is enabled.
- `authorizationPolicy()` resolves the same live application/tenant RBAC
  snapshot used by route guards. Its scope and assignment revision are included
  in the final transaction authority fence.

## `/api/data` Integration

Registered `http` and `all` resources are queryable through `GET /api/data`
regardless of whether their Sync loading mode is full, lazy, or auto. Loading
mode is not HTTP authorization. In single mode, unregistered tables retain the
legacy lazy/queryable-table allow-list and sync read-policy behavior. In multi
mode, an app-managed table without a classified resource fails startup and the
transport fails closed.

For a registered HTTP-exposed resource, `/api/data` evaluates its mandatory
realm and resource `list` policy after the sync read policy and before SQL
execution. `internal` and `sync` resources return the same generic 404 as an
unknown or otherwise non-queryable client table, without first disclosing
whether the physical table exists.

For registered resources:

- a missing or unsupported `list` action fails closed;
- denied resource policy returns the policy status/message;
- `ownerPolicy()` list constraints are translated into SQL and ANDed with
  caller filters;
- in `shared-row` mode, tenant predicates are translated into SQL and ANDed
  with both caller filters and policy constraints; a caller filter can narrow
  but never widen them. In `tenant-database` mode, the query runs through a
  short-lived actor capability selected only from the verified tenant scope;
- server-owned shared-row realm and policy equality is storage-class/BINARY
  exact, so a `NOCASE` owner or tenant column and an affinity-coercible value
  cannot broaden the result;
- `anyOf(ownerPolicy(...), adminOnly())` lets admins read all rows while owners
  only read their rows;
- `metadataPolicy()` hydrates trusted user properties from the auth user store;
- `authorizationPolicy()` applies the app-local live RBAC scope used by route
  guards, including advanced additive assignments;
- after an asynchronous custom policy returns, Zero re-resolves the bearer and
  trusted user properties. Default/shared-row queries resolve captured durable
  authority again inside the same SQLite read transaction as the SQL query.
  Physical queries fence authority before actor acquisition, at the actor read
  boundary, and before result delivery. A revoked session, changed
  membership/generation, role assignment, or policy property returns
  `resource-authority-changed`;
- unsafe or unknown constraint columns fail closed instead of running a broad
  query.

Example:

```txt
GET /api/data?table=tickets&filter=status:open&order=created_at&dir=desc
```

If `tickets` is registered with `ownerPolicy({ userField: 'created_by' })`, the
effective SQL filters include both `status = 'open'` and
`created_by = auth.userId`.

## WebSocket Sync Integration

Registered resources also participate in `/sync` authorization:

- WebSocket readable tables are still checked by `syncPolicy.canReadTable`
  first.
- A registered table must additionally have `sync` or `all` exposure;
  `internal` and `http` resources are removed from readable tables and their
  direct Sync mutations are denied.
- If an exposure-allowed table is a registered resource, Zero evaluates its
  `list` policy when the socket opens.
- `authorizationPolicy()` evaluates the same live application/tenant RBAC
  scope as HTTP routes; its scope and assignment revision participate in the
  socket policy fingerprint.
- If `list` denies, the table is not subscribable over WebSocket sync.
- If `list` allows without constraints, the table can use normal table-wide
  snapshots, catchup, and live broadcasts.
- If `list` allows with row-level constraints, such as
  `ownerPolicy({ userField: 'owner_id' })`, Zero installs a per-connection row
  filter for snapshots, catchup, and live changes.
- A shared-row tenant realm adds its own mandatory per-connection row filter
  even when discretionary policy is otherwise unconstrained. A physical
  tenant realm is isolated by the authority-bound tenant database and adds no
  redundant tenant row filter; discretionary row constraints still apply.

Admins can still receive full-table sync while normal users receive filtered
sync with:

```ts
list: anyOf(adminOnly(), ownerPolicy({ userField: 'owner_id' }))
```

For an admin, `adminOnly()` creates an unconstrained allow branch, so full-table
sync can be used. For a normal owner, `ownerPolicy()` creates an owner
constraint, so Zero sends only rows owned by that user. If a row moves out of a
user's filter during an update, the user receives a `DELETE` change for that
row so stale data is removed from the local store.

Managed physical tenant Sync keeps one authenticated `/sync` socket but uses a
separate tenant data plane with its own epoch, sequence, baseline, catch-up,
and reset boundary. The socket holds one persistent authority-bound database
lease. Full baselines use bounded `begin`/`page`/`abort` actor snapshot
sessions and chunked WebSocket frames; they never query a same-named table in
the control database. The server-generated table-plane catalog is
authoritative—browser plane fields can assert, but cannot select, storage.

Direct `sync.mutate` writes also evaluate resource policy for registered
resources:

- `INSERT` maps to `create` and applies `stampedInput`, so
  `ownerPolicy({ create: 'stamp' })` overwrites caller-supplied owner fields.
- every registered `INSERT` uses a non-replacing persistence boundary.
  Shared-row tenant inserts also stamp the active tenant and reject conflicts;
  physical tenant inserts do not add a discriminator.
- `UPDATE` maps to `update`, loads the current row, and evaluates row policy
  before writing.
- `DELETE` maps to `delete`, loads the current row, and evaluates row policy
  before deleting.
- shared-row tenant `UPDATE` and `DELETE` carry the trusted tenant predicate
  into the actual ReactiveDB SQL statement. Cross-tenant target ids are
  concealed as missing rows. Physical tenant mutations run only through the
  selected database capability. Global and tenant Resource writes also compare
  the exact row snapshot evaluated by policy, closing same-realm row-policy
  races.
- scoped writes are transactions with a verified postcondition, so database
  triggers cannot commit a row outside the authorized tenant while returning
  an error to the client.
- after asynchronous mutation policy and token revalidation,
  default/shared-row Sync checks durable token authority and the
  trusted-property fingerprint inside the same SQLite transaction as the
  conditional write and mutation receipt. Physical Sync fences control-plane
  authority at the actor boundary and commits the mutation plus receipt
  atomically in the tenant database.
- Platform protected table policy still composes with resource policy using
  deny-wins behavior.

The Sync authorization scope hashes the session kind/client, native identity
scopes, durable session id/generation, active tenant and membership ids, tenant
role, tenant/membership authorization generations, readable tables, and
policy/realm fingerprint. Scope changes force an authoritative reconnect/purge
instead of reusing a prior tenant cache.

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
- `authorizationPolicy(requirement)`: enforces the same structured
  application/tenant RBAC requirement used by routes and `context.access`.
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
constraints into SQL. WebSocket sync translates those constraints into
per-connection row filters. For `create: 'stamp'`, the decision includes
`stampedInput`, which generated endpoints and direct sync creates write instead
of trusting caller input.

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
- registered resources reference existing tables;
- registered resource primary keys match the table primary key;
- registered `ownerPolicy({ userField })` values reference real table columns;
- exposure values are one of `internal`, `http`, `sync`, or `all`, with an
  explicit value required in multi mode;
- multi-mode managed tables have an explicit resource realm;
- shared-row tenant realm fields are safe, present, `NOT NULL`, and distinct
  from the row primary key. Physical tenant isolation validates the actor realm
  instead and does not require a discriminator field.

Startup then verifies default/shared-row SQLite tables, including the
sole-primary-key and tenant-discriminator properties above. For every
shared-row tenant Resource it also:

- requires at least one non-partial index whose first key is the tenant
  discriminator;
- rejects non-primary business-unique indexes that omit the tenant
  discriminator (a redundant unique index containing the already-unique row
  primary key does not add a business constraint and is ignored); and
- inspects every foreign key to another registered tenant resource and requires
  the child and parent tenant fields in that same composite foreign key.

For example, a shared-row tenant project slug and child document relationship
can be migrated as:

```sql
CREATE UNIQUE INDEX projects_tenant_slug
  ON projects (tenant_id, slug);

-- SQLite requires a matching parent key for a composite foreign key.
CREATE UNIQUE INDEX projects_tenant_id
  ON projects (tenant_id, id);

CREATE TABLE documents (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects (tenant_id, id)
);
CREATE INDEX documents_tenant ON documents (tenant_id);
```

A partial tenant index does not cover general shared-row managed queries and
therefore does not satisfy startup. If a value is intentionally unique across
the whole application, model that identity in a registered global Resource
instead of placing a global business-unique constraint on a shared-row tenant
Resource. Physical tenant files use the actor realm and ordinary per-file
indexes, uniqueness, and foreign keys; the selected file—not a row field—is
their mandatory tenant boundary. Declared-schema validation alone is not
release evidence for a pre-existing database.

## Doctor Checks

Run platform doctor after adding or changing resources:

```txt
bun run doctor -- --config ./zero.config.ts
bun run doctor -- --config ./zero.config.ts --strict
```

Resource doctor checks cover:

- registration errors such as missing tables, primary-key mismatches, missing
  action policies, invalid/missing exposure, missing owner columns, and
  untrusted metadata keys;
- sync-only resources whose lazy or auto-to-lazy loading would require the
  deliberately denied `/api/data` hydration path;
- resources that require auth while `auth` is disabled;
- registered resources without a `list` policy, because `/api/data` and
  WebSocket sync reads for that table fail closed;
- custom `list` policy branches whose row scope cannot be proven statically;
- write/delete policies with public or uninspectable custom access;
- generated HTTP mutations that share the default/shared-row durable receipt
  ledger, including its retained-result window, permanent identity ceiling,
  observability events, and required database lifecycle planning;
- owner/list fields that should usually be indexed for `/api/data` and
  row-filtered sync;
- shared-row tenant discriminators without a likely tenant-leading index. A
  natural `_identity` satisfies that guidance only when the discriminator is
  its first field; otherwise add a migration index beginning with the
  discriminator and, when static schema metadata cannot express it, list the
  known field under `doctor.indexedFields`. Physical tenant Resources instead
  receive topology/realm and redundant-discriminator findings.

The CLI loads both inline `createApp({ resources })` definitions and the same
`serverResourcesDir` modules that `createApp()` discovers. The programmatic
`runPlatformDoctor(config)` API is intentionally filesystem-free; callers of
that API must include discovered definitions in `config.resources` themselves.
Doctor validates declared schema. For default/shared-row storage, app startup
against the actual SQLite table is the final runtime gate; physical tenant
storage uses the validated actor realm and verifies it when the actor opens.

Doctor uses static policy metadata attached by Zero's policy helpers. It does
not execute `customPolicy()` callbacks. If a custom list policy is intended to
scope rows, return explicit constraints from that policy and cover the behavior
with tests.

## Boundary and current limits

The enforced guarantee in this slice covers app-owned tables reached through
generated resource CRUD, `/api/data`, and WebSocket Sync snapshot, catch-up,
live delivery, and mutations. Each transport checks the immutable exposure
allow-list before policy evaluation. Multi mode rejects app tables without an
explicit exposure and realm at startup and again at the managed transport
boundary.

Application server code is trusted, but multi-tenant request handlers no
longer receive raw process data handles accidentally. Direct DB/SQL, adapters,
auth stores/tokens, unscoped KV/vector, and control-plane services require the
explicit `zero.unsafe` surface and remain outside the managed isolation
guarantee; that code must supply its own server-derived tenant predicate and
audit/revalidation behavior in shared-row mode, or deliberately acquire and
fence the correct authority-derived physical capability in tenant-database
mode. Zero's built-in Storage, notifications, rooms,
workflows, state, and ephemeral transports have independent tenant
discriminators, request-bound facades, and two-tenant tests. Resource realm
classification protects app tables reached through generated CRUD,
`/api/data`, and Sync; it does not magically make an arbitrary unsafe SQL query
tenant-aware.

For shared-row Resources, startup proves tenant-leading indexes, tenant-aware
business uniqueness, and tenant-consistent foreign keys between registered
tenant Resources from actual SQLite metadata. It validates the constraints but
does not author migrations; apps still add the DDL intentionally. Foreign keys
to unregistered tables and all direct `zero.unsafe` SQL remain trusted
application design. Packaged
`CrudPage`/`AutoForm` composition can consume the shared field allow-list for
form ergonomics, while managed server transports remain the authorization
boundary. UI hiding by itself never grants or denies access.
