# Zero Platform Hardening Plan

This document captures the current platform assessment, issue inventory, and backend-first fix plan. The intent is to work through one numbered item at a time and keep this file updated as decisions and fixes land.

Companion references:

1. `docs/elysia-practices-audit.md` records the Elysia plugin, lifecycle, validation, dependency, and testing practices that backend fixes should follow.
2. `docs/engineering-standards.md` records SOLID, separation-of-concerns, responsibility, front matter, and method signature comment standards.
3. `docs/observability-audit.md` records the current logging, warning, error, and audit paths before the observability sink layer is implemented.
4. `docs/observability.md` documents the implemented observability sink, event store, endpoint, and frontend adapter.
5. `docs/platform-configuration.md` defines the focused config-file protocol
   that should keep `createApp()` small as auth/access and later systems grow.

Before each new implementation run, check `docs/engineering-standards.md` and
`docs/observability.md`. New logs, warnings, caught errors, and lifecycle
events should use the observability boundary, and touched code that still uses
ad-hoc logging should be corrected when it is in scope.

## 1. Current Opinion

Zero has a strong core. The architecture is coherent: Bun, Elysia, SQLite, in-process realtime sync, React SSR, schema-driven UI, and a single app factory all point toward the same goal: define data once, wire the platform once, and build product screens quickly.

The platform does not need a rewrite. It needs contract hardening. Several major features already exist, but the edges are not fully closed: schema-driven UI has polish gaps, and broader frontend ergonomics need another pass now that the backend contracts are firmer.

The highest-leverage path is backend first: security, sync permissions, storage auth, data access rules, migrations, build scripts, and test stability. Once those contracts are solid, frontend SDK and UI polish becomes much easier because app code can rely on stable backend behavior.

## 2. Main Architecture Model

Zero is a single-process Bun/Elysia full-stack platform.

1. `ReactiveDB` wraps SQLite with table definitions, prepared CRUD, transactions, change tracking, and a reconnect ring buffer.
2. The sync plugin exposes `/sync` over WebSocket and turns DB changes into Bun pub/sub broadcasts.
3. The auth plugin owns users, credentials, refresh tokens, JWTs, and auth middleware for HTTP requests.
4. State sync stores per-user persistent key-value state over the same WebSocket.
5. Ephemeral state stores RAM-only topic state for presence and high-frequency shared UI state.
6. Domain plugins provide rooms, notifications, workflows, scheduler, and storage.
7. The frontend SDK wraps auth, optimistic collections, WebSocket sync, state sync, ephemeral state, HTTP helpers, Eden Treaty, and React hooks.
8. The router provides file-based routing, streaming SSR, API routes, and selective hydration for `"use client"` pages.
9. `createApp()` composes the full backend: sync, auth, auth middleware, scheduler, notifications, rooms, workflows, storage, lazy data query, health, and finally the file router.

## 3. Critical Issues

### 3.1 WebSocket Auth Is Incomplete

`/sync?token=...` accepts a token but does not verify it or set `ws.data.authContext`.

Impact:

1. State sync cannot work correctly through the normal app path because state handlers require `ws.data.authContext?.userId`.
2. Presence and ephemeral state fall back to anonymous connection IDs instead of authenticated users.
3. Sync has no authenticated identity for table policy decisions.

### 3.2 Sync Table Access Is Too Broad

Before item 7.2, `allowedTables` defaulted to every non-internal table and was also used as a write gate.

Current status: partially addressed in 7.2. `allowedTables` is now read/subscription state derived through `SyncPolicy.canReadTable`, and direct sync mutation is checked separately through mutation policy. Standalone sync still defaults to allow-all for app tables unless a policy is configured.

Impact:

1. Raw sync clients can subscribe to all non-internal tables unless app code adds policy externally.
2. Raw sync clients can mutate allowed tables because read access and write access are not separated.
3. Platform tables such as notifications, rooms, workflows, and storage can become too permissive if exposed through generic sync mutation.

### 3.3 Missing Read/Write Policy Separation

The sync layer needs separate rules for:

1. Whether a socket may subscribe to a table.
2. Whether a socket may insert into a table.
3. Whether a socket may update a row.
4. Whether a socket may delete a row.

Impact:

1. Many tables should be readable but not client-writable.
2. Some tables should only be writable through domain services or HTTP routes.
3. Row ownership rules cannot be expressed cleanly yet.

Current status: addressed for table-level and operation-level decisions in 7.2. Row-level policy can now be implemented by inspecting `row`, `rowId`, `op`, and `authContext` inside the mutation callbacks.

### 3.4 Storage Auth Path Is Broken On The Client

Storage hooks read `localStorage.access_token`, but `AuthClient` stores access tokens in memory and stores only the refresh token in localStorage.

Impact:

1. Storage hooks may send no Authorization header.
2. Upload, list, download, usage, and permission actions can fail for authenticated users.
3. Storage bypasses the SDK's token refresh behavior.

Status: fixed in 8.1. Storage hooks now require the platform SDK client, JSON
storage routes call `client.fetch()`, and upload XHR requests use `client.token`
with a single `client.refresh()` retry on 401.

### 3.5 Storage Plugin Type Context Fails

TypeScript does not see `authContext` and `requireAuth` in `storage.plugin.ts`.

Impact:

1. `bun run typecheck` fails.
2. Storage plugin composition is too implicit.
3. Standalone plugin use is risky unless auth middleware ordering is exactly right.

Status: fixed in 7.5. `createStoragePlugin()` now declares `createAuthMiddleware(getTokenService)` internally, maps `AuthError` responses, and has route tests for storage auth behavior.

## 4. Correctness And Drift Issues

### 4.1 Auto-PK Test Drift

Auto-PK insert is now implemented, but one test still expects missing primary keys to throw.

Decision needed:

1. If auto-PK is intended DX, update the test.
2. If explicit PK is required for some tables, make that a schema/table option.

Current direction: keep auto-PK as the default because it improves app-building speed.

### 4.2 Sync Snapshot Test Drift

The migration notes say `sync.subscribe` no longer falls back to all tables when `snapshot` is missing. Snapshot tables are now explicit.

Impact:

1. Two sync integration tests fail because they omit `snapshot`.
2. Tests should be updated to match the lazy-sync protocol.

### 4.3 Import Alias Drift

Docs consistently use `@platform/frontend`, but `tsconfig.json` defines `@platform/react` instead.

Impact:

1. App authors following docs will hit import failures.
2. Some source files still use `@platform/react`.
3. The public import surface is less clear than intended.

Current direction: add `@platform/frontend` aliases and migrate source/docs toward that as the canonical app import. Keep compatibility aliases if needed.

Status: fixed in 7.9. `@platform/frontend` is now the canonical client-safe alias, source no longer imports `@platform/react`, and `@platform/react` remains as a compatibility alias for older client-subpath imports.

### 4.4 Auth Defaults Differ

Before 8.2, backend omitted `auth` meant disabled, while frontend `AppProvider` defaulted `auth` to true.

Impact:

1. Apps can accidentally create a frontend that expects auth against a backend without auth.
2. State sync can be enabled without the authenticated WS path it needs.

Status:

1. Make backend auth default explicit and documented.
2. Done in 7.4: require `auth: true` or an auth config object when `stateSync: true`.
3. Done in 8.2: raw SDK auth now defaults to false, `AppProvider` uses server-injected `auth`/`stateSync` when props are omitted, and explicit frontend/backend auth mismatches throw clear configuration errors.

### 4.5 Build Script Drift

`package.json` scripts point `dev` and `build` at missing `src/index.ts`.

Impact:

1. `bun run build` fails immediately.
2. New users cannot rely on package scripts.

Current direction: either add a real platform entrypoint or change scripts to the actual intended server/app entry.

Status: fixed in 7.8. Scripts now target the runnable `app/server.ts` entry; generated `dist/` and `.build/` outputs are ignored.

## 5. Performance And Data Opportunities

### 5.1 Lazy Query Endpoint Needs More Structure

`/api/data` is useful, but it should grow carefully.

Potential improvements:

1. Pagination.
2. Sort.
3. Filter operators.
4. Result limits.
5. Index guidance.
6. Auth and sync policy integration.

### 5.2 Snapshot Size Needs Guardrails

Full snapshots are convenient but can become expensive.

Potential improvements:

1. Done: auto mode warns, rejects, or resolves large tables to lazy sync based
   on configurable row limits.
2. Done: resolved lazy tables are removed from websocket snapshots and routed
   through `/api/data` for on-demand loading.
3. Remaining: add richer diagnostics for large initial payloads and table/index
   health.

### 5.3 Ring Buffer Needs Auth-Aware Tests

Reconnect catchup should be tested with:

1. Lazy tables.
2. Auth-filtered table access.
3. Pruned sequence fallback.
4. Pending optimistic mutations during reconnect.

### 5.4 Storage Backend Should Share One Auth Model

Storage routes, storage hooks, and the SDK should all share the same auth and refresh behavior.

Status: fixed across the current storage surface. Backend route auth was fixed
in 7.5. Frontend hooks now use SDK auth in 8.1: JSON calls go through
`client.fetch()`, upload XHR reads `client.token`, and upload 401s retry once
after `client.refresh()`.

## 6. DX And Polish Opportunities

### 6.1 One Canonical App Import

The intended app import should be:

```ts
import { defineTable, field, useCollection, CrudPage } from '@platform/frontend';
```

Server-only code should use:

```ts
import { createApp } from '@platform/server';
```

### 6.2 Better Platform Diagnostics

Future `platform doctor` checks could include:

1. Missing import aliases.
2. Missing platform entrypoint.
3. Backend/frontend auth mismatch.
4. `stateSync: true` without auth.
5. Lazy tables without query support.
6. Missing migrations.
7. Missing primary keys.
8. Unsupported composite primary keys in ReactiveDB-managed tables.

### 6.3 Custom Primary Key Limits Need Clarity

ReactiveDB supports arbitrary single-column primary keys. Before 8.3, many UI helpers assumed `id`.

Historical impact:

1. `InferRow` always adds `id`.
2. `CrudPage`, `DataTable`, and other helpers often assume `row.id`.
3. Apps with custom PKs may hit rough edges.

Status: fixed for single-column primary keys in 8.3. `SchemaDescriptor` now
carries `primaryKey`; `InferRow` uses the configured `pk`; and `CrudPage`,
`DataTable`, and `MasterDetailPage` use schema primary keys for row identity,
selection, editing, update, and delete flows. Composite primary keys remain
unsupported by ReactiveDB-managed tables.

Follow-up status: addressed with natural identity. ReactiveDB still requires a
single string sync primary key, but schemas can now declare
`identity: ['field_a', 'field_b']` / `_identity`. The platform generates
deterministic sync ids from those fields, adds a unique identity index, exposes
`queryByIdentity()`, `upsertByIdentity()`, `updateByIdentity()`, and
`deleteByIdentity()` on ReactiveDB, and exposes matching collection helpers on
the frontend. Identity fields are immutable, and plain inserts reject natural
identity collisions before SQLite can silently replace a row on the unique
index. This preserves the fast sync protocol while covering relationship-table
use cases such as memberships, attendance, votes, follows, and join tables.

### 6.4 Structured Field Serialization Needs A Contract

Schema fields include JSON-like values such as multi-select arrays, tags, date ranges, and objects. Many map to SQL `text`.

Impact:

1. Serialization/deserialization is not centralized.
2. AutoForm and DataTable can produce values that need consistent storage conversion.

Status: fixed in 8.4 for built-in field types. `SchemaDescriptor` now exposes
field and row encode/decode helpers; `useForm` decodes defaults/loaded rows and
encodes submit payloads; `DataTable` decodes cell display values and encodes
inline edit writes.

## 7. Backend-First Fix Plan

### 7.1 Wire WebSocket Auth

Goal: `/sync` verifies access tokens and populates socket auth context.

Status: implemented.

Work:

1. Done: added a sync auth bridge and WebSocket token verification in the sync `open` lifecycle.
2. Done: `createApp()` wires the existing auth token service into sync through a lazy verifier.
3. Done: valid tokens populate `ws.data.authContext`.
4. Done: invalid provided tokens close with code `4001`.
5. Done: messages are ignored until async WebSocket auth resolution completes.
6. Done: standalone/no-auth sync remains possible when no auth bridge is configured; optional missing-token sync remains anonymous.
7. Done: added unit tests for token resolution and WebSocket integration tests for user token, admin token, invalid token, required missing token, and optional anonymous behavior.

Verification:

1. `bun test src/sync/sync-auth.test.ts src/sync/sync-auth.integration.test.ts` passes: 12 tests.
2. `bun test src/sync/state-integration.test.ts` passes: 25 tests.
3. Full `bun test` now reports 304 passing and the same 3 known drift failures: two sync snapshot tests and one auto-PK test.
4. `bun run typecheck` still fails on the previously known storage/UI issues; no new sync/auth errors were reported.

Documentation updated:

1. `docs/realtime-sync/realtime-sync/protocol.md`
2. `docs/realtime-sync/realtime-sync/architecture.md`
3. `docs/auth/architecture.md`
4. `docs/state-sync.md`

### 7.2 Add Sync Policy

Goal: replace broad table access with explicit read/write rules.

Status: implemented.

Work:

1. Done: added `SyncPolicy`, `SyncReadPolicyContext`, and `SyncMutationPolicyContext` in `src/sync/sync-policy.ts`.
2. Done: `canReadTable` controls subscriptions/snapshots; `canMutateTable` controls direct `sync.mutate`.
3. Done: added operation-specific callbacks: `canInsert`, `canUpdate`, and `canDelete`.
4. Done: mutation callbacks receive `row`, `rowId`, `op`, and `authContext`, which supports row-level app policy without coupling sync to app domains.
5. Done: `createApp()` installs platform-safe write protection for `users`, `notifications`, rooms, workflows, and storage metadata tables.
6. Done: added `syncPolicy` to app config and deny-wins composition with platform defaults.

Verification:

1. `bun test src/sync/sync-policy.test.ts src/sync/sync-policy.integration.test.ts src/sync/sync-auth.test.ts src/sync/sync-auth.integration.test.ts src/sync/state-integration.test.ts` passes: 43 tests.
2. Full `bun test` now reports 310 passing and the same 3 known drift failures: two sync snapshot tests and one auto-PK test.
3. `bun run typecheck` still fails on the previously known storage/UI issues; no new sync policy errors were reported.

Documentation updated:

1. `docs/realtime-sync/realtime-sync/protocol.md`
2. `docs/realtime-sync/realtime-sync/architecture.md`
3. `docs/realtime-sync/realtime-sync/README.md`
4. `docs/auth/architecture.md`
5. `docs/auth/guards-and-audit.md`
6. `docs/platform-overview.md`
7. `docs/sdk-reference.md`
8. `docs/elysia-practices-audit.md`
9. `docs/frontend/README.md`
10. `docs/state-sync.md`

### 7.3 Lock Down Platform Tables

Goal: prevent direct client mutation of sensitive platform-owned tables.

Status: implemented.

Work:

1. Done: notification creation already flows through notification service/routes.
2. Done: notification receipt actions now flow through authenticated notification routes instead of direct `notification_receipts` sync writes.
3. Done: added `NotificationService.markAllSeen()` and `POST /notifications/seen-all`.
4. Done: `useNotifications()` now calls authenticated HTTP routes for seen/read/dismiss/read-all/seen-all and relies on ReactiveDB sync broadcasts for receipt state updates.
5. Done: `notification_receipts` is now included in the platform sync write-protected table set.
6. Done: fixed `createAuthMiddleware()` so `requireAuth()` and `requireAdmin()` are resolved from the same async request lifecycle as `authContext`; this makes route-side authorization work correctly for service-owned table writes.
7. Existing service-owned tables remain write-protected by the 7.2 platform policy: users, notifications, rooms, workflows, and storage metadata.

Verification:

1. `bun test src/notifications/notification.plugin.test.ts src/auth/integration.test.ts src/sync/sync-policy.test.ts src/sync/sync-policy.integration.test.ts` passes: 32 tests.
2. Full `bun test` now reports 313 passing and the same 3 known drift failures: two sync snapshot tests and one auto-PK test.
3. `bun run typecheck` still fails only on the previously known storage/UI issues: storage badge variant, storage local adapter buffer type, and storage plugin missing auth context.

Documentation updated:

1. `docs/sdk-reference.md`
2. `docs/platform-overview.md`
3. `docs/auth/architecture.md`
4. `docs/elysia-practices-audit.md`
5. `docs/auth/README.md`

### 7.4 Fix State Sync Through Authenticated WS

Goal: state sync works for authenticated users and fails clearly otherwise.

Status: implemented.

Work:

1. Done in 7.1: `state.subscribe` receives `ws.data.authContext` after WebSocket token verification.
2. Done in 7.1: added authenticated WebSocket state sync tests for user and admin tokens.
3. Done in existing state tests: unauthenticated state operations return clear unauthorized behavior or no-op for subscribe.
4. Done: `resolveConfig()` now rejects `stateSync: true` unless auth is enabled, because server state is keyed by authenticated user.

Verification:

1. `bun test src/frontend/server/types.test.ts src/sync/sync-auth.integration.test.ts src/sync/state-integration.test.ts` passes: 33 tests.
2. Full `bun test` now reports 316 passing and the same 3 known drift failures: two sync snapshot tests and one auto-PK test.
3. `bun run typecheck` still fails only on the previously known storage/UI issues: storage badge variant, storage local adapter buffer type, and storage plugin missing auth context.

Documentation updated:

1. `docs/state-sync.md`
2. `docs/frontend/sdk.md`
3. `docs/sdk-reference.md`

### 7.5 Fix Storage Backend Typing And Auth

Goal: storage plugin typechecks and has explicit auth dependencies.

Status: implemented.

Work:

1. Done: `createStoragePlugin()` now declares `.use(createAuthMiddleware(getTokenService))` in the plugin that consumes `authContext` and `requireAuth`.
2. Done: storage routes now map `AuthError` to `{ error, code }` with the correct HTTP status.
3. Done: `LocalStorageAdapter` normalizes hash input to `ArrayBuffer`, clearing the Web Crypto `BufferSource` type mismatch.
4. Done: `StorageService.updateDrive()` preserves omitted fields in partial updates instead of writing `undefined`.
5. Done: added storage route tests for unauthenticated writes, private owner reads, public anonymous reads, forbidden non-owner updates, owner updates, and admin updates.
6. Done: `@platform/server` exports the auth plugin factory/middleware needed by standalone plugin composition examples.
7. Done: standalone storage requirements are documented.

Verification:

1. `bun test src/storage/storage.plugin.test.ts` passes: 5 tests.
2. `bun test src/storage/storage.plugin.test.ts src/notifications/notification.plugin.test.ts src/auth/integration.test.ts` passes: 31 tests.
3. Full `bun test` now reports 321 passing and the same 3 known drift failures: two sync snapshot tests and one auto-PK test.
4. `bun run typecheck` now fails only on the known storage management badge variant; storage plugin auth context and local adapter digest type errors are resolved.

Documentation updated:

1. `docs/sdk-reference.md`
2. `docs/platform-overview.md`
3. `docs/elysia-practices-audit.md`
4. `docs/platform-hardening-plan.md`

### 7.6 Fix Test Drift

Goal: tests describe intended current behavior.

Status: implemented.

Work:

1. Done: sync integration tests now include explicit `snapshot: ['todos']` wherever they expect initial table contents.
2. Done: auto-PK client test now expects generated primary keys and verifies the generated ID is used for optimistic state and the outbound mutation row.
3. Done: added a no-snapshot subscribe test proving live changes still flow when a table is subscribed but omitted from `snapshot`.
4. Done: reconnect catchup test now requests snapshot tables explicitly, so fallback snapshots contain the expected table.

Verification:

1. `bun test src/sync/integration.test.ts src/sync/client/sync-client.test.ts` passes: 36 tests.
2. Full `bun test` passes: 325 tests.
3. `bun run typecheck` still fails only on the known storage management badge variant.

Documentation updated:

1. `docs/frontend/sdk.md`
2. `docs/platform-hardening-plan.md`

### 7.7 Fix Typecheck

Goal: `bun run typecheck` passes.

Status: implemented.

Work:

1. Done: replaced the invalid storage management `NavigationAction` variant `"secondary"` with the supported neutral `"default"` variant.

Verification:

1. `bun run typecheck` passes.
2. Full `bun test` passes: 325 tests.

Documentation updated:

1. `docs/platform-hardening-plan.md`

### 7.8 Fix Build Scripts

Goal: package scripts work for new users.

Status: implemented.

Work:

1. Done: decided not to add `src/index.ts` as an executable entry because the existing source already has client-safe and server-only barrels.
2. Done: added `app/server.ts` as the runnable example app server entry.
3. Done: updated `dev` to run `bun --watch app/server.ts`.
4. Done: updated `build` to bundle `app/server.ts` to `dist/server.js`.
5. Done: added `build:binary` for the single-binary compile path.
6. Done: added `src/build-scripts.test.ts` to guard script entrypoints against missing-file drift.
7. Done: added `.build/` to `.gitignore` because app startup generates client bundles there.

Verification:

1. `bun test src/build-scripts.test.ts` passes: 2 tests.
2. `bun run build` passes and writes ignored `dist/server.js`.
3. `PORT=0 bun app/server.ts` starts cleanly and shuts down cleanly on SIGINT.
4. `bun run typecheck` passes.
5. Full `bun test` passes: 327 tests.

Documentation updated:

1. `docs/platform-hardening-plan.md`

### 7.9 Fix Import Aliases

Goal: docs and code agree on public imports.

Status: implemented.

Work:

1. Done: added `@platform/frontend` and `@platform/frontend/*` to `tsconfig.json`.
2. Done: kept `@platform/react` and `@platform/react/*` as compatibility aliases for older client-subpath imports.
3. Done: removed the remaining source imports from `@platform/react/hooks`.
4. Done: updated the schema registry example to augment `@platform/frontend`.
5. Done: updated stale roadmap and scheduler docs import examples away from `@platform/react` / frontend server APIs.
6. Done: exported registry types from the frontend barrel without colliding with the UI `TableRow` component.

Verification:

1. `rg -n "@platform/react" docs src app tsconfig.json` now finds only the compatibility aliases and historical hardening-plan references.
2. `bun run typecheck` passes.
3. `bun run build` passes.
4. Full `bun test` passes: 327 tests.

Documentation updated:

1. `docs/sdk-reference.md`
2. `docs/platform-roadmap.md`
3. `docs/platform-hardening-plan.md`
4. `src/schema/registry.ts` API example

## 8. Frontend Follow-Up Plan

Do this after backend contracts are stable.

### 8.1 Storage Hooks Use SDK Auth

Goal: storage hooks send correct Authorization headers and benefit from token refresh.

Work:

1. Done: replaced `localStorage` token lookup with `useClientMaybe()` and SDK-owned auth state.
2. Done: JSON storage hooks and actions now call `client.fetch()` through one storage API helper.
3. Done: multipart upload still uses `XMLHttpRequest` for progress, but reads `client.token` and retries once after `client.refresh()` on 401.
4. Done: `client.fetch()` now accepts `signal?: AbortSignal` so storage list/usage effects can abort cleanly.
5. Deferred: a dedicated `client.storage` namespace is not needed yet; the hook API remains small and stable.

Validation:

1. Added `src/storage/storage-hooks.test.ts` to guard against direct browser token reads.
2. `bun test src/storage/storage-hooks.test.ts` passes: 2 tests.
3. `bun run typecheck` passes.
4. `bun test` passes: 329 tests across 19 files.
5. `bun run build` passes.

### 8.2 Reconcile AppProvider Auth Defaults

Goal: frontend auth behavior matches backend configuration.

Work:

1. Done: raw `createClient()` auth now defaults to false, matching `createApp()`.
2. Done: `createClient({ stateSync: true })` rejects unless `auth: true`.
3. Done: `AppProvider` resolves omitted `auth` and `stateSync` props from `window.__PLATFORM_CONFIG__`.
4. Done: `createApp()` injects resolved `auth` and `stateSync` into the platform config rendered for client pages.
5. Done: explicit `<AppProvider auth>` against a server-injected `auth: false` throws a clear configuration error.
6. Done: auth-disabled SDK actions reject with a clear configuration error instead of calling missing `/auth/*` routes.
7. Done: `autoConnect: false` is now honored by `createSyncClient()` and `createClient()`; call `client.connect()` to open the WebSocket later.

Validation:

1. Added `src/frontend/client/sdk.test.ts` for SDK auth defaults and state-sync prerequisite.
2. Added a sync-client test for `autoConnect: false`.
3. `bun test src/frontend/client/sdk.test.ts src/sync/client/sync-client.test.ts` passes: 30 tests.
4. `bun run typecheck` passes.
5. `bun test` passes: 332 tests across 20 files.
6. `bun run build` passes.

### 8.3 Polish CrudPage And DataTable

Goal: schema-driven CRUD is reliable for real apps.

Work:

1. Done: `SchemaDescriptor` now stores `primaryKey`, and `defineTable()` / `schema()` preserve custom `pk` values.
2. Done: `InferRow`, `CrudPage`, `DataTable`, `useDataTable`, and `MasterDetailPage` use schema primary keys instead of assuming `row.id`.
3. Done: create flows pre-generate the schema primary key before optimistic insert, so callbacks receive the persisted row identity.
4. Done: edit flows strip the primary key from update partials before calling collection updates.
5. Done: lazy collection fetches ignore stale responses and wait for a mounted client before marking a cache key loaded.
6. Done: lazy `CrudPage` renders loading and error states.
7. Deferred: broad field serialization/default conversion belongs to 8.4 field codecs.

Validation:

1. Added `src/components/data-table/row-identity.test.ts` for schema primary-key metadata and row identity helpers.
2. `bun test src/components/data-table/row-identity.test.ts` passes: 4 tests.
3. `bun run typecheck` passes.
4. `bun test` passes: 336 tests across 21 files.
5. `bun run build` passes.

### 8.4 Add Field Codecs

Goal: schema fields own their serialization contract.

Work:

1. Done: added `src/schema/field-codecs.ts` for built-in field conversion.
2. Done: added `decodeField`, `encodeField`, `decodeRow`, and `encodeRow` to `SchemaDescriptor`.
3. Done: `useForm` decodes defaults and loaded rows, then encodes submit payloads before collection writes or `onSubmit`.
4. Done: `DataTable` decodes accessor values for display/editing and encodes inline edits before collection updates.
5. Done: booleans encode to `0/1`; multi-select, tags, date ranges, JSON, and multi-combobox values encode to JSON text.

Validation:

1. Added `src/schema/field-codecs.test.ts` for row encode/decode behavior.
2. `bun test src/schema/field-codecs.test.ts src/components/data-table/row-identity.test.ts` passes: 6 tests.
3. `bun run typecheck` passes.
4. `bun test` passes: 338 tests across 22 files.
5. `bun run build` passes.

## 9. Remaining From Initial Investigation

Sections 1-6 were the initial assessment and opportunity inventory. They were
not skipped implementation steps; the first concrete fix sequence started at
7 because the highest-risk backend contracts needed to land first.

Resolved from sections 3-6:

1. WebSocket auth is wired and tested.
2. Sync read/write policy is separated and service-owned platform tables are
   protected from direct client mutation.
3. State sync now requires an authenticated backend configuration.
4. Storage backend auth and storage hook auth now share the SDK auth path.
5. Auto-PK, explicit snapshot, import alias, auth default, typecheck, and build
   script drift are fixed.
6. Single-column custom primary keys and built-in structured field codecs are
   supported by the schema-driven UI.
7. Ring-buffer reconnect coverage now includes lazy table catchup,
   auth-aware table filtering, pruned sequence fallback, and pending
   optimistic mutations during reconnect.
8. `/api/data` now supports validated pagination, sort direction, explicit
   filter operators, result caps, page metadata, SDK hook options, sync read
   policy enforcement, and documented index guidance.
9. Omitted table sync mode now defaults to auto-lazy protection: startup
   resolves full/lazy mode from row counts, persists auto decisions in
   `_zero_sync_table_modes`, enforces snapshot eligibility server-side, exposes
   resolved modes to `AppProvider`, and keeps explicit full/lazy declarations
   authoritative.

Still open from sections 5-6:

1. Keep composite primary keys explicitly unsupported for ReactiveDB-managed
   tables unless the storage/query/sync contracts are redesigned for them.

Observability status: first slice addressed. Zero now has stable event codes,
a framework-independent sink contract, console and bounded memory defaults, a
protected `/api/_zero/observability/events` endpoint, a browser-side frontend
sink, optional Elysia trace emission, and routed backend/frontend platform
events. See `docs/observability.md`. OpenTelemetry and user activity audit are
deferred optional feature slices.

Migration ergonomics status: addressed. Migrations now have an append-only
`_zero_migrations` ledger, `_zero_schema_history` snapshots, artifact tracking,
safety classes, rollback, destructive-change backup gates, `migrate:doctor`,
and `migrate:plan` draft generation. See `docs/migrations.md`.

## 10. Planned Feature Review

After hardening, revisit roadmap docs and decide what still matters.

Candidate areas from existing docs:

1. Auth metadata, access-control policies, tenancy-aware row scoping, adaptive
   admin UI, and storage-backed avatars. See
   `docs/auth/metadata-access-avatar-plan.md`.
2. Storage API completion and SDK polish.
3. Vector search.
4. Webhooks outbound and inbound.
5. Observability: warning/error/log sinks, analytics drains, and OpenTelemetry-
   style export where it fits the backend and frontend runtime.
6. Platform knowledge package.
7. MCP/CLI enhancement tools.
8. Sketch-to-app assembly system.
9. Serverless-style functions.
10. Better audit/activity tracking.
11. Route-level guards and richer middleware.

## 11. Current Verification Snapshot

Dependencies were installed with `bun install` so checks could run.

Current results:

1. `bun run typecheck` passes.
2. `bun test` passes: 384 tests across 31 files.
3. `bun run build` passes.

Resolved historical failures:

1. `sync engine integration > subscribe -> snapshot flow`
2. `sync engine integration > reconnect with catchup`
3. `mutations > throws on missing primary key`

These were test drift from the lazy-sync and auto-PK migration and were fixed
in hardening item 7.6.

## 12. Working Rule

Work one numbered item at a time. For each item:

1. Confirm intended behavior.
2. Implement the smallest coherent fix.
3. Add or update tests.
4. Run relevant checks.
5. Check the change against `docs/elysia-practices-audit.md`.
6. Check the change against `docs/engineering-standards.md`.
7. Update the relevant product, architecture, or API documentation in the same pass.
8. Update this document with status and any decisions.
