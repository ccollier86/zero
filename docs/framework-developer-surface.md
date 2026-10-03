# Framework Developer Surface

This document maps how an app developer should use Zero when it behaves like an
installed framework. It is intentionally honest about the current package surface:
the runtime, package export map, and app-owned Elysia route loader exist on this
branch; `create-zero` writes a blank package-mode starter app, and `zero add`
copies selected component/hook source into app-owned code.

## Current And Target Imports

Current source-tree imports use the existing aliases:

```ts
import { createApp, type AppConfig } from '@platform/server';
import { AppProvider, Button, useCollection } from '@platform/frontend';
```

Package-mode imports now use the `@zero/framework` export map:

```ts
import { createApp, type AppConfig } from '@zero/framework/server';
import { AppProvider } from '@zero/framework/react/app-provider';
import { useCollection } from '@zero/framework/react/hooks';
import { Button } from '@zero/framework/components/ui/button';
import { defineSchema, defineTable } from '@zero/framework/schema';
```

The current `@platform/*` aliases still work in this repository for compatibility,
but new app code should use `@zero/framework/*`.

For local package-mode development before npm publishing, scaffold from this
checkout:

```sh
bun run install:local-tools
zero-new ../my-zero-app
```

Without the local convenience wrapper:

```sh
bun run create-zero -- ../my-zero-app --local --install
```

This packs the checkout with the package publish allowlist and writes the
generated app's ignored `.zero/framework/zero-framework.tgz` archive into
`package.json`. Use `--zero <specifier>` when testing a published version or a
different package source.

To refresh that framework archive later without touching app-owned code, stop
the app/dev server and run:

```sh
cd /path/to/my-zero-app
zero-update
```

The local-tools installer binds `zero-update` to the stable package saved from
committed local `main`. It accepts an optional project directory, never packs
the live checkout, and fails closed when the saved archive is missing or
corrupt. Use `--dry-run` to inspect the dependency/archive/install plan. For
deliberate working-checkout testing, call
`zero update --project <dir> --local <checkout>` explicitly. Published-package
apps instead use `bun run zero update --project .`, with `--latest` reserved for
an intentional move to the newest release. Exactly one `bun.lock` or `bun.lockb`
must already exist, including for a dry-run; commit the lockfile for
checkout-local apps.

The updater directly manages Zero dependency artifacts only; in its default
mode it never scaffolds app source, rewrites `zero.config.ts` or `.env`, changes
application data, or runs app-defined scripts. `--check` executes the project's
existing typecheck and Doctor scripts; review them first because their side
effects are outside updater rollback. Zero itself never selects a migration
command. Run `bun run migrate:plan` separately and intentionally against the
correct database or a safe copy before applying a database change. The stable
wrapper copies its saved package into the ignored
`.zero/framework/zero-framework.tgz` cache; only the explicit `--local`
development path regenerates an archive from a selected checkout. A fresh clone
can omit that archive and the managed `.zero/` directories: a mutating update
creates them, while `--dry-run` only reports the pending bootstrap. Existing
symlinks or wrong-type entries at managed paths are rejected. Never use
`create-zero --force` or `zero-new --force` as an update mechanism because those
commands replace scaffold targets.

| Import | Use For |
| --- | --- |
| `@zero/framework/server` | Composition root, `createApp()`, `createServerRoute()`, backend service getters, plugins, config types. |
| `@zero/framework/react` | Client-safe components, hooks, SDK helpers, auth UI, storage UI. |
| `@zero/framework/react/app-provider` | Narrow AppProvider import for package-mode layouts. |
| `@zero/framework/react/hooks` | Narrow app-facing platform hooks such as `useCollection()`, `useLazyCollection()`, `useAuth()`, rooms, notifications, and Torrent workflow hooks. |
| `@zero/framework/schema` | Data model/table DSL. |
| `@zero/framework/icons` | Default Animate UI icon pack. |
| `@zero/framework/styles.css` | Packaged Zero stylesheet for app entrypoints that need explicit CSS import. |
| `@zero/framework/ai` | AI service contracts when importing the AI layer directly. |
| `@zero/framework/auth` | Auth plugin, store, token, and auth config contracts. |
| `@zero/framework/data-studio` | Browser-safe logical schema/value contracts, client table fragment, permissions, errors, and codecs. |
| `@zero/framework/data-studio/server` | Optional Data Studio install bundle, realm contribution, router, and scope-closed server service. |
| `@zero/framework/native` | Platform-neutral desktop/mobile public-client auth SDK. Use the packaged host-bridge recipes in `examples/native-auth`. |
| `@zero/framework/doctor` | Programmatic platform doctor use. Generated apps usually call `zero doctor`. |
| `@zero/framework/email` | Email providers/service contracts for custom adapters. App code usually calls `getEmailService()` from `server`. |
| `@zero/framework/kv` | Server-side KV/cache service, counters, limiters, and manual Elysia plugin. App code usually uses `zero.kv` from backend routes. |
| `@zero/framework/migrations` | Programmatic migration planning/status. Generated apps usually call `zero migrate`. |
| `@zero/framework/notifications` | Notification plugin/service contracts. React hooks/components come from `react`. |
| `@zero/framework/observability` | Backend sink, event, and code contracts. Server routes can also import these from `server`. |
| `@zero/framework/pdf` | Server-only PDF service, Chromium renderer, storage adapter, config, status, and browser installer contracts. App routes normally use `zero.pdf`. |
| `@zero/framework/persistence` | Advanced SQLite persistence foundation: hot snapshot, file/WAL, ephemeral modes, statement cache, transactions, and buffer pool. Most apps should let `createApp()` own this and use `zero.sql` in backend routes. |
| `@zero/framework/rooms` | Rooms and presence server contracts. React hooks come from `react`. |
| `@zero/framework/scheduler` | Scheduler service/plugin contracts. |
| `@zero/framework/storage` | Storage server contracts and adapters. React hooks/components come from `react`. |
| `@zero/framework/sync` | ReactiveDB and sync server contracts. |
| `@zero/framework/sync/client` | Lower-level WebSocket sync client primitives. Prefer `react` hooks in browser UI. |
| `@zero/framework/vector` | Vector store contracts when importing the vector layer directly. |
| `@zero/framework/workflows` | Torrent's workflow DSL, canonical IR/expressions, activity catalog, graph validation, and durable TypeBox schema-snapshot helpers. React workflow hooks come from `react`. |
| `@zero/framework/hooks` | Generic React hook library when importing hooks without the full React barrel. |
| `@zero/framework/modals` | Modal manager primitives when importing without the full React barrel. |
| `@zero/framework/components/auth` | Auth UI blocks and gates. Also exported from `react`. |
| `@zero/framework/components/animated-list` | Public animated list and event-card skin. Also exported from `react`. |
| `@zero/framework/components/bento-grid` | Public bento grid layout and cards. Also exported from `react`. |
| `@zero/framework/components/code-block` | Public Shiki code block with tabs, line numbers, and copy action. Also exported from `react`. |
| `@zero/framework/components/cta` | Public call-to-action section with Hero-compatible actions. Also exported from `react`. |
| `@zero/framework/components/data-table` | Data table primitives. Also exported from `react`. |
| `@zero/framework/components/data-studio` | Organization-owned logical-table control plane, workspace pieces, dialogs, value helpers, and geometry-stable inline cells. Primary control-plane exports are also available from `react`; use this narrow subpath for dialogs and value helpers. |
| `@zero/framework/components/expandable-card` | Public shared-layout expandable cards. Also exported from `react`. |
| `@zero/framework/components/faq` | Public FAQ accordion with generated answer support. Also exported from `react`. |
| `@zero/framework/components/features` | Public feature section with icon bullets and flexible image/code/custom visual slot. Also exported from `react`. |
| `@zero/framework/components/footer` | Full-width public footer band with brand, labeled nav links, action copy, actions, and social links. Also exported from `react`. |
| `@zero/framework/components/hero` | Public-page Hero section and background helpers. Also exported from `react`. |
| `@zero/framework/components/kanban` | Kanban board primitives and movement helpers. Also exported from `react`. |
| `@zero/framework/components/radial-menu` | Radial context menu organism. Also exported from `react`. |
| `@zero/framework/components/master-detail` | Master-detail primitives. Also exported from `react`. |
| `@zero/framework/components/navbar` | Public-page resizable navbar. Also exported from `react`. |
| `@zero/framework/components/secret-field` | Display-only masked/revealable secret with full-value copy. Also exported from `react`. |
| `@zero/framework/components/storage` | Storage management/dropzone UI. Also exported from `react`. |
| `@zero/framework/components/text-effects` | Public text effects for Hero titles and landing copy. Also exported from `react`. |
| `@zero/framework/components/streaming-text` | Accessible live/replayed text for AI, agents, and async string output. Also exported from `react`. |
| `@zero/framework/components/ui/<name>` | Direct UI primitive imports such as `button`, `input`, or `table`. |

Rule of thumb:

1. Use `@zero/framework/server` inside `app/server.ts`, `zero.config.ts`, and
   backend route modules when you want the app-level service getters.
2. Use the direct subsystem paths when writing adapters, tests, platform tools,
   or code that should depend on one specific Zero subsystem.
3. Use narrow frontend imports in generated/package-mode apps:
   `@zero/framework/react/app-provider`, `@zero/framework/react/hooks`, and
   `@zero/framework/components/*`. The broad `@zero/framework/react` barrel
   remains a convenience import, but it intentionally exposes a large surface.

## Generated App Shape

`create-zero` generates app-owned files only:

```txt
app/
  layout.tsx
  page.tsx
  server.ts
server/
  endpoints/
  middleware/
  plugins/
  resources/
  routes/
components/
hooks/
lib/
db/
  schema.ts
zero.config.ts
.env.example
.gitignore
package.json
README.md
tsconfig.json
```

Zero-owned runtime stays in `node_modules/@zero/framework`. App-owned generated
build glue lives in `.zero/generated` and should be ignored.

## Composition Root

The app server should stay small:

```ts
import { createApp, defineZeroConfig } from '@zero/framework/server';
import { tables } from './db/schema';

const config = defineZeroConfig({
  app: {
    name: process.env.APP_NAME ?? 'Zero App',
    publicUrl: process.env.APP_PUBLIC_URL,
    supportEmail: process.env.APP_SUPPORT_EMAIL,
  },
  db: {
    mode: process.env.DB_MODE === 'file'
      ? 'file'
      : process.env.DB_MODE === 'ephemeral'
        ? 'ephemeral'
        : 'hot',
    path: process.env.DB_PATH ?? './data/app.db',
    snapshotPath: process.env.DB_SNAPSHOT_PATH ?? './data/app.snapshot.db',
  },
  systemDb: {
    mode: process.env.SYSTEM_DB_MODE === 'hot' ? 'hot' : 'file',
    path: process.env.SYSTEM_DB_PATH ?? './data/zero.system.db',
    snapshotPath:
      process.env.SYSTEM_DB_SNAPSHOT_PATH ?? './data/zero.system.snapshot.db',
  },
  tables,
  auth: true,
  routeAuth: 'explicit',
  sitemap: {
    enabled: true,
    changefreq: 'weekly',
    priority: 0.7,
    exclude: ['/login', '/forgot-password', '/reset-password'],
  },
  stateSync: true,
  email: Boolean(process.env.RESEND_API_KEY),
  ai: true,
  vector: {
    dataDir: process.env.ZERO_VECTOR_DATA_DIR ?? './data/vector',
    defaultDimensions: Number(process.env.ZERO_VECTOR_DEFAULT_DIMENSIONS ?? 1536),
  },
  appDir: './app',
  serverPluginsDir: './server/plugins',
  serverMiddlewareDir: './server/middleware',
  serverEndpointsDir: './server/endpoints',
  serverRoutesDir: './server/routes',
  generatedDir: './.zero/generated',
  outDir: './.build',
  port: Number(process.env.PORT ?? 3000),
});

const app = await createApp(config);
app.listen(config.port);
```

`defineZeroConfig()` preserves literal type inference and returns the same
object. `createApp()` still owns runtime defaulting, validation, plugin
composition, and startup behavior. New apps should prefer SQLite `hot` mode
when they want the fastest in-memory active database with snapshot recovery,
or explicit `file` mode when every committed write should flow directly through
SQLite's file/WAL path.

`createApp()` currently installs these systems when configured:

| System | How it appears |
| --- | --- |
| ReactiveDB | Always created by sync plugin; app tables come from `tables`. |
| System ReactiveDB | Always separate from app data; owns Guardian and Zero state. Trusted server setup can reach the privileged `zero.system` facade. |
| ReactiveDB Fabric | With `databaseTopology.mode: 'multiple'`, keeps the shared application database pinned and routes named or physical-tenant Resources through bounded subprocess actors inside Zero 2.0's supported local-root boundary. |
| Data Studio | Mounted only when its complete `appTables` and exact normalized official Resource fragments are installed; adds the organization-scoped logical-table router over the composed Fabric realm. |
| Application SQL | Always created before plugins; app-owned backend routes can use `zero.sql`/`zero.sqlite` for backend-only application SQL. |
| WebSocket sync | Always mounted at `/sync`. Auth-aware and resource-policy-aware when auth/resources are enabled. |
| Auth | Mounted when `auth !== false`; adds `/auth/*`, request helpers, and protected page redirects. |
| Observability | Mounted by default; exposes protected Zero observability routes. |
| AI | Mounted when `ai !== false`; decorates Elysia context with `ai` and exposes optional status endpoint. |
| Vector | Mounted when `vector !== false`; decorates Elysia context with `vectors`; no public routes by default. |
| PDF | Mounted when `pdf !== false`; exposes lazy `zero.pdf`, starts Chromium on first render, and mounts no public routes. |
| KV/cache | Mounted by default; app-owned backend routes can use `zero.kv`, `zero.counter`, and `zero.limiter`. |
| Scheduler | Always mounted for platform jobs. |
| Notifications | Mounted when auth is enabled. |
| Rooms | Mounted when auth is enabled. |
| Torrent workflows | Mounted when auth is enabled. Public configuration and API vocabulary remain `workflows`. |
| Storage | Mounted when auth is enabled. |
| Sitemap | Mounted when `sitemap` is enabled; discovers public static file-router pages and omits protected, API, and dynamic routes unless explicitly listed. |
| `/api/data` | Mounted for lazy tables and guarded by sync policy, auth, and registered resource `list` policy. |
| App backend extensions | Loaded from `server/plugins`, `server/middleware`, `server/endpoints`, and `server/routes` before health and file-router catch-all. |
| File router | Mounted last; handles `app/**/page.tsx`, `layout.tsx`, `route.ts`, and 404s. |

### Multi-database composition boundary

ReactiveDB Fabric is configured at the composition root; app endpoints do not
open tenant SQLite files or accept a database path/ref from a request. In
physical tenant mode, Zero derives an authority-bound database capability from
the authenticated session and projects it through generated Resource CRUD,
lazy data queries, Sync, and the request `zero` service boundary.

Because source-mode actors re-enter the application executable, a Fabric app
must call `runDatabaseActorIfRequested({ realm })` before `createApp()`. Keep
the realm in a side-effect-free shared module and point `actors.launch` to that
server entry. Omitting `databaseTopology` preserves the ordinary composition
shown above. See [Platform Configuration](./platform-configuration.md#reactivedb-fabric-topology)
and the [Fabric architecture](./framework/multi-database-architecture.md) for
the complete supported contract and its deliberate exclusions.

### Data Studio composition boundary

Data Studio is an optional logical-table layer for organization-owned runtime
data. It is a plugin-style composition of existing Zero boundaries rather than
a tenant-selected raw SQLite service:

```ts
import {
  composeDatabaseRealm,
  databaseRealmContribution,
} from '@zero/framework/server';
import {
  createDataStudioFeature,
  DATA_STUDIO_REALM_CONTRIBUTION,
} from '@zero/framework/data-studio/server';

const dataStudio = createDataStudioFeature();
const tenantRealm = composeDatabaseRealm({
  name: 'app-tenant-data',
  version: '2',
  contributions: [
    databaseRealmContribution(appTenantRealm),
    DATA_STUDIO_REALM_CONTRIBUTION,
  ],
});

const config = defineZeroConfig({
  tables: { ...appTables, ...dataStudio.appTables },
  resources: [...appResources, ...dataStudio.resources],
  // Merge dataStudio.permissions/roleFragments into advanced Guardian auth.
  databaseTopology: {
    mode: 'multiple',
    realm: tenantRealm,
    tenantIsolation: 'tenant-database',
    // ...required rootDirectory/actors and ordinary Fabric options
  },
});
```

Use `appTables` unchanged for `createApp()` because it retains catalog metadata
as full Sync and row metadata as lazy Sync. Those generic projections omit
complete schemas/values; dedicated Data Studio routes provide the bounded full
reads. Use raw `DATA_STUDIO_TENANT_TABLES` / `tables` only for lower-level
realm/schema work. Startup rejects changed public Sync modes or fixed schemas,
including Guardian reference metadata and mutation validators, with
`DATABASE_CONFIG_INVALID`.
The actor entrypoint must pass the composed realm, not `appTenantRealm`, to
`runDatabaseActorIfRequested()`. The browser merges
`DATA_STUDIO_CLIENT_TABLES` into `AppProvider` and renders `DataStudio` or uses
`useDataStudio()`.

Spread `dataStudio.resources` unchanged. The built-in router mounts only after
complete table and registered actor query/command installation plus an exact
normalized match for every official Resource's name, table, primary key,
exposure, realm, actions, field allow-lists, and policy. Partial or altered
Resource contracts fail startup with `DATABASE_CONFIG_INVALID`. Registered Data
Studio operation names must still reference the official query/command handlers;
same-name replacements fail the same admission boundary.
Its session/API-key routes require an active organization and the relevant
`data-studio:*` permission. Server-owned functions and Torrent activities can
wrap their already-scoped `zero.data` in `createDataStudioService`; the service
has no tenant selector, path, raw SQL, or database manager.

See [Data Studio](./data-studio.md) for the full install, schema evolution,
inline UI, SDK, idempotency, limits, and Pantheon pattern.

## Data Models And ReactiveDB

Define schemas once and pass the shared table definitions to `createApp()` and
`AppProvider`. `createApp()` extracts `.serverTable`; `AppProvider` extracts
`.clientTable`.

```ts
import { defineTable, field } from '@zero/framework/schema';

export const customers = defineTable(
  'customers',
  {
    name: field.text({ label: 'Name', required: true, tableVisible: true }),
    owner_id: field.text({ label: 'Owner', tableVisible: false }),
    created_at: field.number({ label: 'Created At', integer: true, tableVisible: true }),
  },
  {
    pk: 'customer_id',
    sync: 'auto',
  }
);

export const tables = { customers };
```

Frontend code can bind the shared schema directly to the live collection:

```tsx
'use client';

import { DataTableView } from '@zero/framework/components/data-table';
import { customers } from '@/lib/schema';

export default function CustomersPage() {
  return (
    <DataTableView
      schema={customers.schema}
      collection="customers"
      columns={['name', 'created_at']}
      searchable={{ ariaLabel: 'Search customers' }}
    />
  );
}
```

Server code can write through ReactiveDB. Today, file `app/api/**/route.ts`
handlers receive `LoaderContext`, so app code should use server getters when it
needs platform services:

```ts
import { getSyncDB, type LoaderContext } from '@zero/framework/server';

export async function POST({ request, auth }: LoaderContext) {
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const db = getSyncDB();
  if (!db) return Response.json({ error: 'Database unavailable' }, { status: 503 });

  const change = db.create('customers', {
    customer_id: crypto.randomUUID(),
    name: body.name,
    owner_id: auth.userId,
    created_at: Date.now(),
  });

  return Response.json(change.row);
}
```

For richer backend routes, prefer Zero-native endpoint/router declarations under
`server/endpoints/**/*.ts` and `server/routes/**/*.ts`. They compile to Elysia
internally, inherit platform auth helpers, and receive a lazy `zero` service
object:

```ts
import { t } from 'elysia';
import { defineEndpoint, defineRouter } from '@zero/framework/server';

export default defineRouter({
  name: 'app.customers',
  prefix: '/api/customers',
  endpoints: [
    defineEndpoint({
      method: 'POST',
      path: '/',
      auth: 'user',
      body: t.Object({
        name: t.String(),
      }),
      handler: ({ body, user, zero }) => {
        // Direct DB access is the compatible single-tenant path. In a
        // multi-tenant app, prefer a registered tenant-realm resource.
        return zero.db.create('customers', {
          customer_id: crypto.randomUUID(),
          name: body.name,
          owner_id: user.userId,
          created_at: Date.now(),
        }).row;
      },
    }),
  ],
});
```

## Backend SQL Access

`createApp()` owns the platform SQLite service. App-owned backend routes should
use the injected Zero service context instead of opening `new Database()`:

```ts
import { createServerRoute } from '@zero/framework/server';

export default createServerRoute({ name: 'reports', prefix: '/api/reports' })
  .get('/', ({ zero }) => {
    const rows = zero.sql?.raw.prepare('SELECT * FROM reports').all() ?? [];
    return rows;
  });
```

Use `zero.db` when you want ReactiveDB change tracking and websocket sync. Use
`zero.sql`/`zero.sqlite` for backend-only SQL, migrations-style setup, reporting
queries, and application-owned internal tables. Both point at the pinned
application persistence foundation when mounted through `createApp()`.
Guardian and Zero-owned state instead live in `systemDb`; the deliberate
privileged facade is `zero.system.db` plus `zero.system.sql`/`.sqlite`, but
ordinary app code should use Guardian and platform services so it cannot bypass
their invariants. These direct application handles remain available at their
historical paths in single-tenant mode. In
multi-tenant request handlers they are intentionally available only under
`zero.unsafe.db` / `zero.unsafe.sql`, because Zero cannot infer a safe tenant
predicate for arbitrary SQL. Ordinary multi-tenant CRUD belongs in a
`defineResource({ exposure: 'all', realm: tenantRealm(), ... })` declaration;
choose `internal`, `http`, `sync`, or `all` deliberately for the transports the
resource may use.

## Backend KV/Cache Access

`createApp()` mounts durable memory-first KV/cache by default. Use it for
server-side cache values, counters, rate limits, short-lived workflow
coordination, and resume/intake scratch state that should survive normal
restarts without requiring Redis:

```ts
import { createServerRoute } from '@zero/framework/server';

export default createServerRoute({ name: 'intake.progress', prefix: '/api/intake' })
  .post('/draft/:id', async ({ params, body, zero }) => {
    // KV has caller-defined keys and is therefore an explicit raw capability
    // in multi mode. Prefix it with the validated scope, never request input.
    const draft = zero.unsafe.kv?.namespace(
      `tenant:${zero.scope?.tenantId}:intake-drafts`,
    );

    await draft?.set(params.id, body, { ttlMs: 14 * 24 * 60 * 60 * 1000 });
    await zero.unsafe.counter?.increment(
      `tenant:${zero.scope?.tenantId}:intake:draft-saves`,
    );

    return { saved: true };
  });
```

Set `kv: false` only when an app intentionally does not want this service.
Tests may use `kv: { durability: 'memory' }`; generated apps should keep the
default durable `everysec` mode or use `always` for stronger per-write flushes.

The `zero` object is the canonical backend service context for app-owned
server code:

| Name | Use |
| --- | --- |
| `zero.db` | ReactiveDB reads/writes. |
| `zero.sql` / `zero.sqlite` | Direct application-plane SQLite for backend-only app data. |
| `zero.system` | Privileged system-plane ReactiveDB and SQLite. Prefer platform services; multi-tenant request code must opt in through `zero.unsafe.system`. |
| `zero.auth` | Auth store/token helpers; values are `null` when auth is disabled. |
| `zero.tokens` | Generic action/resume token service for secure links and public continuation flows. |
| `zero.kv` | Durable memory-first KV/cache service. |
| `zero.counter` | Counter helpers backed by KV. |
| `zero.limiter` | Rate limiter helpers backed by KV. |
| `zero.ai` | Internal AI service, when enabled. |
| `zero.vector` | Vector service, when enabled. |
| `zero.pdf` | Browser-grade PDF service, when enabled. |
| `zero.email` | Email service; noop-backed when email is disabled. |
| `zero.storage` | Storage service, when enabled. |
| `zero.notifications` | Notification service, when enabled. |
| `zero.scheduler` | Scheduler service, when mounted. |
| `zero.workflows` | Torrent workflow service, when enabled. |
| `zero.observability` | Event emitters plus runtime/sink/store inspection. |

### Multi-tenant request boundary

In `auth.tenancy: 'multi'`, route handlers receive a request-bound facade:

- `zero.access` is the live authorization facade and `zero.scope` is the
  server-validated active tenant scope (or `null` during tenant selection);
- Storage, notifications, rooms, workflows, and PDF-to-storage automatically
  bind tenant and actor authority and do not accept a caller-selected tenant;
- the built-in HTTP routes and request facades share the same authority:
  platform `admin` remains compatible in `single`, while `multi` requires the
  active tenant owner/`allPermissions`/matching `notifications:manage`,
  `rooms:manage`, or `workflows:manage` permission for peer administration;
- advanced notification and Storage role grants consume all live assignments,
  never the global platform role or retained membership role as a fallback;
- observability emitters automatically attach the current user, membership,
  and tenant correlation, while the raw event store/sink remains privileged;
- raw DB/SQL, system persistence, auth stores and token services,
  KV/counters/limiters, vectors,
  scheduler controls, workflow registration, and runtime inspection throw
  `ZERO_UNSAFE_SERVICE_REQUIRED` at their historical paths;
- those raw capabilities remain deliberately reachable through `zero.unsafe`
  for migrations, platform administration, and other reviewed privileged
  operations. Workflow/background authority never receives this escape hatch.

`zero.unsafe` is not an authorization bypass to use casually: it marks code
whose tenant predicate, actor checks, audit trail, and retry/revalidation rules
are owned by the application. Single-tenant apps retain the existing direct
service paths unchanged.

Compatibility aliases remain available: `zero.syncDB`, `zero.vectors`,
`zero.workflowRegistry`, and `zero.auth.getTokenService()`. New code should
prefer the canonical names. Optional services return `null` when disabled or
not started; `zero.db` throws if app-owned server routes are mounted before the
sync plugin.

Prefer Zero's canonical service vocabulary in app-owned backend code:

| Service | Preferred methods |
| --- | --- |
| `zero.db` | `create()`, `get()`, `list()`, `update()`, `delete()` |
| `zero.auth.store` (single) / `zero.unsafe.auth.store` (multi) | `create()`, `get()`, `list()`, `update()`, `delete()` |
| `zero.tokens` | `createActionToken()`, `inspectActionToken()`, `consumeActionToken()`, `createResumeToken()`, `verifyResumeToken()`, `rotateResumeToken()`, `revokeResumeToken()`, `revokeResumeTokenById()` |
| `zero.kv` | `get()`, `set()`, `delete()`, `getOrSet()`, `compareAndSet()`, `namespace()` |
| `zero.counter` | `increment()`, `decrement()`, `value()`, `reset()` |
| `zero.limiter` | `fixedWindow()`, `tokenBucket()`, `slidingWindow()` |
| `zero.notifications` | `create()`, `get()`, `list()`, `delete()` |
| `zero.scheduler` | `create()`, `get()`, `list()`, `run()`, `delete()`, `stop()` |
| `zero.workflows` | `run()`, `get()`, `list()`, `sendEvent()`, `pause()`, `resume()`, `stop()` |
| `zero.vector` | `list()`, `search()`, `get()`, `status()` |
| `zero.pdf` | `render()`, `renderToStorage()`, `status()`, `close()` |
| `zero.storage` | `drives.*`, `objects.*`, `permissions.*`, and `uploads.*` grouped APIs |

Older names remain compatibility aliases. See
[Phase 4: Service API Smoothing](./framework/phase-4-service-api-smoothing.md)
for the full mapping.

Use `defineMiddleware()` for named app-owned middleware. The `matcher` decides
where middleware applies and which server-side policy must pass before `run()`
executes:

```ts
import { defineMiddleware } from '@zero/framework/server';

export default defineMiddleware({
  name: 'accounting-audit',
  matcher: {
    path: '/api/accounting/:path*',
    method: ['GET', 'POST'],
    auth: 'user',
    role: ['admin', 'manager'],
    properties: {
      department: ['accounting', 'management'],
    },
  },
  run({ request, user, zero }) {
    zero.observability.emitEvent({
      level: 'info',
      category: 'app.audit',
      code: 'APP_ACCOUNTING_ACCESS',
      message: 'Accounting route accessed.',
      metadata: {
        path: new URL(request.url).pathname,
        userId: user.userId,
      },
    });
  },
});
```

Matcher `path` supports exact paths, trailing `*` prefixes, `:path*` rest
prefixes, single-segment params such as `/users/:userId`, regular expressions,
and predicate functions. `path`, `method`, and `predicate` control
applicability; `auth`, `role`, and `properties` are fail-closed authorization
requirements once the middleware applies. `role` and `properties` imply
authenticated user access and property checks read the configured
`auth.userProperties` store.

Phase 1 middleware fields still work:

```ts
export default defineMiddleware({
  name: 'legacy-audit',
  path: '/api/customers/*',
  auth: 'user',
  run({ request, user, zero }) {
    zero.observability.emitEvent({
      level: 'info',
      category: 'app.audit',
      code: 'APP_CUSTOMERS_ACCESS',
      message: 'Customer route accessed.',
      metadata: {
        path: new URL(request.url).pathname,
        userId: user.userId,
      },
    });
  },
});
```

Raw Elysia remains the escape hatch. Put raw plugins in `server/routes/**/*.ts`
and use `createServerRoute()` when they need Zero helpers:

```ts
import { t } from 'elysia';
import { createServerRoute } from '@zero/framework/server';

export default createServerRoute({ name: 'app.raw-customers', prefix: '/api/customers' })
  .post(
    '/',
    ({ body, requireAuth, zero }) => {
      const user = requireAuth();

      return zero.db.create('customers', {
        customer_id: crypto.randomUUID(),
        name: body.name,
        owner_id: user.userId,
        created_at: Date.now(),
      }).row;
    },
    {
      body: t.Object({
        name: t.String(),
      }),
    }
  );
```

## WebSocket Sync And `/api/data`

WebSocket sync comes from `createApp()` automatically. The browser SDK connects
to `/sync`, subscribes to readable tables, applies snapshots, handles optimistic
mutations, and refreshes auth tokens through the auth client.

Use full sync for small shared tables and lazy sync for larger/query-heavy
tables:

```ts
defineTable({
  name: 'events',
  columns: {
    event_id: 'text primary key',
    title: 'text not null',
    starts_at: 'integer not null',
  },
  sync: 'lazy',
});
```

Lazy tables are queried through `/api/data`:

```tsx
import { useDataPage } from '@zero/framework/react';

const events = useDataPage('events', {
  page: 1,
  pageSize: 50,
  sort: [{ field: 'starts_at', direction: 'asc' }],
  filters: {
    starts_at: { gte: Date.now() },
  },
});
```

Auth and sync policy checks happen server-side. Frontend gates are convenience
UX only.

Registered resources add one more server-side guard. Unconstrained resource
`list` policies can use the normal WebSocket sync fast path. Row-constrained
resource lists, such as owner-only rows, use per-connection row filters for
snapshots, catchup, and live changes. Direct WebSocket mutations against
registered resources evaluate `create`, `update`, and `delete` policy before
writing.

## Migrations

Migrations are first-class backend tooling. The generated app should expose the
framework commands:

```json
{
  "scripts": {
    "migrate": "zero migrate --db ./data/zero.system.db",
    "migrate:status": "zero migrate --status --db ./data/zero.system.db",
    "migrate:plan": "zero migrate --plan --schema ./db/schema.ts --db ./data/app.db",
    "doctor": "zero doctor --config ./zero.config.ts"
  }
}
```

Current repo scripts are:

```txt
bun run migrate
bun run migrate:status
bun run migrate:plan
bun run doctor -- --config ./zero.config.ts
```

`createApp()` runs the managed framework migrations against `systemDb` on
startup unless `migrate: false` is set. It never installs that registry into
the application database. `migrate:plan` is a separate, non-mutating app-schema
inspection; Fabric realm migrations provision and upgrade physical tenant
databases through their owning actors.

## AI

AI is server-side by default. Enable provider auto-detection:

```ts
const config = {
  ai: true,
} satisfies AppConfig;
```

Supported providers are activated by env/config. Examples:

```txt
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
XAI_API_KEY=
COHERE_API_KEY=
LLAMA_API_KEY=
DEEPSEEK_API_KEY=
PERPLEXITY_API_KEY=
VOYAGE_API_KEY=
DEEPGRAM_API_KEY=
```

Use AI from server code:

```ts
import { getAI, type LoaderContext } from '@zero/framework/server';

export async function POST({ request }: LoaderContext) {
  const ai = getAI();
  if (!ai) return Response.json({ error: 'AI disabled' }, { status: 503 });

  const { prompt } = await request.json();
  const result = await ai.generateText({
    model: 'openai:gpt-4.1-mini',
    prompt,
  });

  return Response.json({ text: result.text });
}
```

For conversation-style calls:

```ts
import { getAI } from '@zero/framework/server';

const ai = getAI();
const conversation = ai?.conversation()
  .system('You summarize CRM notes.')
  .user('Call notes...');

const result = await conversation?.generate({
  model: 'anthropic:claude-sonnet-4',
});
```

Tools are server-side only:

```ts
import { aiTool, defineAITools, getAI } from '@zero/framework/server';

const tools = defineAITools({
  lookupCustomer: aiTool<{ customerId: string }, { customerId: string }>({
    description: 'Load a customer by id',
    input: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
      },
      required: ['customerId'],
      additionalProperties: false,
    },
    execute: async ({ customerId }) => {
      // Query ReactiveDB or a service here.
      return { customerId };
    },
  }),
});

await getAI()?.generateText({
  model: 'openai:gpt-4.1-mini',
  prompt: 'Find the customer',
  tools,
});
```

No public AI gateway routes are mounted by default.

## Vector Store

Vector storage is server-side by default. Enable it with `vector: true` or a
typed config:

```ts
const config = {
  vector: {
    dataDir: './data/vector',
    defaultIndex: 'documents',
    indexes: {
      documents: {
        dimensions: 1536,
        metadata: {
          bucket: 'string',
          owner_id: 'string',
        },
      },
    },
  },
} satisfies AppConfig;
```

Use the service from server code:

```ts
import { getVectorStore } from '@zero/framework/server';

const vectors = getVectorStore();

await vectors?.upsert('documents', [{
  id: 'doc_1',
  vector: embedding,
  text: 'Document text',
  metadata: {
    bucket: 'kb',
    owner_id: user.userId,
  },
}]);

const matches = await vectors?.search('documents', {
  vector: queryEmbedding,
  topK: 10,
  filter: {
    bucket: { eq: 'kb' },
  },
});
```

Use `createAIVectorBridge()` when the app wants AI embeddings plus vector
storage through one helper. Zero does not generate embeddings automatically for
every vector write.

## PDF Rendering

PDF is a server-only, opt-in service. Install Zero's pinned Chromium revision
once per development machine or deploy image, then enable it in
`zero.config.ts`:

```sh
bun run pdf:install
bun run pdf:status
```

```ts
const config = {
  pdf: {
    defaults: {
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
    },
    browser: {
      executablePath: Bun.env.ZERO_PDF_EXECUTABLE_PATH,
    },
  },
} satisfies AppConfig;
```

Use the lazy service from app-owned server code:

```ts
if (!zero.pdf) throw new Error('PDF rendering is disabled.');

const rendered = await zero.pdf.render({
  html: '<main><h1>Assessment</h1></main>',
  css: '@page { size: Letter; margin: 0.5in; }',
  document: { title: 'Assessment' },
});
```

`renderToStorage()` writes the generated bytes through Zero storage and
returns both render metadata and the stored object. The default policy disables
JavaScript and denies remote/file/private-network resources. Enable exact
origins explicitly when a document needs remote images or fonts. Zero mounts
no PDF HTTP route; the app owns route validation and authorization. See
[PDF Rendering](./pdf.md).

## Email

Email is configured by `createApp()`. `true` enables Resend by default:

```ts
const config = {
  app: {
    name: 'Acme CRM',
    publicUrl: 'https://crm.example.com',
    supportEmail: 'support@example.com',
  },
  email: {
    provider: 'resend',
    from: 'Acme CRM <noreply@example.com>',
    replyTo: 'support@example.com',
    resend: {
      apiKey: process.env.RESEND_API_KEY,
    },
  },
} satisfies AppConfig;
```

Use email from server code:

```ts
import { getEmailService } from '@zero/framework/server';

await getEmailService().send({
  to: 'user@example.com',
  subject: 'Welcome',
  text: 'Your account is ready.',
});
```

Auth account lifecycle emails use this same runtime.

## Platform Tokens

`createApp()` mounts the generic platform token service automatically. Server
routes, middleware, plugins, jobs, and workflows can use `zero.tokens` for
one-time actions and long-lived continuation links.

Use action tokens for consume-once flows:

```ts
const verification = zero.tokens?.createActionToken({
  purpose: 'intake.email.verify',
  subject: { type: 'intake-draft', id: draftId },
  scope: 'clinic-intake',
  ttl: '30m',
});

const verified = zero.tokens?.consumeActionToken(token, {
  purposes: ['intake.email.verify'],
  scope: 'clinic-intake',
});
```

Use resume tokens for long public forms that can be continued later:

```ts
const resume = zero.tokens?.createResumeToken({
  flow: 'clinic-intake',
  resource: { type: 'intake-draft', id: draftId },
  ttl: '14d',
});

const draft = zero.tokens?.verifyResumeToken(token, {
  flow: 'clinic-intake',
  resource: { type: 'intake-draft', id: draftId },
});
```

See [Platform Tokens](./tokens.md) for the full contract.

## Notifications

Notifications mount when auth is enabled. Server code can use the service:

```ts
import { getNotificationService } from '@zero/framework/server';

await getNotificationService()?.notify(user.userId, {
  type: 'info',
  priority: 'normal',
  title: 'Report ready',
  body: 'Your export finished.',
});
```

Frontend code uses the hooks/components:

```tsx
import { NotificationCenter, useNotifications } from '@zero/framework/react';

function HeaderNotifications() {
  const notifications = useNotifications();

  return (
    <NotificationCenter
      items={notifications.notifications.map((item) => ({
        id: item.notification_id,
        title: item.title,
        body: item.body,
        read: item.read,
        timestamp: item.created_at,
      }))}
      badgeCount={notifications.unreadCount}
      onMarkAllRead={notifications.markAllRead}
      onOpen={notifications.markAllSeen}
      onItemRead={notifications.markRead}
      onItemDismiss={notifications.dismiss}
    />
  );
}
```

Receipt actions flow through authenticated HTTP routes and then sync back to
clients.

## Storage

Storage mounts when auth is enabled. Use hooks/components in the browser:

```tsx
import { StorageDropzone, StorageManagement } from '@zero/framework/react';

function Files() {
  return (
    <>
      <StorageDropzone driveId="default" path="/" />
      <StorageManagement />
    </>
  );
}
```

Use `useUploadDropzone()` directly when the app needs a custom upload surface
instead of the provided `StorageDropzone` component.

Use `useDriveCapabilities()` before enabling custom storage controls, and use
`useStoragePermissions()` plus `useStorageActions().grantPermission()` /
`revokePermission()` for admin grant screens. Grants can target roles, exact
user IDs, or configured auth user-property values.

Server code can use the service for backend-owned storage tasks:

```ts
import { getStorageService } from '@zero/framework/server';

const storage = getStorageService();
const userId = 'u_123';
const drive = storage?.drives.create(userId, { name: 'Reports' });
const folder = drive
  ? storage?.objects.createFolder(drive.drive_id, '/q2', userId)
  : null;
```

Permissions and upload authorization stay in backend storage routes. For public
flows that still write into private storage, issue scoped upload grants from
backend code:

```ts
const grant = await storage?.uploads.create('drv_private_uploads', {
  path: `/intakes/${intakeId}/insurance-card.png`,
  expiresIn: 15 * 60,
  maxSize: 5 * 1024 * 1024,
  contentTypes: ['image/png', 'image/jpeg', 'application/pdf'],
  metadata: { intakeId, kind: 'insurance-card' },
  flow: 'intake',
  resource: { type: 'intake', id: intakeId },
});
```

The browser sends the file to `PUT /storage/upload-grants/:token`. The object
is private by default and normal storage read permissions still apply.

## Torrent Workflows And Scheduler

Torrent is Zero's durable workflow system. It mounts by default when auth is
enabled while retaining the established `workflows` configuration, import,
route, table, and error-code vocabulary. Register trusted activities
and definitions through `AppConfig.workflows.register`; Zero awaits
registration before activity preflight and crash recovery, and publishes the
service only after recovery succeeds:

```ts
import { defineZeroConfig } from '@zero/framework/server';
import {
  flow,
  parallel,
  requestAndWait,
  step,
} from '@zero/framework/workflows';

export default defineZeroConfig({
  // db, tables, auth...
  workflows: {
    register(registry) {
      registry.registerActivity({
        name: 'email.welcome',
        version: '2',
        default: true,
        databaseCallable: true,
        handler: async (ctx) => {
          await sendWelcomeEmail(ctx.input, {
            idempotencyKey: ctx.idempotencyKey,
            signal: ctx.signal,
          });
          return { ok: true };
        },
      });

      registry.registerActivity({
        name: 'account.audit',
        version: '1',
        handler: async (ctx) => writeAccountAudit(ctx.input),
      });

      registry.create({
        name: 'customer-onboarding',
        version: 2,
        access: {
          start: ['operator'],
          inspect: ['operator', 'reviewer'],
        },
        flow: flow(
          parallel('prepare', {
            email: [step('send-welcome', 'email.welcome')],
            audit: [step('record-start', 'account.audit')],
          }),
          requestAndWait('approval', 'approval.received', {
            request: { title: 'Approve onboarding' },
            timeoutMs: 24 * 60 * 60 * 1_000,
          }),
        ),
      });
    },
  },
});
```

For a 1.3 upgrade, move registration out of `onStart` or any code that runs
after `listen()`. Direct-composition code may use `getWorkflowRegistry()` after
`createApp()` returns and before `listen()`, but post-listen registration is too
late for recovery preflight.

Authenticated workflow starts preserve the exact live Guardian credential:
either a session or an explicitly admitted user API key. The request-scoped
`zero.workflows.start()`/`.run()` facade captures that actor, derives the active
application/tenant scope server-side, enforces definition start access, and
revalidates the same credential at dispatch and commit. It never persists the
session token or raw API-key secret.

The code DSL compiles into the canonical JSON-safe graph used by immutable
database definitions, agents, and visual-editor tooling. Choices are persisted
once, parallel branches converge at explicit all-branches joins, and `each`
snapshots its array before running a bounded number of keyed item activities.
Database/API definitions can reference only activity versions that app code
marks `databaseCallable: true`. Publication rejects output references that do
not exist or do not dominate their consumer. Persisted TypeBox schemas retain
their runtime kind in `x-zero-typebox-kind`, reject executable transforms, and
share a bounded 2 MiB definition/draft persistence contract.

At runtime each graph activity receives resolved `ctx.input`, original
`ctx.workflowInput`, a cooperative `signal`, a physical `attemptId`, a stable
logical-node/item `idempotencyKey`, and a ReactiveDB-backed `ctx.memory`
scratchpad. Memory writes are attempt-local and commit atomically only with a
successful node transition. Recovery is at-least-once for external systems, so
email, payments, webhooks, and storage writes must deduplicate with
`idempotencyKey`.

Managed activities also receive a scope-closed `ctx.zero` facade. Its mutable
services repeat the live execution-authority assertion at their commit edge;
all observability writer methods assert immediately before the sink emission so
a captured facade cannot emit stale user/tenant-attributed telemetry after
revocation.

`waitFor` uses the durable event inbox. `requestAndWait` persists an interaction
before optional email/SMS/UI/agent delivery and accepts one authorized,
schema-validated, idempotent response from any transport. Deadlines cover the
whole logical node; pause freezes retry, timeout, and open-interaction expiry
time. The secure default allows only the workflow starter to answer;
`workflows.interactionAuthority` installs one fail-closed Guardian/app policy
adapter for both direct and event-delivered responses.

That app policy remains authoritative at the commit edge. Zero reevaluates a
synchronous allow decision inside the final response transaction. If the
initial decision is asynchronous, an allow must return a
`WorkflowInteractionAuthorityLease` whose synchronous
`assertCurrent(expectedRevision, context)` callback fences the captured
app-policy revision in that same transaction; a bare async allow or
asynchronous commit assertion fails closed with `WORKFLOW_CONFIG_INVALID`.
This lets an app await its normal policy lookup without leaving a revocation
window during response validation, while keeping the final assertion bounded
to local synchronous state.

Authenticated HTTP event responses persist a secret-free, MAC-sealed Guardian
authority bound to the complete canonical event command/private envelope and
actor snapshot. Event, tenant, instance, name, exact payload JSON, sender,
timestamp, actor, authority, and seal fields are immutable. Consumption revalidates the
exact credential/account/scope/membership/RBAC identity and repeats the fence
before committing an accepted response. Callback roles come from that
validated authority; custom claims remain send-time app metadata, so reload
mutable app-specific state and honor the callback `AbortSignal`. The explicit
`sendEventAsSystem()` path uses a scope-checked sealed system principal;
legacy/unsealed events cannot answer an interaction.

The private event `authority_kind` distinguishes actor, explicit system, and
legacy-untrusted rows. Event capacity accounts for actor JSON plus authority
JSON/MAC bytes. Interaction decision and event consumption share one
ReactiveDB transaction, while recovery reconciles any finalized response whose
claim survived a crash. Legacy-untrusted rows remain consumable by ordinary
`waitFor`; that compatibility does not grant responder identity.
An actor/system row whose seal fails verification is not equivalent to an
intentionally unsealed legacy row: graph and legacy ordinary waits terminally
fail before invoking a handler, and interaction waits consume it as a safe
rejection.

Event-delivered responses also persist a trusted internal origin and exact
event foreign key. Public callers cannot select the reserved `event` channel or
an `event:` submission ID, and cleanup never infers runtime authority from
caller-controlled strings. Recovery preflights every running and paused run's
sealed execution authority before publishing the service or dispatching work;
invalid runs fail and drain their private event inbox atomically.

One live workflow runtime owns each physical workflow database. Startup takes
an internal durable owner-generation lease before publication/recovery; an
overlapping live service fails retryably with `WORKFLOW_RUNTIME_OWNED`.
Graceful shutdown releases the exact generation, abrupt owners become eligible
only after heartbeat expiry, and every legacy/graph/each/interaction/definition
commit is generation-fenced. A former owner fails with
`WORKFLOW_RUNTIME_LEASE_LOST` and cannot commit late state. This protects
workflow persistence; activities must still deduplicate external side effects
with `ctx.idempotencyKey`.

Each durable runtime JSON value is limited to 1 MiB. Run/step/fan-out values,
scratch memory, interaction policy/schema/request data, and retained
submission/accepted values share a 32 MiB aggregate budget per run. Each
interaction also retains at most 1,024 actor-and-payload-bound unique
submissions or 16 MiB of payload/accepted data. Event names and per-run pending
and retained delivery count/byte quotas are bounded as well. A direct
interaction response submitted while paused fails with retryable
`WORKFLOW_DRAINING` and must be retried after resume; an authenticated named
event may remain buffered through the pause.

Runtime JSON is a strict data boundary rather than ordinary lossy
`JSON.stringify`: non-finite numbers, nested `undefined`, sparse arrays,
cycles, accessors, and class instances fail before persistence. Authoring-time
graph defects return `422 WORKFLOW_GRAPH_INVALID`; semantic failure of an
immutable stored graph returns `500 WORKFLOW_DEFINITION_GRAPH_INVALID`;
corrupt durable runtime state returns `500 WORKFLOW_STATE_INVALID`; and the
transition/runtime-value ceiling returns
`500 WORKFLOW_RUNTIME_LIMIT_EXCEEDED`. Dynamic `each` input/key failures use
`422 WORKFLOW_ACTIVITY_INPUT_INVALID`. Authority capture and scope failures use
`WORKFLOW_AUTHORITY_REQUIRED`, `WORKFLOW_AUTHORITY_CHANGED`,
`WORKFLOW_SCOPE_REQUIRED`, and `WORKFLOW_SCOPE_INVALID`. The changed-authority
commit fence is a non-retryable 409. Workflow HTTP surfaces preserve safe 4xx
messages. A recognized 5xx `WorkflowError` keeps its stable code and applicable
`retryable: true` marker but replaces its diagnostic with a generic safe
message; an unexpected 5xx uses `WORKFLOW_INTERNAL_ERROR`. Inspect the
app-local request-failure event for the original cause.

Managed workflow observability is app-local and transaction-aware.
State-derived lifecycle events are queued through the owning ReactiveDB's
`afterCommit` boundary, so they are absent while the writer transaction is open,
suppressed by rollback, and emitted once after the winning commit. Operational
failures that do not represent committed state emit immediately. Only
standalone composition without an app runtime falls back to the process-global
sink.

Definitions and runs pin canonical content and exact activity versions.
The active service-data scope's workflow manager can manage database drafts,
publish immutable versions, activate a default, and retire versions through
`/workflows/admin/definitions`. In single/application scope that includes the
established platform administrator. In multi-tenant scope it means the active
tenant owner, `allPermissions`, or `workflows:manage`; the `/admin/` path does
not grant cross-tenant authority. Code definitions are application-scoped. A
tenant database definition shadows a same-name code definition only in that
tenant, while application database definitions remain outside tenant
management.
Definition `access.start` and `access.inspect` accept `authenticated`, `admin`,
or an app-role array; denied definitions look missing at the HTTP boundary.
`access.inspect` gates definition catalog/discovery, not a starter's sanitized
monitoring of their own pinned run. A scope manager can monitor every run only
inside that active service-data scope.

Do not conflate the request-scoped facade with the raw `WorkflowService`.
Scoped `zero.workflows.start()`/`.run()` adapt to `runAsActor()`, enforce
definition access, and close every operation over the current actor and scope.
A raw managed service rejects compatibility `start()`/`run()` with
`WORKFLOW_AUTHORITY_REQUIRED`; trusted plugins and jobs must call
`runAsSystem(name, input, { principal, reason, scope }, { version? })`, while
code holding a live `AuthContext` calls
`runAsActor(name, input, context, { version? })`. System and standalone
compatibility starts bypass definition access; actor starts do not. Managed
apps should let the workflow plugin own startup recovery and retry/timeout
discovery.

Framework adapters that must close an admission-to-commit authority race may
pass a synchronous assertion as the optional fifth `runAsActor()` argument, or
use the raw service's captured-actor/mutation fence contracts. That surface is
documented in [Torrent: Durable Workflows](./workflows.md#actor-and-system-starts) and is
not needed by ordinary app code using scoped `zero.workflows`.

Authorized runtime state is projected through ReactiveDB Sync. Hooks expose
`activeSteps`, ordered payload-redacted `events`, safe `interactions`,
parallel/wait/retry flags, and safe node/branch/parent/item-index identity for
live visualization without polling. `useWorkflowTopology` performs a single
authenticated load of the immutable presentation topology pinned to that run.
Graph JSON, memory, interaction request/response bodies, and coordination rows stay
private. Event payloads and all workflow instance/step input, output, and
raw error values are redacted from HTTP and Sync while safe status, timing, and
topology labels stay live. The scheduler's minute retry/timeout jobs are a
persisted-state safety sweep; exact in-process timers handle normal deadlines.
See
[Torrent: Durable Workflows](./workflows.md) for the full DSL, IR, version, lifecycle,
authorization, HTTP, and React contracts. A public cron/job registration
convention for app code is a future package-mode slice.

Direct workflow/Sync composition uses `createWorkflowSyncPolicyAdapter()`.
The adapter ANDs its owner-or-active-scope-manager rule with the app delegate,
preserves delegate projectors and mutation/read validators, and emits one
composite comparable read-authority fingerprint. Its
`resolveManagementAccess` callback must be synchronous for browser Sync;
returning a promise leaves no synchronous final-delivery comparison and the
socket is rejected closed. Live workflow-management or delegate-policy
revision changes invalidate the composite authority before another row can be
delivered. `createApp()` installs the managed equivalent automatically.

## Observability And Tracing

Observability is enabled by default. Backend code should emit through stable
codes and sinks:

```ts
import { OBS_CODES, emitPlatformCode } from '@zero/framework/server';

emitPlatformCode(OBS_CODES.APP_LISTENING, {
  metadata: {
    port: 3000,
  },
});
```

Frontend code uses the browser sink:

```ts
import { emitFrontendCode, FRONTEND_OBS_CODES } from '@zero/framework/react';

emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_COPY_FAILED, {
  metadata: {
    action: 'copy-api-key',
  },
});
```

OpenTelemetry is intentionally not required right now. A later adapter can
bridge Zero's sink API to OTel, Sentry, files, or HTTP collectors.

## Components And Hooks

Default usage should import packaged components and hooks:

```tsx
import {
  Button,
  AnimatedList,
  BentoGrid,
  CodeBlock,
  CtaSection,
  DataTable,
  ExpandableCards,
  Faq,
  FeaturesSection,
  FooterSection,
  Hero,
  MasterDetailView,
  LoginForm,
  PlatformUserManagement,
  QRCode,
  ResizableNavbar,
  StreamingText,
  TextGenerateEffect,
  useAuth,
  useDataPage,
  useStorageBrowser,
  useIdle,
} from '@zero/framework/react';

import {
  MFAEnrollmentForm,
  MFAManagementPanel,
} from '@zero/framework/components/auth';
```

`UserManagement`/`PlatformUserManagement` is the default Guardian control
plane rather than a global-user-only table. It preserves the familiar
single/simple account manager, composes application RBAC in single/advanced,
uses tenant membership/RBAC in customer scope, and adds compact People and
Workspaces views in the protected Administration Organization. The workspace
view can administer customer membership, roles, and ownership through its
dedicated application capability without granting customer application-data
access; global account-security controls remain independently authorized.
Focused
`TenantMemberManagement` and `PlatformWorkspaceManagement` exports remain
available when an app is intentionally composing a custom control plane.

Narrow imports are also supported:

```tsx
import { DataTableView } from '@zero/framework/components/data-table';
import { Faq } from '@zero/framework/components/faq';
import { FeaturesSection } from '@zero/framework/components/features';
import { CtaSection } from '@zero/framework/components/cta';
import { FooterSection } from '@zero/framework/components/footer';
import { CodeBlock } from '@zero/framework/components/code-block';
import { ExpandableCards } from '@zero/framework/components/expandable-card';
import { BentoGrid } from '@zero/framework/components/bento-grid';
import { AnimatedList } from '@zero/framework/components/animated-list';
import { Hero } from '@zero/framework/components/hero';
import { KanbanBoard } from '@zero/framework/components/kanban';
import { RadialMenu } from '@zero/framework/components/radial-menu';
import { ResizableNavbar } from '@zero/framework/components/navbar';
import { TextGenerateEffect } from '@zero/framework/components/text-effects';
import { StreamingText } from '@zero/framework/components/streaming-text';
import { SecretField } from '@zero/framework/components/secret-field';
import {
  LoginForm,
  MFAEnrollmentForm,
  MFAManagementPanel,
} from '@zero/framework/components/auth';
import { QRCode } from '@zero/framework/components/qr-code';
import { useDisclosure } from '@zero/framework/hooks';
import { Button } from '@zero/framework/components/ui/button';
import { Checkbox } from '@zero/framework/components/ui/checkbox';
import { Progress } from '@zero/framework/components/ui/progress';
import {
  RadioGroup,
  RadioGroupItem,
} from '@zero/framework/components/ui/radio-group';
```

Use `zero add` only when the app needs to customize source. It copies selected
files into the app, follows app-owned alias dependencies, and rewrites
framework-internal imports to public `@zero/framework/*` package paths:

```sh
zero add components/ui/button
zero add components/data-table
zero add components/faq
zero add components/features
zero add components/cta
zero add components/footer
zero add components/code-block
zero add components/expandable-card
zero add components/bento-grid
zero add components/animated-list
zero add components/hero
zero add components/kanban
zero add components/navbar
zero add components/text-effects
zero add components/streaming-text
zero add components/secret-field
zero add hooks modals --dry-run
zero add components/storage --target ./my-app
```

Supported source-copy targets:

| Target | Copies |
| --- | --- |
| `components/ui/<name>` | One UI primitive plus app-owned dependencies such as `lib/utils.ts`. |
| `components/auth` | Auth forms, password flows, and auth visibility gates. |
| `components/animated-list` | Public animated list, list item, event-card skin, and motion dependencies. |
| `components/bento-grid` | Public bento grid layout, item, skeleton, and dependencies. |
| `components/code-block` | Public Shiki code block, tabs, copy action, and dependencies. |
| `components/cta` | Public call-to-action section with Hero-compatible actions and dependencies. |
| `components/data-table` | Data table, toolbar, pagination, row actions, and dependencies. |
| `components/expandable-card` | Public shared-layout expandable cards and close/outside-click dependencies. |
| `components/faq` | Public FAQ accordion, generated answer text, icons, and dependencies. |
| `components/features` | Public feature showcase section, icon bullets, visual slot, and dependencies. |
| `components/footer` | Full-width public footer band with brand, labeled nav links, action copy, actions, social links, and dependencies. |
| `components/hero` | Public-page Hero section, background helpers, actions, and dependencies. |
| `components/kanban` | Kanban board, task card, movement helpers, and dependencies. |
| `components/master-detail` | Master-detail primitives and dependencies. |
| `components/navbar` | Resizable public-page navbar and its animated icon/button dependencies. |
| `components/secret-field` | Tokenized display-only secret field, clipboard boundary, and icon/button dependencies. |
| `components/storage` | Storage management, file browser, drive list, dropzone, and dependencies. |
| `components/text-effects` | Public text effects for Hero titles, landing copy, and docs/content headings. |
| `components/streaming-text` | Accessible live, caller-owned, and replayed text plus the shared class-name helper. |
| `hooks` | Generic React hook library. |
| `modals` | Modal manager primitives. |

Existing files are skipped by default. Use `--force` to overwrite, or
`--dry-run` to inspect the copy plan first.

## Current Gaps To Close

1. Decide whether package exports should point at source `.ts` files long-term
   or a built `dist/` artifact for non-Bun consumers.
