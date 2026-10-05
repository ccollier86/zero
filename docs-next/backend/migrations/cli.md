---
id: zero.migrations.cli
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: cli
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

# Migration CLI Targets And Modes

[Migrations index](./index.md) · [Documentation index](../../index.md)

zero migrate dispatches the standalone migration runner.
Package scripts migrate/migrate:status/migrate:doctor/migrate:plan run the same
subsystem with their corresponding flags.

## System Target

For built-in apply/status/checkpoint/health/down, target resolution is:
explicit --db, then SYSTEM_DB_PATH, then ./data/zero.system.db.
Legacy DATABASE_PATH is not the implicit system migration target.

```sh
zero migrate --status --db ./data/zero.system.db
```

Status uses a trusted Migrator and can initialize its ledger; it is not a
promise of a strictly readonly filesystem command.

## Application Inspection

```sh
zero migrate --doctor --schema ./db/schema.ts --db ./data/app.db
zero migrate --plan --schema ./db/schema.ts --db ./data/app.db
```

These import trusted declarations and inspect an existing exact app target
readonly. Missing --db or nonexistent app DB fails closed.
They do not fall back to a system target or install platform migration tables.

## Mutation And Artifact Options

Default mode applies pending system entries. --to is the inclusive forward
target; --down-to is the exclusive rollback target. Inspection/status modes and
conflicting target flags cannot be mixed.

--allow-destructive and --allow-destructive-down are separate approvals.
--backup-dir and --no-backup configure backup behavior subject to required gates.
--plan --write can emit a reviewed draft to --out with --version/--name;
it does not execute that draft against the app DB.
--strict changes warning failure behavior.

Read the command's printed plane/target before acting.
No sample command authorizes mutating an unrelated app or deployment.
See [apply](./apply.md), [rollback](./rollback.md),
[planning](./planning.md) and [Doctor](./doctor.md).
