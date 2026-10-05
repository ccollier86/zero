---
id: zero.inventory.observability
type: inventory
audience: [maintainer, agent]
owner: observability
status: draft
visibility: internal
system: observability
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed server app", "standalone server integration", "frontend client"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: committed-baseline-clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Observability System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Observability owns stable platform event codes, event/sink contracts,
app-isolated runtimes, default adapters, and optional status/trace surfaces.
Inspected Zero 2.1.1 source commit:
`a3a5f726768dac890f241a3899c0a1acb66265d9`; documentation-only `HEAD` is
`cd643b5b862f83b4ab40320486e1b89df1154c87`. No release qualification.

## Purpose And Terminology

Platform observability is the structured signal boundary for operational events
and diagnostics. A stable code names a class of event; a sink receives an event;
a store enables bounded retrieval; a trace or status endpoint is an explicit
surface, not an implicit public API. Redaction and app isolation are central
contracts.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Canonical draft guide | Review |
| --- | --- | --- | --- | --- | --- |
| Stable codes and emission | Supported; server/client | `OBS_CODES`; emit platform/custom/code to ambient or explicit runtime; warn/error/info helpers | code table/sink and service tests | [events](../../../backend/observability/events.md) | Source observed |
| Sink composition | Supported; server | `PlatformSink`, ConsoleSink, CompositeSink, app-local sink | sink adapters and app isolation tests | [sinks](../../../backend/observability/sinks.md) | Source observed |
| Bounded in-memory event store | Supported; server | `MemoryEventStore.emit/query/clear`; level/category/code/source/time/cursor filters | `memory-event-store.ts` and tests | [store](../../../backend/observability/store.md) | Source observed |
| Event read and frontend ingest endpoint | Supported/configurable; server | GET `/api/_zero/observability/events`; frontend ingest; access policy modes | plugin and tests | [endpoints](../../../backend/observability/endpoints.md) | Source observed |
| Elysia lifecycle trace/warnings | Supported; opt-in | `trace.enabled`, slow request/lifecycle thresholds | plugin trace implementation and tests | [tracing](../../../backend/observability/tracing.md) | Source observed |
| Browser client event boundary | Supported; frontend | `emitFrontendCode`, safe request/action reporting | frontend observability API/tests | [observability](../../../frontend/observability.md) | Source observed |

## Public Surface Map

Package export `@zero/framework/observability` re-exports stable codes,
adapters, global compatibility APIs, app-targeted emit variants, plugin
factory/config, runtime/sink/store contracts and in-memory store. Managed
`createApp()` constructs an app-local runtime and passes it into feature
services. Frontend client has its own API. Exact config/export/linkage should be
checked against package exports and `src/observability/index.ts` before a guide.

## Integration Map

- Platform services should emit stable codes through the observability layer;
  console is an adapter, not a direct `console.*` convention for reusable code.
- Managed apps use isolated runtime/sink instances. Compatibility ambient
  setters/getters remain for standalone compositions; do not present globals as
  preferred app binding.
- Events must redact credentials, auth headers, sensitive bodies, and PII;
  request paths are sanitized. Confirm exact field policy before examples.
- Optional routes need explicit enable/access mode and must not leak event data
  to unauthorized actors. Trace correlation and route status are distinct
  surfaces.
- Frontend observability is separate from server event stores and sinks.

## Configuration Inventory

`AppConfig.observability` accepts `false|ObservabilityConfig|undefined`;
runtime is app-local. `enabled` defaults true. `sink` adds an adapter to the default composite; absent
sink builds default console+store composite; `console` defaults true.
`store:false` disables readable memory store; absent store makes bounded
`MemoryEventStore(maxEvents=1000)`. `maxEvents` defaults 1000; corrected default
store admission requires a positive safe integer. `endpoint:false` disables routes; endpoint defaults enabled, path
`/api/_zero/observability`, frontend ingest true, max payload 32768 bytes;
read mode defaults admin when auth enabled, development otherwise; allowed
explicit values admin/development/admin-or-dev/disabled/custom callback.
`trace:false` disables tracing; absent trace means not enabled. `trace.enabled`
defaults false; slow request/lifecycle defaults 500ms/100ms. No sampling config
was found. Plugin uses app config at createApp composition; dedicated environment
bindings are absent, but NODE_ENV controls development read access. Doctor parity is
implemented in platform-doctor-operations.ts and called by runPlatformDoctor.

## Evidence And Verification

The [eight-page backend manual](../../../backend/observability/index.md) and
[browser companion](../../../frontend/observability.md) now cover actual
app-local versus compatibility runtime, additive backend versus replacement
frontend sinks, shallow redaction, finite retention and newest-tail cursor
semantics, protected reads, bounded ingest, trace, configuration and roadmap.

### Authorized Retention Correction

Detailed review reproduced maxEvents NaN/Infinity admitting effectively
unbounded retention (0 passed / 1 failed). Development source rejects invalid
nonpositive/fractional/unsafe bounds before store construction. New
ObservabilityConfigurationError (OBSERVABILITY_CONFIG_INVALID) is additively
exported from @zero/framework/observability and also used for existing invalid
payload-byte bounds. Store/plugin/ingest suite passed 24 tests / 69 assertions,
independently reviewed/rerun. No event history, app data or external sink used.

Inspected public barrel, sink, config types, store, plugin, and app factory wiring.
Tests present include `src/observability/plugin.test.ts`,
`memory-event-store.test.ts`, `app-observability-isolation.integration.test.ts`,
and event-specific observability tests. No tests were run during the original
inventory; later focused corrections are recorded above. Current
`docs/observability.md` is research only.

Source entry points:
[`src/observability/index.ts`](../../../../src/observability/index.ts),
[`src/observability/sink.ts`](../../../../src/observability/sink.ts),
[`src/observability/plugin.ts`](../../../../src/observability/plugin.ts).

## Findings

### Independent Source Review Supplement

sink.ts preserves configured console/store and appends config.sink; console:false and store:false give custom-only composition. setPlatformSink is a distinct ambient replacement API. Redaction is shallow sensitive-key filtering, not universal nested PII removal; custom messages/raw errors/metadata remain caller/sink responsibilities. Baseline ingest trusted Content-Length. The authorized working-tree correction now counts cloned-stream bytes before Elysia's media parser, validates positive safe-integer limits and cancels oversized streams. That bounds accepted/pre-parsed body bytes, not allocation of a host-delivered transport chunk. The focused synthetic plugin/limit suite passed 17 tests on Bun 1.3.14 with automatic env-file loading disabled.

This targeted independent source review is complete for this inventory. It keeps the pinned main baseline distinct from authorized working-tree fixes; it does not complete whole-platform or exact-package gates.

- Older docs/source comments may imply global sink semantics; managed app-local
  isolation must be distinguished from standalone compatibility APIs.
- Endpoint enablement/access and trace data boundaries need precise config and
  route verification.
- Documentation review does not establish release status.

## Known Future Plans

The [roadmap](../../../backend/observability/roadmap.md) now records the user's
optional Fabric logs/errors/metrics, viewers and build/source-map product ideas
without describing them as current MemoryEventStore behavior.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned home:
`docs-next/backend/observability/index.md`, configuration/roadmap, event/sink,
store and endpoint guides; frontend surface in `docs-next/frontend/`. Link all
system guides to codes, redaction, and operational handling where relevant.

## Completion Review

- [x] Targeted independent source/default/public-boundary review completed; no whole-platform or package qualification inferred.

- [ ] Verify event schema, code stability, safe fields, retention and query bounds.
- [ ] Trace per-app isolation and endpoint authorization across modes.
- [ ] Whole-platform independent review completed.
