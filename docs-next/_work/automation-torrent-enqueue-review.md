---
id: zero.automation-torrent-enqueue-review
type: operations
audience: [agent, maintainer, operator]
owner: torrent
status: in-review
visibility: internal
---

# Automation And Torrent Enqueue Review

[Working index](./index.md) · [Usage guide](../backend/torrent/enqueue.md)

The logging branch also addresses the requested long-AI scheduling gap after
the managed logging milestone. One database automation source executes handlers
sequentially. Its writer lane is released before external work, but the existing
Torrent start/event helpers await initial workflow advancement, which can include
an AI call. A handoff using those eager methods is not necessarily short.

## Implemented Change

`WorkflowService.enqueueAsSystemOnce` and `enqueueEventAsSystem` return existing
durable receipt shapes without joining activity execution. Source-bound
`zero.torrent.enqueue` and `enqueueEvent` derive the original effect identities
and live source fences. Exact commands share their permanent receipt with eager
equivalents; dispatch policy is not part of business identity. Existing eager
start/delivery methods keep their advancement contract.

Torrent's existing per-instance pumps own asynchronous execution, authority,
recovery and shutdown. The change does not parallelize one source's handlers,
weaken SQLite write ordering or create an unowned background AI promise.
Privileged enqueue methods are explicitly excluded from request/activity
facades, including their complete compile-time service inventory.

The event-delivery review also tightened an adjacent commit guarantee: both
system event modes reject an unfinished outer transaction, and final source
assertions must finish synchronously. A promise-returning assertion cannot
silently authorize an event commit.

## Verification

The focused queue/workflow/request-authority run passes 68 tests. It includes a
real managed source dispatcher with logging enabled: the first AI-like workflow
is held at a gate, the second change hands off and completes, both outbox
deliveries finish, and a third write progresses before the first gate releases.
No paid model or external customer system is used.

Tests also check eager compatibility, exact replay/conflict, final authority,
nested transactions, unavailable services, request-facade denial and recovery
from an actual file close/reopen after suppressing the first dispatch. The
installed-package smoke test passes with public enqueue imports, retry-safe
trigger effects, packaged manuals and real default logging actor startup.
The archive is isolated test output, not a replacement for the saved release.

```sh
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test \
  src/workflows/workflow-enqueue.test.ts \
  src/workflows/workflow-system-start.test.ts \
  src/workflows/workflow-system-event-delivery.test.ts \
  src/workflows/workflow-start-authority-race.test.ts \
  src/workflows/workflow-restart-recovery.test.ts \
  src/frontend/server/database-automation-torrent-services.test.ts \
  src/frontend/server/database-automation-execution-services.test.ts \
  src/frontend/server/server-request-services.test.ts \
  src/frontend/server/automation-torrent-enqueue.integration.test.ts
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test \
  src/frontend/server/database-automation-torrent.package.test.ts
bun --no-env-file x tsc --noEmit
bun --no-env-file docs-next/_work/checks/check.ts
```

## Adoption And Remaining Scope

Long source handlers must use the new enqueue path deliberately; existing eager
calls are not silently rewritten. There is no database schema migration for
these methods. Main and saved upgrade packages remain unchanged on this branch.

The [messaging plan](../backend/messaging/index.md#ai-and-human-ownership) now
specifies authoritative read positions/counts, private-note visibility,
ownership-epoch publication checks and truthful in-flight provider outcomes.
Those messaging domain features are still planned, not implemented by this
scheduling change or by the existing presentation/typing components.
