---
id: zero.persistence.connections
type: operations
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: connections
maturity: supported
applies_to: ["2.1.1 baseline with unreleased transaction/buffer corrections"]
modes: [file, hot, ephemeral, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Open Resolved Bun SQLite Storage Safely

[Persistence index](./index.md) · [Documentation index](../../index.md)

`openSQLiteDatabase(resolved)` opens a Bun Database from
ResolvedSQLiteStorageConfig. Prefer the composed service unless deliberately
owning connection/helper lifecycle.

File mode creates the parent directory and opens a read/write file with WAL
policy. Ephemeral opens :memory:. Hot restores an admitted exclusive source
image into memory and applies memory/page-bound policy.

## PRAGMAs And Ownership

The connection owns mode-specific busy timeout, journal/synchronous/cache/page/
temp/FK/optimization settings. File additionally applies mmap/autocheckpoint/
journal-size policy. Hot applies an optional max_page_count bound so SQLite can
reject growth before exceeding the page budget.

An injected raw Database bypasses this opening path: the injecting caller owns
its PRAGMAs and lifecycle. A type assertion does not establish these invariants.

## Error Contract

Open failures are wrapped in DatabaseError with safe stable public details.
DATABASE_OPEN_FAILED reports an unsuccessful open with not-started outcome and
retryability derived from safe lock/resource classification. Initialization
cleanup failure can report DATABASE_EXECUTOR_FAILED with unknown outcome.
Original exceptions remain cause data for trusted diagnostics, not public text.

Failed initialization attempts close the acquired handle. Hot restore also joins
source journal restoration/close failures rather than silently abandoning an
exclusive source. Do not manually delete WAL/snapshot files after a failed open.

## Verify

Use fresh disposable files to test open/cleanup, collision aliases, rejected hot
image bounds and lock failure. Never open an existing production source merely
to evaluate a documentation example. Filesystem qualification and backups are
separate from a static config check.

## Related Guides And Next Steps

- [Modes](./modes.md) chooses the active/recovery boundary.
- [Configuration](./configuration.md) defines resolved options.
- [Lifecycle](./lifecycle.md) owns acquired service cleanup.
