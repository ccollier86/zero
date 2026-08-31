# Changelog

All notable Zero Platform changes are tracked here.

## Unreleased

### Added

- Added native desktop and mobile authentication through a registered public
  OpenID Connect Authorization Code + PKCE provider and the
  `@zero/framework/native` SDK. Native sessions use the existing Zero users,
  MFA/account gates, route/resource authorization, live revocation generation,
  rotating refresh-token families, system-browser registration, and secure
  platform storage adapters; no client secret or copied signing key is used.
- Added packaged, dependency-free desktop loopback and mobile browser-session
  adapter recipes, plus outside-tree tarball compilation coverage for the public
  native SDK entry point in Bun desktop and browser-compatible build targets.
- Added a process-shared native credential broker and revision-ordered IPC
  client so multi-window apps keep one vault owner and cannot apply delayed
  authentication or access-token responses after sign-out.
- Documented the Chrome Manifest V3 public-client profile: service-worker
  credential operations, revision-ordered extension-page messaging, exact
  `chromiumapp.org` redirects, Chrome Identity, narrow host permissions, and
  non-synced credential storage. Privileged extension pages remain explicitly
  trusted because Chrome storage is not worker-isolated. The independently
  versioned Chrome adapter is not bundled into applications created or updated
  by Zero. Its extension-global storage binding prevents server, client,
  persistence, or namespace changes from orphaning an older refresh family.
- Added safe-by-default native authorization admission keyed from the direct
  socket peer, plus explicit trusted-proxy CIDR unwrapping that ignores spoofed
  forwarding headers from untrusted connections and rejects universal `/0`
  trust ranges.
- Added `zero update` for narrowly scoped framework dependency upgrades in
  existing apps, with local-checkout and published-package sources, dry-run
  planning, opt-in project checks, installed-package verification, and
  transactional backup plus attempted rollback of Zero-managed artifacts when
  installation fails. Rollback failures preserve a recovery backup and are
  reported explicitly. Added a checkout-bound `zero-update`
  wrapper for safely refreshing local package-mode apps without regenerating
  app code.
- Added opt-in browser-grade PDF rendering through `zero.pdf` and
  `@zero/framework/pdf`, including modern HTML/print CSS support, secure
  resource defaults, bounded rendering, direct storage composition, stable
  errors/observability, and replaceable renderer/storage adapters.
- Added `zero pdf install` and `zero pdf status`, generated-app convenience
  scripts, Platform Doctor PDF checks, deployment configuration, real Chromium
  integration coverage, and comprehensive PDF documentation.

### Fixed

- Upgraded `DatePicker` from a button-only calendar trigger to a synchronized
  typed input and calendar control. Unambiguous U.S. numeric dates with `/` or
  `-` normalize to the existing long display, while invalid or disabled dates
  are never emitted through the controlled value contract.
- Fixed authenticated Eden Treaty requests, including multipart `File`
  uploads, so the browser sends exactly one bearer value, replaces it after a
  401 refresh, and waits for an in-flight session restoration before sending
  the request body.
- Made Sync reconnects authoritative across server restarts, authorization-scope
  changes, sequence gaps, and socket backpressure. Clients now replace stale
  full and lazy caches when required, purge data after access changes, and use
  bounded privacy-safe mutation receipts so an uncertain retry either returns
  the current authorized result or fails closed without executing a write
  twice.
- Made `create-zero --force` transactional and boundary-safe: CLI option values
  can no longer become deletion targets, broad/overlapping/symlinked paths fail
  closed, generation and local package installation finish in a sibling staging
  directory, and replacement uses a checked backup/swap with rollback.
- Isolated independently versioned Rust/Tauri and Chrome SDK repositories from
  framework packaging, test discovery, generated apps, and updates. Scaffold
  replacement now refuses targets containing root or nested Git repositories,
  and custom templates never copy `.git` metadata.
- Moved public password-recovery and verification-resend delivery onto a
  durable privacy-safe outbox with identical immediate responses, bounded
  leasing/retry/dead-letter behavior, terminal PII scrubbing, crash recovery,
  per-attempt provider idempotency, and shutdown ordering that joins delivery
  before Sync or SQLite teardown. Deterministic provider 4xx responses now
  dead-letter once with a stable safe code, while 408/425/429, network failures,
  and 5xx responses retain bounded retry behavior without storing provider
  response details.
- Made email verification a single atomic security transition: consuming one
  link now verifies the account, revokes pre-verification sessions, advances
  the auth generation, and invalidates every sibling verification link before
  a new session is issued. Standalone `createAuthPlugin()` compositions can use
  `installAuthStopBarrier()` so `await app.stop()` joins auth email delivery
  before the caller disposes its injected database; Doctor warns when a direct
  public plugin composition omits that barrier.
- Replaced per-app anonymous SIGINT/SIGTERM listeners with one process-shared
  createApp shutdown dispatcher. Normal stops unregister cleanly, repeated
  signals share one shutdown, and every active app lifecycle settles before the
  process exits.
- Derived a stable RFC 7638 key ID when a managed `AUTH_SIGNING_KEY` JWK omits
  `kid`, keeping JWT headers and JWKS discovery consistent across restarts and
  replicas that share the same key material.
- Bounded canonical auth-email inputs to the practical 254-character mailbox
  limit before identity lookup, storage, or background delivery admission.
- Added centralized, generous auth HTTP request bounds so oversized login
  identifiers and passwords are rejected before Argon2, oversized tokens before
  hashing or JWT work, and oversized admin search/profile/property payloads
  before database work, while retaining structured JSON user-property values.
- Bound native access tokens to live session families so sign-out, replay
  detection, family eviction, client removal, and administrator revocation are
  enforced on the next Zero HTTP request instead of waiting for JWT expiry.

- Made guarded native-auth migration backups WAL-safe by snapshotting the live
  SQLite connection before schema rebuilds, so committed WAL pages and existing
  application data are present in the recovery copy.
- Auth-enabled apps now default WebSocket Sync to authenticated-only. Apps that
  intentionally expose anonymous Sync must opt in with `syncAuth: 'public'`;
  startup observability and Platform Doctor report when the secure default is
  inherited so upgrades are explicit.
- Restored readable dark-mode contrast for warning badges in the admin-user
  security and auth-readiness surfaces, and added a reusable theme-aware
  `warning` Badge variant.
- Canonicalized auth email identities by trimming and lowercasing addresses
  across registration, administration, login, and password recovery while
  leaving usernames case-sensitive. Password-reset confirmations are now
  enumeration-safe, and privacy-safe requested, delivered, suppressed, and
  failed-delivery outcome events distinguish operational results without
  logging addresses, action tokens, or provider credentials.
- Made administrator-forced password gates delivery-only: setup/reset email
  must be accepted before Zero gates the account and revokes sessions, generic
  user updates cannot enable the gate, failed admin-created setup delivery
  rolls back the new account, and an explicit confirmed recovery action can
  clear an already-stranded gate for another user while invalidating sessions
  and outstanding links.
- Made reset/setup password completion atomic and sessionless. A successful
  action consumes its exact one-time link, saves the new password, clears the
  password gate, revokes existing sessions, clears browser auth state, and
  requires a fresh login, so later MFA delivery or session-signing failures
  cannot make a committed password change appear to have failed.
- Hardened email lifecycle readiness and failure cleanup. Sender/reply-to and
  Resend API-key environment fallbacks now contribute to real readiness,
  link-email capabilities additionally require a public app URL, rejected
  recipients fail closed, and undelivered reset/verification tokens plus email
  MFA challenges are removed so retries are not trapped behind silent
  cooldowns.
- Upgrade note: action links created before this hardening do not carry the new
  identity/generation binding and are rejected after upgrade. Resend any
  still-pending setup, reset, or verification email from the upgraded admin UI.
- Preserved authentication across browser refreshes and direct protected-page
  navigation with a revocable HttpOnly page session, while keeping APIs,
  mutations, server extensions, and sync strictly Bearer-authorized. Authenticated
  SSR now bypasses ISR and uses private/no-store response policy.
- Made locally linked `zero-new` projects typecheck cleanly by preserving
  package symlink boundaries in generated TypeScript configuration.
- Declared Elysia's required runtime peers in the framework package so fresh
  package-mode projects can run Doctor and start without missing-module errors.
- Changed local app creation to install a publish-style framework archive,
  preventing duplicate React runtimes and checkout-only file links in apps.
- Expanded package regression coverage to install a packed framework in a
  temporary outside-tree app, verify packaged docs, typecheck, and render SSR.
- Increased the package integration-test timeout for slower mounted filesystems.

## 1.3.0 - 2026-07-06

Framework-readiness release focused on package-mode development, safer app
composition, stronger auth flows, richer admin surfaces, and a Zero-driven
LaunchBoard reference app.

### Framework Distribution

- Added a stabilization plan focused on audit, docs, package-mode hardening,
  local app creation, and release readiness instead of new feature expansion.
- Added a root `README.md`, comprehensive canonical `llms.txt`, and `llm.txt`
  compatibility pointer so humans and agents have clear framework entry points.
- Improved `create-zero` with `--local`, `--install`, and `--template` support
  for unpublished framework development and local app initialization.
- Converted `scripts/create-project.sh` into a package-mode wrapper over the
  local `create-zero` flow instead of copying framework source into apps.
- Added package metadata and a package `files` allowlist that includes the
  source exports, package-mode starter, docs, README, agent guide, and
  changelog.
- Added `bun run test:package`, including a tarball smoke test that packs the
  framework, verifies the package-mode starter is included, extracts the
  tarball, and runs `create-zero` from the packed package.
- Expanded the generated app README with setup, project shape, canonical import
  examples, `.env.example` guidance, and the packaged docs location.
- Expanded `llms.txt` into a full agent-facing framework documentation bundle
  with setup, package mode, backend/frontend usage, built-in systems, UI rules,
  verification, and a complete docs catalog with descriptions for every docs
  Markdown file.
- Added Doctor source usage audit checks for app-owned frontend/backend code,
  including raw controls, custom modal/toast usage, direct backend provider
  bypasses, internal imports, backend `console` calls, and large-file
  responsibility warnings.
- Added `zero-doctor` local wrapper support for running the framework checkout's
  doctor from generated apps before the package is published.
- Reworked the package-mode starter into a blank app-owned project shape with
  server-rendered default layout/page files, empty schema/config defaults,
  app-owned `components/`, `hooks/`, `lib/`, and `server/resources/` folders,
  and no TypeScript fallback aliases into `@zero/framework/src`.
- Added `bun run install:local-tools` to install repeatable local `zero-new`
  and `zero-doctor` wrappers in `~/.bin`; `zero-new` can create a target
  folder or initialize the current directory while keeping Zero in
  `node_modules/@zero/framework`.

### Auth And Account Security

- Expanded the built-in auth lifecycle with configurable public/private
  registration, first-user admin bootstrap, email verification, password reset,
  setup-password, and branded account email flows.
- Added optional or enforced MFA support with email OTP and self-hosted TOTP
  authenticator methods, including enrollment, challenge, method storage,
  challenge persistence, and recovery-safe token handling.
- Split the auth implementation into smaller responsibility-focused plugins and
  services for sessions, runtime wiring, MFA, user properties, schemas, response
  mapping, and account email templates.
- Improved default auth screens with the platform layout, smoother transitions,
  subtle token-driven input focus states, animated icon behavior, email
  verification screens, MFA enrollment/challenge screens, and reset/setup
  password flows.
- Updated admin user management to support richer account lifecycle actions,
  user-property editing, admin promotion controls, and the newer auth contracts.

### LaunchBoard Reference App

- Reworked LaunchBoard into a package-mode reference app using root
  `zero.config.ts`, a thin `app/server.ts`, framework imports through
  `@zero/framework/*`, app-owned route files, and explicit resource
  registration.
- Added public registration defaults for LaunchBoard with first-user admin
  bootstrap, optional MFA, and email verification disabled by default for local
  demo use.
- Made LaunchBoard categories, boards, columns, and cards owner-scoped through
  resource policies, row-filtered sync, `owner_id` fields, and owner-aware
  mutation helpers.
- Removed seeded demo assumptions so new users start from clean empty states in
  the category switcher, sidebar, and board workspace.
- Added LaunchBoard table compatibility and owner-index helpers, then registered
  those indexed fields with Doctor so owner-filtered app data avoids noisy
  index warnings.
- Split LaunchBoard data code into focused type, utility, collection, and
  mutation modules so the reference app stays easier for agents to read and
  extend.

### Doctor And Runtime Guidance

- Added Doctor source usage audit checks for app-owned frontend/backend code,
  including raw controls, custom modal/toast usage, direct backend provider
  bypasses, internal imports, backend `console` calls, and large-file
  responsibility warnings.
- Added `doctor.indexedFields` app config so apps can document known indexes for
  policy-filtered fields without hard-coding every app table into the platform.
- Made Doctor resource-aware for sync policy checks so tables covered by
  registered resource policies are not reported as unprotected app sync tables.
- Improved Doctor output so info-only runs finish as completed reports rather
  than warning reports.
- Added tests for package exports, distribution packaging, scaffold behavior,
  Doctor usage audit checks, resource-aware sync policy reporting, and app
  config typing.

### Admin And Storage UI

- Improved storage management with richer drive detail surfaces, settings,
  permissions, auth-aware configuration helpers, bucket visibility, and clearer
  admin inspection paths.
- Expanded reusable admin data-management surfaces around master-detail state,
  data browsing, row detail views, and table-style platform UI composition.
- Improved AppShell sidebar behavior for empty workspace/category lists so
  users can still reach create actions without seed data.

### Docs

- Added and updated docs for package-mode apps, framework developer surfaces,
  LaunchBoard, auth architecture, MFA/email verification planning, Doctor usage
  audit rules, storage/admin surfaces, SDK imports, component inventory,
  platform configuration, release flow, and start-here guidance.
- Expanded `llms.txt` into the canonical agent-facing guide and docs catalog so
  agents can discover Zero APIs before creating duplicate app infrastructure.

## 1.2.1 - 2026-07-02

Patch release for the public frontend component lane and Zero website/demo
composition.

### Frontend Components

- Added reusable `CtaSection` and `FooterSection` public components with
  package exports, `@zero/framework/react` barrel exports, and `zero add`
  registry support.
- Improved `FeaturesSection` icon bullets so Zero animated icons trigger from
  feature-row hover instead of rendering as static decoration.
- Expanded `Faq` composition support with custom header/list class hooks and
  title-less layouts for pages that provide their own section heading.

### Public Demo And Docs

- Expanded the public component docs and examples around landing-page
  composition using Zero public sections, text effects, code blocks, FAQ, CTA,
  footer, and the public design-token lane.
- Polished the reusable footer layout with labeled navigation, CTA copy,
  resource/social links, responsive overflow-safe footer actions, and stronger
  full-width visual hierarchy.
- Updated public component docs, component inventory, framework surface docs,
  SDK reference, start-here guidance, package exports tests, and `zero add`
  copy coverage for the new frontend components.

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
