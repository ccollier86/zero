---
id: zero.observability.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: observability
status: draft
visibility: internal
system: observability
feature: future-direction
maturity: planned
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

# Observability Roadmap

[Observability index](./index.md) · [Documentation index](../../index.md)

Known product direction includes optional Fabric-separated logs/errors/metrics,
reusable viewers and error grouping by app version/build/commit with source-map
symbolication. These are not implemented by the current bounded MemoryEventStore.

- [ ] Design durable log/error/metric storage and retention per owning app.
- [ ] Build token-themed viewers with explicit platform/tenant access.
- [ ] Evaluate build-aware errors/source maps and safe external adapters.
- [ ] Consider analytics and AI usage/cost presentation without mixing operational events, billing truth and compliance audit.
- [ ] Evaluate OpenTelemetry adapters rather than replacing the core event boundary.

No schedule or existing Sentry-compatible API is implied.
[Current sinks](./sinks.md), [store](./store.md) and
[Guardian audit](../guardian/audit.md) describe separate present capabilities.
