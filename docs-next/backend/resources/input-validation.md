---
id: zero.resources.input
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: input
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

# Validate Bodies And Preserve Identity

[Resources index](./index.md) · [Documentation index](../../index.md)

Generated resource bodies must be JSON objects naming known table columns.
Scalar input values are string, number, boolean or null; arrays/objects for a
SQL scalar column are not an implicit JSON encoding API.

Use Schema's explicit field representation/codecs where richer logical data is
stored, and follow the official transport's serialized row contract.

## Create And Update

Create permits an explicit primary key so apps can use UUID/natural IDs, but
ReactiveDB validates the actual identity and schema.
A create body must contain at least one admitted field.

The low-level update sanitizer removes the primary key from the mutable patch.
Managed field/identity policy may reject forbidden raw input earlier; neither
path moves the row to a different identity. An update containing no mutable field
is invalid, not an accepted no-op row relocation.

Server-side tenant/owner/Guardian actor attribution follows raw field validation.
Immutable owner/reference rules remain enforced after creation.

## Absence And Null

Omitted keys and explicit null are different. Omission is not automatically
“clear this field,” and undefined disappears in JSON.
An optional numeric editor must send explicit null when the admitted nullable
schema uses SQL NULL. Required fields still reject invalid absence/null.

The corrected Schema default/nullable contract is documented in
[descriptors](../schema/descriptors.md) and the
[forms guide](../../frontend/forms/index.md).

## Helper Boundary

Public sanitizeResourceCreateInput/sanitizeResourceUpdateInput and
isResourceInputError are validation primitives, not authentication helpers.
They do not run a policy or commit a transaction by themselves.

Do not expose an app endpoint that sanitizes input then writes through raw SQL
without current resource/Guardian authority. Likewise, raw server values
stamped after admission are not automatically safe to return to clients.

See [field access](./field-access.md), [policies](./policies.md),
[generated CRUD](./crud.md) and
[Guardian references](../schema/guardian-references.md).
