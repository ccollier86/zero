---
id: zero.resources.sync
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: sync
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

# One Resource Policy Across HTTP And Realtime

[Resources index](./index.md) · [Documentation index](../../index.md)

ResourceSyncPolicyService connects the admitted resource registry to managed
snapshot, catch-up, live change and mutation decisions.
It does not grant access based on table subscription alone.

## Reading

Exposure must allow Sync; realm and current authority establish the source.
Resource policy produces mandatory row constraints.
Policies receive full server rows, and field projection occurs after the
authorization decision before data is released.

HTTP-only/internal resources are not available merely because client code asks
to subscribe. Full/lazy loading changes hydration strategy, not authority.

## Mutating

Managed writes validate known schema/client fields before trusted owner/tenant
stamping and enforce immutable identity rules. Mutation receipts and actual
server result govern UI acceptance.

Membership/role/credential changes must retire stale authority; organization
switching clears old source/cache/selection/pending query state.
A preexisting local row is not evidence that a newly admitted subject may read it.

## Physical Sources

Fabric tenant mode binds a current authorized physical database with per-file
sequence/history and readiness. Shared-row mode imposes mandatory tenant
constraints. A custom app policy cannot erase either independent boundary.

Raw trusted SQL is not guaranteed to emit tracked changes or run resource
validation. Use managed tracked mutations for expected realtime behavior.

## Lazy HTTP

/api/data is a distinct Sync-owned HTTP query path consuming the same registry.
It shares field/policy constraints, not a separate permissive authorization
implementation.

See [Fabric realtime](../fabric/realtime.md),
[ReactiveDB subscriptions](../reactive-db/subscriptions.md),
[exposure](./exposure.md), [field access](./field-access.md) and
[frontend SDK](../../frontend/sdk/index.md).
