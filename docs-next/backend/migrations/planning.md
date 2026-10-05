---
id: zero.migrations.planning
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: planning
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

# Generate Reviewable Migration Drafts

[Migrations index](./index.md) · [Documentation index](../../index.md)

createMigrationPlan compares declared tables with an actual snapshot and returns
issues, candidate statements, safety and needsManualReview.
renderMigrationPlan produces a source draft; it never applies the SQL.

## What Can Be Suggested

The planner can emit bounded isolated CREATE TABLE, admitted ADD COLUMN and
natural identity-index statements. Unsafe/non-isolated definitions cannot escape
their SQL slots; changes requiring data conversion or table rebuilding remain
manual review, not guessed destructive actions.

Plan safety aggregates issues/statements. A file with no emitted SQL may still
have important manual issues—it is not automatically a successful fix.

## Source And Rollback

The corrected draft imports Migration from the public
@zero/framework/migrations boundary, encodes version/description as source
literals and neutralizes comment terminators in diagnostic text.
It omits a down handler until actual inverse logic is written and tested.
A TODO is not reported as an implemented rollback.

```sh
zero migrate --plan --schema ./db/schema.ts --db ./data/app.db
```

This reads the explicit existing app database and prints a draft.
--write with --out requests a source artifact; inspect the exact output/target
before using it. That write is not a database apply operation.

## Review Before Adoption

Check dependency order, preserved data, index uniqueness, runtime version,
backup/restore and the actual app/Fabric plane. Append the approved definition
to the correct immutable registry; changing an already applied body is not a
migration strategy.

See [declarations](./declarations.md), [registries](./registries.md),
[rollback](./rollback.md), [backups](./backups.md) and [CLI](./cli.md).
