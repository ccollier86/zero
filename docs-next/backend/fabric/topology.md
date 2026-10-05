---
id: zero.fabric.topology
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: topology
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Choose A Fabric Topology

[Fabric index](./index.md) · [Documentation index](../../index.md)

## Single Is Still Split

Omitted `databaseTopology` and `{ mode: 'single' }` select one application
database. Guardian and Zero's internal tables still live in the independent
`systemDb`. Single does not mean mixing credentials and app records in one file.

Multiple mode adds actor-backed logical databases under a private root. It does
not remove the pinned app plane or move canonical Guardian records into each
actor file.

## Physical Tenant Isolation

With `tenantIsolation: 'shared-row'` (the default), declared tenant discriminators
and resource scoping still matter. Multiple topology alone is not permission to
remove tenant columns.

With `tenantIsolation: 'tenant-database'`, multi-tenant Guardian chooses the
physical application database from verified current organization context.
Realm tables must be a schema-identical subset of the app's declared tables.
Tenant identity identifies the file boundary rather than an extra row
discriminator for tenant-scoped resources. Business ownership and row/field
permissions remain independent.

A customer organization and the protected Administration Organization can both
use their own application database. Platform administration authority does not
grant unrestricted access to another organization's app records.

## Trusted Named Databases

Trusted server composition can use independent named databases for app-defined
needs. A browser must not supply a name or tenant ID to a raw manager endpoint.
A name that happens to resemble a user/organization ID conveys no authority.

Use [opaque identities](./database-identities.md), normal
[tenant capability projection](./tenant-isolation.md), and the explicit
[configuration reference](./configuration.md). Deciding to place future logs or
metrics in another plane is a separate integration task, not a built-in logging
dashboard created by enabling multiple mode.

## Starting And Upgrading

Actors admit their immutable realm, file identity, migrations and required
anchors before a usable capability is returned. See
[identity readiness](./identity-projection.md) for onboarding behavior.
The split is the new managed architecture, not an automatic converter for old
combined databases. Back up and plan old app data conversion explicitly; no
universal legacy split migrator is promised.
