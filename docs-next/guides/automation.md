---
id: zero.guides.automation
type: architecture
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: automation
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [single, multi, simple-RBAC, advanced-RBAC, single-topology, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Choose The Right Background Execution System

[Guides index](./index.md) · [Documentation index](../index.md)

Several Zero features can perform server work. Choose by trigger, durability,
authority and failure contract—not because all of them accept callbacks.

| Need | Use |
| --- | --- |
| Process-local cron/immediate job | Scheduler |
| Tracked synchronous same-database transformation | Database functions/triggers |
| Durable post-commit effect from a tracked change | Database automation action |
| Durable multi-step/retry/wait/branch execution | Torrent |
| AI provider operations or bounded tool execution | AI/agent layer, with Torrent when durable resume is needed |

## Database Changes And External Effects

A tracked transaction can roll back local changes. An email/provider call
already sent cannot be rolled back with SQLite. Use durable post-commit action
receipts/idempotency for external effects, not an ordinary synchronous listener
that claims delivery durability.

Raw SQL is a privileged escape hatch and may not publish ReactiveDB changes.
Do not assume a hand-written query participates in automation merely because
it modifies the same file.

## Durable Workflows

Torrent persists versioned definitions/runs/steps/events and per-run memory.
Functions remain registered local activities; database definitions reference
those admitted capabilities rather than executing arbitrary uploaded source.

A wait can connect to an app-owned email/text/UI question channel. Correlate
responses to the intended run/invocation and admitted interaction, not a broad
event that wakes every waiting workflow. Bound parallel/array execution and
retain each activity's exact error/retry policy.

For a complete matched composition, follow
[correlated workflow replies](./correlated-workflow.md). It connects registered
activities and a `reply` wait to a private tenant record, verified provider
reply and receipt-backed durable database trigger; it does not assume a
cross-database transaction or broadcast replies to all waiting runs.

## Live Authority

Background code needs current actor/system authority appropriate to the action.
An identity anchor, old bearer string or app-global service handle does not
grant live tenant permission. Trusted machine projections require their
mandatory async/synchronous fences.

See [Scheduler](../backend/scheduler/index.md),
[database automations](../backend/database-automations/index.md),
[Torrent](../backend/torrent/index.md), [AI](../backend/ai/index.md),
[service boundaries](../concepts/service-boundaries.md) and [verification](./verification.md).
