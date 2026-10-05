---
id: zero.resources.exposure
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: exposure
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

# Control Resource Transport Exposure

[Resources index](./index.md) · [Documentation index](../../index.md)

Exposure answers **which managed transport may reach this resource**, not
whether a user is authorized or whether its data is fully cached.

| Exposure | Generated CRUD and lazy HTTP data | WebSocket Sync |
| --- | --- | --- |
| internal | no | no |
| http | yes | no |
| sync | no | yes |
| all | yes | yes |

These classifications apply before policy. A custom policy returning true cannot
turn an internal table into a managed client transport.

## Loading Is Separate

A table's full/lazy/auto loading intent controls how authorized data is hydrated.
It cannot override exposure. A full-loading internal table is not suddenly
published; an HTTP-only lazy table is not available over the Sync socket.

See [Schema loading modes](../schema/index.md) and
[Sync integration](./sync-integration.md).

## Defaults And Migration

Omitted exposure preserves legacy all behavior only in single-tenant registry
admission. Multi-tenant managed apps must classify their managed tables
explicitly. Prefer explicit exposure even in new single-tenant apps, so the
declaration remains intentional during later tenancy upgrades.

An exposure change affects transport contracts. Applications need to retire
stale query/cache/selection state at authorization/scope boundaries, not merely
hide an old table component. Explicit field allowlists remain necessary when a
visible table contains server-private columns.

## Trusted Internal Use

Internal means no generated client access. Trusted server code can still use
its admitted service/domain operation. It does not mean every raw SQL caller is
automatically authorized, or that the table is encrypted or physically separate.

See [realms](./realms.md), [field access](./field-access.md),
[Guardian integration](./guardian-integration.md) and
[configuration](./configuration.md).
