# Framework Developer Surface

This document maps how an app developer should use Zero when it behaves like an
installed framework. It is intentionally honest about the current branch state:
the runtime exists, but package-mode exports, `create-zero`, and user Elysia
route loading are still being added.

## Current And Target Imports

Current source-tree imports use the existing aliases:

```ts
import { createApp, type AppConfig } from '@platform/server';
import { AppProvider, Button, useCollection } from '@platform/frontend';
```

Target package-mode imports should look like this once the package export map is
in place:

```ts
import { createApp, type AppConfig } from '@zero/framework/server';
import { AppProvider, Button, useCollection } from '@zero/framework/react';
import { defineSchema, defineTable } from '@zero/framework/schema';
```

The names above are the intended developer surface. Until the package name is
final, use the current `@platform/*` aliases in this repository.

## Generated App Shape

`create-zero` should generate app-owned files only:

```txt
app/
  layout.tsx
  page.tsx
  api/
server/
  routes/
  services/
  workflows/
db/
  schema.ts
  migrations/
zero/
  auth.ts
  sync.ts
  storage.ts
  ai.ts
  vector.ts
  observability.ts
components/
hooks/
lib/
zero.config.ts
.env.example
```

Zero-owned runtime stays in `node_modules/@zero/framework`. App-owned generated
build glue lives in `.zero/generated` and should be ignored.

## Composition Root

The app server should stay small:

```ts
import { createApp, type AppConfig } from '@zero/framework/server';
import { tables } from './db/schema';

const config = {
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
  generatedDir: './.zero/generated',
  outDir: './.build',
  port: Number(process.env.PORT ?? 3000),
} satisfies AppConfig;

const app = await createApp(config);
app.listen(config.port);
```

`createApp()` currently installs these systems when configured:

| System | How it appears |
| --- | --- |
| ReactiveDB | Always created by sync plugin; app tables come from `tables`. |
| WebSocket sync | Always mounted at `/sync`. Auth-aware when auth is enabled. |
| Auth | Mounted when `auth !== false`; adds `/auth/*`, request helpers, and protected page redirects. |
| Observability | Mounted by default; exposes protected Zero observability routes. |
| AI | Mounted when `ai !== false`; decorates Elysia context with `ai` and exposes optional status endpoint. |
| Vector | Mounted when `vector !== false`; decorates Elysia context with `vectors`; no public routes by default. |
| Scheduler | Always mounted for platform jobs. |
| Notifications | Mounted when auth is enabled. |
| Rooms | Mounted when auth is enabled. |
| Workflows | Mounted when auth is enabled. |
| Storage | Mounted when auth is enabled. |
| `/api/data` | Mounted for lazy tables and guarded by sync policy/auth integration. |
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

  const change = db.insert('customers', {
    customer_id: crypto.randomUUID(),
    name: body.name,
    owner_id: auth.userId,
    created_at: Date.now(),
  });

  return Response.json(change.row);
}
```

Next package-mode slice should add `server/routes/**/*.ts` Elysia plugin loading.
Those route modules should get typed Elysia context directly:

```ts
import { Elysia, t } from 'elysia';

export default new Elysia({ name: 'app.customers', prefix: '/api/customers' })
  .post(
    '/',
    ({ body, requireAuth, syncDB }) => {
      const user = requireAuth();
      return syncDB.insert('customers', {
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

## Migrations

Migrations are first-class backend tooling. The generated app should expose the
framework commands:

```json
{
  "scripts": {
    "migrate": "zero migrate",
    "migrate:status": "zero migrate --status",
    "migrate:plan": "zero migrate --plan",
    "doctor": "zero doctor"
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

const matches = await vectors?.query('documents', {
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

getWorkflowRegistry()?.registerWorkflow({
  name: 'customer-onboarding',
  steps: [
    { name: 'Send welcome email', handler: 'sendWelcomeEmail' },
  ],
});

await getWorkflowService()?.start('customer-onboarding', {
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

Long-term, `zero add <component>` should copy selected components/hooks into
the app source tree for customization. Do not copy the entire component library
by default.

## Current Gaps To Close

1. Add package export map and final package name.
2. Add `server/routes/**/*.ts` Elysia plugin loader.
3. Add typed config helpers such as `defineZeroConfig()`.
4. Add `create-zero` project scaffolding.
5. Add a package-mode fixture app that imports the framework like a dependency.
6. Add `zero add` for copying selected components/hooks into app source.
