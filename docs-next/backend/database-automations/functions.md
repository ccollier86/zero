---
id: zero.database-automations.functions
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: functions
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

# Versioned Database Functions

[Database automations](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

A function is trusted server code with an immutable name, positive integer
version and execution mode. It is not a SQL function, database-stored arbitrary
JavaScript or a browser-callable endpoint.

## Public Declaration

defineDatabaseFunction has two overloads:

- mode: "transaction": synchronous JSON-compatible/void result; context has
  input, invocation and transaction.
- mode: "durable": result may be awaitable; context has input, invocation, zero
  and signal.

Both accept name/version. The frozen definition records kind:
"database-function", canonical identity, mode, handler and public marker.
Freezing the declaration does not sandbox its captured application variables.

Generics are input, output and transaction/services respectively. Input defaults
to DatabaseAutomationValue; output extends that union or void; the third generic
defaults to unknown. Declare the provided capability rather than asserting an
unrestricted global service.

Complete standalone declaration, not a mounted registry:

```ts
import { defineDatabaseFunction, type DatabaseTriggerFunctionInput,
  type DatabaseTransactionFunctionCapability,
} from "@zero/framework/database-automations";
export const updateCounter = defineDatabaseFunction<
  DatabaseTriggerFunctionInput, void, DatabaseTransactionFunctionCapability
>({
  name: "messages.increment-count", version: 1, mode: "transaction",
  handler({ input, transaction }) {
    if (input.change.operation !== "insert") return;
    const counter = transaction.get("counters", "messages");
    transaction.insert("counters", {
      counter_id: "messages", total: Number(counter?.total ?? 0) + 1,
    });
  },
});
```

Declare tables and register the definition/trigger before executing a tracked
write. insert follows ReactiveDB's insert/upsert behavior; use createStrict for
duplicate-rejecting creation.

## Identity And Type Guards

Names begin with a lowercase letter, are at most 128 characters and use
lowercase letters, digits and . _ - separators without empty/repeated/trailing
segments. Versions are positive safe integers. Identity is function:name@version.
Use databaseFunctionReference({ name, version }) for references.

isDatabaseFunctionDefinition and DATABASE_FUNCTION_DEFINITION_KIND are public
authoring helpers, not authentication/sandbox checks. Managed admission requires
a genuine package registry instead of a deserialized/proxied object.

## Invocation And Results

DatabaseFunctionInvocation contains invocationId, functionIdentity,
triggerIdentity, table and operation. The latter three are nullable in the
generic public contract; tracked triggers provide their match values.
invocationId is shared by the match's ordered targets; functionIdentity selects
the exact target version. There is no public durable deliveryId in this context.

For one external action per function, derive a stable idempotency key from
invocationId plus functionIdentity; add a discriminator for distinct actions.

Returned values are not persisted as a result pipeline and do not become the
next function's input. Every chain target receives the same immutable snapshot.
Use tracked writes or explicit service effects, not assumed return chaining.

## Failure, Upgrade And Verification

A transaction promise/thenable return is rejected even if already resolved.
Capabilities close when handlers return/throw. Durable attempts are awaitable
but may repeat after retry/restart. Retain old exact versions while queued work
references them; changing code without changing version is not detected by the
handler-free manifest.

Read [transaction functions](./transaction-functions.md),
[durable functions](./durable-functions.md) and [operations](./operations.md)
for rollback, idempotency, cancellation and error outcomes.
