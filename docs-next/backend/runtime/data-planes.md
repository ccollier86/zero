---
id: zero.runtime.data-planes
type: architecture
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: system-application-separation
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

# Use Application And System Data Deliberately

[Runtime index](./index.md) · [Documentation index](../../index.md)

Managed Zero always separates its internal system data from application data,
including single-database applications. “Single database” means one
**application** data plane; it does not put Guardian and other platform internals
back into that file. [Shared data-plane concepts](../../concepts/data-planes.md)
is the canonical architecture explanation.

## Setup Handles

| Trusted setup member | Data responsibility |
| --- | --- |
| `zero.db`, `zero.syncDB` | primary application ReactiveDB |
| `zero.sql`, `zero.sqlite` | application PlatformSQLiteService, when present |
| `zero.system.db` | system ReactiveDB |
| `zero.system.sql`, `zero.system.sqlite` | system PlatformSQLiteService |
| `zero.databases` | managed topology owner; file binding is a privileged operation |

`system` can be null in standalone composition that has not installed a managed
system plane. Managed creation installs the explicit plane. Do not assume a
standalone getter creates/migrates a control database for you.

Normal request code should use its [scoped services](./server-services.md),
not raw setup handles. Multi-tenant request contexts hide system/app raw handles
behind deliberate `unsafe`; strict machine projections never expose them.

## User-Owned Application Records

A note's `author_id` belongs in the application's table. Canonical user
credentials, profile and authority belong in the system database. Declare
`field.guardianUser()` or `field.guardianMembership()` to request a minimal
local anchor for a real SQLite foreign key.

An anchor is an ID/existence dependency, not a duplicated authentication store.
It neither grants access nor replaces canonical role/profile lookups.
[Guardian references](../schema/guardian-references.md) owns the exact field,
mode and readiness contract.

## Existing Data And Migrations

The application and system planes must have distinct storage ownership and
paths. Managed startup rejects an application database carrying the prohibited
legacy system layout. It does not silently move your production authentication
tables during app startup.

System migrations are platform-owned. Application/tenant tables and realm
migrations are app-owned. Supply explicit topology/schema configuration;
changing a TypeScript declaration alone is not a data migration.

When upgrading an older combined-layout app, take a recoverable backup and
plan/verify its migration separately. Do not point a new app at live data just
to see whether a docs example boots. This page does not claim a universal
automatic split migrator exists.

## Verification

Use fresh disposable application/system databases to verify distinct paths,
local Guardian FK anchors, canonical profile/authority lookups and rejection
of the old combined layout. In Fabric mode, also test that only the relevant
tenant identities are provisioned into each target and that no user can choose
another organization's file.

## Related Guides And Next Steps

- [Data-plane concepts](../../concepts/data-planes.md) explains physical versus logical isolation.
- [Guardian references](../schema/guardian-references.md) declares user-owned rows without copying authentication.
- [Lifecycle](./lifecycle.md) places migrations and projection readiness before publication.
- [Machine services](./machine-services.md) keeps privileged setup handles out of verified-machine work.
