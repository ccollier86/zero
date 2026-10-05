---
id: zero.observability
type: index
audience: [developer, agent, operator]
owner: observability
status: draft
visibility: internal
system: observability
feature: overview
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

# Observability

[Backend index](../index.md) · [Documentation index](../../index.md)

Observability is Zero's structured operational event boundary: stable codes,
app-local emission, sink composition, bounded recent-event retrieval and
optional lifecycle tracing. It is not durable compliance audit, application
analytics, billing accounting or an already shipped Sentry replacement.

- [Events](./events.md): exact event fields/codes and safe emission.
- [Sinks](./sinks.md): console/store/custom composition and best-effort failure.
- [Store](./store.md): finite retention, filters and recent-tail cursor semantics.
- [HTTP endpoints](./endpoints.md): protected reads and bounded write-only frontend ingest.
- [Tracing](./tracing.md): opt-in Elysia lifecycle timing.
- [Configuration](./configuration.md): defaults, capture and app isolation.
- [Frontend events](../../frontend/observability.md): browser sink and reporting contract.
- [Roadmap](./roadmap.md): durable logs/errors/versioned source maps and dashboards.

Use `@zero/framework/observability` on the server, or request-bound
`zero.observability` in managed code. Console is an adapter, not permission
for reusable modules to use ad-hoc console calls. Generic compatibility globals
do not discover the correct app in a multi-app process.

The inferred design philosophy is one small domain-neutral signal interface,
explicit runtime ownership and replaceable storage/export. System-specific
privacy shaping remains important; generic shallow key redaction does not
sanitize arbitrary nested content.
