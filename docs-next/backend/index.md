---
id: zero.backend
type: index
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
---

# Backend Systems

[Documentation index](../index.md)

Zero's backend is an integrated Bun/Elysia application platform. Declarations
describe data and policy; managed composition supplies app-local services,
transport and lifecycle. Use the platform's public service boundaries rather
than importing implementation files or reconstructing authentication in routes.

## Data Definitions

- [Schema](./schema/index.md): declare fields and tables once, share validation
  and UI metadata, choose row identity and reference Guardian identities safely.
- [Resources](./resources/index.md): declared transport, realm, action and field
  policy shared by generated CRUD, lazy queries and realtime data.
- [Migrations](./migrations/index.md): ordered per-plane changes, retained
  checksums, schema history, safe planning and backup/rollback boundaries.
- [Data Studio](./data-studio/index.md): organization-owned logical tables,
  versioned schemas, canonical cells and permission-controlled editing/querying.
- [ReactiveDB](./reactive-db/index.md): tracked SQLite writes, canonical changes,
  transactions, snapshots and local/replica delivery with explicit raw boundaries.
- [Persistence](./persistence/index.md): file/hot/ephemeral storage, WAL,
  snapshots, raw SQL helpers and owned durability/lifecycle boundaries.
- [Fabric](./fabric/index.md): independent actor-backed databases, tenant
  isolation, shallow identity mirrors, concurrency and file/hot placement.
- [Database functions and triggers](./database-automations/index.md): tracked
  synchronous functions/AFTER triggers and durable post-commit actions.

## Server Composition

- [Platform configuration](./configuration/index.md): typed declarations,
  feature switches, data modes, precedence, routing and safe diagnostics.
- [Runtime and extensions](./runtime/index.md): app-local composition, validated
  endpoints, routers, middleware and plugin lifecycle.

## Identity And Authority

- [Guardian](./guardian/index.md): authentication, configurable tenancy and RBAC,
  live credential/membership authority and account administration.
- [Native authentication SDKs](./native-auth/index.md): framework IPC broker,
  Rust/Tauri and Chrome-extension clients with independently versioned boundaries.
- [Platform tokens](./tokens/index.md): opaque consume-once actions and reusable
  resource continuations, separate from Guardian session/API-key credentials.

## AI Execution

- [AI](./ai/index.md): provider-neutral operations, configuration, tools and
  bounded agents; server-only credentials and explicit capability checks.
- [Vector storage](./vector/index.md): named local indexes, safe filters,
  required metadata scopes and explicit AI embedding composition.

## Background Coordination

- [Scheduler](./scheduler/index.md): process-local cron and immediate jobs,
  overlap/cancellation ownership, safe errors and managed lifecycle.
- [Torrent](./torrent/index.md): durable workflow definitions, activity
  capabilities, branching, interactions, scratch memory and recovery.
- [KV/cache](./kv/index.md): memory-first state, single-instance CAS/counters/
  limiters and explicit journal/checkpoint durability.

## Files And Delivery

- [Storage](./storage/index.md): authenticated files, ACLs, signed capabilities,
  shared-CAS publication and adaptive owner-bound Storage Studio.

## Communication

- [Realtime Sync](./sync/index.md): admitted snapshots, replay/live changes,
  mutation receipts, durable user state and bounded ephemeral collaboration.
- [Email](./email/index.md): provider-neutral server delivery, captured app-local
  configuration and Guardian's durable account-action outbox.
- [Notifications](./notifications/index.md): scoped persisted notices, effective
  role audiences, recipient receipts and realtime frontend projection.
- [Rooms](./rooms/index.md): durable room membership/ownership and ephemeral
  presence/typing, with explicit admission and scoped authority.

## Operational Signals

- [Observability](./observability/index.md): stable events, app-local sinks,
  finite recent-memory queries, protected reads and optional lifecycle trace.

## Documents

- [PDF](./pdf/index.md): bounded HTML/CSS rendering, explicit browser/resource
  policy, scoped output storage and owned lifecycle.

This section is being written from the reviewed source inventory. The draft
guides state their evidence baseline; they are not a replacement for the
documentation in an already installed older release.
