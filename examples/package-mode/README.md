# Zero Package-Mode Fixture

This fixture shows the target app shape for a generated Zero app. It imports
the framework through `@zero/framework/*` only; app-owned code lives beside the
config, pages, data schema, and app-owned server extension folders.

Backend code can live in:

| Folder | Purpose |
| --- | --- |
| `server/plugins/` | Advanced app plugins. |
| `server/middleware/` | Named app middleware. |
| `server/endpoints/` | Single Zero-native endpoints. |
| `server/routes/` | Grouped routers and raw Elysia escape-hatch plugins. |

Run from the repository root while this fixture is being developed:

```sh
bun build examples/package-mode/app/server.ts --target bun --outdir .zero/package-mode-fixture-build
```

Create a new app from this shape with:

```sh
create-zero my-app
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
plus `@/*`, `@/components/*`, `@/hooks/*`, and `@/lib/*` for app-owned source.
The `@/components/*`, `@/hooks/*`, and `@/lib/*` aliases check app-owned source
first, then fall back to Zero's packaged source. That lets copied components
override framework defaults without breaking package-mode typecheck.

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
| `zero.config.ts` | App name, SQLite storage mode/paths, enabled platform systems, output paths, port. |
| `db/schema.ts` | App table definitions shared by backend and frontend. |
| `app/` | File-router layouts/pages and client UI. |
| `server/endpoints/` | Single Zero-native API endpoints. |
| `server/routes/` | Grouped routers and raw Elysia escape-hatch plugins. |
| `server/middleware/` | Named app middleware and matchers. |
| `server/plugins/` | Advanced app plugins. |

The starter uses SQLite `hot` mode by default: active relational data stays in
process memory and Zero writes snapshot recovery files under `./data`. Set
`DB_PATH=./data/app.db` when you want explicit SQLite file/WAL mode instead.
The starter also mounts the platform KV/cache service by default with journal
and checkpoint files under `ZERO_KV_BASE_DIR` or `./data/kv`.

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

Routes or layouts with a top-level `"use client"` directive are mounted by the
browser bundle. The server still resolves metadata, loader data, route data, and
platform config, but it does not execute client hooks during SSR. Server-only
routes without `"use client"` continue to stream HTML through React SSR.
