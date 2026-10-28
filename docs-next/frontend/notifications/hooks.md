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
applies_to: ["2.6.0 messaging development branch; verify the selected archive"]
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

`useOnNewNotification(callback)` consumes accepted live `sync.change` INSERTs
for notifications targeted to the current admitted user. Snapshots, reconnect
catchup, local cache hydration, UPDATEs and receipt changes do not trigger it.
A bounded ID set is retired on identity/tenant/authority boundary change.
It does not promise distributed exactly-once delivery. A notice first learned
through history/catchup remains in the inbox without replaying an interruption.

`NotificationProvider` takes children, `autoToast` (true),
`toastDuration` (5000 ms) and optional `renderToast(notification)`.
Returning null suppresses that custom toast. Render the application's Toaster
normally; provider state is not a second canonical notification store.
`useNotificationContext()` returns the same hook result and throws outside
NotificationProvider.

AppProvider owns one persistent `NotificationFeedbackProvider`. NotificationProvider
uses that owner for toast admission; a custom ClientProvider host gets a silent
fallback owner unless it explicitly wraps its notification/workspace tree in
NotificationFeedbackProvider. Do not mount independent alert owners per row.
The [sound and active-conversation policy](./sounds.md) suppresses native chat
interruptions only, never canonical unread/seen/read state. Raw arrival callbacks
remain data events: custom desktop/toast integrations must apply the same policy
rather than using a raw callback as permission to interrupt the current chat.

## Verification And Related Guides

Test initial baseline/new IDs, receipt convergence, logout/tenant switch,
retired callbacks and denied server requests. A void action callback completing
does not prove persistence; await SDK HTTP directly where acceptance is needed.

- [Components](./components.md) maps record fields to visual items.
- [Backend receipts](../../backend/notifications/receipts.md) owns transitions.
- [Runtime scope](../runtime/scope-transitions.md) owns data retirement.
