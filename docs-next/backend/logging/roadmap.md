---
id: zero.logging.roadmap
type: roadmap
audience: [developer, agent, operator, maintainer]
owner: observability
status: draft
visibility: internal
system: logging
feature: integrated-logging-roadmap
maturity: planned
applies_to: ["Planned work after the feature/core-logging managed storage preview"]
modes: [managed-server, browser, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "cc3b54383fc11497dda0b5c3a6cc04c09a936c8e"
  snapshot: dirty
  date: "2026-10-24"
  evidence_level: source-observed
---

# Logging Roadmap

[Logging index](./index.md) · [Backend index](../index.md)

The managed storage preview does not complete the logging subsystem. Remaining
work follows the [complete plan](../../_work/logging-system-plan.md):

1. Atomic source capture/outbox delivery and the deliberate Guardian audit
   transition; explicit service coverage and no authority-lease inversion.
2. Authorized server/query/live/export APIs, SDK and client scope retirement.
3. Browser copy/print/view intervals, visibility/idle heartbeats and declared
   actions with user/session/organization/resource attribution. These are
   individually configurable observations, not proof of attention or physical
   printing; clipboard text is excluded by default.
4. Dense shared DataTable/filter investigation, detail/correlation, accurate
   live-arrival indicators, safe permissions and accessible managed surfaces.
5. Retention/holds, evidence review/export, independent integrity/custody,
   configured health/failure policy and production-like package qualification.

Compliance configuration remains unavailable until the required guarantees are
present. Enabling a preset is not legal certification. Preserve existing
Guardian security audit and current observability behavior throughout the
transition. Do not migrate real records or activate browser capture implicitly.

The branch's [Torrent enqueue API](../torrent/enqueue.md) addresses a separate
scheduling concern: a short durable handoff need not spend an entire per-database
automation lane waiting on AI inference. Logging capture must not introduce the
same wait inside a database transaction or auth lease.

## Related Guides And Next Steps

- [Branch review](../../_work/logging-foundation-review.md) records tested
  implementation versus remaining work.
- [Observability roadmap](../observability/roadmap.md) covers existing sink/viewer
  compatibility and future error/metric integration.
