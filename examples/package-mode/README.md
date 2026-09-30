# Zero Package-Mode Starter

This starter shows the target app shape for a generated Zero app. It imports
the framework through `@zero/framework/*` only; app-owned code lives beside the
config, pages, data schema, and app-owned server extension folders.

Backend code can live in:

| Folder | Purpose |
| --- | --- |
| `server/plugins/` | Advanced app plugins. |
| `server/middleware/` | Named app middleware. |
| `server/endpoints/` | Single Zero-native endpoints. |
| `server/routes/` | Grouped routers and raw Elysia escape-hatch plugins. |
| `server/resources/` | Resource definitions discovered by Zero at startup. |

Run from the repository root while this starter is being developed:

```sh
bun build examples/package-mode/app/server.ts --target bun --outdir .zero/package-mode-fixture-build
```

Create a new app from this shape with:

```sh
create-zero my-app
```

While developing Zero locally before publishing it, generate an app from a
publish-style archive of this checkout:

```sh
bun run install:local-tools
zero-new ../my-zero-app
```

Without the local convenience wrapper:

```sh
bun run create-zero -- ../my-zero-app --local --install
```

Customize packaged UI or hook source with:

```sh
zero add components/ui/button
zero add components/data-table
zero add components/kanban
```

Generated starter projects should use the same structure, but with Zero
installed as a dependency instead of living in this repository.

The root layout owns `AppProvider` and receives the shared `tables` object from
`db/schema.ts`. Keep that shared shape in generated apps: `createApp()` extracts
server table definitions, while `AppProvider` extracts client table definitions
for hooks like `useCollection()`.

Generated apps include an `@app/*` path alias for file-router client manifests,
plus `@/*`, `@/components/*`, `@/hooks/*`, and `@/lib/*` for app-owned source
first. Installed-framework fallbacks support Zero's internal aliases while the
package ships TypeScript source. App code still consumes framework features
through public `@zero/framework/*` imports, never direct `node_modules` paths.

## Configuration Shape

The server entry should stay thin:

```ts
import { createApp } from '@zero/framework/server';
import config from '../zero.config';

const app = await createApp(config);
app.listen(config.port);
```

Runtime settings belong in `zero.config.ts`. App features belong in the app
folders:

| Location | Owns |
| --- | --- |
| `zero.config.ts` | App name/public URL, SQLite storage mode/paths, enabled platform systems, PDF runtime, sitemap, output paths, port. |
| `db/schema.ts` | App table definitions shared by backend and frontend. |
| `app/` | File-router layouts/pages and client UI. |
| `server/endpoints/` | Single Zero-native API endpoints. |
| `server/routes/` | Grouped routers and raw Elysia escape-hatch plugins. |
| `server/middleware/` | Named app middleware and matchers. |
| `server/plugins/` | Advanced app plugins. |
| `server/resources/` | Resource definitions discovered by Zero at startup. |

The starter uses SQLite `hot` mode by default: active relational data stays in
process memory and Zero writes snapshot recovery files under `./data`. Set
`DB_MODE=file` when you want explicit SQLite file/WAL mode instead, and use
`DB_PATH` / `DB_SNAPSHOT_PATH` to override the default storage files.
Zero/Guardian authority is always separate from application data. The starter
uses durable `SYSTEM_DB_MODE=file` at `./data/zero.system.db`; configure
`SYSTEM_DB_PATH` separately and never point it or its hot snapshot at an
application database path.
The starter also mounts the platform KV/cache service by default with journal
and checkpoint files under `ZERO_KV_BASE_DIR` or `./data/kv`.
The generated starter keeps auth and state sync off by default so the first app
page is public and quiet. To enable accounts, generate a bootstrap secret and
start with auth enabled:

```sh
openssl rand -base64 32
# Set the result as AUTH_BOOTSTRAP_SECRET, then set ZERO_AUTH_ENABLED=true.
```

The first-administrator form asks for that operator setup key. Zero consumes
the bootstrap opportunity once, and later self-registration follows the
configured registration mode. Keep the secret in deployment secrets rather
than source; it is never returned by the auth config APIs.
It also enables `/sitemap.xml` from public static routes. Keep utility pages
such as login/reset flows in `sitemap.exclude`, and add dynamic pages through
`sitemap.entries` after your app can enumerate concrete URLs.

PDF rendering is disabled by default. Set `ZERO_PDF_ENABLED=true`, then install
the pinned Chromium revision once per development machine or production image:

```sh
bun run pdf:install
bun run pdf:status
```

Backend endpoints and workflows receive `zero.pdf`; use `render()` for bytes
or `renderToStorage()` for a generated private file. Zero does not expose a
public PDF route. See `node_modules/@zero/framework/docs/pdf.md`.

## Layout And Auth Boundaries

Keep `app/layout.tsx` as the provider root: `ThemeProvider`, `AppProvider`,
global styles, toaster, and modal support. Put route-specific shells in nested
layouts or page components.

Public-first apps should use route-owned auth:

```ts
defineZeroConfig({
  auth: true,
  routeAuth: 'explicit',
  loginPath: '/login',
  // ...
});
```

Then protect the dashboard branch with a layout:

```tsx
// app/(dashboard)/layout.tsx
import { AppShell, type RouteConfig } from '@zero/framework/react';

export const config: RouteConfig = { auth: 'required' };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

Use route groups for sibling layout branches without changing URLs:

```txt
app/
  layout.tsx
  (public)/page.tsx
  (public)/intake/resume/[token]/page.tsx
  (dashboard)/layout.tsx
  (dashboard)/dashboard/page.tsx
```

Internal dashboard-only apps can keep `routeAuth: 'protected-by-default'` and
list login/reset routes in `publicPaths`.

## Package-Mode Imports

The broad `@zero/framework/react` barrel remains available for quick app code.
For production starters and larger apps, prefer narrow imports so TypeScript and
the browser bundle only touch the surface being used:

```tsx
import { AppProvider } from '@zero/framework/react/app-provider';
import { useCollection } from '@zero/framework/react/hooks';
import { Button } from '@zero/framework/components/ui/button';
import { KanbanBoard } from '@zero/framework/components/kanban';
```

Generated apps pin `react`, `react-dom`, and their type packages to the
framework-tested versions. Zero resolves SSR and browser bundle React from the
app package so package-mode apps avoid duplicate React copies when using a local
`file:` dependency during framework development.

## Client Routes

The starter `app/layout.tsx` and `app/page.tsx` are server-rendered by default,
so the first public page ships HTML content and the platform stylesheet without
client route JavaScript. Add a top-level `"use client"` directive only to pages
or layouts that need browser hooks, AppShell interactivity, ReactiveDB hooks,
forms, or other client-side behavior.

Routes or layouts with a top-level `"use client"` directive are mounted by the
browser bundle. The server still resolves metadata, loader data, route data, and
platform config, but it does not execute client hooks during SSR. Server-only
routes without `"use client"` continue to stream HTML through React SSR.
