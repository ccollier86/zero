# Changelog

All notable Zero Platform changes are tracked here.

## 1.2.0 - 2026-07-01

Sitemap release for package-mode apps and public route discovery.

### Framework Runtime

- Added opt-in `sitemap` app config for serving request-time XML sitemaps from
  public static file-router pages.
- Added automatic route discovery that omits API routes, dynamic routes,
  catch-all routes, protected page/layout branches, and route-group folder
  names from sitemap output.
- Added manual sitemap entries, default `changefreq`/`priority`, public URL
  normalization, path excludes, and fail-closed behavior when route config
  cannot be imported safely.

### Tooling And Docs

- Updated `create-zero`, the package-mode fixture, and the legacy
  `create-project` script so generated apps show the sitemap setup.
- Added sitemap coverage to router, start-here, platform configuration,
  framework, system map, package-mode, and frontend docs.
- Added tests for sitemap config normalization, XML generation, auth/public
  route filtering, generated-app smoke behavior, and router mounting before the
  catch-all route.

## 1.1.0 - 2026-07-01

Framework-mode release that turns Zero into a package-first app platform while
preserving the in-repo LaunchBoard reference app as a durable example.

### Framework Runtime

- Added package-mode app composition through public `@zero/framework/*` exports, config-driven app startup, app-owned server routes, middleware, plugins, and service access.
- Added file-router route groups, route-owned layout branches, explicit route auth metadata, and client-side protected-route blanking/redirect behavior when auth is lost.
- Added a provider-only root layout plus route-group AppShell pattern so public flows, dashboards, and root-mounted app shells can coexist cleanly.
- Wired shared hot SQLite persistence into the platform runtime with memory-backed operation, snapshot recovery, file mode, and ephemeral mode options.
- Added durable platform KV/cache runtime with checkpoint/journal recovery, counters, namespaces, TTL, LRU eviction, and rate-limiter helpers.
- Reopened existing zvec collections cleanly so vector storage can recover and reuse persisted collections across restarts.

### Frontend And Reference App

- Preserved LaunchBoard as a tracked reference app under `app/`, using AppShell, ReactiveDB, platform modals, Radix-backed forms/selects, KanbanBoard, theme switching, and hot persistence.
- Added the route-group LaunchBoard structure at `/`: `app/(launchboard)/layout.tsx` owns shell chrome while `app/launchboard/launchboard-page.tsx` owns board content.
- Improved AppShell with the Animate UI/Radix sidebar pattern, workspace switcher, nested nav, breadcrumb/header row, theme toggler support, action menus, and animated icon handling.
- Improved form helpers, Radix-backed field rendering, Sonner styling, component inventory docs, forms docs, and frontend SDK docs.

### Tooling And Docs

- Expanded platform doctor coverage for route auth, package-mode config, resource policies, and newer runtime guidance.
- Updated start-here, framework, AppShell, router, LaunchBoard, SDK, auth, token, platform configuration, roadmap, and package-mode example docs.
- Added durable docs for webhooks and component inventory so app-building agents can discover existing Zero surfaces before creating duplicates.

## 1.0.0 - 2026-06-28

Initial versioned platform release.

### Platform

- Hardened the Elysia/Bun backend foundation with stricter sync policy, safer `/api/data` querying, result limits, pagination, sorting, filtering, and platform doctor guidance.
- Added first-class migration tooling with status, planning, rollback safety classification, schema history, drift checks, and doctor integration.
- Added centralized observability contracts, stable event codes, default sinks, frontend reporting, and a protected platform event endpoint.
- Added auth account lifecycle support for controlled registration, admin-created users, password reset/setup flows, email delivery through the platform email service, and admin user management capabilities.
- Added natural identity support for relationship-style tables so apps can keep one ReactiveDB sync primary key while enforcing composite uniqueness semantics.
- Added AI service integration for Vercel AI SDK providers, model aliases, provider readiness, conversation helpers, workflow bridges, tool registration, and documentation for required provider environment variables.
- Added zvec-backed vector storage with collection management, query helpers, AI bridge utilities, doctor checks, and documentation.

### Frontend

- Added and documented reusable admin user management, storage management, data table, details view, auth, storage, sync, workflow, AI, vector, upload, and platform-specific hooks.
- Added a generic hook library for common React behavior such as idle detection, clipboard, click-away, OS detection, text selection, debounce, and throttle helpers.
- Added Animate UI animated Lucide icons as the default platform icon pack through `@platform/frontend/icons`.
- Improved auth persistence and session refresh behavior so expired or invalid sessions redirect through the configured login route.

### Tooling And Docs

- Added `docs/start-here.md`, platform feature docs, frontend hook/icon docs, AI/vector docs, and updated environment examples.
- Added `bun run version:bump -- <semver>` for explicit package version metadata updates.
