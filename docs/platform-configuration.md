# Platform Configuration

Zero currently has one runtime configuration contract: the `AppConfig` object
passed to `createApp()`. `defineZeroConfig()` and `defineAuthConfig()` are
runtime-neutral type helpers; both return the object they receive unchanged.
`resolveConfig()` applies defaults and validates cross-feature constraints when
the app starts.

> **Current status:** `createApp()` does not discover config modules. There is
> no supported `configDir`, `auth.config`, `access.config`, or config-file
> precedence API. The app must import and compose every config value before it
> calls `createApp()`.

## Supported Current Pattern

Keep the complete app contract in `zero.config.ts`. If auth behavior becomes
large, put it in an ordinary TypeScript module and import its
`defineAuthConfig()` result into `zero.config.ts`. The filename is an app
convention, not a Zero discovery hook.

```ts
// config/auth.ts
import { defineAuthConfig } from '@zero/framework/server';

export default defineAuthConfig({
  tenancy: 'single',
  authorization: 'simple',
  bootstrap: {
    mode: 'secret',
    secret: Bun.env.AUTH_BOOTSTRAP_SECRET || undefined,
  },
  registration: {
    mode: 'admin-only',
  },
  userProperties: {
    department: {
      type: 'enum',
      values: ['accounting', 'operations'],
      editableBy: 'admin',
      useInPolicies: true,
    },
  },
});
```

```ts
// zero.config.ts
import { defineZeroConfig } from '@zero/framework/server';
import { tables } from './db/schema';
import auth from './config/auth';

export default defineZeroConfig({
  db: { mode: 'file', path: './data/app.db' },
  systemDb: { mode: 'file', path: './data/zero.system.db' },
  tables,
  auth,
  port: 3000,
});
```

The server entry imports that object explicitly:

```ts
// app/server.ts
import { createApp } from '@zero/framework/server';
import config from '../zero.config';

const app = await createApp(config);
app.listen(config.port ?? 3000);
```

Inline composition is also supported and uses the same contract:

```ts
import {
  createApp,
  defineAuthConfig,
  defineZeroConfig,
} from '@zero/framework/server';
import { tables } from './db/schema';

const app = await createApp(defineZeroConfig({
  db: { mode: 'file', path: './data/app.db' },
  systemDb: { mode: 'file', path: './data/zero.system.db' },
  tables,
  auth: defineAuthConfig({
    bootstrap: {
      mode: 'secret',
      secret: Bun.env.AUTH_BOOTSTRAP_SECRET || undefined,
    },
    registration: {
      mode: 'public',
    },
  }),
}));
```

`db` is always the application plane. `systemDb` is the separate Zero-owned
plane for Guardian and platform authority. Their handles, main files,
snapshots, WAL/SHM files, and rollback journals must not overlap. Omission uses
an independent ephemeral system plane when `db` is ephemeral and otherwise
defaults to durable `./data/zero.system.db`; production apps should configure
the durable path explicitly. See
[System and Application Database Planes](./framework/system-database.md).
Legacy apps whose one database contains private Guardian/Zero tables must be
backed up, stopped, and deliberately split offline before adopting this
version. Startup detects that combined layout and fails closed; Zero does not
silently move rows or currently ship a generic splitter. An application-owned
`users` table by itself is valid and does not trigger the legacy fence.

`defineAuthConfig()` covers auth behavior. Top-level auth token lifetimes still
belong on the `auth` value accepted by `AppConfig`; add them while composing the
app config if needed. Access policy is not a top-level `access` config object:
use `resources`, `syncPolicy`, and the supported `server/resources` and route
extension surfaces.

The Doctor CLI is separate from runtime startup. When `--config` is omitted it
can locate `zero.config.ts`, `zero.config.js`, `config/zero.config.ts`, or
`config/zero.config.js`. That convenience does not make `createApp()` discover
or load the file.

## Effective Config

`resolveConfig()` normalizes the complete `AppConfig` after it has been
explicitly composed. Current auth behavior can also be passed inline:

```ts
createApp({
  app: {
    name: Bun.env.APP_NAME ?? 'Acme CRM',
    publicUrl: Bun.env.APP_PUBLIC_URL ?? 'https://crm.example.com',
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
  },
  db,
  tables,
  email: Bun.env.RESEND_API_KEY
    ? {
        from: Bun.env.EMAIL_FROM ?? 'Acme CRM <noreply@example.com>',
        replyTo: Bun.env.EMAIL_REPLY_TO,
        provider: 'resend',
        resend: {
          apiKey: Bun.env.RESEND_API_KEY,
        },
      }
    : false,
  auth: {
    tenancy: 'single',
    authorization: 'simple',
    bootstrap: {
      mode: 'secret',
      secret: Bun.env.AUTH_BOOTSTRAP_SECRET || undefined,
    },
    registration: {
      mode: 'admin-only',
    },
    account: {
      requireEmailVerification: Bun.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
      emailVerificationPath: Bun.env.AUTH_EMAIL_VERIFICATION_PATH ?? '/verify-email',
    },
    accountEmails: {
      adminCreatedUser: Boolean(Bun.env.RESEND_API_KEY),
      passwordReset: Boolean(Bun.env.RESEND_API_KEY),
      manualPasswordReset: Bun.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
      actionTokenTTL: Bun.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
      requestCooldown: Bun.env.AUTH_ACCOUNT_EMAIL_COOLDOWN ?? '5m',
    },
    branding: {
      appName: Bun.env.APP_NAME ?? 'Acme CRM',
      logoUrl: Bun.env.APP_LOGO_URL,
      supportEmail: Bun.env.APP_SUPPORT_EMAIL,
      brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
    },
    userProperties: {
      department: {
        type: 'enum',
        values: ['accounting', 'operations'],
        editableBy: 'admin',
        useInPolicies: true,
      },
    },
  },
  ai: true,
  vector: Bun.env.ZERO_VECTOR_ENABLED === 'true'
    ? {
        dataDir: Bun.env.ZERO_VECTOR_DATA_DIR ?? './data/vector',
        defaultDimensions: Number(Bun.env.ZERO_VECTOR_DEFAULT_DIMENSIONS ?? 1536),
      }
    : false,
  pdf: Bun.env.ZERO_PDF_ENABLED === 'true'
    ? {
        browser: {
          executablePath: Bun.env.ZERO_PDF_EXECUTABLE_PATH,
        },
      }
    : false,
});
```

### ReactiveDB Fabric topology

`databaseTopology` is the typed configuration surface for Fabric. Omitting it,
or using `{ mode: 'single' }`, keeps one pinned application database alongside
the separate system database. `mode: 'multiple'` keeps `db` as the pinned
shared application database and adds a bounded coordinator for named or
physical-tenant application databases. Fabric never stores Guardian authority
in `db` or a tenant file.

The actor realm must be a side-effect-free module shared by the app config and
the subprocess bootstrap. It defines only the tables, migrations, and named
operations that may execute inside those databases:

```ts
// server/tenant-database.realm.ts
import { defineDatabaseRealm } from '@zero/framework/server';
import { tenantTables } from '../db/schema';

export const tenantDatabaseRealm = defineDatabaseRealm({
  name: 'tenant-data',
  version: '1',
  tables: tenantTables,
  migrations: [],
  queries: {},
  commands: {},
});
```

Each realm table must have exactly one primary-key column whose declared SQLite
affinity is `TEXT` or `INTEGER`; `TEXT` is recommended. Safe integer values are
canonicalized to string row IDs across Fabric and Sync. Realm definition rejects
`REAL`, `BLOB`, `NUMERIC`, typeless, and composite primary keys with
`DATABASE_CONFIG_INVALID` before startup. Doctor identifies the exact column
for definition or affinity failures and the table for missing or multiple
primary-key declarations. Each schema value must also remain one isolated
column definition; top-level commas or semicolons, table-constraint injection,
unbalanced grouping, ambiguous quoted multi-token declared types, and
unterminated quotes or comments fail closed.

Fabric realms add a whole-row portability contract to those primary-key rules.
Every non-primary column must resolve to `TEXT`, `INTEGER`, `REAL`, or
`NUMERIC` affinity; `BLOB` and typeless columns cannot cross the durable JSON
receipt/actor boundary. Generated (`... AS (...)`) columns are read-only SQLite
columns and are rejected because ReactiveDB writes every declared realm column.
Mutating foreign-key actions (`CASCADE`, `SET NULL`, and `SET DEFAULT`) are also
rejected because they could change a tracked row without a matching event.
Realm table names cannot use SQLite's `sqlite_` namespace, Zero's `_zero_` or
`idx_zero_` namespaces, or the legacy `_changes`, `_change_sequence`, and
`_migrations` names. A generated `_identity` index must not collide with any
realm table or reserved object name. These deterministic failures return
`DATABASE_CONFIG_INVALID` from `defineDatabaseRealm()`; SQLite still compiles
the complete application SQL when the actor opens, so this admission layer is
not a substitute for SQLite syntax validation.

Registered commands receive a frozen `DatabaseWriteCommandCapability` with
tracked CRUD/read, natural-identity, nested transaction, and `afterCommit`
methods. It exposes no raw SQL, SQLite handle, schema/lifecycle methods,
listeners, or internal-change APIs; command execution and result validation
share the writer transaction.

```ts
// zero.config.ts
import { fileURLToPath } from 'node:url';
import { defineZeroConfig } from '@zero/framework/server';
import { tables } from './db/schema';
import { resources } from './server/resources';
import { tenantDatabaseRealm } from './server/tenant-database.realm';

export default defineZeroConfig({
  db: { mode: 'file', path: './data/control.sqlite' },
  auth: { tenancy: 'multi' },
  tables,
  resources,
  databaseTopology: {
    mode: 'multiple',
    rootDirectory: './data/tenant-databases',
    realm: tenantDatabaseRealm,
    actors: {
      launch: {
        kind: 'source',
        entrypoint: fileURLToPath(new URL('./app/server.ts', import.meta.url)),
      },
      // env is an explicit allowlist; the parent environment is not copied.
      env: {},
    },
    tenantIsolation: 'tenant-database',
    placement: 'file',
    maxDatabases: 16,
    maxDatabaseFiles: 10_000,
    maxTenantSyncDatabases: 15,
    maxTenantSyncBindingsPerDatabase: 64,
    readers: true,
    restart: {
      initialDelayMs: 10,
      maxDelayMs: 1_000,
      circuitFailureThreshold: 5,
      circuitCooldownMs: 5_000,
    },
  },
});
```

The real app entry must branch through the actor bootstrap before ordinary
server startup:

```ts
import {
  createApp,
  runDatabaseActorIfRequested,
} from '@zero/framework/server';
import config from '../zero.config';
import { tenantDatabaseRealm } from '../server/tenant-database.realm';

if (!await runDatabaseActorIfRequested({ realm: tenantDatabaseRealm })) {
  const app = await createApp(config);
  app.listen(config.port ?? 3000);
}
```

`placement` accepts `'file'`, bounded `'hot'` shorthand, or an object with a
default, optional synchronous selector, and explicit hot durability/byte
budget. A selector receives only an opaque, pseudonymous database reference,
must return synchronously, and cannot inspect a raw tenant name supplied by a
request. The deterministic reference is unkeyed operational correlation
metadata, not a secret or authorization capability; low-entropy source IDs can
be guess-correlated. Placement stays pinned while an entry is active; changing
policy does not move an open database.

`restart` controls actor replacement independently for each physical database.
The values above are the defaults: exponential delays begin at 10 ms and cap
at 1 second; after five consecutive replacement attempts, Fabric makes one
half-open attempt per 5-second cooldown until a bind succeeds. Success resets
the entry's count. Releasing its last lease or draining the app cancels a
pending delay. Operations waiting during recovery remain subject to the
ordinary queue limits, timeout, and cancellation signal.

Fabric validates actor/file/queue/timer bounds and the relationship between
`maxDatabases`, tenant-Sync admission, auth mode, Resources, and the realm
schema. Configuration resolution does not create directories or database
files. Startup then repeats filesystem ownership checks before opening the
application and system databases, actor root, or object storage. Do not reuse
`outDir`, either pinned database path, or Storage's owned root/tmp/blob
directories as the Fabric root. Newly scaffolded apps ignore `data/` plus common `.db`/`.sqlite`
main, WAL, SHM, and rollback-journal filenames. Existing apps or custom roots
must apply equivalent source-control exclusions; tenant database files and
sidecars are runtime data, never application assets.

This is a supported Zero 2.0 surface. Its exact options, durability semantics,
error contract, deployment requirements, and deliberate exclusions are
authoritative in
[ReactiveDB Fabric: Multi-Database Architecture](./framework/multi-database-architecture.md).

### Optional Data Studio

Data Studio is the opt-in Guardian/Fabric control plane for organization-owned
logical tables. Install its fragments explicitly in a multi-tenant advanced-
authorization app:

```ts
import { createDataStudioFeature } from '@zero/framework/data-studio/server';

const dataStudio = createDataStudioFeature();

export default defineZeroConfig({
  tables: { ...appTables, ...dataStudio.appTables },
  resources: [...appResources, ...dataStudio.resources],
  auth: {
    tenancy: { mode: 'multi' },
    authorization: {
      mode: 'advanced',
      registryVersion: 3,
      permissions: { ...appPermissions, ...dataStudio.permissions },
      roles: {
        ...appRoles,
        'data-studio-viewer': dataStudio.roleFragments.viewer,
        'data-studio-editor': dataStudio.roleFragments.editor,
        'data-studio-manager': dataStudio.roleFragments.manager,
      },
    },
  },
  databaseTopology: {
    mode: 'multiple',
    // Compose DATA_STUDIO_REALM_CONTRIBUTION into this exact realm.
    realm: tenantDatabaseRealm,
    tenantIsolation: 'tenant-database',
    // ...required rootDirectory/actors and ordinary Fabric options
  },
});
```

`appTables` is the `createApp()` fragment: it carries full-sync catalog
metadata, lazy row metadata, and server-only private tables. These generic
projections omit complete schemas/values; the dedicated Data Studio API returns
the bounded full records. `tables` on the feature object is the underlying raw
actor schema. The browser separately merges `DATA_STUDIO_CLIENT_TABLES` into
`AppProvider({ tables })`. Spread `dataStudio.appTables` unchanged into app
configuration; using raw `DATA_STUDIO_TENANT_TABLES`, changing catalog `full` or
row `lazy` Sync, or altering a fixed schema—including Guardian reference
metadata or mutation validators—fails startup with `DATABASE_CONFIG_INVALID`.

Spread `dataStudio.resources` unchanged. Zero validates the exact normalized
official Resource name, table, primary key, exposure, realm, actions, field
allow-lists, and policy before auto-mounting the built-in router. A partial or
altered Resource contract fails startup with `DATABASE_CONFIG_INVALID`; those
declarations are not customization templates. The actor entrypoint must pass
the same composed realm to `runDatabaseActorIfRequested()` that the topology
uses; do not pass the pre-composition app realm or replace official Data Studio
query/command handlers behind the same operation names. Handler substitution
also fails with `DATABASE_CONFIG_INVALID`. Adding the permission or role
semantics follows Guardian's normal `registryVersion` bump rule.

See [Data Studio](./data-studio.md) for complete realm composition, browser and
headless APIs, schema evolution, limits, idempotency, and upgrade/removal
guidance.

### Torrent workflow configuration

**Torrent** is Zero's durable workflow and orchestration system. The product
name does not rename the established `workflows` configuration or any
`Workflow*`, `/workflows/*`, `WORKFLOW_*`, or `workflows.*` contract.

Set `workflows: false` to omit Torrent. With Auth enabled, omitting the option
installs the managed runtime. Use an object to configure application startup,
shutdown, and interaction authority:

```ts
export default defineZeroConfig({
  // db, systemDb, tables, auth...
  workflows: {
    async register(registry) {
      registry.registerActivity({
        name: 'records.refresh',
        version: '1',
        handler: async (ctx) => refreshRecord(ctx.input, ctx.signal),
      });
    },
    shutdownGraceMs: 30_000,
    interactionAuthority,
  },
});
```

| Option | Contract |
| --- | --- |
| `register` | Registers trusted activity implementations and code-authored definitions during composition. Zero awaits it before recovery or service publication. |
| `shutdownGraceMs` | Maximum wait for handlers that ignore cooperative cancellation. Defaults to 30,000 ms; use `0` only when immediate shutdown fencing is intentional. |
| `interactionAuthority` | Fail-closed Guardian/application policy adapter for human or agent responses. Async allows require the revision-aware commit lease documented in the Torrent guide. |

See [Torrent: Durable Workflows](./workflows.md) for the DSL, database-defined
graphs, versioning, memory, interactions, recovery, Fabric activity data,
real-time monitoring, error contract, and external-effect idempotency rules.

### File-storage capability signing

`createApp()` mounts authenticated file storage whenever auth is enabled.
`storageDir` continues to select the local blob directory; the optional
`storage` object controls signed bearer capabilities:

```ts
createApp({
  db: { mode: 'file', path: './data/app.db' },
  tables,
  auth: true,
  storageDir: './data/files',
  storage: {
    // Explicit config wins over ZERO_STORAGE_SIGNING_SECRET.
    signingSecret: Bun.env.ZERO_STORAGE_SIGNING_SECRET,
    defaultPresignedTTL: 900,
  },
});
```

The effective key order is explicit `storage.signingSecret`, then
`ZERO_STORAGE_SIGNING_SECRET`, then a random 32-byte key generated once and
stored in the system database's private config table. The database-backed default
survives restarts and lets runtimes that share that system database verify each
other's presigned URLs and upload grants. It is cryptographically random; Zero
does not use a hard-coded production default.

Configure an external secret when `systemDb` is ephemeral or when replicas do
not share the same system database. Production Doctor treats an ephemeral
system database with no external storage key as an error and reports operator-
provided keys shorter than 32 UTF-8 bytes. Rotating the key immediately
invalidates every outstanding presigned URL and upload grant, so deploy
rotations with the maximum configured capability lifetime in mind. Storage
secrets remain server-only and are never included in browser platform config.

The capability axes and all four combinations normalize deterministically;
omitting them still resolves to `single/simple`.

| Tenancy | Authorization | Implemented foundation | Deployment status |
| --- | --- | --- | --- |
| `single` | `simple` | Existing global user/admin runtime plus compatibility kernel scope | Supported current runtime |
| `single` | `advanced` | Validated registry, durable additive application assignments, protected owner, live HTTP/Sync expansion, `/auth/application`, typed SDK/hook, and packaged access UI | Supported in Zero 2.0 |
| `multi` | `simple` | Protected Administration Organization bootstrap, tenant/membership persistence, bound browser/native sessions, selection/switching, customer-tenant creation/directory/lifecycle/member administration, registered-resource and managed-service isolation, invitations/join requests, opt-in verified-domain requests, durable control-plane audit, and packaged tenant/platform controls | Supported in Zero 2.0; exact pre-024 administration-tenant reconciliation is available |
| `multi` | `advanced` | Multi/simple foundation plus durable additive membership assignments, administration-only application roles, protected owners, live permission expansion, optimistic role revisions, permission-aware tenant/platform UI, and authorized audit review | Supported in Zero 2.0 |

Multi-mode selection includes the protected Administration Organization and
bounded customer-organization lifecycle described in
[Platform Administration Organization](./auth/platform-administration.md).
No mode selection implies upstream enterprise SSO, break-glass,
tenant-custom roles, general populated-app discovery/migration tooling, or verified-domain
autojoin/aliases/direct transfer. Registered
resources now declare explicit server-owned client exposure and optional field
allow-lists. Managed file-mode runtimes sharing a relevant SQLite plane relay
that plane's tracked changes; runtimes sharing `systemDb` also relay
auth/session invalidation. Independent roots or hosts need an external
coordination layer. Multi-mode startup
also inspects the actual SQLite schema: tenant resources need a non-partial
tenant-leading index, business-unique indexes must include the tenant field,
and foreign keys between registered tenant resources must carry the tenant pair
in the same composite constraint. See the
[auth implementation checklist](./auth/multi-tenant-auth-implementation-checklist.md).

The authorization object can declare the server-only permission ceiling and
static role templates:

```ts
const auth = defineAuthConfig({
  tenancy: {
    mode: 'multi',
    terminology: { singular: 'practice', plural: 'practices' },
    creation: {
      // Who may create another tenant after installation bootstrap.
      mode: 'authenticated', // 'platform-admin' | 'disabled'
    },
  },
  authorization: {
    mode: 'advanced',
    // Bump before deploying a role/permission semantic change.
    registryVersion: 1,
    permissions: {
      'patients:read': {
        label: 'View patients',
        description: 'Read patient summaries in the active organization.',
      },
      'patients:write': { label: 'Edit patients' },
      'staff:manage': { label: 'Manage staff' },
    },
    roles: {
      clinician: {
        label: 'Clinician',
        permissions: ['patients:read', 'patients:write'],
      },
    },
  },
});
```

### Guardian user API keys

User-bound API keys are an optional capability inside the same auth config:

```ts
const auth = defineAuthConfig({
  tenancy: 'multi',
  authorization: {
    mode: 'advanced',
    registryVersion: 1,
    permissions: {
      'records:read': { label: 'Read records' },
      'records:write': { label: 'Write records' },
    },
    roles: {
      integration: {
        label: 'Integration',
        permissions: ['records:read'],
      },
    },
  },
  apiKeys: {
    enabled: true,
    selfService: false,
    administratorIssuance: true,
    eligibleScopeRoles: ['integration'],
    defaultTTL: '14d',
    maxTTL: '30d',
    maxActivePerUser: 5,
  },
});
```

The defaults are fail-closed: `enabled`, `selfService`, and
`administratorIssuance` are all `false`; lifetime defaults are `30d` and `90d`;
and the active-key ceiling defaults to 10. `apiKeys: true` enables eligible-user
self-service and keeps administrator issuance disabled; use the object form for
authentication without self-service. Advanced eligible roles must exist in the
declared registry, and multi-tenant eligible roles must be assignable to
customer organizations. The configured maximum lifetime must also produce a
JavaScript `Date`-representable absolute expiry.

Route acceptance is a separate declaration. Existing route policy remains
session-only until it includes `credentials: ['api-key']` (or both `session`
and `api-key`). See [Guardian User API Keys](./auth/api-keys.md) for the full
configuration, lifecycle, route, SDK, and packaged-component contract.

### Administration Organization adoption

Fresh multi-tenant installations omit `tenancy.administration`: bootstrap
creates the protected Administration Organization atomically. A database that
already contained multi-tenant data before migration `024` may instead need a
one-time exact selector when its audit history cannot prove one unique bootstrap
tenant:

```ts
const auth = defineAuthConfig({
  tenancy: {
    mode: 'multi',
    administration: {
      adoptTenantId: 'ten_exact_internal_id',
    },
  },
});
```

`adoptTenantId` accepts one non-empty internal tenant ID of at most 256
characters. It is a server-only startup reconciliation input, not browser
authority. Zero fails startup if the ID is unknown, inactive, differs from an
existing Administration Organization, or is omitted on a populated installation
with no protected administration tenant. Supplying it on an empty installation
also fails because there is no exact row to adopt. Adoption is atomic and
audited. After success, the exact setting may remain as an idempotent assertion
or be removed; the persisted tenant kind remains protected. This narrow path
does not enable a tenancy-axis profile change or automatically choose among
customer organizations. Follow the backup and verification procedure in
[Platform Administration Organization](./auth/platform-administration.md#adopting-the-administration-organization-on-a-pre-024-installation)
and [Releasing Zero](./releasing.md#pre-024-administration-organization-adoption).

### Authorization/control-plane audit retention

Auth always creates its private append-only control-plane trail. The optional
`audit` object configures bounded retention work; it does not disable audit
writes:

```ts
auth: {
  audit: {
    retentionDays: 365,   // integer 1..3650
    pruneBatchSize: 1000, // integer 1..10000 per SQLite transaction
    pruneInterval: '6h',  // duration from 1m through 7d
  },
}
```

Defaults are the values shown. Unknown keys and out-of-range values fail
normalization and Doctor reports the configuration error. The worker drains at
most ten bounded batches per event-loop pass, yields, and schedules another
pass while an expired backlog remains. Platform administrators can also invoke
the explicit, audited prune route. See
[Durable Authorization and Control-Plane Audit](./auth/control-plane-audit.md)
for event bounds, atomicity, routes, SDK/UI, and exclusions. This trail is not
general user-activity logging and does not make compliance/WORM claims.

### Authorization registry and static roles

Permission keys are canonical lowercase namespaces such as `patients:read`;
role keys are stable lowercase identifiers such as `clinician`. Resolution
sorts and freezes the registry, rejects unknown fields and duplicate or
undeclared permission references, and bounds registry and display-metadata
sizes. A role uses either `permissions` or `allPermissions`, never both. Zero
merges a deterministic framework registry into the app registry. Framework
permission keys cannot be redefined, and the protected `owner` template cannot
be widened, narrowed, or assigned through the generic role service. Built-in
`access-manager` (single) and `member`/`manager` (multi) templates provide a
sensible starting point without making the global `users.role = 'admin'` an
application or tenant owner.

The framework-owned registry is fixed by profile:

| Profile | Framework permission keys |
| --- | --- |
| `single/simple` | None; this is the compatibility profile with the existing global `user`/`admin` role behavior. |
| `single/advanced` | `application.roles:read`, `application.roles:manage` |
| `multi/simple` or `multi/advanced` | `tenant:read`, `tenant:manage`, `tenant.members:read`, `tenant.members:manage`, `tenant.roles:read`, `tenant.roles:manage`, `tenant.invitations:read`, `tenant.invitations:manage`, `tenant.domains:read`, `tenant.domains:verify`, `tenant.domains:release`, `tenant.onboarding:manage`, `tenant.join-requests:review`, `tenant.audit:read`, `workflows:manage`, `notifications:manage`, `rooms:manage`, plus administration-scope `application.roles:read/manage`, `application.audit:read/manage`, `application.users:read/manage`, `application.tenants:read/manage`, and `application.tenant-members:manage` |

The framework roles are equally deterministic. `single/advanced` adds
`access-manager` with both `application.roles:*` permissions and a protected
`owner` with `allPermissions`. Both multi-tenant profiles add `member`,
`manager`, administration-only `administrator` and `access-manager`, and the
protected `owner`. Any custom role with an explicit `application.*` permission
is also administration-only. `member` can read the active tenant,
members, and role metadata. `manager` adds member administration, invitation
read/manage, domain read/verify, onboarding management, and join-request
review. It deliberately does not receive tenant settings management, role
management, domain release, security-audit read, or the three built-in service
management permissions. The administration-only `administrator` includes
`application.tenant-members:manage`; the narrower administration
`access-manager` does not receive it by default. Cross-workspace membership
writes also require the platform read permissions documented in
[Platform Administration Organization](./auth/platform-administration.md).
`owner` receives every permission available to its
live scope: a customer owner remains tenant-only, while the protected
Administration Organization owner can receive application permissions.

Apps may reference framework permission keys in their own role templates but
cannot redefine their labels or semantics. App permissions extend the
registry; they do not replace it. The dedicated ownership lifecycle is the
only way to move the protected `owner` role.

`authorization.registryVersion` is a positive 32-bit integer and defaults to
`1`. Migration `027` persists that version and a canonical, secret-free
semantic fingerprint in `_auth_authorization_manifest`. Permission keys and
scopes; role keys, permission sets, `allPermissions`, and `system`; and the
resolved tenancy/authorization modes are semantic. Zero also fingerprints its
internal authorization-evaluator version so a framework semantics change
cannot masquerade as the same registry. Labels and descriptions are
presentation only and do not require an app registry bump.

Increment `registryVersion` before deploying any same-profile semantic change.
Reusing a version with a different fingerprint or rolling back below the
installed version fails startup with
`AUTHORIZATION_REGISTRY_VERSION_REQUIRED`; an invalid/corrupt marker fails
with `AUTHORIZATION_REGISTRY_INVALID`. A supported installed-profile
transition may acknowledge only its tenancy/authorization-axis change at the
current version when permission, role, and evaluator semantics are otherwise
identical. A rollout that changes both a profile axis and registry/evaluator
semantics must also increment `registryVersion`.
Successful initialization and updates are recorded as system-provenance,
application-scope `application.authorization-registry-initialized` or
`application.authorization-registry-updated` audit events. Other live runtimes
observe the shared authority revision and fail closed with
`AUTH_PROFILE_CHANGED` until restarted on the installed configuration.

Do not reuse a retired role key while retained live assignments still name it.
Even with a version bump, startup fails with
`AUTHORIZATION_ROLE_REACTIVATION_BLOCKED`; remove or replace those retained
assignments while the key is retired, deploy the new version, and grant the
reintroduced role deliberately. This prevents an apparently harmless config
change from silently restoring old authority.

Advanced assignments are retained as source-aware history rows. Multiple
static roles add their permissions; `allPermissions` expands to the complete
resolved registry. Assignment writes atomically advance the application or
membership authorization generation. HTTP resolves assignments for every
request, and Sync fingerprints include the assignment revision, so a grant or
revocation is visible without trusting a role supplied by the request.

When an existing `single/simple` database first enables `single/advanced`, Zero
does not guess among global administrators. Configure one exact existing
identity for the one-time, idempotent adoption:

```ts
authorization: {
  mode: 'advanced',
  ownerAdoption: { email: 'owner@example.com' }, // or { userId: 'u_...' }
}
```

A fresh installation needs no selector: the first bootstrap user and protected
application-owner assignment commit together. An existing ownerless install
fails startup with an actionable error until adoption succeeds. The selector
may be retained or removed afterward.

### Installed auth profile and mode upgrades

Zero persists the exact tenancy/authorization pair and a monotonic generation
in the private `_auth_installed_profile` singleton. Startup compares that
durable profile with configuration before it recovers registrations, repairs
owners, issues tokens, starts workers, or publishes auth services. An exact
profile restart leaves the installed marker and generation unchanged. A
committed change advances the shared auth-authority revision, and cached HTTP,
token, session, Sync, identity, tenancy, and role
boundaries reject a stale runtime with `AUTH_PROFILE_CHANGED` until it is
restarted. Use a coordinated rollout even though the fence fails closed.

The supported populated-database changes are intentionally narrow:

- `single/simple` to `single/advanced` does not reinterpret global
  `users.role` as an application assignment. When users already exist,
  configure the exact `ownerAdoption` selector shown above. Only that owner is
  adopted; other users begin with no application role.
- `multi/simple` to `multi/advanced` transactionally projects each retained
  non-removed membership's `role_key` into a source-aware advanced assignment.
  Active and suspended memberships are preserved; removed memberships are not
  re-granted. Every retained key must still be declared in the resolved role
  registry, including `owner`, `manager`, `member`, and app roles. An unknown,
  null, or retired key stops startup before any marker, assignment, generation,
  session, audit, or revision change commits.
- `advanced` to `simple` is rejected once authority data exists. A membership
  placeholder cannot safely replace additive assignment history.
- `single` to `multi` and `multi` to `single` are rejected once identity or
  tenant data exists. Those changes require a future explicit data/session
  adoption workflow; configuration never guesses ownership.
- A truly pristine database may correct either axis before bootstrap. The
  profile generation still advances so a concurrently starting process with
  an older configuration cannot publish stale services.

The multi/simple projection advances each retained membership authorization
generation and atomically rebinds its live browser and native session parents,
so an unchanged effective role does not force a sign-in. Suspended memberships
remain unusable. Incomplete native authorization requests/codes are discarded
because they cannot be safely rebased. A pending registration-provisioning row,
whether its lease is live or expired, blocks any actual profile change: restart
the installed profile so it can finalize or recover the registration, then
retry.

Historical databases created before the profile marker need one extra
ambiguity guard. The recommended, least-surprising rollout is to deploy this
Zero version once with the existing `multi/simple` configuration. That normal
restart records the migration `023` marker without changing authority. Then
change the configuration to `multi/advanced` in a second coordinated rollout.

An unmarked database with tenant/membership rows and no advanced-assignment
history can therefore start normally as explicitly configured `multi/simple`.
A one-step first start as `multi/advanced` is ambiguous with a damaged advanced
database and fails closed. If a two-step rollout is impossible, and only after
confirming that the database really came from multi/simple, use this one-time
assertion:

```ts
authorization: {
  mode: 'advanced',
  legacySimpleRoleAdoption: true,
}
```

`legacySimpleRoleAdoption` is accepted only with `tenancy.mode: 'multi'` and
`authorization.mode: 'advanced'`. It cannot authorize a tenancy-axis change or
override existing assignment history. It is idempotent and harmless after the
advanced marker commits, but should be removed after a successful deployment
so the exceptional legacy intent does not remain in ordinary configuration.
The completed transition writes one system-provenance
`application.auth-profile-adopted` audit event in the same transaction; Zero
does not invent a human actor for framework adoption.

Only `authorization.mode` is exposed by public auth config. The registry
version, fingerprint, labels, descriptions, role templates, and permission
registry remain server-only.
Authenticated `/auth/admin/config` includes the resolved registry and an
`assignable` flag for mode-aware administration surfaces; assignment records
and source history are not anonymously enumerable.
`AuthorizationKernel` compiles, monotonically merges, and evaluates this
vocabulary against a live trusted scope snapshot. Managed Elysia routes,
file-router pages and `route.ts` handlers, resource CRUD, data queries, and
Sync use the same request authorization facade; raw `zero.db`/`zero.sql`
remains compatible at its historical path in single mode. Multi-tenant request
handlers must opt into that trusted boundary through `zero.unsafe.db` /
`zero.unsafe.sql`; ordinary app data should use a classified resource so the
resolved shared-row predicate or physical database boundary cannot be
forgotten.

In `multi` mode, installation bootstrap always requires a tenant name and
atomically persists the user, credential, protected Administration
Organization, protected owner membership, global/platform-admin role, and
bootstrap completion marker. That bootstrap invariant is independent of the
later `tenancy.creation.mode`.

After bootstrap, identity registration and tenant creation are separate. An
ordinary `/auth/register` may omit `organizationName`; Zero then returns an
expiring, hashed-at-rest, app-bound, single-use onboarding continuation and no
application credential. The browser may exchange it at
`POST /auth/tenants/create` when the live creation policy permits. Supplying an
organization during registration remains an optional one-step path under that
same policy. It never joins an existing tenant or accepts an owner/actor from
the browser.

`/auth/tenants/create` also accepts proof from the current browser refresh
family so an already signed-in eligible user can create and activate another
tenant. Tenant, protected owner, continuation/refresh consumption, replacement
parent session, and refresh credential commit together. A failure rolls the
entire unit back, preserving the proof and prior session for a safe retry.
For the optional one-step registration path, a response lost after the
identity/tenant transaction is recoverable by normal login; the sole live
membership auto-binds, so repeating registration is neither required nor
recommended.

Verified-company-domain request onboarding is an explicit multi-mode option:

```ts
tenancy: {
  mode: 'multi',
  onboarding: {
    joinRequests: { enabled: true },
    verifiedDomains: {
      enabled: true,
      allowedRequestRoles: ['member'],
      defaultRequestRole: 'member',
      maxClaimsPerTenant: 20,
      // challengeTTL: '24h', dnsTimeout: '5s', reverifyInterval: '7d',
      // gracePeriod: '3d', mailboxLandingPath: '/domain-onboarding',
    },
  },
}
```

Allowed request roles must be declared, bounded, non-system, and assignable to
a customer organization. Administration-only and application-scope roles are
rejected during config resolution even when the feature is currently disabled.
Enabling the feature requires operational email delivery plus `app.publicUrl`;
Doctor fails the half-enabled configuration and public auth config withholds
the capability.
It proves exact DNS control and current mailbox possession before retaining a
fixed-role join request; it does not auto-join or create an identity when
registration is disabled. Protected owners can retire a claim without deleting
history; Zero invalidates outstanding admission and quarantines cross-tenant
reuse for seven days. See
[Verified Company-Domain Onboarding](./auth/verified-domain-onboarding.md) for
all bounds, routes, lifecycle rules, and deliberate exclusions.

Browser sessions are durably tenant-bound; users with multiple memberships
must explicitly select one. Managed shared-row tenant Resources stamp and
filter their server-owned discriminator, while physical tenant Resources use
the authority-derived database capability as the mandatory boundary. Doctor
accepts `tenancy: 'multi'` and both
authorization modes, and validates those resource boundaries. For
`single/advanced`, its static report documents the runtime owner-adoption
guard; startup performs the authoritative database-backed active-owner check.

`auth.bootstrap` is an installation-level control, separate from
`auth.registration.mode`. It defaults to secret-gated setup; an omitted secret
keeps a fresh database closed and produces
`auth.bootstrap.secret_missing` in Doctor. Use a random deployment secret of
at least 32 characters, or deliberately select `bootstrap: 'public'` (legacy,
Doctor-warned) or `bootstrap: 'disabled'` (trusted provisioning only). Once
setup succeeds, change the config to `disabled` and remove the secret. The
durable database marker prevents setup from reopening.

### Web auth navigation

Web login navigation is configured at the top level of `AppConfig`, beside the
page-router settings:

```ts
export default defineZeroConfig({
  auth: true,
  routeAuth: 'protected-by-default',
  publicPaths: ['/login', '/register', '/forgot-password'],
  loginPath: '/login',
  postLoginPath: '/dashboard',
});
```

| Path | Default and validation |
|---|---|
| `loginPath` | `/login`; safe local login route used by server and client page guards |
| `registrationPath` | `/register`; safe local registration route, including native browser authorization |
| `postLoginPath` | `/`; safe local fallback after login or an authenticated visit to `loginPath` |

An anonymous protected request is sent to `loginPath` with exactly one encoded,
validated `redirect` return path. A direct server redirect retains pathname and
query. Client navigation can also retain the fragment, which is never sent to
the server. Once the login route is authenticated, a safe return path takes
precedence over `postLoginPath`; navigation replaces the login history entry.

Local auth paths are bounded and reject external or scheme-relative URLs,
backslashes and control characters, malformed encodings, and paths whose
canonical form could become scheme-relative. Duplicate or recursive `redirect`
values are ignored, and trailing slashes are equivalent when comparing the
return target or fallback with `loginPath`. An explicit `postLoginPath`
resolving to the login route is rejected. The legacy combination of
`loginPath: '/'` and an omitted, implicitly `/` post-login path remains a no-op
for authenticated root visits.

`AppProvider` receives the resolved paths through the server-injected platform
config and exposes matching `loginPath` and `postLoginPath` overrides. These are
page-navigation options, not fields under `auth` and not raw `createClient()`
options. `useAuth().isRestoring` is true only while a persisted web session is
being refreshed and `/auth/me` is loading. In browsers with Web Locks, refresh
rotation is serialized per Zero server across tabs and workers; each waiter
rereads the persisted token after acquiring the lock. Without Web Locks, Zero
uses a bounded, expiring `localStorage` bakery lock across tabs when browser
storage is available. The in-process queue is the final same-JavaScript-realm
fallback for runtimes without either facility.

### Native installed-app authentication

Native desktop/mobile clients and Chrome extensions are registered under
`auth.nativeApps`. A non-empty client list enables the OIDC Authorization Code
provider with PKCE and uses `${app.publicUrl}/auth` as its issuer. An explicit
issuer may provide the same canonical `/auth` URL, but the current provider
deliberately rejects a different origin so token audience and authenticated
API requests cannot diverge. Client IDs are publishable and never have
secrets. See
[Desktop, Mobile, and Chrome Extension Authentication](./auth/native-app-auth.md).

Native auth automatically applies per-source admission using Bun's direct
socket peer and ignores spoofed forwarding headers. When Zero is behind a
reverse proxy, set
`auth.nativeApps.requestAdmission.trustedProxyRanges` to the proxy's exact IP
or CIDR ranges. Only then does Zero walk `X-Forwarded-For` from the trusted
socket toward the first untrusted client address. A custom sanitized header can
be selected with `forwardedForHeader`; universal `/0` trust ranges are rejected.
Public client IDs cannot protect shared global/per-client caps, so
multi-replica deployments should additionally rate limit the authorize
endpoint at their shared edge. Zero persists only a
process-pseudonymous HMAC of the resolved source, never the raw identifier.

A production-oriented configuration can make the defaults explicit:

```ts
export default defineZeroConfig({
  app: {
    name: 'Acme',
    publicUrl: 'https://app.acme.example',
  },
  auth: {
    accessTokenTTL: '15m',
    nativeApps: {
      enabled: true,
      // Optional; when present it must normalize to the same public origin.
      issuer: 'https://app.acme.example/auth',
      requestTTL: '15m',
      codeTTL: '3m',
      refreshTokenTTL: '30d',
      clients: [{
        clientId: 'acme-desktop',
        name: 'Acme Desktop',
        redirectUris: [
          'http://127.0.0.1/oauth/callback',
          'http://[::1]/oauth/callback',
        ],
        scopes: ['openid', 'profile', 'email'],
      }],
      requestAdmission: {
        cleanupBatchSize: 100,
        maxOutstandingGlobal: 1_000,
        maxOutstandingPerClient: 100,
        maxOutstandingPerSource: 20,
        rollingWindow: '1m',
        maxAdmissionsGlobal: 300,
        maxAdmissionsPerClient: 60,
        maxAdmissionsPerSource: 20,
        // Set only when the direct peer really is one of these proxies.
        trustedProxyRanges: ['10.0.0.0/8', 'fd00::/8'],
        forwardedForHeader: 'x-forwarded-for',
      },
      refreshRotation: {
        cleanupBatchSize: 100,
        minRotationInterval: '30s',
        maxRotationsPerFamily: 4_096,
        maxActiveFamiliesPerUserClient: 10,
      },
    },
  },
});
```

Do not copy the example proxy ranges unless they exactly describe your network.
A directly exposed Zero process needs no proxy configuration: it safely uses
the Bun socket peer and ignores forwarded headers. A platform whose trusted
edge exposes a non-IP identity may supply `sourceKey(context)` instead, but
`sourceKey` cannot be combined with proxy ranges or `forwardedForHeader`.

#### Native config reference

| Path | Default and validation |
|---|---|
| `auth.nativeApps.enabled` | Defaults to `true` when `clients` is non-empty; explicit `false` disables the provider |
| `auth.nativeApps.issuer` | Optional canonical HTTPS `/auth` issuer, or loopback HTTP in development; must share `app.publicUrl`'s origin |
| `auth.nativeApps.requestTTL` | `15m`; positive duration no greater than 1 hour |
| `auth.nativeApps.codeTTL` | `3m`; positive duration no greater than 10 minutes |
| `auth.nativeApps.refreshTokenTTL` | `30d`; positive duration no greater than 365 days |
| `clients[].clientId` | Required unique public identifier, 1–128 unreserved characters |
| `clients[].name` | Required non-empty trimmed consent-page name |
| `clients[].redirectUris` | Required non-empty unique list of supported native redirects |
| `clients[].scopes` | Defaults to `openid profile email`; only those values are supported and `openid` is required |
| `requestAdmission.cleanupBatchSize` | `100`; integer from 1 through 10,000 |
| `requestAdmission.maxOutstandingGlobal` | `1000`; integer from 1 through 1,000,000 |
| `requestAdmission.maxOutstandingPerClient` | `100`; integer from 1 through 1,000,000 |
| `requestAdmission.maxOutstandingPerSource` | `20`; integer from 1 through 1,000,000 |
| `requestAdmission.rollingWindow` | `1m`; positive duration no greater than 1 day |
| `requestAdmission.maxAdmissionsGlobal` | `300`; integer from 1 through 1,000,000 per rolling window |
| `requestAdmission.maxAdmissionsPerClient` | `60`; integer from 1 through 1,000,000 per client/window |
| `requestAdmission.maxAdmissionsPerSource` | `20`; integer from 1 through 1,000,000 per source/window |
| `requestAdmission.trustedProxyRanges` | Empty; exact IPv4/IPv6 addresses or CIDRs only, with universal `/0` ranges rejected |
| `requestAdmission.forwardedForHeader` | `x-forwarded-for`; a custom value requires at least one trusted proxy range |
| `requestAdmission.sourceKey` | Default safe socket-peer resolver; custom callback is mutually exclusive with proxy options |
| `refreshRotation.cleanupBatchSize` | `100`; integer from 1 through 10,000 |
| `refreshRotation.minRotationInterval` | `30s`; may be `0s`, maximum 1 hour |
| `refreshRotation.maxRotationsPerFamily` | `4096`; integer from 1 through 100,000; exhausted families are revoked |
| `refreshRotation.maxActiveFamiliesPerUserClient` | `10`; integer from 1 through 1,000; oldest excess family is evicted |

All duration strings use an integer followed by `s`, `m`, `h`, or `d`. Native
refresh lifetime is separate from the normal web `auth.refreshTokenTTL`.
Native access tokens use the normal `auth.accessTokenTTL` (15 minutes by
default), the exact app origin as audience, and the same managed ES256 signing
key as the rest of Zero auth.

#### Native redirect and lifecycle configuration

Supported redirect classes are exact claimed HTTPS URLs, reverse-domain
private-use schemes using the single-slash form, and IP-literal HTTP loopback.
Only a desktop loopback port may vary between registered and requested URLs.
Fragments, credentials, duplicate query keys, reserved response query keys,
`localhost` callbacks, non-loopback HTTP, and wildcard Chrome callbacks are
rejected.

The external browser uses `loginPath` and `registrationPath`, which default to
`/login` and `/register`. Zero derives the standard auth lifecycle pages into
`publicPaths`; if the app supplies `publicPaths` explicitly, that list is
authoritative and must include every custom login, registration, verification,
forgot/reset, and setup-password path. Native registration still obeys
`auth.registration`, verification obeys `auth.account`, and MFA obeys
`auth.mfa`.

Sign out installed clients before changing their server URL, client ID,
redirect strategy, or credential namespace. The generic native SDK derives
storage from issuer/client, so changing either without signing out can leave an
old server family active. The Chrome preview additionally binds server, client,
persistence, and namespace behind one extension-global marker and rejects an
unsafe in-place change.

#### Doctor, migration, and deployment

Run:

```sh
bun run doctor -- --config ./zero.config.ts --strict
```

Doctor reports missing/invalid public origins, split issuer/API origins,
enabled providers without clients, malformed/duplicate clients, unsupported
identity scopes, invalid TTLs, unsafe redirects, and malformed or ambiguous
proxy admission policy.

`createApp()` runs the platform migration registry by default for durable
databases. Native auth uses migrations `005` and `006`; the hardening migration
requires a guarded backup and the migrator snapshots hot/WAL-backed state
safely. For an existing deployment, review and back up the correct database
before startup. `zero update` updates framework dependency artifacts only and
never chooses or runs an application migration command.

At a reverse proxy or ingress, preserve the canonical HTTPS origin and configure
only proxy ranges Zero actually sees as its direct peer. Apply shared edge rate
limits if more than one process accepts native authorization. Keep the auth
signing key and database lifecycle stable under the same production practices
as web auth. After deployment, verify the discovery document at
`/auth/.well-known/openid-configuration`, then exercise browser registration,
MFA/recovery, callback, rotation, revocation, protected HTTP, and Sync on real
targets.

Richer auth behavior can live in an app-owned module such as
`config/auth.ts`, as long as `zero.config.ts` imports that value explicitly:

```ts
// config/auth.ts
import {
  defineAuthConfig,
  defineAuthEmailTemplates,
} from '@zero/framework/server';
import { authEmailTemplates } from './auth-emails';

export default defineAuthConfig({
  account: {
    requireEmailVerification: Bun.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true',
    emailVerificationPath: '/verify-email',
  },
  mfa: {
    enabled: Bun.env.AUTH_MFA_ENABLED === 'true',
    // Parse/validate environment overrides before passing them to this typed
    // config. These literals are the supported values used by this example.
    policy: 'optional',
    methods: ['email', 'totp'],
    allowUserChoice: true,
    allowMultipleMethods: false,
    recoveryCodes: false, // reserved for a later recovery-code flow
    totp: {
      // Authenticator/TOTP is self-hosted by Zero. Issuer defaults to app.name.
      encryptionKey: Bun.env.AUTH_TOTP_ENCRYPTION_KEY,
      qrRobustness: 'M',
    },
  },
  branding: {
    appName: Bun.env.APP_NAME,
    logoUrl: Bun.env.APP_LOGO_URL,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
    brandColor: Bun.env.AUTH_EMAIL_BRAND_COLOR,
  },
  emails: defineAuthEmailTemplates(authEmailTemplates),
});
```

An app-owned `config/auth-emails/` folder is optional; Zero does not discover
it. Current account setup and password reset emails render branded defaults
using `app.name`, `app.publicUrl`, logo URL, support email, and brand color.
When app overrides are present, each template can live in its own file and
`index.ts` can compose the registry imported by `config/auth.ts`:

```ts
// config/auth-emails/index.ts
import { defineAuthEmailTemplates } from '@zero/framework/server';

import { passwordResetEmail } from './password-reset';

export const authEmailTemplates = defineAuthEmailTemplates({
  passwordReset: passwordResetEmail,
});
```

```ts
// config/auth-emails/password-reset.ts
import type { AuthEmailTemplate } from '@zero/framework/server';

export const passwordResetEmail: AuthEmailTemplate = (ctx) => ({
  subject: `Reset your ${ctx.branding.appName} password`,
  text: ctx.defaultText,
  html: ctx.defaultHtml,
});
```

Active template keys today are `accountSetup`, `passwordReset`,
`emailVerification`, `domainMailboxProof`, and `emailOtp`. Reserved typed keys
for upcoming account-notice slices include `passwordChanged`, `mfaEnabled`,
`mfaDisabled`, and `recoveryCodesRegenerated`. MFA setup and login challenge
routes are active when `AUTH_MFA_ENABLED=true`.

Recovery-code storage is reserved for a later MFA slice. Leave
`auth.mfa.recoveryCodes` false until the recovery-code generation and
verification routes ship.

Relevant environment variables are shown in `.env.example`:

| Variable | Used for |
| --- | --- |
| `APP_NAME` | App display name in system email. |
| `APP_PUBLIC_URL` | Public origin used to build reset/setup links. Required for account email. |
| `APP_LOGO_URL` | Optional logo used by auth pages and branded system email. |
| `APP_SUPPORT_EMAIL` | Optional support/reply identity. |
| `AUTH_EMAIL_BRAND_COLOR` | Optional default accent color for branded auth email. |
| `EMAIL_FROM` | Default sender for platform email. |
| `EMAIL_REPLY_TO` | Optional reply-to address. |
| `RESEND_API_KEY` | Enables the default Resend email provider. |
| `AUTH_BOOTSTRAP_SECRET` | App convention for the random operator setup key passed explicitly to `auth.bootstrap.secret`; Zero does not read it implicitly. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Require email verification before public-registered users receive tokens. |
| `AUTH_EMAIL_VERIFICATION_PATH` | Public page path used in email verification links. Defaults to `/verify-email`. |
| `AUTH_MFA_ENABLED` | Enables first-party MFA setup and login challenges. |
| `AUTH_MFA_POLICY` | MFA policy: `optional`, `required`, or `admin-required`. |
| `AUTH_MFA_METHODS` | Comma list such as `email,totp`. |
| `AUTH_TOTP_ENCRYPTION_KEY` | Encryption key for self-hosted authenticator/TOTP secrets at rest. Required once TOTP enrollment is enabled. |
| `AUTH_ACTION_TOKEN_TTL` | Expiration for setup/reset/verification action tokens. |
| `AUTH_ACCOUNT_EMAIL_COOLDOWN` | Cooldown between active setup/reset/verification emails for the same user and token type. |
| `AUTH_MANUAL_PASSWORD_RESET` | Set to `false` to disable direct admin password replacement and require email-driven reset flows. |
| `ACCESS_TOKEN_TTL` | Access token lifetime. |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime. |
| `AUTH_SIGNING_KEY` | Optional externally managed ES256 private JWK as raw JSON or base64; PEM is not supported. Missing `kid` is derived deterministically from the public key. |
| `ZERO_STORAGE_SIGNING_SECRET` | Optional HMAC key for storage presigned URLs and upload grants; use at least 32 random bytes. A durable shared system database can use Zero's persisted generated key. |
| `OPENAI_API_KEY` | Enables OpenAI when `ai: true`. |
| `ANTHROPIC_API_KEY` | Enables Anthropic when `ai: true`. |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Enables Google Generative AI when `ai: true`. |
| `GROQ_API_KEY` | Enables Groq when `ai: true`. |
| `XAI_API_KEY` | Enables xAI when `ai: true`. |
| `COHERE_API_KEY` | Enables Cohere when `ai: true`. |
| `LLAMA_API_KEY` / `META_LLAMA_API_KEY` | Enables the custom Meta Llama provider when `ai: true`. |
| `DEEPSEEK_API_KEY` | Enables DeepSeek via OpenAI-compatible adapter when `ai: true`. |

| `PERPLEXITY_API_KEY` / `PERPLEXITYAI_API_KEY` | Enables Perplexity via OpenAI-compatible adapter when `ai: true`. |
| `VOYAGE_API_KEY` | Enables Voyage embeddings via OpenAI-compatible adapter when `ai: true`. |
| `DEEPGRAM_API_KEY` | Enables Deepgram transcription and speech when `ai: true`. |
| `{PROVIDER_ID}_API_KEY` | Optional convention for explicit non-catalog AI providers when `apiKey` is omitted, for example `LOCAL_API_KEY`. |
| `{PROVIDER_ID}_BASE_URL` | Optional convention for explicit non-catalog AI providers when `baseURL` is omitted, for example `LOCAL_BASE_URL`. |
| `ZERO_AI_FAST_MODEL` | Optional `fast` alias override. |
| `ZERO_AI_SMART_MODEL` | Optional `smart` alias override. |
| `ZERO_AI_EMBEDDING_MODEL` | Optional `embedding` alias override. |
| `ZERO_AI_IMAGE_MODEL` | Optional `image` alias override. |
| `ZERO_AI_TRANSCRIPTION_MODEL` | Optional `transcription` alias override. |
| `ZERO_AI_SPEECH_MODEL` | Optional `speech` alias override. |
| `ZERO_VECTOR_ENABLED` | Starter-app convention for enabling inline vector config. |
| `ZERO_VECTOR_DATA_DIR` | Default local zvec collection directory. |
| `ZERO_VECTOR_DEFAULT_DIMENSIONS` | Default vector dimensions for `vector: true`. |

Generic platform action/resume tokens do not require environment variables.
They are mounted by `createApp()` and use per-call TTL/cooldown options. Auth
setup/reset email flows still read `AUTH_ACTION_TOKEN_TTL` and
`AUTH_ACCOUNT_EMAIL_COOLDOWN` for their action-token defaults.

The current auth admin UI reads the admin-protected normalized response from
`GET /auth/admin/config`; it does not load the source module. The Doctor CLI
loads the composed `AppConfig` export from `zero.config.ts` (or its supported
root/config variants) and evaluates it as application config.

There is currently no general `GET /api/_zero/config` endpoint and no
`GET /api/_zero/observability/config` endpoint. A future general effective
config API should be admin-only, omit secrets, and expose normalized data
rather than raw user-authored files.

## Sitemap

Zero can serve a request-time `sitemap.xml` from the file router. Enable it in
the app config:

```ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  app: {
    name: 'Acme CRM',
    publicUrl: 'https://crm.example.com',
  },
  db,
  tables,
  auth: true,
  routeAuth: 'explicit',
  sitemap: {
    enabled: true,
    changefreq: 'weekly',
    priority: 0.7,
    entries: [
      {
        href: '/blog/launch-notes',
        lastmod: '2026-07-01',
        changefreq: 'monthly',
        priority: 0.8,
      },
    ],
    exclude: ['/login', '/forgot-password', '/reset-password'],
  },
});
```

Behavior:

1. `sitemap: true` mounts `/sitemap.xml` with safe defaults.
2. Static public `page.tsx` routes are discovered automatically.
3. Route groups such as `(marketing)` do not appear in URLs.
4. API routes, dynamic routes such as `[slug]`, catch-all routes, and protected
   page/layout branches are omitted by default.
5. Dynamic content belongs in `entries`, where the app can provide concrete
   URLs from its own content model.
6. `exclude` removes matching paths and child paths even when the route is
   otherwise public.

`app.publicUrl` is used for absolute `<loc>` values. If it is not set, Zero
falls back to the request origin, which is useful in local development but less
predictable behind production proxies.

## Future Proposal: Focused Config Discovery and Scaffolding

This section is design direction, not a current CLI or runtime contract. Zero
does not currently discover focused config modules, accept `configDir`, or
provide an `init-config` command.

A future scaffolder could create ordinary typed modules with comments:

```txt
bun run zero init-config auth
bun run zero init-config access
```

A proposed default layout is:

```txt
zero/auth.ts
zero/access.ts
```

If implemented, templates should be normal TypeScript files. They should teach
by showing commented examples and safe defaults, not by requiring a separate
wizard. Discovery would also need a documented precedence contract before the
runtime could accept focused files independently of `zero.config.ts`.

## Platform Doctor

Zero now includes an app-level platform doctor:

```txt
bun run doctor -- --config ./zero.config.ts
bun run doctor -- --config ./zero.config.ts --strict
bun run doctor -- --config ./zero.config.ts --json
```

The platform doctor checks createApp config and warnings do not fail by
default. `--strict` makes warnings fail for CI.

Current checks cover:

1. Invalid `createApp()` config such as `stateSync` without auth.
2. Explicit storage config without auth, weak operator-provided capability
   keys, and missing external key material for production ephemeral databases.
3. Non-isolated column definitions and missing, multiple, or non-`TEXT`/
   `INTEGER` primary-key declarations in ReactiveDB tables. Definition errors
   identify the exact column; table-wide key-count errors identify the table.
4. Invalid natural identity fields.
5. Invalid auth action-token TTL/cooldown duration strings.
6. Auth account email flows with email disabled.
7. Missing `app.publicUrl`, sender address, or Resend API key for email-driven
   account flows.
8. A durable system database with platform startup migrations disabled.
9. Auth-enabled app tables not covered by an app `syncPolicy` or registered
   resource policy.
10. Login, registration, verification, reset, and setup route access when
    protected-by-default auth uses an explicit `publicPaths` list.
11. Lazy/auto sync index guidance for `/api/data` filters and sorting.
12. Observability disabled in production, unreadable endpoint policy, and
    endpoint/store mismatches.
13. AI provider readiness, custom OpenAI-compatible base URLs, aliases,
    capability mismatches, and status endpoint access policy.
14. Vector path collisions, storage/build-output path overlap, read-only
    indexes, unusually high dimensions, embedding alias readiness, and
    unindexed scope metadata fields.
15. Resource registration and policy shape: missing tables, primary-key
    mismatches, unknown or unsafe field allow-lists, missing owner columns,
    untrusted metadata keys, auth-disabled protected resources, missing list
    policies, custom list policy scope, public or uninspectable write policies,
    and owner-field index guidance.
16. App source usage audit: raw controls instead of Zero UI primitives, custom
    modal/toast/sidebar systems, missing app root providers, direct
    package/internal imports, direct backend provider usage, backend `console`
    calls, and files above the responsibility threshold.
17. Native app auth issuer/public URL readiness, registered public clients,
    identity scopes, lifetimes, and desktop/mobile redirect safety.
18. Application/system database handle and path overlap, filesystem aliases,
    unsafe authority durability, legacy combined authority layouts, Guardian
    reference compatibility, shared anchor readiness, and aggregate projection
    target/backlog health. Existing files are inspected read-only.

Usage-audit options:

```txt
bun run doctor -- --config ./zero.config.ts --no-usage-audit
bun run doctor -- --config ./zero.config.ts --max-file-lines 400
bun run doctor -- --config ./zero.config.ts --usage-include app --usage-include server
bun run doctor -- --config ./zero.config.ts --usage-exclude app/vendor/**
```

When an app creates non-unique indexes through migrations or startup
compatibility code, declare them so Doctor can distinguish real index gaps from
indexes it cannot infer from the table schema:

```ts
export default defineZeroConfig({
  // ...
  doctor: {
    indexedFields: {
      tickets: ['owner_id'],
    },
  },
});
```

This is a diagnostic hint only. The app still needs to create the actual SQLite
index with a migration or intentional startup compatibility code.

The default scan roots are app-owned code: `app/`, configured `server/*`
extension directories, `components/`, `hooks/`, and `lib/`. Doctor skips
`node_modules`, `.zero`, `.build`, `dist`, generated files, tests, and vendored
source by default.

Future config-file Doctor checks (after focused-file support exists) should
validate:

1. Missing referenced config files.
2. Unsupported keys or field types.
3. Invalid metadata values.
4. Conflicting inline and file config.
5. Authz metadata marked user-writable.
6. Tenancy configured without matching table columns/policies.
7. Storage/avatar config without storage support.
8. Loading conventional app-owned policy/resource files directly in doctor when
   a config module relies only on `server/resources`.
9. Email verification or email OTP enabled without ready email config.
10. Authenticator/TOTP enabled without an encryption key.
11. MFA required with no enabled method.
12. Auth branding values that point at missing local assets in generated apps.

## Future Proposal Rollout

None of these steps are part of the current public configuration API:

1. Implement a focused-module protocol for `zero/auth.ts` and `zero/access.ts`.
2. Add templates and docs for those files.
3. Add effective config endpoint for admin UI.
4. Build adaptive admin UI against the effective config.
5. Move storage/sync/observability/migration config to the same protocol after
   auth/access proves the shape.

Do not refactor every `createApp()` option at once. Start with auth/access,
then migrate other systems one at a time.
