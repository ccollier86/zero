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
| `@zero/framework/react/hooks` | Narrow app-facing platform hooks such as `useCollection()`, `useLazyCollection()`, `useAuth()`, rooms, notifications, and workflow hooks. |
| `@zero/framework/schema` | Data model/table DSL. |
| `@zero/framework/icons` | Default Animate UI icon pack. |
| `@zero/framework/styles.css` | Packaged Zero stylesheet for app entrypoints that need explicit CSS import. |
| `@zero/framework/ai` | AI service contracts when importing the AI layer directly. |
| `@zero/framework/auth` | Auth plugin, store, token, and auth config contracts. |
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
| `@zero/framework/workflows` | Workflow registry/service contracts. React workflow hooks come from `react`. |
| `@zero/framework/hooks` | Generic React hook library when importing hooks without the full React barrel. |
| `@zero/framework/modals` | Modal manager primitives when importing without the full React barrel. |
| `@zero/framework/components/auth` | Auth UI blocks and gates. Also exported from `react`. |
| `@zero/framework/components/animated-list` | Public animated list and event-card skin. Also exported from `react`. |
| `@zero/framework/components/bento-grid` | Public bento grid layout and cards. Also exported from `react`. |
| `@zero/framework/components/code-block` | Public Shiki code block with tabs, line numbers, and copy action. Also exported from `react`. |
| `@zero/framework/components/cta` | Public call-to-action section with Hero-compatible actions. Also exported from `react`. |
| `@zero/framework/components/data-table` | Data table primitives. Also exported from `react`. |
| `@zero/framework/components/expandable-card` | Public shared-layout expandable cards. Also exported from `react`. |
| `@zero/framework/components/faq` | Public FAQ accordion with generated answer support. Also exported from `react`. |
| `@zero/framework/components/features` | Public feature section with icon bullets and flexible image/code/custom visual slot. Also exported from `react`. |
| `@zero/framework/components/footer` | Full-width public footer band with brand, labeled nav links, action copy, actions, and social links. Also exported from `react`. |
| `@zero/framework/components/hero` | Public-page Hero section and background helpers. Also exported from `react`. |
| `@zero/framework/components/kanban` | Kanban board primitives and movement helpers. Also exported from `react`. |
| `@zero/framework/components/radial-menu` | Radial context menu organism. Also exported from `react`. |
| `@zero/framework/components/master-detail` | Master-detail primitives. Also exported from `react`. |
| `@zero/framework/components/navbar` | Public-page resizable navbar. Also exported from `react`. |
| `@zero/framework/components/storage` | Storage management/dropzone UI. Also exported from `react`. |
| `@zero/framework/components/text-effects` | Public text effects for Hero titles and landing copy. Also exported from `react`. |
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
| ReactiveDB Fabric | With `databaseTopology.mode: 'multiple'`, keeps the shared application database pinned and routes named or physical-tenant Resources through bounded subprocess actors. Unreleased release-candidate surface. |
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
| Workflows | Mounted when auth is enabled. |
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
shown above. See [Platform Configuration](./platform-configuration.md#reactivedb-fabric-topology-unreleased-candidate)
and the [Fabric architecture](./framework/multi-database-architecture.md) for
the complete, currently unreleased contract.

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

Frontend code uses the SDK/hooks:

```tsx
'use client';

import { useCollection } from '@zero/framework/react/hooks';
import { DataTable } from '@zero/framework/components/data-table';

export default function CustomersPage() {
  const customers = useCollection('customers');

  return (
    <DataTable
      data={customers.data}
      columns={[
        { accessorKey: 'name', header: 'Name' },
      ]}
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
| `zero.workflows` | Workflow service, when enabled. |
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
| `zero.workflows` | `run()`, `get()`, `list()`, `stop()` |
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
    "migrate": "zero migrate --db ./data/app.db",
    "migrate:status": "zero migrate --status --db ./data/app.db",
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

`createApp()` runs migrations on startup for file-backed databases unless
`migrate: false` is set.

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

## Workflows And Scheduler

Workflows mount when auth is enabled. Register workflow definitions and step
handlers on the server:

```ts
import { getWorkflowRegistry, getWorkflowService } from '@zero/framework/server';

getWorkflowRegistry()?.registerHandler('sendWelcomeEmail', async (ctx) => {
  // Use email, AI, storage, or app services here.
  return { ok: true };
});

getWorkflowRegistry()?.create({
  name: 'customer-onboarding',
  steps: [
    { name: 'Send welcome email', handler: 'sendWelcomeEmail' },
  ],
});

await getWorkflowService()?.run('customer-onboarding', {
  customerId: 'cust_1',
});
```

The scheduler is mounted by `createApp()` and platform jobs use it for retries,
timeouts, and cleanup. A public cron/job registration convention for app code is
a future package-mode slice.

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
| `components/storage` | Storage management, file browser, drive list, dropzone, and dependencies. |
| `components/text-effects` | Public text effects for Hero titles, landing copy, and docs/content headings. |
| `hooks` | Generic React hook library. |
| `modals` | Modal manager primitives. |

Existing files are skipped by default. Use `--force` to overwrite, or
`--dry-run` to inspect the copy plan first.

## Current Gaps To Close

1. Decide whether package exports should point at source `.ts` files long-term
   or a built `dist/` artifact for non-Bun consumers.
