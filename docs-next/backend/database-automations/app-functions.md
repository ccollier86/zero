---
id: zero.database-automations.app-functions
type: how-to
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: app-functions
maturity: supported
applies_to: ["2.4.2 source contract; focused qualification recorded separately"]
modes: ["durable pinned application database", "durable Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.2"
  commit: "5cf3009f63767c4052065aa211734f2ebffb2c9f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Invoke An App Function With Parameters

[Database automations](./index.md) · [Durable functions](./durable-functions.md) · [Documentation index](../../index.md)

A database change can invoke an ordinary application function—not just a
Torrent workflow. Declare a durable database function, map its captured change
into the app function's arguments, and call an imported app service or
dispatcher. The app function executes on the server after the source commit.

This is useful for publishing a document, dispatching a message, updating an
external system, or asking a functions platform such as Pantheon to invoke an
exact function version. Zero provides the committed trigger snapshot, durable
delivery and source-bound service lifetime. Your application continues to own
its function registry, argument validation, invocation grants and receipts.

## Choose The Right Action

| Desired effect | Use |
| --- | --- |
| Update a local rollup atomically with the source row | A [transaction function](./transaction-functions.md). |
| Call an app function with arguments or await external I/O | A durable handler calling your app service/dispatcher. |
| Start a new workflow | The source-bound Torrent start helper described in [Torrent integration](./torrent.md). |
| Resume one existing waiting workflow | `zero.torrent.deliverEvent` with its exact stored instance ID. |

Calling a function does not require wrapping it in a workflow. Conversely,
ordinary app dispatch is not a substitute for Torrent's durable start/event
receipt contracts.

## Prerequisites

Configure a crash-durable source and register its functions/triggers before
tracked writes. [Configuration](./configuration.md) describes pinned versus
Fabric admission, the system catalog and actor launch configuration. Durable
automations cannot be enabled on an ephemeral source.

Authorize the originating write before it creates a command. An ordinary
browser must not gain privileged function execution merely by writing an
arbitrary function name into a broadly writable table. A queue table needs
appropriate Resource/API permissions and an app dispatcher that admits only
targets available to its trusted source.

## A Complete Adapter Declaration

The following file is a complete, typechecked adapter declaration. It defines
the app-owned dispatcher interface and returns a registry; it does not create
an application or supply a dispatcher implementation.

Its source table is `function_jobs`, with a primary key and the fields
`function_name` (text), `function_version` (integer) and `parameters_json` (text).
Store an exact published function version and JSON arguments through an
authorized app service. Names and argument schemas belong to your app's
function system, not the database automation registry.

```ts
import {
  defineDatabaseAutomations,
  defineDatabaseFunction,
  defineDatabaseTrigger,
  type DatabaseTriggerFunctionInput,
} from "@zero/framework/database-automations";
import {
  DatabaseError,
  type DatabaseAutomationExecutionServerServices,
} from "@zero/framework/server";

export interface AppFunctionDispatcher {
  invoke(
    target: Readonly<{ name: string; version: number }>,
    parameters: unknown,
    context: Readonly<{
      zero: DatabaseAutomationExecutionServerServices;
      signal: AbortSignal;
      idempotencyKey: string;
    }>,
  ): Promise<void>;
}

export function createAppFunctionAutomations(dispatcher: AppFunctionDispatcher) {
  const invoke = defineDatabaseFunction<
    DatabaseTriggerFunctionInput,
    void,
    DatabaseAutomationExecutionServerServices
  >({
    name: "jobs.invoke-app-function",
    version: 1,
    mode: "durable",
    async handler({ input, invocation, zero, signal }) {
      signal.throwIfAborted();
      const row = input.change.row;
      if (!row || typeof row.function_name !== "string"
        || row.function_name.length === 0
        || typeof row.function_version !== "number"
        || !Number.isSafeInteger(row.function_version)
        || row.function_version < 1
        || typeof row.parameters_json !== "string") {
        throw invalidJob();
      }
      let parameters: unknown;
      try {
        parameters = JSON.parse(row.parameters_json);
      } catch {
        throw invalidJob();
      }
      const idempotencyKey = `app:${new Bun.CryptoHasher("sha256")
        .update("my-app.database-function.v1\0")
        .update(invocation.invocationId)
        .update("\0")
        .update(invocation.functionIdentity)
        .update("\0invoke")
        .digest("hex")}`;
      await dispatcher.invoke(
        { name: row.function_name, version: row.function_version },
        parameters,
        { zero, signal, idempotencyKey },
      );
      signal.throwIfAborted();
    },
  });
  return defineDatabaseAutomations({
    functions: [invoke],
    triggers: [defineDatabaseTrigger({
      name: "jobs.created",
      version: 1,
      table: "function_jobs",
      after: { insert: true },
      run: invoke,
    })],
  });
}

function invalidJob(): DatabaseError {
  return new DatabaseError(
    "DATABASE_PAYLOAD_INVALID",
    "The application function job is invalid.",
    { retryable: false, outcome: "not-started" },
  );
}
```

Call this factory with your existing app dispatcher, then mount the returned
registry as `databaseAutomations` for a pinned database or `automations` in
`defineDatabaseRealm` for Fabric. These are [existing configuration
fields](./configuration.md), not new function-platform settings.

For a fixed operation, you can instead import its function directly and map
specific row fields into its arguments. A named dispatcher is useful when the
application already owns a versioned function platform. Neither pattern needs
an HTTP request back to its own server, a fabricated login, or a second Zero
function registry.

Fabric actors import the trusted realm module. Keep module evaluation free of
network calls and connection setup: imported declarations are used for actor
admission, while the managed host invokes durable handlers after releasing the
source writer lane. Handler code is not serialized through IPC.

## Dispatcher Responsibilities And Source Authority

The dispatcher must resolve the exact target/version, validate arguments
against that target's schema, and enforce its invocation grant using trusted
server data. If the version is unavailable, reject rather than silently call
the latest function. Keep old versions available while pending jobs reference
them.

The adapter's `jobs.invoke-app-function@1` identity and the app target's
`documents.publish@2` identity are separate version namespaces. Bump the
database-function version when its argument mapping or effect behavior changes,
and retain old adapter definitions while their outbox backlog drains. The
handler-free automation manifest does not hash your imported executable code.

Pass `context.zero` and `context.signal` into the app function. The service
projection is immutable and revocable; its scope is derived from the admitted
source, not a tenant ID inside `parameters`. In tenant-database mode,
`zero.data` addresses that organization's physical Fabric database. It has no
method for switching to another organization's file. On a pinned application
source, `zero.data` is null; do not invent a tenant client from an argument.

An automation is trusted source-bound system work, not the human who last
edited the row. Its authorization facade cannot fabricate that user's login
or roles. If business behavior requires actor-specific permission, the app
must capture an appropriate secret-free actor reference and revalidate it
through its supported live authorization integration before invocation.

Scoped calls fence their service lifetime and current source eligibility.
Suspending an organization while an app function awaits prevents its later
scoped database mutation. A caller-controlled `requestedTenantId` in a
parameter object does not redirect the supplied client. These fences do not
automatically secure an independently captured raw database manager or global
provider; do not pass those around instead of the supplied services.

[Services and authority](./services-and-authority.md) owns the exact projection
and live-fence contract.

## Snapshots, Retry And External Effects

The input contains a detached committed change snapshot. Editing the source
job afterward does not replace the parameters of its already-enqueued command.
An `after: { insert: true }` trigger does not fire again for that later update.

Delivery is at least once. An app function can successfully send a request or
commit a mutation, then fail before Zero records completion. On retry, the
same `invocationId` and `functionIdentity` remain available; the sample derives
the same downstream effect key. Each attempt receives a new AbortSignal and
service lease.

For a Fabric write, pass that key to `zero.data.mutate`, `batch` or `command`
so the existing mutation receipt protects that operation. For an app-owned
invocation queue, atomically persist its command and receipt in the queue's
own database. For external I/O, pass a stable idempotency key to a provider
that supports it, or enforce suitable business uniqueness. A local automation
lease alone does not make external I/O exactly once.

Bind a receipt to both its key and canonical target/version/arguments. Reusing
the key with a changed command must conflict rather than silently accept it.
Multiple deliberate effects in one handler need separate discriminators
instead of all reusing the sample's `invoke` suffix.

Use the **captured** parameters consistently; a live reread that changes a
retry's command defeats downstream idempotency. Function return values are
discarded by automation delivery, not persisted as a workflow/result pipeline.
If the app needs result history, its function system owns that history.

## Cancellation, Errors And Observability

Forward `signal` to adapters supporting cancellation and check it around
external calls. Managed shutdown or an attempt timeout aborts the signal and
revokes the lease. An external action already accepted by a remote provider
cannot be undone by a local abort; its idempotency boundary still matters.

Safe validation failures should use Zero's established error classes. Keep
argument values, tokens and exception details out of public messages and
low-cardinality lifecycle metadata. Managed automation delivery already emits
its attempt, retry, completion and failure events through Zero's observability
boundary. The app dispatcher should use the supplied scoped observability
facade for its own domain events, not direct `console` calls.

See [operations](./operations.md) for safe failure presentation and
[delivery](./delivery.md) for retry, lease, timeout and recovery behavior.

## Verify The Integration

Before enabling an app function on real data, test that:

- A committed origin change invokes the exact app function/version with the
  intended scalar, object and array parameters.
- Origin rollback invokes nothing; later source edits do not alter a captured
  command.
- A failure after an accepted downstream action repeats delivery without
  repeating the protected effect.
- Tenant arguments cannot expose another organization's data, and suspension
  or shutdown during an await blocks subsequent scoped writes.
- Old exact versions remain callable while their backlog drains; unknown
  targets and invalid parameters fail through the app's admission rules.

These are application integration checks, not permission to test production
databases or call real providers during a documentation audit. Source fixtures
exercise managed `createApp`, Guardian, real Bun actors, retry-after-commit,
captured parameters, tenant isolation, source suspension and shutdown. This
draft has not been qualified against an installed package artifact.

## Related Guides And Next Steps

- [Configuration](./configuration.md): mount the registry in a durable pinned
  source or Fabric realm.
- [Functions](./functions.md): versioned handler identity and input/result
  contracts.
- [Services and authority](./services-and-authority.md): exact capability
  projection and live source fences.
- [Delivery](./delivery.md): at-least-once execution, retries and recovery.
- [Torrent integration](./torrent.md): starting or resuming workflows when the
  intended effect actually is a workflow operation.
- [Testing](./testing.md): separate same-commit, host delivery and application
  effect verification.
