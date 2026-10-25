---
id: zero.logging
type: index
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: integrated-logging-preview
maturity: preview
applies_to: ["2.6.0 main builds containing the opt-in logging preview"]
modes: [managed-server, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7f1383a7ea7483abab04d57aebbde8b0f9fe2d8d"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: implementation-verified
---

# Core Logging

[Backend index](../index.md) · [Documentation index](../../index.md)

Core logging is an optional managed Zero subsystem with dedicated Fabric audit
and diagnostic databases, durable source capture, Guardian-scoped APIs,
authenticated SSE, browser observations and a reusable investigation workspace.
The implementation is available as an opt-in preview in main's saved update
package. Existing apps keep logging disabled until configured; updating Zero
does not silently enable collection. The strict compliance preset is still gated;
see the explicit coverage and qualification requirements below.

- [Configuration](./configuration.md): presets, permissions, metadata, retention,
  queue defaults, path isolation and actor launch.
- [Events and coverage](./events-and-coverage.md): evidence semantics, automatic
  source capture and explicit instrumentation gaps.
- [Server and client APIs](./api.md): actor-bound capture, queries, streaming,
  health and protected result release.
- [Browser activity](./browser.md): views/copy/print, bounded collection,
  blocked delivery and required strict-profile enforcement.
- [Delivery and lifecycle](./delivery.md): commit receipts, batching, restart
  identity, source outboxes and shutdown ownership.
- [Evidence lifecycle](./evidence.md): retention, legal holds, separate reviews,
  retained replay proofs, verification and bounded export.
- [Operations and adoption](./operations.md): health, Doctor, recovery, branch
  upgrade procedure and qualification.
- [Roadmap](./roadmap.md): remaining full-compliance and deployment gates.
- [Logging workspace](../../frontend/components/logging.md): self-wired shared
  DataTable, filters, evidence dialogs and activity hooks.

The two streams have independent physical files and writer queues: `operational`
for diagnostics and `audit` for structured activity evidence. Their SQLite work
runs in Fabric subprocesses, outside the application database and Guardian's
authority lease. A separate supervised delivery subprocess owns batching,
source scheduling and retries. Bounded investigation reads use the log plane's
read-only WAL workers. This does not change SQLite's per-file write serialization.

Existing Guardian audit and observability APIs remain intact. The broader log
plane mirrors newly appended Guardian events rather than deleting or replacing
the old trail. Automatic ReactiveDB record capture covers the pinned application
database and managed tenant/named Fabric writers; complete service-stage
instrumentation remains an explicit gate. A selected preset is not proof of complete coverage,
independent evidence custody, uncompromised browser behavior or legal compliance.

## Related Guides And Next Steps

- [Observability](../observability/index.md) owns event emission and existing
  sink/endpoint compatibility. Its best-effort diagnostics are not mutation audit.
- [Guardian audit](../guardian/audit.md) documents the security audit that remains
  unchanged during this development.
- [Complete implementation plan](../../_work/logging-system-plan.md) defines the
  intended full subsystem; [branch verification](../../_work/logging-foundation-review.md)
  records implemented milestones and remaining release gates.
