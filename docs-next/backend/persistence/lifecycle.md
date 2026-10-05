---
id: zero.persistence.lifecycle
type: operations
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: lifecycle
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

# Start, Stop, Close And Abort

[Persistence index](./index.md) · [Documentation index](../../index.md)

The composed SQLite service owns its background loops and final
persistence boundary. Keep ownership explicit when injecting a service into
ReactiveDB or another managed plane.

## Distinct Operations

| Method | Responsibility |
| --- | --- |
| start | start enabled snapshot/checkpoint loops; repeated active start is harmless |
| stop | stop loops without closing the active database |
| close | flush enabled hot snapshot or file checkpoint, finalize cache and close owned handle |
| abort | failed-start discard without publishing a new hot image/checkpoint |
| diagnostics | cheap mode/path/snapshot health/helper status |

Hot close refuses to report successful release when its required final image
was not written. File close requests TRUNCATE checkpoint. Statement finalization
and raw close preserve retry ownership; a thrown close is not a reason to delete
durable files.

Bun deferred raw close accommodates caller-owned live statements. For Fabric
actor replacement, subprocess exit proof—not a local service flag—establishes
that the old actor can no longer write.

## App-Local Observability

Persistence lifecycle/snapshot/checkpoint codes use the injected observability
runtime where present. Internal actor policy can disable these lower-level
emissions and own actor telemetry separately.

Snapshot/checkpoint diagnostics avoid forwarding filesystem/SQL-bearing exception
content by default. A trusted error cause still needs redaction before external
export. Diagnostics may intentionally include path fields; do not expose the
raw service diagnostics wholesale to untrusted clients.

## Drain Before Closing

Managed app extensions drain before Guardian/Fabric providers dispose.
Unsubscribe/stop only extension-owned work; don't close the shared data service
from an arbitrary request. SIGKILL cannot run a final snapshot/drain, so recovery
semantics must match the selected durability mode.

## Verify

Use disposable stores to test repeated start/stop, final snapshot failure,
statement/close retry and failed-start abort without publishing bad state.
No sample check should delete a live app database or storage directory.

## Related Guides And Next Steps

- [Runtime shutdown](../runtime/shutdown.md) joins application drains.
- [Hot snapshots](./hot-snapshots.md) owns publication outcomes.
- [WAL](./wal.md) owns file checkpoints.
- [ReactiveDB lifecycle](../reactive-db/lifecycle.md) respects injected service ownership.
