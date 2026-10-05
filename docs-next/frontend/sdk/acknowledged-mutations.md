---
id: zero.frontend.sdk.acknowledged-mutations
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: acknowledged-mutations
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, Sync, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Exact Realtime Mutation Receipts

[SDK index](./index.md) · [Documentation index](../../index.md)

Collection insertAsync/updateAsync/removeAsync keep optimistic realtime behavior
while returning a promise for that mutation's exact server receipt. Use them for
success notifications, accepted forms, closing dialogs and advancing editors.
Optimistic local state is immediate UI feedback, not proof of server acceptance.

## Wait For The Operation You Submitted

```ts
import { isSyncMutationError } from '@zero/framework/react';

try {
  await tasksCollection.updateAsync('synthetic-task', { done: true }, {
    timeoutMs: 30_000,
  });
  // Accepted success for this exact mutation, not any later table update.
} catch (error) {
  if (isSyncMutationError(error)) {
    // Safe error.code/message; serverErrorCode may identify a bounded rejection.
  } else {
    throw error;
  }
}
```

This fragment assumes an already-configured authorized collection. Options use
signal and timeoutMs. The default wait is 30000 ms; the maximum is 300000 ms.
The bound includes same-row queue time. Invalid bounds reject rather than creating
an unbounded promise. An already-aborted signal prevents the associated submission.

## Failure Codes

The public SYNC_MUTATION_ERROR_CODES map contains:

| Key | Stable value | Meaning |
| --- | --- | --- |
| serverRejected | SYNC_MUTATION_REJECTED | server refused the mutation |
| acknowledgmentTimeout | SYNC_MUTATION_ACK_TIMEOUT | transport acknowledgment timed out |
| waitTimeout | SYNC_MUTATION_WAIT_TIMEOUT | caller's overall receipt wait expired |
| waitAborted | SYNC_MUTATION_WAIT_ABORTED | caller aborted its wait |
| snapshotReplaced | SYNC_MUTATION_SNAPSHOT_REPLACED | receipt cannot survive replacing its snapshot |
| clientReset | SYNC_MUTATION_CLIENT_RESET | client data lifecycle reset |
| clientDisconnected | SYNC_MUTATION_CLIENT_DISCONNECTED | client deliberately disconnected |
| authorizationScopeReplaced | SYNC_MUTATION_AUTHORIZATION_SCOPE_REPLACED | retained operation belongs to the old scope |
| submissionFailed | SYNC_MUTATION_SUBMISSION_FAILED | operation could not be admitted/submitted |

SyncMutationError exposes code, serverErrorCode/null, ref, table, op and rowId.
Its messages are bounded framework feedback, not raw server stacks/causes.
isSyncMutationError is the public narrowing helper. Default/max timeout constants
and SyncMutationWaitOptions are public alongside the integrated SDK exports.

## Cancellation And Uncertain Outcomes

After submission, abort/timeout stops this caller's wait; it does not establish
that the server cancelled or rolled back the write. A server can commit while
the response is lost or the application changes scope. Receipt rejection must
not cause an automatic repeated side effect without the relevant idempotency or
reconciliation contract.

Same-row submission ordering and authoritative snapshot changes are transport/
store lifecycle concerns, not a distributed transaction guarantee. A receipt's
accepted result does not strengthen the database's configured durability mode
beyond its normal commit contract. [Resource mutations](./resources.md) expose
HTTP idempotency for their own generated route path.

## Reusable Controls

Zero's corrected forms, CrudPage, MasterDetail and inline editors await their
acknowledged writer before success/close/advance. Custom callbacks must return
the promise rather than starting a write and discarding it. A custom after-success
notification failure must not be mistaken for a failed underlying write and
automatically repeat that accepted mutation.

Scope replacement prevents old completion from affecting the new form/table.
Use the normal [boundary](../runtime/authorization-scope-boundary.md) for custom
state; a callback captured before await is not inherently current afterward.

## Verification And Compatibility

Hold a receipt pending, issue duplicate clicks, reject/accept it and check the
control remains pending until the exact result. Exercise wait timeout/abort,
reset/disconnect/snapshot/scope replacement and safe error content. Ordinary
void optimistic collection methods remain valid low-level APIs; their existence
is not a defect or an accepted-write promise.

Focused source and real component regressions support this contract. The audited
fix changes composed success timing where callers previously discarded receipts;
it keeps normal method names/callback shapes. Installed-package mode and actual
configured durability still require their appropriate qualification.

## Related Guides And Next Steps

- [Collections](./collections.md) distinguishes optimistic and Async methods.
- [Resources](./resources.md) owns HTTP mutation/idempotency behavior.
- [Schema validation](../../backend/schema/validation.md) owns server logical acceptance.
- [Client lifecycle](./client-lifecycle.md) owns deliberate teardown and scope invalidation.
