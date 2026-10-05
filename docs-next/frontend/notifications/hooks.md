---
id: zero.frontend.notifications.hooks
type: reference
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: state-and-provider
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

# Notification State, Arrival Hooks And Provider

[Notifications frontend index](./index.md) · [Documentation index](../../index.md)

Import hooks/NotificationProvider from `@zero/framework/react`; hooks also
have `@zero/framework/react/hooks` exports. The configured ClientProvider
and managed notification collections are prerequisites.

## Current-User State

`useNotifications()` returns `notifications` (newest first),
`unreadCount`, `unseenCount` and five **void** actions:
`markSeen(id)`, `markRead(id)`, `dismiss(id)`,
`markAllRead()`, `markAllSeen()`. Rows enrich canonical fields with
`seen/read/dismissed` booleans and nullable `receipt`; dismissed items
are excluded. `useUnreadCount()` returns the count alone.

No completed/ready authorization scope means an empty presentation, not
permission to subscribe under a guessed user. Receipt actions use the shared
authenticated HTTP SDK. Current failures emit
FRONTEND_NOTIFICATION_RECEIPT_FAILED; stale-scope failures are retired.
The hook does not expose a pending/error promise per receipt action.

Role-target rows have already passed the server's live audience filter.
Browser global-role matching would incorrectly hide additive tenant roles.

## Arrival Callbacks And Toasts

`useOnNewNotification(callback)` pre-seeds IDs present at each committed
scope initialization and invokes the callback for later new IDs, not all
records every render. IDs are retired on identity/tenant/authority boundary
change. It does not promise distributed exactly-once delivery or replay an
offline history as new toast events.

`NotificationProvider` takes children, `autoToast` (true),
`toastDuration` (5000 ms) and optional `renderToast(notification)`.
Returning null suppresses that custom toast. Render the application's Toaster
normally; provider state is not a second canonical notification store.
`useNotificationContext()` returns the same hook result and throws outside
NotificationProvider.

## Verification And Related Guides

Test initial baseline/new IDs, receipt convergence, logout/tenant switch,
retired callbacks and denied server requests. A void action callback completing
does not prove persistence; await SDK HTTP directly where acceptance is needed.

- [Components](./components.md) maps record fields to visual items.
- [Backend receipts](../../backend/notifications/receipts.md) owns transitions.
- [Runtime scope](../runtime/scope-transitions.md) owns data retirement.
