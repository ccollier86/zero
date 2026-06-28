# Bootstrap Prompt

Copy the text below and paste it as your first message in a new Claude conversation to get oriented on this codebase.

---

```
I'm working on a full-stack reactive application framework built on Bun + Elysia + SQLite + React. The project is at /home/catalyst/Downloads/platform.

Before doing anything, read these files in order to understand the architecture:

1. docs/platform-overview.md — what the platform does, all features, DX examples
2. docs/system-map.md — where every file lives, how systems connect, how to navigate the code

After reading those, read these key source files to understand the implementation:

3. src/frontend/index.ts — the barrel export (shows everything the framework provides)
4. src/frontend/server/app-factory.ts — how all server plugins compose
5. src/sync/types.ts — wire protocol and core type definitions
6. src/sync/sync.plugin.ts — the real-time sync engine
7. src/frontend/client/sdk.ts — client-side SDK wiring
8. src/schema/define-schema.ts — schema system that drives forms, tables, and validation

Key facts:
- Runtime: Bun. Server: Elysia. DB: bun:sqlite (synchronous, in-process). Client state: @xstate/store. Validation: Valibot. Styling: Tailwind + Radix + Framer Motion.
- Single WebSocket at /sync handles all real-time: durable sync (ack/rollback), per-user state, and ephemeral KV (fire-and-forget).
- Everything runs in one process — zero network hops between components.
- The schema system (defineSchema + field types) drives: SQL DDL, client table defs, form generation, DataTable columns, validation, and TypeScript type inference.
- Plugin composition order matters: Sync (first) -> Auth -> Scheduler -> Notifications -> Rooms -> Workflows -> Router (last).
- 0 TypeScript errors. Full clean compile.

Once you've read the docs and source files, confirm what you understand and ask me what I'd like to work on.
```
