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
  commit: "af5554b750affc48645889debf3680bee29c2ef5"
  snapshot: clean
  date: "2026-10-24"
  evidence_level: implementation-verified
---

# Logging Roadmap

[Logging index](./index.md) · [Backend index](../index.md)

The branch now includes managed source capture, Guardian compatibility, scoped
server/client APIs, authenticated SSE, browser observations, a shared DataTable
workspace, bounded exports, holds, reviews and retained integrity/replay proofs.
It does not yet qualify the complete strict compliance profile. Remaining work
follows the [complete plan](../../_work/logging-system-plan.md):

1. Actor-local same-commit capture in independent tenant Fabric databases,
   source discovery/recovery and a complete service-stage coverage matrix.
   Pinned application/Guardian capture must not be relabeled as universal capture.
2. Required browser-delivery admission for the explicit strict compliance
   profile only, across protected UI, SSR/loaders, HTTP,
   machine and Sync paths. Use authenticated acknowledgments with server-side
   expiry, a reachable recovery path and fail-closed protected release. Do not
   identify a specific extension without evidence or confuse outages with blockers.
   Optional browser delivery at basic/activity/detailed levels remains best effort;
   capture-family overrides do not implicitly enable an access gate.
3. Full advanced/saved Filters execution and evidence management UI, replacing
   neither the existing DataTable engine nor mandatory query scope.
4. Durable private-Storage export jobs/download reauthorization, artifact expiry,
   reconciliation and catalog/history pagination beyond the bounded preview.
5. Independently held/signed checkpoints, key rotation, restore/custody procedures,
   and production-like full-disk/SIGKILL/load and compiled actor qualification.

Compliance configuration remains unavailable until the required guarantees are
present. Enabling a preset is not legal certification. Preserve existing
Guardian security audit and current observability behavior throughout the
transition. Browser observation families are explicit configuration choices;
`detailed` enables them and should be reviewed as such. Do not migrate real
records or claim a green compliance badge from database startup alone.

The branch's [Torrent enqueue API](../torrent/enqueue.md) addresses a separate
scheduling concern: a short durable handoff need not spend an entire per-database
automation lane waiting on AI inference. Logging capture must not introduce the
same wait inside a database transaction or auth lease.

## Related Guides And Next Steps

- [Branch review](../../_work/logging-foundation-review.md) records tested
  implementation versus remaining work.
- [Observability roadmap](../observability/roadmap.md) covers existing sink/viewer
  compatibility and future error/metric integration.
