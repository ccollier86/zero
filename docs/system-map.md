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
  rooms/                   <- Rooms, presence
  scheduler/               <- Cron job scheduler
  workflows/               <- Durable workflow engine
  schema/                  <- Schema definition system (defineSchema, field types)
  hooks/                   <- Utility React hooks (useForm, useHotkey, useConfirm, etc.)
  components/
    ui/                    <- Core UI primitives (35 components)
    forms/                 <- AutoForm, FieldRenderer, Wizard
    data-table/            <- DataTable + related components
    auth/                  <- Auth UI blocks (LoginForm, RegisterForm, Gate, etc.)
    master-detail/         <- MasterDetailPage
    animate-ui/            <- 174 animated components (framer-motion + radix)
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
| `src/auth/auth.models.ts` | TypeBox request/response schemas |
| `src/auth/types.ts` | AuthContext, AuthError, UserRecord, AUTH_DEFAULTS |
| `src/auth/index.ts` | Barrel exports |

**Client:**
| File | Purpose |
|------|---------|
| `src/frontend/client/auth-client.ts` | AuthClient — login/register/logout/refresh, @xstate/store for state |

**Key pattern:** Auth guard uses Elysia's `resolve()` (not `derive()`) for type propagation across plugin boundaries. Named plugin with deduplication.

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

**Files:**
| File | Purpose |
|------|---------|
| `src/components/data-table/data-table.tsx` | `<DataTable>` — full-featured table |
| `src/components/data-table/use-data-table.ts` | `useDataTable()` — TanStack Table wrapper |
| `src/components/data-table/data-table-column-header.tsx` | Sortable/filterable column headers |
| `src/components/data-table/data-table-toolbar.tsx` | Search + filter toolbar |
| `src/components/data-table/data-table-pagination.tsx` | Pagination controls |
| `src/components/data-table/data-table-row-actions.tsx` | Row action dropdown |
| `src/components/data-table/editable-cell.tsx` | Inline cell editing |
| `src/components/data-table/animated-cell.tsx` | Animated cell transitions |
| `src/components/master-detail/master-detail-page.tsx` | `<MasterDetailPage>` — list + detail layout |

---

## System 10: UI Components

**`src/components/ui/` — 35 core components:**
Button, Input, Label, Textarea, Select, Badge, Card, FormField, Table, ScrollArea, Separator, Skeleton, Avatar, Breadcrumb, Pagination, Calendar, Command, Combobox, DatePicker, DateRangePicker, TagInput, StatCard, Chart, ValidationMeter, ValidationRules, NotificationBadge, NotificationCenter, NotificationDropdown, NotificationItem, NotificationList, DetailPanel, ListDetailLayout, RecordNavigationBar, ThemeProvider, Toaster (Sonner).

**`src/components/animate-ui/` — 174 animated components:**
Organized into `primitives/` (raw building blocks) and `components/` (pre-styled compositions). Categories: buttons, radix UI (animated), effects, text animations, backgrounds, community components.

**`src/components/auth/` — 12 auth UI blocks:**
LoginForm, RegisterForm, ForgotPasswordForm, OTPVerification, PasswordInput, PasswordStrength, OTPInput, SocialLoginGroup, AuthLayout, AuthHeader, Gate, useGate.

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
| `src/frontend/server/types.ts` | AppConfig, ResolvedConfig |

**Router:**
| File | Purpose |
|------|---------|
| `src/frontend/router/types.ts` | RouteModule, RouteNode, MatchResult, LoaderContext |
| `src/frontend/router/scanner.ts` | Scans app/ directory for route files |
| `src/frontend/router/matcher.ts` | URL pattern matching |
| `src/frontend/router/renderer.ts` | React SSR renderer |

**Main barrel export:** `src/frontend/index.ts` (`@platform/frontend`) -- exports everything apps need: `defineTable`, `field`, `defineSchema`, `schema`, `InferRow`, `useCollection`, `useLazyCollection`, `CrudPage`, `AppProvider`, hooks, components. `@platform/server` is only for `app/server.ts`.

---

## Plugin Composition Order (app-factory.ts)

```
1. Sync engine          (provides ReactiveDB — must be first)
2. Auth plugin          (defines user tables on shared DB)
3. Auth middleware       (resolve-based, provides requireAuth/requireAdmin)
4. Scheduler            (cron jobs — used by notifications + workflows)
5. Notifications        (depends on auth + scheduler)
6. Rooms                (depends on auth)
7. Workflows            (depends on auth + scheduler)
8. Health check         (/api/health)
9. File-based router    (catch-all — must be last)
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

1. **Start with `src/frontend/index.ts`** (`@platform/frontend`) -- the barrel export shows everything apps can import
2. **Read `src/frontend/server/app-factory.ts`** -- shows how all plugins compose (`@platform/server`)
3. **Read `src/sync/types.ts`** -- defines the wire protocol and all core types
4. **Read `src/sync/sync.plugin.ts`** -- the engine that makes everything real-time
5. **Read `src/frontend/client/sdk.ts`** -- the client-side wiring
6. **Read `src/schema/define-schema.ts`** -- how `defineTable` and `field` drive everything
7. **Pick any system directory** -- each has its own `index.ts` barrel with clean exports
