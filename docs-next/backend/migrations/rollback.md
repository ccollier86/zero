---
id: zero.migrations.rollback
type: how-to
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: rollback
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

# Rollback Requires Real Inverse Logic

[Migrations index](./index.md) · [Documentation index](../../index.md)

Migrator.rollback(toVersion?) rolls back applied entries newer than the
exclusive target, in reverse order. With no target it rolls back only the latest
applied entry.

## Required Handler And Approval

Every selected entry needs a real down handler. Down safety defaults destructive
and requires allowDestructiveDown independently of forward allowDestructive.
A comment/TODO or empty function is not a safe inverse implementation.

The corrected planner omits down altogether until real inverse logic is authored,
so status.hasDown cannot confuse a generated no-op with implemented rollback.
Generated forward SQL still requires review.

## Durable State

Each down operation has its own IMMEDIATE transaction, checksum/dependency
recheck and installed snapshot. If it fails, changes roll back and the latest
successful applied state remains applied. The failed event remains visible for
diagnosis/retry; it does not turn that entry into pending forward work.

A stale runner cannot reverse an older migration while newer durable dependencies
remain applied. A Promise/thenable-returning down cannot prematurely mark the
entry rolled back.

## Data And Operational Safety

Dropping a table is not restoration of old data.
A backup file is not automatically replayed by rollback, and an irreversible
external side effect is not undone by SQL down.
Test a real restore/down path against disposable representative data before
relying on it operationally.

Do not edit an applied down body just to match a different desired restore:
the retained checksum covers migration source and remains enforced after
successful rollback.

See [backups](./backups.md), [registries](./registries.md),
[planning](./planning.md) and [CLI](./cli.md).
