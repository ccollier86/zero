# System and Application Database Planes

> **Upgrade note:** this is a breaking storage-boundary change. New apps use
> separate system and application planes. A legacy database containing both
> kinds of state fails closed; Zero does not split it automatically.

Zero keeps framework state out of the database an application developer is
building. Every managed app has two pinned database planes:

- The **system plane** is authoritative for Guardian identity, credentials,
  sessions, API keys, tenants, memberships, RBAC, audit, provisioning, and
  Zero-owned service state.
- The **application plane** contains application tables. When its schema uses
  `field.guardianUser()` or `field.guardianMembership()`, Zero also installs
  only the ID anchors required for those local SQLite foreign keys.

Fabric tenant databases are additional application planes. ReactiveDB metadata
that must commit atomically with one physical database—such as its change log,
mutation receipts, and actor binding—remains in that database. Zero-owned
cross-startup decisions that do not need data-plane transaction locality, such
as persisted automatic Sync modes, live in the system plane.

This is also the reusable foundation for future isolated service databases.
Logs, metrics, audit, and plugins can receive their own pinned or actor-owned
planes without rebuilding database lifecycle, migration, diagnostics,
or routing. `systemDb` is the first required built-in use of those generic
plane primitives; it is not a one-off second connection.

## Non-negotiable invariants

1. Guardian in `system.db` is the only identity and authorization authority.
2. An application anchor proves referential existence; it never grants access.
3. Credentials, session material, API-key hashes, account status, roles,
   permissions, profile properties, email, and other PII are never copied into
   an anchor.
4. User and membership identifiers are never reused.
5. Anchors are retained so historical application foreign keys cannot break
   when an account or membership is disabled or removed.
6. SQLite transactions never span database files. Projection is an idempotent,
   durable saga with source outbox events and target receipts.
7. Authorization is revalidated from Guardian immediately before an
   application or tenant commit. Projection lag cannot preserve stale access.
8. Database routes come from trusted configuration and committed Guardian
   scope. A request cannot select a path, file, database reference, or tenant
   database.
9. A physical database owns its own ReactiveDB change log, cursor epoch,
   mutation receipts, migration ledger, and schema metadata.
10. A projection target is not reported ready until its declared anchors have
    been applied and its target-local projection state is ready.

## Configuration and server surface

`db` remains the application database. `systemDb` owns Zero internals:

```ts
defineZeroConfig({
  db: {
    mode: 'hot',
    path: './data/app.db',
    snapshotPath: './data/app.snapshot.db',
  },
  systemDb: {
    mode: 'file',
    path: './data/zero.system.db',
  },
  tables,
  auth,
});
```

The server API follows the same boundary:

```ts
zero.db       // application ReactiveDB
zero.syncDB   // compatibility alias for the application ReactiveDB
zero.sql      // application SQLite service
zero.sqlite   // compatibility alias for the application SQLite service

zero.system.db   // privileged system ReactiveDB
zero.system.sql  // privileged system SQLite service
```

`zero.system` is the privileged server-service facade. Multi-tenant request
contexts require the explicit `zero.unsafe.system` boundary, and workflow
contexts do not receive the unsafe escape hatch. Application code should use
`zero.auth` and the other service APIs: direct system-table writes can bypass
Guardian audit, generation, outbox, and invariant handling.

### Migration routing

`zero migrate` and its status, checkpoint, rollback, and system-doctor modes
target `SYSTEM_DB_PATH`, then `./data/zero.system.db`. An explicit `--db` is an
exact operator override. The managed framework registry is never inferred from
`DB_PATH` or `DATABASE_PATH` and is never installed into `db` or a Fabric tenant
file.

Application schema inspection is deliberately separate:

```sh
zero migrate --plan --schema ./db/schema.ts --db ./data/app.db
zero migrate --doctor --schema ./db/schema.ts --db ./data/app.db --strict
```

Those commands inspect the selected app database without creating the system
migration ledger. Fabric databases are provisioned and upgraded by their
declared realm tables, version, and ordered realm migrations inside the owning
actor, so independent tenant files never share a migration transaction.

### Later universal API exploration

This split does not add a broad system-data API. A later, separately reviewed
pass can add policy-aware Guardian directory methods such as batched user-ID
display resolution, current-tenant membership listing, and projection/realm
diagnostics. Those methods should return stable public view models, enforce the
caller's live scope, batch ownership lookups efficiently, and work identically
for shared and Fabric application planes. They must not expose generic system
SQL or make internal table schemas part of the application contract.

The runtime manager owns an ordered registry of pinned database planes. The
system and application aliases are mandatory today. A later service/plugin
plane uses the same registry and lifecycle rather than adding another special
case. Pinned planes start in dependency order and stop in reverse order;
actor-owned Fabric databases drain before their authority/system plane closes.

For file-mode Guardian authority, Zero also owns the derived coordination
sidecar `<systemDb.path>.authority-fence.sqlite` and its SQLite companions.
That file contains no identity or application rows; its rollback-journal lock
provides the crash-released, cross-process final-commit boundary described
below. The pinned application writer and every Guardian-authorized Fabric
tenant writer use this one boundary. It must not overlap `db`, Fabric storage,
or another managed plane, and must not be moved or replaced while a Zero
process is running.

## Identity anchors

Anchors are schema-driven, not unconditional. If no application table declares
a Guardian reference, Zero creates no projection runtime or anchor tables and
the readiness API reports `not-required`. If a shared application table uses a
Guardian user reference, its database contains this ID-only anchor:

```sql
CREATE TABLE users (
  user_id TEXT PRIMARY KEY
);
```

If a table uses a Guardian membership reference, the same application plane
also contains retained membership anchors (and the required user anchor):

```sql
CREATE TABLE tenant_memberships (
  membership_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT
);
```

A physical tenant database receives these tables only when a Resource routed
to that plane declares a Guardian reference, and receives only the users and
memberships relevant to that tenant. The local `tenant_id` on the internal
membership anchor is a provenance and corruption check; application tables in
a tenant-isolated file do not need a redundant tenant column.

Application schema can declare Guardian relationships and trusted actor
stamping. Relationship metadata creates and validates the local FK shape, but
does not silently create permission:

```ts
const workOrders = defineTable('work_orders', {
  title: field.text({ required: true }),
  created_by_user_id: field.guardianUser({ required: true }),
  assigned_membership_id: field.guardianMembership({ required: false }),
}, {
  pk: 'work_order_id',
});
```

The Resource policy remains the visible authorization declaration and owns
trusted stamping:

```ts
const currentActor = guardianActorPolicy({
  userField: 'created_by_user_id',
  membershipField: 'assigned_membership_id',
});

export default defineResource({
  table: workOrders,
  exposure: 'all',
  realm: tenantRealm(),
  policy: allOf(
    authorizationPolicy({
      user: 'required',
      tenant: 'required',
      permission: 'work-orders:write',
    }),
    currentActor,
  ),
});
```

Managed create routes ignore caller-supplied actor IDs and stamp the current
Guardian user and membership. The policy verifies that membership against the
live tenant scope. Actor fields remain immutable through Sync and generated
HTTP CRUD.

## Durable projection protocol

For every registered projection target, Guardian writes identity state and its
immutable projection event in the same `system.db` transaction. Application
targets are registered at startup. Fabric tenant targets are registered lazily
only after a policy-eligible tenant realm is first admitted; that registration
transaction seeds every retained, finalized membership for the tenant before
the target is reconciled. A tenant or membership existing by itself therefore
does not allocate a projection journal or database file. Projection targets
use a logical ID and scope (`application`, `tenant`, or a trusted named realm),
never a path.

For each event and target:

1. A worker claims the outbox record with a bounded lease and monotonic attempt
   generation; expired work is recovered for retry, and an acknowledge,
   release, or quarantine from an older lease generation fails closed even if
   the same worker ID later reclaims the record.
2. It acquires the target through the database manager/Fabric capability.
3. It installs the anchor schema if that realm version is missing.
4. It performs an idempotent insert.
5. The target records a durable event receipt and watermark in the same local
   transaction as the anchor.
6. The source acknowledgement is recorded in `system.db`.

An existing exact anchor is success. The same immutable ID with a different
tenant/user mapping is corruption: projection quarantines that target and
fails closed. A crash after target commit and before source acknowledgement is
safe because replay observes the receipt. Workers never hold a SQLite
transaction while awaiting another database.

Guardian creation hooks enqueue projection work in the same system transaction
for every target which already exists. The pinned application target reconciles
synchronously after that transaction commits. A not-yet-used tenant remains
system-plane-only; its first admitted actor provision/bind registers and seeds
the target from finalized Guardian state. Existing physical tenant targets
reconcile after later membership commits, when their actor is bound, and when
the readiness retry route requests the same reconciliation.
Expired delivery leases are recovered and duplicate target application is safe
because the target receipt and watermark are durable.

### Advanced server-only projection composition

`createApp()` owns the complete projection runtime whenever schema declarations
need Guardian anchors. Application code must not construct a second projector
beside it. The low-level exports from `@zero/framework/auth` exist for
standalone Guardian/database adapters and framework plugin authors; they are
server-only infrastructure, not browser or ordinary route APIs.

The core composition is intentionally narrow:

```ts
import {
  createIdentityProjectionLifecycleHook,
  IdentityAnchorStore,
  IdentityProjectionOutboxStore,
  IdentityProjectionService,
} from '@zero/framework/auth';

const targetId = 'application-main'; // logical ID, never a path
const outbox = new IdentityProjectionOutboxStore(systemDB);
outbox.registerTarget(targetId, 'application');

const lifecycle = createIdentityProjectionLifecycleHook(outbox, {
  targetsForUser: () => [targetId],
  targetsForMembership: () => [targetId],
});

const target = new IdentityAnchorStore(applicationDB, {
  installationId: outbox.getInstallationId(),
  targetId,
});
const projector = new IdentityProjectionService(outbox);

// Install `lifecycle` in the standalone Guardian composition before writes,
// then reconcile only after its enclosing Guardian transaction commits.
projector.reconcileTargetSync(targetId, target);
```

Advanced composition must preserve all of these lifecycle rules:

1. The outbox belongs to the authoritative system ReactiveDB; the anchor store
   belongs to exactly one application database. Never point both stores at one
   physical handle or try to span them with a transaction.
2. Register a logical target and its immutable scope before enqueue. Bind its
   target-local state to the outbox's durable installation ID. Target IDs are
   opaque routing identities, never file paths or caller input.
3. Install the lifecycle hook before Guardian user/membership creation. Its
   synchronous callbacks only register/enqueue inside the enclosing Guardian
   transaction; they must perform no target I/O and return no Promise. The
   helper deduplicates routes and always enqueues the user anchor before its
   dependent membership anchor.
4. The generic lifecycle helper covers newly created identities. A standalone
   adapter adopting existing Guardian rows must enumerate and enqueue those
   anchors in a deliberate system transaction before reporting the target
   ready. Managed `createApp()` performs this startup seed automatically.
5. Reconcile only after the Guardian transaction commits. Use
   `reconcileTargetSync()`/`ensureAnchorSync()` only with a process-pinned
   `SynchronousIdentityProjectionTarget`; use the async variants for actor or
   remote target adapters. Never await target work while a system SQLite
   transaction is open.
6. A custom target's `apply()` must durably and atomically commit the ID anchor,
   exact event receipt, and contiguous watermark before it resolves;
   `markReady()` follows only after the ordered backlog is empty. A source
   acknowledgement follows the durable target receipt, never precedes it.
7. Preserve anchors and exact target binding. Duplicate identical delivery is
   success; ID remapping, sequence gaps, installation/target mismatch, or
   incompatible schema fails closed. Only `IDENTITY_PROJECTION_NOT_READY` and
   `IDENTITY_PROJECTION_LEASE_LOST` are retryable projection codes; conflicts,
   quarantine, invalid schema, and target mismatch require repair.

Public advanced types include `IdentityAnchorStoreOptions`,
`IdentityProjectionOutboxStoreOptions`, `IdentityProjectionServiceOptions`,
`IdentityProjectionLifecycleRoutes`, `SynchronousIdentityProjectionTarget`,
`IdentityProjectionErrorCode`, and `IDENTITY_PROJECTION_ERROR_CODES`.
`IDENTITY_PROJECTION_INSTALLATION_TABLE`, the other table-name constants, and
the schema installers are exposed only so trusted framework adapters can own
installation/collision handling. Their SQL columns and rows remain framework
internals: application code must not query, mutate, join, synchronize, or treat
them as a versioned data contract. Use store/service methods and readiness
view models instead.

## Tenant projection and readiness

When a tenant-owned Resource declares a Guardian reference, the projection
runtime follows this durable path:

1. Guardian creates the tenant and memberships in `system.db`; this alone does
   not allocate a physical data realm.
2. The first Resource, Sync, or readiness-retry path proves the live tenant
   purpose is admitted by at least one physical Resource policy before file
   creation or actor-capacity reservation.
3. Zero registers the logical target and seeds finalized, retained membership
   and user anchors for only that tenant in one system transaction.
4. Opening or binding the tenant database installs and validates its exact
   anchor schema, then applies the durable target backlog in order.
5. Target receipts and the target watermark commit with each local anchor.
6. The source target is marked ready once no pending deliveries remain; public
   readiness still requires the matching target-local binding, ready status,
   and watermark.

Tenant selection and session issuance do not wait for this cross-database work.
Instead, authenticated clients query the selected session's data-realm state
and gate application collections until it is ready. Zero never silently routes
a failed physical tenant to the shared database. The SDK exposes
`not-required`, `provisioning`, `retrying`, `ready`, and `failed` readiness
states for that gate.

### Readiness contract and UI

The browser asks only about its live Guardian scope. A tenant purpose excluded
by every physical Resource policy (for example the Administration Organization
in an organization-only app) has no tenant data realm and reports
`not-required` unless a shared application target is independently required:

```ts
const readiness = await client.dataRealm.getReadiness();
await client.dataRealm.retry(); // idempotent reconciliation of that same realm
```

The authenticated routes are `GET /auth/data-realm/readiness` and
`POST /auth/data-realm/readiness/retry`. They accept no tenant ID, target ID,
database reference, filename, path, or request body. The server derives the
application/Fabric target from the rehydrated `AuthContext`. Responses contain
only the public status, logical scope kind, pending-operation count, retry
capability, a bounded stable error code, update time, and bounded polling hint;
they never expose a projection target identifier, database path, SQL error,
credential, or identity detail.

Use the packaged boundary around any subtree that opens app collections:

```tsx
import { DataRealmReadyGate } from '@zero/framework/react';

export function WorkspaceData() {
  return (
    <DataRealmReadyGate>
      <TaskBoard />
    </DataRealmReadyGate>
  );
}
```

`useDataRealmReadiness()` is the composable form. It keys results to the
current authorization scope, masks state during login/logout/tenant changes,
and polls while the server reports `provisioning` or `retrying`.
`DataRealmReadinessNotice` provides the default token-driven
provisioning/failure presentation without printing the server error code.

Keep Guardian/system-plane controls outside this gate. Login, logout, tenant
selection, tenant creation, invitation acceptance, and `TenantSwitcher` must
remain usable even when the current application realm is provisioning or has
failed, so the user can authenticate, retry a flow, switch away, or sign out.
Pre-session and pre-switch screens also cannot safely use current-realm
readiness as a proxy for the prospective target. The action first commits the
new Guardian session; the authorization-scope key then changes, and the gate
queries and blocks only the new scope's application-data subtree.

Standalone server composition can mount
`createDataRealmReadinessPlugin({ getTokenService, getReadinessService })`
inside the `/auth` namespace before its catch-all. The service adapter receives
only `{ auth, signal }`; its `inspect()` and `retry()` methods must resolve the
target from live authority and map projection/Fabric state into the public
snapshot. `createApp()` owns that adapter in normal applications.

## Realtime planes

When Guardian is enabled, one browser WebSocket multiplexes independent
ReactiveDB logs:

- `default`: application data in the shared application database;
- `system`: authorized Zero service projections from the system database;
- `tenant`: application data in the selected physical Fabric database.

Each plane has its own epoch, sequence, snapshot/catch-up boundary, and scope.
The server owns the table-to-plane catalog. A client plane field is only an
assertion and cannot select storage. Framework system tables are read-only over
generic Sync; their writes remain behind the relevant HTTP/service plugin.
State Sync uses the system database while retaining its dedicated principal-
scoped wire protocol.

File-backed application and system planes each poll their own durable change
log so commits made by another Zero process fan out locally. If State Sync and
the system data plane share the same system handle, Zero starts only one
poller. With `auth: false`, Zero does not publish the system table catalog or a
browser-visible system plane; an unauthenticated socket cannot subscribe to
Zero-owned tables left in an existing system database.

This transport primitive is intentionally separable from the two-plane public
configuration. A later browser-visible service database can register another
trusted plane without changing application DB ownership.

## Authority fence

Every Guardian-authorized application write—whether it targets the pinned app
database or a Fabric tenant actor—uses the commit-edge fence:

1. capture the Guardian authority revision when the application transaction
   begins;
2. run the normal live policy/session/tenant/RBAC checks from `system.db`;
3. acquire the process-local shared lease before opening a cross-file commit
   window;
4. immediately before SQLite commit, when `systemDb` is file-backed, acquire a
   shared lease on its sidecar and reread the committed system authority
   revision;
5. reject and roll back without waiting if either boundary is busy or the
   authority revision changed;
6. commit the application transaction while holding both leases, then release
   them after commit or rollback.

For the pinned app database, the app process performs the final sidecar/revision
check. For Fabric, the parent passes a captured revision plus a trusted,
file-identity-checked system binding; the writer actor itself performs that
same check at its final commit edge. Request data can supply neither the system
path nor the revision. The parent retains its process-local lease until the
actor reports a settled commit/rollback or exits.

Guardian transactions whose triggers advance the authority revision acquire
the exclusive side of both boundaries at their own final commit edge. The
cross-process sidecar uses a zero-wait `BEGIN EXCLUSIVE`; its operating-system
lock disappears if the owning process exits. Application writers take
compatible shared leases, so different tenant databases can still commit
concurrently; only the Guardian exclusive edge conflicts with them. A guard
never waits for another database while its data transaction is open. A race
therefore has one deterministic winner: either the data commit completes under
the prior valid revision and the authority request receives retryable HTTP 409
`AUTH_COMMIT_CONFLICT`, or the authority change wins and the data mutation is
rejected. `AUTH_COMMIT_CONFLICT` means the Guardian mutation did not commit and
the same request may be retried; it is deliberately distinct from
`AUTH_STATE_CHANGED`, which denotes a stale authentication/session ceremony.
Hot and ephemeral system databases cannot be shared as one live authority
across processes, so their fence remains process-local.

## Modes

| Auth/topology | Anchor behavior |
| --- | --- |
| Auth off, one app DB | No Guardian anchors or projection worker. |
| Auth off, Fabric multiple mode | Trusted named-database operations remain available, but there is no Guardian projection or tenant-derived routing. |
| Single/simple or single/advanced | Declared user references activate an application `users` anchor. |
| Multi/shared-row | Declared references activate retained user/membership anchors in the shared app DB; app rows keep managed `tenant_id`. |
| Multi/tenant-database | Declared references on tenant Resources activate only that tenant file's user/membership anchors; app rows omit `tenant_id`. |
| Auth plus a named Fabric database | No identity projection is installed implicitly in that named database; shared app declarations still target the app plane, and tenant projection requires `tenant-database` mode. |
| Administration Organization | No customer data realm or anchors unless an explicit administration realm requests them. |

Browser sessions, page sessions, native sessions, and user API keys resolve to
the same Guardian IDs and therefore produce identical ownership behavior.

## Existing application upgrade

This transition is an explicit breaking-version migration. Zero does not
rewrite a live mixed database at startup and this release does not ship an
automatic combined-database splitter. New installs create separated planes. A
detected legacy mixed layout fails closed with
`DATABASE_SCHEMA_MISMATCH` and safe details
`{ layout: 'legacy-combined', requiredAction: 'split-system-database' }`
instead of starting against an empty system database and making existing
accounts appear lost. Migration ledgers and an application-owned `users` table
alone are valid in an application database and do not trigger the fence;
private Guardian/Zero companion tables do.

Existing applications must deliberately configure `systemDb`, back up and
stop the old deployment, perform an application-specific offline extraction of
Guardian/Zero system state, seed the new ID-only anchors, and verify both
databases before serving traffic. Zero does not currently publish a generic
splitter or a universal step-by-step data-conversion procedure: the exact move
depends on the legacy app's schema, direct table usage, and deployed migration
history. Apps which read former profile columns directly from application
`users` must move those reads to Guardian APIs. Existing application FKs to
`users(user_id)` can continue against the ID-only anchor. A future clean
offline split utility would make this upgrade easier, but its absence does not
block new separated-plane apps or deployments that complete and verify their
own deliberate offline migration.

## Operations and diagnostics

Back up the system database, application database, and any admitted tenant
databases as separate SQLite assets. This feature does not yet provide a
coordinated multi-plane backup/restore barrier or manifest; operators must stop
writes (normally by stopping the app) before capturing a consistent set.
The authority-fence sidecar contains no durable application or Guardian state
and does not need to be restored from backup; allow Zero to recreate it only
while every process using that system database is stopped.

Doctor currently checks:

- direct path/handle overlap plus existing filesystem aliases between `db` and
  `systemDb`, including the derived authority-fence sidecar;
- ephemeral or interval-snapshot system authority, with production failures;
- actual legacy mixed authority layouts without changing the inspected file;
- Guardian reference fields with auth disabled or incompatible tenancy;
- shared-application anchor schema/readiness only when shared tables need it;
- system projection schema plus aggregate ready/provisioning/quarantined target
  and pending-delivery state, including physical tenant targets.

Platform Doctor never creates, migrates, or repairs a database while inspecting it.
Run it with a project root so durable SQLite files and filesystem aliases can
be inspected read-only.
Existing-file inspection is best effort: a native SQLite build can reject a
closed WAL-mode file after its sidecars have been cleaned up. Doctor reports
`database.system.file_inspection_unavailable` rather than opening it read-write,
changing journal mode, or inventing schema readiness. See the
[read-only inspection boundary](../../docs-next/cli/doctor/infrastructure-inspection.md#paths-and-readiness)
for native WAL availability and safe alternatives.

The legacy fence uses `DATABASE_SCHEMA_MISMATCH`. Projection failures use
`IDENTITY_PROJECTION_NOT_READY`, `IDENTITY_PROJECTION_CONFLICT`,
`IDENTITY_PROJECTION_QUARANTINED`, `IDENTITY_PROJECTION_SCHEMA_INVALID`,
`IDENTITY_PROJECTION_TARGET_MISMATCH`, and
`IDENTITY_PROJECTION_LEASE_LOST`. Logs and public responses never include
paths, SQL, database references, credentials, secrets, email addresses, or
copied profile data.

## Verification coverage

The shipped Guardian + Fabric proof application declares one physical-tenant
`tasks` Resource with a Guardian creator-user reference and an assignee-
membership reference. Its fixture proves that the public example bundles,
passes Doctor for the intended topology, and retains the declared tenant,
credential, and RBAC policy shape.

The server integration proves the implemented runtime path: system and app
planes remain separate; tenant files receive only ID anchors plus the task
table; server-side actor stamping supplies the current user and membership;
two tenants can use the same task ID without seeing each other's row; pending
projection rejects writes with the stable readiness response; viewer-to-editor
role replacement invalidates stale session authority; tenant API keys route to
their bound tenant; and a revoked in-flight key cannot commit. Lower-level
projection tests cover idempotent replay and failed-admission lease release.
The auth-disabled regression proves that an app-owned `users` table does not
trigger the legacy fence and that unauthenticated Sync cannot expose system
tables. The package-release smoke exercises all four tenancy/authorization
profiles against distinct system and application planes.

Only behavior with a corresponding automated test is part of this verification
statement. Broader browser acceptance, restart, crash, race, and application-
upgrade scenarios must be evaluated by their own release checks. A generic
legacy splitter is not claimed by this release and is not a prerequisite for
the separated-plane runtime; fail-closed detection and deliberately verified
offline migration remain the current contract.
