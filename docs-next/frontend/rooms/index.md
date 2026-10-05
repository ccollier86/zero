---
id: zero.frontend.rooms
type: index
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
feature: frontend-overview
maturity: supported
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

# Room, Presence And Typing Hooks

[Frontend index](../index.md) · [Documentation index](../../index.md)

Room hooks consume the configured authenticated Client and its authorized
system/ephemeral projections. They compose collaboration UI without inventing
a second transport, but do not grant room or application-table access.

- [Room hooks/actions](./hooks.md): live room/member data and accepted HTTP mutations.
- [Presence/typing](./presence.md): heartbeat, UI-ready member lists and expiring typing state.
- [Configuration](./configuration.md): provider placement, timings and custom-topic policy.
- [Roadmap](./roadmap.md): prospective chat/Comms UI, not shipped controls.
- [Backend rooms](../../backend/rooms/index.md): canonical owner/member/admission rules.

There is no dedicated packaged room-management/chat component in this source
inventory. Compose existing UI primitives around these hooks; do not fabricate
a public room editor or message API from the directory's name.
