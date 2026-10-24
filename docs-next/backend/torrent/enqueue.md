---
id: zero.torrent.enqueue
type: how-to
audience: [developer, agent, operator]
owner: torrent
status: in-review
visibility: internal
system: torrent
feature: commit-acknowledged-enqueue
maturity: preview
applies_to: ["Unreleased feature/core-logging update; not present in saved main packages"]
modes: [managed-system-database, trusted-standalone-service, durable-database-functions]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7c113512f3eeb3eca2ed44491f89ed1b62d50d8f"
  snapshot: dirty
  date: "2026-10-24"
  evidence_level: source-observed
---

# Enqueue Long Work Without Blocking A Database Automation

[Torrent index](./index.md) · [Database automations](../database-automations/index.md)

Use a short durable handler to commit a Torrent start or event, then let Torrent
own long AI, provider or human-wait work. Awaiting the enqueue receipt confirms
the durable handoff, not completion of the activity. The caller's database
automation lane can then admit its next delivery.

This is an explicit new branch-preview API. Existing `start`, `startAsSystemOnce`
and `deliverEventAsSystem` retain their eager advancement behavior; merely
moving a long AI call behind one of those methods can still delay the caller.

## Choose The Acknowledgement Boundary

| Caller | Commit-acknowledged handoff | Existing eager alternative |
| --- | --- | --- |
| Source-bound durable function | `zero.torrent.enqueue(name, input?, options?)` | `zero.torrent.start(...)` |
| Source-bound resume handler | `zero.torrent.enqueueEvent(instanceId, eventName, payload?, { key? }?)` | `zero.torrent.deliverEvent(...)` |
| Trusted system integration | `WorkflowService.enqueueAsSystemOnce(name, input, system, options?, mutation?)` | `startAsSystemOnce(...)` |
| Trusted system event integration | `WorkflowService.enqueueEventAsSystem(instanceId, eventName, payload, system, mutation?)` | `deliverEventAsSystem(...)` |

The eager alternatives join initial frontier advancement, which can include a
long activity; they do not necessarily wait for a whole workflow containing
future interactions. Enqueue dispatches that same lifecycle-owned frontier but
does not join its activities. Work may begin before the receipt reaches the
caller. Neither form supplies a separate CPU worker or bypasses AI/provider
concurrency limits.

Only trusted system composition may call the low-level system methods.
Ordinary request/activity workflow facades explicitly deny them; a browser
cannot claim a system principal. Prefer the source-bound helpers in a database
automation rather than inventing a tenant selector or idempotency key.

## Short Source Handler

The following declaration is a handler fragment. Register the `support.reply`
graph/activity and compose a filtered AFTER trigger using the normal
[automation configuration](../database-automations/configuration.md). The
originating message write must already be authorized.

```ts
import {
  defineDatabaseFunction,
  type DatabaseTriggerFunctionInput,
} from '@zero/framework/database-automations';
import type { DatabaseAutomationExecutionServerServices } from '@zero/framework/server';

export const enqueueReply = defineDatabaseFunction<
  DatabaseTriggerFunctionInput, void, DatabaseAutomationExecutionServerServices
>({
  name: 'messages.enqueue-reply', version: 1, mode: 'durable',
  async handler({ input, zero, signal }) {
    signal.throwIfAborted();
    const conversationId = input.change.row?.conversation_id;
    if (typeof conversationId !== 'string') return;
    await zero.torrent.enqueue('support.reply', {
      conversationId,
      messageId: input.change.rowId,
      originSequence: input.change.sequence,
    }, { key: 'reply', version: 1 });
  },
});
```

Do not put the actual AI call in this handler, await final workflow status here,
or discard the enqueue promise with `void`. The first two hold the source lane;
the last can mark the outbox successful before the handoff commits. The registered
Torrent activity performs authorized context loading, calls Zero AI and applies
domain ownership checks before publishing a result.

For an existing wait, await `zero.torrent.enqueueEvent(exactInstanceId, 'reply',
payload, { key: 'resume' })` instead. The exact target and event name must match
the admitted business correlation and wait contract. Paused/terminal behavior
and inbox capacity remain the same as ordinary durable event delivery.

## Receipts Retries And Authority

Enqueue uses the existing atomic run/event creation, sealed authority and
permanent receipt. Start results remain
`{ instanceId, name, createdAt, definitionVersion }`; event results remain
`{ eventId, instanceId, eventName, createdAt }`.

Dispatch policy is not a new business command. Switching between eager and
queued handling with the same principal, scope, logical key and exact command
reuses the same receipt. Changed input/target/options/provenance still conflicts.
Different intended effects require distinct stable keys; an attempt number or
random retry key would create duplicate work. See [system starts](./system-starts.md)
and [system events](./events.md) for the exact key bounds and namespaces.

Call outside an existing SQLite/ReactiveDB transaction. These async APIs cannot
acknowledge an unfinished outer commit. Source-bound helpers recheck authority
before admission, inside the final writer transaction and before returning the
result. Final assertions must finish synchronously; a promise-returning assertion
is rejected rather than silently authorizing a commit.

If the process stops after Torrent commits but before dispatch or before the
source records completion, normal recovery can resume the durable run/event.
Repeating the source delivery cannot create another instance/event. There is no
distributed transaction between the source and Torrent system databases; the
permanent receipt and retry bridge that gap. A source may therefore need to
reconcile a committed handoff even if its own acknowledgement was interrupted.

## Ordering Shutdown And UI State

Each source's automation worker remains sequential. Distinct physical sources
remain independently scheduled; each SQLite file still has one writer. Enqueue
shortens the work occupying a source delivery, not its commit safety rules.
Different Torrent instances advance independently, and their existing owned
pumps, cancellation, runtime lease and shutdown drain still govern execution.

The dashboard should distinguish message accepted, handoff committed, workflow
queued/running, generation complete, reply committed, provider accepted and
delivered/read where supported. An enqueue receipt is not an AI response or a
delivered message. Render live authorized state; do not manufacture those states
from an optimistic counter or animation.

## Migration And Verification

For long background handoffs, replace the helper call with `enqueue` or
`enqueueEvent`, keeping the exact source correlation, key and workflow version.
Do not change eager calls that intentionally depend on initial advancement.
Follow [function versioning](../database-automations/versioning.md) when updating
authored handlers with pending deliveries. No new database schema is introduced
by these methods.

The regression checks block one AI-like activity, verify another change in the
same database hands off and finishes, and admit a third write before releasing
the first. Additional tests cover eager compatibility, retries/conflicts,
authority and nested-transaction rejection, real file restart after lost dispatch,
request-facade denial and an installed-package trigger/Torrent/logging proof.

## Related Guides And Next Steps

- [Automation delivery](../database-automations/delivery.md) owns claims,
  sequential source execution, leases and retry limits.
- [Recovery](./recovery.md) and [lifecycle](./lifecycle.md) own retained run state,
  cancellation and shutdown, rather than the source handler's lifetime.
- [Messaging integration plan](../messaging/index.md) adds the separately
  required unread, private-note, ownership-epoch and external-delivery semantics.
