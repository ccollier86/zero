---
id: zero.rooms.presence
type: reference
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
feature: ephemeral-room-state
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

# Room Presence And Ephemeral State

[Rooms index](./index.md) · [Documentation index](../../index.md)

Presence is a short-lived signal built on EphemeralStateManager, not SQL.
The server PresenceService is public through `@zero/framework/rooms`;
it receives the owned ephemeral manager at trusted composition time.

## Server Primitives

- `setPresence(roomId, userId, status = 'online', custom?)` writes status/
  wall-clock lastSeen/custom with a30,000ms TTL.
- `removePresence(roomId, userId)` removes that key.
- `removeAllPresence(userId)` removes that actor's entries across presence topics.
- `getPresence(roomId)` returns userId/data entries.
- Static `topicFor(roomId)` / `keyFor(userId)` produce
  presence:<roomId> / user:<userId>.

Status is online/idle/away. These naming helpers are conventions, not
authorization checks. The raw service does not verify membership for arbitrary
IDs. Managed WebSocket topic policy admits the corresponding room/scope and
current actor; custom standalone composition must provide equivalent policy.

## Lifetime And Reliability

Clients normally heartbeat every10seconds. Entries expire without refresh
through the ephemeral TTL sweep. Disconnection cleanup retires subscriptions;
remaining stale values expire rather than becoming permanent SQL records.
No exact presence-removal instant, durable replay or globally ordered message
bus is promised.

Typing uses a separate ephemeral topic and shorter timings documented in
[frontend presence](../../frontend/rooms/presence.md). Do not use typing or
presence for payment/security decisions or permanent workflow progress.

## Verification And Related Guides

Test member/nonmember topic admission, actor-key protection, heartbeat/TTL,
logout/tenant switch and sudden disconnect. Custom payloads may contain user
information; keep them minimal and protect topics, not just UI filtering.

- [Room authority](./authorization.md) owns membership/read scope.
- [Frontend presence](../../frontend/rooms/presence.md) owns hooks/timers/options.
- [Reactivity](../../concepts/reactivity.md) distinguishes persistent and ephemeral delivery.
