# Guardian + ReactiveDB Fabric proof

This example is an end-to-end proof that Zero can combine Guardian's live
multi-tenant authority with ReactiveDB Fabric's actor-backed physical database
isolation. It includes a public landing page, Guardian registration and login,
workspace switching, a realtime task board, customer-workspace management,
self-service and administrator-issued API keys, exact-email invitations, and
protected platform-administration surfaces. Retained join requests are
deliberately disabled because this focused proof does not expose a public or
verified-domain request-admission flow.

The example exercises the active, unreleased Guardian + Fabric release
candidate. It is useful for integration review and local acceptance testing;
it is not a statement that Fabric's remaining fleet operations, deployment
matrix, backup/restore, or online placement migration work is release-complete.

## What this proves

- The active tenant is derived from a live Guardian session or tenant-bound API
  key. A request header, query string, task body, or browser UI state cannot
  choose another tenant's database.
- `tasks` has no `tenant_id` column. Fabric routes the Resource and its Sync
  plane into the active customer workspace's physical SQLite database.
- Every task carries `created_by_user_id` and `assigned_membership_id` foreign
  keys declared with `field.guardianUser()` and `field.guardianMembership()`.
  Zero installs the required ID-only anchors and projects the active Guardian
  identities before a Resource write reaches the tenant database.
- `guardianActorPolicy()` stamps both references from server-owned request
  authority, constrains contributor reads to that actor, and makes the
  references immutable. Callers never submit trusted ownership fields.
- Realtime reads use `useCollection('tasks')`; browser writes use the generated
  `tasks` Resource through `useResourceActions('tasks')`.
- The board does not mount its Sync subscription without live `tasks:read`;
  `DataRealmReadyGate` also keeps the board unmounted until the newly active
  tenant realm has completed idempotent schema/identity projection setup.
  Guardian workspace switching and logout stay outside that gate so a failed
  realm cannot trap the user. Contributor and manager affordances follow their
  narrower permissions. Those UI checks are presentation only: Resource policy
  independently restricts the Resource to a customer workspace, reauthorizes
  every operation, validates live membership ownership, and Fabric fences
  commits against authority changes.
- Guardian control-plane management stays session-only even though the task
  Resource explicitly admits both sessions and API keys.

## Storage architecture, honestly

This proof keeps Zero's privileged system plane, the app's pinned application
plane, and Fabric tenant application planes physically distinct:

| Plane | Location | Current contents |
| --- | --- | --- |
| Privileged Zero system database | `data/system.db` | Guardian identities, password/session state, tenants, memberships, role assignments, API-key digests and lifecycle metadata, control-plane audit events, provisioning state, and other Zero-owned system data. |
| Pinned application database | `data/application.db` | The app plane required by Zero's topology. It is intentionally empty/minimal in this proof because every customer `tasks` realm is a tenant file. It never receives Guardian credentials, sessions, RBAC, or other system records. |
| Fabric tenant databases | `data/tenant-databases/db-*.sqlite` | The `tasks` table, ID-only `users` and `tenant_memberships` anchors required by its foreign keys, ReactiveDB change state, and Fabric mutation receipts for one physically bound tenant scope per database. |

The task table is deliberately absent from both `system.db` and
`application.db`. Conversely, this example does **not** claim that Guardian's
system records are physically sharded per customer: those records remain in
the single privileged system database. Physical isolation here is the
application-data boundary for the tenant-realm `tasks` Resource.

The local anchor rows are deliberately shallow. `users` contains only
`user_id`; `tenant_memberships` contains membership, tenant, and user IDs.
They contain no email, display name, role, status, or permission material and
must never be queried as authorization truth. Guardian's live system authority
remains the only source for tenant status, membership status, RBAC, sessions,
and API-key validity. Anchor rows are retained so historical task attribution
and `ON DELETE RESTRICT` foreign keys remain stable.

Each tenant file is owned by an isolated Bun subprocess actor. File placement
uses SQLite/WAL, and `readers: true` allows a separate read actor to overlap
committed reads with the writer. The parent process owns a bounded coordinator:
at most 32 active databases, 1,000 managed database files, 24 distinct
tenant-Sync databases, and 32 persistent Sync bindings per database in this
example. These are admission/resource bounds, not a tenant-count promise.

Managed filenames are digest-bound implementation details beneath the exclusive
Fabric root. Do not use filenames as tenant identifiers or authority. The
parent derives the binding from Guardian's trusted active scope, and the actor
verifies the realm/schema contract before serving work. At an authorized final
commit, the tenant writer also rereads the captured system authority revision
while holding a shared lease on Zero's file-backed authority sidecar. Different
tenant writers retain concurrent commits; a Guardian authority change takes
the exclusive side and cannot interleave that boundary.

## Run locally

Prerequisites:

- the repository dependencies installed with `bun install`;
- the candidate's validated Bun runtime; and
- `openssl` (or another cryptographically secure generator) for the one-time
  bootstrap secret.

Run from the example directory because its database, generated, build, and
storage paths are intentionally relative:

```sh
cd examples/guardian-fabric-proof
cp .env.example .env
openssl rand -base64 32
```

Put the generated value in `.env` as `AUTH_BOOTSTRAP_SECRET`. Do not commit the
file or reuse the example placeholder. Then start the parent server; it will
spawn Fabric database actors from the same source entrypoint as needed:

```sh
bun --env-file=.env run app/server.ts
```

Open <http://localhost:3100>. Runtime data is created beneath this example's
`data/` directory, generated modules beneath `.zero/generated/`, and client
build output beneath `.build/`.

### First bootstrap

On a brand-new system database, choose **Create account**. Guardian's packaged
registration form detects the unconsumed bootstrap and asks for the operator
setup secret plus an organization name. That first registration creates the
protected Administration Organization and its initial owner; the bootstrap
opportunity is then consumed.

Later public registrations follow the configured public-registration policy.
Authenticated users may also use **Create workspace** in the shell. Guardian
creates the customer workspace, owner membership, and replacement
tenant-bound session as one controlled flow; the browser does not manufacture
or edit its active tenant locally.

If you need to repeat first-bootstrap behavior, stop the app and reset only
this disposable example's `data/` directory after preserving anything you care
about. A normal restart should keep `data/system.db`, `data/application.db`,
and every managed tenant file intact.

## Suggested browser acceptance flow

1. Bootstrap the first operator and confirm the shell initially identifies the
   protected Administration Organization.
2. Open **Platform operations**. The page is wrapped in
   `AdministrationScopeGate` and composes the packaged administrator,
   global-identity, customer-workspace, API-key directory, and platform-audit
   controls. Create or activate a global identity before assigning that email
   as the initial owner of a platform-created customer workspace. The gate only
   controls presentation; each control relies on server-projected capabilities
   and server authorization.
3. Create a customer workspace from the workspace menu, then add two tasks.
   Open a second browser window in the same workspace and confirm inserts and
   drag-to-complete updates arrive through realtime Sync.
4. Create another customer workspace. Its task board starts empty. Add
   different tasks, switch between the two workspaces, and confirm each board
   restores only that workspace's rows.
5. In **Workspace**, use the packaged member and onboarding controls. The
   default no-email configuration issues manual invitation material. Open
   `/accept-invitation`, paste the one-time token into its secret input, and
   complete the public, exact-email acceptance flow. Test both an existing
   account and the packaged invited-account creation path. This example does
   not enable join requests. Assign `viewer` for
   `tasks:read` plus `tasks:read:any`, or `editor` for `tasks:read`,
   `tasks:create`, and `tasks:update:own`.
6. Sign in as a viewer. The board remains realtime and read-only across the
   workspace. Assign the editor role and confirm the member can create, read,
   and move only tasks stamped to that exact user and membership. Assign the
   manager role and confirm the member can read, move, and delete every task.
   Refresh/re-authenticate whenever Guardian requests it after an authority
   transition.
7. Select an active member under **Member automation credentials** and confirm
   the owner can issue, rotate, and revoke that member's finite key while a
   viewer cannot. Review the workspace audit on **Workspace** and the platform
   audit while switched back to the Administration Organization.

### Inspect the physical boundary

With the app stopped (or using SQLite read-only tooling that correctly handles
WAL), inspect the separated system and application schemas:

```sh
sqlite3 data/system.db ".tables"
sqlite3 data/application.db ".tables"
sqlite3 data/system.db "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'tasks';"
sqlite3 data/application.db "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'tasks';"
```

Both `tasks` queries should return no row. List the managed tenant databases
and inspect their task counts:

```sh
find data/tenant-databases -maxdepth 1 -name 'db-*.sqlite' -print
for database in data/tenant-databases/db-*.sqlite; do
  sqlite3 "$database" "SELECT count(*) AS task_count FROM tasks;"
  sqlite3 "$database" "PRAGMA foreign_key_list(tasks);"
  sqlite3 "$database" "SELECT count(*) AS user_anchors FROM users;"
  sqlite3 "$database" "SELECT count(*) AS membership_anchors FROM tenant_memberships;"
done
```

File order is not a tenant mapping API. Use the browser's trusted workspace
switch to demonstrate ownership; filesystem inspection is only a local proof
that separate task tables exist and neither pinned database contains one.

## Roles and enforcement

The app declares three customer-workspace roles:

| Role | Permissions | Board behavior |
| --- | --- | --- |
| `viewer` | `tasks:read`, `tasks:read:any` | Receives every task in the tenant Sync plane and sees a read-only board. |
| `editor` | `tasks:read`, `tasks:create`, `tasks:update:own` | May create tasks stamped to its live Guardian actor and read/move only those tasks. |
| `manager` | Viewer and editor permissions plus `tasks:manage` | May read, move, and delete every task in the active tenant database. |

Guardian's protected owner/system authority remains responsible for membership
and ownership operations. `PermissionGate` and `useHasPermission` make the task
UI understandable, but they are never treated as proof. The server Resource
requires a live user, a live tenant, an admitted credential class, and the
relevant permission. It also composes `tenantKindPolicy('organization')`, so
the protected Administration Organization cannot open a task data plane even
though its owner has broad platform authority. A role or membership change can
invalidate captured authority before a write commits.

The Resource does not expose either reference in its create/update allowlist.
`guardianActorPolicy()` stamps them after client-field validation from the
captured server principal and active tenant membership. It constrains editor
lists/gets/updates to both IDs and rejects attempts to mutate either reference.
Manager access is an explicit RBAC branch, not an ownership bypass hidden in
the schema. The schema foreign keys and shallow anchors enforce existence and
retention; they do not grant access.

The whole `(dashboard)` route group exports:

```ts
export const config: RouteConfig = { auth: 'required' };
```

That route policy is server-enforced before rendering and mirrored by the
browser auth boundary. The public `/`, `/login`, `/register`, and
`/accept-invitation` routes live in a separate route group.

## API keys

Switch to a **customer** workspace and open **Security**. Multi-tenant API keys
cannot be issued for the protected Administration Organization. This example
enables self-service and administrator management with these bounds:

- default lifetime: 7 days;
- maximum lifetime: 30 days; and
- at most 5 active keys per user in one workspace scope.

Self-service uses the packaged control on **Security**. Workspace owners can
also open **Workspace**, choose an active member under **Member automation
credentials**, and use the targeted tenant-administrator control. Guardian
projects issue, rotate, and revoke capabilities independently for the selected
member; the picker itself grants no authority.

Copy the `zero_ak_v1...` secret when it is shown. Guardian returns it only once
and stores a SHA-256 digest plus safe display/lifecycle metadata in the
privileged system database. Dismissing the reveal clears component memory, but
cannot erase a secret already copied elsewhere. Never put a key in source control, a URL,
browser storage, screenshots, analytics, or logs.

The task Resource explicitly accepts `session` and `api-key` credentials for
read and write policies. Present a key as a Bearer token over TLS (plain HTTP is
acceptable only for this localhost proof). The following shell fragment reads
the key without echo, keeps it out of the exported environment, and gives it to
curl through standard input rather than a process argument:

```sh
restore_tty() { stty echo; }
trap restore_tty EXIT HUP INT TERM
printf 'Guardian API key: ' >&2
stty -echo
IFS= read -r guardian_fabric_key
stty echo
printf '\n' >&2
trap - EXIT HUP INT TERM

printf 'header = "Authorization: Bearer %s"\n' "$guardian_fabric_key" \
  | curl --config - --fail-with-body \
      http://localhost:3100/api/resources/tasks

printf 'header = "Authorization: Bearer %s"\n' "$guardian_fabric_key" \
  | curl --config - --fail-with-body \
      http://localhost:3100/api/resources/tasks \
      -X POST \
      -H 'Content-Type: application/json' \
      -H 'Idempotency-Key: readme-api-task-v1' \
      --data '{"task_id":"readme-api-task","title":"Created through a tenant-bound key","status":"open","created_at":1893456000000}'

unset guardian_fabric_key
unset -f restore_tty
```

The key stores no permission list. Every request resolves the current user,
customer membership, role assignments, tenant status, security generation,
key state, and expiry. A viewer key can list tasks but cannot write; an editor
key can create and update its own stamped tasks; a manager key can manage every
task. Revocation, account suspension, workspace or
membership suspension, removal of eligible live authority, expiry, or a
security-generation change affects subsequent requests immediately.

Changing `X-Tenant-Id`, `X-Zero-Tenant-Id`, a query `tenantId`, or JSON fields
does not redirect the key to another database. Its exact customer membership
is the routing authority. API keys do not authenticate the Sync WebSocket and
cannot call Guardian's key-management/control-plane routes; those remain
interactive-session surfaces.

## Automated integration path

From the repository root, run the focused real-app integration test:

```sh
bun test \
  examples/guardian-fabric-proof/server/resources/tasks.test.ts \
  examples/guardian-fabric-proof/app/proof-ui-contract.test.ts \
  src/frontend/server/guardian-fabric-proof-fixture.test.ts \
  src/frontend/server/guardian-fabric.integration.test.ts \
  --timeout 120000
```

The example-local contract tests check the Guardian-reference schema and
trusted-ownership Resource shape plus the small UI constants that control Sync
admission, workspace navigation, and semantic status color. The fixture test
checks the complete Resource policy, runs Doctor against this exact
configuration, and bundles this exact server entrypoint through Zero's public
package exports, preventing the shipped example from drifting. The primary
integration test builds its temporary `createApp()` instance through the same
side-effect-free configuration factory as `zero.config.ts`, changing only
disposable paths and matching runtime-owned SQLite handles, the test actor
entrypoint, bootstrap secret, and event sink. The shipped advanced roles,
API-key policy, Resource, Fabric bounds, and topology therefore cannot silently
drift from the test. Real actor subprocesses and Sync clients verify:

- the privileged system and pinned application handles are distinct, neither
  contains `tasks`, and only the system database contains Guardian authority;
- a Resource request made while identity projection is actively leased fails
  closed with stable `503 data-realm-not-ready`, never a raw FK conflict;
- successful task creates are stamped with the live Guardian user and
  membership IDs, and each physical tenant file matches an exact allowed
  table-and-column contract with restrictive foreign keys and no Guardian
  authority or PII columns;
- two customer workspaces can store the same task primary key with different
  values in separate physical databases, and tenant B cannot list tenant A's
  row;
- spoofed tenant headers and query input cannot change API-key routing;
- two distinct users own rows in one workspace: an editor can list, read, and
  update only its own row, while a manager can update and delete either user's
  row; stale sessions fail after both role transitions;
- tenant Sync delivers Resource-originated inserts, updates, and deletes to two
  live subscribers without crossing workspace boundaries;
- the exact task Resource admits a key while its user is a viewer but denies
  writes, grants own-row writes after the live role becomes editor, and grants
  cross-owner management after the live role becomes manager;
- rotation immediately rejects the old key and authenticates the returned
  replacement key; revocation then immediately rejects the replacement too;
- removing the second membership does not erase its ID-only user/membership
  anchors, preserving historical foreign-key attribution without retaining
  profile or credential data.

A separate focused `todos` Resource scenario—not the shipped task Resource—is
retained to exercise two lower-level policy edges: a session-only action rejects
an API key, and revoking a key while a mutation is in flight fences the commit,
returns `resource-authority-changed`, preserves the old row, and rejects later
use. Browser rendering, keyboard behavior, and the packaged management flows
remain part of the manual acceptance path above rather than this server test.

Useful focused build checks for this example are:

```sh
bun build examples/guardian-fabric-proof/app/server.ts \
  --target bun \
  --outdir .zero/guardian-fabric-proof-server-build

cd examples/guardian-fabric-proof
bunx tsc --noEmit -p tsconfig.json
```

Run the repository's broader test and Doctor suites before making deployment
claims. Fabric root ownership, actor/process limits, backup/restore, service
supervision, TLS, secrets, and persistent-volume operations are deployment
responsibilities beyond this proof's UI.

## File map

| Path | Responsibility |
| --- | --- |
| `zero.config.ts` | Small environment adapter for port, public URL, and the secret-gated bootstrap ceremony. |
| `tsconfig.json` | App-local `@app/*` route alias used by Zero's generated hydration bundle. |
| `db/schema.ts` | Shared `tasks` contract with declarative Guardian user/membership references and intentionally no `tenant_id`. |
| `db/tenant-realm.ts` | Side-effect-free schema installed in every physical tenant database. |
| `server/proof-config.ts` | Pure shared Guardian/RBAC/API-key/Fabric configuration factory with explicit disposable-runtime overrides. |
| `server/resources/tasks.ts` | Resource field policy, RBAC branches, trusted actor stamping, immutable ownership, HTTP CRUD, and Sync authorization. |
| `app/server.ts` | Same-entry parent startup and Fabric actor bootstrap. |
| `app/layout.tsx` | One `ThemeProvider`, `AppProvider`, `ConfirmProvider`, and `Toaster`. |
| `app/(public)/` | Landing, login, registration, and invitation-acceptance routes. |
| `app/(dashboard)/` | Auth-required pages and route-owned application shell. |
| `app/components/` | Workspace-aware shell plus the app-owned member selector composed with Guardian's packaged API-key control. |
| `app/tasks/` | Realtime collection projection and Resource-backed board actions. |
