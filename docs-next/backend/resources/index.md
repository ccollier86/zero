---
id: zero.resources.overview
type: index
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: overview
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

# Declarative Resources And Data Policy

[Backend index](../index.md) · [Documentation index](../../index.md)

Resources connect declared tables to managed HTTP/Sync access and live
authorization. Schema describes valid rows; a resource describes which actions,
fields and transports can access them. Neither UI gating nor physical tenant
isolation replaces resource policy.

## Declare

- [Definitions](./definitions.md): typed/string tables and action policy maps.
- [Configuration](./configuration.md): app settings and declaration defaults.
- [Exposure](./exposure.md): internal, HTTP, Sync and all.
- [Realms](./realms.md): global/shared-row/tenant-database boundaries.
- [Registry](./registry.md): discovery, admission and app-local ownership.

## Authorize And Validate

- [Policies](./policies.md): public/authenticated/owner/metadata/custom helpers.
- [Guardian integration](./guardian-integration.md): live RBAC, actor references and tenant kinds.
- [Policy composition](./policy-composition.md): constraints/stamps under AND/OR.
- [Array overlap](./array-overlap.md): exact, bounded group-membership constraints across HTTP, Fabric and Sync.
- [Field access](./field-access.md): read/write/filter/order allowlists.
- [Input validation](./input-validation.md): scalar bodies and immutable identities.

## Use

- [Generated CRUD](./crud.md): HTTP routes and acknowledged mutation receipts.
- [Queries](./queries.md): bounded parameterized list/search/filter/order plans.
- [Sync integration](./sync-integration.md): consistent snapshot/live/write policy.
- [Roadmap](./roadmap.md): known directions, not imaginary replacement DSLs.

## Integration And Principles

Use [Schema](../schema/index.md) tables,
[Guardian](../guardian/index.md) authority and
[Fabric](../fabric/index.md) physical data capability together.
Managed server composition admits an app-local registry; ordinary requests
should not mutate an ambient global registry.

The inspected code favors explicit client exposure, constraints enforced outside
custom callbacks, and projection only after authorization. Those are inferred
design principles. Resource primitives do not certify app-authored business
policies or grant authority to a browser just because a matching button is shown.
