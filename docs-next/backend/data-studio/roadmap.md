---
id: zero.data-studio.roadmap
type: roadmap
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: roadmap
maturity: supported
applies_to: ["2.1.1 baseline with unreleased datetime calendar correction"]
modes: [multi, advanced-RBAC, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Data Studio Roadmap

[Data Studio index](./index.md) · [Documentation index](../../index.md)

## Current Foundation

Organization-owned logical tables, typed canonical cells, schema history,
revision/receipt handling, bounded queries, read-only realtime reconciliation
and the adaptable editor are implemented. These are not proposed missing APIs.

## Possible Directions

- [ ] Expand profiles only with complete matching authority/data-plane semantics
  (for example carefully designed single-mode use).
- [ ] Consider richer schema evolution/backfill tools with explicit data
  ownership and failure/recovery evidence.
- [ ] Continue small inline editing/query/preview usability improvements on
  shared table/control-plane components.
- [ ] Explore reusable functions/workflows/agent task guides for logical
  persistence without exposing arbitrary SQL or executable schema JSON.

These are possibilities, not settings, supported profiles or promised dates.
GraphQL/vector composition and database branching belong to their own designs.

## Verification

Source-backed guides and pure example checks are not installed artifact or
production app certification. The datetime calendar correction is an unreleased
working change with focused pure-code regressions.

See [profiles](./profiles.md), [schemas](./schemas.md),
[installation](./installation.md), [Fabric roadmap](../fabric/roadmap.md)
and [frontend integration](./frontend-integration.md).
