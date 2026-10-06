---
id: zero.database-automations.torrent
type: how-to
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: torrent
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

# Start Or Resume One Torrent Instance From A Database Change

[Database automations](./index.md) · [Durable functions](./durable-functions.md) · [Documentation index](../../index.md)

A webhook can update a business record while a Torrent instance waits.
An AFTER durable function observes that committed change and sends an event to
the exact stored instance ID. Three waiting SMS replies must stay three
independent correlations, not one broadcast event.

## End-To-End Ownership

1. An authorized start creates a Torrent instance and a business record storing
   its exact workflow_instance_id and application correlation.
2. An incoming webhook is independently authenticated and matched to that
   record within the correct organization.
3. App code performs a tracked update; a filtered AFTER trigger captures the
   immutable reply snapshot with its outbox command.
4. A source-bound durable function calls zero.torrent.deliverEvent for that
   record's exact instance ID.
5. Torrent records the idempotent event in its system DB, validates scope and
   wakes the eligible wait. Paused/cancelled runs do not execute simply because
   an event arrived.

The automation invocationId is not automatically the Torrent instanceId.
Zero's current public workflow terminology remains instanceId; an application
may call that a run/invocation ID in its own product.

## Durably Start A New Run

As of 2.4.2, `zero.torrent.start(name, input?, options?)` starts one run in the
source-bound application or tenant scope. Its result is a stable acknowledgement:
`{ instanceId, name, createdAt, definitionVersion }`. The version is the pinned
graph version, or `null` for a legacy sequential definition.

Complete declaration example. Register `orders.fulfill` with Torrent before
recovery and compose this function into an AFTER trigger/registry as described
in [configuration](./configuration.md). Only independently authorized origin
writes should be able to enter the business state that starts this work.

```ts
import { defineDatabaseFunction, type DatabaseTriggerFunctionInput,
} from "@zero/framework/database-automations";
import type { DatabaseAutomationExecutionServerServices } from "@zero/framework/server";

export const startOrderRun = defineDatabaseFunction<
  DatabaseTriggerFunctionInput, void, DatabaseAutomationExecutionServerServices
>({
  name: "orders.start-run", version: 1, mode: "durable",
  async handler({ input, zero, signal }) {
    signal.throwIfAborted();
    if (input.change.row?.status !== "ready") return;
    await zero.torrent.start("orders.fulfill", {
      orderId: input.change.rowId,
      sourceSequence: input.change.sequence,
    }, {
      key: "fulfillment",
      version: 1,
      initialMemory: { originOrderId: input.change.rowId },
    });
  },
});
```

The options are `WorkflowStartOptions` plus the same optional `key`
discriminator described below: `version`, `initialMemory` and `memoryLimits`
are forwarded to Torrent. Private-memory options require a graph workflow.
Multiple intended starts in one handler must use distinct stable keys. Different
outbox deliveries already have distinct effect identities.

Torrent commits the immutable run, initial steps, source authority, private
memory and a permanent start receipt in one **system-database transaction**.
Application execution happens only after that commit. A lost acknowledgement,
retry or restart cannot create a second run for the same command/key. Replays
return the original acknowledgement; they do not resolve a newer activated
definition. Reusing the key with changed name, input, explicit version, options
or system provenance returns `WORKFLOW_START_IDEMPOTENCY_CONFLICT`.

Source eligibility is rechecked inside the final writer transaction, including
on receipt replay, and after awaited work. A committed run whose first
post-commit advance was interrupted is recovered normally; replay can also
re-kick an eligible running instance. A successful acknowledgement confirms a
durable start, not successful completion of every activity or external effect.

The start receipt is permanent and separate from outbox retention. See
[Torrent system starts](../torrent/system-starts.md) for the trusted low-level
API, integrity checks, migration and backup requirements. Ordinary app function
invocation does not need this bridge or Torrent; see [app functions](./app-functions.md).

## Handler And Trigger

Use the complete resumeRun declaration in
[durable functions](./durable-functions.md#minimal-declaration).
Compose it with a trigger after update on the business status column and return
without delivery unless the snapshot has entered the expected received state.
Register the exact version in functions.

A wait can already have an event durably stored before it becomes active;
Torrent's inbox reconciles eligible inputs. The event name must match the
definition's wait contract. This is not permission to send unrelated payloads.
The [complete correlated reply task](../../guides/correlated-workflow.md) uses
the exact `reply` name at both ends and includes the private table, registered
activities, verified origin write and atomic transition.

## Idempotency Keys

Public helper signature:

```ts
deliverEvent(instanceId, eventName, payload?, { key?: string }?)
  : Promise<WorkflowSystemEventDeliveryResult>
```

This is a signature sketch, not runnable TypeScript. key defaults to "default".
It must be 1–64 characters, begin with an alphanumeric character, and contain
only letters/digits/dot/underscore/colon/hyphen.

Zero derives the permanent Torrent delivery key from this durable outbox
delivery plus key, using Bun SHA-256. Retries of one helper call therefore replay
the same event, not append another. Different outbox deliveries can each use
the default. Multiple intended events in one handler require distinct keys.

Reusing a key with a different target/event/payload conflicts instead of
silently redirecting the event. Returning from the helper confirms its durable
delivery outcome, not that the entire workflow has completed.

## Security, Cancellation And Errors

The exact instance must belong to the source-bound scope. No active browser
session, raw user store or caller-selected organization is substituted.
Authority is checked before delivery, at the workflow commit fence and after
the await. A closed/aborted execution cannot continue using this service.

Missing Torrent produces DATABASE_OPERATION_UNSUPPORTED with retryable:
true and outcome: not-started. A changed authority fence becomes
WORKFLOW_AUTHORITY_CHANGED. Do not solve either by exposing raw workflows
under unsafe to a generic caller.

## Verify

Use three synthetic instances and three reply records. Deliver the first reply
twice and assert only its exact instance has one matching event. Then test
cross-tenant target rejection, retained early events, paused runs and a fence
changing before commit. Existing automation execution-service and workflow
system-event tests exercise the idempotency and scope boundary.

Related: [inputs](./inputs.md), [delivery](./delivery.md),
[services and authority](./services-and-authority.md). [Torrent events](../torrent/events.md)
documents the durable inbox, ordinary versus idempotent delivery and exact
run targeting; [interactions](../torrent/interactions.md) covers human replies.
