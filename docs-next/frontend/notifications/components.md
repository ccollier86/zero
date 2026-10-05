---
id: zero.frontend.notifications.components
type: reference
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: visual-composition
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

# Notification Visual Components

[Notifications frontend index](./index.md) · [Documentation index](../../index.md)

The packaged controls use Zero's UI/animation primitives. They receive items
and callbacks; they do not fetch, verify authority or write receipts themselves.

## Hook-To-Visual Mapping

```tsx
import { NotificationCenter, useNotifications } from '@zero/framework/react';

export function Notices() {
  const state = useNotifications();
  return <NotificationCenter
    items={state.notifications.map((notice) => ({
      id: notice.notification_id,
      title: notice.title,
      body: notice.body,
      timestamp: notice.created_at,
      read: notice.read,
      actionUrl: notice.action_url,
    }))}
    onOpen={state.markAllSeen}
    onMarkAllRead={state.markAllRead}
    onItemRead={state.markRead}
    onItemDismiss={state.dismiss}
  />;
}
```

This is a client-component fragment within the configured provider.
Add application navigation via onItemClick; the item stores actionUrl but the
visual does not turn an arbitrary value into an authenticated server action.

## Public Props And Defaults

`NotificationListItem` has required id/title/timestamp and optional
type/body/read/actionUrl/avatarUrl/avatarFallback.

| Component | Contract |
| --- | --- |
| NotificationCenter | Required items. Optional onMarkAllRead/onOpen/onClose/onItemClick/onItemRead/onItemDismiss/onSettings, title/footer/custom trigger. Default ghost/icon bell, destructive badge, no pulse/dot, grouped list, end alignment; badgeCount overrides derived unread count. Supports maxHeight/transition/className. |
| NotificationDropdown | Required children trigger and items; same callbacks/title/footer/list options. Defaults title Notifications, width380px, maxHeight400px, grouped true, align end, sideOffset8; optional transition/className. |
| NotificationList | Required items; callbacks, maxHeight400px, grouped true, emptyMessage/emptyIcon, className/itemClassName. Day groups Today/Yesterday/Earlier preserve supplied order within groups. |
| NotificationItem | Required id/title/timestamp; type info by default, body/read/actionUrl/avatar options, onClick/onRead/onDismiss, className/motionProps. Click/read/dismiss remain separate callbacks. |
| NotificationBadge | Optional count/max99/dot/variant/pulse/className/position/children. Hidden at count0/undefined; default destructive and top-right; variants default/destructive/warning/success. |

Center button variants are ghost/outline/secondary; sizes icon/icon-sm/icon-xs.
A custom trigger replaces the bell. The controls do not automatically apply
server expiry, mark all as seen on open or navigate a clicked URL unless the
application supplies those callbacks.

## Verification And Related Guides

Check empty/count/capped badge, narrow popover, keyboard focus, dismiss versus
click, custom trigger and callback wiring in your actual app theme. No browser
interaction qualification is inferred from a source prop inspection.

- [Hooks](./hooks.md) supplies authorized data/receipt callbacks.
- [Backend targeting](../../backend/notifications/authorization.md) owns audience.
- [Configuration](./configuration.md) owns provider composition.
