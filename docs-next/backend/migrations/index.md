---
id: zero.migrations.overview
type: index
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: overview
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

# Migrations And Schema History

[Backend index](../index.md) · [Documentation index](../../index.md)

Migrations apply ordered synchronous SQLite changes with per-migration
transactions, durable checksums and append-only outcomes. Schema history and
planning explain drift; they do not authorize destructive SQL automatically.

## Declare And Execute

- [Declarations](./declarations.md): versioned up/down functions and safety.
- [Registries](./registries.md): immutable ordering/checksums and admitted handlers.
- [Apply](./apply.md): per-migration atomicity and durable state.
- [Rollback](./rollback.md): real inverse logic and separate destructive approval.
- [Configuration](./configuration.md): ownership, timeout, pragmas and backup policy.

## Inspect And Operate

- [Schema history](./schema-history.md): installed snapshots and hashes.
- [Doctor](./doctor.md): drift/findings, strictness and inspection boundaries.
- [Planning](./planning.md): reviewable draft SQL, not a complete rollback.
- [Backups](./backups.md): live-handle snapshots and explicit restore responsibility.
- [Data planes](./data-planes.md): system versus application/Fabric targets.
- [CLI](./cli.md): exact managed/inspection commands.
- [Roadmap](./roadmap.md): future conversion help, not a current universal migrator.

## Principles And Integration

Use [Schema](../schema/index.md) declarations for intended rows, the
[system/app split](../runtime/data-planes.md) for platform ownership, and
[Fabric realms](../fabric/realms.md) for actor schema/handler compatibility.
Migration DDL is trusted operational code, not a client CRUD write that
automatically gets resource validation or realtime emission.

The inspected engine favors append-only evidence, exact target ownership,
synchronous boundaries and explicit destructive gates.
The working corrections described here reject asynchronous handlers before
premature success and omit generated no-op rollback stubs; they are not yet a
released-package claim.
