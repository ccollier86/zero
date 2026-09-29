# Zero Framework

Zero is a Bun/Elysia full-stack app framework for building data-heavy web apps
quickly from one integrated platform. It ships backend services, frontend
components, routing, auth, storage, sync, workflows, notifications, AI, vector
storage, browser-grade PDF rendering, migrations, observability, and app-ready
hooks so new apps do not start by rebuilding the same foundation.

Zero's integrated identity, session, tenancy, and authorization subsystem is
called **Guardian**. This is a documentation/product name; its established
`auth.*` configuration, `/auth/*` routes, and `@zero/framework/auth` API remain
unchanged.

ReactiveDB Fabric is active, unreleased child-branch work that extends the
existing pinned control database with bounded actor-owned application
databases. Its tenant mode derives a pseudonymous database binding from trusted
authorization scope, so tenant identity selects the database rather than a
caller-provided path or a redundant `tenant_id` predicate. The deterministic,
unkeyed binding reference is operational correlation metadata—not a secret or
authorization token—and a low-entropy source ID can be guess-correlated.
File/WAL placement supports independent writer processes across files and
optional same-file reader actors; bounded hot placement and synchronous hybrid
selection are also implemented. Resource CRUD, lazy data queries, and
multiplexed realtime Sync
use the selected database while preserving server-side policy and commit-time
authority checks. See the
[ReactiveDB Fabric architecture](./docs/framework/multi-database-architecture.md)
for its exact contract and remaining release gates.

Current development boundary: Guardian implements all four auth
profiles—`single/simple`, `single/advanced`, `multi/simple`, and
`multi/advanced`—through one app-local authorization system. Multi-tenant
sessions, registered resources, Sync, scoped built-in services, tenant
administration, invitations/join requests, browser authorization state, and
packaged controls are present, including opt-in verified-company-domain
request onboarding and the bounded authorization/control-plane audit.
Multi-mode bootstrap now creates a protected Administration Organization, and
the browser SDK, hooks, and packaged controls cover its people plus the
capability-gated customer-organization directory and lifecycle. Upstream
enterprise SSO, break-glass, tenant-custom roles, broader populated-app
discovery/migration tooling beyond the exact documented pre-024 administration
reconciliation, and domain
autojoin/aliases/direct transfer remain explicitly deferred. Registered
resources now declare explicit server-owned client exposure and optional
field-level read/write/filter/sort allow-lists. File-mode runtimes sharing one
SQLite database relay durable changes and authorization invalidations across
their active sockets; hot/ephemeral or separate-database replicas still need an
external coordination layer. Multi-mode
startup verifies their actual SQLite primary key and tenant discriminator,
requires a non-partial tenant-leading index, rejects tenant-owned business
uniqueness that omits the tenant, and requires tenant-to-tenant foreign keys to
carry the tenant pair in the same composite constraint.
Default `createApp()` installs the
framework-table and managed-topic policies, while direct `createSyncPlugin()`
composition still requires explicit auth and policy. Treat these additions as
unreleased until the release checklist and package verification pass. See
[Releasing Zero](./docs/releasing.md) and the
[auth implementation checklist](./docs/auth/multi-tenant-auth-implementation-checklist.md)
for the supported-versus-preview boundary.
The exact Administration Organization contract is documented in
[Platform Administration Organization](./docs/auth/platform-administration.md).

## Create A Local App

Install the local tools once, then generate a package-mode app from the saved
committed-`main` package:

```sh
bun run install:local-tools
zero-new ../my-zero-app
cd ../my-zero-app
bun run dev
```

`zero-new` installs `@zero/framework` from a saved `.tgz` package. Both the
framework and starter template come from that package, never the active
checkout. Each app records the source commit and checksum in `zero-release.json`.

`zero-release --status` shows the active package. `zero-release` refreshes it
from local `main` using Git's committed tree, even while a feature branch or
uncommitted changes are present. The installer adds repository-local
`post-commit` and `post-merge` hooks that refresh it only on `main`. Existing
custom hooks are preserved; if installation reports one, refresh explicitly.
Failed publication retains the previous package. Commands refuse a missing or
corrupt saved archive instead of falling back to the checkout.

For intentional framework development against the working checkout, use:

```sh
bun run create-zero -- ../my-zero-app --local --install
cd ../my-zero-app
bun run dev
```

Without `--install`, run `bun install` yourself before `bun run dev`.

The explicit `create-zero --local` development path packs the working tree,
including eligible uncommitted files. The installed `zero-new` command instead
copies the saved release into the app's ignored `.zero/framework/` cache. Both
use normal package dependency installation and avoid duplicate frontend runtimes.

## Update An Existing App

Stop the app/dev server, then update a checkout-local app without regenerating
it:

```sh
bun run install:local-tools       # install saved-package tools and main hooks
cd ../my-zero-app
zero-update                       # installs the saved committed-main package
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
present, and package-manager install state. For `zero-update`, the ignored
`.zero/framework/zero-framework.tgz` cache is copied from the saved stable
package; the development checkout is never packed. An explicit
`zero update --local /path/to/checkout` remains available for framework testing.
After a clean clone, `.zero/`, `.zero/framework/`, and the archive may
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
bunx -p @zero/framework create-zero my-zero-app
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
Rust/Tauri repository is a functional private `0.0.0` preview with a
Rust-owned OIDC/PKCE engine and deny-by-default Tauri boundary, while the
separate `@zero/chrome-auth` repository is a functional private Manifest V3
preview. Neither is a released registry package or bundled into generated
apps. Start with the
[App Authentication SDK Guide](./docs/auth/app-auth-sdk-guide.md).

## Docs Map

- [Start Here](./docs/start-here.md): main platform entry point.
- [Framework Docs](./docs/framework/README.md): package-mode app conventions,
  route loading, middleware, resources, and create-app behavior.
- [Framework Developer Surface](./docs/framework-developer-surface.md):
  canonical imports and app-owned extension examples.
- [ReactiveDB Fabric](./docs/framework/multi-database-architecture.md):
  unreleased multi-database topology, actor isolation, file/WAL and bounded
  hot placement, tenant routing, realtime behavior, capacity, durability, and
  operational boundaries.
- [Auth System](./docs/auth/README.md): canonical auth index for installation
  bootstrap, all four tenancy/authorization profiles, declarative permissions,
  administration, onboarding, browser state, audit, and installed-app auth.
- [App Authentication SDK Guide](./docs/auth/app-auth-sdk-guide.md): choose the
  web, TypeScript native, Rust/Tauri, or Chrome surface and follow the installed
  app onboarding/release checklist.
- [Desktop, Mobile, and Chrome Extension Auth](./docs/auth/native-app-auth.md):
  public-client registration, provider endpoints, system-browser account flows,
  secure storage, Sync, revocation, packaged desktop/mobile host bridges, and
  the Chrome MV3 security profile.
- [Zero Auth Philosophy](./docs/auth/zero-auth-philosophy.md): stable direction
  for additive single/multi-tenancy and simple/advanced authorization. The
  linked implementation checklist distinguishes current behavior from planned
  capabilities.
- [PDF Rendering](./docs/pdf.md): secure Chromium HTML/CSS rendering, storage
  composition, runtime setup, limits, and adapter contracts.
- [Component Inventory](./docs/frontend/component-inventory.md): reusable UI,
  app shells, data organisms, frontend sections, and use-first rules.
- [Frontend Router](./docs/frontend/router.md): layouts, route groups, auth
  boundaries, sitemap, and file-router behavior.
- [Releasing Zero](./docs/releasing.md): versioning and verification checklist.
- [llms.txt](./llms.txt): comprehensive agent-facing framework documentation
  with the main usage guide and full docs catalog.

## Useful Commands

```sh
bun run dev                 # watch the Zero CLI entry point
bun run create-zero -- app  # scaffold a generated app
bun run typecheck
bun run test
bun run test:package
bun run build
bun audit                    # fail the release review on known dependency advisories
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
publication, follow the current supported-boundary and verification checklist in
[Releasing Zero](./docs/releasing.md). The older
[stabilization plan](./docs/stabilization-plan.md) is retained as historical
context, not as the release gate.
