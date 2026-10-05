---
id: zero.persistence.configuration
type: reference
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: configuration
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

# SQLiteStorageConfig Reference

[Persistence index](./index.md) · [Documentation index](../../index.md)

Import storage config/resolved types and `resolveSQLiteStorageConfig`
from `@zero/framework/persistence`. This resolver reads ordinary declaration
values, not implicit per-request environment bindings. Resolve before opening;
a later config mutation does not reconfigure a live handle.

## Storage And Durability

| Option | Accepted value / omitted default |
| --- | --- |
| mode | hot/file/ephemeral or legacy memory/:memory:/file-path string; hot |
| path | string; ./data/app.db for persistent source/file |
| snapshotPath | string; hot path rule described in [modes](./modes.md) |
| snapshotEnabled | boolean; true for hot, false outside hot |
| snapshotIntervalMs | positive integer up to portable timer maximum;30000 |
| hotMaxBytes | optional positive integer serialized-image/page bound in hot mode |
| emitTelemetry | boolean; true |

Standalone hotMaxBytes omission is unbounded; Fabric explicit hot placement has
mandatory policy bounds. The option is not a blanket process RSS cap.

## Connection And Helper Tuning

| Option | Default | Effect |
| --- | ---: | --- |
| cacheSize | -262144 | SQLite cache_size PRAGMA |
| mmapSize |1073741824| file-mode mmap_size |
| walAutocheckpoint |1000| file WAL threshold; positive integer |
| pageSize |4096| SQLite page_size; positive integer, actual SQLite rules still apply |
| synchronous |NORMAL| file-mode OFF/NORMAL/FULL/EXTRA |
| tempStore |MEMORY| DEFAULT/FILE/MEMORY |
| busyTimeout |5000| lock wait milliseconds; positive integer |
| statementCacheSize |1000| retained statements; positive integer |
| bufferPool | enabled object | false disables; otherwise helper options |
| bufferPool.maxPoolSize |100| per-bucket retained buffers; corrected nonnegative safe integer admission |
| bufferPool.preallocate |true| corrected warmup up to min(10,maxPoolSize) per standard bucket |

Memory/hot use MEMORY journal mode and synchronous OFF for the active RAM
database; their persistence is the snapshot, not a secretly file-backed commit.
File mode applies WAL/synchronous/mmap/autocheckpoint and FK/optimization policy.

Option types are not a universal runtime validation promise. Some PRAGMA values
are delegated to SQLite; increasing pageSize on an existing file does not itself
perform a schema/data conversion. [Connections](./connections.md) owns safe
open failure reporting.

## Readiness And Security

Paths/config are trusted server inputs. Never use an untrusted tenant ID as a
filesystem path or serialize a server storage config to clients. Managed
composition rejects colliding app/system/actor-owned paths.

The corrected buffer admission runs before opening SQLite so an invalid policy
does not leak a newly acquired handle. Rejected options remain setup failures,
not generic public HTTP messages.

## Related Guides And Next Steps

- [Modes](./modes.md) explains recovery semantics.
- [SQLite service](./sqlite-service.md) composes the resolved helpers.
- [Lifecycle](./lifecycle.md) owns shutdown durability.
- [ReactiveDB configuration](../reactive-db/configuration.md) adds change/ownership options.
