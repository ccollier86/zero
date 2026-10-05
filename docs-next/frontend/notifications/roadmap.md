---
id: zero.frontend.notifications.roadmap
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

# Notification Frontend Roadmap

[Notifications frontend index](./index.md) · [Documentation index](../../index.md)

Broader chat/Comms and delivery administration are product ideas. Existing
notification visuals are reusable presentation, not a chat transcript,
external push permission UI or audio/video calling implementation.

- [ ] Evaluate richer notice preferences/channel administration if backend policy is added.
- [ ] Reuse current UI/design-token primitives for future Comms controls.
- [ ] Preserve scope retirement and clear accepted-write state in future async action contracts.

[Backend roadmap](../../backend/notifications/roadmap.md) owns subsystem
direction. No schedule or promised component/API is introduced here.
