---
id: zero.rooms.configuration
type: reference
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
feature: composition-defaults
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

# Room Configuration And Composition

[Rooms index](./index.md) · [Documentation index](../../index.md)

There is no AppConfig.rooms or room-specific env/Doctor subtree. Managed apps
mount rooms when Guardian is enabled and use separate systemDB for rooms/
room_members. Auth-disabled managed apps do not mount the plugin.

## Defaults

Room type default, capacity100, creator role owner. IDs and timestamps are
generated server-side. Metadata is JSON text in SQL but an object in the raw
CreateRoomParams service contract; HTTP uses a JSON-object string.
Capacity is a positive safe integer in the corrected development source.

Presence TTL30seconds and browser heartbeat10seconds are fixed defaults in
the current helper, not exposed RoomPluginConfig fields. Typing/presence-list
UI options belong to their individual hooks. No automatic durable room cleanup
or room expiry is configured.

## Trusted Plugin Boundary

`createRoomPlugin({ db, ... })` on `@zero/framework/rooms` accepts
the required ReactiveDB plus optional app runtime, token getter,
authorization dependency getters and onServiceCreated. Its named auth
middleware dependency is intentional. It defines system tables/indexes,
registers the app-local service and removes that exact registration at stop.

`getRoomService()` is a legacy unambiguous compatibility getter, not
selection by whichever app most recently started. Prefer managed request/
setup services. Room lifecycle events use ROOMS_STARTED/STOPPED through
standard observability; service membership is distinct from those events.

## Verification And Related Guides

Inspect auth enablement, actual system table location, app-local service and
scope wiring in a synthetic fixture. Never infer a tenant selector from a
public room_id or copy room tables into every Fabric database.

- [Service](./service.md) owns records/capacity/member lifecycle.
- [Presence](./presence.md) owns ephemeral TTL.
- [Frontend configuration](../../frontend/rooms/configuration.md) owns hook placement.
