# Fabric Multi-Tenant Example

This is a runnable Zero app with a shared control plane and a separate SQLite
database for every workspace. It demonstrates the complete supported path:

- multi-tenant auth and advanced RBAC;
- protected owner roles plus assignable `task-reader` and `task-editor` roles;
- a physical tenant `tasks` Resource with no `tenant_id` column;
- Resource policy enforcement shared by HTTP, lazy data, and Sync;
- realtime optimistic task CRUD through `useCollection()`;
- file placement by default and an optional, bounded hot-placement allowlist;
- packaged login, registration, tenant creation, member management, and tenant
  switching UI.

The shared `data/control.sqlite` file owns users, sessions, memberships, roles,
and other Zero internals. Application task rows exist only under
`data/tenants/`. Zero derives opaque filenames from authenticated tenant
capabilities; browser input never selects a filesystem path.

## Run locally

From this directory:

```sh
cp .env.example .env
openssl rand -base64 32
```

Replace `AUTH_BOOTSTRAP_SECRET` in `.env` with the generated value, then start
the app:

```sh
bun app/server.ts
```

Open `http://localhost:3210/register`. The first registration is the one-time
installation bootstrap: enter the bootstrap secret and create the first
workspace, for example **Alpha**. Later registrations remain public but never
receive platform ownership; each user may optionally create a workspace under
the configured `authenticated` tenant-creation policy.

The same `app/server.ts` is also the database-actor entrypoint. It runs
`runDatabaseActorIfRequested()` before dynamically importing `zero.config.ts`,
so actor children load only the side-effect-free realm and do not start HTTP.

## Verify two isolated workspaces

1. In Alpha, add a task with ID `shared-demo-task` and title `Alpha value`.
2. Use **New workspace** to create **Beta**.
3. In Beta, add ID `shared-demo-task` with title `Beta value`.
4. Switch between Alpha and Beta with the packaged workspace switcher.

Each workspace retains its own row even though both rows use the same primary
key. The UI clears and establishes a new authorization-safe Sync baseline when
the active tenant changes.

## Verify two users and realtime fanout

1. Register a second user in a private browser window and let that user create
   Beta during registration.
2. Sign back into the Alpha owner account. Open **Workspace members**, add the
   second user's registered email, and assign `task-editor`.
3. Keep Alpha open as the owner in one browser profile. In another profile,
   sign in as the second user and select Alpha.
4. Create, complete, or delete a task in either window.

The other window should update immediately. Then switch the second user to
Beta and reuse the same task ID to verify that realtime fanout and persistence
remain scoped to the selected tenant database.

## Verify restart durability

Stop the process normally, run `bun app/server.ts` again, sign in, and switch
between Alpha and Beta. Both isolated task sets should remain present. Default
file placement uses SQLite WAL. Allowlisted hot databases use `on-write`
durability, so a successful mutation is not acknowledged until its bounded
snapshot is durable.

## Inspect the files

With the app stopped, the control database should not contain `tasks`:

```sh
sqlite3 data/control.sqlite ".tables"
sqlite3 data/control.sqlite \
  "select name from sqlite_master where type='table' and name='tasks';"
```

The second command should print nothing. List the opaque tenant files and read
their task rows independently:

```sh
find data/tenants -maxdepth 1 -name '*.sqlite' -print
for database in data/tenants/*.sqlite; do
  echo "$database"
  sqlite3 "$database" \
    "select task_id, title, completed from tasks order by task_id;"
done
```

Do not infer tenant identity from a filename. The opaque mapping is an internal
Fabric boundary; the authenticated membership capability is authoritative.

## Opt selected tenants into bounded hot placement

Copy one or more tenant IDs shown beneath the active workspace name, stop the
app, and set the comma-separated allowlist:

```dotenv
ZERO_HOT_TENANT_IDS=tenant-id-one,tenant-id-two
ZERO_HOT_MAX_BYTES=67108864
```

Restart the app. The selector compares only values created by
`createTenantDatabaseRef()` and defaults every other database to `file`.
Placement is pinned for an active actor generation; changing the allowlist is
an operator restart/reopen decision, not an online database migration.
