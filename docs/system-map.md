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
  notifications/           <- Notification service + plugin
  ai/                      <- Internal AI service, provider registry, tools, conversations, Meta adapter
  vector/                  <- zvec-backed local vector store, filters, AI bridge
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

**What:** JWT-based auth with user store, token rotation, role-based middleware.

**Files:**
| File | Purpose |
|------|---------|
| `src/auth/auth.plugin.ts` | Elysia plugin — defines user tables, token service, REST routes |
| `src/auth/auth.middleware.ts` | `createAuthMiddleware()` — resolve-based, provides `requireAuth/requireAdmin` |
| `src/auth/auth-admin.plugin.ts` | Admin user-management routes and capability/config response |
| `src/auth/auth-config.ts` | Auth behavior config normalization and typed config helper |
| `src/auth/auth.models.ts` | TypeBox request/response schemas |
| `src/auth/action-token-service.ts` | Auth compatibility wrapper over platform action tokens, with legacy-token fallback |
| `src/auth/account-email-service.ts` | Auth lifecycle email delivery through the platform email runtime |
| `src/auth/auth-account.plugin.ts` | Forgot-password, action-token inspect, reset-password, and setup-password routes |
| `src/auth/types.ts` | AuthContext, AuthError, UserRecord, action token types, AUTH_DEFAULTS |
| `src/auth/index.ts` | Barrel exports |

**Client:**
| File | Purpose |
|------|---------|
| `src/frontend/client/auth-client.ts` | AuthClient — login/register/logout/refresh, @xstate/store for state |

**Key pattern:** Auth guard uses Elysia's `resolve()` (not `derive()`) for type propagation across plugin boundaries. Named plugin with deduplication.

---

## System 2.1: Platform Doctor

**What:** Pure createApp config diagnostics plus a human-facing CLI.

**Files:**
| File | Purpose |
|------|---------|
| `src/doctor/platform-doctor.ts` | Pure app config checks for auth/email, schema PKs, storage, sync policy, resources, migrations, observability, AI, vector, and index guidance |
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

## System 5: Workflows

**What:** Durable multi-step workflow engine with retry, timeout, branching.

**Files:**
| File | Purpose |
|------|---------|
| `src/workflows/types.ts` | WorkflowDefinition, StepDefinition, StepContext |
| `src/workflows/workflow-registry.ts` | Register workflow definitions |
| `src/workflows/workflow-executor.ts` | Execute steps, handle branching/conditions |
| `src/workflows/workflow-service.ts` | CRUD, state machine, retry/timeout polling |
| `src/workflows/workflow.plugin.ts` | Elysia plugin — tables, REST routes |
| `src/workflows/index.ts` | Barrel exports |

**Client:**
| File | Purpose |
|------|---------|
| `src/frontend/client/workflow-hooks.ts` | useWorkflow, useWorkflowList, useWorkflowActions |

---

## System 6: Scheduler

**What:** Cron-based job scheduler.

**Files:**
| File | Purpose |
|------|---------|
| `src/scheduler/scheduler.ts` | Scheduler class — register named cron jobs |
| `src/scheduler/scheduler.plugin.ts` | Elysia plugin — @elysiajs/cron integration |
| `src/scheduler/index.ts` | Barrel exports |

**Pre-registered jobs:** workflow-retries (every minute), workflow-timeouts (every minute), notification-cleanup (every hour).

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

## System 9: DataTable + MasterDetail

**Docs:** [DataTableView](./frontend/data-table.md),
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
| `src/components/master-detail/master-detail-page.tsx` | `<MasterDetailView>` / `<MasterDetailPage>` — list + detail organism |
| `src/components/master-detail/use-master-detail-state.ts` | Live data and selected-row state for master-detail views |
| `src/components/master-detail/master-detail-selection.ts` | Pure primary-key-aware selection resolution |

---

## System 10: UI Components

**`src/components/ui/` — 35 core components:**
Button, Input, Label, Textarea, Select, Badge, Card, FormField, Table, ScrollArea, Separator, Skeleton, Avatar, Breadcrumb, Pagination, Calendar, Command, Combobox, DatePicker, DateRangePicker, TagInput, StatCard, Chart, ValidationMeter, ValidationRules, NotificationBadge, NotificationCenter, NotificationDropdown, NotificationItem, NotificationList, DetailPanel, ListDetailLayout, RecordNavigationBar, ThemeProvider, Toaster (Sonner).

**`src/components/animate-ui/` — 174 animated components:**
Organized into `primitives/` (raw building blocks) and `components/` (pre-styled compositions). Categories: buttons, radix UI (animated), effects, text animations, backgrounds, community components.

**`src/components/auth/` — auth UI blocks:**
LoginForm, RegisterForm, ForgotPasswordForm, PasswordActionForm, ChangePasswordForm, UserPropertiesForm, OTPVerification, PasswordInput, PasswordStrength, OTPInput, SocialLoginGroup, AuthLayout, AuthHeader, Gate, AdminGate, SignedIn, SignedOut, PropertyGate, HasProperty, HasFlag, useGate, usePropertyGate.

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
| `src/frontend/server/router-plugin.ts` | File-based router — scans app/ dir, SSR, API routes |
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
2. Auth plugin          (defines user tables on shared DB)
3. Auth middleware       (resolve-based, provides requireAuth/requireAdmin)
4. Observability        (sink endpoint + global error reporting)
5. AI                   (optional internal provider service)
6. Scheduler            (cron jobs — used by notifications + workflows)
7. Notifications        (depends on auth + scheduler)
8. Rooms                (depends on auth)
9. Workflows            (depends on auth + scheduler)
10. Storage             (depends on auth)
11. Data query          (`/api/data` for lazy tables)
12. Health check        (/api/health)
13. File-based router   (catch-all — must be last)
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
