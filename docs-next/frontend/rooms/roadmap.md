---
id: zero.frontend.rooms.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
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

# Room Frontend Roadmap

[Rooms frontend index](./index.md) · [Documentation index](../../index.md)

Broader chat/Comms interfaces are product direction. There is no shipped
dedicated room editor/chat/call UI established by this inventory.

- [ ] Evaluate reusable chat/history/participant controls when backend contracts exist.
- [ ] Keep durable messages separate from presence/typing visualization.
- [ ] Reuse the platform's compact action/detail patterns and live permission checks.

[Backend roadmap](../../backend/rooms/roadmap.md) owns subsystem plans;
current [hooks](./hooks.md) and [presence](./presence.md) describe existing APIs.
