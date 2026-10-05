---
id: zero.migrations.backups
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: backups
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

# Migration Backup And Restore Boundaries

[Migrations index](./index.md) · [Documentation index](../../index.md)

Safety policy decides when a backup is required. The migration backup helper
snapshots the live connected database with VACUUM INTO, rather than copying only
the main file and losing committed WAL pages or a hot RAM-active image.

## Artifacts

File backups receive a timestamped/random unique name, a content hash and
restricted0600 permissions. The runner records backup artifact evidence.
This includes full target data, so keep backup storage private and apply
retention/operational access policy.

Memory-only paths cannot produce a durable backup artifact.
An injected hot handle with a real configured path can be snapshotted even if
its recovery file has not yet been published.

## Gates

Forward destructive/manual classifications require their explicit policy;
down has a separate destructive gate.
backupRequired or guarded/destructive operation rules can require backup before
the transaction attempt.

Turning createBackups off does not make a required-backup operation safe; the
required gate must be satisfied. Check the exact target, permissions, available
space and successful artifact rather than treating “backup enabled” as proof.

## Not Automatic Restore

Rollback executes down; it does not automatically restore a backup.
A backup is useful only with a tested restore procedure, correct file/binding
ownership and a managed stopped/reopened lifecycle.
Do not overwrite a live Fabric file behind active actors.

MigrationArtifacts is an internal implementation, not a named public package
export. Use Migrator's supported safety/backup configuration and operational
artifact records rather than importing internal files.

See [configuration](./configuration.md), [rollback](./rollback.md),
[data planes](./data-planes.md), [Fabric recovery](../fabric/recovery.md) and
[hot persistence](../persistence/hot-snapshots.md).
