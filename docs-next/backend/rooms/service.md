---
id: zero.rooms.service
type: reference
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
feature: durable-room-lifecycle
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

# Room Service, Ownership And Membership

[Rooms index](./index.md) · [Documentation index](../../index.md)

The scoped request service binds the current actor/organization and checks
live authority. `create(params)` requires name and accepts optional type,
metadata object and maxMembers. It synchronously creates the room plus its
creator's owner membership in one ReactiveDB transaction.

Defaults are type default and maxMembers100. The current development correction
requires a **positive safe integer** capacity, including the required creator;
invalid direct service input throws RoomInputError with
ROOM_INPUT_INVALID/400 before persistence. The HTTP DTO rejects it with422.

## Records And Reads

RoomRecord contains room_id, nullable tenant_id, name/type/created_by,
JSON-text-or-null metadata, max_members and created_at. RoomMemberRecord has
member_id/tenant_id/room_id/user_id, role owner/admin/member, joined_at and
nullable JSON metadata. These room roles are not Guardian tenant/app roles.

Scoped methods: `getRoom(id)`, `getMembers(id)`,
`getMember(id, userId)`, `getRoomsForUser()`,
`isMember(id, userId)`, `leave(id)`, `delete(id)`.
Membership read helpers require the actor to be able to read the room.
getRoom returns null only for not-found; stale authority errors are not
converted into empty data.

Leaving removes only the current actor's membership. Creator/owner cannot
orphan the room: RoomOwnerCannotLeaveError maps to
ROOM_OWNER_CANNOT_LEAVE/409. Deletion removes room and all memberships in
one tracked transaction; see [authorization](./authorization.md).

## Explicit Member Admission

The raw trusted RoomService exposes `join(roomId, userId, role?, scope?)`.
It returns an existing membership idempotently, or admits an explicitly
selected member after the capacity check. It does **not** authenticate that
user or implement your application's invitation/approval policy.

Normal `zero.rooms` deliberately excludes raw join. The built-in HTTP
join confirms an existing membership only; guessing an ID cannot self-admit.
An app-owned trusted admission integration must authorize scope, target user
and role before using the raw composition service. Do not fabricate a browser
session to access that primitive.

## Verification And Related Guides

Test owner creation, capacity1, invalid capacity, explicit member admission,
idempotent existing join, owner leave rejection and tracked cascade deletion.
Use synthetic in-memory system tables, not a live collaboration workspace.

- [Authorization](./authorization.md) supplies exact HTTP and policy behavior.
- [Configuration](./configuration.md) owns storage/lifecycle defaults.
- [Frontend hooks](../../frontend/rooms/hooks.md) presents accepted data.
