# System Map — File Locations & Architecture

This document maps every system to its files, explains how the documentation is structured, and serves as a navigation guide for working on the platform.

---

## Documentation Structure

```
docs/
  platform-overview.md     <- What the platform does, all features, DX examples
  system-map.md            <- THIS FILE — where everything lives, how to navigate
  bootstrap-prompt.md      <- Prompt to give Claude in a new conversation
```

The codebase itself is the source of truth. These docs provide orientation — read them first, then dive into the code.

---

## Directory Layout

```
src/
  databases/               <- ReactiveDB Fabric actors, coordinator, isolation, receipts, tenant Sync
  persistence/             <- SQLite modes, snapshots, checkpoints, connection ownership
  resources/               <- Declarative Resource registry, policy, CRUD, field access, realms
  sync/                    <- Core engine: ReactiveDB + WebSocket sync + state sync + ephemeral KV
  sync/client/             <- Client-side sync: stores, clients, React hooks
  auth/                    <- Authentication: identity facade, focused stores, sessions, tenancy, RBAC, middleware
  auth/native/             <- Native public-client config, redirect, PKCE, and admission policy
  auth/oidc/               <- Native OIDC routes, request/code/session stores, and rotation
  native/                  <- Platform-neutral TypeScript native auth SDK and broker
  notifications/           <- Notification service + plugin
  ai/                      <- Internal AI service, provider registry, tools, conversations, Meta adapter
  vector/                  <- zvec-backed local vector store, filters, AI bridge
  pdf/                     <- Browser-grade PDF service, Chromium adapter, resource policy, storage bridge
  kv/                      <- Platform KV/cache service, TTL/LRU indexes, journal/checkpoint recovery, Elysia plugin
  observability/           <- Stable event catalog, runtime sinks, protected event store
  doctor/                  <- Pure config/source diagnostics and Doctor CLI
  rooms/                   <- Rooms, presence
  scheduler/               <- Cron job scheduler
  workflows/               <- Torrent durable workflow engine (public APIs retain workflow naming)
  schema/                  <- Schema definition system (defineSchema, field types)
  hooks/                   <- Utility React hooks (useForm, useHotkey, useConfirm, etc.)
  components/
    ui/                    <- Core UI primitives (35 components)
    forms/                 <- AutoForm, FieldRenderer, Wizard
    data-table/            <- DataTable + related components
    auth/                  <- Auth UI blocks (LoginForm, reset/setup forms, gates, etc.)
    master-detail/         <- MasterDetailView / MasterDetailPage
    animate-ui/            <- 174 animated components (Motion + radix)
  frontend/
    client/                <- SDK client, React hooks, providers, routing
    server/                <- App factory, file-based router, SSR, client bundling
    router/                <- Route types, scanner, matcher, renderer
    index.ts               <- Main barrel export for the entire framework
```

---

## System 1: ReactiveDB + Sync Engine

**What:** SQLite wrapper with automatic change broadcasting via WebSocket pub/sub.

**Server files:**
| File | Purpose |
|------|---------|
| `src/sync/reactive-db.ts` | Stable ReactiveDB facade — managed CRUD, transactions/snapshots, change delivery, lifecycle |
| `src/sync/reactive-db-table-contract.ts` | Registered-table schema, identity, scope, and exact-row invariants |
| `src/sync/reactive-db-change-log.ts` | Durable sequence/log adoption, recording, pruning, and format fences |
| `src/sync/reactive-db-change-codec.ts` | Strict durable change/history serialization and validation |
| `src/sync/reactive-db-external-poller.ts` | Ordered cross-runtime SQLite change polling and gap handling |
| `src/sync/types.ts` | All type definitions — schemas, wire protocol, client types |
| `src/sync/sync.plugin.ts` | Elysia plugin — lifecycle, WS endpoint `/sync`, pub/sub wiring |
| `src/sync/sync-plugin-config.ts` | Sync composition validation, database resolution, tenant-plane classification, and authority prerequisites |
| `src/sync/message-handler.ts` | Routes incoming WS messages to handlers (subscribe, mutate, state, ephemeral) |
| `src/sync/sync-tenant-data-plane.ts` | Per-socket physical-tenant binding, replay ordering, and mutation coordination |
| `src/sync/sync-tenant-snapshot-transfer.ts` | Exact actor snapshot paging, validation, projection, chunking, budgets, and cleanup |
| `src/sync/state-manager.ts` | SQLite-authoritative per-scope user KV; atomic internal log events with no retained per-principal RAM projection |
| `src/sync/state-handler.ts` | WS handlers for state.subscribe/set/delete/clear |
| `src/sync/ephemeral-manager.ts` | RAM-only topic-scoped KV with TTL (no SQLite) |
| `src/sync/ephemeral-handler.ts` | WS handlers for ephemeral.subscribe/set/delete |
| `src/sync/index.ts` | Barrel exports |

**Client files:**
| File | Purpose |
|------|---------|
| `src/sync/client/sync-client.ts` | WebSocket connection, optimistic mutations, reconnect, ack timeout |
| `src/sync/client/sync-store.ts` | @xstate/store for synced table data + pending mutations |
| `src/sync/client/hooks.ts` | SyncProvider, useTable, useRow, useQuery, useSyncStatus |
| `src/sync/client/state-client.ts` | StateClient — per-authorized-scope user KV API |
| `src/sync/client/state-store.ts` | @xstate/store for state sync |
| `src/sync/client/state-hooks.ts` | useServerState, useServerStateReady |
| `src/sync/client/ephemeral-client.ts` | EphemeralClient — shared topic-scoped KV |
| `src/sync/client/ephemeral-store.ts` | @xstate/store for ephemeral data |
| `src/sync/client/ephemeral-hooks.ts` | useEphemeral, useEphemeralTopic |
| `src/sync/client/index.ts` | Barrel exports |

**Key patterns:**
- ReactiveDB allocates replay sequence numbers from the strict singleton
  `_zero_sync_log_state` row inside the same `BEGIN IMMEDIATE` transaction as
  the application row, explicit-format `_changes` entry, pruning-watermark
  advance, and prune. File-backed writers therefore cannot collide, reuse a
  sequence after an intentional clear, or retain a cursor for a rolled-back
  mutation. Reserved seq `0` and versioned SQLite triggers fence pre-format
  writers; the first adoption requires a coordinated stop of all old runtimes.
- State Sync mutations update `_user_state` and append one logical internal
  change in that same writer transaction. File-mode runtimes relay those events
  through the ordered dispatcher, while subscription snapshots read durable
  state and their represented cursor from one SQLite view.
- Socket mutation origin is bound once to the next outer ReactiveDB transaction
  and retained by exact committed sequence until listener delivery. Reentrant
  application writes therefore cannot inherit a socket origin, while a local
  row delayed behind an active replica drain keeps the correct connection ID.
  The exported `currentMutationOrigin` exists only for direct `routeMessage()`
  compatibility and is not read by managed plugin delivery.
- Store subscribe returns `Subscription` object — wrap with `sub.unsubscribe()` for `() => void` return.
- Originating clients receive their own directly delivered change and use its
  exact same-runtime `origin` hint alongside the authoritative ack/ref flow.
- File-mode plugins poll the database-wide `_changes` log and feed external
  commits into their process-local listeners. One dispatcher delivers local and
  external rows exactly once in durable sequence order; writer `origin` becomes
  private local/external listener metadata. A retention/corruption gap closes
  sockets for an authoritative reconnect snapshot. This supports multiple runtimes sharing
  one SQLite file, not hot/ephemeral or separate-database replicas.
- Managed auth separately polls `_auth_authority_revision`, installed by
  migration `020`, and revalidates long-lived Sync/ephemeral authorization when
  another runtime changes a session, account, membership, tenant, or role.

### System and application database planes

**What:** `createApp()` always pins a Zero/Guardian `systemDb` separately from
the app-facing `db`. Schema-declared Guardian references activate ID-only
anchors, durable projection, active-realm readiness, and the cross-file final-
commit fence. See
[System and Application Database Planes](./framework/system-database.md) for
the authoritative ownership and upgrade contract.

| File | Purpose |
| --- | --- |
| `src/databases/pinned-database-runtimes.ts` | Ordered ownership/start/stop registry for pinned system, application, and future service planes |
| `src/frontend/server/system-database-config.ts` / `system-database-layout.ts` | Defaults, physical path/handle isolation, and read-only legacy combined-layout detection |
| `src/frontend/server/app-database-planes.ts` | Composition root for pinned runtimes, authority fencing, Fabric manager, and identity projection |
| `src/databases/database-application-authority-commit-guard.ts`, `database-authority-commit-guard.ts`, and `database-authority-commit-file-fence.ts` | Pinned/Fabric application versus system final-commit ordering plus the crash-released file-mode sidecar |
| `src/databases/database-actor-authority-context.ts` and `database-actor-authority-commit-guard.ts` | Trusted parent-side system-file/revision capability and actor-local shared-sidecar/revision check at the tenant writer's final commit edge |
| `src/auth/identity-anchor-store.ts`, `identity-projection-outbox-store.ts`, and `identity-projection-service.ts` | Target-local anchors, durable system outbox, and ordered sync/async reconciliation |
| `src/frontend/server/identity-projection-*.ts` | Managed schema requirement partitioning, Guardian source, application/tenant provisioning, and public readiness mapping |
| `src/auth/data-realm-readiness.plugin.ts` and `src/frontend/client/data-realm-readiness-*.ts` | Scope-derived readiness routes, transport, polling/retry hook, and gate support |
| `src/schema/guardian-references.ts` | Server-only metadata behind `field.guardianUser()` and `field.guardianMembership()` |
| `src/doctor/platform-doctor-system-database.ts` | Read-only plane collision, durability, legacy-layout, anchor, and projection-health diagnostics |

### ReactiveDB Fabric

**What:** Bounded multi-database routing around independently reactive SQLite
databases. The shared application database remains in-process, Zero/Guardian
authority uses the separate system database, and named or physical-tenant
application databases run in isolated Bun
subprocess actors with one FIFO writer lane per database and optional file/WAL
reader actors. See
[ReactiveDB Fabric: Multi-Database Architecture](./framework/multi-database-architecture.md)
for the authoritative Zero 2.0 contract and deliberate exclusions.

| File | Purpose |
|------|---------|
| `src/databases/database-manager.ts` | App-facing named and trusted tenant binding manager; derives capabilities instead of exposing paths |
| `src/databases/database-coordinator.ts` plus `database-coordinator-*.ts` | Internal coordinator facade plus focused catalog entry, lease, queue, placement, executor-binding, recovery/durability, and tenant-Sync ownership modules |
| `src/databases/database-restart-policy.ts` | Bounded exponential per-entry restart delay and circuit-breaker/cancellation policy |
| `src/databases/database-hot-durability-supervisor.ts` | Parent-side periodic-hot telemetry validation, dirty/snapshot watchdogs, and one-shot fatal generation retirement |
| `src/databases/database-actor-protocol.ts` | Closed, versioned parent/actor IPC request and result vocabulary |
| `src/databases/database-actor-runtime.ts` | Child-side lifecycle and structured-operation dispatch facade |
| `src/databases/database-actor-binding.ts` / `database-actor-error-boundary.ts` | SQLite binding/identity/durability ownership and privacy-safe actor error projection |
| `src/databases/subprocess-database-executor.ts` plus `subprocess-database-executor-{wire,lifecycle}.ts`, `subprocess-database-request-registry.ts`, and `subprocess-database-telemetry-state.ts` | Parent-side Bun subprocess facade with focused strict-wire, bounded request/deadline/drain, settlement/termination, and telemetry state collaborators |
| `src/databases/subprocess-database-protocol.ts` / `subprocess-database-executor-config.ts` | Portable IPC envelopes and detached executor launch/lifecycle validation |
| `src/databases/subprocess-database-server.ts` | Child-side IPC server and deterministic shutdown |
| `src/databases/database-file.ts` / `database-root-ownership.ts` | Pseudonymous reference-to-file mapping (operational correlation, not authority), exclusive root ownership, and physical file admission |
| `src/databases/database-binding-identity.ts` / `database-file-identity.ts` | Immutable logical image identity plus no-follow device/inode handoff proof |
| `src/databases/database-actor-liveness.ts` | Rollback-journal restart fence against orphan actors after parent failure |
| `src/databases/database-operations.ts` plus `database-operation-{contracts,fields,payload,validation}.ts` | Public structured-operation facade plus focused contracts, field grammar, payload cloning/bounds, and catalog-aware validation |
| `src/databases/database-realm.ts` / `database-realm-schema-admission.ts` | Immutable actor realm registry plus definition-time writable-column, portable-affinity, foreign-key, and reserved-object admission |
| `src/databases/database-writer-engine.ts` plus `database-writer-{mutation-executor,read-executor,receipts,realm-validation,contracts,errors}.ts` | ReactiveDB writer facade plus focused reads/mutations, assertions, durable receipts, realm checks, replay ordering, and stable error projection |
| `src/databases/database-read-query-capability.ts`, `database-read-query-sql.ts`, `database-write-command-capability.ts`, and `database-{handler-result,read-result}-validation.ts` | Path-free registered-operation capabilities, revocation, isolated readonly SQL admission grammar, and bounded producer-result validation |
| `src/databases/database-tenant-sync*.ts` plus the focused snapshot `{codec,materializer,page,storage,limits,errors}` modules | Exact immutable snapshot sessions, replay, wakeups, bounded encoding/materialization, paging, storage, and cleanup |
| `src/databases/database-observability.ts` plus `database-observability-{contract,spec,validation,runtime}.ts` | App-local closed event catalog, privacy-safe metadata validation/projection, and actor-to-parent telemetry routing |
| `src/migrations/add-column-classifier.ts` | Shared SQLite-aware `ADD COLUMN` admission and safety classifier used by drift reporting and draft SQL generation |
| `src/frontend/server/database-topology-config.ts` | Typed `databaseTopology` normalization and cross-feature validation |
| `src/frontend/server/request-database-client.ts` | Request-local authority-bound database client projection |
| `src/resources/resource-default-crud-engine.ts` / `resource-tenant-crud-engine.ts` | Generated CRUD on the pinned/default and physical-tenant planes |

**Key Fabric patterns:**

- Browser input never selects a database. Tenant routing comes from a live,
  verified auth scope; named routing is trusted server configuration.
- Independent files can write concurrently because their synchronous SQLite
  work runs in separate subprocess actors. One database remains FIFO; optional
  file/WAL readers can overlap committed reads with its writer.
- `file`, bounded `hot`, and synchronous hybrid placement share one
  declarative placement/runtime contract. Placement is pinned for an active
  entry; there is no online promotion/demotion API.
- Resource HTTP CRUD, lazy `/api/data`, and multiplexed WebSocket Sync all use
  the same server-owned Resource plane classification and policy boundary.
- Durable receipt keys, physical files, actor entries, queues, tenant-Sync
  bindings, and exact snapshot sessions have separate hard bounds. Permanent
  file/receipt exhaustion is distinct from transient backpressure.
- The logical database reference and instance ID survive hot snapshot inode
  replacement. Root ownership, single-link checks, actor liveness leases, and
  post-settlement proof refresh prevent duplicate writer authority.

---

## System 2: Authentication

**What:** One app-local identity, session, tenancy, and authorization runtime.
It supports the four `single|multi` x `simple|advanced` profiles through the
same live session and RBAC boundary, with token rotation, Bearer middleware,
refresh-bound SSR page sessions, native public clients, and packaged browser
control surfaces.

**Files:**
| File | Purpose |
|------|---------|
| `src/auth/auth.plugin.ts` | Auth composition root — lifecycle, derives, and subplugin mounting |
| `src/auth/auth-runtime.ts` | Auth service startup/shutdown and runtime getters |
| `src/runtime/zero-app-runtime.ts` | Per-app service registry and compatibility-provider ownership; prevents process-global cross-talk |
| `src/auth/auth-schema.ts` | Auth table creation and compatibility upgrades |
| `src/auth/auth-session.plugin.ts` | Core config/register/login/refresh/logout/me/jwks routes |
| `src/auth/auth-session-service.ts` | Durable parent-session issue, binding, rotation, revocation, and live scope validation |
| `src/auth/auth-tenant-session-service.ts` | Multi-mode completion, tenant list/select/switch/create, and identity-only continuations |
| `src/auth/tenancy/` | Tenant and retained-membership persistence with owner and generation invariants |
| `src/auth/authorization-kernel.ts` | Pure shared access-requirement compiler, merge, validation, and evaluator |
| `src/auth/authorization-access.ts` | Live request access facade and authorization subject hydration |
| `src/auth/authorization-role-service.ts` | Application/tenant assignments, role expansion, protected owners, revisions, and ownership transfer |
| `src/auth/authorization-role-provisioning-service.ts` | Registration bootstrap, provisional authority, adoption, reconciliation, and session rebinding |
| `src/auth/auth-authorization.plugin.ts` | Sanitized live browser authorization snapshot route |
| `src/auth/auth-audit-service.ts`, `src/auth/auth-audit.plugin.ts` | Bounded append-only authorization/control-plane audit and authorized query/export/retention routes |
| `src/auth/auth-application-administration.plugin.ts` | Single/advanced application user and role-assignment administration |
| `src/auth/auth-tenant-administration.plugin.ts` | Active-tenant member, role, status, and ownership administration |
| `src/auth/auth-platform-administration.plugin.ts` | Active protected Administration Organization people/invitations plus capability-gated customer-tenant directory, lifecycle, and cross-workspace member/role administration |
| `src/auth/auth-tenant-onboarding.plugin.ts` | Hashed invitations and retained join-request issue/accept/review routes |
| `src/auth/auth-tenant-invitation-service.ts` | Invitation issue, inspection, acceptance, and delivery lifecycle |
| `src/auth/auth-tenant-join-request-service.ts`, `auth-tenant-join-request-store.ts`, `auth-tenant-join-request-projection.ts` | Join-request orchestration, durable concurrency-fenced rows, and public-safe projections |
| `src/auth/auth-verified-domain.plugin.ts` | Opt-in exact-domain DNS/mailbox proof, fixed-role request admission, and owner release lifecycle |
| `src/auth/auth-user-properties.plugin.ts` | Current-user configurable property routes |
| `src/auth/auth.middleware.ts` | `createAuthMiddleware()` — resolve-based, provides `requireAuth/requireAdmin` |
| `src/auth/page-session.ts` | HttpOnly page-cookie issue/resolve/revoke helpers; safe SSR pages only |
| `src/auth/user-store.ts` | Stable identity facade for users/properties/config plus focused-store orchestration |
| `src/auth/user-identity-store.ts` | User identity CRUD, lookup, listing, and counts |
| `src/auth/user-property-config-store.ts` | User properties and internal auth configuration KV |
| `src/auth/user-credential-store.ts` | Password hashes, compare-and-swap updates, gates, revocation, and audit coupling |
| `src/auth/user-token-store.ts` | Refresh-token rotation/replay/revocation plus legacy auth action tokens |
| `src/auth/registration-provisioning-store.ts` | Provisional-registration receipt leases, finalization, recovery, and exact compensation |
| `src/auth/token-service.ts` | Stable token and live-authority facade |
| `src/auth/auth-signing-keys.ts`, `auth-token-codec.ts`, `auth-web-session-token-service.ts` | Atomic signing-key establishment, strict JWT/JWKS codec, and browser session-family lifecycle |
| `src/auth/auth-synchronous-callback.ts` | Shared fail-closed guard for authority/lifecycle callbacks that must remain inside a transaction |
| `src/auth/auth-admin.plugin.ts` | Admin user-management routes and capability/config response |
| `src/auth/auth-mfa.plugin.ts` | MFA setup/challenge routes |
| `src/auth/auth-mfa-response.ts` | Session-vs-MFA completion helper |
| `src/auth/auth-user-response.ts` | Public auth user response mapper |
| `src/auth/auth-config.ts` | Auth behavior config normalization and typed config helper |
| `src/auth/action-token-service.ts` | Auth compatibility wrapper over platform action tokens, with legacy-token fallback |
| `src/auth/account-email-service.ts` | Auth lifecycle email delivery through the platform email runtime |
| `src/auth/auth-account.plugin.ts` | Forgot-password, action-token inspect, reset-password, and setup-password routes |
| `src/auth/mfa-challenge-service.ts` | MFA enrollment/challenge policy, email OTP, and TOTP verification |
| `src/auth/mfa-challenge-store.ts` | MFA challenge persistence and attempt tracking |
| `src/auth/mfa-method-store.ts` | MFA method persistence for email/TOTP enrollment state |
| `src/auth/mfa-secret-crypto.ts` | Encryption/decryption for authenticator secrets at rest |
| `src/auth/mfa-service.ts` | MFA config/readiness helper for public/admin auth config responses |
| `src/auth/mfa-totp.ts` | RFC 6238 TOTP generation and verification helpers |
| `src/auth/types.ts` | AuthContext, AuthError, UserRecord, action token types, AUTH_DEFAULTS |
| `src/auth/index.ts` | Barrel exports |

**Client:**
| File | Purpose |
|------|---------|
| `src/frontend/client/auth-client.ts` | AuthClient — login/register/logout/refresh, @xstate/store for state |
| `src/frontend/client/auth-authorization-controller.ts` | Live sanitized authorization cache, revision fencing, and revocation state |
| `src/frontend/client/authorization-hooks.ts` | Browser-safe authorization and permission hooks |
| `src/frontend/client/authorization-scope-hooks.ts` | Credential-free opaque account/tenant cache boundary for Zero-owned and app-owned hooks |
| `src/frontend/client/application-administration-hooks.ts` | Single/advanced application-access administration hook |
| `src/frontend/client/tenant-administration-hooks.ts` | Tenant switch, member, invitation, and join-request administration hooks |
| `src/frontend/client/platform-administration-hooks.ts` | Protected Administration Organization member/invitation state and mutations |
| `src/frontend/client/platform-tenant-directory-hooks.ts` | Customer-organization directory/lifecycle plus revision-fenced cross-workspace member/role/ownership administration |
| `src/components/auth/authorization-gates.tsx` | Presentation-only permission, tenant, and platform-admin gates; server remains authoritative |
| `src/components/admin/users/adaptive-user-management.tsx` | Mode-adaptive account, application-access, tenant-member, and platform-workspace control plane |
| `src/components/admin/users/single-advanced-user-management.tsx` | Account administration with application RBAC composed into the established user manager |
| `src/components/auth/tenant-member-management*.tsx` | Compact active-tenant people, membership, role, ownership, and invitation workflows |
| `src/components/auth/platform-workspace-*.tsx` | Customer-organization directory, lifecycle, creation, and capability-shaped member/role control plane without customer data-plane access |
| `src/components/auth/tenant-*.tsx` | Tenant selection, switching, creation, invitation acceptance, join-request, and domain-onboarding controls |

**Key auth patterns:**

- `users.role` remains the legacy global identity/security boundary.
  Application and tenant assignments are separate scopes expanded through the
  same authorization kernel. In `multi`, platform application authority comes
  from a live protected Administration Organization session; neither side
  silently promotes the other.
- Browser, page, and native credentials resolve live durable authority. Tenant
  selection replaces the session rather than trusting a tenant header.
- Normal request handlers receive an authorization-bound `access` facade and
  scoped `zero.*` services. Raw SQL and explicitly unsafe setup handles remain
  trusted server-code escape hatches.
- `AppProvider` and Zero-owned hooks mask or purge cached browser state across
  account or tenant replacement. App-owned caches use
  `useAuthorizationScopeBoundary()`; its opaque key is not server authority.
- Registered resources, `/api/data`, managed Sync, Storage, rooms,
  notifications, and workflows enforce the active realm and role projection;
  an unregistered raw table is not made tenant-safe implicitly. Resource
  `exposure` independently selects `internal`, `http`, `sync`, or `all`, and
  multi mode requires the choice explicitly.

### Installed-app authentication map

Desktop, mobile, Tauri, and Chrome integrations all authenticate through the
same Zero auth plugin and user store. The current parent-repository sources are:

| Area | Files | Responsibility |
|---|---|---|
| Public-client policy | `src/auth/native/` | Config validation, issuer/redirect classification, PKCE request parsing, safe continuation parsing, source admission, and proxy trust |
| OIDC provider | `src/auth/oidc/` | Discovery, authorization/consent, code exchange, refresh rotation, revocation, UserInfo, persistence, replay handling, and live-family validation |
| Runtime composition | `src/auth/auth-runtime.ts`, `src/auth/auth.plugin.ts` | Mount provider only when enabled and share users, signing keys, account gates, and auth context |
| TypeScript client core | `src/native/` | Strict discovery, PKCE, callback/ID-token checks, secure-vault envelopes, session lifecycle, authenticated fetch, process broker, IPC proxy, and Sync adapter |
| Web continuation UI | `src/components/auth/` | Preserve validated authorization through login, registration, verification, recovery, and MFA |
| Sync bridge | `src/native/sync-auth.ts`, `src/sync/sync-socket-revalidation.ts` | Refresh-aware socket auth plus cache purge/account-change lifecycle and live policy revalidation |
| Configuration diagnostics | `src/doctor/native-auth-checks.ts`, `src/doctor/native-auth-origin-checks.ts` | Issuer/public URL, clients, redirects, TTL, and admission-policy checks |
| Database evolution | `src/migrations/definitions/005_native_app_auth.ts`, `006_native_auth_hardening.ts` | Native request/code/family tables, indexes, registration intent, and guarded schema repair |
| Packaged host recipes | `examples/native-auth/` | Dependency-free TypeScript contracts for desktop loopback, mobile browser sessions, and broker IPC |

The `@zero/framework/native` TypeScript entry point is implemented in this
tree. Independently versioned `zero-native-auth`/`tauri-plugin-zero-auth` and
`@zero/chrome-auth` development repositories are deliberately not part of the
framework tree, package, create template, or updater. The Rust/Tauri packages
and Chrome adapter are functional private `0.0.0` previews with real
credential-owning flows, but remain unreleased pending independent ownership,
version/license decisions, host/platform adapters, end-to-end certification,
and security review. The canonical parent docs remain complete even when those
ignored development checkouts are absent.

**Key native pattern:** the access JWT's audience is the exact Zero app origin,
the ID token's audience is the public client ID, and both use the same `/auth`
issuer. HTTP auth rechecks the current user generation, registered client, and
live refresh family before producing the normal `AuthContext`. OIDC scopes
release identity claims; app authorization remains endpoint, middleware,
resource, and Sync policy.

**Key pattern:** Elysia auth context stays Bearer-only. The file router separately resolves the page cookie only after ruling out a `route.ts` handler, preserving the API/CSRF boundary.

---

## System 2.1: Platform Doctor

**What:** Pure createApp config diagnostics plus a human-facing CLI.

**Files:**
| File | Purpose |
|------|---------|
| `src/doctor/platform-doctor.ts` / `platform-doctor-*.ts` | Pure orchestration plus focused app-config checks for auth/email, schema PKs, storage, sync policy, Resources, Fabric topology/capacity/placement, migrations, observability, AI, vector, PDF, and index guidance |
| `src/doctor/config-loader.ts` | Loads an explicit `zero.config.ts`/`config/zero.config.ts` module for CLI checks |
| `src/doctor/run.ts` | CLI presentation for `bun run doctor` |

**Key pattern:** Warnings do not fail by default; `--strict` makes warnings fail for CI. Migration drift stays in `migrate:doctor`.

---

## System 2.2: Platform Tokens

**What:** Generic hash-only action and resume tokens for secure links,
verification, invites, password lifecycle, and long public continuation flows.

**Files:**
| File | Purpose |
|------|---------|
| `src/tokens/token.plugin.ts` | Elysia lifecycle, app-local runtime registration, and legacy unambiguous `getPlatformTokenService()` compatibility getter |
| `src/tokens/token-service.ts` | Action/resume token business rules |
| `src/tokens/token-store.ts` | SQLite persistence for `_zero_action_tokens` and `_zero_resume_tokens` |
| `src/tokens/token-types.ts` | Public token contracts and errors |
| `src/tokens/token-utils.ts` | Opaque token, hash, TTL, and metadata helpers |
| `src/tokens/index.ts` | Barrel exports and `@zero/framework/tokens` subpath |

**Key pattern:** Raw tokens are returned once and never stored. Action tokens
are consume-once. Resume tokens are reusable until expiry, revocation, or
rotation. Auth-integrated action tokens must share the exact ReactiveDB
transaction domain with `UserStore`; `createApp()` wires this automatically and
direct composition fails closed on a mismatch. Consumed-success observability
is queued after the outer commit, so rollback preserves the token and emits no
false success. See [Platform Tokens](./tokens.md#auth-transaction-boundary).

---

## System 2.3: Platform KV/Cache

**What:** Server-side Redis-style KV/cache with memory-first reads and
journal/checkpoint recovery. Mounted by `createApp()` by default and exposed to
app-owned backend routes as `zero.kv`, `zero.counter`, and `zero.limiter`.

**Files:**
| File | Purpose |
|------|---------|
| `src/kv/kv-memory-engine.ts` | Hot in-memory `Map` engine with TTL, LRU, CAS, counters, and entry metadata |
| `src/kv/kv-journal.ts` | Append-only JSONL mutation journal |
| `src/kv/kv-checkpoint.ts` | Atomic checkpoint read/write |
| `src/kv/kv-recovery.ts` | Checkpoint restore plus journal replay |
| `src/kv/kv-service.ts` | App-facing service, write ordering, timers, final flush/checkpoint |
| `src/kv/kv-counter-service.ts` | Counter helpers |
| `src/kv/kv-limiter-service.ts` | Fixed-window, token-bucket, and sliding-window limiters |
| `src/kv/kv.plugin.ts` | Elysia lifecycle plugin and `getKvService()` singleton |
| `src/kv/index.ts` | `@zero/framework/kv` and server export surface |

**Key pattern:** Active cache reads stay in memory. Disk exists for recovery
artifacts only. Generated apps use durable `everysec` journal/checkpoint
settings under `./data/kv` unless they explicitly set `kv: false`.

---

## System 3: Rooms + Presence

**What:** Collaborative spaces with membership tracking and real-time presence.

**Files:**
| File | Purpose |
|------|---------|
| `src/rooms/types.ts` | RoomRecord, RoomMemberRecord, CreateRoomParams, ROOM_TABLES |
| `src/rooms/room-service.ts` | RoomService — CRUD + membership validation |
| `src/rooms/room.plugin.ts` | Elysia plugin — tables, REST routes `/rooms/*` |
| `src/rooms/presence-service.ts` | PresenceService — wraps EphemeralManager with room-scoped conventions |
| `src/rooms/index.ts` | Barrel exports |

**Client:**
| File | Purpose |
|------|---------|
| `src/frontend/client/room-hooks.ts` | useRoom, useRoomMembers, useRooms, useRoomActions, useRoomData, usePresence |

**Key pattern:** Rooms are thin membership tracking. The platform membership
policy protects only `rooms` and `room_members`. App-owned shared state may use
a `room_id` column, but it needs an explicit server-side resource/Sync row and
mutation policy. `useRoomData` is only `useQuery` with a client-side pre-applied
filter; it is not an authorization boundary. In auth-enabled `createApp()`,
the managed `presence:<roomId>` and `typing:<roomId>` families revalidate live
room membership, own the current user's key, and derive an internal
application/tenant namespace. Other topic families require an explicit server
`ephemeralPolicy`; raw caller-selected names are not authority.

---

## System 4: Notifications

**What:** Targeted notifications with delivery receipts.

**Files:**
| File | Purpose |
|------|---------|
| `src/notifications/types.ts` | NotificationRecord, receipts, params, NOTIFICATION_TABLES |
| `src/notifications/notification-service.ts` | CRUD + targeting (broadcast, user, role, user list) |
| `src/notifications/notification.plugin.ts` | Elysia plugin — tables, REST routes `/notifications/*` |
| `src/notifications/index.ts` | Barrel exports |

**Client:**
| File | Purpose |
|------|---------|
| `src/frontend/client/notification-hooks.ts` | useNotifications, useUnreadCount, useOnNewNotification |
| `src/frontend/client/notification-provider.tsx` | NotificationProvider context |

---

## System 4.1: AI

**What:** Internal server-side AI service with env-detected providers, model
aliases, custom Meta Llama adapter, conversations, app-defined tools,
embeddings, images, transcription, speech, and optional protected runtime
status.

**Docs:** [AI](./ai.md), [AI Providers](./ai-providers.md),
[AI Conversations](./ai-conversations.md), [AI Tools](./ai-tools.md),
[Meta Llama](./ai-meta-llama.md)

**Files:**
| File | Purpose |
|------|---------|
| `src/ai/ai-types.ts` | Public AI config, provider, model, message, status, and request contracts |
| `src/ai/ai-env.ts` | `ai: true` env auto-detection and config normalization |
| `src/ai/ai-provider-catalog.ts` | Built-in provider env keys, defaults, and capability metadata |
| `src/ai/ai-registry.ts` | AI SDK provider instantiation and model lookup |
| `src/ai/ai-service.ts` | Framework-neutral service for text, streaming, embeddings, images, transcription, speech |
| `src/ai/ai-conversation.ts` | Conversation builder and message normalization |
| `src/ai/ai-session.ts` | Bounded in-memory conversation session helper |
| `src/ai/ai-toolkit.ts` | `aiTool()` / `defineAITools()` helpers |
| `src/ai/ai-workflow.ts` | Workflow step helper for AI calls |
| `src/ai/ai.plugin.ts` | Elysia service decoration and optional opt-in status route |
| `src/ai/adapters/meta-llama.ts` | Native Meta hosted Llama AI SDK provider |
| `src/ai/index.ts` | Server-side AI barrel exports |

**Key pattern:** `meta/<model>` is the developer-facing model id, while the
provider type is `meta-llama` internally. Public execution routes are not
mounted by default; apps call the service from server code.

---

## System 4.2: Vector Store

**What:** Local server-side vector persistence/search with zvec, structured
scalar filters, scoped helpers, and optional composition with `AIService.embed()`.

**Docs:** [Vector Store](./vector.md)

**Files:**
| File | Purpose |
|------|---------|
| `src/vector/vector-types.ts` | Public vector config, record, filter, result, and adapter contracts |
| `src/vector/vector-config.ts` | `vector: true` / explicit config normalization and env defaults |
| `src/vector/vector-filter.ts` | Safe structured filter to zvec SQL-like expression compiler |
| `src/vector/zvec-adapter.ts` | Current `@zvec/zvec` schema, document, query, and lifecycle adapter |
| `src/vector/vector-registry.ts` | Lazy named index store registry |
| `src/vector/vector-service.ts` | Framework-neutral app API with default-index and scoped helpers |
| `src/vector/vector-ai-bridge.ts` | Thin AI embedding plus vector upsert/query composition helper |
| `src/vector/vector.plugin.ts` | Elysia service decoration and lifecycle cleanup |
| `src/vector/index.ts` | Server-side vector barrel exports |

**Key pattern:** Vector owns storage and search only. AI owns provider/model
execution. The bridge is an optional composition helper, not a gateway, chat
store, or public frontend API.

---

## System 4.3: PDF Rendering

**What:** Server-only HTML/CSS-to-PDF rendering with a shared lazy Chromium
process, isolated browser contexts, bounded queueing, strict resource policy,
direct Zero storage composition, and replaceable renderer/storage adapters.

**Docs:** [PDF Rendering](./pdf.md)

**Files:**
| File | Purpose |
|------|---------|
| `src/pdf/pdf-types.ts` | Public PDF config, render, resource, adapter, storage, and status contracts |
| `src/pdf/pdf-config.ts` | Secure defaults, limits, browser config, and print-option normalization |
| `src/pdf/pdf-document.ts` | Full-document/fragment composition and supplemental CSS/base metadata |
| `src/pdf/pdf-content-policy.ts` | Renderer CSP for inline resource, script, worker, form, and object enforcement |
| `src/pdf/pdf-resource-policy.ts` | Remote/local/private-network resource decisions and safe diagnostics |
| `src/pdf/pdf-render-queue.ts` | Concurrency and queue-pressure boundary |
| `src/pdf/playwright-pdf-renderer.ts` | Lazy Playwright Chromium lifecycle and browser rendering adapter |
| `src/pdf/pdf-storage-writer.ts` | Narrow adapter into Zero storage |
| `src/pdf/pdf-service.ts` | Framework-neutral rendering/storage orchestration and observability |
| `src/pdf/pdf.plugin.ts` | Named Elysia decoration and shutdown lifecycle |
| `src/pdf/pdf-browser-install.ts` | Managed Chromium status/install operations |
| `src/pdf/run.ts` | `zero pdf install/status` CLI |
| `src/pdf/index.ts` | Server-only PDF barrel exports |

**Key pattern:** Zero mounts no public PDF route. App endpoints and workflows
own validation/authorization, while `zero.pdf` owns bounded rendering. Browser
startup is lazy and process-wide; each render receives an isolated context.

---

## System 5: Torrent Workflows

**Torrent** is the product name for this durable orchestration system. Source,
configuration, routes, tables, TypeScript types, errors, observability, and
React hooks retain their established `workflow`/`workflows` names.

**What:** Durable, immutable-versioned workflow graphs with trusted activities,
safe serializable expressions, persisted choices, concurrent branches and
joins, bounded array fan-out, event/human waits, transactional private memory,
exact wakes, pause/resume, cancellation, crash recovery, sealed actor/system
provenance, live authority revalidation at dispatch and commit, and live safe
state.

**Files:**
| File | Purpose |
|------|---------|
| `src/workflows/types.ts` | Shared definition, context, runtime-record, and public Sync contracts |
| `src/workflows/workflow-dsl.ts` | Code-first `flow`/`step`/`choose`/`parallel`/`each`/wait builders |
| `src/workflows/workflow-expression.ts` | JSON-safe expression AST, builders, validation, and evaluation |
| `src/workflows/workflow-ir.ts` | Canonical graph schema shared by code, database, agent, and visual authors |
| `src/workflows/workflow-compiler.ts` | Legacy/DSL/raw-IR compilation, canonicalization, and fingerprints |
| `src/workflows/workflow-ir-validator.ts` | Whole-graph topology, limit, join, and activity-shape validation |
| `src/workflows/workflow-ir-expression-validator.ts` | Context, item-scope, existence, and output-dominance validation |
| `src/workflows/workflow-schema-snapshot.ts` | JSON-safe TypeBox schema persistence and rehydration without executable transforms |
| `src/workflows/workflow-activity-catalog.ts` | Trusted versioned activities and `databaseCallable` boundary |
| `src/workflows/workflow-activity-reference-codec.ts` | Reversible internal encoding for exact activity name/version references |
| `src/workflows/workflow-access.ts` | Validated declarative start/inspect authority |
| `src/workflows/workflow-registry.ts` | Activity catalog plus legacy and compiled definition registry |
| `src/workflows/workflow-execution-authority.ts` | Stable compatibility barrel for execution-authority contracts |
| `src/workflows/workflow-execution-authority-types.ts` | Secret-free actor/system authority, seal, provider, and service contracts |
| `src/workflows/workflow-execution-authority-factory.ts` | Validated authority construction, scope recovery, and canonical identity comparison |
| `src/workflows/workflow-execution-authority-codec.ts` | Bounded authority validation/freezing plus domain-bound envelope encoding |
| `src/workflows/workflow-execution-authority-store.ts` | Private MAC key ownership, v1 instance seals, adjacent-record seals, and attempt leases |
| `src/workflows/workflow-execution-authority-schema.ts` | Private execution-authority and in-flight lease DDL |
| `src/workflows/auth-workflow-execution-authority.ts` | Guardian session/API-key credential, tenant, membership, and RBAC revalidation adapter |
| `src/workflows/workflow-schema.ts` | Public ReactiveDB table registration, indexes, and ownership/parent guards |
| `src/workflows/workflow-graph-schema.ts` | Stable additive schema-installation facade and startup ordering |
| `src/workflows/workflow-graph-schema-database.ts` | Narrow database contract consumed by graph schema installation |
| `src/workflows/workflow-graph-schema-tables.ts` | Version, graph, fan-out, memory, interaction table, and index DDL |
| `src/workflows/workflow-graph-schema-integrity.ts` | Immutable topology, tenant-lineage, and response-provenance triggers |
| `src/workflows/workflow-graph-schema-compatibility.ts` | Fail-closed upgraded-schema compatibility checks |
| `src/workflows/workflow-definition-canonical.ts` | Bounded canonical JSON envelopes and immutable SHA-256 fingerprints |
| `src/workflows/workflow-definition-version-store.ts` | Append-only definition publication, activation, retirement, and integrity validation |
| `src/workflows/workflow-definition-version-validation.ts` | Stable validation/error boundary for persisted version and draft content |
| `src/workflows/workflow-definition-draft-store.ts` | Mutable revision-fenced editor/agent drafts |
| `src/workflows/workflow-definition-manager.ts` | Trusted database-definition compilation and mutation boundary |
| `src/workflows/workflow-definition-query-service.ts` | Definition read models, visibility checks, and start authorization |
| `src/workflows/workflow-definition-version-observability.ts` | Safe definition publication/activation/retirement events |
| `src/workflows/workflow-definition-http.plugin.ts` | Active-scope-manager draft/version API for application or tenant definitions |
| `src/workflows/workflow-graph-store.ts` | Stable graph-persistence facade preserving the runtime store API |
| `src/workflows/workflow-graph-records.ts` | Shared graph-persistence record contracts |
| `src/workflows/workflow-graph-run-store.ts` | Atomic run creation, instance/step persistence, due/expiry recovery queries, and runtime-budget validation |
| `src/workflows/workflow-graph-topology-store.ts` | Immutable edges, durable control decisions, and pinned graph-snapshot parsing |
| `src/workflows/workflow-each-item-store.ts` | Private fan-out item persistence and runtime-value accounting |
| `src/workflows/workflow-graph-interaction-reader.ts` | Recovery-only joins across public and private interaction envelopes |
| `src/workflows/workflow-graph-node-metadata.ts` | Stable public-safe branch ancestry for live graph rows |
| `src/workflows/workflow-graph-planner.ts` | Ready/unreachable node planning from durable edges and decisions |
| `src/workflows/workflow-graph-state-reader.ts` | Coherent persisted graph snapshot reads and validation boundary |
| `src/workflows/workflow-graph-runtime.ts` | Internal graph-runtime coordinator for lifecycle, recovery, topology, and interaction operations |
| `src/workflows/workflow-graph-runtime-composition.ts` | App-local graph collaborator assembly and shared authority/observability wiring |
| `src/workflows/workflow-graph-start-coordinator.ts` | Access-checked version resolution, atomic authority/version pinning, initial state creation, and first advance |
| `src/workflows/workflow-graph-driver.ts` | Coalesced strict-frontier run loop, authority fences, convergence limits, and terminal cleanup |
| `src/workflows/workflow-graph-recovery.ts` | Fail-closed graph preflight and crash-left state recovery |
| `src/workflows/workflow-graph-pump.ts` | Coalesced per-instance graph advancement |
| `src/workflows/workflow-graph-activity-executor.ts` | Activity validation, attempts, memory commit, retries, and deadlines |
| `src/workflows/workflow-structural-node-controller.ts` | Choice, parallel, and join decisions |
| `src/workflows/workflow-each-controller.ts` | Snapshotted keyed fan-out and ordered result aggregation |
| `src/workflows/workflow-each-item-coordinator.ts` | Durable item/child-step reconciliation and claim transitions |
| `src/workflows/workflow-wait-controller.ts` | Durable event and interaction waits plus delivery activities |
| `src/workflows/workflow-interaction-authority.ts` | Fail-closed app/Guardian responder policy with synchronous or revision-leased commit fencing |
| `src/workflows/workflow-interaction-store.ts` | Stable persistence facade over wait lifecycle and response-ledger collaborators |
| `src/workflows/workflow-interaction-lifecycle-store.ts` | Public wait lifecycle plus private policy, schema, request, expiry, and cancellation persistence |
| `src/workflows/workflow-interaction-response-store.ts` | Atomic idempotent submission reservations, first-valid-wins decisions, response ledger, and capacity accounting |
| `src/workflows/workflow-memory-store.ts` | Private scoped optimistic ReactiveDB scratch memory |
| `src/workflows/workflow-interaction-service.ts` | Channel-neutral interaction lifecycle and tracked authorization/validation work |
| `src/workflows/workflow-interaction-submission-processor.ts` | Authorization, schema/activity validation, and first-valid-wins response pipeline |
| `src/workflows/workflow-interaction-persisted-state.ts` | Recovery validation for public/private interaction envelopes |
| `src/workflows/workflow-interaction-response-integrity.ts` | Recovery validation and outcome derivation for private submissions |
| `src/workflows/workflow-interaction-event-bridge.ts` | Authenticated durable-event response adapter |
| `src/workflows/workflow-event-actor.ts` | Bounded private actor snapshots for event-delivered responses |
| `src/workflows/workflow-event-authority-store.ts` | Event-and-actor-bound private authority seals for consume-time Guardian revalidation |
| `src/workflows/workflow-event-capacity-store.ts` | O(1), transactional pending/retained event count and byte accounting |
| `src/workflows/workflow-event-persisted-state.ts` | Fail-closed recovery validation for public/private event identity and counters |
| `src/workflows/workflow-graph-interaction-validator.ts` | Trusted activity validation context for interaction responses |
| `src/workflows/workflow-graph-wake-scheduler.ts` | Exact in-process graph retry/deadline timers |
| `src/workflows/workflow-step-definition.ts` | Definition-snapshot parsing and handler resolution |
| `src/workflows/workflow-persisted-state.ts` | Fail-closed validation of durable run rows/topology |
| `src/workflows/workflow-runtime-store.ts` | Stable private runtime-persistence facade over event, attempt, and pause stores |
| `src/workflows/workflow-event-delivery-store.ts` | Durable event inbox claims, authority envelopes, capacity accounting, cleanup, and recovery validation |
| `src/workflows/workflow-attempt-lease-store.ts` | Physical step-attempt leases and stale-completion fences |
| `src/workflows/workflow-pause-store.ts` | Durable pause timestamps consumed when shifting retry and timeout deadlines |
| `src/workflows/workflow-runtime-schema.ts` | Current internal coordination DDL used by runtime/standalone composition |
| `src/workflows/workflow-runtime-lease-schema.ts` | Private singleton owner-generation lease DDL |
| `src/workflows/workflow-runtime-lease-store.ts` | Atomic durable runtime acquire, renewal, takeover, assertion, and release |
| `src/workflows/workflow-runtime-owner-lease.ts` | Heartbeat lifecycle, ownership-loss notification, and commit fence |
| `src/workflows/workflow-runtime-fence.ts` | Shared transaction-time exact-generation assertion |
| `src/workflows/workflow-json-value.ts` | Strict, detached data-only JSON trust boundary for private workflow state |
| `src/workflows/workflow-runtime-json.ts` | JSON serialization and per-value durable runtime byte boundary |
| `src/workflows/workflow-runtime-budget.ts` | O(1), transactional per-instance aggregate runtime-value accounting |
| `src/workflows/workflow-persisted-state-values.ts` | Strict bounded JSON/scalar/timestamp recovery primitives |
| `src/workflows/workflow-repository.ts` | Prepared SQL reads/writes and durable transaction helpers |
| `src/workflows/workflow-instance-factory.ts` | Start-time validation and atomic instance/step persistence |
| `src/workflows/workflow-scope-boundary.ts` | Single/multi-tenant scope validation and hidden-run lookup boundary |
| `src/workflows/workflow-run-query-service.ts` | Scope-filtered run, step, event, list, and public-topology reads |
| `src/workflows/workflow-start-coordinator.ts` | Actor/system authority capture plus graph-or-legacy atomic start orchestration |
| `src/workflows/workflow-event-coordinator.ts` | Event validation, sealed authority binding, atomic inbox persistence, and dispatch |
| `src/workflows/workflow-attempt-coordinator.ts` | Transactional prepare/commit, retry/deadline decisions, and attempt fences |
| `src/workflows/workflow-transition-controller.ts` | Pause, resume, and cancellation transitions |
| `src/workflows/workflow-lifecycle-coordinator.ts` | Recovery, retry/timeout discovery, and shutdown normalization |
| `src/workflows/workflow-executor.ts` | Physical handler invocation and cooperative abort/drain behavior |
| `src/workflows/workflow-service.ts` | Stable public facade, composition root, lifecycle owner, and graph/legacy router |
| `src/workflows/workflow-start-router.ts` | Fail-closed graph/database/legacy start selection |
| `src/workflows/workflow-sync-policy.ts` | Owner/active-scope-manager visibility, deny-wins delegate composition, composite delivery-time read authority, and read-only workflow tables |
| `src/workflows/workflow-public-record.ts` | HTTP/Sync executable-topology redaction |
| `src/workflows/workflow-error.ts` | Stable workflow-domain errors |
| `src/workflows/workflow-observability.ts` | App-local, transaction-aware workflow lifecycle event boundary |
| `src/workflows/workflow-scheduler-owner.ts` | Owned retry/timeout job registration and cleanup |
| `src/workflows/workflow-plugin-runtime.ts` | Registration/recovery barrier and safe service publication |
| `src/workflows/workflow-runtime-owner-store.ts` | Process-local ownership unit for composed registry/service/shutdown state |
| `src/workflows/workflow-http.plugin.ts` | Protected runtime/interaction routes and stable HTTP errors |
| `src/workflows/workflow.plugin.ts` | Thin Elysia composition facade |
| `src/migrations/definitions/030_workflow_graph_runtime.ts` | Frozen historical workflow graph migration |
| `src/migrations/definitions/031_workflow_graph_tenant_integrity.ts` | Current tenant-integrity and observable-relation upgrade |
| `src/migrations/definitions/032_workflow_runtime_ownership.ts` | Durable workflow runtime ownership-generation lease |
| `src/migrations/definitions/033_torrent_integrity_hardening.ts` | Topology-independent Torrent definition/version/draft and terminal-event integrity fences |
| `src/workflows/index.ts` | Barrel exports |

**Client:**
| File | Purpose |
|------|---------|
| `src/frontend/client/workflow-hooks.ts` | Sync-backed nodes/events/interactions, accurate parallel/wait flags, and HTTP actions |
| `src/frontend/client/workflow-run-hooks.ts` | Version-pinned start-and-watch composition, stable root plus fan-out/delivery progress, and response actions |
| `src/frontend/client/workflow-topology-hooks.ts` | Scope-fenced load of one run's immutable sanitized presentation topology |

**Key patterns:** `AppConfig.workflows.register` is awaited before definition,
activity, and persisted-state preflight. Every graph run pins canonical graph
content, definition version, fingerprint, and activity versions. Database/API
graphs can reference only explicitly `databaseCallable` activities.
Publication checks schema snapshots and output dominance, and immutable
content/draft envelopes are bounded before storage.

Definition identity is `(scope_type, scope_id, name)`. Code definitions are
application-scoped and available to tenant execution; a tenant-scoped database
definition shadows a same-name code definition only in that tenant.
Application database definitions remain outside tenant management. Definition
admin routes authorize the live manager of the active service-data scope rather
than granting platform-wide access from their `/admin/` prefix.

Durable run values have both a 1 MiB per-value boundary and a transactional
32 MiB per-instance aggregate budget across instance, step, fan-out, memory,
interaction definition, and interaction response state. Each interaction has
additional submission count/byte accounting. The private event inbox separately
enforces bounded event names plus pending and retained count/byte quotas per
instance.

Readiness comes from durable dependencies. Choice selections, parallel joins,
fan-out snapshots/items, event claims, physical-attempt fences, and human
interactions survive restart. `ctx.memory` writes are staged per attempt and
commit with successful node completion; external effects remain at-least-once
and use `ctx.idempotencyKey`. `requestAndWait` persists its response endpoint
before transport-specific delivery.

HTTP and Sync visibility is owner-scoped except for a live manager of the
active application/tenant service-data scope. A global identity role alone
does not grant peer-tenant workflow visibility.
Definitions, graph topology, scratch memory, interaction bodies, and graph
event payloads remain private. All workflow instance/step input, output, and raw
error values are redacted; safe node/branch/parent/item-index identity, event audit
metadata, and interaction progress let React hooks and a future graph UI
animate runs in real time without polling. Browser actions use
`client.api.workflows`. See
[Torrent: Durable Workflows](./workflows.md).

Authenticated starts use `runAsActor()` and derive tenant scope only from the
live Guardian credential—session or explicitly admitted user API key.
Privileged plugins/jobs use `runAsSystem()` with an explicit principal, reason,
and trusted server scope. Retried/recovered handlers keep the original seal; no
request input may swap their tenant. State-derived workflow observability is
app-local and deferred through ReactiveDB `afterCommit`; rollback emits no
lifecycle fact, while operational failures emit immediately.

The request/workflow-scoped `zero.workflows` facade adapts `start()`/`run()` to
the live actor and closes lifecycle/event operations over that scope. The raw
managed `WorkflowService` rejects compatibility `start()`/`run()`; those methods
remain only for standalone composition, while raw managed callers explicitly
choose `runAsActor()` or `runAsSystem()`.

---

## System 6: Scheduler

**What:** Cron-based job scheduler.

**Files:**
| File | Purpose |
|------|---------|
| `src/scheduler/scheduler-service.ts` | `SchedulerService` — register and control named cron jobs |
| `src/scheduler/scheduler.plugin.ts` | Elysia plugin — @elysiajs/cron integration |
| `src/scheduler/index.ts` | Barrel exports |

**Pre-registered jobs:** workflow-retries (every minute), workflow-timeouts
(every minute), notification-cleanup (every hour). Graph workflows also arm
exact in-process retry/deadline timers; minute jobs are the persisted-state
safety sweep and restart fallback.

---

## System 7: Schema

**What:** Define data models once, use everywhere.

**Files:**
| File | Purpose |
|------|---------|
| `src/schema/define-schema.ts` | `defineSchema()`, `defineTable()` — schema builders |
| `src/schema/field-types.ts` | `field` namespace — 18 field type builders |
| `src/schema/infer.ts` | TypeScript type inference (`InferSchemaType`) |
| `src/schema/index.ts` | Barrel exports |

**18 field types:** text, email, url, password, number, boolean, select, multiSelect, textarea, date, datetime, dateRange, json, enum, tags, combobox, hidden.

**One schema produces:** SQL DDL (auto-extracted by `resolveConfig`), client table def (auto-extracted by `AppProvider`/`createClient`), valibot validator, form metadata, DataTable column config, TypeScript types via `InferRow`.

---

## System 8: Forms

**Files:**
| File | Purpose |
|------|---------|
| `src/components/forms/auto-form.tsx` | `<AutoForm>` — generates full form from schema |
| `src/components/forms/field-renderer.tsx` | `<FieldRenderer>` — renders any field type |
| `src/components/forms/wizard.tsx` | `<Wizard>` — multi-step form with validation |
| `src/hooks/use-form.ts` | `useForm()` — form state, validation, collection binding |

---

## System 9: Reusable Data UI

**Docs:** [DataTableView](./frontend/data-table.md),
[KanbanBoard](./frontend/kanban.md),
[MasterDetailView](./frontend/master-detail.md)

**Files:**
| File | Purpose |
|------|---------|
| `src/components/data-table/data-table.tsx` | `<DataTable>` — full-featured table |
| `src/components/data-table/use-data-table.ts` | `useDataTable()` — TanStack Table wrapper |
| `src/components/data-table/data-table-source.ts` | `useDataTableSource()` — static/full-sync/lazy data-source resolver |
| `src/components/data-table/data-table-column-header.tsx` | Sortable/filterable column headers |
| `src/components/data-table/data-table-search.tsx` | Compact, table-only animated search with accessible keyboard and reduced-motion behavior |
| `src/components/data-table/data-table-column-filter.tsx` | Schema-aware client-side column-filter controls |
| `src/components/data-table/data-table-toolbar.tsx` | Responsive search/filter control plane with selection-aware `controls`, `actions`, and `supplemental` slots, column visibility, and export |
| `src/components/data-table/data-table-export.ts` | CSV export projection and download helper |
| `src/components/data-table/data-table-pagination.tsx` | Pagination controls |
| `src/components/data-table/data-table-row-actions.tsx` | Row action dropdown |
| `src/components/data-table/editable-cell.tsx` | Inline cell editing |
| `src/components/data-table/animated-cell.tsx` | Animated cell transitions |
| `src/components/kanban/kanban-board.tsx` | `<KanbanBoard>` / `<KanbanTaskCard>` - tokenized drag-and-drop board organism |
| `src/components/kanban/kanban-utils.ts` | Pure column grouping and drag projection helpers |
| `src/components/radial-menu/index.ts` | Public package export for the animated radial context menu |
| `src/components/hero/hero.tsx` | Public-page `<Hero>` section using the frontend public token lane |
| `src/components/hero/hero-background.tsx` | Hero preset/custom/image background helpers |
| `src/components/hero/wavy-background.tsx` | Canvas-driven wavy Hero background preset/helper |
| `src/components/navbar/resizable-navbar.tsx` | Public-page `<ResizableNavbar>` using the frontend public token lane |
| `src/components/code-block/code-block.tsx` | Public-page `<CodeBlock>` with Shiki highlighting, tabs, line numbers, and copy |
| `src/components/cta/cta-section.tsx` | Public-page `<CtaSection>` with Hero-compatible actions |
| `src/components/footer/footer-section.tsx` | Full-width public-page `<FooterSection>` with brand, labeled nav, action copy, actions, and social links |
| `src/components/features/features-section.tsx` | Public-page `<FeaturesSection>` with icon bullets and a flexible visual slot |
| `src/components/text-effects/text-generate-effect.tsx` | Public word-by-word text reveal component |
| `src/components/text-effects/typewriter-effect.tsx` | Public segmented typewriter text effect |
| `src/components/text-effects/flip-words.tsx` | Public rotating inline word effect |
| `src/components/streaming-text/streaming-text.tsx` | Accessible static, replayed, and live string-stream renderer for AI/agent output |
| `src/components/faq/faq.tsx` | Public FAQ accordion with optional generated answer text |
| `src/components/expandable-card/expandable-card.tsx` | Public shared-layout expandable card gallery |
| `src/components/bento-grid/bento-grid.tsx` | Public bento grid layout, item, and skeleton components |
| `src/components/animated-list/animated-list.tsx` | Public sequenced animated list and event-card skin |
| `src/components/master-detail/master-detail-page.tsx` | `<MasterDetailView>` / `<MasterDetailPage>` — list + detail organism |
| `src/components/master-detail/use-master-detail-state.ts` | Live data and selected-row state for master-detail views |
| `src/components/master-detail/master-detail-selection.ts` | Pure primary-key-aware selection resolution |

`DataTableView` exposes the toolbar through `searchable`, `toolbarLabel`, and
`toolbarSlots`; CrudPage and MasterDetail wrappers forward slots as
`tableToolbarSlots` and its accessible name as `tableToolbarLabel`. Toolbar
filters are TanStack/client filters over resolved rows. Discrete, numeric, and
date controls match exactly, text controls use contains matching, and
multi-value controls match an included value. Lazy `filters`/`source.filters`
remain `/api/data` inputs and are owned by the source layer rather than the
toolbar. The slot and label props are optional additions: existing boolean
`searchable` and `toolbarActions` integrations require no rewrite or database
migration.

---

## System 10: UI Components

**`src/components/ui/` — 35 core components:**
Button, Input, Label, Textarea, Select, Badge, Card, FormField, Table, ScrollArea, Separator, Skeleton, Avatar, Breadcrumb, Pagination, Calendar, Command, Combobox, DatePicker, DateRangePicker, TagInput, StatCard, Chart, ValidationMeter, ValidationRules, NotificationBadge, NotificationCenter, NotificationDropdown, NotificationItem, NotificationList, DetailPanel, ListDetailLayout, RecordNavigationBar, ThemeProvider, Toaster (Sonner).

**`src/components/animate-ui/` — 174 animated components:**
Organized into `primitives/` (raw building blocks) and `components/` (pre-styled compositions). Categories: buttons, radix UI (animated), effects, text animations, backgrounds, community components.

**Public/frontend token lane:**
`src/frontend/styles/globals.css` exposes `public-background`,
`public-surface`, `public-glass`, `public-accent`, `public-border`, and
`public-ring` alongside the core app tokens so website/docs/landing components
can have a richer visual language without changing dashboard defaults.

**`src/components/auth/` — auth UI blocks:**
LoginForm, RegisterForm, ForgotPasswordForm, EmailVerificationForm, PasswordActionForm, ChangePasswordForm, UserPropertiesForm, AuthFlowContinuation, TenantSelectionForm, TenantCreationForm, MFAContinuation, MFAEnrollmentForm, MFAChallengeForm, MFAManagementPanel, OTPVerification, PasswordInput, PasswordStrength, OTPInput, SocialLoginGroup, AuthLayout, AuthHeader, Gate, AdminGate, SignedIn, SignedOut, PropertyGate, HasProperty, HasFlag, useGate, usePropertyGate.

**`src/components/qr-code/` — QR primitive:**
QRCode for token-aware authenticator setup and app-owned QR flows.

---

## System 11: Frontend Infrastructure

**Client SDK:**
| File | Purpose |
|------|---------|
| `src/frontend/client/sdk.ts` | `createClient()` — singleton factory wiring sync + auth + state + ephemeral |
| `src/frontend/client/hooks.ts` | All React hooks + re-exports |
| `src/frontend/client/app-provider.tsx` | `<AppProvider>` — composes Router > Client > Sync providers |
| `src/frontend/client/router-context.tsx` | RouterProvider, useRouter, usePathname, useParams |
| `src/frontend/client/client-router.ts` | Client-side routing (registerRoute, navigateTo, prefetch) |
| `src/frontend/client/link.tsx` | `<Link>` component |

**Server:**
| File | Purpose |
|------|---------|
| `src/frontend/server/app-factory.ts` | `createApp()` — composes all plugins in order |
| `src/frontend/server/router-plugin.ts` | File-based router — scans app/ dir, SSR, API routes, sitemap route |
| `src/frontend/server/sitemap.ts` | Generates sitemap XML from public static file-router pages and manual entries |
| `src/frontend/server/client-bundle.ts` | Builds client bundle with Bun.build |
| `src/frontend/server/style-bundle.ts` | Builds hashed platform CSS from Tailwind/theme tokens and app source candidates |
| `src/frontend/server/types.ts` | AppConfig, ResolvedConfig |

**Router:**
| File | Purpose |
|------|---------|
| `src/frontend/router/types.ts` | RouteModule, RouteNode, MatchResult, LoaderContext |
| `src/frontend/router/scanner.ts` | Scans app/ directory for route files |
| `src/frontend/router/matcher.ts` | URL pattern matching |
| `src/frontend/router/renderer.ts` | React SSR renderer |

**Main barrel export:** `src/frontend/index.ts` (`@zero/framework/react`) -- exports everything apps need: `defineTable`, `field`, `defineSchema`, `schema`, `InferRow`, `useCollection`, `useLazyCollection`, `CrudPage`, `AppProvider`, hooks, components. `@zero/framework/server` is only for `app/server.ts`.

---

## Plugin Composition Order (app-factory.ts)

```
1. Sync engine          (provides ReactiveDB — must be first)
2. Platform tokens      (shared DB-backed action/resume token service)
3. Auth + middleware    (optional account runtime and request policy)
4. Observability        (sink endpoint + global error reporting)
5. AI                   (optional internal provider service)
6. Vector               (optional local vector storage)
7. PDF                  (optional lazy Chromium renderer)
8. KV/cache             (optional durable memory-first service)
9. Scheduler            (cron jobs — used by notifications + workflows)
10. Notifications/rooms/workflows (auth-dependent services)
11. Storage             (auth-dependent object storage)
12. Data query/resources (lazy data and generated CRUD policy)
13. App backend extensions
14. Health/sitemap/file router (file router remains last)
```

---

## Wire Protocol Summary

All messages go over a single WebSocket at `/sync`.

**Durable sync (full ack/rollback):**
```
Client -> Server:  sync.subscribe, sync.mutate
Server -> Client:  sync.snapshot, sync.change, sync.ack, sync.catchup
```

**Per-authorized-scope user state (full ack/rollback):**
```
Client -> Server:  state.subscribe, state.set, state.delete, state.clear
Server -> Client:  state.snapshot, state.change, state.ack
```

**Ephemeral (fire-and-forget, no ack):**
```
Client -> Server:  ephemeral.subscribe, ephemeral.unsubscribe, ephemeral.set, ephemeral.delete
Server -> Client:  ephemeral.snapshot, ephemeral.change
```

---

## How to Read the Codebase

1. **Start with `src/frontend/index.ts`** (`@zero/framework/react`) -- the barrel export shows everything apps can import
2. **Read `src/frontend/server/app-factory.ts`** -- shows how all plugins compose (`@zero/framework/server`)
3. **Read `src/sync/types.ts`** -- defines the wire protocol and all core types
4. **Read `src/sync/sync.plugin.ts`** -- the engine that makes everything real-time
5. **Read `src/frontend/client/sdk.ts`** -- the client-side wiring
6. **Read `src/schema/define-schema.ts`** -- how `defineTable` and `field` drive everything
7. **Pick any system directory** -- each has its own `index.ts` barrel with clean exports
