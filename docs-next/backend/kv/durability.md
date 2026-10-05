---
id: zero.kv.durability
type: reference
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: journal-checkpoint-recovery
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# KV Durability, Checkpoints And Recovery

[KV index](./index.md) · [Documentation index](../../index.md)

Writes append before applying to live memory. A successful promise satisfies
the selected durability condition; increasing durability does not replace the
atomic decision boundary documented in [concurrency](./concurrency.md).

| Mode | Successful-write condition |
| --- | --- |
| memory | Local in-memory journal/apply; no disk recovery. |
| everysec (default) | Append accepted, memory applied; periodic fsync normally every1000ms. Crash may lose not-yet-synced writes. |
| always | Journal bytes and initial required directory namespace durability synced before write acceptance/apply. |

Graceful flush/stop improves final persistence; it does not retroactively make
everysec acknowledgment equal to always under sudden power failure.
Filesystem/runtime guarantees still govern physical durability.

## Checkpoint

Default files are journal.jsonl and checkpoint.json under baseDir.
Checkpoint covers ordered applied sequence and live entries, after journaled
expiry pruning. Serialization/round-trip validation occurs before replacing
the last known-good checkpoint via same-directory atomic rename/fsync.
A failed replacement does not delete the previous checkpoint.

checkpoint is single-flight; admitted mutation work waits at its barrier.
Public memory-mode checkpoint is a no-op. Lower-level checkpoint/journal APIs
are trusted persistence tooling, not concurrent service mutation shortcuts.

## Recovery

start restores checkpoint then replays journal records beyond its boundary.
Current-format sequence gaps/out-of-order/corrupt records fail by default.
corruptRecordPolicy:skip explicitly trades complete recovery for continuing
past rejected records, with safe skipped-recovery telemetry.
A safely identified unterminated final frame can be removed/recovered without
treating interior corruption as a valid tail.

Legacy format recovery preserves the old physical replay order, tracks its
maximum sequence and upgrades to the current format; legacy undefined-value
loss is explicitly accounted. This is recovery compatibility, not permission
to hand-edit journals or combine independent instances.

## Failure And Operations

A append/fsync failure is sticky on that journal and rejects later operations.
A rejected request may have written some journal bytes; do not equate failure
with guaranteed absence on disk. Inspect/recover the owned synthetic or
authorized operational data through normal startup, not an automatic destructive
reset. Apply failure similarly fences state until recovery.

Backups must capture a coherent owned journal/checkpoint boundary and preserve
the exact prior files/format. Never delete a real KV directory to resolve a
documentation/test failure.

- [Lifecycle](./lifecycle.md) owns stop/drain and maintenance.
- [Errors](./errors.md) owns safe diagnostics.
- [Configuration](./configuration.md) owns directory/durability/corruption options.
