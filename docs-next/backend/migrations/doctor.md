---
id: zero.migrations.doctor
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: doctor
maturity: supported
applies_to: ["2.1.1 baseline with unreleased handler/planning corrections"]
modes: [system, application, Fabric-realm]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Migration Health And Application Schema Drift

[Migrations index](./index.md) · [Documentation index](../../index.md)

Migration health and application schema inspection are related but distinct.
Do not run a built-in system registry against the app DB to compare user tables.

## Reports

runMigrationDoctor checks known registry/ledger state: pending entries, failed
attempts, checksum drift, missing down and optional schema issues.
Strict mode treats warnings as failing the report; normal mode fails errors.
The helper's ledger initialization is a trusted mutating boundary.

Schema diff compares declared/installed tables, columns, primary/natural identity
and indexes. Issues have severity, safety and structured context.
A matching shape is not proof of row-level permissions, backups, handler behavior
or correct organization assignment.

## Readonly App Inspection

Use:

```sh
zero migrate --doctor --schema ./db/schema.ts --db ./data/app.db
```

The command imports the trusted schema module and opens the explicit database
readonly. A nonexistent path fails instead of creating an empty “healthy” DB.
No _zero_migrations/history/artifact tables are added by this inspection path.

App inspection requires --db and never falls back to SYSTEM_DB_PATH.
Schema-loading executes module code, so use a side-effect-free declaration
module and do not claim this command is a static parser/sandbox.

## Scope Of Doctor

The platform's broader zero doctor has its own configuration/runtime checks.
This migration report does not silently inspect every Fabric file or test
security enforcement for all transports.

See [CLI](./cli.md), [planning](./planning.md),
[schema history](./schema-history.md) and
[Fabric readiness](../fabric/identity-projection.md).
