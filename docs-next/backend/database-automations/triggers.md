---
id: zero.database-automations.triggers
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: triggers
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

# AFTER Triggers And Function Chains

[Database automations](./index.md) · [Functions](./functions.md) · [Documentation index](../../index.md)

defineDatabaseTrigger({ name, version, table, after, run }) freezes a versioned
trigger declaration. Its identity is trigger:name@version. table is the exact
logical table key; matching is case-sensitive, not a wildcard or SQL expression.

## Events And Matching

after supports insert: true, delete: true, and update: true or
update: { columns: [...] }. At least one event must be enabled. A specified
column array must be nonempty; columns are trimmed, deduplicated and
canonically sorted. Normalized event order is insert, update, delete.

Complete standalone definition illustrating exact references:

```ts
import { defineDatabaseTrigger, databaseFunctionReference } from "@zero/framework/database-automations";
export const stateChanged = defineDatabaseTrigger({
  name: "orders.state-changed", version: 1, table: "orders",
  after: { update: { columns: ["status", "approved_at"] } },
  run: [
    databaseFunctionReference({ name: "orders.rollup", version: 1 }),
    databaseFunctionReference({ name: "orders.notify", version: 2 }),
  ],
});
```

The composed registry must contain both target versions and the table columns.
This builder alone does not register or execute the targets.

matchesDatabaseTrigger(trigger, change) checks table, operation and any
intersection with filtered update columns. With no supplied changedColumns it
calls deriveChangedColumns(previousRow, row), comparing key presence and
Object.is values across both own-key sets. Missing before/after rows yield an
empty derived set. Unfiltered updates match the operation without requiring a
difference in one particular column.

A column filter is not a row predicate, transition condition or value validator.
Inside a handler inspect the immutable snapshot and return without an effect
when business conditions do not apply.

## Function Chains

run accepts one target or a nonempty ordered target array. Each target can be
a function definition or databaseFunctionReference. Duplicate exact targets
are rejected. Register all targets in functions/include explicitly.

Target order is preserved and contributes to the canonical manifest.
Transaction targets execute synchronously in that order. Durable targets
capture their commands in the same origin commit, then run later.
Returned output does not become the next target's input.
All targets receive one immutable snapshot and shared match invocationId.

Current-match targets finish before cascaded changes drain. Separate matching
managed triggers execute in canonical identity order, not by string insertion
order supplied to an app's original registry.

## What Does Not Trigger

Raw SQL/SQLite writes bypassing ReactiveDB interception do not produce these
automations. Private underscore trigger targets are rejected. Updates/deletes
that return no logical change do not invent a trigger event. A trigger does not
grant the origin writer permission or override Resource row ownership.

## Verification And Related Guides

Pure matchesDatabaseTrigger/deriveChangedColumns tests can check changed-key
semantics without a database. Then run tracked transaction tests to prove the
event sequence, cascade order and rollback behavior.
[Inputs](./inputs.md) defines operation snapshots;
[transaction functions](./transaction-functions.md) explains atomicity;
[versioning](./versioning.md) covers upgrade-safe references.
