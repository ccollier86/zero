---
id: zero.frontend.rooms.hooks
type: reference
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
feature: room-state-and-actions
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

# Room Data And Accepted Actions

[Rooms frontend index](./index.md) · [Documentation index](../../index.md)

Import these hooks from `@zero/framework/react/hooks` or the frontend
barrel. The configured ClientProvider and authorized room collections are
prerequisites.

## Reactive Reads

| Hook | Result |
| --- | --- |
| `useRoom(roomId)` | `{ room: RoomRecord | null, members: RoomMemberRecord[] }`. |
| `useRoomMembers(roomId)` | Member rows for that room. |
| `useRooms(userId)` | Rooms among the already-authorized collection matching that user membership. Requires the explicit user ID. |
| `useRoomData<T>(roomId, tableName)` | Already-authorized app rows whose room_id matches, with T extending Row & {room_id:string}. |

useRoomData is a browser filter on available data, **not** server room
authorization for a newly created table. Declare the app Resource/Sync policy.
An arbitrary useRooms user ID cannot fetch otherwise unauthorized membership.

## Mutation Hooks

`useRoomActions()` returns:
`create(name, type?, maxMembers?): Promise<RoomRecord>`,
`join(roomId): Promise<RoomMemberRecord>`,
`leave(roomId): Promise<void>`,
`deleteRoom(roomId): Promise<void>`.

These await the existing Eden/auth transport, unwrap errors and fence results
against the captured current authorization scope. join confirms existing
membership only; it is not an invite or public self-admission operation.
Owner leave can fail ROOM_OWNER_CANNOT_LEAVE; deletion has separate authority.

```tsx
import { useRoom } from '@zero/framework/react/hooks';

export function RoomSummary({ roomId }: { roomId: string }) {
  const { room, members } = useRoom(roomId);
  return <p>
    {room?.name ?? 'Room unavailable'} ({members.length})
  </p>;
}
```

This client-component fragment displays the already-authorized projection.
For mutation UI, await the RoomActions method, keep the action pending until
acceptance, and present a safe rejected result through the standard error/
observability boundary. Do not silently drop the promise or report success
before it accepts.

## Verification And Related Guides

Test initial empty/unavailable projection, accepted mutations, owner denial,
stale callbacks and organization switch. A room collection ID is not permission
to access every related app record.

- [Backend authority](../../backend/rooms/authorization.md) owns exact route behavior.
- [Presence](./presence.md) composes online/typing activity.
- [Runtime boundaries](../runtime/scope-transitions.md) owns retired data.
