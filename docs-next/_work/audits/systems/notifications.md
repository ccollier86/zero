---
id: zero.inventory.notifications
type: inventory
audience: [maintainer, agent]
owner: notifications
status: draft
visibility: internal
system: notifications
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed server app", "React client"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Notifications System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Notifications provides persisted user-facing notices, access checks, delivery
and read receipts, plus client hooks/provider and UI. Source baseline is Zero
2.1.1 at `a3a5f726768dac890f241a3899c0a1acb66265d9`; documentation-only `HEAD`
is `cd643b5b862f83b4ab40320486e1b89df1154c87`. Source observation only.

## Purpose And Terminology

Notifications are application records addressed to Guardian identities or
roles, distinct from email delivery and ephemeral room broadcast. A notification
is durable data; a receipt is recipient-specific acknowledgement state. The
managed app persists both in separate systemDb SQL-backed platform tables; managed system-plane Sync
carries authorized records, while the notification
service owns writes and Guardian-scoped reads.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Canonical draft guide | Review |
| --- | --- | --- | --- | --- | --- |
| Persisted notice and target APIs | Supported; auth-enabled app | `create/broadcast/notify/notifyUsers/notifyRole`, scoped reads/deletes, `deleteExpired` | service, plugin, platform tables | [service](../../../backend/notifications/service.md) | Source observed |
| Receipt operations | Supported; user-scoped | get receipts, mark seen/read/dismiss, mark-all variants | `NotificationService`, plugin/RBAC tests | [receipts](../../../backend/notifications/receipts.md) | Source observed |
| HTTP routes | Supported; mounted with Guardian | `/notifications` list/create, unread count, broadcast, notify user/role, item lookup, seen/read/dismiss, read/seen all, manager receipts/delete | `notification.plugin.ts` and integration tests | [routes](../../../backend/notifications/routes.md) | Source observed |
| Scope authorization | Supported; tenancy and RBAC aware | `notifications:manage`; effective role set from live access, not UI/global role | `notification-access.ts`, service-data authority, advanced RBAC tests | [authorization](../../../backend/notifications/authorization.md) | Source observed |
| Client hooks/provider | Supported; React `ClientProvider` | `useNotifications()` state/counts and receipt actions; authorization scope boundary gates requests | `notification-hooks.ts`, provider, tests | [hooks](../../../frontend/notifications/hooks.md) | Source observed |
| UI components | Supported; React | center, dropdown, list, item, badge | `src/components/ui/notification-*.tsx` | [components](../../../frontend/notifications/components.md) | Source observed |

## Public Surface Map

Backend export `@zero/framework/notifications` includes service/plugin/getter,
notification tables and types, and scope helpers. Client `useNotifications()`
and provider use frontend client exports; center, dropdown, list, item, badge
are component exports. `createApp()` mounts this subsystem when auth is enabled;
there is no independent notifications boolean/config. No dedicated CLI command
was identified.

## Integration Map

- Notification ownership and recipient targeting depend on Guardian identity,
  tenant/role scope, and explicit immutable permissions; broad platform roles
  should not implicitly bypass object ownership.
- Persisted notification/receipt state belongs to systemDb platform tables and must
  be scoped through service authority, not just client filtering.
- Client hooks use the centralized SDK/table map. UI optimistic state is not
  authoritative; service mutations and reads enforce receipt state and scope.
- Errors and noteworthy lifecycle events follow observability contracts; avoid
  logging notification bodies or private recipient data.

## Configuration Inventory

There is no `AppConfig.notifications` option or environment key in inspected
types/composition; disabling Guardian omits the managed notification plugin.
Its plugin's DB/runtime/token/authorization/scheduler/service callback fields
are composition dependencies, not user policy switches. Record defaults:
notification type `info`, priority `normal`, target `all`; record expiration
is optional and per notification; no default expiration/retention TTL is
assigned. When a scheduler is available, the plugin registers hourly expired-
notification cleanup; without the scheduler there is no plugin-owned periodic
cleanup loop. Managed app stores rows/receipts in SQL-backed systemDb platform tables
and ReactiveDB publishes changes.

## Evidence And Verification

The [seven-page backend manual](../../../backend/notifications/index.md) and
[five-page frontend family](../../../frontend/notifications/index.md) now
cover system-plane ownership, live effective-role targeting, recipient versus
manager power, exact routes/JSON wire fields, receipt void callbacks versus
awaited HTTP acceptance, provider/toasts and all five visual components.

### Authorized Input Correction

Detailed review reproduced malformed JSON metadata returning 500 instead of
safe rejection (new regression: 0 passed / 1 failed). Development source now
uses JSON-object/nonempty-user-array parsing plus Elysia type/priority/target
enums. Invalid inputs reject 400/422 before writes; valid JSON-encoded wire
input is retained. Route/advanced-role suite passed 12 tests / 69 assertions
and was independently reviewed/rerun. Fixtures use ephemeral DBs/local
listeners, not app data/providers. Exact package qualification remains pending.

Tests present: `src/notifications/notification.plugin.test.ts`,
`notification-advanced-rbac.integration.test.ts`,
`src/frontend/server/builtin-service-authority.integration.test.ts`, and client
hook/component tests where present. No tests were run during the original
inventory; later authorized checks are recorded above. Existing notification
docs are research only.

Source entry points:
[`src/notifications/index.ts`](../../../../src/notifications/index.ts),
[`src/notifications/notification.plugin.ts`](../../../../src/notifications/notification.plugin.ts),
[`src/frontend/client/notification-hooks.ts`](../../../../src/frontend/client/notification-hooks.ts).

## Findings

### Independent Source Review Supplement

Managed composition passes systemDB into createNotificationPlugin. The [component catalog](../catalogs/frontend-components.md) and [hook catalog](../catalogs/frontend-hooks.md) enumerate NotificationProvider/useNotificationContext, useNotifications/useUnreadCount/useOnNewNotification and all five notification UI components. These are system-plane projections, not Fabric-hosted notification tables.

This targeted independent source review is complete for this inventory. It keeps the pinned main baseline distinct from authorized working-tree fixes; it does not complete whole-platform or exact-package gates.

- Authorization contract spans role targeting and owner scoping; permission
  predicates use live Guardian context and are distinct from list filtering.
- Do not promise ordering or delivery-to-client latency from the table/hooks
  integration alone; no realtime SLA is encoded in this service contract.
- Source observation does not establish release support.

## Known Future Plans

The [roadmap](../../../backend/notifications/roadmap.md) now distinguishes the
user's potential SMS/push/Comms direction from existing persisted notifications.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned homes:
`docs-next/backend/notifications/index.md`, configuration/roadmap/service and
authorization references, with frontend hooks/components in
`docs-next/frontend/notifications/`. Cross-link Guardian, rooms, client SDK,
and observability.

## Completion Review

- [x] Targeted independent source/default/public-boundary review completed; no whole-platform or package qualification inferred.

- [x] Inventory public route/service/type/table/hook/component surfaces from source.
- [x] Trace persistence and authority boundaries in service/plugin composition.
- [ ] Run focused integration/client tests and obtain independent review.
- [ ] Whole-platform independent review completed.
