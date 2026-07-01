# Frontend Platform

**Files are routes. Data is live. Ship one binary.**

A self-hosted fullstack runtime — file-based routing on Bun, React 19 streaming SSR, reactive data via the sync engine, typed RPC via Eden Treaty, authentication built in. Define a page file, it's a route. Subscribe to a table, it's live. Build and compile — one binary, zero infrastructure.

## The Full Loop

```tsx
// ─── app/page.tsx — this file IS the route ────────────

import { useCollection } from '@zero/framework/react';

export default function Home() {
  const { data, insert } = useCollection('todos');

  return (
    <main>
      <h1>Todos ({data.length})</h1>
      {data.map(todo => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
      <button onClick={() => insert({ title: 'New todo' })}>Add</button>
    </main>
  );
}
```

```tsx
// ─── app/layout.tsx — wraps every page ─────────────────

import { AppProvider, ThemeProvider, Toaster } from '@zero/framework/react';
import { tables } from './lib/schemas';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="zero-theme">
      <AppProvider
        url={typeof window !== 'undefined' ? window.location.origin : ''}
        tables={tables}
        auth
      >
        {children}
        <Toaster />
      </AppProvider>
    </ThemeProvider>
  );
}
```

> **Note:** Zero now generates the browser entry and route manifest under
> `.zero/generated`. That entry calls `hydrate-runtime`, which provides
> `RouterProvider` + `ErrorBoundary` only -- it does NOT create `AppProvider`.
> The root layout is the sole owner of `AppProvider` (SDK client, sync, auth).
> `AppProvider` auto-detects if a `RouterProvider` already exists and skips
> creating a duplicate. `__PLATFORM_CONFIG__` no longer carries `tables`; it
> carries runtime settings like `auth`, `stateSync`, and resolved
> `tableSyncModes`.

> **Theme:** `createApp()` builds and links Zero's platform stylesheet from
> `src/frontend/styles/globals.css`. The default token contract includes light,
> dark, and system modes through `ThemeProvider`. Mount Zero's `Toaster` once
> under that provider so feedback toasts inherit the same popover, semantic
> color, radius, and shadow tokens as the rest of the UI.

```ts
// ─── app/server.ts — one file, everything ──────────────

import { resolveConfig, createApp } from '@zero/framework/server';
import { tables } from './lib/schemas';

const config = resolveConfig({
  db: { mode: 'memory' },
  tables,  // defineTable() output — auto-extracts server definitions
  auth: true,
  appDir: './app',
});

// Result:
//   File-based routes from app/ directory
//   POST /auth/register, /auth/login, /auth/refresh, /auth/logout
//   GET  /api/data (auto-registered for lazy tables)
//   GET  /sitemap.xml (when enabled from public static routes)
//   WS   /sync (reactive — all table changes broadcast)
//   SSR  with React 19 streaming
```

```bash
# ─── Build and ship ──────────────────────────────────────

bun build --compile server.ts --outfile myapp

# One binary. Database, auth, sync, SSR, routing — all embedded.
# ./myapp starts the full server. No node_modules, no runtime.
```

Drop a file in `app/`, it's a route. Subscribe to a table, it updates live. Register a user, every client sees them. Build — one binary, deploy anywhere.

## Core Properties

| Property | What it means |
|----------|--------------|
| **File-based routing** | `app/` directory maps to URL routes — `page.tsx` renders, `layout.tsx` wraps, `[param]/` is dynamic |
| **React 19 streaming SSR** | `renderToReadableStream` on Bun — progressive HTML, Suspense boundaries stream as they resolve |
| **Reactive data** | Sync engine tables are live — `useCollection('todos')` returns `{ data, insert, update, remove }` and re-renders when any client mutates |
| **Typed RPC** | Eden Treaty generates typed client from Elysia server — full autocomplete, zero codegen step |
| **Built-in auth** | Register/login/refresh/logout, persistent browser sessions, protected-route redirects, and reactive user data via shared ReactiveDB |
| **Persistent state** | Per-user KV state survives refresh, device switch, server restart — `useServerState('theme', 'dark')` |
| **Single binary** | `bun build --compile` packages server + client bundle + SQLite + all runtime into one executable |

## Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Runtime | Bun | Server, bundler, SQLite, test runner — one tool |
| HTTP | Elysia | Routes, plugins, derive, lifecycle hooks, WebSocket |
| Database | bun:sqlite (ReactiveDB) | In-memory or durable, change tracking, pub/sub |
| Rendering | React 19 | `renderToReadableStream`, Suspense, server components |
| State | @xstate/store | Client reactive store, sync engine integration |
| RPC | Eden Treaty | Typed REST client generated from Elysia types |
| Auth | Auth plugin | Argon2id, ES256 JWTs, stateless verification |
| Sync | Sync plugin | WebSocket real-time, onChange → publish |

## What This Is

A **fullstack runtime** that composes the sync engine, auth system, and a file-based router into a single deployable unit. The philosophy: every piece is a standalone primitive (ReactiveDB, sync plugin, auth plugin, router) and this package wires them together with sensible defaults. You can use any piece independently or the full stack.

**Designed for:**
- Applications that need auth + real-time + SSR without stitching frameworks together
- Small teams shipping fast — one binary, one process, one database
- Prototypes that should feel production-grade from day one
- Any app where "define a table, it's live" is the right abstraction

## What This Is NOT

- **Not Next.js.** No Vercel deployment target, no edge runtime, no ISR. It's a self-hosted Bun server with file-based routing conventions inspired by Next.js.
- **Not only a component library.** Zero includes tokenized UI primitives,
  Animate UI wrappers, and app-ready organisms, but this frontend runtime is
  also the routing, rendering, auth, sync, and data layer.
- **Not serverless.** Single process, single binary. Designed for a VM, container, or bare metal — not Lambda.
- **Not a build tool.** Bun is the build tool. This configures it, doesn't replace it.

## How It Composes

```
┌──────────────────────────────────────────────────────────────┐
│                      createApp()                              │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ Auth Plugin   │  │ Sync Plugin  │  │ Router Plugin        │ │
│  │ /auth/*       │  │ WS /sync     │  │ file-based SSR       │ │
│  │ middleware     │  │ onChange→pub │  │ app/ → routes        │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                  │                      │            │
│         │         ┌────────┴────────┐             │            │
│         └────────►│   ReactiveDB    │◄────────────┘            │
│                   │   (shared)      │                          │
│                   └─────────────────┘                          │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ Static Files  │  │ Client Bundle│  │ Observability        │ │
│  │ public/       │  │ Bun.build()  │  │ sink + event store   │ │
│  └──────────────┘  └──────────────┘  └─────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

Auth, sync, and router all share one ReactiveDB. The router renders pages with React 19 streaming. The sync engine makes table data live. Auth makes user data reactive. Observability captures platform logs, warnings, errors, and frontend reports through one configurable sink boundary. One `createApp()` call wires it all.

## Design Documents

| Document | What it covers |
|----------|---------------|
| [Router](./router.md) | File-based routing conventions, React 19 SSR on Bun, route scanning, layouts, dynamic segments |
| [SDK](./sdk.md) | `createApp()` server factory, `<AppProvider>`, auth hooks, router hooks, Eden typed RPC, SSR → hydration → live data flow |
| [Hooks](./hooks.md) | Generic React hooks, platform-specific hooks, user-property hooks, and hook responsibility boundaries |
| [Design Tokens](./design-tokens.md) | Core app token lane, public/frontend token lane, route wrappers, and component rules |
| [AppShell](./app-shell.md) | App-ready dashboard shell with Animate UI/Radix sidebar, workspace switcher, nested nav, user menu, optional breadcrumbs, and shell presets |
| [Sidebar](./sidebar.md) | Low-level sidebar primitives for custom shells: provider, inset, rail, groups, nested menu, actions, and footer user menus |
| [Resizable Navbar](./navbar.md) | Public-page navbar that detaches/shrinks on scroll, uses magnetic desktop hover, and renders a mobile menu from the same data |
| [Hero](./hero.md) | Public-page hero section with public token lane styling, background presets/custom background slots, actions, and rich title support |
| [Component Inventory](./component-inventory.md) | Layered map of base primitives, composed controls, organisms, domain UI, Animate UI source groups, and cleanup targets |
| [Form Library](./forms.md) | Current form stack, CRUD boundaries, intake-grade roadmap, draft adapters, public resume flows, attachments, consents, and PDF/workflow composition |
| [DataTableView](./data-table.md) | Schema-aware table organism, full-sync/lazy/data sources, inline editing, toolbar, column overrides |
| [KanbanBoard](./kanban.md) | Tokenized drag-and-drop board organism for ordered records grouped by caller-owned columns |
| [LaunchBoard](./launchboard.md) | Reference app showing AppShell + ReactiveDB + KanbanBoard + platform modals in one package-mode example |
| [MasterDetailView](./master-detail.md) | List/detail organism, generated detail forms, custom detail rendering, navigation, low-level detail primitives |
| [Migrations](../migrations.md) | First-class migration files, schema history, doctor, migrate-plan, rollback, backups |
| [Observability](../observability.md) | Stable event codes, default console + memory store, protected event endpoint, frontend sink |

## Primitives (documented separately)

The frontend SDK composes these — it doesn't reinvent them:

| Primitive | Docs | What it provides to the frontend |
|-----------|------|----------------------------------|
| Design tokens | [Design Tokens](./design-tokens.md) | Core app lane for operational UI plus public/frontend lane for docs, marketing, landing, and public flow components |
| Sync engine | [docs/realtime-sync/](../realtime-sync/realtime-sync/README.md) | `useCollection`, `useLazyCollection`, `useRow`, `useQuery`, `useStatus`, `SyncClient`, `SyncProvider`, optimistic mutations, reconnect |
| Auth system | [docs/auth/](../auth/README.md) | Register, login, refresh, logout routes, reactive `users` table, JWT middleware, guards |
| State sync | [docs/state-sync.md](../state-sync.md) | `useServerState`, per-user persistent KV, device sync, form drafts, UI preferences |
| App shell | [AppShell](./app-shell.md) and [Sidebar](./sidebar.md) | `AppShell`, optional breadcrumbs/header content, workspace switcher, nested nav, three-dot item actions, footer user menu, and raw sidebar primitives |
| Public navigation | [Resizable Navbar](./navbar.md) | `ResizableNavbar` for docs, marketing, landing, and other public route trees |
| Public heroes | [Hero](./hero.md) | `Hero`, `HeroBackground`, and `HeroImageBackground` for public route opening sections |
| Forms | [Form Library](./forms.md) | `useForm`, `AutoForm`, `Wizard`, generated fields, current limits, and the planned intake-grade blueprint/draft/attachment layer |
| Storage | [Hooks](./hooks.md#storage-workflows) | `useUpload`, `useUploadQueue`, `useUploadDropzone`, `useStorageFile`, `StorageDropzone`, and storage browser helpers |
| Rooms and ephemeral sync | [Hooks](./hooks.md#presence-and-typing) | `usePresence`, `usePresenceList`, `useTypingIndicator`, `useEphemeral`, and `useEphemeralTopic` |
| Observability | [docs/observability.md](../observability.md) | Backend/frontend event sink, default inspection endpoint, configurable adapters |

## Path Aliases

References to `@platform/*` and `@app/*` throughout these docs are **tsconfig path aliases**, not separate npm packages. They resolve to directories within the monorepo:

```
@zero/framework/react → src/frontend           (SDK, hooks, providers, schema, defineTable, field)
@zero/framework/icons → src/frontend/icons (default animated icon pack)
@zero/framework/server   → src/frontend/server    (app factory, resolveConfig — ONLY for app/server.ts)
@platform/router   → src/frontend/router    (file-based router types)
@platform/sync     → src/sync              (sync engine, types)
@platform/auth     → src/auth              (auth plugin, guards, types)
@/components/*     → src/components/*       (UI component library)
@/lib/*            → src/lib/*             (shared utilities)
@/hooks/*          → src/hooks/*           (shared React hooks)
@app/*             → app/*                 (your app code)
```

**Always use these aliases instead of relative paths.** They eliminate fragile `../../../` chains, make imports readable, and survive file moves without breaking.

**Import rule:** Schema files, pages, and app code import platform APIs from
`@zero/framework/react`, and default animated icons from
`@zero/framework/icons`. The only file that imports from `@zero/framework/server`
is `app/server.ts` (for `resolveConfig` and `createApp`).

```ts
// Do this
import { useCollection, defineTable, field } from '@zero/framework/react';
import { Check } from '@zero/framework/icons';
import { tables } from '@app/lib/schemas';
import { Button } from '@/components/ui/button';

// Not this
import { useCollection } from '../../../src/frontend/client/hooks';
import { Check } from '../../../src/components/animate-ui/icons/check';
import { defineTable } from '@zero/framework/server';    // wrong — use @zero/framework/react
import { Button } from '../../../src/components/ui/button';
```

Configure in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@zero/framework/react": ["./src/frontend"],
      "@zero/framework/react/*": ["./src/frontend/*"],
      "@zero/framework/server": ["./src/frontend/server"],
      "@zero/framework/server/*": ["./src/frontend/server/*"],
      "@platform/router": ["./src/frontend/router"],
      "@platform/router/*": ["./src/frontend/router/*"],
      "@platform/sync": ["./src/sync"],
      "@platform/sync/*": ["./src/sync/*"],
      "@platform/auth": ["./src/auth"],
      "@platform/auth/*": ["./src/auth/*"],
      "@/components/*": ["./src/components/*"],
      "@/lib/*": ["./src/lib/*"],
      "@/hooks/*": ["./src/hooks/*"],
      "@app/*": ["./app/*"]
    }
  }
}
```

## File Organization

```
src/frontend/
├── router/
│   ├── scanner.ts             # Bun.Glob route discovery — scans app/ directory
│   ├── route-tree.ts          # Builds nested route tree from file paths
│   ├── matcher.ts             # URL → route resolution with params extraction
│   ├── renderer.ts            # React 19 renderToReadableStream + layout nesting
│   └── types.ts               # RouteNode, MatchResult, RouteModule
├── server/
│   ├── app-factory.ts         # createApp() — wires auth + sync + router + static
│   ├── router-plugin.ts       # Elysia plugin — catch-all route → renderer
│   ├── client-bundle.ts       # Bun.build() for client-side JS (hydration, interactivity)
│   └── types.ts               # AppConfig, CreateAppOptions
├── client/
│   ├── app-provider.tsx       # React context — sync client, auth state, router state
│   ├── client-context.tsx     # SDK client context + ClientProvider
│   ├── auth-hooks.ts          # useAuth, useAuthConfig, useUserProperty
│   ├── data-hooks.ts          # useCollection, useLazyCollection, useRow, useQuery, useStatus
│   ├── data-composition-hooks.ts # useDataPage, useRecord, useRecordByIdentity
│   ├── resource-client.ts     # Vanilla generated-resource CRUD client
│   ├── resource-hooks.ts      # useResourceClient, useResourceList, useResourceRecord, useResourceActions
│   ├── mutation-hooks.ts      # useMutation
│   ├── connection-health-hooks.ts # useConnectionHealth
│   ├── preference-hooks.ts    # usePreference, useFormDraft
│   ├── workflow-run-hooks.ts  # useWorkflowRun
│   ├── hooks.ts               # Compatibility barrel for app-facing hook imports
│   ├── link.tsx               # <Link> component — client-side navigation
│   ├── router-context.tsx     # Route params, navigation, pathname
│   ├── hydrate-runtime.tsx    # Browser hydration runtime used by generated entries
│   └── hydrate.tsx            # Compatibility export for the hydration runtime
├── ../hooks/                  # Generic React hooks exported by @zero/framework/react
├── icons.ts                   # Public animated icon pack entrypoint
└── index.ts                   # Public API: createApp, AppProvider, hooks, Link
```

Router is pure (no framework dependency). Server wires Elysia plugins. Client
providers, auth hooks, data hooks, and generic React hooks are split by
responsibility but exported together through `@zero/framework/react`. Zero's
default animated icon pack is exported from `@zero/framework/icons`; use it
before reaching for raw `lucide-react` icons. See [Frontend Icons](./icons.md).
Generated app glue lives outside this tree in `.zero/generated`.
