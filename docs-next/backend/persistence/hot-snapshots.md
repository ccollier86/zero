---
id: zero.persistence.hot-snapshots
type: operations
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: hot-snapshots
maturity: supported
applies_to: ["2.6.0 source; identify the installed archive by commit/hash"]
modes: [file, hot, ephemeral, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "cb7ffed940232f0889a306d75414e95aeb9e89c7"
  snapshot: dirty
  date: "2026-10-19"
  evidence_level: source-observed
---

# Publish Hot Recovery Images

[Persistence index](./index.md) · [Documentation index](../../index.md)

SnapshotManager serializes the active in-memory database and publishes
an atomic recovery image. It does not open the original connection or choose
a tenant/placement.

## Requests And Results

snapshot/snapshotSync return boolean written outcomes. The detailed async/sync
methods return SnapshotWriteResult:

| status | durable | Meaning |
| --- | --- | --- |
| written | true | this request published its image boundary |
| disabled | false | no enabled snapshot boundary |
| in-progress | false | another owned async request already active |
| superseded | false | newer published generation replaced this request |
| failed | false | publication failed; error is trusted diagnostic data |

Do not equate a nonthrowing false/detailed result with durable success.
The final composed hot close requires written when its snapshot boundary is enabled.

## Publication And Bounds

Images are byte-bounded when configured. Publication uses a temporary sibling,
file/directory synchronization and atomic replacement with generation fencing.
A delayed older async image cannot overwrite a newer synchronous final image.

Periodic work uses a monotonic watchdog and commit/capture generations.
Signal-only dirty/clean hooks let Fabric coordinate its own acknowledgement
policy. isHealthy latches false after a real failure for the manager lifetime;
failure retains the first cause even if later retry succeeds.

Standalone periodic snapshots are not an automatic on-write acknowledgement
guarantee. Fabric placement's explicit on-write/periodic policy owns its stronger
commit/health fencing.

## Idle Work And Performance

The automatic periodic cadence does not rewrite a known-clean published image.
Its conservative dirty proof includes connection-local SQLite changes, schema
version, user version and application ID, so untracked private SQL and metadata
changes are not mistaken for an unchanged tracked Sync sequence. An unknown
proof forces a real capture. A write arriving during async publication remains
uncovered until a newer capture; failed/superseded images cannot mark it clean.

Explicit async/sync and graceful-final requests keep their written-result
contract even when clean. When Fabric immediately forces a synchronous periodic
boundary or an automation claim, it records dirty state without first launching
a duplicate async image. Dirty/clean signals, watchdogs and fsync remain intact.

Every real hot/on-write durability boundary still publishes a complete image.
Image serialization/publication costs grow with database size; this is not an
incremental WAL or a free concurrent-write acceleration. Start write-heavy
workloads with [file placement](../fabric/placement.md) and measure the actual
deployment before choosing hot/periodic tradeoffs. An updater does not silently
change an application's placement or durability policy.

## Stop And Discard

stop retires periodic work; discard seals failed-start state so it is not
published as a valid image. Graceful service close establishes its final
snapshot before releasing owned resources. A process crash cannot execute
that final boundary.

Do not point multiple independently writable hot services at the same source/
snapshot. Managed path ownership/actor generation proof and external filesystem
guarantees are necessary operational boundaries.

## Verify

Use disposable images and controllable delays to test failure/timeout health,
supersession, maximum image size, dirty captures, final sync publication and
restart. Never overwrite a live recovery image to test a snippet.

## Related Guides And Next Steps

- [Modes](./modes.md) explains source selection.
- [Configuration](./configuration.md) sets interval/path/bounds.
- [Lifecycle](./lifecycle.md) owns final durability and failed-start abort.
