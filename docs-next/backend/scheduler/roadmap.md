---
id: zero.scheduler.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source plus reviewed uncommitted Scheduler corrections"]
modes: ["managed Bun server", "standalone Elysia plugin/service"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Scheduler Roadmap

[Scheduler](./index.md) · [Backend systems](../index.md) · [Documentation index](../../index.md)

No approved Scheduler expansion appears in the inspected product roadmap.
The current system is an app-local named cron registry, not an incomplete
distributed queue. Torrent already supplies a separate durable workflow
execution/recovery system.

## Explicitly Unapproved Ideas

The following are discussion candidates, not scheduled work or supported APIs:

- [ ] Persisted or tenant-owned schedule definitions with explicit actor authority.
- [ ] Multi-process lease ownership and failover scheduling.
- [ ] A reusable admin schedule/status UI if product demand warrants it.
- [ ] Broader timezone/calendar/runtime qualification fixtures.

Any proposal needs its own authority, storage, lifecycle, retry/idempotency and
operational contract. Do not implement database schedule tables or claim a
cluster-wide timer merely because this roadmap mentions an idea.

## Existing Boundaries To Preserve

Jobs remain app-owned code. Callback effects need live domain authority.
Explicit caught/uncaught policy, per-job overlap and deterministic cleanup should
remain predictable. In-memory status is not an audit ledger or recovery source.

## Related Guides And Next Steps

[Jobs](./jobs.md) and [lifecycle](./lifecycle.md) describe current behavior.
[Operations](./operations.md) distinguishes tested corrections and future work;
return to [Scheduler](./index.md) for the complete implemented surface.
