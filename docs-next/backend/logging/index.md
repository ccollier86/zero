---
id: zero.logging
type: index
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: managed-storage-preview
maturity: preview
applies_to: ["Unreleased feature/core-logging source only"]
modes: [managed-server, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "cc3b54383fc11497dda0b5c3a6cc04c09a936c8e"
  snapshot: dirty
  date: "2026-10-24"
  evidence_level: source-observed
---

# Core Logging Preview

[Backend index](../index.md) · [Documentation index](../../index.md)

Core logging adds optional dedicated Fabric storage to the existing observability
boundary. The current branch preview manages private log workers, retains minimal
backend diagnostics, and preserves the existing console/custom sinks and recent
event endpoint. It is not yet a complete user-activity or compliance system.
Main and saved upgrade packages do not include this preview.

- [Configuration](./configuration.md): opt-in storage, policy and queue defaults,
  path isolation, actor launch and unavailable compliance settings.
- [Delivery and lifecycle](./delivery.md): commit receipts, batching, restart
  identity, shutdown, diagnostics and current capture limitations.
- [Roadmap](./roadmap.md): durable audit capture, browser activity, scoped APIs,
  investigation UI and compliance controls.

The two streams have independent physical files and writer queues: `operational`
for diagnostics and `audit` for structured activity evidence. Their SQLite work
runs in Fabric subprocesses, outside the application database and Guardian's
authority lease. This does not change SQLite's per-file write serialization.

Only backend diagnostic capture is automatically attached in this milestone.
Structured private audit storage is tested, but existing Guardian audit remains
authoritative; no user-facing `zero.logging` or `client.logging` facade, browser
collector or investigation UI is available yet. Do not expose the private store
or its trusted `platform` scope from application HTTP handlers.

## Related Guides And Next Steps

- [Observability](../observability/index.md) owns event emission and existing
  sink/endpoint compatibility. Its best-effort diagnostics are not mutation audit.
- [Guardian audit](../guardian/audit.md) documents the security audit that remains
  unchanged during this development.
- [Complete implementation plan](../../_work/logging-system-plan.md) defines the
  intended full subsystem; [branch verification](../../_work/logging-foundation-review.md)
  records implemented milestones and remaining release gates.
