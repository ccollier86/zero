---
id: zero.database-automations.validation
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: validation
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

# Definition And Schema Validation

[Database automations](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

Validation distinguishes pure definition composition from managed schema
admission. Neither executes the registered function handlers.

## Public Validator

validateDatabaseAutomations({ functions, triggers }, hooks?) returns a frozen
issue array instead of throwing for ordinary duplicate/target/table issues.
Issue fields are code, message and applicable functionIdentity,
triggerIdentity, table or column.

| Code | Meaning and repair |
| --- | --- |
| AUTOMATION_FUNCTION_DUPLICATE | Repeated exact function identity; deduplicate composition. |
| AUTOMATION_TRIGGER_DUPLICATE | Repeated trigger identity; use one declaration/version. |
| AUTOMATION_TARGET_MISSING | Trigger target is not registered; include the exact version. |
| AUTOMATION_TABLE_MISSING | tableExists rejected the exact table key. |
| AUTOMATION_TABLE_INVALID | Unknown update column or a failed schema hook. |

Hooks are tableExists(table): boolean and
tableColumns(table): Iterable<string> | undefined. Only exact true means
present. An undefined columns result deliberately defers column checking.
Hook exceptions produce a generic safe issue, not their private exception text.

Complete pure validator example:

```ts
import { defineDatabaseFunction, defineDatabaseTrigger, validateDatabaseAutomations,
} from "@zero/framework/database-automations";

const noop = defineDatabaseFunction({
  name: "records.observe", version: 1, mode: "transaction",
  handler() {},
});
const changed = defineDatabaseTrigger({
  name: "records.changed", version: 1, table: "records",
  after: { update: { columns: ["status"] } }, run: noop,
});
const issues = validateDatabaseAutomations(
  { functions: [noop], triggers: [changed] },
  { tableExists: (table) => table === "records",
    tableColumns: () => ["record_id", "status"] },
);
if (issues.length !== 0) throw new Error("Invalid synthetic definitions");
```

This validates declarations only; it does not start a database, register a
listener or prove an actor bundle's deployed code matches the host.

## Builders And Managed Admission

Malformed names/versions/events/targets are rejected by builders using
AutomationError. defineDatabaseAutomations uses the public validator and throws
the first deterministic issue with bounded details. There is no silent
overwrite/latest-version substitution.

Managed app/Fabric admission requires a genuine non-proxied registry from the
package instance, detaches/sorts executable declarations and validates against
the final physical table catalog. _identity is schema metadata, not a
persisted update-filter column. Managed realm failures are classified as
DATABASE_CONFIG_INVALID rather than exposing arbitrary hook errors.

Runtime admission also rejects private underscore trigger targets and invalid
durable infrastructure. Authoring successfully without schema hooks does not
mean that later managed admission will accept the registry.

## Doctor And Troubleshooting

Doctor checks configured definitions, manifests, fingerprints, actor/realm
readiness and optional aggregate operational health. It does not run handlers.
A normal Doctor command can import trusted application configuration; treat
that as executable code, not a sandbox. This documentation audit does not run
user app config or live database inspections.

Use [operations](./operations.md#doctor) for exact diagnostic families and
[testing](./testing.md) for focused checks. Avoid bypassing admission with
fabricated registry objects or dummy table declarations.
