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
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Resume One Torrent Instance From A Database Change

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
