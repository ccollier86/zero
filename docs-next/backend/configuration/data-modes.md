---
id: zero.configuration.data-modes
type: architecture
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: data-modes
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Choose Data Modes Independently

[Configuration index](./index.md) · [Documentation index](../../index.md)

Guardian tenancy, authorization complexity and physical data placement
are separate choices. A multi-tenant app does not automatically use one file per
organization; advanced RBAC does not itself create Fabric actors.

## Managed Planes

`db` is required and represents the primary application plane. Persistence
accepts explicit file/hot/ephemeral modes and legacy aliases; omission inside the
storage config resolves to hot. Prefer explicit production mode/path declarations
instead of relying on an ambiguous “memory” label.

`systemDb` is always independent. Its default is ephemeral only when the app
plane resolves ephemeral; otherwise it is file-backed at
`./data/zero.system.db`. It cannot share a service, raw handle, owned snapshot,
companion or authority-fence path with the app plane. A raw Bun Database supplied
as `systemDb.database` is forbidden.

[Data-plane concepts](../../concepts/data-planes.md) explains canonical authority
and local anchors. [Runtime handles](../runtime/data-planes.md) explains trusted
access without mixing the two databases.

## Topology

Omitted `databaseTopology` or `{mode:'single'}` preserves one app database.
Multiple mode requires a private `rootDirectory`, a side-effect-free admitted
`realm` and explicit `actors.launch`.

Multiple mode defaults to shared-row tenant isolation and file placement.
`tenantIsolation:'tenant-database'` requires multi-tenant Guardian; the realm's
tables must be a schema-identical subset of the app declarations. Actor
environment is an explicit allowlist, not a copy of all parent credentials.

File/hot/hybrid [placement](../fabric/placement.md) and bounded actor queues are
Fabric concerns. They do
not move canonical Guardian tables into tenant files. An app can also use trusted
named databases without making each name a user-controlled file path.

## Independent Permission Modes

Choose simple or advanced Guardian authorization according to the app's actual
roles/policies. Use tenant-bound request services for tenant files and declared
resources for business/field rules. Organization membership alone is not a
platform administration grant.

For user-owned rows, declare [Guardian FK references](../schema/guardian-references.md)
rather than copying credentials/profiles into app tables. Their local anchors
preserve SQLite existence constraints without becoming an authority cache.

## Automations And Migration

Pinned app automations use `databaseAutomations`; actor-local functions/triggers
belong to the realm registry. Durable functions require a non-ephemeral system
plane for source recovery.

`migrate` resolves true by default, but actual platform migration execution is
per-plane: the managed system bootstrap skips it for ephemeral storage and does
not run platform migrations on the application plane. Realm/app migrations have
their own ownership; do not interpret the switch as a universal data conversion.

## Related Guides And Next Steps

- [Reference](./configuration.md#identity-and-data) lists composition options.
- [Guardian](../guardian/index.md) owns tenancy/authorization choices.
- [Lifecycle](../runtime/lifecycle.md) owns admission and projection readiness.
- [Data access](./data-access.md) distinguishes isolation from permissions/loading.
