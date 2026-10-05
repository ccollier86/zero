---
id: zero.migrations.configuration
type: reference
audience: [developer, agent, operator]
owner: migrations
status: draft
visibility: internal
system: migrations
feature: configuration
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

# Migrator Configuration Reference

[Migrations index](./index.md) · [Documentation index](../../index.md)

## Connection Ownership

| Option | Default / meaning |
| --- | --- |
| dbPath | required if no injected database; used for target/backups |
| database | optional existing trusted Bun Database |
| ownsDatabase | false for injection; true for an opened owned target |
| migrations | required ordered registry |
| applyPragmas | true for owned targets, false for injection |
| busyTimeoutMs | 30000; non-negative finite, normalized integer |

busy_timeout is applied even when applyPragmas is disabled, to support
IMMEDIATE migration writer admission. Owned initialization failure closes the
opened handle; rejected registry/timeout admission occurs before opening it.

Injected path metadata must identify the real plane for backup purposes.
An omitted path becomes :memory: in the standalone helper; it does not infer a
tenant database from a request.

## Safety And Diagnostics

| Option | Default / meaning |
| --- | --- |
| allowDestructive | false; forward gate |
| allowDestructiveDown | false; down gate |
| backupDir | target parent/backups |
| createBackups | true, subject to file target and required-backup rules |
| log | standard platform migration log sink; app-owned callback can replace it |

The log callback is trusted operational code, not a browser-visible progress API.
Avoid attaching sensitive rows/SQL/bind values in custom logs.
MigrationHandlerError uses safe code/direction for the corrected synchronous
boundary; ordinary SQL failures retain their operational handling.

## Managed Read Time

App migrate resolves true by default, but per-plane bootstrap decides which
built-in installation is appropriate. It is not a universal old-layout
converter or instruction to apply system migrations everywhere.

Fabric realm migrations are captured in an immutable admitted registry and
fingerprint. Changing caller config after construction is not a live alteration
of applied migration content.

See [registries](./registries.md), [declarations](./declarations.md),
[data planes](./data-planes.md), [backups](./backups.md) and [CLI](./cli.md).
