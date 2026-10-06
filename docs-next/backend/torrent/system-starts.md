---
id: zero.torrent.system-starts
type: how-to
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: system-starts
maturity: supported
applies_to: ["2.4.2; focused qualification recorded separately"]
modes: ["managed system database", "trusted standalone persistent service"]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.2"
  commit: "5cf3009f63767c4052065aa211734f2ebffb2c9f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Retry-Safe System Workflow Starts

[Torrent](./index.md) · [Authority](./authority.md) · [Documentation index](../../index.md)

Use `WorkflowService.startAsSystemOnce` when a trusted background operation may
retry after a workflow start has committed. Its permanent logical key prevents
duplicate run creation across concurrent calls, lost acknowledgements and
restart. Ordinary `startAsSystem`/`runAsSystem` remain non-idempotent starts;
they have not silently changed semantics.

For a ReactiveDB durable function, prefer the narrower
[`zero.torrent.start`](../database-automations/torrent.md#durably-start-a-new-run).
That adapter derives the key and trusted source scope for you.

## Public Contract

The trusted service method takes `name`, `input`, `WorkflowSystemStartOptions`,
optional `WorkflowStartOptions`, and optional `WorkflowSystemStartMutation`.
These types are exported from `@zero/framework/workflows` and
`@zero/framework/server`. The result is
`{ instanceId, name, createdAt, definitionVersion }`; retries return those exact
original values. A legacy sequential run reports `definitionVersion: null`.

Typechecked trusted-adapter example. The caller supplies the managed service
with an already registered graph, a durable job identity and a synchronous live
source assertion; this is not an unauthenticated HTTP endpoint.

```ts
import { applicationServiceDataScope } from "@zero/framework/auth";
import type { WorkflowSystemStartResult } from "@zero/framework/server";
import type { WorkflowService } from "@zero/framework/workflows";

export async function startInvoiceJob(
  service: WorkflowService,
  jobId: string,
  invoiceId: string,
  assertCurrentAuthority: () => void,
): Promise<WorkflowSystemStartResult> {
  return service.startAsSystemOnce("invoice.process", { invoiceId }, {
    principal: "invoice-dispatcher",
    reason: "Process an independently authorized invoice job",
    scope: applicationServiceDataScope(),
    idempotencyKey: `invoice:${jobId}`,
  }, { version: 1 }, { assertCurrentAuthority });
}
```

The key must be 1–128 characters, start with an alphanumeric character and use
only letters, digits, `.`, `_`, `:` and `-`. Use a bounded digest when the job's
external identity is too long. Never use an attempt number, random key or
timestamp for a retry of the same logical operation.

## Namespace And Command Identity

Keys are isolated by exact system principal and application/tenant scope. A
tenant-bound source cannot select a different tenant through this helper. The
same literal key in another admitted principal or tenant represents a separate
logical start, not access to the first one's receipt.

The canonical command binds name, input, explicit definition version, initial
private memory, memory limits and system provenance. Object-key ordering is
canonical. A changed command under the same key returns
`WORKFLOW_START_IDEMPOTENCY_CONFLICT` (409), rather than overwriting prior state.
Invalid keys return `WORKFLOW_START_IDEMPOTENCY_INVALID` (422).

The receipt also binds the actual immutable definition/run snapshot. If the
first request omitted an explicit version, later activation does not redirect
its replay to the new head. New intended work needs a new logical key.

## Commit, Authority And Recovery

Run, initial graph/legacy steps, authority, initial private memory and receipt
commit together under Torrent's writer transaction. There is no await inside
that transaction. Application execution begins after it commits.

Call this async operation **outside** an existing ReactiveDB/SQLite transaction.
An enclosing transaction is rejected with `WORKFLOW_REQUEST_INVALID` before
creating or replaying a run; returning from an inner savepoint would not prove
the outer commit. Do not start a run from a transaction-mode database function.
Use the durable after-commit handler instead.

The adapter's synchronous authority fence runs inside the writer boundary,
including receipt replay and the final creation commit. An asynchronous fence
is invalid; do not cast a promise-returning verifier to this type. Build the
live synchronous assertion from trusted server state before calling the method.
The ordinary execution-authority provider still governs subsequent activities.

If post-commit advancement fails, the durable receipt remains. Repeating the
command returns/re-kicks that instance as appropriate. Startup recovery also
validates retained nonterminal receipts and resumes eligible committed starts.
Paused/cancelled/completed runs do not restart merely because the start request
was repeated. See [recovery](./recovery.md) and [lifecycle](./lifecycle.md).

Receipts are MAC-bound private system state; corruption fails closed with
`WORKFLOW_STATE_INVALID`. They are not browser-editable rows, Sync content or an
application-owned receipt table. Do not manually delete receipts to free a key.
Retention of workflow history and permanent receipts must remain consistent.

## Storage, Upgrade And Observability

Managed migration `038_workflow_system_start_receipts` installs this private
system-database ledger. Managed migrations apply it on startup. Torrent's private
runtime initializer also ensures the equivalent ledger, including standalone
or migration-disabled composition; it does not update migration history. Keep
the normal system migration procedure enabled or explicitly run it for an
orderly deployment/history update. Existing runs need no input/schema rewrite.
Use persistent
storage for restart durability. Back up `system.db`, its authority state and
receipt ledger together; an in-memory standalone service cannot survive a
process restart.

Events are `workflows.system_start.created`, `.replayed`, `.conflict` and
`.failed`. Bounded run/definition/principal/scope metadata is permitted; keys,
fingerprints, input, private memory, reason and raw storage errors are omitted.
Acknowledged creation is not acknowledgement that the whole workflow finished.
Activity/external effects still need their own destination idempotency.

## Related Guides And Next Steps

- [Automation integration](../database-automations/torrent.md): use delivery-derived
  keys for source triggers and exact run events.
- [App functions](../database-automations/app-functions.md): invoke ordinary app
  code without involving Torrent.
- [Authority](./authority.md): distinguish system provenance from a human grant.
- [Definitions](./definitions.md): publish and retain immutable graph versions.
- [Recovery](./recovery.md): restart and stale-attempt ownership fences.
