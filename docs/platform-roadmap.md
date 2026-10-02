# Zero Product Roadmap

This is the canonical living roadmap for Zero. It records product direction,
open work, and longer-horizon ideas without assigning dates or implying a fixed
delivery order. It is not an API contract, a release checklist, or evidence
that an unchecked capability exists. Use [Start Here](./start-here.md), the
[SDK Reference](./sdk-reference.md), and [Releasing Zero](./releasing.md) for
current behavior and release support.

Zero is being built as an agent-first, full-stack application platform that
also remains understandable to human developers. The intended experience is
declarative where that removes repetitive work, explicit where security or
operations demand it, and composable from the database through the UI.

## How to use this roadmap

- `[x]` means an implemented and documented Zero system or supporting foundation
  exists on the current development line. It does not by itself mean that every
  optional extension has been built or that the capability has been included in
  a public release.
- `[ ]` means the roadmap item is incomplete. It may be planned, partially
  implemented, dependent on an external project, or still under design.
- Each open product item is labeled **Core**, **Official plugin**,
  **Component pack**, **CLI and SDK**, or **Research** to describe its likely
  product shape. **Core or official plugin** means that boundary is an explicit
  design decision still to be made.
- The order of tracks and items is not a delivery sequence.
- Check an item only after implementation, tests, current documentation, and
  any necessary upgrade path are complete.

New ideas can be added without first deciding their priority. During roadmap
grooming, combine duplicates, connect the idea to existing Zero systems,
and identify the smallest coherent product boundary.

## Product principles

- **Agent first and human clear.** APIs, schemas, configuration, diagnostics,
  and documentation should be easy for coding agents to discover and safe for
  developers to inspect.
- **Declarative without hidden behavior.** Configuration should remove wiring,
  not conceal expensive work, authority decisions, persistence, or failure.
- **Composable by default.** New systems should fit the existing Elysia plugin,
  service, SDK, hook, component, and configuration boundaries.
- **Secure across every transport.** Guardian permissions and Fabric tenant
  isolation must remain authoritative across HTTP, Sync, GraphQL, MCP,
  webhooks, background work, and administrative UI.
- **Reactive where it matters.** Features should use ReactiveDB, state sync,
  rooms, notifications, and Torrent rather than inventing competing realtime
  or orchestration systems.
- **Polished as a complete product.** Official capabilities include accessible
  UI, design tokens, errors, observability, tests, documentation, and examples;
  they are not finished when only the backend exists.
- **Additive when practical.** Existing applications should keep working when a
  capability is optional. Intentional breaking changes require a clear
  migration and compatibility story.

## Current platform systems

These are implemented Zero systems, not aspirational placeholders. Open items
later in the roadmap extend or compose them; they do not imply that the current
system is merely a prototype. Their exact contracts and release limits live in
the linked documentation.

- [x] **ReactiveDB and realtime state** form Zero's complete application data
  and synchronization system, including ReactiveDB, HTTP resources, Sync,
  persistent state, rooms, presence, notifications, and reactive hooks. See the
  [Platform Overview](./platform-overview.md).
- [x] **ReactiveDB Fabric** is Zero's multi-database system for actor-backed
  isolation, tenant routing, concurrent database operation, placement,
  lifecycle, and realtime delivery. See the
  [Multi-Database Architecture](./framework/multi-database-architecture.md).
- [x] **Guardian** is Zero's authentication and authorization system for all
  four tenancy and permission profiles, administration, onboarding, MFA, API
  keys, audit, browser sessions, and installed-app authentication. See
  [Guardian](./auth/README.md).
- [x] **Torrent** is Zero's durable workflow system, including immutable
  versions, graph execution, conditional and parallel work, mapped arrays,
  memory, interactions, retries, recovery, authority, and realtime progress.
  See [Durable Workflows](./workflows.md).
- [x] **Storage and file management** provide drives, policies, signed
  operations, uploads, downloads, file and drive administration, and a packaged
  browser. The roadmap's Finder-grade item is an advanced experience pass over
  this existing system, not a proposal to create file storage from scratch. See
  [Storage](./sdk-reference.md#storage).
- [x] **Observability** provides stable event codes, backend and frontend sinks,
  bounded queryable storage, protected access, tracing, and standard emission
  boundaries. OpenTelemetry and analytics items below expand this system. See
  [Observability](./observability.md).
- [x] **AI and vector search** provide provider abstraction, tools,
  conversations, streaming, usage events, local vector indexes, scoped search,
  and an embedding bridge. Schema automation and packaged AI chat UI are
  optional layers on top. See [AI](./ai.md) and [Vector Store](./vector.md).
- [x] **Forms and application UI** provide schema-driven and custom forms,
  wizards, draft state, tables, adaptive administration controls, storage UI,
  application shells, public components, and a tokenized design system. The
  roadmap focuses on richer composition and polish. See the
  [Component Inventory](./frontend/component-inventory.md).
- [x] **Communications and collaboration** provide rooms, presence, typing,
  durable in-app notifications, and a provider-based email system. Proposed
  chat and channel plugins add packaged domain behavior to these complete
  services rather than replacing them. See the
  [Platform Overview](./platform-overview.md#rooms--collaborative-spaces).
- [x] **Platform services and tooling** include platform tokens, atomic KV, PDF,
  migrations, Doctor, package-mode tooling, `llms.txt`, canonical imports, and
  focused subsystem documentation. See the [System Map](./system-map.md).

## Public launch anchors

- [ ] **Markdown-first documentation plugin** — **Official plugin**. Turn a
  documentation folder into a polished site with minimal configuration, then
  use it to power Zero's own public documentation.
  - Generate routes, navigation, table of contents, search, metadata, and
    sitemap entries.
  - Support code examples, callouts, versioned content, extensible page
    components, and an intentional upgrade path for changed documents.
  - Evaluate established documentation experiences such as the previously
    discussed Astro or Starlight-style approach without unnecessarily coupling
    Zero to one implementation.
  - Dogfood the result on Zero's documentation before calling it complete.
- [ ] **Public package and release gates** — **Core**. Complete the license,
  supported runtime and deployment matrix, clean-package verification, and
  publication requirements tracked in [Releasing Zero](./releasing.md).
- [ ] **Agent onboarding review** — **Core**. Ensure a new coding agent can
  discover current capabilities, choose supported extension points, and build a
  production-shaped app without relying on historical plans or private context.

## Documentation and agent development

- [ ] **MCP gateway** — **Official plugin**. Provide a secure way for Zero apps
  to expose and consume MCP tools.
  - Define application-managed, tenant-managed, and user-authorized tools.
  - Reuse Guardian identity and authorization, including API-key or installed-
    app flows where appropriate.
  - Include rate limits, secrets, audit history, transport policy, tool
    discovery, and observable failures.
  - Keep remote tools behind the same authority boundaries as ordinary Zero
    routes and services.

- [ ] **Machine-readable capability catalog** — **CLI and SDK**. Make Zero's
  components, hooks, services, schemas, routes, plugins, examples, and common
  assemblies queryable by agents and developer tools.
  - Generate the catalog from real exports and metadata so it cannot quietly
    drift from the package.
  - Connect it to Doctor, documentation, scaffolding, and future MCP tools.
  - Carry forward the useful parts of the original component-registry and
    assembly-system ideas without inventing a second API surface.

- [ ] **Agent workflow integrations** — **Research**. Evaluate focused Codex,
  Claude Code, and other coding-agent hooks that can run Doctor, inspect the
  capability catalog, scaffold supported patterns, and verify changed files.

## Configuration and plugin architecture

- [ ] **Focused declarative configuration** — **Core**. Evolve the mature typed
  `zero.config.ts` model so large applications can organize settings without
  making small applications verbose.
  - Evaluate focused configuration modules and the previously discussed
    Hydra-like organization while preserving ordinary typed TypeScript.
  - Define predictable precedence among defaults, project configuration,
    environment values, plugin namespaces, and deliberate runtime overrides.
  - Expose effective configuration, validation, and actionable Doctor findings.
  - Keep security-sensitive settings explicit and server-only.

- [ ] **Full-stack plugin authoring contract** — **Core**. Make official and
  third-party plugins easy to build, install, configure, document, and remove.
  - Cover Elysia controllers, framework-independent services, configuration,
    schema and migrations, Guardian policy, Fabric placement, Torrent
    activities, SDK methods, hooks, components, and lifecycle cleanup.
  - Define package metadata for Doctor and agent discovery.
  - Provide a scaffold and reference plugin that demonstrates the complete
    contract without forcing every plugin to implement every layer.
  - Keep plugin errors and operational events inside Zero's standard error and
    observability boundaries.

- [ ] **Server-only project profile** — **CLI and SDK**. Add an explicit mode
  for Zero servers that do not ship a React application.
  - Start with single-tenant database mode and support simple permissions plus
    advanced RBAC.
  - Define secure administrative bootstrap, service authentication, user and
    service API keys, HMAC policy where selected, and headless operations.
  - Avoid building browser assets or requiring frontend packages at runtime.
  - Leave room for a later multi-tenant server-only profile without making it a
    prerequisite for the first useful release.

## Guardian security and compliance

- [ ] **External OAuth plugin integration** — **Official plugin**. Bring the
  OAuth project and its supporting libraries into the documented Zero
  ecosystem.
  - Audit it against current Guardian identity, account-linking, MFA, audit, and
    authorization contracts.
  - Verify Fabric tenancy, system and application database separation, live
    RBAC, package exports, and migration behavior.
  - Make the plugin discoverable to developers and agents without confusing
    upstream social login with Zero's existing installed-app OIDC and PKCE
    provider.

- [ ] **Authentication provider ecosystem** — **Official plugin**. Add focused
  providers and policies without bloating Guardian core.
  - Consider social OAuth, enterprise SSO, passkeys, CAPTCHA and bot controls,
    and other authentication methods as separate composable capabilities.
  - Share account-linking, audit, error, session, and tenant-selection behavior
    instead of reimplementing it per provider.

- [ ] **Network access policy** — **Core**. Generalize IP allow and deny rules
  beyond login.
  - Support deliberate policy at application, administration, tenant, user,
    session, API-key, and service-route boundaries where each scope makes sense.
  - Define proxy trust, IPv4 and IPv6 normalization, policy precedence, audit,
    lockout recovery, and alternate-transport enforcement.
  - Keep policy declarative, observable, and impossible to bypass through Sync,
    GraphQL, MCP, or other official transports.

- [ ] **Compliance support packages** — **Official plugin**. Explore focused
  control and evidence packs, beginning with HIPAA-oriented deployments.
  - Treat these as secure defaults, policy templates, checks, evidence tooling,
    and responsibility maps—not a claim that installing a package makes an
    application compliant.
  - Consider retention, access review, audit export, incident evidence,
    encryption configuration, legal holds, archival custody, and deployment
    boundaries.
  - Require specialist review before presenting a regime-specific package as
    production guidance.

## User interface and application building

- [ ] **Modal manager redesign** — **Core**. Harden the existing modal manager
  rather than creating a competing system.
  - Reserve a safe close-control lane so the close button cannot overlap
    application content.
  - Add consistent header, description, body, section, scrolling, and action
    regions with responsive and full-screen behavior.
  - Preserve focus management, accessible labeling, keyboard behavior, nested
    modals, animations, and programmatic control.
  - Review existing Zero applications and provide compatibility helpers or a
    concise migration guide for unavoidable layout changes.

- [ ] **Autosave audit and shared contract** — **Core**. Start by auditing the
  existing Zero mechanisms and the production app that already provides an
  excellent autosave experience.
  - Determine whether that app uses `useFormDraft`, state sync, an application
    resource, app-owned code, or a combination, and preserve the behavior that
    is already working well.
  - If the successful implementation is already powered by Zero, document and
    productize the missing configuration, helpers, and UI states instead of
    replacing it. If it is app-owned, upstream only the reusable contract and
    keep domain-specific policy in the app.
  - Make the resulting contract reusable by ordinary forms and rich editors
    without forcing existing applications to rewrite proven implementations.
  - Autosave must not steal focus, move the cursor, reset selections, or create
    disruptive loading states.
  - Cover debounce, explicit flush, revisions, conflicts, retries, offline or
    reconnect behavior, navigation protection, and saved or failed status.
  - Support local, authenticated state, application resource, and resumable
    public-flow adapters without weakening server-side validation.
  - Continue the richer form blueprint work in
    [Forms](./frontend/forms.md) rather than creating an unrelated form API.

- [ ] **Visual form builder** — **Research**. Explore a GUI builder over the
  declarative form blueprint after the underlying sections, conditional logic,
  widgets, drafts, uploads, consent, and versioning contracts are stable.

- [ ] **Application administration blocks** — **Component pack**. Continue
  expanding polished, adaptive administration UI.
  - Cover common app settings, users, roles, permissions, API keys, services,
    audit, and operational status.
  - Provide tenant-aware variants for organization owners and delegated
    administrators.
  - Adapt to configured Guardian mode and the current viewer's authority rather
    than multiplying disconnected control panels.

- [ ] **Public website component expansion** — **Component pack**. Improve
  Zero's landing-page, marketing, onboarding, pricing, content, and public-flow
  sections while preserving design-token customization.

- [ ] **Curated component review** — **Research**. Review the saved Raindrop or
  bookmark collection for components worth adapting.
  - Prioritize document readers, document editors, and meaningful gaps in the
    current component inventory.
  - Check licensing, accessibility, performance, maintenance, theming, and
    Zero integration before adoption.
  - Record whether each candidate belongs in core, a component pack, an
    official plugin, or nowhere in Zero.

## Content editing and publishing

- [ ] **Rich document editor** — **Official plugin**. Compare Tiptap, Milkdown,
  and any clearly superior alternative before choosing a foundation.
  - Support the right balance of structured rich text and Markdown, extension
    points, attachments, collaboration, and non-disruptive autosave.
  - Reuse Zero Storage, Guardian policy, ReactiveDB, and state or room
    primitives where they genuinely help.
  - Package a polished reader and editor rather than exposing a thin third-party
    wrapper.

- [ ] **Blogging and publishing** — **Official plugin**. Build on the existing
  blogging UI and the future shared content engine.
  - Cover drafts, authors, roles, tags, media, previews, scheduling, feeds,
    metadata, and publishing workflows.
  - Reuse the documentation, editor, Open Graph, storage, and Torrent
    capabilities instead of maintaining parallel implementations.

- [ ] **Open Graph and structured metadata** — **Official plugin**. Expand the
  router's current title and description handling into one reusable metadata
  strategy.
  - Consider canonical URLs, robots, Open Graph and social cards, JSON-LD,
    inheritance, caching, and generated social images.
  - Make documentation, blogging, landing-page, and application routes share
    the same primitives.

## Collaboration and communications

- [ ] **Calendar and scheduling** — **Official plugin**. Use the previously
  built FullCalendar UI as a design and behavior reference.
  - Support an internal Google Calendar-like experience with realtime events,
    recurrence, availability, resources, time zones, reminders, and permission
    policy.
  - Evaluate an optional public Calendly-like booking experience.
  - Decide through design work whether internal calendar and public scheduling
    are two modes of one plugin or cooperating packages.

- [ ] **Tenant-aware chat** — **Official plugin**. Build a complete messaging
  product on Zero's existing rooms, presence, typing, notifications, storage,
  and realtime data foundations.
  - Cover direct and group conversations, threads, reactions, receipts,
    attachments, search, retention, moderation, and unread state.
  - Consider an embeddable public support-chat widget with a deliberately
    narrower security boundary.
  - Treat audio and video calling as an optional later WebRTC extension, not a
    requirement for the first useful chat release.

- [ ] **Communication provider adapters** — **Official plugin**. Expand the
  current email provider boundary and in-app notifications.
  - Add SMTP and selected transactional email providers.
  - Evaluate SMS, mobile push, and web push behind clear channel interfaces.
  - Standardize templates, preferences, tenant configuration, delivery state,
    retries, idempotency, and failures.

## Storage and file experiences

- [ ] **Finder-grade file browser** — **Component pack**. Expand the existing
  `StorageFileBrowser` and storage administration surfaces rather than
  replacing them.
  - Add polished grid and list modes, bulk selection, keyboard interactions,
    drag and move, richer previews, recent, favorite and shared views, and
    document-reader or editor integrations.
  - Preserve drive policy, signed operations, Guardian permissions, and Fabric
    tenant boundaries.
  - Keep the same surface useful as a full manager and as an embedded file
    picker.

## Observability analytics and AI economics

- [ ] **Durable observability store and viewer** — **Core**. Extend Zero's
  existing event codes, backend and frontend sinks, fan-out adapters, protected
  ingestion, query endpoint, tracing, and app-bound runtime with a first-party
  persistent store.
  - Use the same managed database-plane architecture as Fabric. A dedicated,
    pinned observability service database is the preferred default so logs stay
    outside the application and Guardian databases without paying actor IPC and
    durable idempotency-receipt overhead for every event.
  - Decide explicitly between one centrally queryable service database with
    tenant-scoped records and optional actor-owned, physically isolated tenant
    log databases; do not scatter logs across tenant files by accident.
  - Add queued or batched writes, retention, compaction, backpressure or drop
    accounting, and bounded shutdown drain. If actor-owned stores are supported,
    evolve the current synchronous readable-store contract for asynchronous
    queries rather than hiding them behind a synchronous adapter.
  - Prevent recursive logging when the observability database or its Fabric
    actor emits operational events. Provide a bounded fallback path for failures
    inside the durable sink itself.
  - Apply recursive redaction, payload bounds, retention policy, and explicit
    application, tenant, user, request, and trace attribution before persistence.
  - Build an optional protected viewer over the store with filtering, live
    refresh, detail inspection, export, and role-aware platform or tenant scope.
  - Add common HTTP, file, Sentry, and OpenTelemetry export adapters where they
    fit the existing sink contract.
  - Keep operational observability distinct from Guardian security audit and
    product analytics while allowing intentional correlation.

- [ ] **Product analytics foundation** — **Official plugin**. Explore useful,
  privacy-conscious application analytics without trying to clone every
  specialist analytics platform.
  - Consider visitor and session counts, events, funnels, referrers, retention,
    and optional heat maps.
  - Define consent, sampling, redaction, retention, tenant isolation, and export
    boundaries before collecting data.
  - Provide reusable administrative UI only after the event and aggregation
    model is sound.

- [ ] **AI token and cost accounting** — **Core**. Expand existing AI lifecycle
  telemetry into reliable usage accounting.
  - Aggregate provider-reported usage and effective-dated pricing at
    application, tenant, user, model, and feature scope.
  - Distinguish app-funded calls from bring-your-own-key usage.
  - Support reusable operator and tenant UI, coverage indicators, export, and
    explicit handling when a provider omits usage fields.

## AI interfaces and intelligent data

- [ ] **AI chat interface package** — **Component pack**. Adapt useful Prompt
  Kit patterns or another suitable foundation after a licensing review.
  - Rework the UI around Zero design tokens and component conventions.
  - Cover streaming, tool activity, reasoning disclosure policy, citations,
    attachments, cancellation, retries, errors, and conversation navigation.
  - Connect cleanly to Zero AI conversations, tools, `StreamingText`, storage,
    and optional persisted conversation data.

- [ ] **Schema-declared AI behavior** — **Research**. Explore explicit schema
  metadata for managed embeddings, classification, extraction, or related AI
  work.
  - Make provider, model, cost, trigger, retry, reprocessing, migration, and
    failure behavior visible rather than magical.
  - Build on the existing vector store and AI bridge.
  - Keep generated background work observable and tenant-safe through Torrent
    and Fabric.

## APIs search and integrations

- [ ] **Inbound and outbound webhook registry** — **Core or official plugin**.
  Implement the layered design in [Webhooks](./webhooks.md).
  - Cover raw-body-safe verification, endpoint registration, signing, secret
    rotation, event filtering, durable retries, idempotency, delivery history,
    replay, dead letters, permissions, and tenant scope.
  - Integrate durable delivery with Torrent while keeping business events
    distinct from observability logs.
  - Decide the core-versus-plugin boundary before freezing the public API.

- [ ] **Full-text search** — **Core or official plugin**. Determine whether an
  explicit SQLite FTS layer is needed alongside semantic vector search.
  - Evaluate indexing, ranking, highlighting, snippets, schema integration,
    ReactiveDB updates, Fabric placement, migrations, and tenant isolation.
  - Prefer SQLite's native capability when it satisfies the product contract;
    do not create a second indexing service without a concrete need.
  - Finish with either a supported implementation or clear documentation of
    the recommended existing approach.

- [ ] **GraphQL layer** — **Official plugin**. Explore a typed GraphQL surface
  only where it adds value beyond Zero's current typed APIs.
  - Enforce Guardian, resource policy, Fabric routing, field visibility, and
    rate limits inside resolvers rather than creating an authority bypass.
  - Map subscriptions to ReactiveDB and Sync rather than building a competing
    realtime engine.
  - Evaluate explicit vector and semantic-search resolvers without coupling the
    vector store to GraphQL.

## Billing payments and commerce

- [ ] **Billing and payments** — **Official plugin**. Create a provider-neutral
  foundation for user and tenant billing.
  - Cover customers, subscriptions, plans, entitlements, invoices, credits,
    account status, late-payment policy, cancellation, and reactivation.
  - Integrate entitlements with Guardian roles and permissions without making a
    payment provider the authorization authority.
  - Use Torrent for durable lifecycle work and the webhook registry for provider
    events.
  - Provide configurable administrative and tenant-facing components.

- [ ] **Commerce extensions** — **Research**. Consider products, orders,
  checkout, tax, fulfillment, and broader e-commerce only after the billing
  foundation has a clean boundary.

## Desktop packaging

- [ ] **Zero desktop command** — **CLI and SDK**. Package a compatible Zero web
  application as a desktop application, likely with Tauri.
  - Keep this distinct from the existing native authentication SDKs.
  - Reuse Guardian's system-browser authentication and never ship server
    secrets inside the desktop bundle.
  - Cover development, host-bridge policy, configuration, platform permissions,
    packaging, signing, updates, and release documentation.
  - Aim for an existing compatible app to opt in without restructuring its core
    Zero application code.

## Longer horizon explorations

- [ ] **Sketch-to-app workbench** — **Research**. Revisit the original idea of
  turning a visual sketch and natural-language brief into a live Zero app that
  uses real components, realistic related data, and iterative previews.
- [ ] **Agent assembly system** — **Research**. Build tested, machine-readable
  assemblies for common app shapes after the capability catalog and plugin
  contracts are stable.
- [ ] **Deployment and hosting experience** — **Research**. Explore container
  export, health and migration policy, observability, custom domains, TLS, and
  rollback without weakening Zero's ability to run on ordinary infrastructure.
- [ ] **Advanced application components** — **Component pack**. Continue
  evaluating richer data grids, timelines, trees, galleries, diff and JSON
  viewers, import flows, dashboards, and other high-value assemblies against
  real application needs.

## Shared completion standard

Unless an item deliberately narrows its scope, it is complete only when the
relevant parts of this checklist are satisfied:

- [ ] The product boundary, non-goals, and relationship to existing Zero
  capabilities are documented before implementation.
- [ ] Public APIs and configuration are typed, small, intuitive, and reviewed
  for backward compatibility.
- [ ] Backend code follows the Elysia controller, service, store, and adapter
  separation in [Engineering Standards](./engineering-standards.md).
- [ ] Guardian identity and authorization are enforced server-side on every
  supported transport.
- [ ] Fabric routing, database-plane ownership, tenant isolation, and lifecycle
  behavior are covered where the feature stores tenant data.
- [ ] ReactiveDB, Sync, state, rooms, notifications, or Torrent are reused where
  they own the needed behavior.
- [ ] Stable Zero error codes, safe messages, structured operational events,
  and standard observability sinks cover meaningful failures and lifecycle
  events.
- [ ] Frontend surfaces are accessible, responsive, built from Zero components,
  and use design tokens rather than one-off visual systems.
- [ ] Unit, integration, concurrency, recovery, security, browser, and package
  tests are included in proportion to the feature's risk.
- [ ] Current reference docs, examples, `llms.txt`, Doctor, and agent discovery
  surfaces are updated together.
- [ ] Existing applications have an explicit compatibility, migration, or
  opt-in story.
- [ ] At least one production-shaped example proves the complete path rather
  than only isolated APIs.

## Idea inbox

Future ideas do not need to arrive fully designed. Add the raw idea here or
send it for roadmap grooming. The next pass should remove duplicates, identify
the existing Zero system, assign a likely product shape, and move the result
into the appropriate capability track without inventing a delivery date.
