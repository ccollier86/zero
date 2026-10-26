---
id: zero.logging
type: index
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: integrated-logging-preview
maturity: supported
applies_to: ["2.6.0 builds with managed compliance logging and native live audit tables"]
modes: [managed-server, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "74264b034eba6c32975cc7822a21da18e682f41f"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: implementation-verified
---

# Core Logging

[Backend index](../index.md) · [Documentation index](../../index.md)

Core logging is an optional managed Zero subsystem with dedicated Fabric audit
and diagnostic databases, durable source capture, Guardian-scoped APIs,
authenticated SSE, browser observations and a reusable investigation workspace.
Existing apps keep logging disabled until configured; updating Zero does not
silently enable collection. Managed logging includes the strict compliance
preset with real admission, source-durability, signing and private-export checks.
Use the exact qualified archive identified by the release handoff and
`zero-release --status`, not the unchanged version number; older preview
archives do not contain these controls.

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
- [Roadmap](./roadmap.md): optional UI improvements, stronger deployment custody,
  deferred backups and additional qualification targets.
- [Logging workspace](../../frontend/components/logging.md): self-wired shared
  DataTable, filters, evidence dialogs and activity hooks.

The two streams have independent physical files and writer queues: `operational`
for diagnostics and `audit` for structured activity evidence. Their SQLite work
runs in Fabric subprocesses, outside the application database and Guardian's
authority lease. A separate supervised delivery subprocess owns batching,
source scheduling and retries. Bounded investigation reads use the log plane's
read-only WAL workers. Strict local custody adds a third private Fabric database
for signed checkpoints, not another event stream. This does not change SQLite's
per-file write serialization or remove shared CPU/disk costs.

Existing Guardian audit and observability APIs remain intact. The broader log
plane mirrors newly appended Guardian events rather than deleting or replacing
the old trail. Automatic ReactiveDB record capture covers the pinned application
database and managed tenant/named Fabric writers. Managed AI/email and strict HTTP
stages are explicit in the coverage matrix; app semantics still require declared
instrumentation. A selected preset is not proof of complete coverage,
independent evidence custody, uncompromised browser behavior or legal compliance.

## Related Guides And Next Steps

- [Observability](../observability/index.md) owns event emission and existing
  sink/endpoint compatibility. Its best-effort diagnostics are not mutation audit.
- [Guardian audit](../guardian/audit.md) documents the security audit that remains
  unchanged during this development.
- [Complete implementation plan](../../_work/logging-system-plan.md) defines the
  intended full subsystem; [branch verification](../../_work/logging-foundation-review.md)
  records the earlier preview. The [strict qualification record](../../_work/logging-compliance-qualification.md)
  separates current checks from final package selection and app acceptance.
