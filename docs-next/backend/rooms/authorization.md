---
id: zero.rooms.authorization
type: reference
audience: [developer, agent, operator]
owner: rooms
status: draft
visibility: internal
system: rooms
feature: http-and-scope-authority
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

# Room HTTP And Authority Boundaries

[Rooms index](./index.md) · [Documentation index](../../index.md)

All built-in routes require a Guardian user and derive the current application
or active-tenant scope. System rows are tenant-scoped even with Fabric file
isolation for app data.

| Method/path under /rooms | Meaning |
| --- | --- |
| GET / | `{ rooms }` containing the actor's memberships. |
| POST / | `{ room }`; creates actor-owned room and owner membership. |
| GET /:id | `{ room }`; exact existing member only. |
| GET /:id/members | `{ members }`; exact existing member only. |
| POST /:id/join | `{ member }`; confirms existing membership, never self-admits. |
| POST /:id/leave | `{ ok: true }`; current member only, owner protection applies. |
| DELETE /:id | `{ ok: true }`; creator or scope manager. |

Create requires nonempty name, optional type string, metadata **JSON-object
string**, and positive-safe-integer maxMembers. The development parser rejects
malformed JSON/null/arrays/scalars with safe BAD_REQUEST/400 before room or
owner creation. Valid JSON-object wire input is unchanged.

## Membership Versus Management

`rooms:manage` grants scope room-administration in advanced profiles.
Single/simple compatibility uses platform administration; multi mode requires
live tenant scope authority. Management permits scoped deletion, **not** room
detail/member read for a nonmember. Missing and unauthorized read/delete IDs
share NOT_FOUND/404.

Room creation is available to authenticated actors, not only managers.
Application domain rules may further restrict which routes/actions a product
exposes. No room-specific app permission automatically grants arbitrary user
admission or cross-tenant read.

## Reactive And Ephemeral Policy

Managed Sync only publishes room/member rows authorized by membership and
scope, and protects service-owned tables from client mutation.
Presence/typing topics require corresponding live room membership under
managed topic policy. A room_id field in an app table does not automatically
supply that table's Resource policy.

Normal server facades fence current authority before operations/commit.
Raw service/getter calls remain trusted setup capabilities, not permission
checks; see [runtime services](../runtime/server-services.md).

## Verification And Related Guides

The final focused room HTTP suite in this dirty source passed11tests/81assertions,
including malformed input, capacity, owner lifecycle, nonmember privacy and
manager/read separation. Package/artifact qualification remains pending.

- [Guardian authorization](../guardian/authorization.md) owns live grants.
- [Room service](./service.md) distinguishes raw admission from self-join.
- [Presence](./presence.md) owns ephemeral conventions.
