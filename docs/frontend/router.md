# Router

File-based routing on Bun. Next.js conventions, React 19 streaming SSR, zero external router dependency. Drop a `page.tsx` in `app/`, it's a route.

## Conventions

```
app/
├── layout.tsx                  # Root layout — wraps every page
├── page.tsx                    # /
├── about/
│   └── page.tsx                # /about
├── blog/
│   ├── layout.tsx              # Blog layout — wraps all /blog/* pages
│   ├── page.tsx                # /blog
│   └── [slug]/
│       └── page.tsx            # /blog/:slug (dynamic segment)
├── dashboard/
│   ├── layout.tsx              # Dashboard layout — auth-gated
│   ├── page.tsx                # /dashboard
│   ├── settings/
│       └── page.tsx            # /dashboard/settings
│   └── [teamId]/
│       ├── page.tsx            # /dashboard/:teamId
│       └── members/
│           └── page.tsx        # /dashboard/:teamId/members
├── (marketing)/
│   ├── layout.tsx              # Group layout — doesn't create URL segment
│   ├── pricing/
│   │   └── page.tsx            # /pricing (not /marketing/pricing)
│   └── features/
│       └── page.tsx            # /features
├── api/
│   └── todos/
│       └── route.ts            # API route: GET/POST/PUT/DELETE handlers
└── not-found.tsx               # 404 fallback
```

### File Roles

| File | Role |
|------|------|
| `page.tsx` | Route component — default export renders the page |
| `layout.tsx` | Layout wrapper — receives `{ children }`, wraps nested pages |
| `route.ts` | API route — named exports (`GET`, `POST`, `PUT`, `DELETE`) handle HTTP methods |
| `not-found.tsx` | **404 fallback** — rendered when no route matches the URL. One per app (root level). This is the only way to handle 404s. |
| `loading.tsx` | Suspense fallback — shown while page streams (future, not V1) |
| `error.tsx` | Error boundary — wraps the page subtree in a React error boundary, catches render errors (future, not V1). Not to be confused with `not-found.tsx` which handles missing routes. |

### Segment Types

| Pattern | Example | URL | Params |
|---------|---------|-----|--------|
| Static | `about/page.tsx` | `/about` | — |
| Dynamic | `[slug]/page.tsx` | `/blog/hello-world` | `{ slug: 'hello-world' }` |
| Catch-all | `[...path]/page.tsx` | `/docs/a/b/c` | `{ path: ['a', 'b', 'c'] }` |
| Group | `(marketing)/page.tsx` | `/pricing` | — (group stripped from URL) |

Groups (`(name)/`) organize files without affecting the URL. Use them for
shared layouts across sibling route branches, such as `(public)` and
`(dashboard)`.

You can use a group at the root when a route needs app chrome at `/` but the
root layout should stay provider-only:

```txt
app/
├── layout.tsx                  # providers only
└── (launchboard)/
    ├── layout.tsx              # AppShell
    └── page.tsx                # /
```

## Route Scanning

On startup, Bun.Glob scans the `app/` directory and builds a route tree.

### Scanner

```ts
import { Glob } from 'bun';

function scanRoutes(appDir: string): RawRoute[] {
  const glob = new Glob('**/page.tsx');
  const routes: RawRoute[] = [];

  for (const path of glob.scanSync(appDir)) {
    // path = "(dashboard)/dashboard/page.tsx"
    // → segments = ["(dashboard)", "dashboard"]
    // → urlPattern = "/dashboard"
    const segments = path.replace(/\/page\.tsx$/, '').split('/');
    routes.push({
      filePath: `${appDir}/${path}`,
      // Keep group segments for layout nesting. Matchers and generated
      // manifests omit groups from URL patterns.
      segments,
    });
  }

  return routes;
}
```

**Why `Bun.Glob` not `fs.readdir`:** `Bun.Glob` is native, returns an iterator (no array allocation), supports recursive patterns, and handles symlinks correctly. Single pass, no recursion logic.

### API Route Scanner

```ts
function scanAPIRoutes(appDir: string): RawAPIRoute[] {
  const glob = new Glob('api/**/route.ts');
  const routes: RawAPIRoute[] = [];

  for (const path of glob.scanSync(appDir)) {
    // path = "api/todos/route.ts"
    // → urlPattern = "/api/todos"
    const segments = path.replace(/\/route\.ts$/, '').split('/');
    routes.push({
      filePath: `${appDir}/${path}`,
      segments,
    });
  }

  return routes;
}
```

API routes take priority over page routes for the same path. `app/api/todos/route.ts` handles `/api/todos` as a JSON API, not a rendered page.

### Route Tree

The scanner output is assembled into a nested tree for efficient matching and layout resolution:

```ts
interface RouteNode {
  segment: string;                    // "blog", ":slug", "**path"
  page: RouteModule | null;           // Lazy-loaded page component
  layout: RouteModule | null;         // Lazy-loaded layout component
  apiRoute: APIRouteModule | null;    // API handlers (GET, POST, etc.)
  children: Map<string, RouteNode>;   // Static children
  isGroup: boolean;                   // "(public)" / "(dashboard)", no URL segment
  dynamicChild: RouteNode | null;     // Single [param] child
  catchAllChild: RouteNode | null;    // Single [...param] child
}
```

**Priority order for ambiguous paths:**
1. Static segments (`/blog/new` matches `blog/new/page.tsx` first)
2. Dynamic segments (`/blog/hello` matches `blog/[slug]/page.tsx`)
3. Catch-all segments (`/blog/a/b/c` matches `blog/[...path]/page.tsx`)

### Module Loading

Route modules are **lazily loaded** on first request, then cached:

```ts
interface RouteModule {
  filePath: string;
  component: React.ComponentType | null;  // null until loaded
  loaded: boolean;
}

async function loadModule(mod: RouteModule): Promise<React.ComponentType> {
  if (!mod.loaded) {
    const imported = await import(mod.filePath);
    mod.component = imported.default;
    mod.loaded = true;
  }
  return mod.component!;
}
```

**Why lazy:** A large app directory might have hundreds of routes. Eagerly importing all modules at startup adds latency and memory. Lazy loading means the server starts fast and only pays the import cost when a route is first hit.

**Why cache:** After the first request, the module is in memory. Subsequent requests skip the `import()` cost entirely. In production, all routes could optionally be pre-loaded on startup via a warmup pass.

## URL Matching

Given a URL path, the matcher walks the route tree and extracts params:

```ts
interface MatchResult {
  route: RouteNode;
  params: Record<string, string | string[]>;
  layouts: RouteModule[];   // Root → leaf order
}

function matchURL(tree: RouteNode, pathname: string): MatchResult | null {
  const segments = pathname.split('/').filter(Boolean);
  const params: Record<string, string | string[]> = {};
  const layouts: RouteModule[] = [];
  let node = tree;

  // Collect root layout
  if (node.layout) layouts.push(node.layout);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // 1. Static match
    if (node.children.has(seg)) {
      node = node.children.get(seg)!;
    }
    // 2. Dynamic match
    else if (node.dynamicChild) {
      node = node.dynamicChild;
      params[node.segment.slice(1)] = seg;  // ":slug" → slug = seg
    }
    // 3. Catch-all match
    else if (node.catchAllChild) {
      node = node.catchAllChild;
      params[node.segment.slice(2)] = segments.slice(i);  // "**path" → path = rest
      break;
    }
    else {
      return null;  // No match
    }

    // Collect layout at each level
    if (node.layout) layouts.push(node.layout);
  }

  if (!node.page) return null;  // Directory exists but no page.tsx
  return { route: node, params, layouts };
}
```

The matcher returns all layouts from root to the matched page — the renderer nests them.

## Render Modes

Zero uses the top-level `"use client"` directive as a route boundary.

| Route shape | Server behavior | Browser behavior |
| --- | --- | --- |
| No `"use client"` on the matched page or layouts | Streams HTML with React SSR. | No route bundle is shipped unless another client entry needs it. |
| `"use client"` on the matched page or any matched layout | Emits the HTML shell, route data, platform config, CSS, and the generated client bundle. It does not execute client hooks during SSR. | The generated browser bundle mounts the route and handles client-side navigation. |

This matters in package-mode apps. Zero resolves SSR and browser React from the
consuming app package, and client routes avoid server-side hook execution across
local `file:` or symlinked framework installs. Keep layouts/pages that call
React hooks, `AppProvider`, or `useCollection()` marked with `"use client"`.

## React 19 Streaming SSR

### renderToReadableStream on Bun

Bun natively supports React 19's streaming SSR. No Vite, no webpack, no custom integration layer.

```ts
import { renderToReadableStream } from 'react-dom/server';

async function renderPage(
  match: MatchResult,
  request: Request,
): Promise<Response> {
  const { route, params, layouts } = match;

  // Load page + all layouts (lazy, cached)
  const Page = await loadModule(route.page!);
  const layoutComponents = await Promise.all(
    layouts.map(l => loadModule(l))
  );

  // Nest layouts: Root → ... → Leaf → Page
  let element = <Page params={params} />;
  for (let i = layoutComponents.length - 1; i >= 0; i--) {
    const Layout = layoutComponents[i];
    element = <Layout>{element}</Layout>;
  }

  // Stream HTML
  const stream = await renderToReadableStream(element, {
    bootstrapScripts: ['/client.js'],  // Hydration bundle
    onError(error) {
      console.error('SSR error:', error);
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
```

**What `renderToReadableStream` does:**
1. Renders the React tree to HTML as a `ReadableStream`
2. Sends the shell immediately (everything outside Suspense boundaries)
3. As Suspense boundaries resolve, streams the resolved HTML + inline `<script>` to swap placeholders
4. Client hydrates progressively — interactive as chunks arrive

**Why React 19 on Bun specifically:**
- React 19 detects Bun's `ReadableStream` and uses optimized paths (no Node.js stream polyfills)
- `renderToReadableStream` is the web-standard API (not `renderToPipeableStream` which is Node-specific)
- Bun's HTTP server accepts `ReadableStream` as a response body directly — zero conversion

### Suspense Streaming

```tsx
// app/dashboard/page.tsx
import { Suspense } from 'react';

export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      {/* Shell streams immediately */}

      <Suspense fallback={<p>Loading stats...</p>}>
        {/* Stats stream when the data resolves */}
        <DashboardStats />
      </Suspense>

      <Suspense fallback={<p>Loading activity...</p>}>
        {/* Activity streams independently */}
        <RecentActivity />
      </Suspense>
    </div>
  );
}
```

The shell (`<h1>Dashboard</h1>` + fallbacks) streams to the client immediately. Each Suspense boundary resolves independently and streams its content as it becomes ready. The client sees progressive content — no blank page, no full-page spinner.

### Hydration

The client bundle hydrates the server-rendered HTML through a generated app
entry. Zero writes the route manifest and entry under `.zero/generated` so the
framework runtime can later live in `node_modules` while route files remain in
the app source tree:

```tsx
// .zero/generated/client-entry.tsx
import { startHydration } from '@zero/framework/react/hydrate-runtime';
import { routes, serverRoutes } from './route-manifest';

startHydration({ routes, serverRoutes });
```

`hydrate-runtime` provides `RouterProvider` and `ErrorBoundary` only. The app's
root layout remains the sole owner of `AppProvider` for SDK client, sync, auth,
and state behavior.

**Route data injection:** The server renders a `<script>` tag with
`__ROUTE_DATA__` containing the matched pattern, params, and loader data. The
generated manifest maps that pattern to static dynamic imports so Bun can
code-split client pages and layouts. `__PLATFORM_CONFIG__` carries runtime
settings like auth, state sync, and resolved table sync modes; it does not carry
table definitions.

## Client Bundle

Bun builds the client-side JavaScript from the generated app entry point:

```ts
async function buildClientBundle(
  outDir: string,
  appDir = './app',
  options = { generatedDir: './.zero/generated' },
): Promise<void> {
  const manifestPath = generateRouteManifest({
    appDir,
    generatedDir: options.generatedDir,
  });
  const entrypoint = generateClientEntry({
    generatedDir: options.generatedDir,
  });

  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: outDir,
    target: 'browser',
    splitting: true,       // Code-split per route
    minify: true,
    sourcemap: 'linked',
    naming: '[name]-[hash].[ext]',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  if (!result.success) {
    throw new Error(`Client build failed: ${result.logs.join('\n')}`);
  }
}
```

**Code splitting:** `splitting: true` lets Bun automatically code-split. Each
client route's page module becomes a separate chunk. Server-only pages are
recorded in the manifest as `serverRoutes` and fall back to full page
navigation.

**Generated files:** `.zero/generated` is app-owned build glue and should stay
ignored. It is safe to delete; `createApp()` regenerates it before the client
bundle is built.

**When to build:**
- Development: build on startup, rebuild on file change (Bun file watcher)
- Production: build once at deploy time, serve from `outDir`
- Single binary: client bundle embedded in the compiled binary

## Elysia Router Plugin

The router integrates with Elysia as a catch-all plugin:

```ts
function createRouterPlugin(config: RouterConfig) {
  const tree = buildRouteTree(scanRoutes(config.appDir));
  const apiTree = buildAPIRouteTree(scanAPIRoutes(config.appDir));

  return new Elysia({ name: 'router' })
    .onStart(async () => {
      await buildClientBundle(config.outDir, config.appDir);
    })
    // API routes — matched first (higher priority)
    .all('/api/*', async ({ request, path }) => {
      const match = matchAPIRoute(apiTree, path);
      if (!match) return new Response('Not Found', { status: 404 });

      const handler = await loadAPIModule(match.route.apiRoute!);
      const method = request.method as keyof typeof handler;
      if (!handler[method]) return new Response('Method Not Allowed', { status: 405 });

      return handler[method]!(request, { params: match.params });
    })
    // Page routes — catch-all, SSR
    .get('*', async ({ request, path }) => {
      const match = matchURL(tree, path);
      if (!match) return renderNotFound(tree);
      return renderPage(match, request);
    });
}
```

**Plugin ordering matters:** The router plugin should be registered last — after auth, sync, and any custom API routes. Its `*` catch-all would shadow routes from other plugins if registered first.

## API Routes

API routes export named HTTP method handlers:

```ts
// app/api/todos/route.ts
import type { APIRequest } from '@zero/framework/server';

export async function GET(req: APIRequest) {
  const todos = req.db.query('SELECT * FROM todos').all();
  return Response.json(todos);
}

export async function POST(req: APIRequest) {
  const body = await req.json();
  req.db.insert('todos', body);  // Auto-PK generates UUID if id is missing
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: APIRequest, { params }: { params: { id: string } }) {
  req.db.delete('todos', params.id);
  return new Response(null, { status: 204 });
}
```

**`APIRequest`** extends the standard `Request` with context injected by Elysia:
- `req.db` — ReactiveDB instance (writes are reactive, broadcast to subscribers)
- `req.authContext` — `{ userId, email, role } | null` (from auth middleware)
- `req.json()` — parsed request body

API routes don't render React. They return standard `Response` objects. Same fetch API everywhere.

## Layouts

Layouts nest from root to leaf. Each layout receives `{ children }` and wraps the subtree below it.

### Nesting Example

```
app/
├── layout.tsx          ← Root layout (wraps everything)
├── dashboard/
│   ├── layout.tsx      ← Dashboard layout (auth check, sidebar)
│   └── settings/
│       └── page.tsx    ← Settings page
```

Request to `/dashboard/settings` renders:

```tsx
<RootLayout>           {/* app/layout.tsx */}
  <DashboardLayout>    {/* app/dashboard/layout.tsx */}
    <SettingsPage />   {/* app/dashboard/settings/page.tsx */}
  </DashboardLayout>
</RootLayout>
```

### Route Groups And Separate Shells

Use route groups when unrelated URL branches need different layouts without
adding extra URL segments:

```txt
app/
├── layout.tsx                  # providers only
├── (public)/
│   ├── layout.tsx              # public shell, no AppShell
│   ├── page.tsx                # /
│   └── intake/
│       └── resume/
│           └── [token]/
│               └── page.tsx    # /intake/resume/:token
└── (dashboard)/
    ├── layout.tsx              # AppShell + auth config
    └── dashboard/
        └── page.tsx            # /dashboard
```

Groups are preserved in the route tree so their layouts apply, but omitted
from URL patterns. `/dashboard` renders:

```tsx
<RootLayout>
  <DashboardLayout>
    <DashboardPage />
  </DashboardLayout>
</RootLayout>
```

`/intake/resume/abc` renders:

```tsx
<RootLayout>
  <PublicLayout>
    <ResumeIntakePage />
  </PublicLayout>
</RootLayout>
```

Do not put dashboard chrome in `app/layout.tsx` unless every route in the app
should use it. Put `ThemeProvider`, `AppProvider`, and `Toaster` in root; put
`AppShell` in the dashboard/app route layout.

### Auth-Gated Layout

```tsx
// app/dashboard/layout.tsx
import { AppShell, type RouteConfig } from '@zero/framework/react';

export const config: RouteConfig = {
  auth: 'required',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

The auth config runs on the server before rendering the layout or page. During
client navigation, Zero carries the matched route auth config through
hydration. If the user logs out or refresh fails while on a protected route,
`AppProvider` removes the protected subtree and redirects to `loginPath`.

For public-first apps, use `routeAuth: 'explicit'` in `createApp()` and add
`config.auth` only to protected page/layout branches. For internal tools, keep
the default `routeAuth: 'protected-by-default'` and list login/reset routes in
`publicPaths`.

## Sitemap

Zero can serve `/sitemap.xml` directly from the file-router tree:

```ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  app: {
    name: 'Acme CRM',
    publicUrl: 'https://crm.example.com',
  },
  db,
  tables,
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

Discovery rules:

1. Static public `page.tsx` routes are included automatically.
2. API route files are never included.
3. Dynamic routes like `[slug]` and catch-all routes are not guessed. Add them
   through `sitemap.entries` after your app knows the concrete URLs.
4. Route groups such as `(public)` and `(dashboard)` apply layouts and auth but
   do not appear in sitemap URLs.
5. Routes protected by `config.auth` on a page or parent layout are omitted.
6. In `routeAuth: 'protected-by-default'`, only paths covered by `publicPaths`
   are included.
7. `sitemap.exclude` removes matching paths and child paths even when they are
   public.

Set `app.publicUrl` in production so `<loc>` values are stable behind proxies.
When it is omitted, Zero uses the request origin, which is useful for local
development.

## Client-Side Navigation

**Key insight: since table data is already live on the client via the sync engine, most navigations don't need data fetching at all. Navigation = swap component + update URL.**

After initial SSR + hydration, all subsequent navigation is client-side. The sync engine keeps data live, so most page transitions are instantaneous — no loading spinners, no network waterfalls. Only pages that need non-synced data (one-off API calls, external data) use loaders.

### 1. First Load (SSR)

```
1. Browser requests GET /dashboard/settings
2. Server matches URL → loads route module → loads layouts
3. React 19 renderToReadableStream — HTML streams progressively (Suspense boundaries)
4. bootstrapScripts loads client bundle
5. Client calls hydrateRoot() — app becomes interactive
6. Sync engine connects, useCollection hooks take over with live data
```

### 2. Client Navigation (SPA)

```tsx
import { Link } from '@zero/framework/react';

<Link href="/dashboard/settings">Settings</Link>
```

**Flow:**
1. User clicks `<Link href="/dashboard/settings">`
2. `<Link>` intercepts click (`preventDefault`)
3. Client-side route matcher resolves URL to a route match (same matcher as server)
4. Lazy-load route module if not cached: `const mod = await import('/chunks/dashboard-settings-abc123.js')`
5. If route exports a `loader`, call it (for non-synced data)
6. Render page component with params + loader data
7. Shared layouts stay mounted — React only re-renders the changed subtree
8. `history.pushState()` updates URL bar
9. `useStatus`, `useCollection` etc. continue working — no reconnection needed

**Shared layouts are preserved.** If navigating from `/dashboard/settings` to `/dashboard/team`, the `RootLayout` and `DashboardLayout` stay mounted. Only the page component swaps. No re-render, no re-fetch, no flash.

### 3. Preloading (Hover Intent)

`<Link>` starts preloading on `mouseenter` / `focus` (configurable). By the time the user clicks, the module is loaded and data is ready — navigation feels instant.

```tsx
<Link href="/dashboard" prefetch="intent">Dashboard</Link>   {/* preload on hover (default) */}
<Link href="/settings" prefetch="render">Settings</Link>     {/* preload when Link enters viewport */}
<Link href="/admin" prefetch="none">Admin</Link>              {/* no preload */}
```

Preload = fetch the route's JS chunk + call loader if present.

| Prefetch mode | When it triggers | Use case |
|---------------|-----------------|----------|
| `'intent'` (default) | `mouseenter` / `focus` | Most links — preload when user shows intent |
| `'render'` | Link enters viewport (IntersectionObserver) | Navigation visible on screen (sidebars, navs) |
| `'none'` | Never — only loads on click | Rarely visited links, admin pages |

### 4. Route Loaders

Optional. Only needed for data **not** in synced tables. Most pages just use `useCollection`/`useRow` and need no loader.

```ts
interface LoaderContext {
  params: Record<string, string | string[]>;
  client: Client;          // SDK client for RPC/data access
  request?: Request;       // Available during SSR only
}
```

**Example where NO loader is needed (synced data):**

```tsx
// app/todos/page.tsx — NO loader needed, data is live
export default function Todos() {
  const { data, insert } = useCollection<Todo>('todos');
  return <ul>{data.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

**Example where loader IS needed (one-off data):**

```tsx
// app/blog/[slug]/page.tsx — external data, needs loader
export async function loader({ params }: LoaderContext) {
  const post = await fetch(`/api/posts/${params.slug}`).then(r => r.json());
  return { post };
}

export default function BlogPost({ data }: { data: { post: Post } }) {
  return <article>{data.post.content}</article>;
}
```

**Example with Eden RPC in loader:**

```tsx
// app/dashboard/[teamId]/page.tsx — non-synced data via typed RPC
export async function loader({ params, client }: LoaderContext) {
  const stats = await client.rpc.dashboard.stats.get({ query: { teamId: params.teamId } });
  return { stats };
}

export default function TeamDashboard({ data, params }: { data: { stats: Stats }; params: { teamId: string } }) {
  const { data: members } = useCollection<Member>('members');  // live synced data
  return (
    <div>
      <h1>Team {params.teamId}</h1>
      <StatsCard stats={data.stats} />          {/* from loader */}
      <MemberList members={members} />           {/* from sync engine, live */}
    </div>
  );
}
```

**Loader behavior:**
- Loaders run on navigation, receive `{ params, client }`
- Loader data is passed to the page component as a `data` prop
- Loaders can be async — page renders when loader resolves
- During SSR, loaders run on the server (same function, isomorphic)
- On client navigation, loaders run on the client

### 5. Navigation State

```ts
useRouter() → {
  push(path: string): void;           // Navigate, add to history
  replace(path: string): void;        // Navigate, replace history entry
  back(): void;                        // history.back()
  isNavigating: boolean;               // True while loading route module + loader
  prefetch(path: string): void;        // Manually trigger preload
}
```

```tsx
function SaveAndNavigate() {
  const router = useRouter();

  const handleSave = async () => {
    await saveDraft();
    router.push('/dashboard');
  };

  return (
    <div>
      <button onClick={handleSave}>Save</button>
      {router.isNavigating && <Spinner />}
    </div>
  );
}
```

### 6. Code Splitting

`Bun.build({ splitting: true })` produces per-route chunks automatically.

- Route modules are lazy-loaded on first navigation
- Cached after first load — subsequent navigations to the same route are instant
- Shared dependencies (React, SDK) go into a common chunk
- The initial page's chunk is included in `bootstrapScripts` — no extra round-trip on first load

### 7. Scroll Restoration

| Navigation type | Scroll behavior |
|----------------|----------------|
| New navigation (`push`) | Scroll to top |
| Back/forward (`popstate`) | Restore previous scroll position |
| Same-page navigation | No scroll change |

Configurable per-route by exporting `scrollBehavior`:

```tsx
// app/docs/[...path]/page.tsx
export const scrollBehavior = 'preserve';  // Don't scroll to top on navigation within docs
```

### Link Component

```ts
interface LinkProps {
  href: string;
  prefetch?: 'intent' | 'render' | 'none';  // default: 'intent'
  replace?: boolean;                          // replace history entry instead of push
  className?: string;
  children: React.ReactNode;
}
```

```tsx
import { Link } from '@zero/framework/react';

<Link href="/dashboard/settings">Settings</Link>
<Link href="/blog/hello-world" prefetch="render">Read more</Link>
<Link href="/login" replace>Login</Link>
```

`<Link>` renders a standard `<a>` tag for SEO and accessibility. The click handler intercepts navigation and performs client-side routing. Middle-click, Ctrl+click, and `target="_blank"` fall through to normal browser behavior.

## Development Mode

In development, the router watches the `app/` directory for changes:

```ts
import { watch } from 'fs';

function watchAppDir(appDir: string, onReload: () => void) {
  watch(appDir, { recursive: true }, (event, filename) => {
    if (!filename) return;
    if (filename.endsWith('.tsx') || filename.endsWith('.ts')) {
      // Invalidate cached module
      invalidateModule(filename);
      // Rebuild client bundle
      rebuildClientBundle();
      // Signal connected clients to refresh
      onReload();
    }
  });
}
```

**Hot reload strategy:**
- Server: invalidate the cached module for the changed file, next request re-imports it
- Client: rebuild the client bundle, send a reload signal via WebSocket (the sync WS is already connected)
- No HMR framework needed — full page reload is fast when SSR + hydration is <100ms

## Route Types

```ts
interface RawRoute {
  filePath: string;
  segments: string[];       // URL segments (groups stripped)
  rawSegments: string[];    // Original segments (groups preserved)
}

interface RouteModule {
  filePath: string;
  component: React.ComponentType | null;
  loaded: boolean;
}

interface APIRouteModule {
  filePath: string;
  handlers: Record<string, (req: Request, ctx: { params: Record<string, string> }) => Response | Promise<Response>> | null;
  loaded: boolean;
}

interface RouteNode {
  segment: string;
  page: RouteModule | null;
  layout: RouteModule | null;
  apiRoute: APIRouteModule | null;
  children: Map<string, RouteNode>;
  dynamicChild: RouteNode | null;
  catchAllChild: RouteNode | null;
}

interface MatchResult {
  route: RouteNode;
  params: Record<string, string | string[]>;
  layouts: RouteModule[];
}

interface RouterConfig {
  appDir: string;
  outDir: string;
  notFoundComponent?: React.ComponentType;
}
```

## Design Decisions

**Why build our own router instead of TanStack Router or React Router:**
- File-based routing is a compile-time concern — we scan at startup, not at runtime
- TanStack Router is excellent for SPAs but adds complexity for SSR streaming
- React Router v7 (Remix) has its own server layer — conflicts with our Elysia + Bun architecture
- Our router is ~300 lines total (scanner + tree + matcher + renderer). The abstraction is small enough to own

**Why not Vite:**
- Bun is both the bundler and the runtime. Adding Vite means two build tools, two config systems, two module resolution strategies
- Bun's `Bun.build()` supports code splitting, tree shaking, minification — everything Vite delegates to Rollup/esbuild
- The router needs tight integration with the server (ReactiveDB, auth context) — a framework-agnostic dev server adds indirection

**Why catch-all route in Elysia:**
- Elysia handles auth, sync, API routes, and WebSocket via its plugin system
- The router is just another plugin with a `*` catch-all
- This means auth middleware, CORS, logging — all Elysia middleware — applies to SSR routes too

**Why lazy module loading:**
- Hundreds of routes in large apps means hundreds of `import()` calls at startup
- Lazy loading: first request to a route pays the import cost (~1-5ms), all subsequent requests are instant
- Production can optionally pre-warm all routes on startup if latency on first request matters
