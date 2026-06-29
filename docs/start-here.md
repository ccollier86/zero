# Start Here

Zero is a Bun/Elysia full-stack app platform. The goal is fast data-driven app
development without wiring separate backend services for auth, storage, sync,
workflows, notifications, state, or email account flows.

Before platform work, read:

1. [Engineering Standards](./engineering-standards.md)
2. [Observability](./observability.md)
3. [Releasing Zero](./releasing.md)

New reusable platform logs, warnings, caught errors, and lifecycle events should
go through the observability boundary. When touching code that bypasses it,
correct that path if it is in scope.

## Create An App

For the package-mode framework surface and the current import gaps, see
[Framework Developer Surface](./framework-developer-surface.md).

Put app config in `zero.config.ts` so the server, platform doctor, and future
tools read the same source:

```ts
import type { AppConfig } from '@platform/server';
import { tables } from './lib/schemas';

const PORT = Number(Bun.env.PORT ?? 3000);
const hasEmail = Boolean(Bun.env.RESEND_API_KEY);
const hasAI = Boolean(
  Bun.env.OPENAI_API_KEY ||
  Bun.env.ANTHROPIC_API_KEY ||
  Bun.env.GEMINI_API_KEY ||
  Bun.env.GOOGLE_API_KEY ||
  Bun.env.GROQ_API_KEY ||
  Bun.env.META_LLAMA_API_KEY ||
  Bun.env.LLAMA_API_KEY
);
const hasVector = Bun.env.ZERO_VECTOR_ENABLED === 'true';

const config = {
  app: {
    name: Bun.env.APP_NAME ?? 'Zero App',
    publicUrl: Bun.env.APP_PUBLIC_URL ?? `http://localhost:${PORT}`,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
  },
  db: { mode: Bun.env.DB_PATH ?? './data/app.db' },
  tables,
  email: hasEmail
    ? {
        from: Bun.env.EMAIL_FROM ?? 'Zero App <noreply@example.com>',
        replyTo: Bun.env.EMAIL_REPLY_TO,
        provider: 'resend',
        resend: { apiKey: Bun.env.RESEND_API_KEY },
      }
    : false,
  auth: {
    registration: { mode: 'admin-only' },
    accountEmails: {
      adminCreatedUser: hasEmail,
      passwordReset: hasEmail,
      manualPasswordReset: Bun.env.AUTH_MANUAL_PASSWORD_RESET !== 'false',
      actionTokenTTL: Bun.env.AUTH_ACTION_TOKEN_TTL ?? '1h',
      requestCooldown: Bun.env.AUTH_ACCOUNT_EMAIL_COOLDOWN ?? '5m',
    },
  },
  ai: hasAI ? true : false,
  vector: hasVector
    ? {
        dataDir: Bun.env.ZERO_VECTOR_DATA_DIR ?? './data/vector',
        defaultDimensions: Number(Bun.env.ZERO_VECTOR_DEFAULT_DIMENSIONS ?? 1536),
      }
    : false,
  stateSync: true,
  port: PORT,
} satisfies AppConfig;

export default config;
export { config };
```

Then keep `app/server.ts` small:

```ts
import { createApp } from '@platform/server';
import config from '../zero.config';

const app = await createApp(config);
app.listen(config.port ?? 3000);
```

Zero builds and links the platform stylesheet automatically when `createApp()`
starts. Wrap app UI in `ThemeProvider` to enable the default light/dark/system
token contract:

```tsx
import type { ReactNode } from 'react';
import { ThemeProvider, Toaster } from '@platform/frontend';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="zero-theme">
      <div className="min-h-screen bg-background text-foreground font-sans antialiased">
        {children}
        <Toaster />
      </div>
    </ThemeProvider>
  );
}
```

During startup, Zero also generates client build glue in `.zero/generated`.
Those files connect the app route manifest to Zero's hydration runtime and are
safe to delete; `createApp()` regenerates them before bundling the browser
entry. Keep `.zero/` ignored in app repositories.

The core UI primitives and Animate UI wrappers share the same token contract:
`background`, `card`, `popover`, `muted`, `accent`, `input`, `border`, `ring`,
and semantic state colors. Keep new components on those tokens, keep ordinary
cards at `rounded-lg` or smaller, and check both light and dark modes before
shipping shared UI changes. Zero keeps Playwright available as a dev dependency
for local screenshot checks against running or static routes.

Run the platform doctor against an exported config module:

```txt
bun run doctor -- --config ./zero.config.ts
bun run doctor -- --config ./zero.config.ts --strict
bun run doctor -- --config ./zero.config.ts --json
```

`doctor` checks app config, table primary keys and natural identities, auth
email readiness, login/public route safety, storage/auth mismatch, migration
startup policy, sync policy/index guidance, observability endpoint readiness,
AI provider/alias readiness, and vector index/storage safety. Warnings do not
fail by default; use `--strict` in CI.

Use `migrate:doctor` and `migrate:plan` for database drift:

```txt
bun run migrate:doctor -- --schema ./app/lib/schemas.ts --strict
bun run migrate:plan -- --schema ./app/lib/schemas.ts --write
```

## Environment

Common variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. |
| `DB_PATH` | SQLite file path, or `:memory:` for temporary DBs. |
| `APP_NAME` | Display name used by system email. |
| `APP_PUBLIC_URL` | Public origin for setup/reset links. |
| `APP_SUPPORT_EMAIL` | Optional support/reply identity. |
| `EMAIL_FROM` | Default sender. |
| `EMAIL_REPLY_TO` | Optional reply-to. |
| `RESEND_API_KEY` | Enables the default Resend provider. |
| `ACCESS_TOKEN_TTL` | Access token lifetime. |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime. |
| `AUTH_ACTION_TOKEN_TTL` | Setup/reset token lifetime. |
| `AUTH_ACCOUNT_EMAIL_COOLDOWN` | Cooldown for active setup/reset emails per user/type. |
| `AUTH_MANUAL_PASSWORD_RESET` | `false` disables direct admin password replacement. |
| `AUTH_SIGNING_KEY` | Optional externally managed ES256 private JWK. |
| `OPENAI_API_KEY` | Enables OpenAI in the AI layer. |
| `ANTHROPIC_API_KEY` | Enables Anthropic in the AI layer. |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Enables Google Generative AI in the AI layer. |
| `GROQ_API_KEY` | Enables Groq in the AI layer. |
| `LLAMA_API_KEY` / `META_LLAMA_API_KEY` | Enables Zero's custom Meta Llama provider. |
| `DEEPGRAM_API_KEY` | Enables Deepgram transcription and speech in the AI layer. |
| `ZERO_AI_FAST_MODEL` | Optional `fast` alias override. |
| `ZERO_AI_SMART_MODEL` | Optional `smart` alias override. |
| `ZERO_AI_EMBEDDING_MODEL` | Optional `embedding` alias override. |
| `ZERO_AI_IMAGE_MODEL` | Optional `image` alias override. |
| `ZERO_AI_TRANSCRIPTION_MODEL` | Optional `transcription` alias override. |
| `ZERO_AI_SPEECH_MODEL` | Optional `speech` alias override. |
| `ZERO_VECTOR_ENABLED` | App convention for enabling `vector` config. |
| `ZERO_VECTOR_DATA_DIR` | Default zvec collection directory. |
| `ZERO_VECTOR_DEFAULT_DIMENSIONS` | Default vector dimensions for `vector: true`. |

## Tables And Primary Keys

ReactiveDB-managed tables require one sync primary key:

```ts
export const tables = {
  todos: {
    todo_id: 'text primary key',
    title: 'text not null',
    done: 'integer not null default 0',
    created_at: 'integer not null',
  },
};
```

For relationship tables that would normally use a composite primary key, keep
one string sync primary key and declare a natural identity:

```ts
export const tables = {
  memberships: {
    membership_id: 'text primary key',
    team_id: 'text not null',
    user_id: 'text not null',
    role: 'text not null',
    _identity: ['team_id', 'user_id'],
  },
};
```

Zero generates deterministic sync ids from `_identity`, creates a unique
identity index, and exposes identity helpers in the SDK. Do not put composite
primary keys in ReactiveDB-managed sync tables.

## Built-In Systems

Zero includes these backend capabilities out of the box:

| System | What it provides |
| --- | --- |
| Auth | Users, admin bootstrap, token rotation, registration policy, configured user properties, account status, setup/reset flows. |
| Email | Provider boundary with Resend default and custom provider support. |
| ReactiveDB | SQLite table definition, change tracking, ring-buffer replay, natural identity. |
| Sync | WebSocket snapshots, live updates, lazy/auto sync, sync policy hooks. |
| Data API | `/api/data` reads for lazy tables with pagination, sorting, filtering, limits, and auth/policy integration. |
| Storage | Built-in file storage with platform auth boundaries and a reusable management organism. |
| State Sync | Per-user server-persisted reactive key/value state. |
| Notifications | Server-created notifications and receipt tracking. |
| Rooms/Presence | Presence and room coordination primitives. |
| Workflows | Built-in workflow/scheduler infrastructure. |
| Migrations | Explicit migration files, ledger, schema history, rollback, backups, doctor, draft plans. |
| Observability | Structured event codes, default console/memory sink, protected event endpoint, frontend ingest. |
| AI | Internal server-side AI service with env-detected providers, custom Meta Llama adapter, aliases, conversations, tools, embeddings, images, transcription, speech, and protected status. |
| Vector Store | Local zvec-backed vector persistence/search with scoped filters and AI embedding bridge helpers. |

## Frontend Hook Library

Zero ships app-ready hooks from `@platform/frontend` so frontend work can stay
fast without each app rewriting auth, sync, storage, workflow, notification,
room, and UI state glue.

Platform-specific hooks include:

| Area | Hooks |
| --- | --- |
| Auth/session | `useAuth`, `useAuthConfig`, `useCurrentUser`, `useRequireAuth`, `useUserProperty` |
| Live data | `useCollection`, `useLazyCollection`, `useDataPage`, `useRecord`, `useRecordByIdentity`, `useDataSelection` |
| Storage | `useUpload`, `useUploadQueue`, `useUploadDropzone`, `useStorageFile`, `useStorageBrowser`, `useDriveQuota` |
| Rooms/presence | `usePresence`, `usePresenceList`, `useTypingIndicator`, `useEphemeral`, `useEphemeralTopic` |
| Workflows/notifications | `useWorkflowRun`, `useWorkflow`, `useWorkflowList`, `useNotifications`, `useUnreadCount` |
| State and health | `useServerState`, `usePreference`, `useFormDraft`, `useConnectionHealth`, `useMutation` |

Zero also exports a standard React hook set for common UI behavior such as
`useAsyncAction`, `useClickAway`, `useCopyToClipboard`,
`useDebouncedCallback`, `useDebouncedValue`, `useDisclosure`, `useHotkey`,
`useIdle`, `useInterval`, `useMediaQuery`, `useMounted`, `useOs`,
`usePrevious`, `useStableCallback`, `useTextSelection`,
`useThrottledCallback`, `useThrottledValue`, and `useTimeout`. For AI chats,
live logs, and streaming feeds, Zero re-exports `use-stick-to-bottom` as
`StickToBottom`, `useStickToBottom`, and `useStickToBottomContext` so apps get
the library's smooth spring scroll-to-bottom behavior without a custom platform
clone. These generic utilities will continue expanding as the frontend library
is polished.

See [Frontend Hooks](./frontend/hooks.md) and [SDK](./frontend/sdk.md).

## Default Icons

Zero's default platform icon pack is the Animate UI animated Lucide set. Import
icons from `@platform/frontend/icons` instead of reaching into internal
component folders:

```tsx
import { AnimateIcon, Check, Trash, ZeroIcon } from '@platform/frontend/icons';

<Check animate className="text-emerald-600" />;

<AnimateIcon animateOnHover>
  <Trash size={18} />
</AnimateIcon>;

<ZeroIcon name="arrow-right" size={18} animateOnHover />;
```

Use animated platform icons for app and platform UI by default. Use
`lucide-react` directly only when Zero does not provide the icon shape yet.
Use text labels instead of emojis for actions, states, and navigation. See
[Frontend Icons](./frontend/icons.md).

## AI

Enable AI with provider keys and `ai: true`:

```ts
const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
  ai: true,
});
```

Use it only from server code:

```ts
import { getAI } from '@platform/server';

const ai = getAI();
if (!ai) throw new Error('AI is not enabled.');

const result = await ai.conversation({
  model: 'smart',
  system: 'You are a precise app assistant.',
})
  .user('Summarize this customer record.')
  .generate();
```

Inspect active providers from server code with `ai.status()`. Zero mounts no AI
routes by default; an optional protected status route can be enabled explicitly
when an app wants HTTP runtime inspection. See [AI](./ai.md), [AI
Providers](./ai-providers.md), [AI Conversations](./ai-conversations.md),
[AI Tools](./ai-tools.md), and [Meta Llama](./ai-meta-llama.md).

## Vector Store

Enable local zvec-backed vector storage when an app needs embeddings, semantic
search, or app-owned RAG data without a separate vector server:

```ts
const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
  ai: true,
  vector: {
    dataDir: './data/vector',
    defaultIndex: 'knowledge',
    indexes: {
      knowledge: {
        dimensions: 1536,
        metadata: {
          bucket: 'string',
          source: 'string',
          tenantId: 'string',
        },
      },
    },
  },
});
```

Use vectors from server code only:

```ts
import { createAIVectorBridge, getAI, getVectorStore } from '@platform/server';

const ai = getAI();
const vectors = getVectorStore();
if (!ai || !vectors) throw new Error('AI/vector services are not enabled.');

const bridge = createAIVectorBridge({ ai, vectors });
await bridge.embedAndUpsert('knowledge', {
  id: 'docs:1',
  text: 'Zero stores vectors locally with zvec.',
  metadata: { bucket: 'docs' },
});
```

Zero mounts no vector routes by default. The vector service owns storage and
search only; AI still owns embedding generation. See [Vector Store](./vector.md).

## Reusable Data UI

Zero includes reusable frontend organisms for fast data-driven screens:

| Organism | Use it for | Docs |
| --- | --- | --- |
| `DataTableView` | Schema-aware tables with full-sync, lazy `/api/data`, or caller-owned sources. | [docs/frontend/data-table.md](./frontend/data-table.md) |
| `MasterDetailView` | A table/list plus detail panel, generated edit form, custom detail body, and record navigation. | [docs/frontend/master-detail.md](./frontend/master-detail.md) |
| `DetailPanel` / `ListDetailLayout` / `RecordNavigationBar` | Custom detail screens that need the polished shell without the full organism. | [docs/frontend/master-detail.md](./frontend/master-detail.md#low-level-detail-primitives) |

These components use schema primary keys by default. Do not assume `row.id`
unless the table schema actually uses `id` as its primary key.

## Auth Defaults

The first registered user is always the bootstrap admin. After that:

| Mode | Behavior |
| --- | --- |
| `public` | Public registration stays open. |
| `admin-only` | Admins create users. |
| `disabled` | No public or platform admin user creation after bootstrap. |

Admin user management supports create, update, delete, promote, suspend,
activate, revoke sessions, direct reset, setup email, and password reset email.
`GET /auth/admin/users` supports `limit`, `offset`, `search`, `role`, and
`status`.

For frontend admin dashboards, use the reusable organism instead of a page:

```tsx
import { UserManagement } from '@platform/frontend';

export function UsersSettingsPanel() {
  return <UserManagement className="h-[720px]" />;
}
```

The component self-wires to the admin auth SDK, loads `/auth/admin/config`,
uses backend pagination plus `search`, `role`, and `status` filters, adapts
configured `auth.userProperties`, and hides email-only actions when the email
runtime is not ready.

Email-driven setup/reset flows validate email readiness before changing account
state. Forgot-password responses avoid user enumeration and cooldown repeats do
not send additional emails.

Reusable auth UI blocks are exported from `@platform/frontend`:

```tsx
import {
  ChangePasswordForm,
  ForgotPasswordForm,
  LoginForm,
  PasswordActionForm,
  RegisterForm,
  UserPropertiesForm,
} from '@platform/frontend';
```

`LoginForm`, `RegisterForm`, and `ForgotPasswordForm` read `/auth/config` and
wait for policy before exposing registration/reset actions.
`PasswordActionForm` handles reset/setup tokens from email links and blocks
invalid or mode-mismatched tokens before submit.
`UserPropertiesForm` renders only user-editable `auth.userProperties`.

For storage dashboards, embed the reusable organism:

```tsx
import { StorageManagement } from '@platform/frontend';

export function FilesSettingsPanel() {
  return <StorageManagement className="h-[42rem]" />;
}
```

It manages drives, file browsing, uploads, folders, rename, visibility, and
delete confirmation through the platform storage hooks and authenticated SDK
transport.

For focused upload surfaces, use `StorageDropzone` or `useUploadDropzone`:

```tsx
import { StorageDropzone } from '@platform/frontend';

export function InvoiceDropzone({ driveId }: { driveId: string }) {
  return <StorageDropzone driveId={driveId} path="/invoices" />;
}
```

## Configuration Files

The long-term shape is a `zero/` or `config/zero/` folder with typed config
modules. Inline `createApp()` config is supported today and should stay small.
See [Platform Configuration Protocol](./platform-configuration.md).

## Development Loop

1. Define tables with one sync primary key.
2. Add natural identity for relationship tables.
3. Add migrations for schema/index changes.
4. Run `bun run doctor -- --config ./zero.config.ts` for app config.
5. Run `bun run migrate:doctor -- --schema ./app/lib/schemas.ts`.
6. Use `--strict` in CI.
7. Run `bun run typecheck` and `bun test` before shipping platform changes.
