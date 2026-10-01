# Guardian + ReactiveDB Fabric proof

This example is an end-to-end proof that Zero can combine Guardian's live
multi-tenant authority with ReactiveDB Fabric's actor-backed physical database
isolation. It includes a public landing page, Guardian registration and login,
workspace switching, a live proof center, a realtime task board,
customer-workspace management, self-service and administrator-issued API keys,
exact-email invitations, retained join requests, and protected
platform-administration surfaces.

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
- Task titles are trimmed and must contain 1 to 200 characters on every
  transport. They are immutable after creation in this proof; task updates move
  only the status. Creation time and both Guardian identity references are server-stamped;
  browser and API-key clients cannot claim chronology, ownership, membership,
  or a logical tenant selector.
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
| Privileged Zero system database | `data/system.db` | Guardian identities, password/session state, tenants, memberships, role assignments, invitations, retained join requests, API-key digests and lifecycle metadata, control-plane audit events, provisioning state, and other Zero-owned system data. |
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

`sqlite3` is optional and is needed only for the physical-boundary inspection
commands later in this guide.

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
setup secret plus an Administration workspace name. That first registration creates the
protected Administration Organization and its initial owner; the bootstrap
opportunity is then consumed.

Later public registrations follow the configured public-registration policy.
The scope-adaptive **Proof center** is the post-login destination for both the
Administration Organization and customer workspaces. Authenticated users may
also use **Create workspace** in the shell. Guardian
creates the customer workspace, owner membership, and replacement
tenant-bound session as one controlled flow; the browser does not manufacture
or edit its active tenant locally.

If you need to repeat first-bootstrap behavior, stop the app and reset only
this disposable example's `data/` directory after preserving anything you care
about. A normal restart should keep `data/system.db`, `data/application.db`,
and every managed tenant file intact.

## Suggested browser acceptance flow

Use separate browser profiles for distinct identities so one login does not
replace another profile's cookie or browser session:

| Actor | Suggested profile | Purpose |
| --- | --- | --- |
| Platform operator / customer owner | Profile A | Bootstrap, platform controls, customer ownership, onboarding review, and audits. |
| Existing invited member | Profile B | Existing-account invitation, viewer/editor/manager transitions, and multi-workspace selection. |
| New or requesting member | Profile C | Invited-account creation and retained join-request submission. |
| Realtime observer | A second window in the same profile | Proves two live subscribers without introducing another identity. |

1. In Profile A, bootstrap the first operator. Confirm the **Proof center**
   identifies the protected Administration Organization, its separate
   application authority, and the three storage planes. No customer task or
   security navigation should appear in this scope.
2. Open **Platform operations**. Invite or assign another platform
   administrator, change its administration role, and confirm its visible
   capabilities follow the live projection. Create or activate a global
   identity before assigning that email as the initial owner of a
   platform-created customer workspace. The UI gate is presentation only;
   every operation is reauthorized on the server.
3. Create customer workspaces A and B. While Profile A remains in the
   Administration Organization, select A under **Platform operations →
   Directory**, add Profile B as a customer member, change its role, and return
   it to the original role. Confirm the workspace People detail updates without
   switching Profile A into A and exposes no customer task data. Then enter A,
   wait for **Fabric data realm — Ready**, open **Realtime tasks**, and add two
   tasks. Open a second window in the same profile and confirm inserts and
   drag-to-complete status updates arrive through ReactiveDB Sync.
4. Switch to B and confirm its board starts empty. Add a different task set,
   switch repeatedly between A and B, and verify no previous-realm rows flash or
   leak. To prove identical primary keys physically coexist, issue one key in
   each workspace and run the fixed `api-proof-task` create command shown on
   **Security** in each scope.
5. In A, open **Members & access** and issue a manual exact-email invitation.
   In Profile B, open `/accept-invitation`, paste the once-revealed token, and
   complete the existing-account path. Repeat in Profile C with an email that
   has no account to exercise invited-account creation. The route removes token
   material from the URL and keeps a bounded current-tab handoff only when a
   sign-in round trip is required.
6. In Profile C, open `/request-access`, submit B's exact slug, and observe the
   deliberately non-enumerating receipt. In Profile A, open **Members & access
   → Onboarding** to review and approve or deny the retained request. After approval,
   switch Profile C into B and wait for its Fabric realm before opening tasks.
7. Assign Profile B `viewer`; confirm the board is realtime and read-only.
   Promote it to `editor`; confirm it can create and move only tasks stamped to
   that exact user and membership. Promote it to `manager`; confirm it can read,
   move, and delete every task. Demote it again and verify stale authority does
   not authorize a later write.
8. Give Profile B memberships in both A and B, sign out, then sign in again.
   Complete Guardian's workspace selector and verify the resulting session,
   proof-center projection, and Fabric realm all match the chosen workspace.
9. In **Security**, issue a self-service key. Run the list and create commands,
   observe the created row arrive in both live task windows, rotate the key and
   prove the old secret fails, then revoke the replacement and prove it fails.
   Under **Security → Member credentials**, issue a member key as the owner and
   confirm a viewer cannot do so. Back in the Administration Organization, open
   **Platform operations → Credentials**, select an active customer and member,
   and exercise platform-authorized issuance plus the global key directory.
10. From **Platform operations**, suspend A. Confirm its browser data access,
    Sync, and existing API key all fail closed. Reactivate A, switch or sign in
    again as required, and confirm the original task data returns unchanged.
11. Inside a customer scope, transfer the current owner's authority and confirm
    the packaged control clears that invalidated session and returns directly
    to sign-in. Separately, transfer a customer's ownership from the
    Administration Organization and confirm the platform actor stays signed in
    because its own administration scope did not change. Review **Members &
    access → Activity** and **Platform operations → Activity** for the completed
    control-plane actions.

The default configuration uses manual invitation delivery and never requires
putting the invitation token in a link. The acceptance route also understands a
fragment token, which is not sent in the initial HTTP request. Its current-tab
handoff expires after 30 minutes, is cleared on success or manual reset, and is
never reused as authorization truth; Guardian consumes the actual token.

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
The update allowlist contains only `status`, keeping the visible drag-to-move
contract identical for browser, session Resource, and API-key callers.
Manager access is an explicit RBAC branch, not an ownership bypass hidden in
the schema. The schema foreign keys and shallow anchors enforce existence and
retention; they do not grant access.

The whole `(dashboard)` route group exports:

```ts
export const config: RouteConfig = { auth: 'required' };
```

That route policy is server-enforced before rendering and mirrored by the
browser auth boundary. The public `/`, `/login`, `/register`,
`/accept-invitation`, and `/request-access` routes live in a separate route
group.

## API keys

Switch to a **customer** workspace and open **Security**. Multi-tenant API keys
cannot be issued for the protected Administration Organization. This example
enables self-service and administrator management with these bounds:

- default lifetime: 7 days;
- maximum lifetime: 30 days; and
- at most 5 active keys per user in one workspace scope.

Self-service uses **Security → My credentials**. Workspace owners can switch to
**Security → Member credentials**, choose an active member, and use the targeted
tenant-administrator control. Guardian
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
(
restore_tty() { stty echo; }
trap restore_tty EXIT HUP INT TERM
printf 'Guardian API key: ' >&2
stty -echo
IFS= read -r guardian_fabric_key
stty echo
printf '\n' >&2
trap - EXIT HUP INT TERM

printf 'header = "Authorization: Bearer %s"\n' "$guardian_fabric_key" \
  | curl -q --config - --fail-with-body \
      http://localhost:3100/api/resources/tasks
list_status=$?

printf 'header = "Authorization: Bearer %s"\n' "$guardian_fabric_key" \
  | curl -q --config - --fail-with-body \
      http://localhost:3100/api/resources/tasks \
      -X POST \
      -H 'Content-Type: application/json' \
      -H 'Idempotency-Key: readme-api-task-v1' \
      --data '{"task_id":"readme-api-task","title":"Created through a tenant-bound key","status":"open"}'
create_status=$?

unset guardian_fabric_key
unset -f restore_tty
test "$list_status" -eq 0 && exit "$create_status"
exit "$list_status"
)
```

The key stores no permission list. Every request resolves the current user,
customer membership, role assignments, tenant status, security generation,
key state, and expiry. A viewer key can list tasks but cannot write; an editor
key can create tasks and move only its own stamped tasks; a manager key can move
or delete every task. Revocation, account suspension, workspace or
membership suspension, removal of eligible live authority, expiry, or a
security-generation change affects subsequent requests immediately.

`created_at`, `created_by_user_id`, and `assigned_membership_id` are deliberately
absent from create input. The Resource stamps creation time and the live
Guardian actor on the server, and rejects attempts to submit any of those
fields.

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

The example-local contract tests check the Guardian-reference schema,
server-owned field boundaries, role matrix, guided journeys, scope-aware
navigation, onboarding input and current-tab handoff, and semantic Sync states.
The fixture test checks the Resource realm/exposure plus its declared
credential, permission, and customer-tenant branches, runs Doctor against this
exact configuration, and bundles this exact server entrypoint through Zero's
public package exports. The primary
integration test builds its temporary `createApp()` instance through the same
side-effect-free configuration factory as `zero.config.ts`, changing only
disposable paths and matching runtime-owned SQLite handles, the test actor
entrypoint, bootstrap secret, and event sink. The shipped advanced roles,
API-key policy, Resource, Fabric bounds, and topology therefore cannot silently
drift from the test. Real actor subprocesses and Sync clients verify:

- the privileged system and pinned application handles are distinct, neither
  contains `tasks`, and only the system database contains Guardian authority;
- a registration rolled back after system writes leaves no customer database
  file behind;
- an authenticated user can create a customer workspace, wait for its Fabric
  realm, submit a retained join request from another identity, approve it as
  the owner, switch into that workspace, and exercise isolated owned data;
- a Resource request made while identity projection is actively leased fails
  closed with stable `503 data-realm-not-ready`, never a raw FK conflict;
- successful task creates trim their titles and are stamped with a bounded
  server creation time plus the live Guardian user and membership IDs. Blank
  titles, client timestamps, identity/tenant spoof fields, and title updates
  are rejected without committing a row;
- each physical tenant file matches an exact allowed table-and-column contract
  with restrictive foreign keys and no Guardian authority or PII columns;
- two customer workspaces can store the same task primary key with different
  values in separate physical databases, and tenant B cannot list tenant A's
  row;
- spoofed tenant headers and query input cannot change API-key routing;
- two distinct users own rows in one workspace: an editor can list, read, and
  move only its own row, while a manager can move and delete either user's row;
  stale sessions fail after both role transitions;
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
| `.env.example` | Safe local environment template; the real bootstrap secret belongs only in untracked `.env`. |
| `zero.config.ts` | Small environment adapter for port, public URL, and the secret-gated bootstrap ceremony. |
| `tsconfig.json` | App-local `@app/*` route alias used by Zero's generated hydration bundle. |
| `db/schema.ts` | Shared `tasks` contract with declarative Guardian user/membership references and intentionally no `tenant_id`. |
| `db/tenant-realm.ts` | Side-effect-free schema installed in every physical tenant database. |
| `shared/task-access.ts` | Isomorphic permission/role registry shared by config, UI explanation, and contract tests. |
| `server/proof-config.ts` | Pure shared Guardian/RBAC/API-key/Fabric configuration factory with explicit disposable-runtime overrides. |
| `server/resources/tasks.ts` | Resource field policy, title normalization, RBAC branches, trusted chronology/actor stamping, immutable ownership, HTTP CRUD, and Sync authorization. |
| `app/server.ts` | Same-entry parent startup and Fabric actor bootstrap. |
| `app/layout.tsx` | One `ThemeProvider`, `AppProvider`, invitation-expiry guard, `ConfirmProvider`, and `Toaster`. |
| `app/auth-route-query.ts` | Pure invitation/slug validation, clean-URL projection, and bounded current-tab invitation handoff. |
| `app/(public)/` | Landing, login, registration, manual invitation acceptance, and retained access-request routes. |
| `app/(dashboard)/` | Auth-required proof center, tasks, member/security/platform controls, workspace creation, and route-owned shell. |
| `app/components/` | Scope-aware shell, compact control-plane modes, live proof/status/access panels, API-key guide, invitation-expiry guard, and tenant/platform credential selectors composed around packaged Guardian controls. |
| `app/tasks/` | Realtime collection orchestration, exact access summary, cards, and Resource-backed board actions. |
| `app/proof-ui-contract.test.ts` | Pure UI/security contract coverage for scopes, journeys, onboarding handoff, role matrix, fields, and Sync states. |
