# Framework Developer Surface

This document maps how an app developer should use Zero when it behaves like an
installed framework. It is intentionally honest about the current branch state:
the runtime, package export map, and app-owned Elysia route loader exist on this
branch; `create-zero` now writes a fixture-derived starter app, and `zero add`
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
import { AppProvider, Button, useCollection } from '@zero/framework/react';
import { defineSchema, defineTable } from '@zero/framework/schema';
```

The current `@platform/*` aliases still work in this repository for compatibility,
but new app code should use `@zero/framework/*`.

| Import | Use For |
| --- | --- |
| `@zero/framework/server` | Composition root, `createApp()`, `createServerRoute()`, backend service getters, plugins, config types. |
| `@zero/framework/react` | Client-safe components, hooks, SDK helpers, auth UI, storage UI. |
| `@zero/framework/schema` | Data model/table DSL. |
| `@zero/framework/icons` | Default Animate UI icon pack. |
| `@zero/framework/styles.css` | Packaged Zero stylesheet for app entrypoints that need explicit CSS import. |
| `@zero/framework/ai` | AI service contracts when importing the AI layer directly. |
| `@zero/framework/auth` | Auth plugin, store, token, and auth config contracts. |
| `@zero/framework/doctor` | Programmatic platform doctor use. Generated apps usually call `zero doctor`. |
| `@zero/framework/email` | Email providers/service contracts for custom adapters. App code usually calls `getEmailService()` from `server`. |
| `@zero/framework/migrations` | Programmatic migration planning/status. Generated apps usually call `zero migrate`. |
| `@zero/framework/notifications` | Notification plugin/service contracts. React hooks/components come from `react`. |
| `@zero/framework/observability` | Backend sink, event, and code contracts. Server routes can also import these from `server`. |
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
| `@zero/framework/components/data-table` | Data table primitives. Also exported from `react`. |
| `@zero/framework/components/master-detail` | Master-detail primitives. Also exported from `react`. |
| `@zero/framework/components/storage` | Storage management/dropzone UI. Also exported from `react`. |
| `@zero/framework/components/ui/<name>` | Direct UI primitive imports such as `button`, `input`, or `table`. |

Rule of thumb:

1. Use `@zero/framework/server` inside `app/server.ts`, `zero.config.ts`, and
   backend route modules when you want the app-level service getters.
2. Use the direct subsystem paths when writing adapters, tests, platform tools,
   or code that should depend on one specific Zero subsystem.
3. Use `@zero/framework/react` in browser UI first. Reach for direct component
   paths only when you want a narrow import.

## Generated App Shape

`create-zero` generates app-owned files only:

```txt
app/
  layout.tsx
  page.tsx
  server.ts
server/
  routes/
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
    mode: process.env.DB_PATH ?? './data/app.db',
  },
  tables,
  auth: true,
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
composition, and startup behavior.

`createApp()` currently installs these systems when configured:

| System | How it appears |
| --- | --- |
| ReactiveDB | Always created by sync plugin; app tables come from `tables`. |
| WebSocket sync | Always mounted at `/sync`. Auth-aware and resource-policy-aware when auth/resources are enabled. |
| Auth | Mounted when `auth !== false`; adds `/auth/*`, request helpers, and protected page redirects. |
| Observability | Mounted by default; exposes protected Zero observability routes. |
| AI | Mounted when `ai !== false`; decorates Elysia context with `ai` and exposes optional status endpoint. |
| Vector | Mounted when `vector !== false`; decorates Elysia context with `vectors`; no public routes by default. |
| Scheduler | Always mounted for platform jobs. |
| Notifications | Mounted when auth is enabled. |
| Rooms | Mounted when auth is enabled. |
| Workflows | Mounted when auth is enabled. |
| Storage | Mounted when auth is enabled. |
| `/api/data` | Mounted for lazy tables and guarded by sync policy, auth, and registered resource `list` policy. |
| App backend extensions | Loaded from `server/plugins`, `server/middleware`, `server/endpoints`, and `server/routes` before health and file-router catch-all. |
| File router | Mounted last; handles `app/**/page.tsx`, `layout.tsx`, `route.ts`, and 404s. |

## Data Models And ReactiveDB

Define schemas once and pass their server tables to `createApp()`:

```ts
import { defineSchema, defineTable } from '@zero/framework/schema';

export const customers = defineTable({
  name: 'customers',
  columns: {
    customer_id: 'text primary key',
    name: 'text not null',
    owner_id: 'text',
    created_at: 'integer not null',
  },
  sync: 'auto',
});

export const db = defineSchema({
  customers,
});

export const tables = db.serverTables;
```

Frontend code uses the SDK/hooks:

```tsx
'use client';

import { DataTable, useCollection } from '@zero/framework/react';

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

The `zero` object is the canonical backend service context for app-owned
server code:

| Name | Use |
| --- | --- |
| `zero.db` | ReactiveDB reads/writes. |
| `zero.auth` | Auth store/token helpers; values are `null` when auth is disabled. |
| `zero.tokens` | Generic action/resume token service for secure links and public continuation flows. |
| `zero.ai` | Internal AI service, when enabled. |
| `zero.vector` | Vector service, when enabled. |
| `zero.email` | Email service; noop-backed when email is disabled. |
| `zero.storage` | Storage service, when enabled. |
| `zero.notifications` | Notification service, when enabled. |
| `zero.scheduler` | Scheduler service, when mounted. |
| `zero.workflows` | Workflow service, when enabled. |
| `zero.observability` | Event emitters plus runtime/sink/store inspection. |

Compatibility aliases remain available: `zero.syncDB`, `zero.vectors`,
`zero.workflowRegistry`, and `zero.auth.getTokenService()`. New code should
prefer the canonical names. Optional services return `null` when disabled or
not started; `zero.db` throws if app-owned server routes are mounted before the
sync plugin.

Prefer Zero's canonical service vocabulary in app-owned backend code:

| Service | Preferred methods |
| --- | --- |
| `zero.db` | `create()`, `get()`, `list()`, `update()`, `delete()` |
| `zero.auth.store` | `create()`, `get()`, `list()`, `update()`, `delete()` |
| `zero.tokens` | `createActionToken()`, `inspectActionToken()`, `consumeActionToken()`, `createResumeToken()`, `verifyResumeToken()`, `rotateResumeToken()`, `revokeResumeToken()` |
| `zero.notifications` | `create()`, `get()`, `list()`, `delete()` |
| `zero.scheduler` | `create()`, `get()`, `list()`, `run()`, `delete()`, `stop()` |
| `zero.workflows` | `run()`, `get()`, `list()`, `stop()` |
| `zero.vector` | `list()`, `search()`, `get()`, `status()` |
| `zero.storage` | `drives.*`, `objects.*`, and `permissions.*` grouped APIs |

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

Permissions and upload authorization stay in backend storage routes.

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
  DataTable,
  MasterDetailView,
  LoginForm,
  UserManagement,
  useAuth,
  useDataPage,
  useStorageBrowser,
  useIdle,
} from '@zero/framework/react';
```

Narrow imports are also supported:

```tsx
import { DataTableView } from '@zero/framework/components/data-table';
import { LoginForm } from '@zero/framework/components/auth';
import { useDisclosure } from '@zero/framework/hooks';
import { Button } from '@zero/framework/components/ui/button';
```

Use `zero add` only when the app needs to customize source. It copies selected
files into the app, follows app-owned alias dependencies, and rewrites
framework-internal imports to public `@zero/framework/*` package paths:

```sh
zero add components/ui/button
zero add components/data-table
zero add hooks modals --dry-run
zero add components/storage --target ./my-app
```

Supported source-copy targets:

| Target | Copies |
| --- | --- |
| `components/ui/<name>` | One UI primitive plus app-owned dependencies such as `lib/utils.ts`. |
| `components/auth` | Auth forms, password flows, and auth visibility gates. |
| `components/data-table` | Data table, toolbar, pagination, row actions, and dependencies. |
| `components/master-detail` | Master-detail primitives and dependencies. |
| `components/storage` | Storage management, file browser, drive list, dropzone, and dependencies. |
| `hooks` | Generic React hook library. |
| `modals` | Modal manager primitives. |

Existing files are skipped by default. Use `--force` to overwrite, or
`--dry-run` to inspect the copy plan first.

## Current Gaps To Close

1. Decide whether package exports should point at source `.ts` files long-term
   or a built `dist/` artifact for non-Bun consumers.
