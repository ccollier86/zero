---
id: zero.frontend.rooms.presence
type: reference
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
feature: presence-and-typing
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

# Presence Lists And Typing Indicators

[Rooms frontend index](./index.md) · [Documentation index](../../index.md)

These hooks use the existing ephemeral client, not a SQL table or message bus.
Default presence/typing topics use room IDs and managed live membership policy.

## usePresence

`usePresence(roomId, myData?)` returns `members` and
`update(data): void`. Member fields are userId/status/lastSeen/custom.
The helper publishes online/lastSeen/custom, heartbeats every10seconds and
uses30second TTL. Update publishes the supplied custom object for the current
actor; it is not a partial durable profile update.

The effect/timer/callbacks stop publishing when captured authority is retired.
Unmount removes the local key only while its exact scope remains current,
avoiding a stale cleanup touching a new realm. The hook does not expose a
durable acceptance receipt for an ephemeral update.

## usePresenceList

`usePresenceList(roomId, options?)` returns UI-ready `members`,
`onlineCount` and update. Options are includeSelf(false), staleMs(30000),
data, labelForMember. Results add label/isCurrentUser, filter stale entries and
sort by label. UI age updates every5seconds. Default label chooses custom
name/label/username before ID; labels are presentation, not verified identity.

## useTypingIndicator

`useTypingIndicator(scope, options?)` returns topic/key/isTyping/
isAnyoneTyping/typingUsers plus void markTyping/setTyping/clearTyping.
Default topic is typing:<scope> and scope means a real room ID.

Options: topic, userId, label, ttlMs(5000), idleMs(3500),
throttleMs(750), includeSelf(false), metadata of JsonValue fields.
Typing member contains userId/label/since/updatedAt/metadata.
Idle input clears local publication, stale rows expire, and outgoing updates
are throttled. Timings are UI/ephemeral heuristics, not security deadlines.

A custom non-room topic requires explicit app topic authorization; changing
topic/userId props cannot grant access or impersonation rights server-side.

## Verification And Related Guides

Test synthetic TTL/heartbeat/idle/throttle, sudden disconnect, unmount,
authority transition and nonmember topic rejection. Do not log custom presence
metadata or use typing state as proof that a workflow should resume.

- [Backend presence](../../backend/rooms/presence.md) owns server conventions.
- [Configuration](./configuration.md) owns placement/custom-topic boundaries.
- [Reactivity](../../concepts/reactivity.md) distinguishes ephemeral and durable state.
