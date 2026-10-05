---
id: zero.kv.configuration
type: reference
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: app-and-service-config
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

# KV Configuration

[KV index](./index.md) · [Documentation index](../../index.md)

createApp kv is boolean/KvServiceConfig; omitted or true enables defaults,
false omits the plugin. KV is server-only and app-wide, not a Guardian
organization database/table or browser preference store.

| KvServiceConfig option | Default / meaning |
| --- | --- |
| baseDir |./data/kv; trusted journal/checkpoint location. |
| durability |everysec; memory/always alternatives. |
| fsyncMs |1000, validated positive interval. |
| checkpointIntervalMs |30000, validated positive interval. |
| corruptRecordPolicy |fail; skip is explicit recovery tradeoff. |
| clock |systemKvClock/Date.now; ManualKvClock useful for tests. |
| memory.defaultTtlMs |No default; null explicitly no expiry. |
| memory.maxEntries/maxBytes |Unbounded unless supplied; approximate value capacity. |
| memory.eviction |lru; none rejects required eviction. |
| memory.evictionRecency |access in pure memory, mutation in durable service; durable access rejects. |
| memory.ttlBucketMs |250. |
| engine/journal/checkpoint |Optional trusted prebuilt seams, mainly deterministic tests; caller must keep their clocks/durability/ownership consistent. |
| emitCode |Optional app-bound emitter; managed composition supplies it. |

These are construction/startup settings, not hot database/env controls.
No dedicated KV env binding/Doctor subtree was established in this source.
A custom prebuilt engine/journal can bypass config construction defaults;
it must not be handed to untrusted request code.

## Plugin And Service Access

createKvPlugin additionally accepts optional service/runtime/
onServiceCreated/onInitializerCreated for trusted composition. It is named,
owns recovery/readiness and exposes kv/kvService/counter/limiter in Elysia
context, with no public HTTP routes. getKvService/clearKvService are
unambiguous compatibility ownership seams, not tenant selection.

Normal multitenant strict authority projection does not expose unrestricted
app-wide KV to verified machine principals. Use explicit app authorization and
safe keys rather than fabricating a browser principal.

- [Engine](./engine.md) owns TTL/eviction behavior.
- [Durability](./durability.md) owns fsync/corruption semantics.
- [Lifecycle](./lifecycle.md) owns managed readiness/shutdown.
