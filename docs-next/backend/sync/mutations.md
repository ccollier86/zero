---
id: zero.sync.mutations
type: how-to
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: mutations
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Await An Authoritative Mutation Receipt

[Sync index](./index.md) · [Documentation index](../../index.md)

Optimistic writes make local UI responsive. They do not prove that the server
accepted the mutation. Existing void insert/update/delete methods remain
compatible; use the Async counterparts when an operation must show truthful
pending/success/error state.

```ts
import type { SyncClient } from '@zero/framework/sync/client';
import { isSyncMutationError } from '@zero/framework/sync/client';

export async function renameNote(client: SyncClient, id: string, title: string) {
  try {
    await client.updateAsync('notes', id, { title }, { timeoutMs: 30_000 });
  } catch (error) {
    if (isSyncMutationError(error)) {
      // Stable local code; serverErrorCode preserves a normalized server denial.
      return { ok: false as const, code: error.code, serverCode: error.serverErrorCode };
    }
    throw error;
  }
  return { ok: true as const };
}
```

The root SDK Collection exposes insertAsync, updateAsync and removeAsync.
These promises match the exact mutation ref, not a later row event that happens
to resemble the requested value.

## Admission And Results

The server checks table exposure, current table/resource policy, logical
validation, scope and live commit authority. A rejected optimistic mutation
rolls back locally and reports a normalized SyncMutationError. Errors distinguish
server rejection, ack timeout, overall wait timeout, caller abort, baseline
replacement, client reset/disconnect and authorization scope replacement.

Overall receipt waits default to 30 seconds and are bounded at five minutes.
The low-level ack monitor has a separate 10-second default. A caller's signal
stops its wait; it cannot roll back a write already committed on the server.
Timeout or disconnect therefore is not safe evidence for an automatic duplicate
business operation.

Use [useMutation](../../frontend/sdk/mutations-and-connection.md) or the packaged table/form
operation lifecycle rather than reporting success at optimistic submission.
See [policies](./policies.md), [logical validation](../schema/index.md),
[Fabric idempotency](../fabric/idempotency.md) and [client collections](../../frontend/sdk/index.md).
