---
id: zero.resources.fields
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: fields
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

# Restrict Client Fields And Query Inference

[Resources index](./index.md) · [Documentation index](../../index.md)

Resource fields are optional explicit allowlists shared by managed HTTP/data/Sync
transports. Omission retains legacy all-column behavior; declaration makes the
contract fail closed.

## A Reusable Contract

```ts
import { defineResourceFields } from '@zero/framework/resources';

export const noteFields = defineResourceFields({
  read: ['id', 'title', 'owner_id'],
  create: ['id', 'title'],
  update: ['title'],
  filter: ['title', 'owner_id'],
  sort: ['title'],
});
```

Use this field-only value in the server resource and any compatible client
form/table configuration. It contains no policy executable or permission grant.

## Defaults And Invariants

Once fields is present, read is required. Create/update default empty
(no client-writable columns); filter/sort default to read.
Filter/sort must be subsets of read: a hidden column cannot become an oracle
through search/filter/order controls. Duplicate/blank field names and unknown
schema references are rejected.

Policies see complete server rows, so authorization can depend on a private
field without exposing it. Output is projected only after authorization.
Query planners distinguish full server columns/constraints from client-selectable
columns.

## Raw Input Before Stamping

The raw request body is checked before tenant/owner/actor stamps.
Trusted stamped fields do not need browser write permission.
The field-not-writable contract is a 400 with stable
resource-field-not-writable code; it must not silently accept a hidden write.

Generated update preserves row identity. A primary key needed for row addressing
does not imply it can be moved through a patch.

## Scope Of The Boundary

Field allowlists constrain managed resource transports, not arbitrary app-owned
raw SQL or a custom HTTP endpoint returning a full object. App code still needs
its normal validated services and must project explicitly at new boundaries.

See [queries](./queries.md), [input validation](./input-validation.md),
[generated CRUD](./crud.md) and
[Guardian references](../schema/guardian-references.md).
