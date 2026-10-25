---
id: zero.migrations.planes
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: planes
maturity: supported
applies_to: ["2.6.0 with the legacy-state staging extension"]
modes: [system, application, Fabric-realm]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "66035d0dad75ea2276ce2f888499e2292b1ee995"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Target The Correct Migration Plane

[Migrations index](./index.md) · [Documentation index](../../index.md)

## Managed System

Built-in Zero migrations install Guardian and platform service state into the
independent system database. Managed startup does not apply the built-in registry
to the user application's primary/Fabric tables.

System default path is ./data/zero.system.db unless configured.
The managed bootstrap skips built-in disk migration execution for ephemeral
system storage and initializes its appropriate in-memory schema separately.

## Application

The app declares its own schema. Standalone app migrations are trusted raw
SQLite operations with their own registry/target; they must not import and run
the system registry by accident.

Application schema Doctor/plan is readonly inspection requiring an explicit --db
plus trusted schema module. That path does not create a system ledger in the app
DB.

## Fabric Realm

Each actor admits its immutable realm and applies the realm's ordered migrations
before completing schema/binding/readiness.
Migration checksums participate in realm identity and mismatch fails closed.
Canonical Guardian tables remain in systemDb; required local FK anchors are
framework-owned, not user migrations recreating credentials.

See [realms](../fabric/realms.md) and
[identity projection](../fabric/identity-projection.md).

## Old Combined Layouts

Old apps with platform tables mixed into their app DB are not silently split.
The new layout guard rejects incompatible combined targets.
No universal zero migrate command converts every old app into Guardian/Fabric
or copies tenants/ownership safely by inference.

The [legacy state boundary](./legacy-state.md) provides a narrow public offline
staging path for the known Zero 1.3 combined schema. It preserves identities and
canonical values, partitions approved ledgers and advances only the new system
plane. It is not startup migration or a converter for arbitrary old schemas.
Application compatibility and pending-work execution authority remain explicit
acceptance gates; retain the old bundle and verified restore path.

See [CLI](./cli.md), [runtime planes](../runtime/data-planes.md),
[backups](./backups.md) and [roadmap](./roadmap.md).
