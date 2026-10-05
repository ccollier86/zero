---
id: zero.fabric.idempotency
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: idempotency
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Idempotent Writes And Honest Outcomes

[Fabric index](./index.md) · [Documentation index](../../index.md)

Every managed Fabric write requires a bounded idempotency key (maximum length
128). Allocate it for a **logical operation**, not for each network retry.
The durable receipt is scoped to that physical database.

## Receipt Behavior

A new admitted mutation/batch/command commits tracked data and its operation
receipt under the writer's transaction. Repeating the same key with matching
operation input can return the recorded value/sequence with `replayed: true`
without executing the handler again.

Reusing the key with different input conflicts; it is not a way to overwrite the
earlier intent. Receipt retention has hard count/key/result/aggregate byte
bounds. Capacity failure must be surfaced; bounded receipts are not a promise
of eternal unbounded deduplication.

```ts
import type { AsyncDatabaseClient } from '@zero/framework/server';

export async function createNote(data: AsyncDatabaseClient, id: string, title: string, operationKey: string) {
  return data.mutate(
    { type: 'create', table: 'notes', row: { id, title } },
    { idempotencyKey: operationKey },
  );
}
```

## Failure Outcomes

- `not-started`: the operation did not dispatch; queue/admission recovery may be
  possible according to the error's `retryable` flag.
- `not-committed`: an observed transaction failure/rollback did not commit.
- `unknown`: the executor disappeared or timed out after dispatch and cannot
  assert whether the write committed. It is **not** marked blindly retryable.
- `null`: the error makes no write commit assertion.

Do not generate a new key to “retry” an unknown outcome: that can duplicate a
write that already committed. Recover the same logical intent/key through the
appropriate live admitted capability, and handle permanent identity/schema or
capacity failures separately.

## Boundary Of The Guarantee

Idempotent SQL receipts do not make HTTP requests, emails, AI calls or other
external effects exactly-once. Keep write handlers synchronous and tracked;
use durable automation/outbox-style coordination for external work.

See [operations](./operations.md), [recovery](./recovery.md),
[diagnostics](./operations-diagnostics.md) and
[database automations](../database-automations/index.md).
