---
id: zero.notifications.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: future-direction
maturity: planned
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [guardian-enabled, single-tenant, multi-tenant]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Notification Roadmap

[Notifications index](./index.md) · [Documentation index](../../index.md)

The product backlog proposes additional SMS/push delivery and broader Comms
interfaces. Persisted notifications, email and room membership are existing
foundations, not an already shipped user-to-user chat/call platform.

- [ ] Evaluate optional external delivery channels with explicit consent, scope and delivery receipts.
- [ ] Consider richer notification administration while preserving recipient privacy.
- [ ] Keep delivery/read state distinct from operational logging and durable security audit.

No priority or implementation schedule is implied. [Current configuration](./configuration.md)
and [frontend controls](../../frontend/notifications/index.md) describe what is
actually present.
