---
id: zero.torrent.memory
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: memory
maturity: supported
applies_to: ["2.1.1 source plus reviewed uncommitted memory correction; not installed-package qualification"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Private Attempt-Local Scratch Memory

[Torrent](./index.md) · [Activities](./activities.md) · [Documentation index](../../index.md)

ctx.memory is a durable scratchpad for values shared between successful graph
steps. It is stored in private system.db state, not global KV or public Sync.
A handler sees a detached snapshot plus its staged overlay; mutations commit
with successful step transition and discard on failure, timeout or stale attempt.

This draft includes the reviewed working correction making delete return true
for a key visible only in the current staged overlay. The original clean commit
and uncommitted regression evidence remain distinct.

## Handler API

WorkflowMemoryContext exposes synchronous get, has, set, update, delete,
entries and toJSON. Missing get returns undefined. update requires an existing
key and a synchronous updater; absent key conflicts, promise-like output fails.
delete returns true only when the key existed in the attempt-visible view.

Complete activity declaration:

```ts
import { WorkflowRegistry } from "@zero/framework/workflows";
const registry = new WorkflowRegistry();
registry.registerActivity({
  name: "accumulate", version: "1",
  async handler({ input, memory }) {
    if (!memory) throw new Error("Scratch memory is required");
    const prior = memory.get("items");
    const items = Array.isArray(prior) ? prior : [];
    memory.set("items", [...items, input]);
    return { count: items.length + 1 };
  },
});
```

Declare/register a graph referencing it before starting. Values must be
JSON-safe. Accessors, cyclic data, executable objects/nonfinite numbers are not
a serialization shortcut. Reads/entries are detached; mutating a returned
object does not silently mutate persistent memory.

The context closes after its physical attempt. Do not retain it for a timer or
return a callback that edits memory after success.

## Trusted Start Seeding And Limits

WorkflowStartOptions.initialMemory atomically seeds a graph run's private
namespace without copying values into public instance/step input.
memoryLimits are trusted service-only per-run persisted bounds.
HTTP starts expose neither field; legacy sequential definitions do not support
these options.

| Limit | Default | Hard ceiling |
| --- | --- | --- |
| Key UTF-8 bytes | 256 | 1,024 |
| Value bytes | 64 KiB | 1 MiB |
| Entries | 256 | 4,096 |
| Total namespace bytes | 1 MiB | 16 MiB |

Positive safe integers are required; maxValueBytes cannot exceed maxTotalBytes.
The policy persists so restart does not revert a selected run to different
limits. Aggregate tracked runtime value accounting additionally bounds
amplification; these are not process-wide RAM guarantees.

## Concurrency And Failure

Each item uses a separate each-item namespace; graph-level activities share
instance memory. Parallel attempts touching the same key use optimistic base
versions at success commit. A conflict fails/retries rather than losing another
accepted value. Update does not create a global distributed atomic primitive.

Failed/rejected overlays are discarded. Staged memory is not a safe way to
claim a remote effect already sent: use provider/business idempotency separately.

Errors include WORKFLOW_MEMORY_KEY_INVALID, VALUE_INVALID, LIMIT_EXCEEDED,
CONFLICT and WORKFLOW_ATTEMPT_STALE. Inspect standard code/status, not private
values or raw exception text. [Operations](./operations.md) covers safe reporting.

Related: [control flow](./control-flow.md), [recovery](./recovery.md),
[authority](./authority.md), [retries/time](./retries-and-time.md).
