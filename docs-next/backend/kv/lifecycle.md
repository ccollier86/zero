---
id: zero.kv.lifecycle
type: operations
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: startup-maintenance-and-stop
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

# KV Startup, Maintenance And Shutdown

[KV index](./index.md) · [Documentation index](../../index.md)

Await start before mutations or reading during recovery. Managed plugin
requests wait on the same cached startup promise, so a listener cannot serve
partially recovered KV. Recovery failure clears partial memory and fails
startup safely.

start/stop transitions are serialized and shared; racing lifecycle calls
cannot create duplicate maintenance loops. A disposed managed plugin cannot
restart after its owning app begins shutdown.

## Background Work

Durable mode starts periodic fsync and checkpoint loops. Each kind avoids
overlapping its own pending invocation. Failures stop the corresponding timer
and emit KV_FLUSH_FAILED/KV_CHECKPOINT_FAILED plus
KV_BACKGROUND_PERSIST_FAILED. They are not silently treated as successful
durability; operators must act on the failure.

Manual flush and checkpoint remain explicit acceptance promises. Memory
mode has no persistence timers; status reports started/sequence/entries/
approximateBytes without claiming a physical disk/RSS measurement.

## Stop Barrier

Stop closes new mutation admission, clears timers and waits for admitted
loaders/key mutations/sequence apply/background maintenance. It then flushes
and performs the final checkpoint where applicable. The service marks itself
stopped even if final persistence fails; the failure propagates/observes,
not a successful stop event.

Managed app cleanup awaits this barrier because the Bun/Elysia adapter does
not await every async onStop hook by itself. Do not replace it with fire-and-
forget stop or delete a directory while admitted work still owns it.

## Verification And Related Guides

Test delayed loaders/journal writes, rejection releasing queues, stop during
startup, concurrent lifecycle transitions and final checkpoint restart.
Use only newly created disposable KV fixtures.

- [Runtime shutdown](../runtime/shutdown.md) owns ordered app drain.
- [Concurrency](./concurrency.md) owns admitted mutation boundaries.
- [Durability](./durability.md) owns final persistence/recovery.
