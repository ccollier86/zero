---
id: zero.data-studio.realm-integration
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: realm-integration
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

# Trusted Actor Handlers And Feature Composition

[Data Studio index](./index.md) · [Documentation index](../../index.md)

DATA_STUDIO_REALM_CONTRIBUTION supplies the fixed schemas, migrations and
registered query/command handlers loaded locally by actors.
Executable handlers do not come from the logical table schema JSON.

## Registry

Queries cover tables.list/get, rows.list/get and schema-versions.list.
Commands cover tables.create/update/set-status and rows.create/replace/delete.
Use exported DATA_STUDIO_QUERY_NAMES/DATA_STUDIO_COMMAND_NAMES rather than
guessing internal strings.

The bound service translates admitted actor/value/revision input and validates
results. Calling raw command names with forged user/membership fields is not a
supported machine-authentication shortcut.

## Fixed Backing Tables

Logical catalogs/rows/cells/stats/history live in the organization's Fabric DB.
The system control plane remains separate.
Official contribution/resource/client fragments must be composed together;
startup verifies exact handlers and schemas, not matching names alone.

A newly created logical table remains data in that admitted realm.
It doesn't change the app's physical TableSchema map, generate SQL code,
register arbitrary triggers/functions, or change the parent actor fingerprint.

## Further Automation

Functions/workflows can call the supported Data Studio service/SDK from an
appropriate live-authority integration. Keep external work outside synchronous
SQLite commands and persist only canonical bounded JSON values.

A database automation trigger on fixed backing tables is trusted app code and
needs careful logical-table correlation; it is not automatically a per-table
user-authored trigger language.

See [Fabric composition](../fabric/realm-composition.md),
[database automations](../database-automations/index.md),
[ownership](./ownership.md), [public API](./public-api.md) and
[installation](./installation.md).
