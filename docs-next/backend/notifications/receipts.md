---
id: zero.notifications.receipts
type: reference
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: recipient-receipts
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

# Seen, Read And Dismissed Receipts

[Notifications index](./index.md) · [Documentation index](../../index.md)

A receipt belongs to one user and notice in the current scope. It stores
`receipt_id`, duplicated `tenant_id`, `notification_id`, `user_id`
and nullable `seen_at/read_at/dismissed_at` timestamps.

## Operations

| Operation | Accepted transition |
| --- | --- |
| `markSeen(id)` | Creates a receipt or fills an absent seen timestamp; repeated seen is a no-op. |
| `markRead(id)` | Fills read and, if absent, seen timestamps. |
| `dismiss(id)` | Sets dismissal; first dismissal creates a seen receipt, without pretending it was read. |
| `markAllSeen()` | Applies seen only to actor-visible notices. |
| `markAllRead()` | Applies read/seen only to actor-visible notices. |

The request facade takes notice IDs only: user and tenant are bound internally.
A guessed/non-target ID is not a receipt-write capability. A manager who is
not in the audience cannot impersonate the recipient to mark their notice read.
Read-all does not mean all users or all organizations.

Writes execute inside synchronous ReactiveDB transactions with live commit
fences. Managed Sync publishes only recipient-authorized receipt rows.
[Authorization](./authorization.md) explains target/management separation.

## Browser Completion

The current React hook's receipt callbacks return **void**, dispatching the
authenticated HTTP write and observing failure through
`FRONTEND_NOTIFICATION_RECEIPT_FAILED`. They do not expose an acceptance
promise or optimistic receipt store. The accepted server write arrives through
the realtime projection.

For code that needs to await completion, use the shared SDK
`client.post('/notifications/<encoded-id>/read')` and await it. Do not await
the void hook callback and interpret immediate completion as server acceptance.
[Frontend hooks](../../frontend/notifications/hooks.md) owns the UI contract.

## Verification And Related Guides

Test exact target, non-target, anonymous and manager-not-recipient requests.
Repeat seen/read, dismiss one item and read/seen-all; verify other users' and
other tenants' receipts remain untouched. Dismissal hides the item in the
packaged hook without deleting the notice or security history.

- [Service](./service.md) distinguishes scoped deletion from dismissal.
- [Routes](./routes.md) lists exact receipt endpoint replies.
- [Frontend components](../../frontend/notifications/components.md) wires callbacks.
