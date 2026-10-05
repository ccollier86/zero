---
id: zero.guides.mode-selection
type: architecture
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: mode-selection
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [single, multi, simple-RBAC, advanced-RBAC, single-topology, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Choose Independent Application Modes

[Guides index](./index.md) · [Documentation index](../index.md)

Decide ownership before copying configuration. Zero has several independent
axes; selecting one does not silently configure the others.

| Axis | Choices | Controls |
| --- | --- | --- |
| Guardian tenancy | single / multi | Application identity scope versus organization membership |
| Guardian authorization | simple / advanced | Simple role projection versus retained roles/permissions |
| App data topology | single / multiple | One pinned app database versus actor-backed logical databases |
| Tenant isolation | shared-row / tenant-database | Declared discriminator versus admitted physical tenant file |
| Persistence | ephemeral / file / hot | Lifetime and durability/placement |
| Table loading | full / lazy / auto | Initial client loading; never permission |

Managed system data remains separate even in a single application topology.
Hot is not a tenancy mode; a tenant file is not a permission grant.

## Common Starting Points

A basic single workspace can use single/simple Guardian and one app file.
Delegated roles in one workspace can use single/advanced. Organizations can
use multi/simple when exactly one role expresses membership authority, or
multi/advanced for combined app/platform grants and detailed RBAC.

Fabric tenant-database isolation is useful when independent organization files
are part of the app's data/security model. It still needs live Guardian scope
and resource policy. Multiple topology with shared-row isolation does not make
tenant discriminator columns unnecessary.

Some features have stricter prerequisites. Data Studio requires multi,
advanced RBAC and Fabric tenant-database isolation. Do not claim every feature
works in every mode merely because the normal authentication kernel does.

## Keep The Roles Separate

The Administration Organization can use the app in its own workspace.
Application-scoped platform authority and tenant-scoped app authority remain
independent. An app-only administration member is not a platform operator.
Advanced mode permits both grants in one membership; simple mode has one role.

## Upgrading An Existing Model

A config-string change is not a data/ownership migration. Identify canonical
owners, memberships, roles, app rows, files, credentials and the new resource
boundaries before changing profiles. No generic one-command conversion moves
old shared rows into correctly owned tenant databases.

See [Guardian modes](../backend/guardian/modes.md),
[Fabric topology](../backend/fabric/topology.md),
[persistence modes](../backend/persistence/index.md),
[data planes](../concepts/data-planes.md) and [upgrade](./upgrade.md).
