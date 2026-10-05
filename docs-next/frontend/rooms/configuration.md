---
id: zero.frontend.rooms.configuration
type: reference
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
feature: frontend-options
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

# Room Frontend Configuration

[Rooms frontend index](./index.md) · [Documentation index](../../index.md)

Use one configured ClientProvider/AppProvider. Managed Client supplies rooms/
room_members; the backend Guardian-enabled plugin owns tables/policy.
There is no browser room-enable switch or separate RoomProvider.

Room read hooks take explicit IDs. useRooms requires a userId; useRoomData
requires tableName with room_id. These are local selectors over admitted data,
not server grants. useRoomActions follows authenticated Eden plus current
scope result fences.

Presence uses fixed10second heartbeat/30second TTL. PresenceList adds optional
includeSelf/staleMs/data/labelForMember. Typing exposes explicit ttl/idle/
throttle/custom-topic options listed in [presence](./presence.md).
No room-specific Doctor setting or undocumented env binding is implied.

Custom ephemeral topics must have server topic policy, and a custom app table
must have Resource/Sync policy. Do not treat matching room_id columns as
automatic room protection.

- [Backend configuration](../../backend/rooms/configuration.md) owns lifecycle/defaults.
- [Room hooks](./hooks.md) owns accepted action APIs.
- [Presence](./presence.md) owns expiring interaction options.
