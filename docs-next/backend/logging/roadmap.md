---
id: zero.logging.roadmap
type: roadmap
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: integrated-logging-roadmap
maturity: planned
applies_to: ["2.6.0 builds with managed compliance logging and native live audit tables"]
modes: [managed-server, browser, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "74264b034eba6c32975cc7822a21da18e682f41f"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: implementation-verified
---

# Logging Roadmap

[Logging index](./index.md) · [Backend index](../index.md)

The managed completion release implements strict expiring admission, source-durability
preflight, local signed checkpoint custody/rotation, private durable export
jobs and composite-key history pagination. Managed AI/email stages and strict
HTTP release evidence supplement existing Guardian and ReactiveDB capture.
The [coverage matrix](./events-and-coverage.md) is the current contract; the
older [implementation plan](../../_work/logging-system-plan.md) is historical
planning, not proof that every proposed integration exists.

Ordinary app upgrades must use the exact qualified committed main package.
The [qualification record](../../_work/logging-compliance-qualification.md)
tracks package checks separately from application acceptance.

## Follow-ups, Not Hidden Preset Requirements

1. The agreed minimal investigation UI is native DataTable, server filters,
   live batched arrivals and individual-user history. Advanced/saved nested
   Filters and richer hold/review management remain optional future UI work;
   no decorative controls should pretend to execute.
2. Expand automatic service-specific semantic evidence where a reliable owner
   exists. Raw SQL and clinical reads remain explicitly instrumented by the app;
   a generic record mutation must never be relabeled successful file delivery,
   payment settlement, AI acceptance or human attention.
3. Qualify additional deployment targets, sustained representative workloads
   and explicitly supported upgrades from older compiled-preview logging
   ledgers. Never bypass migration/fingerprint checks to widen the claim.
4. Add encrypted nightly backups and importable older-log packages only after
   their separate design review. They are deferred, not implemented by local
   custody. Retention remains explicit; this release adds no automatic archive
   or new deletion schedule.
5. Deploy the optional independent custodian where off-host trust or separate
   failure-domain requirements call for it. Built-in local custody is
   self-contained but cannot detect simultaneous rollback of all local trusted
   state. An HTTP adapter is not a claim about a destination's actual immutability.

Selecting compliance is not legal certification. Preserve Guardian security
audit and current observability behavior. Optional lower presets do not acquire
strict browser gates; browser observations never prove every real-world action.

The branch's [Torrent enqueue API](../torrent/enqueue.md) addresses a separate
scheduling concern: a short durable handoff need not spend an entire per-database
automation lane waiting on AI inference. Logging capture must not introduce the
same wait inside a database transaction or auth lease.

## Related Guides And Next Steps

- [Branch review](../../_work/logging-foundation-review.md) records tested
  earlier preview checks. The [strict qualification record](../../_work/logging-compliance-qualification.md)
  owns the current completion evidence and distribution gates.
- [Observability roadmap](../observability/roadmap.md) covers existing sink/viewer
  compatibility and future error/metric integration.
