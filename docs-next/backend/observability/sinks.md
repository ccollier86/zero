---
id: zero.observability.sinks
type: reference
audience: [developer, agent, operator]
owner: observability
status: draft
visibility: internal
system: observability
feature: adapters-and-isolation
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server, frontend]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Sinks, Stores And App-Local Isolation

[Observability index](./index.md) · [Documentation index](../../index.md)

PlatformSink is write-only: emit(event): void | Promise<void>.
PlatformEventStore adds synchronous query and optional clear.
A sink does not automatically provide searchable data or durable persistence.

## Composition

Managed observability enables console and memory store by default.
Configured sink is **added** to the enabled console/store composite.
For custom-only output set console:false and store:false explicitly.

ConsoleSink formats timestamp/severity/prefix/code/message and safe supplied
details. CompositeSink sends each event to all targets and isolates individual
sync throws/async rejections. MemoryEventStore is both a sink and queryable
store. The runtime returns emission before async export is complete.

```ts
import { configureObservability, MemoryEventStore, type PlatformSink } from '@zero/framework/observability';

const store = new MemoryEventStore({ maxEvents: 500 });
const external: PlatformSink = {
  emit(event) {
    // Map only reviewed safe fields to your own export adapter.
    void event.code;
  },
};
const runtime = configureObservability({ console: false, store, sink: external });
```

This is an adapter-shape example, not actual external delivery. Do not copy a
raw error/event wholesale into a third-party service.

## Ownership And Compatibility

createApp owns its resolved runtime and managed feature emitters. An explicitly
bound emitter cannot be redirected by a later ambient configureObservability.
configureObservability/getObservabilityRuntime/getPlatformSink/
getPlatformEventStore and setPlatformSink are process compatibility APIs for
trusted standalone integration.

setPlatformSink replaces the ambient sink while preserving store/config and
sequence continuity; it differs from additive config.sink. That preserved store
will receive new events only if the replacement sink forwards them. Do not
interpret runtime.store presence as automatic delivery through any replacement.

## Durability And Shutdown

Default sinks are best-effort. PlatformSink has no flush/drain lifecycle
contract. An app-owned durable adapter must own buffering/retry/storage/drain
through its explicit extension lifecycle and not promise success from emit.
No default Fabric log database or automatic external collector is configured.

- [Configuration](./configuration.md) owns additive/default choices.
- [Store](./store.md) explains recent-memory semantics.
- [Runtime shutdown](../runtime/shutdown.md) owns extension drain.
