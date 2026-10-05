---
id: zero.observability.configuration
type: reference
audience: [developer, agent, operator]
owner: observability
status: draft
visibility: internal
system: observability
feature: configuration-and-doctor
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

# Observability Configuration

[Observability index](./index.md) · [Documentation index](../../index.md)

createApp accepts observability:false or ObservabilityConfig; omission enables
the default app-local runtime. Values are resolved at composition, not from
browser state or database-backed runtime settings.

| Option | Default / meaning |
| --- | --- |
| enabled | true; false disables runtime emission/store. |
| console | true; console adapter remains when a custom sink is added unless explicitly false. |
| sink | Optional additive PlatformSink. |
| store | Default MemoryEventStore; custom PlatformEventStore or false to omit reads. |
| maxEvents |1000 for default memory store; corrected positive safe integer admission. |
| endpoint | Default object; false disables routes. |
| endpoint.enabled |true. |
| endpoint.basePath |/api/_zero/observability. |
| endpoint.read |admin when auth enabled, development otherwise; built-in/custom modes in endpoints guide. |
| endpoint.frontendIngest |true; false returns404 for POST. |
| endpoint.maxPayloadBytes |32768; positive safe integer, invalid -> OBSERVABILITY_CONFIG_INVALID. |
| trace |False/object; omitted disabled. |
| trace.enabled |false. |
| trace.slowRequestMs / slowLifecycleMs |500 /100 milliseconds. |

There are no dedicated observability env bindings. NODE_ENV is read by the
development read predicate. A custom store determines its own bounds; maxEvents
does not reconfigure an injected store.

Doctor checks disabled production observability, unreachable endpoint policy
for auth mode and enabled reads without a configured readable store. Doctor is
trusted config evaluation, not a no-side-effect static security certificate.

## Standalone Plugin And Runtime

createObservabilityPlugin accepts config/runtime/authEnabled, captures its
selected runtime once and registers the named Elysia error/trace/route surface.
Without an explicit runtime it captures the current ambient compatibility
runtime. That is deliberate standalone composition, not request-time app
discovery.

Custom-only output uses console:false/store:false plus sink. Runtime and
endpoint configuration must agree; disabling endpoint does not automatically
disable managed feature events.

- [Sinks](./sinks.md) owns additive composition/ownership.
- [Endpoints](./endpoints.md) owns exact policies and wire behavior.
- [Tracing](./tracing.md) owns opt-in timing.
