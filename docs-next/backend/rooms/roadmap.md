---
id: zero.rooms.roadmap
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

# Rooms Roadmap

[Rooms index](./index.md) · [Documentation index](../../index.md)

The product backlog proposes a Comms platform with user-to-user chat and
possibly audio/video/public widgets. Rooms and ephemeral activity are useful
existing primitives, not those complete features.

- [ ] Design future chat admission/history/delivery separately from ephemeral presence.
- [ ] Reuse Guardian/Fabric authority rather than infer it from room membership UI.
- [ ] Define any future room invitation/role editing APIs explicitly; current self-join remains closed.

No schedule or current API is implied. [Current service](./service.md) and
[frontend hooks](../../frontend/rooms/index.md) remain authoritative.
