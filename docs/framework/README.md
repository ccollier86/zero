# Framework Docs

This folder owns Zero's framework-mode documentation: create-app/package-mode
behavior, app-owned extension conventions, Zero-native backend APIs, and
standardized backend/frontend framework surfaces.

Use this folder for docs that explain how Zero behaves as an installed
framework. Keep feature-specific implementation docs in their existing folders
when the topic is mostly about one subsystem such as auth, sync, storage, AI,
vector, PDF, workflows, observability, or migrations.

## Local Create Workflow

Until Zero is published, create package-mode apps from the local checkout:

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

The generated app depends on a publish-style `@zero/framework` archive cached
under its ignored `.zero/framework/` directory and keeps app code in `app/`,
`server/`, `db/schema.ts`, and `zero.config.ts`. The installed package resolves
through `node_modules/@zero/framework`; checkout-only source and secrets are
not linked into the app.

## Safe Update Workflow

Stop the app/dev server, then refresh an existing local package-mode app from
the saved committed-`main` package with:

```sh
bun run install:local-tools
cd ../my-zero-app
zero-update
```

The wrapper defaults to the current app directory and uses the stable package
saved by the checkout that installed it. It never packs that checkout's live
working tree or accepts `--local`/`--latest` overrides; a missing or corrupt
saved archive fails closed. Use `--dry-run` to inspect the plan without writing
anything. For deliberate testing of an unreleased checkout, invoke
`zero update --project /path/to/app --local /path/to/zero-platform` explicitly.

Published-package apps use `bun run zero update --project .`; `--latest` is an
explicit opt-in to the newest release. If the installed framework predates the
command, bootstrap it with
`bunx --package @zero/framework@latest zero update --project .`. Exactly one
Bun lockfile must already exist, including for dry-runs; local archive
updates require the text `bun.lock` so its integrity can be refreshed safely.
Commit the lockfile for checkout-local apps. Updates are narrowly scoped to the framework
dependency, the cached local archive when applicable, and package-manager
install state. App-owned source, config, environment files, databases, and
storage are not scaffolded or rewritten in the default mode. `zero-update`
copies the saved stable archive into the ignored
`.zero/framework/zero-framework.tgz` cache; only an explicit
`zero update --local ...` development command packs the selected checkout. A clean clone may
be missing the archive and both managed directories: the mutating updater
creates them, while `--dry-run` leaves the project untouched and reports that
bootstrap as pending. Existing symlinks or wrong-type managed entries are
rejected. The default update runs no app-defined scripts. `--check` executes the
project's existing typecheck and Doctor scripts; review them first because their
side effects are outside updater rollback. Zero itself never selects a migration
command. Run
`bun run migrate:plan` separately and intentionally against the correct
database or a safe copy before applying database changes.

`create-zero --force` and `zero-new --force` are destructive scaffolding tools,
not update commands. Never point either one at an existing project to update
Zero.

## Documents

- [Auth System](../auth/README.md): canonical feature index for auth profiles,
  declarative permissions and RBAC, tenant/application administration,
  onboarding, browser authorization state, and installed-app authentication.
- [API Standardization Plan](./api-standardization-plan.md): historical phased plan for
  Zero-native backend extensions, middleware matchers, resources, actions,
  frontend parity, generators, and documentation standardization.
- [Phase 1: Backend Extensions](./phase-1-backend-extensions.md): contract for
  Zero-native endpoints, routers, middleware, plugins, loader behavior, and
  acceptance criteria.
- [Phase 2: Middleware Matchers And Policy](./phase-2-middleware-policy.md):
  implemented matcher and authorization policy contract for app-owned
  middleware.
- [Phase 3: Unified Backend Context](./phase-3-backend-context.md): canonical
  app-facing `zero` backend service context, compatibility aliases, and lazy
  optional-service behavior.
- [Phase 4: Service API Smoothing](./phase-4-service-api-smoothing.md):
  canonical service method aliases and grouped storage APIs for app-owned
  backend code.
- [Phase 5: Resource And Policy API Plan](./phase-5-resource-policy-plan.md):
  historical implementation record for resource declarations, trusted
  user-property policy, generated CRUD, `/api/data`, Sync, and Doctor.
- [Hot Storage Architecture](./hot-storage-architecture.md): target
  high-performance storage architecture for hot SQLite snapshots, file/WAL
  mode, persistent cache/KV alignment, vector storage, and ReactiveDB
  refactoring.
- [Hot Storage Implementation Plan](./hot-storage-implementation-plan.md):
  phased plan for the Zero-owned KV/cache engine, SQL persistence primitive,
  ReactiveDB refactor, vector storage modes, doctor checks, and generated app
  defaults.
- [Platform KV/cache](../kv.md): Zero-owned memory-first KV/cache service,
  journal/checkpoint recovery, app-facing `zero.kv`, counters, limiters, and
  `createApp()` defaults.
- [PDF Rendering](../pdf.md): browser installation, secure Chromium rendering,
  print options, resource policy, storage composition, observability, and
  custom renderer contracts.
- [Desktop, Mobile, and Chrome Extension Auth](../auth/native-app-auth.md): registered
  public clients, OIDC/PKCE, system-browser callbacks, secure storage, and
  packaged host-bridge recipes.
- [Resource Policy Core](./resource-policy.md): current server-side realm,
  client-exposure, action, policy, SQLite-shape, generated CRUD, `/api/data`,
  Sync, and Doctor contract.
- [Auth And Data-Plane Capability Matrix](../auth/auth-data-plane-capability-matrix.md):
  enforcement owner, authoritative scope source, focused evidence, and trusted
  escape hatch for each official route, resource, Sync, and service surface.
- [Frontend Component Inventory](../frontend/component-inventory.md): canonical
  map of Zero UI primitives, Animate UI wrappers, app shells, forms, data
  organisms, domain organisms, import paths, and use-first rules for app and
  agent development.
- [Router](../frontend/router.md): file-router layouts, route groups,
  public-first vs protected-first route auth, automatic sitemap generation, and
  dashboard/AppShell placement rules.
- [Framework Developer Surface](../framework-developer-surface.md): current
  package-mode usage surface, imports, generated app shape, and examples.

## Working Rule

When framework-mode behavior changes, update the relevant document here and
link out to feature docs instead of duplicating entire subsystem manuals.
