---
id: zero.notifications.routes
type: reference
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: http-contract
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

# Notification HTTP Routes

[Notifications index](./index.md) · [Documentation index](../../index.md)

Managed Guardian apps mount the named Elysia notification plugin at
`/notifications`. Every route requires authentication and derives its
application/active-tenant data scope. Management and audience checks are
separate; see [authorization](./authorization.md).

| Method/path | Result / requirement |
| --- | --- |
| GET `/` | `{ notifications }` with actor-visible notices and receipts. |
| GET `/unread-count` | `{ count }` for this recipient. |
| GET `/:id` | `{ notification }`; targeted recipient only. |
| POST `/` | `{ notification }`; scope manager, full targeting fields. |
| POST `/broadcast` | `{ notification }`; scope manager, all recipients in scope. |
| POST `/notify/:userId` | `{ notification }`; scope manager, exact user target. |
| POST `/notify-role/:role` | `{ notification }`; scope manager, effective role target. |
| POST `/:id/seen`, `/:id/read`, `/:id/dismiss` | `{ ok: true }`; targeted actor only. |
| POST `/read-all`, `/seen-all` | `{ ok: true }`; actor-visible notices only. |
| GET `/:id/receipts` | `{ receipts }`; scope manager and existing notice. |
| DELETE `/:id` | `{ ok: true }`; scope manager and existing notice. |

## Full Create Body

The full create body requires nonempty `title`, with optional string body/
actionUrl, type/priority enums, numeric `expiresAt`, targetType enum and
`targetValue`. Metadata is a **JSON-encoded object string**, not an object
on this HTTP route. For targetType users, targetValue is a JSON-encoded
nonempty array of nonblank string IDs. User/role targets require targetValue.
Omitted targetType means all. Shortcut bodies accept title/body/type/priority,
not the full metadata/expiry/target options.

Authenticated SDK example; pass the existing configured Client whose actor
has the required management permission:

```ts
import type { Client } from '@zero/framework/react';

export async function SendReportNotice(client: Client) {
  return client.fetch('/notifications', {
    method: 'POST',
    body: {
      title: 'Report ready',
      type: 'success',
      priority: 'normal',
      targetType: 'users',
      targetValue: JSON.stringify(['synthetic-user-id']),
      metadata: JSON.stringify({ category: 'reports' }),
    },
  });
}
```

Never attach a parallel token store/header workaround; the SDK owns restoration,
refresh and scope fences.

## Input And Failure Behavior

The current development correction rejects malformed metadata/user JSON or
wrong JSON shapes with safe `BAD_REQUEST`/400, without storing a notice or
reflecting parser/source text. Invalid type/priority/target enums fail Elysia
validation/422 on full and shortcut routes. Valid existing wire shapes remain
unchanged.

Unauthenticated is 401; scope management denial is 403; non-target/missing
item reads and receipt actions return NOT_FOUND/404 to avoid existence leaks.
Expected AuthError messages follow Guardian's safe response policy.

## Verification And Related Guides

The focused memory-only Elysia/Bun route and advanced-role tests passed 12
tests/69 assertions after the correction; no released-artifact qualification is
implied. Cover equivalent scoped server operations as well as raw HTTP.

- [Service](./service.md) owns records/defaults.
- [Receipts](./receipts.md) owns idempotent transitions.
- [Frontend SDK HTTP](../../frontend/sdk/http.md) owns authenticated transport.
