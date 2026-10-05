---
id: zero.migrations.declarations
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: declarations
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

# Write Synchronous Migration Definitions

[Migrations index](./index.md) · [Documentation index](../../index.md)

A Migration declares version, description and up(db), with optional down,
safety, downSafety and backupRequired. Functions receive trusted raw
bun:sqlite Database, not a request authorization capability.

## Example

```ts
import type { Migration } from '@zero/framework/migrations';

export const migration: Migration = {
  version: '001',
  description: 'create application notes',
  safety: 'safe',
  downSafety: 'destructive',
  up(db) {
    db.run('CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)');
  },
  down(db) {
    db.run('DROP TABLE notes');
  },
};
```

The destructive down loses data; it is a demonstration, not a safe default for
every real app. Review backups, actual inverse logic and deployed dependencies.

## Synchronous Contract

Handlers must finish SQL before returning. The corrected registry rejects
native async/generator functions before opening an owned database.
A synchronous-looking wrapper returning a thenable is rejected inside the
transaction before successful ledger/history recording; synchronous writes in
that attempt roll back and rejection is observed.

MigrationHandlerError has stable code MIGRATION_HANDLER_INVALID and up/down
direction, without SQL/path payload.
Do not use async, network calls, AI, callbacks that outlive the migration, or
a raw handle retained for later work. Rejecting an invalid Promise is not
cancellation of arbitrary trusted code already started outside this boundary.

Ordinary synchronous return values remain ignored for compatibility; return a
void SQL operation rather than treating a result as workflow output.

## Version And Safety

Use unique lexically increasing stable versions, usually zero-padded IDs.
Forward safety defaults safe; down safety defaults destructive.
backupRequired explicitly requires a backup; guarded/destructive policy may
also demand one.

Append definitions to an explicit registry; never edit an already applied body
to “fix” its checksum. See [registries](./registries.md),
[apply](./apply.md), [rollback](./rollback.md) and [backups](./backups.md).
