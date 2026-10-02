# Bootstrap Prompt

Copy the text below and paste it as your first message in a new Claude conversation to get oriented on this codebase.

---

```
I'm working on Zero, a full-stack reactive application framework built on Bun + Elysia + SQLite + React. The project is the current repository working directory.

Before doing anything, read these files in order to understand the architecture:

1. docs/platform-overview.md — what the platform does, all features, DX examples
2. docs/system-map.md — where every file lives, how systems connect, how to navigate the code
3. docs/framework/system-database.md — system/application database ownership, identity anchors, and upgrade boundary
4. docs/workflows.md — Torrent workflow DSL, runtime, recovery, authority, and live monitoring

After reading those, read these key source files to understand the implementation:

5. src/frontend/index.ts — the barrel export (shows everything the framework provides)
6. src/frontend/server/app-factory.ts — how all server plugins compose
7. src/sync/types.ts — wire protocol and core type definitions
8. src/sync/sync.plugin.ts — the real-time sync engine
9. src/frontend/client/sdk.ts — client-side SDK wiring
10. src/schema/define-schema.ts — schema system that drives forms, tables, and validation

Key facts:
- Runtime: Bun. Server: Elysia. DB: bun:sqlite (synchronous, in-process). Client state: @xstate/store. Validation: Valibot. Styling: Tailwind + Radix + Framer Motion.
- Single WebSocket at /sync handles all real-time: durable sync (ack/rollback), per-authorized-scope user state, and policy-authorized ephemeral KV.
- Zero 2.0's named integrated systems are Guardian (identity, tenancy, and
  authorization), ReactiveDB Fabric (isolated multi-database execution), and
  Torrent (durable workflow orchestration). These are product/documentation
  names: keep using the established `auth`, `databaseTopology`, and `workflows`
  APIs rather than inventing renamed aliases.
- Guardian supports `single/simple`, `single/advanced`, `multi/simple`, and
  `multi/advanced`; consult the auth implementation checklist for the shipped
  boundary and deliberately deferred enterprise capabilities.
- Each runtime composes its services in one Bun process. `db` is the pinned
  application plane and `systemDb` is the always-separate Guardian/Zero plane;
  Fabric may add actor-owned application planes. File-mode runtimes sharing a
  relevant SQLite plane relay that plane's durable changes or authorization
  invalidation. Independent hosts/Fabric roots and RAM-only topics need an
  explicit external coordination design.
- The schema system (defineSchema + field types) drives: SQL DDL, client table defs, form generation, DataTable columns, validation, and TypeScript type inference.
- Plugin composition order matters: Sync (first) -> Auth -> Scheduler -> Notifications -> Rooms -> Workflows -> Router (last).
- Do not infer release readiness from source presence or historical test totals;
  use `docs/releasing.md` and rerun its release checks from the current tree.

Once you've read the docs and source files, confirm what you understand and ask me what I'd like to work on.
```
