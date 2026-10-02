# Zero Framework

Zero is a Bun/Elysia full-stack app framework for building data-heavy web apps
quickly from one integrated platform. It ships backend services, frontend
components, routing, auth, storage, sync, workflows, notifications, AI, vector
storage, browser-grade PDF rendering, migrations, observability, and app-ready
hooks so new apps do not start by rebuilding the same foundation.

## Create A Local App

From this framework checkout, generate a package-mode app from a local
publish-style archive:

```sh
bun run install:local-tools
zero-new ../my-zero-app
cd ../my-zero-app
bun run dev
```

The same workflow without the local convenience wrapper is:

```sh
bun run create-zero -- ../my-zero-app --local --install
cd ../my-zero-app
bun run dev
```

Without `--install`, run `bun install` yourself before `bun run dev`.

Local creation packs the current checkout into the generated app's ignored
`.zero/framework/` cache. This matches published-package dependency behavior,
avoids duplicate frontend runtimes, and excludes checkout-only files.

## Update An Existing App

Stop the app/dev server, then update a checkout-local app without regenerating
it:

```sh
bun run install:local-tools       # rerun after moving this Zero checkout
cd ../my-zero-app
zero-update                       # packs and installs this checkout
zero-update --dry-run             # inspect the plan only
```

For an app using a published Zero package, use the framework CLI:

```sh
bun run zero update --project .           # update within the configured package source
bun run zero update --project . --latest  # intentionally select the latest release
```

If the installed Zero version predates the update command, bootstrap it with
`bunx --package @zero/framework@latest zero update --project .`. The project
must already have exactly one `bun.lock` or `bun.lockb`, even for `--dry-run`.
Commit that lockfile for checkout-local apps so a fresh clone can be restored
without first resolving its ignored local archive.

The updater owns only the `@zero/framework` dependency, its local archive when
present, and package-manager install state. For local updates, the ignored
`.zero/framework/zero-framework.tgz` cache is regenerated from the selected
checkout. After a clean clone, `.zero/`, `.zero/framework/`, and the archive may
all be absent; a mutating local update safely creates that managed cache before
installing Zero. `--dry-run` reports the pending bootstrap without creating
anything. Existing symlinks or non-directory/non-file entries at those managed
paths are rejected. The updater does not regenerate or overwrite app-owned
source, configuration, environment files, databases, or storage in its default
mode. By default it runs no app-defined scripts. `--check` executes the
project's existing typecheck and Doctor scripts; review them first because
their side effects are outside updater rollback. Zero itself never selects a
migration command. Run `bun run migrate:plan` separately and intentionally
against the correct database or a safe copy before applying any database
change.

Never use `create-zero --force` or `zero-new --force` as an updater. Those are
scaffolding commands and may replace a non-empty target project.

For a published package later, the same shape becomes:

```sh
bunx create-zero my-zero-app
cd my-zero-app
bun install
bun run dev
```

## App Shape

Generated apps keep application code outside the framework source tree:

```txt
app/                 # file-router pages, layouts, and app server entry
components/          # app-owned UI components and overrides
hooks/               # app-owned React hooks
lib/                 # app-owned helpers
server/              # app-owned routes, endpoints, middleware, plugins, resources
db/schema.ts         # shared data model definitions
zero.config.ts       # platform systems and runtime settings
.zero/generated/     # generated build glue, ignored by git
```

Zero runtime code stays in `node_modules/@zero/framework`. Use package imports
instead of reaching into this repository:

```ts
import { createApp, defineZeroConfig } from '@zero/framework/server';
import { AppProvider } from '@zero/framework/react/app-provider';
import { useCollection } from '@zero/framework/react/hooks';
import { Button } from '@zero/framework/components/ui/button';
```

Installed desktop/mobile clients can use the implemented TypeScript
`@zero/framework/native` core to authenticate against the same Zero users and
server-side route/resource/Sync policy through system-browser OIDC + PKCE. A
client ID is public; installed apps never ship a Zero API secret or signing
key. Choose the integration before building a host bridge: the separate
Rust/Tauri repository is a Phase 0 scaffold/design only, while the separate
`@zero/chrome-auth` repository is a private Manifest V3 preview, not a released
package. Start with the
[App Authentication SDK Guide](./docs/auth/app-auth-sdk-guide.md).

## Docs Map

- [Start Here](./docs/start-here.md): main platform entry point.
- [Framework Docs](./docs/framework/README.md): package-mode app conventions,
  route loading, middleware, resources, and create-app behavior.
- [Framework Developer Surface](./docs/framework-developer-surface.md):
  canonical imports and app-owned extension examples.
- [App Authentication SDK Guide](./docs/auth/app-auth-sdk-guide.md): choose the
  web, TypeScript native, Rust/Tauri, or Chrome surface and follow the installed
  app onboarding/release checklist.
- [Desktop, Mobile, and Chrome Extension Auth](./docs/auth/native-app-auth.md):
  public-client registration, provider endpoints, system-browser account flows,
  secure storage, Sync, revocation, packaged desktop/mobile host bridges, and
  the Chrome MV3 security profile.
- [PDF Rendering](./docs/pdf.md): secure Chromium HTML/CSS rendering, storage
  composition, runtime setup, limits, and adapter contracts.
- [Torrent Durable Workflows](./docs/workflows.md): code DSL, canonical graph IR,
  immutable code/database versions, trusted activities, memory, interactions,
  recovery, and safe real-time React visualization data.
- [Component Inventory](./docs/frontend/component-inventory.md): reusable UI,
  app shells, data organisms, frontend sections, and use-first rules.
- [Frontend Router](./docs/frontend/router.md): layouts, route groups, auth
  boundaries, sitemap, and file-router behavior.
- [Releasing Zero](./docs/releasing.md): versioning and verification checklist.
- [llms.txt](./llms.txt): comprehensive agent-facing framework documentation
  with the main usage guide and full docs catalog.

## Useful Commands

```sh
bun run dev                 # run the in-repo reference app
bun run create-zero -- app  # scaffold a generated app
bun run typecheck
bun test
bun run test:package
bun run build
bun run doctor -- --config ./zero.config.ts
bun run pdf:install
bun run pdf:status
bun run zero update --project . --dry-run
zero-update --dry-run
zero-doctor --config ./zero.config.ts
```

`doctor` checks both platform configuration and app source usage. It warns when
app code bypasses Zero components/services, imports framework internals, uses
raw frontend controls where Zero primitives fit, logs through `console` in
backend app code, or grows source files past the responsibility threshold.

## Current Package State

Zero is currently Bun-first and exports TypeScript source through the package
export map. That is intentional for local package-mode development. Before npm
publication, use the stabilization checklist in
[docs/stabilization-plan.md](./docs/stabilization-plan.md) to verify package
metadata, publish files, bin behavior, and generated-app smoke tests.
