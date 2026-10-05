---
id: zero.rooms
type: index
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
feature: overview
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

# Rooms And Collaboration Presence

[Backend index](../index.md) · [Documentation index](../../index.md)

Rooms provide durable scoped membership and ephemeral collaboration state.
A room is neither a tenant nor a workflow; its creator/member authority is
checked independently. Managed rooms/members live in the system database,
while presence/typing are non-durable ephemeral Sync entries.

- [Service](./service.md): records, owner lifecycle and explicit member admission.
- [Authorization and HTTP](./authorization.md): scoped reads/deletion and closed self-join.
- [Presence](./presence.md): short-lived server presence primitives and topic policy.
- [Configuration](./configuration.md): exact defaults and plugin composition.
- [Frontend hooks](../../frontend/rooms/index.md): live room data, presence and typing.
- [Roadmap](./roadmap.md): future Comms direction, not a shipped chat platform.

The public server package is `@zero/framework/rooms`. Use normal request
`zero.rooms` for actor-bound operations; raw RoomService/PresenceService
are trusted composition primitives and do not authenticate an ID.

The source architecture separates durable membership from high-frequency
ephemeral UI activity. Room presence is not proof of current authority, an
audit trail, a durable chat message or an exact online-state SLA.
