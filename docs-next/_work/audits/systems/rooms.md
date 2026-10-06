---
id: zero.inventory.rooms
type: inventory
audience: [maintainer, agent]
owner: rooms
status: draft
visibility: internal
system: rooms
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed server app", "React client", "realtime sync"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Rooms System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Rooms provides scoped room membership/presence, typing state, and client-facing
hooks. Inspected source baseline: Zero package metadata 2.1.1,
`a3a5f726768dac890f241a3899c0a1acb66265d9`; documentation-only `HEAD` is
`cd643b5b862f83b4ab40320486e1b89df1154c87`. Not a release qualification.

## Purpose And Terminology

A room is a collaboration scope with persisted/platform-managed identity and
short-lived presence or typing activity. Do not equate a room with a workflow,
notification, or tenant; access is actor- and scope-bound.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Canonical draft guide | Review |
| --- | --- | --- | --- | --- | --- |
| Room lifecycle and persisted membership | Supported; auth-enabled app | `RoomService.create/join/leave/getRoom/getMembers/getMember/getRoomsForUser/isMember/delete`; `/rooms` routes | `room-service.ts`, `room.plugin.test.ts` | [service](../../../backend/rooms/service.md) | Source observed |
| HTTP access/admission | Supported; Guardian-derived application or tenant scope required | GET list/get/members; POST create/join/leave; DELETE room; `rooms:manage` scope permission | route/service plus builtin service authority tests | [authorization](../../../backend/rooms/authorization.md) | Source observed |
| Reactive room/member data | Supported; client sync | `ROOM_TABLES`; hooks `useRoom`, `useRoomMembers`, `useRooms`, `useRoomData` | types, frontend SDK table map, room hooks | [hooks](../../../frontend/rooms/hooks.md) | Source observed |
| Room-scoped presence | Supported; ephemeral sync | `PresenceService.setPresence/removePresence/removeAllPresence/getPresence` | `presence-service.ts`, ephemeral manager integration | [presence](../../../backend/rooms/presence.md) | Source observed |
| Presence client state | Supported; React client | `usePresence`; `useTypingIndicator` state/update surfaces | frontend room/presence/typing hooks and tests | [presence](../../../frontend/rooms/presence.md) | Source observed |

## Public Surface Map

Package export: `@zero/framework/rooms` includes service/plugin/getter, scope
permission/access, presence and record/table types. `ROOM_TABLES` is also
re-exported from the server entry and merged into the client SDK tables. Client
hooks are exported separately from frontend client entry. `createApp()` mounts
rooms when Guardian is enabled; the room plugin's options (`db`, runtime, token
getter, authorization dependencies, `onServiceCreated`) are composition inputs,
not feature toggles. No room CLI or dedicated UI component found.

## Integration Map

- Guardian owns actor/tenant authority; `room-access.ts` and server plugin
  enforce owner/manager/member rules. UI state is not authorization.
- Persistent room/membership data and ephemeral presence/typing state have
  different lifetimes and should be documented separately.
- Persistent room membership lives in separate systemDb, service/SQL-owned; ephemeral presence/typing
  is handled by the presence manager and expires via TTL. This does not by
  itself specify client reconnect/fanout timing.
- Observability should identify room operations without exposing private room
  content or unnecessary identity data.

## Configuration Inventory

No `AppConfig.rooms` option/env binding exists in inspected types. Managed app
mounts the plugin when Guardian is enabled. Room defaults are type `default`,
creator membership role `owner`, default `maxMembers` 100, timestamps from wall
clock. `create` accepts name, optional type/metadata/maxMembers; HTTP stores
metadata as a JSON string. Routes are fixed under `/rooms`. Presence status
defaults online, ephemeral TTL is 30 seconds, clients are documented to
heartbeat every 10 seconds; expired presence is removed by ephemeral TTL sweep.
There is no room-specific Doctor config path. `join` over HTTP only confirms an
existing membership; it deliberately does not self-admit a user. Server-owned
admission must authorize and create membership through a trusted RoomService
composition path; the normal scoped service deliberately excludes raw join.

## Evidence And Verification

The [six-page backend manual](../../../backend/rooms/index.md) and
[five-page frontend family](../../../frontend/rooms/index.md) now cover
durable system-plane membership, explicit admission versus closed HTTP self-join,
owner/manager/read separation, presence/typing/custom-topic rules and every
inventoried hook.

### Authorized Input Corrections

Detailed review reproduced malformed metadata returning 500/wrong JSON shapes
persisting (0 passed / 1 failed), and invalid capacity allowing a room whose
required owner exceeded maxMembers (0 passed / 1 failed). Development source
uses a safe JSON-object parser, Elysia positive-safe-integer capacity DTO and
a domain pre-write RoomInputError (ROOM_INPUT_INVALID/400), additively exported
from @zero/framework/rooms. Valid wire input/automatic owner remain intact.
Final room suite passed 11 tests / 81 assertions and was independently
reviewed/rerun. Synthetic ephemeral DB/local listener only; package pending.

Tests present: `src/rooms/room.plugin.test.ts`, server builtin-service authority
integration tests, client room/presence/typing hooks tests where present. No
tests were run during the original inventory; later focused runs are recorded
above. Existing docs are research only.

Source entry points: [`src/rooms/index.ts`](../../../../src/rooms/index.ts),
[`src/rooms/room.plugin.ts`](../../../../src/rooms/room.plugin.ts),
[`src/rooms/presence-service.ts`](../../../../src/rooms/presence-service.ts).

## Findings

### Independent Source Review Supplement

Managed composition passes systemDB into createRoomPlugin. [Hook coverage](../catalogs/frontend-hooks.md) includes useRoomActions/usePresenceList as well as usePresence/useTypingIndicator. PresenceService also exposes static topicFor/keyFor. Source heartbeat is 10s with 30s presence TTL; typing independently defaults ttlMs=5000, idleMs=3500, throttleMs=750. useRooms requires an explicit userId, without broadening server authority.

This targeted independent source review is complete for this inventory. It keeps the pinned main baseline distinct from authorized working-tree fixes; it does not complete whole-platform or exact-package gates.

- Durable membership and ephemeral presence have separate persistence and
  lifecycle boundaries; do not describe presence as durable room data.
- No realtime reconnect, ordering, or broadcast latency guarantee was found in
  the public room contract.
- No release qualification performed.

## Known Future Plans

The [roadmap](../../../backend/rooms/roadmap.md) records the user's future Comms
direction without inventing current room/chat/call APIs.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned home:
`docs-next/backend/rooms/index.md`, configuration/roadmap, service and presence
guides plus relevant frontend hooks/components under `docs-next/frontend/rooms/`.
Link Guardian, realtime sync, notifications, and observability.

## Completion Review

- [x] Targeted independent source/default/public-boundary review completed; no whole-platform or package qualification inferred.

- [x] Map public route/service/hook/component exports and room authority scope.
- [x] Trace presence expiry and managed service lifecycle from source.
- [ ] Run focused package/integration tests and obtain independent review.
- [ ] Whole-platform independent review completed.
