# Multi-tenant Auth Implementation Checklist

> Status: **the four-profile implementation is present in this unreleased
> candidate; final release verification and the open gates below are not yet
> complete**
>
> Last reviewed: 2026-09-29
>
> Scope: Zero core auth, Elysia integration, sessions, RBAC, data isolation,
> Sync, managed services, onboarding, packaged control UI, installed clients,
> migration, and release verification

This is the authoritative delivery checklist for the direction in
[Zero Auth Philosophy](./zero-auth-philosophy.md). The
[working design](./multi-tenant-sso-rbac-working-design.md) preserves the
architecture audit and rationale; it is not a frozen API contract. The
[auth/data-plane capability matrix](./auth-data-plane-capability-matrix.md)
names the enforcement owner, scope source, evidence, and trusted escape hatch
for every official access-surface family.

A checked item means implementation and focused evidence exist in this tree.
It does not mean a package has been released or that the final aggregate suite
has passed. Unchecked items are real work or verification gates. The final
section lists deliberately deferred capabilities so they cannot be mistaken
for silent behavior.

## 1. Compatibility and security foundation

- [x] Keep `auth: true` and existing auth objects compatible as
  `single/simple`; independently normalize `tenancy` and `authorization`.
- [x] Preserve global `users.role`, `admin`, `adminOnly()`, and
  `requireAdmin()` as the legacy global-administrator boundary for compatible
  routes and global-role mutation. Keep that boundary distinct from live
  application-permission authority projected by an advanced application role
  or Administration Organization membership: neither grants the other, and
  neither grants customer-tenant data access.
- [x] Install one app-local `AuthRuntime` and one `AuthorizationKernel`; make
  ambiguous legacy no-argument service access fail instead of selecting a
  random live app.
- [x] Use one typed request `access` facade and the shared serializable
  `AccessRequirement` across compiled endpoints/routers, file routes,
  resources, Sync, and managed services.
- [x] Merge parent and child authorization declarations monotonically; a child
  cannot weaken a protected layout/router/endpoint.
- [x] Reject protected multipart requests before body parsing for Zero-compiled
  endpoints/routers and expose the explicit early guard required by raw Elysia.
- [x] Close generic Sync access to private framework/auth tables and enforce
  service-owned row policy for synchronized framework rows.
- [x] Add the checked-in
  [auth/data-plane capability matrix](./auth-data-plane-capability-matrix.md),
  including `zero.unsafe`, raw Elysia, raw Sync, and direct database/service
  boundaries.
- [x] Keep all auth/control-plane tables internal and unavailable through raw
  client Sync.
- [x] Add `exposure: 'internal' | 'http' | 'sync' | 'all'` to the immutable
  server resource registry so realm, managed transport exposure, Sync loading,
  and action/discretionary policy are independent. Require an explicit choice
  in multi mode, keep omitted single-mode declarations compatible as `all`,
  enforce it in CRUD, `/api/data`, and Sync reads/mutations, and diagnose
  invalid or sync-only/lazy contradictions at startup and in Doctor.

## 2. Sessions, modes, and RBAC control plane

- [x] Implement all four profiles through the same identity/session system:
  `single/simple`, `single/advanced`, `multi/simple`, and `multi/advanced`.
- [x] Add durable parent sessions and bind browser refresh, page, access-token,
  and native authority to live account/session state.
- [x] Add tenant-bound browser/native sessions, identity-only selection
  continuations, membership list/select, and refresh-family-backed switching.
- [x] Make switching replace the session atomically, rotate/consume refresh
  authority, reject replay/concurrent exchange, and invalidate the old scope.
- [x] Transactionally bootstrap a fresh multi-mode installation with one
  protected `kind: 'administration'` organization, owner membership,
  applicable assignment, tenant-bound session, and global platform
  administrator; create customer organizations only afterward.
- [x] Keep ordinary post-bootstrap identity registration independent from
  tenant creation and tenant admission.
- [x] Implement the validated permission registry, app-declared static role
  templates, simple/advanced expansion through one evaluator, retained
  assignment history, protected ownership, and grant ceilings.
- [x] Implement `single/advanced` application-role administration with typed
  transport/client/hook and packaged `ApplicationAccessManagement` UI.
- [x] Implement active-tenant member list/add/update/remove, role assignment,
  suspension/reactivation, ownership transfer, typed client/hooks, and packaged
  member controls.
- [x] Keep tenant/application roles independent from the global platform role
  in persistence, authorization, APIs, and UI terminology.
- [x] Persist a bounded append-only authorization/control-plane audit with
  transactional local mutation events, redaction, retention, authorized
  tenant/platform query and export, strict browser parsing, hooks, and packaged
  viewer.
- [x] Keep durable auth audit distinct from general application activity: it
  does not claim page views, ordinary reads, arbitrary CRUD, request bodies, or
  a complete denied-attempt log.
- [x] Install migration `020`'s durable auth-authority revision and advance it
  transactionally for security-relevant account, session, tenant, membership,
  and role-assignment changes. Managed Sync runtimes sharing one file-mode
  SQLite database poll that revision and promptly revalidate their local
  sockets and managed ephemeral bindings instead of waiting for the periodic
  fallback.
- [x] Install migration `021`'s verified-domain join-request provenance fence;
  bind new evidence to its exact source/revision and leave pre-fence rows
  explicitly unbound until an applicant performs a fresh admission or generic
  resubmission.
- [x] Install append-only migration `022` and the matching current-runtime
  schema so all six public-auth admission flows are accepted without mutating
  migration `012`; preserve legacy rows/indexes, conceal tenant-only onboarding
  routes before admission in single mode, and cover migrated HTTP execution.
- [x] Install append-only migration `023` and the matching current-runtime
  `_auth_installed_profile` singleton. Serialize startup transitions, advance a
  monotonic profile generation/shared authority revision, fence stale runtimes,
  preserve multi/simple retained roles and live browser/native session families
  during simple-to-advanced adoption, fail atomically on invalid roles or
  pending provisioning, and reject reverse/tenancy-axis reinterpretation.
- [x] Install append-only migration `024`, persist the administration/customer
  tenant-kind discriminator, reconcile the protected bootstrap organization,
  and exclude it from customer discovery, lifecycle, domains, and data-plane
  use.
- [x] Install append-only migration `025` and persist server-owned MFA
  assurance across browser sessions and continuations, native authorization
  codes, and native refresh-session families. Leave legacy rows unassured
  rather than inventing proof, and require the normal setup/challenge step when
  live policy requires assurance.
- [x] Install append-only migration `026` and freeze each newly issued tenant
  invitation's effective tenant/application permission ceiling. Fail old
  snapshot-less pending invitations, corrupt/missing snapshots, retired roles,
  and later authority widening closed behind the non-enumerating invitation
  contract; allow only narrowing.
- [x] Install append-only migration `027` and the matching current-runtime
  `_auth_authorization_manifest` singleton. Fingerprint server-only
  permission/role semantics plus the framework evaluator version, require a
  monotonic explicit registry version for same-profile changes, reject
  rollback/corruption/implicit retained-role reactivation, system-audit
  changes, and fence stale runtimes through the shared authority revision.
- [x] Bound shared-file fanout/invalidation to runtimes sharing the relevant
  local file-mode SQLite plane. Fabric coordinates its actor-owned databases
  only within one app coordinator/root; independent roots, cross-host
  transports, application-owned caches, and RAM-only topic delivery require
  an explicit external coordination contract rather than implying unsafe
  support.

## 3. Managed data plane

- [x] Keep shared `defineTable()` declarations client-safe and author
  enforceable realm/action policy in server-only, schema-adjacent
  `defineResource()` modules.
- [x] Fail multi-mode startup for unclassified managed app tables, conflicting
  resource registrations, unsafe discriminator updates, and declared schema
  mismatches. After opening SQLite, require the configured resource key to be
  the actual table's sole primary key and each tenant discriminator to exist,
  be `NOT NULL`, and not be that primary key.
- [x] Warn when declared schema/index hints do not show a likely
  tenant-leading index; a natural `_identity` counts only when the tenant
  discriminator is its first field.
- [x] Server-stamp tenant scope on create and include scope/policy constraints
  in actual reads and final update/delete persistence boundaries. Server-owned
  realm/policy equality checks storage class plus `BINARY` value equality so
  column affinity or collation cannot broaden authorization; caller filters
  retain their declared query semantics and only narrow the exact boundary.
- [x] Enforce the same registered-resource policy in generated CRUD,
  `/api/data`, Sync snapshot/catch-up/live delivery, mutations, and mutation
  receipts.
- [x] Allocate change sequences transactionally in SQLite and, in file mode,
  relay other connections' retained changes through every runtime's ordinary
  Sync policy/fanout path. Suppress local duplicates and close sockets for a
  clean snapshot when a replica falls behind retained history.
- [x] Bind socket authority to identity/scope and relevant
  session/membership/tenant/assignment generations; reject stale or guessed
  cross-tenant access.
- [x] Tenant-scope Storage HTTP routes, request facade, metadata, grants,
  signed URLs, uploads, browser upload transport, and cached Storage hooks.
- [x] Tenant-scope notifications/receipts and room
  discovery/membership/messages with live advanced-RBAC manager projection.
- [x] Tenant-scope State Sync and managed ephemeral/presence/room topic
  namespaces; custom raw topics remain app-policy work.
- [x] Tenant-scope workflow instances/steps/events and preserve a sealed actor
  or explicit system authority across async dispatch, retry, recovery, wait,
  and final commit with live revalidation.
- [x] Give managed request handlers scoped `zero.storage`,
  `zero.notifications`, `zero.rooms`, `zero.workflows`, `zero.pdf`, and
  observability emitters; require explicit `zero.unsafe` for raw DB/SQL,
  auth-store/token, KV/vector/scheduler, and setup/service access.
- [x] Deny unscoped/raw capabilities inside strict workflow handlers; require
  `runAsSystem()` to name a trusted principal, reason, and server-derived scope.
- [x] Validate required tenant-leading indexes against actual SQLite index
  metadata, plus tenant-aware composite uniqueness and tenant-consistent
  parent/child foreign keys between registered tenant resources before
  advertising the managed schema guarantee. Partial indexes do not satisfy the
  leading-index gate; direct SQL and unregistered tables remain trusted app
  code.
- [x] Define and implement one immutable field allow-list contract across CRUD,
  `/api/data`, Sync snapshot/catch-up/live/ack projection, filters/sorts,
  lazy/full caches, packaged forms, and cache-backed exports. Policy/realm
  columns remain available internally; protected fields never leave managed
  transports or enter managed client mutations.

## 4. Onboarding, browser boundary, and packaged UI

- [x] Implement configured tenant creation with transactionally protected
  initial ownership, including onboarding-required and multi-membership auth
  completion states.
- [x] Implement hashed one-time expiring exact-email invitations, fixed
  grantable roles, manual/email delivery, invitation-bound account creation,
  atomic acceptance/reactivation, and durable delivery safety.
- [x] Implement retained join requests with idempotent submission,
  approve/deny/reactivation rules, reviewer grant ceilings, and race-safe
  membership creation.
- [x] Implement opt-in verified-company-domain onboarding end to end: strict
  normalization, exact DNS proof, current mailbox proof, opaque continuations,
  non-enumerating discovery, fixed-role request-to-join, review through the
  existing join service, and packaged browser controls.
- [x] Implement verified-domain owner release with claim/policy revision
  fencing, exact-domain confirmation, immutable provenance, derived-request
  cancellation/quarantine, and seven-day cross-tenant quarantine.
- [x] Keep verified-domain v1 request-to-join only. It does not autojoin,
  create a new identity, infer aliases/subdomains, or transfer a claim directly
  to another tenant.
- [x] Replace scattered account-gate branching with the typed auth flow
  continuation used by login, registration, verification, MFA, tenant
  selection, creation, invitations, and onboarding-required states.
- [x] Implement one credential-owning browser path for typed Eden, ordinary
  fetch, multipart/progress XHR, restoration, refresh/retry, and Sync.
- [x] Fence browser work by authorization epoch: abort or reject late response
  bodies/uploads/mutations, purge synchronized and cached state, reset global
  overlays, and remount/reload the protected app subtree when committed scope
  changes.
- [x] Coordinate refresh and tenant switches across tabs without allowing an
  old response or refresh family to overwrite the committed session.
- [x] Ship strict browser authorization snapshots, hooks, permission/tenant/
  platform visibility gates, and synchronous old-scope masking.
- [x] Ship adaptive registration/auth continuation, tenant selection/creation,
  `TenantSwitcher`, the shared `useTenantAppShellWorkspaces` adapter,
  member/role management, invitation/join review, domain
  administration/onboarding, application access, and audit viewer components.
- [x] Ship the protected Administration Organization and customer-tenant
  control plane end to end: bounded routes, strict browser parser/SDK, stale
  scope fencing, `usePlatformAdministration`, `usePlatformTenants`,
  capability-driven people/invitation/lifecycle UI, and read-only customer
  member drill-in.
- [x] Hide advanced role controls in simple mode and keep global identity
  management separate from tenant membership controls.
- [x] Exercise packaged platform controls with automated render/policy checks
  for simple/advanced role cardinality, labels/descriptions, alerts/live
  regions, busy/disabled states, focus restoration hooks, empty/loading/error
  states, and responsive-safe markup.
- [ ] Complete real-browser keyboard, focus, screen-reader/live-region,
  reduced-motion, responsive/touch, and tenant-switch state-leak acceptance for
  the full packaged control surface.

## 5. Installed clients

- [x] Implement the TypeScript `@zero/framework/native` OIDC/PKCE client,
  broker, secure-vault boundary, rotating sessions, authenticated fetch, Sync
  bridge, and tenant list/switch contract.
- [x] Keep PKCE verifiers, callback validation, refresh credentials, and
  arbitrary authenticated fetch authority inside the credential-owning native
  process/broker.
- [x] Maintain functional Rust/Tauri and Chrome MV3 implementations as
  independent ignored private `0.0.0` preview repositories, not framework
  package contents or updater inputs.
- [ ] Before publishing either preview, choose ownership/version/license,
  freeze the shared wire/conformance contract, test real host-platform secure
  storage/callback/lifecycle behavior, and complete an independent security
  review.

## 6. Final release verification

Do not convert this candidate into a public support claim until every
applicable item below is complete.

- [ ] Resolve and encode the project license and minimum supported Bun version.
- [x] Finish the resource index/constraint contract above with actual SQLite
  startup validation, static Doctor guidance, focused unsafe/safe index,
  uniqueness, and foreign-key evidence, and matching public documentation.
- [ ] Run the focused auth, RBAC, domain, audit, resource, Sync, built-in
  service, workflow, browser-boundary, component, migration, and runtime
  isolation suites from the frozen final tree.
- [ ] Run `bun run typecheck`, `bun run build`, `bun run test:package`, the full
  `bun run test --timeout 120000`, `bun audit`, and `git diff --check` from that
  same tree.
- [ ] Audit the documentation against the final public SDK/auth contracts and
  run deterministic local-link, GitHub-style anchor, and code-fence checks from
  that same tree.
- [ ] Pack and install the frozen candidate outside the repository; migrate a fresh
  package-mode database through the latest numbered migration and smoke all
  four auth profiles. The installed-tarball smoke must apply migrations `001`
  through `027` to fresh file databases, verify the complete six-flow public
  auth-admission schema and installed-profile authority triggers, then boot and
  bootstrap every
  `single|multi` by `simple|advanced` combination, verify its live
  authorization scope, and reopens the database to prove the profile state
  persisted.
- [ ] Repeat package verification from a clean checkout so untracked files
  cannot make the tarball pass accidentally.
- [ ] Run the documented non-destructive updater smoke against a disposable
  app; Zero must not overwrite app source/config/data or run migrations.
- [ ] Obtain maintainer sign-off that freezes the now-audited
  supported/preview/deferred wording across README, Start Here, SDK/reference,
  auth, resource, Sync, and generated-app docs.

The earlier 2026-09-28 working-tree pass predated the Administration
Organization and migrations `024` through `027`. Its aggregate counts remain
historical
evidence only; the focused and aggregate release gates above must be rerun from
the frozen final tree.

## Deliberately deferred capabilities

These items are not implied by multi-tenancy and are not being silently worked
around. They need a separate product/security contract before implementation:

Field-level policy is no longer in this deferred list: registered resources
support immutable `read/create/update/filter/sort` allow-lists across managed
CRUD, `/api/data`, Sync, caches, and packaged form/export projections. Direct
SQL, unregistered tables, custom endpoints, and application-owned exports stay
trusted application code and must apply their own projection and write rules.

- [ ] **Upstream enterprise SSO.** Tenant-bound enterprise OIDC, then optional
  SAML/SCIM and group mapping, remain separate from Zero's implemented native
  OIDC provider for installed apps.
- [ ] **Break-glass/support elevation.** No time-bound impersonation or tenant
  data elevation is implemented.
- [ ] **Tenant-custom roles.** The current model uses app-declared static role
  templates with durable simple/advanced assignments.
- [ ] **Distributed replica coordination.** File-mode runtimes sharing one
  SQLite database now receive durable row fanout and auth/session invalidation.
  Separate databases, cross-host messaging, `hot`/`ephemeral` runtime state,
  application-owned caches, and a cross-runtime ephemeral/presence topic bus
  still need an explicit external coordination contract.
- [ ] **General populated-app adoption tooling.** Fresh multi-mode installs and
  the exact pre-024 Administration Organization reconciliation path are
  supported by the candidate; existing production data still needs an explicit
  backup/dry-run/backfill/validation/cutover workflow before enabling multi or
  changing the tenancy axis.
- [ ] **Verified-domain autojoin, aliases/wildcards/subdomain inheritance, and
  direct transfer.** Current admission is exact-domain request-to-join; release
  plus quarantine and a new proof is not transfer.
- [ ] **Tenant-per-database storage.** Per-tenant SQLite/Turso-style isolation
  is future persistence work, not part of this auth release candidate.

## Definition of shipped

The implementation documented here is an unreleased candidate. A profile is
shipped only after the applicable unchecked release gates pass, maintainers
freeze its documented boundary, the exact release commit passes clean-checkout
package verification, and a version is published. Source presence, a checked
focused feature box, or a local green test is not by itself a release.
