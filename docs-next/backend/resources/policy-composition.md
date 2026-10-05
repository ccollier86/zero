---
id: zero.resources.composition
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: composition
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

# Compose Policies Without Dropping Constraints

[Resources index](./index.md) · [Documentation index](../../index.md)

## AND

allOf requires every branch to allow. It combines mandatory constraints by AND
and merges stamped input, denying conflicting stamped values.
Empty composites are invalid/fail closed, not implicit grants.

```ts
import {
  allOf, authenticatedOnly, ownerPolicy,
} from '@zero/framework/resources';

export const ownedAccess = allOf(
  authenticatedOnly(),
  ownerPolicy({ userField: 'owner_id' }),
);
```

As branches stamp input, subsequent branches evaluate the stamped context.
Order therefore must not be used to smuggle a caller value past a required stamp;
conflicts are rejected.

## OR

anyOf allows successful branches and combines constrained successes as OR.
An allowed unconstrained branch intentionally opens the action within the
independent realm/field/exposure boundary.
For example anyOf(authenticatedOnly(), ownerPolicy(...)) does **not** enforce
ownership for every authenticated user: the first branch already grants it.

Do not manually choose a successful boolean and discard its constraints.
Use the composed decision through the managed query/CRUD/Sync integration.

## Evaluation And Errors

evaluateResourcePolicy normalizes boolean/structured decisions and converts
evaluation exceptions to a safe failure/denial. Custom callback diagnostics
must not contain row values, secrets or raw request input.

Static validators inspect referenced metadata keys, Guardian actor fields,
authorization requirements and composite children before runtime.
They cannot prove arbitrary custom JavaScript implements the intended policy.

## Stamps And Field Admission

Raw client field validation happens before trusted realm/policy stamping.
Server-owned owner/tenant fields do not need to be client-writable to be stamped.
A client including a forbidden owner field must not escape validation merely
because a later policy would overwrite it.

See [field access](./field-access.md), [policies](./policies.md),
[queries](./queries.md) and [input validation](./input-validation.md).
