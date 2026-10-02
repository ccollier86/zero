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
  sync/                    <- Core engine: ReactiveDB + WebSocket sync + state sync + ephemeral KV
  sync/client/             <- Client-side sync: stores, clients, React hooks
  auth/                    <- Authentication: JWT, user store, middleware
  auth/native/             <- Native public-client config, redirect, PKCE, and admission policy
  auth/oidc/               <- Native OIDC routes, request/code/session stores, and rotation
  native/                  <- Platform-neutral TypeScript native auth SDK and broker
  notifications/           <- Notification service + plugin
  ai/                      <- Internal AI service, provider registry, tools, conversations, Meta adapter
  vector/                  <- zvec-backed local vector store, filters, AI bridge
  pdf/                     <- Browser-grade PDF service, Chromium adapter, resource policy, storage bridge
  kv/                      <- Platform KV/cache service, TTL/LRU indexes, journal/checkpoint recovery, Elysia plugin
  rooms/                   <- Rooms, presence
  scheduler/               <- Cron job scheduler
  workflows/               <- Durable workflow engine
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
| `src/sync/reactive-db.ts` | ReactiveDB class — wraps bun:sqlite with onChange, ring buffer, transactions |
| `src/sync/types.ts` | All type definitions — schemas, wire protocol, client types |
| `src/sync/sync.plugin.ts` | Elysia plugin — lifecycle, WS endpoint `/sync`, pub/sub wiring |
| `src/sync/message-handler.ts` | Routes incoming WS messages to handlers (subscribe, mutate, state, ephemeral) |
| `src/sync/state-manager.ts` | Per-user KV state (RAM + SQLite write-through) |
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
| `src/sync/client/state-client.ts` | StateClient — per-user KV API |
| `src/sync/client/state-store.ts` | @xstate/store for state sync |
| `src/sync/client/state-hooks.ts` | useServerState, useServerStateReady |
| `src/sync/client/ephemeral-client.ts` | EphemeralClient — shared topic-scoped KV |
| `src/sync/client/ephemeral-store.ts` | @xstate/store for ephemeral data |
| `src/sync/client/ephemeral-hooks.ts` | useEphemeral, useEphemeralTopic |
| `src/sync/client/index.ts` | Barrel exports |

**Key patterns:**
- `currentMutationOrigin` — module-level variable set before synchronous db write, read in onChange callback. Safe because bun:sqlite is single-threaded.
- Store subscribe returns `Subscription` object — wrap with `sub.unsubscribe()` for `() => void` return.
- `publishToSelf: true` in WS config — originating client gets its own change via pub/sub, uses `origin` field to reconcile with optimistic state.

---

## System 2: Authentication

**What:** JWT-based auth with user store, token rotation, Bearer middleware, and refresh-bound SSR page sessions.

**Files:**
| File | Purpose |
|------|---------|
| `src/auth/auth.plugin.ts` | Auth composition root — lifecycle, derives, and subplugin mounting |
| `src/auth/auth-runtime.ts` | Auth service startup/shutdown and runtime getters |
| `src/auth/auth-schema.ts` | Auth table creation and compatibility upgrades |
| `src/auth/auth-session.plugin.ts` | Core config/register/login/refresh/logout/me/jwks routes |
| `src/auth/auth-user-properties.plugin.ts` | Current-user configurable property routes |
| `src/auth/auth.middleware.ts` | `createAuthMiddleware()` — resolve-based, provides `requireAuth/requireAdmin` |
| `src/auth/page-session.ts` | HttpOnly page-cookie issue/resolve/revoke helpers; safe SSR pages only |
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
are Phase 0 design scaffolds; the Chrome adapter is a private MV3 preview. The
canonical parent docs remain complete even when those ignored development
checkouts are absent.

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
| `src/doctor/platform-doctor.ts` | Pure app config checks for auth/email, schema PKs, storage, sync policy, resources, migrations, observability, AI, vector, PDF, and index guidance |
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
| `src/tokens/token.plugin.ts` | Elysia lifecycle + `getPlatformTokenService()` singleton |
| `src/tokens/token-service.ts` | Action/resume token business rules |
| `src/tokens/token-store.ts` | SQLite persistence for `_zero_action_tokens` and `_zero_resume_tokens` |
| `src/tokens/token-types.ts` | Public token contracts and errors |
| `src/tokens/token-utils.ts` | Opaque token, hash, TTL, and metadata helpers |
| `src/tokens/index.ts` | Barrel exports and `@zero/framework/tokens` subpath |

**Key pattern:** Raw tokens are returned once and never stored. Action tokens
are consume-once. Resume tokens are reusable until expiry, revocation, or
rotation.

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

**Key pattern:** Rooms are thin — just membership tracking. Shared state lives in regular ReactiveDB tables with a `room_id` column. `useRoomData` = `useQuery` with a pre-applied filter.

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

**What:** Durable, immutable-versioned workflow graphs with trusted activities,
safe serializable expressions, persisted choices, concurrent branches and
joins, bounded array fan-out, event/human waits, transactional private memory,
exact wakes, pause/resume, cancellation, crash recovery, and live safe state.

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
| `src/workflows/workflow-schema.ts` | Public ReactiveDB table registration, indexes, and ownership/parent guards |
| `src/workflows/workflow-graph-schema.ts` | Version, graph, fan-out, memory, and interaction DDL/integrity guards |
| `src/workflows/workflow-definition-canonical.ts` | Bounded canonical JSON envelopes and immutable SHA-256 fingerprints |
| `src/workflows/workflow-definition-version-store.ts` | Append-only definition publication, activation, retirement, and integrity validation |
| `src/workflows/workflow-definition-version-validation.ts` | Stable validation/error boundary for persisted version and draft content |
| `src/workflows/workflow-definition-draft-store.ts` | Mutable revision-fenced editor/agent drafts |
| `src/workflows/workflow-definition-manager.ts` | Trusted database-definition validation and policy boundary |
| `src/workflows/workflow-definition-version-observability.ts` | Safe definition publication/activation/retirement events |
| `src/workflows/workflow-definition-http.plugin.ts` | Platform-admin draft/version API |
| `src/workflows/workflow-graph-store.ts` | Graph runtime persistence and transactions |
| `src/workflows/workflow-graph-node-metadata.ts` | Stable public-safe branch ancestry for live graph rows |
| `src/workflows/workflow-graph-planner.ts` | Ready/unreachable node planning from durable edges and decisions |
| `src/workflows/workflow-graph-state-reader.ts` | Coherent persisted graph snapshot reads and validation boundary |
| `src/workflows/workflow-graph-runtime.ts` | Version resolution and graph runtime composition |
| `src/workflows/workflow-graph-recovery.ts` | Fail-closed graph preflight and crash-left state recovery |
| `src/workflows/workflow-graph-pump.ts` | Coalesced per-instance graph advancement |
| `src/workflows/workflow-graph-activity-executor.ts` | Activity validation, attempts, memory commit, retries, and deadlines |
| `src/workflows/workflow-structural-node-controller.ts` | Choice, parallel, and join decisions |
| `src/workflows/workflow-each-controller.ts` | Snapshotted keyed fan-out and ordered result aggregation |
| `src/workflows/workflow-each-item-coordinator.ts` | Durable item/child-step reconciliation and claim transitions |
| `src/workflows/workflow-wait-controller.ts` | Durable event and interaction waits plus delivery activities |
| `src/workflows/workflow-interaction-authority.ts` | Fail-closed app/Guardian responder-authorization callback boundary |
| `src/workflows/workflow-interaction-store.ts` | Atomic private interaction, idempotent submission, and response-capacity persistence |
| `src/workflows/workflow-memory-store.ts` | Private scoped optimistic ReactiveDB scratch memory |
| `src/workflows/workflow-interaction-service.ts` | Channel-neutral interaction lifecycle and tracked authorization/validation work |
| `src/workflows/workflow-interaction-submission-processor.ts` | Authorization, schema/activity validation, and first-valid-wins response pipeline |
| `src/workflows/workflow-interaction-persisted-state.ts` | Recovery validation for public/private interaction envelopes |
| `src/workflows/workflow-interaction-response-integrity.ts` | Recovery validation and outcome derivation for private submissions |
| `src/workflows/workflow-interaction-event-bridge.ts` | Authenticated durable-event response adapter |
| `src/workflows/workflow-event-actor.ts` | Bounded private actor snapshots for event-delivered responses |
| `src/workflows/workflow-event-capacity-store.ts` | O(1), transactional pending/retained event count and byte accounting |
| `src/workflows/workflow-event-persisted-state.ts` | Fail-closed recovery validation for public/private event identity and counters |
| `src/workflows/workflow-graph-interaction-validator.ts` | Trusted activity validation context for interaction responses |
| `src/workflows/workflow-graph-wake-scheduler.ts` | Exact in-process graph retry/deadline timers |
| `src/workflows/workflow-step-definition.ts` | Definition-snapshot parsing and handler resolution |
| `src/workflows/workflow-persisted-state.ts` | Fail-closed validation of durable run rows/topology |
| `src/workflows/workflow-runtime-store.ts` | Durable internal event claims, attempt fences, and pause boundaries |
| `src/workflows/workflow-runtime-schema.ts` | Internal coordination DDL shared by runtime and migration 030 |
| `src/workflows/workflow-runtime-fence.ts` | Transaction-time managed/unmanaged runtime ownership boundary |
| `src/workflows/workflow-runtime-lease-schema.ts` | Private durable runtime generation lease DDL |
| `src/workflows/workflow-runtime-lease-store.ts` | Atomic generation acquire, renew, release, and unmanaged exclusion |
| `src/workflows/workflow-runtime-owner-lease.ts` | Managed service heartbeat, loss notification, and exact-generation fence |
| `src/workflows/workflow-runtime-json.ts` | JSON serialization and per-value durable runtime byte boundary |
| `src/workflows/workflow-runtime-budget.ts` | O(1), transactional per-instance aggregate runtime-value accounting |
| `src/workflows/workflow-persisted-state-values.ts` | Strict bounded JSON/scalar/timestamp recovery primitives |
| `src/workflows/workflow-repository.ts` | Prepared SQL reads/writes and durable transaction helpers |
| `src/workflows/workflow-instance-factory.ts` | Start-time validation and atomic instance/step persistence |
| `src/workflows/workflow-attempt-coordinator.ts` | Transactional prepare/commit, retry/deadline decisions, and attempt fences |
| `src/workflows/workflow-transition-controller.ts` | Pause, resume, and cancellation transitions |
| `src/workflows/workflow-lifecycle-coordinator.ts` | Recovery, retry/timeout discovery, and shutdown normalization |
| `src/workflows/workflow-executor.ts` | Physical handler invocation and cooperative abort/drain behavior |
| `src/workflows/workflow-service.ts` | Public facade routing graph and legacy-compatible runs |
| `src/workflows/workflow-start-router.ts` | Fail-closed graph/database/legacy start selection |
| `src/workflows/workflow-sync-policy.ts` | Owner/admin Sync visibility and read-only workflow tables |
| `src/workflows/workflow-public-record.ts` | HTTP/Sync executable-topology redaction |
| `src/workflows/workflow-error.ts` | Stable workflow-domain errors |
| `src/workflows/workflow-scheduler-owner.ts` | Owned retry/timeout job registration and cleanup |
| `src/workflows/workflow-plugin-runtime.ts` | Registration/recovery barrier and safe service publication |
| `src/workflows/workflow-runtime-owner-store.ts` | Process-local ownership unit for composed registry/service/shutdown state |
| `src/workflows/workflow-terminal-event-queue.ts` | Atomic terminal-run event discard and accounting cleanup |
| `src/workflows/workflow-http.plugin.ts` | Protected runtime/interaction routes and stable HTTP errors |
| `src/workflows/workflow.plugin.ts` | Thin Elysia composition facade |
| `src/workflows/index.ts` | Barrel exports |

**Client:**
| File | Purpose |
|------|---------|
| `src/frontend/client/workflow-hooks.ts` | Sync-backed nodes/interactions, parallel/wait flags, and HTTP actions |
| `src/frontend/client/workflow-run-hooks.ts` | Version-pinned start-and-watch composition, progress, and response actions |

**Key patterns:** `AppConfig.workflows.register` is awaited before definition,
activity, and persisted-state preflight. Every graph run pins canonical graph
content, definition version, fingerprint, and activity versions. Database/API
graphs can reference only explicitly `databaseCallable` activities.
Publication checks schema snapshots and output dominance, and immutable
content/draft envelopes are bounded before storage.

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

HTTP and Sync visibility is owner-scoped except for the global `admin` role.
Definitions, graph topology, scratch memory, interaction bodies, and graph
event payloads remain private. All graph instance/step input, output, and raw
error values are redacted; safe node/branch/item identity, event audit
metadata, and interaction progress let React hooks and a future graph UI
animate runs in real time without polling. Browser actions use
`client.api.workflows`. See
[Durable Workflows](./workflows.md).

---

## System 6: Scheduler

**What:** Cron-based job scheduler.

**Files:**
| File | Purpose |
|------|---------|
| `src/scheduler/scheduler.ts` | Scheduler class — register named cron jobs |
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
| `src/components/data-table/data-table-toolbar.tsx` | Search, generated filters, column visibility, and export toolbar |
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
| `src/components/faq/faq.tsx` | Public FAQ accordion with optional generated answer text |
| `src/components/expandable-card/expandable-card.tsx` | Public shared-layout expandable card gallery |
| `src/components/bento-grid/bento-grid.tsx` | Public bento grid layout, item, and skeleton components |
| `src/components/animated-list/animated-list.tsx` | Public sequenced animated list and event-card skin |
| `src/components/master-detail/master-detail-page.tsx` | `<MasterDetailView>` / `<MasterDetailPage>` — list + detail organism |
| `src/components/master-detail/use-master-detail-state.ts` | Live data and selected-row state for master-detail views |
| `src/components/master-detail/master-detail-selection.ts` | Pure primary-key-aware selection resolution |

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
LoginForm, RegisterForm, ForgotPasswordForm, EmailVerificationForm, PasswordActionForm, ChangePasswordForm, UserPropertiesForm, MFAContinuation, MFAEnrollmentForm, MFAChallengeForm, MFAManagementPanel, OTPVerification, PasswordInput, PasswordStrength, OTPInput, SocialLoginGroup, AuthLayout, AuthHeader, Gate, AdminGate, SignedIn, SignedOut, PropertyGate, HasProperty, HasFlag, useGate, usePropertyGate.

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

**Per-user state (full ack/rollback):**
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
