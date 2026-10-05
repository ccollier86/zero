---
id: zero.observability.tracing
type: reference
audience: [developer, agent, operator]
owner: observability
status: draft
visibility: internal
system: observability
feature: elysia-lifecycle-trace
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

# Elysia Lifecycle Trace Events

[Observability index](./index.md) · [Documentation index](../../index.md)

Tracing is opt-in: observability.trace.enabled defaults false.
With it enabled, Elysia lifecycle timing emits app.lifecycle.slow/
app.lifecycle.failed and slow completed-request app.request.slow.

Default slowRequestMs500 and slowLifecycleMs100. Observed lifecycle blocks
are handle/beforeHandle/afterHandle/error. Metadata includes bounded lifecycle
name, elapsed timing, method and sanitized request path; the failure channel may
retain an internal error for the configured sink.

This is not a distributed span implementation, sampling engine or automatic
OpenTelemetry export. Dynamic Elysia aot:false does not support this trace path;
use a supported composition rather than assuming enabling the flag adds
timing to every custom plugin.

General request parse/validation/error reporting also runs through the plugin's
global error hook independently from trace enabled state. Request validation
rejection and response validation failure use distinct events/status meaning.

## Verification And Related Guides

Use synthetic slow/failing lifecycle blocks and confirm owning runtime,
safe request path and thresholds. A source trace hook is not a performance SLA
or proof that business side effects were rolled back.

- [Configuration](./configuration.md) owns enablement.
- [Events](./events.md) owns stable signal/privacy.
- [Runtime plugins](../runtime/plugins.md) owns Elysia lifecycle integration.
