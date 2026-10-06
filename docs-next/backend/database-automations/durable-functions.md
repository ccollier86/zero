---
id: zero.database-automations.durable-functions
type: how-to
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: durable-functions
maturity: supported
applies_to: ["2.4.2 source update; focused release checks recorded separately"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.2"
  commit: "5cf3009f63767c4052065aa211734f2ebffb2c9f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Durable Database Functions

[Database automations](./index.md) · [Delivery](./delivery.md) · [Documentation index](../../index.md)

A durable function captures an immutable command in its source-local outbox
inside the source commit. The host executes it after writer authority is
released, using services bound to that physical source. It can await scoped
storage, Torrent or app-owned external adapters without holding a SQLite write
transaction open.

## Minimal Declaration

Complete declaration; attach it to a trigger/registry as described in
[configuration](./configuration.md). The referenced workflow_instance_id must
be validated/stored by authorized app code, not chosen by an anonymous webhook.

```ts
import { defineDatabaseFunction, type DatabaseTriggerFunctionInput,
} from "@zero/framework/database-automations";
import type { DatabaseAutomationExecutionServerServices } from "@zero/framework/server";

export const resumeRun = defineDatabaseFunction<
  DatabaseTriggerFunctionInput, void, DatabaseAutomationExecutionServerServices
>({
  name: "replies.resume-run", version: 1, mode: "durable",
  async handler({ input, zero, signal }) {
    signal.throwIfAborted();
    const row = input.change.row;
    if (!row || typeof row.workflow_instance_id !== "string") return;
    await zero.torrent.deliverEvent(row.workflow_instance_id, "reply", {
      replyRecordId: input.change.rowId,
    });
  },
});
```

This sends an exact instance event, not a broadcast. Torrent must be enabled,
and its run must belong to the source scope. The helper derives an idempotency
key from the durable delivery. See [Torrent integration](./torrent.md).

## Services, Input And Lifetime

context.input is the captured trigger snapshot, not a live reread of the source
row. context.invocation pins exact identities. context.zero is
DatabaseAutomationExecutionServerServices: source-bound authority-scoped
services plus the narrow torrent helper. context.signal aborts on shutdown,
attempt timeout or lost execution lifetime.

This is not a workflow-only API. An ordinary app function can receive mapped
snapshot parameters, `zero`, `signal` and a stable destination key. The
[app-function guide](./app-functions.md) shows how an app-owned dispatcher
selects a registered version without giving handlers an arbitrary tenant selector.
[`zero.torrent.start`](./torrent.md) separately provides a permanent start
receipt when the desired effect is starting a workflow rather than calling a function.

Services are revocable. Check signal before external calls and pass it into
adapters supporting cancellation. Never stash zero for another timer/run.
Service revalidation occurs around operations and before recording success.
An external request already accepted remotely cannot be undone by local abort.

Return values are discarded, not mapped into subsequent function targets.
A trigger's transaction and durable targets share snapshot input but execute
in different phases; ordering durable target declarations does not turn their
external work into a same-commit transaction.

## Idempotency And Failure

Delivery is at least once. A remote action may succeed before a process loses
the chance to record completion; the same command can execute again. Derive a
stable external idempotency key from invocation.invocationId,
invocation.functionIdentity and an effect discriminator. Provider-side
idempotency/business uniqueness is still required.

A handler rejection schedules bounded exponential retry. A removed exact
function version becomes terminal unavailable instead of silently running the
new version. Timeout/shutdown fence stale completion and stop service access;
an uncooperative promise may still settle externally.

[Delivery](./delivery.md) records default lease/retry/capacity behavior.
[Services and authority](./services-and-authority.md) explains why the handler
is a trusted source-bound system execution, not impersonation of the user who
last changed the row.

## Verification And Upgrade

Test commit/rollback separately from external delivery. Use fake services and
controlled barriers to force a completed remote effect followed by failed
terminal recording, then verify your idempotency key prevents duplicates.
Retain exact old definitions until their pending commands drain.
Do not claim provider exactly-once behavior from a local lease token.
