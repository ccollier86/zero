---
id: zero.database-automations.inputs
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: inputs
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

# Immutable Trigger Inputs And Correlation

[Database automations](./index.md) · [Triggers](./triggers.md) · [Documentation index](../../index.md)

DatabaseTriggerFunctionInput is { change: DatabaseTriggerChangeInput }.
The interception path detaches canonical change rows and deep-freezes the
snapshot before supplying a trigger's ordered targets. Durable commands persist
that snapshot; they do not reread the row just before retry.

## Fields

| Field | Meaning |
| --- | --- |
| sequence | Change sequence local to this physical ReactiveDB. |
| table | Exact source table. |
| operation | insert, update or delete. |
| rowId | Canonical source row identity string. |
| row | Post-mutation row, or null for delete. |
| previousRow | Pre-mutation row, or null for a fresh insertion. |
| timestamp | Source change timestamp in milliseconds. |

An insert/upsert replacing an existing row follows ReactiveDB's emitted
operation semantics; do not infer a fresh creation merely from the method name.
Database values follow canonical JSON-safe row encoding. The input is not the
original form object, a current auth user or an unrestricted service context.

For DELETE use previousRow: row is null. For UPDATE compare previousRow and row
rather than a live query to recover the former value. A handler may reread app
state deliberately, but that state is a different fact from the captured cause.

## Correlation Is Explicit

sequence is not globally unique across Fabric databases.
rowId is not globally unique across tables/organizations.
invocationId identifies the trigger match; functionIdentity selects its target.
None of these is automatically a Torrent instanceId.

Store the appropriate exact workflow instance ID on the business record when
starting a workflow. When an authenticated webhook updates that record, a
durable function can extract that ID and deliver one event. Do not find all
waiting runs and deliver the first reply to each.

Example handler fragment:

```ts
const previous = input.change.previousRow;
const current = input.change.row;
if (previous?.status !== "received" && current?.status === "received") {
  // Deliver the run referenced by this same authorized row, not all waits.
}
```

input is the typed handler parameter from [functions](./functions.md); this
fragment is not a complete function or an authentication boundary.

## Privacy, Failure And Verification

Snapshots can contain sensitive business data. Do not put rows, webhook bodies,
prompts, tokens or secrets into standard observability metadata. Public queue
health is aggregate; outbox payloads remain private source-local state.

Treat types as developer assistance, not validation of an external webhook.
Validate its identity/payload before the source write, and validate business
fields used by a function. Missing malformed correlation should fail or follow
your explicitly chosen no-op policy rather than broadcasting.

Tests should mutate the original caller's nested input after admission and
verify transaction/durable snapshots remain unchanged, and should cover DELETE
and update-column filters. Read [testing](./testing.md) and
[Torrent delivery](./torrent.md) for exact run acceptance.
