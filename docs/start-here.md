# Start Here

Zero is a Bun/Elysia full-stack app platform. The goal is fast data-driven app
development without wiring separate backend services for auth, storage, sync,
workflows, notifications, state, platform tokens, PDF rendering, or email
account flows.

Before platform work, read:

1. [Engineering Standards](./engineering-standards.md)
2. [Observability](./observability.md)
3. [Component Inventory](./frontend/component-inventory.md)
4. [Releasing Zero](./releasing.md)

For a fresh repo orientation, read the root [README](../README.md). For
agent-assisted app development, give the agent [llms.txt](../llms.txt) before
it starts planning so it reaches for Zero surfaces before rebuilding existing
pieces.

New reusable platform logs, warnings, caught errors, and lifecycle events should
go through the observability boundary. When touching code that bypasses it,
correct that path if it is in scope.

## Create An App

For the package-mode framework surface and remaining package-mode work, see
[Framework Docs](./framework/README.md) and
[Framework Developer Surface](./framework-developer-surface.md).
For frontend composition, reusable UI, Animate UI wrappers, app shells, forms,
and data organisms, start with the
[Component Inventory](./frontend/component-inventory.md).
For styling decisions, read [Frontend Design Tokens](./frontend/design-tokens.md):
Zero now has a quiet core app lane for dashboards and a richer public/frontend
lane for docs, marketing, blogs, landing pages, and public flows.
The repository also includes `examples/package-mode` as the blank generated-app
starter that imports Zero through `@zero/framework/*`.
Packaged `examples/native-auth` factories show the minimal trusted host bridge
for desktop loopback and mobile browser-authentication sessions using the
implemented `@zero/framework/native` TypeScript core. They do not make the
separate Rust/Tauri Phase 0 scaffold or private Chrome preview released SDKs.
Choose an installed-app surface with the
[App Authentication SDK Guide](./auth/app-auth-sdk-guide.md), then use the
[complete provider guide](./auth/native-app-auth.md) for redirects, lifecycle,
security, and deployment.
The in-repo LaunchBoard app is the larger frontend reference: it keeps root
providers in `app/layout.tsx`, mounts its shell at `/` through
`app/(launchboard)/layout.tsx`, and uses AppShell, ReactiveDB collections,
KanbanBoard, auth bootstrap routes, owner-scoped resources, and the platform
modal manager together. See [LaunchBoard](./frontend/launchboard.md) before
building dashboard/work-queue style apps.

Core backend primitives include ReactiveDB, generated resources, WebSocket
sync, auth, email, storage, [durable workflows](./workflows.md), notifications,
AI, vector storage, [PDF rendering](./pdf.md), and
[platform tokens](./tokens.md) for one-time actions plus resumable public
flows.

Create a new app with:

```sh
create-zero my-app
cd my-app
bun install
bun run dev
```

Inside this repository, the same scaffolder is available as:

```sh
bun run create-zero -- my-app
```

For local framework development before publishing Zero, generate the app from
a publish-style archive of this checkout:

```sh
bun run install:local-tools
zero-new ../my-zero-app
cd ../my-zero-app
bun run dev
```

Without the local convenience wrapper:

```sh
bun run create-zero -- ../my-zero-app --local --install
cd ../my-zero-app
bun run dev
```

## Update Zero Without Regenerating The App

For an app created from this checkout, stop its app/dev server, install the
local tools once, and run the checkout-bound updater from the app:

```sh
cd /path/to/zero-platform
bun run install:local-tools
cd /path/to/my-zero-app
zero-update
```

`zero-update [project-dir]` defaults to the current directory and packs the
checkout that installed the wrapper. Preview it with `zero-update --dry-run`.
For published-package projects, use `bun run zero update --project .`; add
`--latest` only when you intentionally want the newest published release. If
the installed framework predates this command, bootstrap it with
`bunx --package @zero/framework@latest zero update --project .`. The equivalent
explicit local command is:

```sh
zero update --project /path/to/my-zero-app --local /path/to/zero-platform
```

The project must already have exactly one `bun.lock` or `bun.lockb`, even for a
dry-run. Commit that lockfile for checkout-local apps. The updater directly
manages only Zero dependency artifacts and package-manager install state. A
local update regenerates the ignored `.zero/framework/zero-framework.tgz`
cache from the chosen checkout. In a clean clone, the `.zero/` directories and
archive may be completely absent; a mutating update creates them before
installation, while `--dry-run` reports the pending work without creating
anything. Existing symlinks or wrong-type entries at those managed paths are
rejected. The updater leaves app-owned files, environment configuration,
databases, and storage alone in its default mode, and runs no app-defined
scripts. `--check` executes the project's existing typecheck and Doctor
scripts; review them first because their side effects are outside updater
rollback. Zero itself never selects a migration command. Run
`bun run migrate:plan` separately and intentionally against the correct
database or a safe copy before applying any database change.

Do not run `create-zero --force` or `zero-new --force` against an existing app
to update it. Those commands scaffold projects and may replace a non-empty
target; they are never an update path.

Put app config in `zero.config.ts` so the server, platform doctor, and future
tools read the same source:

```ts
import { defineZeroConfig } from '@zero/framework/server';
import { tables } from './db/schema';

const PORT = Number(Bun.env.PORT ?? 3000);
const hasEmail = Boolean(Bun.env.RESEND_API_KEY);
const hasAI = Boolean(
  Bun.env.OPENAI_API_KEY ||
  Bun.env.ANTHROPIC_API_KEY ||
  Bun.env.GEMINI_API_KEY ||
  Bun.env.GOOGLE_API_KEY ||
  Bun.env.GROQ_API_KEY ||
  Bun.env.XAI_API_KEY ||
  Bun.env.COHERE_API_KEY ||
  Bun.env.META_LLAMA_API_KEY ||
  Bun.env.LLAMA_API_KEY ||
  Bun.env.DEEPSEEK_API_KEY ||
  Bun.env.PERPLEXITY_API_KEY ||
  Bun.env.VOYAGE_API_KEY ||
  Bun.env.DEEPGRAM_API_KEY
);
const hasVector = Bun.env.ZERO_VECTOR_ENABLED === 'true';
const hasPdf = Bun.env.ZERO_PDF_ENABLED === 'true';

const config = defineZeroConfig({
  app: {
    name: Bun.env.APP_NAME ?? 'Zero App',
    publicUrl: Bun.env.APP_PUBLIC_URL ?? `http://localhost:${PORT}`,
    supportEmail: Bun.env.APP_SUPPORT_EMAIL,
  },
  db: {
    mode: Bun.env.DB_MODE === 'file'
      ? 'file'
      : Bun.env.DB_MODE === 'ephemeral'
        ? 'ephemeral'
        : 'hot',
    path: Bun.env.DB_PATH ?? './data/app.db',
    snapshotPath: Bun.env.DB_SNAPSHOT_PATH ?? './data/app.snapshot.db',
  },
  tables,
  email: hasEmail
    ? {
        from: Bun.env.EMAIL_FROM ?? 'Zero App <noreply@example.com>',
        replyTo: Bun.env.EMAIL_REPLY_TO,
        provider: 'resend',
        resend: { apiKey: Bun.env.RESEND_API_KEY },
      }
    : false,
  // Generated apps start public. Change to `true` or an auth object when the
  // app needs accounts, email verification, MFA, or admin user management.
  auth: false,
  routeAuth: 'explicit',
  sitemap: {
    enabled: true,
    changefreq: 'weekly',
    priority: 0.7,
    exclude: ['/login', '/forgot-password', '/reset-password'],
  },
  ai: hasAI ? true : false,
  vector: hasVector
    ? {
        dataDir: Bun.env.ZERO_VECTOR_DATA_DIR ?? './data/vector',
        defaultDimensions: Number(Bun.env.ZERO_VECTOR_DEFAULT_DIMENSIONS ?? 1536),
      }
    : false,
  pdf: hasPdf
    ? {
        browser: {
          executablePath: Bun.env.ZERO_PDF_EXECUTABLE_PATH,
        },
      }
    : false,
  kv: {
    baseDir: Bun.env.ZERO_KV_BASE_DIR ?? './data/kv',
    durability: Bun.env.ZERO_KV_DURABILITY === 'always' ? 'always' : 'everysec',
  },
  stateSync: false,
  appDir: './app',
  serverPluginsDir: './server/plugins',
  serverMiddlewareDir: './server/middleware',
  serverEndpointsDir: './server/endpoints',
  serverRoutesDir: './server/routes',
  serverResourcesDir: './server/resources',
  generatedDir: './.zero/generated',
  outDir: './.build',
  port: PORT,
});

export default config;
export { config };
```

Then keep `app/server.ts` small:

```ts
import { createApp } from '@zero/framework/server';
import config from '../zero.config';

const app = await createApp(config);
app.listen(config.port ?? 3000);
```

`sitemap: true` serves `/sitemap.xml` from public static page routes. Object
config lets you set defaults, exclude public utility pages, and add manual
entries for dynamic routes. Details live in
[Frontend Router: Sitemap](./frontend/router.md#sitemap).

Zero builds and links the platform stylesheet automatically when `createApp()`
starts. The root layout owns `ThemeProvider` and `AppProvider`: theme controls
the light/dark/system token contract, while `AppProvider` wires the SDK,
ReactiveDB sync, auth behavior, and client route safety net.
Generated starters keep the root layout and default page server-rendered so
the first public route ships HTML content by default. Add a top-level
`"use client"` directive to the dashboard layout or individual page once it
uses browser hooks, AppShell interactivity, ReactiveDB collections, forms, or
other client-side behavior.

```tsx
import type { ReactNode } from 'react';
import { AppProvider } from '@zero/framework/react/app-provider';
import { ThemeProvider } from '@zero/framework/components/ui/theme-provider';
import { Toaster } from '@zero/framework/components/ui/sonner';
import { tables } from '../db/schema';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="zero-theme">
      <AppProvider
        url={typeof window !== 'undefined' ? window.location.origin : ''}
        tables={tables}
      >
        <div className="min-h-screen bg-background text-foreground font-sans antialiased">
          {children}
        </div>
        <Toaster />
      </AppProvider>
    </ThemeProvider>
  );
}
```

During startup, Zero also generates client build glue in `.zero/generated`.
Those files connect the app route manifest to Zero's hydration runtime and are
safe to delete; `createApp()` regenerates them before bundling the browser
entry. Keep `.zero/` ignored in app repositories. Generated apps include a
`tsconfig.json` with `@app/*`, `@/*`, `@/components/*`, `@/hooks/*`, and
`@/lib/*` aliases. App-owned paths resolve first; installed-framework fallbacks
support Zero's current TypeScript source distribution. Application code should
still import framework features only through public `@zero/framework/*` paths.

## Choose Your App Shape

Keep `app/layout.tsx` boring by default: global providers, theme, toaster,
modal manager, and shared `AppProvider` setup only. Put visual shells and auth
boundaries lower in the route tree.

Public-first apps, such as appointment request or intake flows with a protected
staff dashboard, should opt into route-owned auth:

```ts
const config = defineZeroConfig({
  db,
  tables,
  auth: true,
  routeAuth: 'explicit',
  loginPath: '/login',
  postLoginPath: '/dashboard',
});
```

Then protect the dashboard layout:

```tsx
// app/(dashboard)/layout.tsx
import { AppShell, type RouteConfig } from '@zero/framework/react';

export const config: RouteConfig = {
  auth: 'required',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

Use route groups for separate layout branches without changing URLs:

```txt
app/
  layout.tsx                    # providers only
  (public)/
    layout.tsx                  # public shell, no AppShell
    page.tsx                    # /
    intake/resume/[token]/page.tsx
  (dashboard)/
    layout.tsx                  # AppShell + config.auth
    dashboard/page.tsx          # /dashboard
```

Internal tools can keep the default protected-first behavior:

```ts
defineZeroConfig({
  db,
  tables,
  auth: true,
  routeAuth: 'protected-by-default',
  publicPaths: ['/login', '/forgot-password', '/verify-email'],
});
```

In both modes, the server and browser route guards send an anonymous protected
request to `loginPath` with one URL-encoded `redirect` return path. A direct
server redirect can retain the requested path and query; client navigation can
also retain the fragment because fragments are never sent to the server. After
login, a safe return path wins. Otherwise Zero uses the top-level
`postLoginPath`, which defaults to `/` and is also available as an
`AppProvider` override.

Return paths must be bounded, root-relative local URLs. Zero rejects external,
scheme-relative, malformed, duplicate, recursive, backslash/control-character,
and canonicalization-unsafe values, then falls back to `postLoginPath`.
Authenticated visits to the login route follow the same rule, using replacement
navigation so login does not add another history entry. `/login` and `/login/`
are the same route for these checks. An explicit `postLoginPath` may not resolve
to `loginPath`; for compatibility, an app that already uses `loginPath: '/'`
and leaves the default post-login path implicit remains a no-op instead of
looping.

On browser startup, `useAuth().isRestoring` is true only while a persisted
session is rotating its refresh token and loading `/auth/me`. `AppProvider`
withholds the login subtree during that interval, avoiding a login-page flash.
In browsers with Web Locks, refresh rotation is serialized per Zero server
across tabs and workers, and a waiter rereads the latest persisted token after
it acquires the lock. The fallback for runtimes without Web Locks serializes
only callers in the same JavaScript realm.

Use the generated `server/` folders for app-owned backend code:

| Folder | Preferred use |
| --- | --- |
| `server/plugins/` | Advanced app plugins created with `defineZeroPlugin()` or raw Elysia plugins. |
| `server/middleware/` | Named app middleware created with `defineMiddleware()` and structured `matcher` policy. |
| `server/endpoints/` | Single HTTP endpoints created with `defineEndpoint()`. |
| `server/routes/` | Grouped `defineRouter()` routes and raw Elysia escape-hatch plugins. |
| `server/resources/` | Resource declarations created with `defineResource()` for generated CRUD, `/api/data` policy, and WebSocket sync policy. |

Zero loads backend extension folders in that order and ignores missing folders.
Resource definitions are loaded before backend extensions so routes can inspect
`zero.resources`. Endpoint, router, middleware, plugin, and resource helpers are
exported from `@zero/framework/server`; raw Elysia plugins remain supported when
a route needs framework-level control.

Use middleware matchers for cross-cutting app policy. `path`, `method`, and
`predicate` decide whether middleware applies; `auth`, `role`, and
`properties` enforce server-side access once it applies. Property matchers use
the configured `auth.userProperties` store, so the same keys can drive admin UI,
backend policy, and later frontend gates. For resource policies, mark
authorization-grade properties with `useInPolicies: true`; Zero rejects that
flag on self-editable user preferences.

For server-side resource authorization, use the policy core exported from
`@zero/framework/server`: `defineResource()`, `ownerPolicy()`,
`metadataPolicy()`, `adminOnly()`, `anyOf()`, `allOf()`,
`validateResourcePolicy()`, and `evaluateResourcePolicy()`. Resource
definitions can live in `server/resources` or `createApp({ resources })`.
Generated CRUD routes are enabled by default at `/api/resources/:resource` and
`/api/resources/:resource/:id`; set `resourceRoutes: false` to disable them or
pass `resourceRoutes: { prefix, defaultLimit, maxLimit }` to customize them.
Generated route writes go through ReactiveDB and enforce resource policies
server-side. `/api/data` also enforces registered resource `list` policy for
lazy tables, including owner constraints and trusted metadata checks. WebSocket
sync enforces registered resource policy too: unconstrained `list` policies can
use the normal fast sync path, row-constrained `list` policies use
per-connection row-filtered sync, and direct sync mutations evaluate resource
create/update/delete policy server-side. Platform doctor validates registered
resource shape, missing owner columns, trusted metadata keys, auth-disabled
protected resources, list-policy behavior for `/api/data` and sync, and
owner-field index guidance.

App-owned backend handlers receive a lazy `zero` service context. Use canonical
names in new code: `zero.db`, `zero.auth`, `zero.ai`, `zero.vector`, `zero.pdf`,
`zero.email`, `zero.storage`, `zero.notifications`, `zero.scheduler`,
`zero.workflows`, `zero.resources`, and `zero.observability`. Older aliases
still work: `zero.syncDB`, `zero.vectors`, `zero.workflowRegistry`, and
`zero.auth.getTokenService()`.

Inside those services, prefer the small standard method vocabulary:
`create()`, `get()`, `list()`, `update()`, `delete()`, `run()`, `stop()`, and
`status()` where it fits. Storage is grouped as `storage.drives`,
`storage.objects`, `storage.permissions`, and `storage.uploads` so calls stay
unambiguous. The full service alias map is in
[Phase 4: Service API Smoothing](./framework/phase-4-service-api-smoothing.md).

The core UI primitives and Animate UI wrappers share the same token contract:
`background`, `card`, `popover`, `muted`, `accent`, `input`, `border`, `ring`,
and semantic state colors. Keep new components on those tokens, keep ordinary
cards at `rounded-lg` or smaller, and check both light and dark modes before
shipping shared UI changes. Zero keeps Playwright available as a dev dependency
for local screenshot checks against running or static routes.
Public-page components should use the second token lane instead:
`public-background`, `public-surface`, `public-glass`, `public-accent`,
`public-border`, and `public-ring`. Wrap public route trees with
`zero-public-page` or `data-zero-page="public"` so the page and promoted public
components share the same visual language.
Before adding or replacing shared UI, check the
[Component Inventory](./frontend/component-inventory.md). It separates base
primitives, composed controls, app shells, data organisms, domain organisms,
and Animate UI source groups so agents do not duplicate platform pieces.

For dashboards, admin tools, data apps, and internal products, start with
`AppShell` from `@zero/framework/components/app-shell`. It provides the default
Animate UI/Radix sidebar, top workspace switcher, nested/expandable nav,
three-dot item action menus, footer user menu, and optional breadcrumb/header
row. Use `header` when breadcrumbs are not needed; the row can hold title,
filters, search, or actions. Drop to `@zero/framework/components/sidebar` only
when the shell cannot express the layout.

For public landing pages, docs, blogs, and content route trees, start with
`ResizableNavbar` from `@zero/framework/components/navbar`. It stays attached
at the top of the page, then shrinks into a floating blurred navbar on scroll,
with magnetic desktop hover and a mobile menu powered by the same item data.
Pair it with `Hero` from `@zero/framework/components/hero` for the opening
section. `Hero` accepts public token backgrounds, custom image/visual slots,
and rich React title content so animated text effects can be added without
forking the section component. Use `TextGenerateEffect`, `TypewriterEffect`,
and `FlipWords` from `@zero/framework/components/text-effects` for public
heading and landing-copy motion. For common public sections, use the promoted
Zero components before copying external snippets:
`FeaturesSection`, `CodeBlock`, `CtaSection`, `FooterSection`, `Faq`, `ExpandableCards`, `BentoGrid`, and
`AnimatedList`. `FeaturesSection` accepts an image, screenshot, chart,
`CodeBlock`, or custom React visual slot. Their usage contract is documented in
[Public Components](./frontend/public-components.md).

Run the platform doctor against an exported config module:

```txt
bun run doctor -- --config ./zero.config.ts
bun run doctor -- --config ./zero.config.ts --strict
bun run doctor -- --config ./zero.config.ts --json
zero-doctor --config ./zero.config.ts
```

`doctor` checks app config, table primary keys and natural identities, auth
email readiness, login/public route safety, storage/auth mismatch, migration
startup policy, sync policy/index guidance, observability endpoint readiness,
AI provider/alias readiness, vector index/storage safety, PDF browser/resource
policy safety, and resource policy shape for generated CRUD, `/api/data`, and
WebSocket sync. Warnings do not fail by default; use `--strict` in CI.

Doctor also scans app-owned source code by default. It reports file and line
locations when app code bypasses Zero's intended surfaces, including raw
frontend controls where Zero primitives fit, custom modal/toast/sidebar
systems, missing root wiring for `AppProvider`, `ThemeProvider`, or `Toaster`,
direct `lucide-react` or framework-internal imports, direct backend provider
usage such as SQLite/AI/vector/email/JWT libraries, `console` logging in
backend app code, and files above the responsibility threshold. The default
large-file threshold is 400 lines:

```txt
bun run doctor -- --config ./zero.config.ts --max-file-lines 400
bun run doctor -- --config ./zero.config.ts --no-usage-audit
```

Generated apps can run `bun run doctor`. Local checkout users can run
`zero-doctor --config ./zero.config.ts` from any app directory.

Use `migrate:doctor` and `migrate:plan` for database drift:

```txt
bun run migrate:plan -- --schema ./db/schema.ts --write
zero migrate --doctor --schema ./db/schema.ts --strict
```

Use `@zero/framework/server` for app startup, backend routes, and server
service getters. Use `@zero/framework/react/app-provider`,
`@zero/framework/react/hooks`, and direct component subpaths such as
`@zero/framework/components/ui/button` for browser UI. The broad
`@zero/framework/react` barrel remains available as a convenience export, but
generated apps should prefer narrow imports. Direct subsystem imports such as
`@zero/framework/email`, `@zero/framework/ai`, `@zero/framework/vector`,
`@zero/framework/persistence`, `@zero/framework/kv`,
`@zero/framework/sync/client`, and
`@zero/framework/components/data-table`, and
`@zero/framework/components/navbar`, and
`@zero/framework/components/hero`, and
`@zero/framework/components/text-effects`,
`@zero/framework/components/faq`,
`@zero/framework/components/features`,
`@zero/framework/components/code-block`,
`@zero/framework/components/expandable-card`,
`@zero/framework/components/bento-grid`, and
`@zero/framework/components/animated-list` are available when a file should
depend on one specific feature. `persistence` is the advanced server-side
SQLite foundation; generated apps should normally let `createApp()` own it and
use `zero.sql` from backend routes when direct SQL is needed. `kv` is the
advanced server-side cache/KV package; generated apps normally use `zero.kv`,
`zero.counter`, and `zero.limiter` from backend routes.

Use packaged imports first. When an app needs to customize component or hook
source, copy selected pieces with `zero add`:

```sh
zero add components/ui/button
zero add components/data-table
zero add components/faq
zero add components/features
zero add components/code-block
zero add components/expandable-card
zero add components/bento-grid
zero add components/animated-list
zero add components/hero
zero add components/kanban
zero add components/navbar
zero add components/text-effects
zero add hooks modals --dry-run
```

`zero add` skips existing files unless `--force` is provided and rewrites copied
framework-internal imports to public `@zero/framework/*` paths.

## Environment

Common variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. |
| `DB_MODE` | SQLite runtime mode. Use `hot` for memory-first snapshot recovery, `file` for direct SQLite/WAL, or `ephemeral` for tests. |
| `DB_PATH` | SQLite source path used by `hot` and `file` modes. |
| `DB_SNAPSHOT_PATH` | Snapshot recovery path used by `hot` mode. |
| `APP_NAME` | Display name used by system email. |
| `APP_PUBLIC_URL` | Public origin for setup/reset links. |
| `APP_LOGO_URL` | Optional logo URL for auth pages and branded auth email. |
| `APP_SUPPORT_EMAIL` | Optional support/reply identity. |
| `AUTH_EMAIL_BRAND_COLOR` | Optional accent color for branded auth email. |
| `EMAIL_FROM` | Default sender. |
| `EMAIL_REPLY_TO` | Optional reply-to. |
| `RESEND_API_KEY` | Enables the default Resend provider. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Require email verification before public-registered users receive tokens. |
| `AUTH_EMAIL_VERIFICATION_PATH` | Public page path used in email verification links. Defaults to `/verify-email`. |
| `AUTH_MFA_ENABLED` | Enables first-party MFA setup and login challenges. |
| `AUTH_MFA_POLICY` | MFA policy: `optional`, `required`, or `admin-required`. |
| `AUTH_MFA_METHODS` | Comma list such as `email,totp`. |
| `AUTH_TOTP_ENCRYPTION_KEY` | Encryption key for self-hosted authenticator/TOTP secrets at rest. |
| `ACCESS_TOKEN_TTL` | Access token lifetime. |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime. |
| `AUTH_ACTION_TOKEN_TTL` | Setup/reset/verification token lifetime. |
| `AUTH_ACCOUNT_EMAIL_COOLDOWN` | Cooldown for active setup/reset/verification emails per user/type. |
| `AUTH_MANUAL_PASSWORD_RESET` | `false` disables direct admin password replacement. |
| `AUTH_SIGNING_KEY` | Optional externally managed ES256 private JWK. |
| `ZERO_KV_BASE_DIR` | Optional app convention for KV journal/checkpoint files. Defaults to `./data/kv`. |
| `ZERO_KV_DURABILITY` | Optional app convention for KV durability: `everysec` or `always`. |
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
| `ZERO_PDF_ENABLED` | Generated-app convention for enabling browser-grade PDF rendering. |
| `ZERO_PDF_EXECUTABLE_PATH` | Optional system-managed Chromium executable; omit for Zero's managed browser. |

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
| Auth | Users, admin bootstrap, token rotation, registration policy, configured user properties, account status, setup/reset flows, and installed-app OIDC/PKCE. |
| Email | Provider boundary with Resend default and custom provider support. |
| ReactiveDB | SQLite table definition, change tracking, ring-buffer replay, natural identity. |
| Sync | WebSocket snapshots, live updates, lazy/auto sync, sync policy hooks. |
| Data API | `/api/data` reads for lazy tables with pagination, sorting, filtering, limits, and auth/policy integration. |
| Storage | Built-in file storage with platform auth boundaries and a reusable management organism. |
| State Sync | Per-user server-persisted reactive key/value state. |
| Notifications | Server-created notifications and receipt tracking. |
| Rooms/Presence | Presence and room coordination primitives. |
| Workflows | [Versioned durable graphs](./workflows.md), trusted activities, choices, parallel joins, bounded array fan-out, event and human waits, private scratch memory, crash recovery, and owner-scoped live visualization. |
| Migrations | Explicit migration files, ledger, schema history, rollback, backups, doctor, draft plans. |
| Observability | Structured event codes, default console/memory sink, protected event endpoint, frontend ingest. |
| AI | Internal server-side AI service with env-detected providers, custom Meta Llama adapter, aliases, conversations, tools, embeddings, images, transcription, speech, and protected status. |
| Vector Store | Local zvec-backed vector persistence/search with scoped filters and AI embedding bridge helpers. |
| PDF | Secure browser-grade HTML/CSS-to-PDF rendering with bounded concurrency, strict resource policy, storage composition, and a replaceable renderer adapter. |

## Frontend Hook Library

Zero ships app-ready hooks from `@zero/framework/react` so frontend work can stay
fast without each app rewriting auth, sync, storage, workflow, notification,
room, and UI state glue.

Platform-specific hooks include:

| Area | Hooks |
| --- | --- |
| Auth/session | `useAuth`, `useAuthConfig`, `useCurrentUser`, `useRequireAuth`, `useUserProperty` |
| Live data | `useCollection`, `useLazyCollection`, `useDataPage`, `useRecord`, `useRecordByIdentity`, `useDataSelection` |
| Resources | `useResourceClient`, `useResourceList`, `useResourceRecord`, `useResourceActions` |
| Storage | `useUpload`, `useUploadQueue`, `useUploadDropzone`, `useStorageFile`, `useStorageBrowser`, `useStorageDrives`, `useDriveCapabilities`, `useStoragePermissions`, `useDriveQuota` |
| Rooms/presence | `usePresence`, `usePresenceList`, `useTypingIndicator`, `useEphemeral`, `useEphemeralTopic` |
| Workflows/notifications | `useWorkflowRun`, `useWorkflow`, `useWorkflowList`, `useWorkflowActions`, `useNotifications`, `useUnreadCount` |
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

For generated CRUD forms, staged forms, and the planned intake-grade form
layer, see [Form Library](./frontend/forms.md). Use the existing Zero form
components and tokenized inputs before creating custom form controls.

## Default Icons

Zero's default platform icon pack is the Animate UI animated Lucide set. Import
icons from `@zero/framework/icons` instead of reaching into internal
component folders:

```tsx
import { AnimateIcon, Check, Trash, ZeroIcon } from '@zero/framework/icons';

<Check animate className="text-emerald-600" />;

<AnimateIcon animateOnHover>
  <Trash size={18} />
</AnimateIcon>;

<ZeroIcon name="arrow-right" size={18} animateOnHover />;
```

Zero's shared `Button` automatically animates nested Zero icons on hover and
tap. Outside `Button`, imported icons animate only when `animate`,
`animateOnHover`, `animateOnTap`, or an `AnimateIcon` parent is present.

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
import { getAI } from '@zero/framework/server';

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
import { createAIVectorBridge, getAI, getVectorStore } from '@zero/framework/server';

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

## PDF Rendering

Enable browser-grade PDF generation with `pdf: true`, then install the pinned
Chromium revision once per development machine or production image:

```sh
bun run pdf:install
bun run pdf:status
```

App-owned backend endpoints, services, workflows, and jobs use `zero.pdf`:

```ts
if (!zero.pdf) throw new Error('PDF rendering is disabled.');

const result = await zero.pdf.render({
  html: '<main><h1>Patient intake</h1></main>',
  css: '@page { size: Letter; margin: 0.5in; }',
  document: { title: 'Patient intake' },
});

return new Response(result.bytes, {
  headers: { 'content-type': 'application/pdf' },
});
```

Use `renderToStorage()` to write a generated document through Zero storage in
the same operation. No public PDF route is mounted by default. Remote resources,
local files, private-network hosts, JavaScript, service workers, and downloads
are denied by secure defaults. See [PDF Rendering](./pdf.md) for print options,
resource allowlists, limits, storage, workflows, adapters, and deployment.

## Reusable Data UI

Zero includes reusable frontend organisms for fast data-driven screens:

| Organism | Use it for | Docs |
| --- | --- | --- |
| `DataTableView` | Schema-aware tables with full-sync, lazy `/api/data`, or caller-owned sources. | [docs/frontend/data-table.md](./frontend/data-table.md) |
| `KanbanBoard` | Drag-and-drop status boards, pipelines, queues, and workflow lanes backed by caller-owned or live data. | [docs/frontend/kanban.md](./frontend/kanban.md) |
| `MasterDetailView` | A table/list plus detail panel, generated edit form, custom detail body, record navigation, and DataTable-style lazy sources. | [docs/frontend/master-detail.md](./frontend/master-detail.md) |
| `DetailPanel` / `ListDetailLayout` / `RecordNavigationBar` | Custom detail screens that need the polished shell without the full organism. | [docs/frontend/master-detail.md](./frontend/master-detail.md#low-level-detail-primitives) |

These components use schema primary keys by default. Do not assume `row.id`
unless the table schema actually uses `id` as its primary key.

## Add A Desktop, Mobile, Tauri, Or Chrome Client

Installed apps authenticate against the same Zero instance and user table as
the web app. Register a public client under `auth.nativeApps`, give each shipped
app its own client ID and exact redirects, then keep route/resource permission
on the server:

```ts
auth: {
  nativeApps: {
    clients: [{
      clientId: 'acme-desktop',
      name: 'Acme Desktop',
      redirectUris: [
        'http://127.0.0.1/oauth/callback',
        'http://[::1]/oauth/callback',
      ],
    }],
  },
}
```

Then run `bun run doctor -- --config ./zero.config.ts --strict` and wire the
system browser, callback receiver, and secure storage appropriate for the
target. There is no native client secret or API key. Registration, email
verification, password recovery, and MFA happen on the normal Zero pages in
the system browser. Native Bearer tokens resolve to the same current role,
trusted user properties, endpoint policy, resources, and Sync policy as web
tokens.

Choose carefully:

- `@zero/framework/native` is the usable TypeScript core in the current source.
  Pin a framework release that includes it and use the packaged desktop/mobile
  recipes.
- Rust `zero-native-auth` and `tauri-plugin-zero-auth` are Phase 0 design
  scaffolds only. They do not yet authenticate or provide Tauri commands; do
  not put the TypeScript credential owner in a Svelte webview as a substitute.
- `@zero/chrome-auth` is a separate private Manifest V3 preview, not a registry
  release. It still needs a released native peer range, real-Chrome end-to-end
  testing, and security review.

Read the [SDK selection and onboarding guide](./auth/app-auth-sdk-guide.md)
before choosing a host architecture, then follow
[Desktop, Mobile, and Chrome Extension Authentication](./auth/native-app-auth.md)
for the full OIDC endpoint, redirect, storage, continuation, Sync, revocation,
and deployment contract.

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
import { UserManagement } from '@zero/framework/react';

export function UsersSettingsPanel() {
  return <UserManagement className="h-[720px]" />;
}
```

The component self-wires to the admin auth SDK, loads `/auth/admin/config`,
uses backend pagination plus `search`, `role`, and `status` filters, adapts
configured `auth.userProperties` into typed controls, and hides email-only
actions when the email runtime is not ready. When `strictUserProperties` is
false, it also lets admins add, edit, and remove unconfigured key/value
metadata on a user. When strict mode is true, only configured properties are
editable.

Use `auth.userProperties` for metadata that app code should understand, such
as department, group, plan, flags, or policy claims. Defaults apply during
registration and admin user creation. Mark only trusted admin/system-owned
keys with `useInPolicies: true`; self-editable keys are rejected for policy
use.

Email-driven setup/reset flows validate email readiness before changing account
state. Forgot-password responses avoid user enumeration and cooldown repeats do
not send additional emails.

Reusable auth UI blocks are exported from `@zero/framework/react`:

```tsx
import {
  ChangePasswordForm,
  EmailVerificationForm,
  ForgotPasswordForm,
  LoginForm,
  MFAEnrollmentForm,
  MFAManagementPanel,
  PasswordActionForm,
  RegisterForm,
  UserPropertiesForm,
} from '@zero/framework/react';
```

`LoginForm`, `RegisterForm`, and `ForgotPasswordForm` read `/auth/config` and
wait for policy before exposing registration/reset actions.
`RegisterForm` switches to a check-your-email state when email verification is
required, and `EmailVerificationForm` handles verification links or manual
token paste.
`PasswordActionForm` handles reset/setup tokens from email links, can render a
token-paste fallback when no query token is present, and blocks invalid or
mode-mismatched tokens before submit.
When MFA is enabled, login, registration, email verification, and password
action forms route into shared MFA continuation UI before a session is stored.
Optional MFA can be requested during signup; required/admin-required MFA is
enforced by backend policy. Use `MFAManagementPanel` in account settings when
users should enroll later.
`UserPropertiesForm` renders only user-editable `auth.userProperties`.

For storage dashboards, embed the reusable organism:

```tsx
import { StorageManagement } from '@zero/framework/react';

export function FilesSettingsPanel() {
  return <StorageManagement className="h-[42rem]" />;
}
```

It manages drives, file browsing, uploads, folders, rename, visibility, and
delete confirmation through the platform storage hooks and authenticated SDK
transport. It also shows effective access, manages role/user/property storage
grants, filters and sorts folder contents, and uses presigned download links so
private files can be opened without exposing bearer tokens to plain anchors.

For focused upload surfaces, use `StorageDropzone` or `useUploadDropzone`:

```tsx
import { StorageDropzone } from '@zero/framework/react';

export function InvoiceDropzone({ driveId }: { driveId: string }) {
  return <StorageDropzone driveId={driveId} path="/invoices" />;
}
```

For public flows where an unauthenticated user must upload into private
storage, such as intake forms, resume-token flows, ID cards, insurance cards,
or consent PDFs, create a scoped upload grant from backend code:

```ts
const grant = await zero.storage?.uploads.create(driveId, {
  path: `/intakes/${intakeId}/id-front.png`,
  expiresIn: 15 * 60,
  maxSize: 5 * 1024 * 1024,
  contentTypes: ['image/png', 'image/jpeg', 'application/pdf'],
  metadata: { intakeId, kind: 'id-front' },
  flow: 'intake',
  resource: { type: 'intake', id: intakeId },
});
```

Return the token to the browser and upload with
`PUT /storage/upload-grants/:token`. The uploaded object remains private by
default and the grant cannot overwrite an existing object unless
`overwrite: true` is set.

For custom storage UI, prefer the platform hooks before writing raw fetches:
`useStorageDrives()` returns accessible drives with current-user access,
`useDriveCapabilities(driveId, path?)` returns `canRead`, `canWrite`, and
`canAdmin`, and `useStoragePermissions()` lists explicit grants for admin
surfaces.

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
