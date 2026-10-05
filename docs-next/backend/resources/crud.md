---
id: zero.resources.crud
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: crud
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, shared-row, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Generated Resource CRUD Routes

[Resources index](./index.md) · [Documentation index](../../index.md)

Managed resource routes default to /api/resources. createApp mounts the
app-local validated registry/persistence/Guardian dependencies; standalone
createResourceCrudPlugin requires explicit compatible dependencies and is not
an authentication shortcut.

## Routes

| Method/path under the prefix | Action |
| --- | --- |
| GET /:resource | list |
| GET /:resource/:id | get |
| POST /:resource | create |
| PATCH /:resource/:id | update |
| DELETE /:resource/:id | delete |

The path selects a registered resource, not an arbitrary physical table/path.
Exposure, realm, live authority, action policy, raw field admission and row
schema all apply. Update cannot relocate the primary key.

List accepts the admitted bounded query parameters described in
[queries](./queries.md). Missing data services return safe unavailable failures,
not an empty successful write.

## Mutation Receipts

Supply Idempotency-Key for a logical create/update/delete that the client may
retry. The route returns its normalized key in the same response header.
Absent keys receive generated identities, so two fresh HTTP attempts without
retaining that key are not automatically the same operation.

Malformed supplied key text is normalized by hashing, not logged.
Same-key same-intent receipt replay and conflicting-intent rejection occur
under the managed transaction. Identity/tenant attribution and operation
fingerprints remain part of the receipt boundary.

Receipt count/result/key/aggregate-byte limits are bounded.
Do not interpret receipt deduplication as atomic external email/HTTP execution.

## Accepted Versus Failed

Await the official SDK/source mutation result before closing edit UI or reporting
success. A post-acceptance notification callback failure is not grounds to
repeat an already accepted write. Unknown dispatched Fabric outcomes need
[reconciliation](../fabric/idempotency.md), not a fresh key.

## Related Boundaries

/api/data is a separate Sync-owned lazy query path using the same registry/policy;
it is not the same endpoint as generated CRUD.
See [Sync integration](./sync-integration.md), [field access](./field-access.md),
[input validation](./input-validation.md) and
[Fabric operations](../fabric/operations.md).
