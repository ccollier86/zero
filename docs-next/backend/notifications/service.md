---
id: zero.notifications.service
type: reference
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: notice-lifecycle
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

# Notification Service And Records

[Notifications index](./index.md) · [Documentation index](../../index.md)

The request-scoped service carries the current actor/data scope and live
authority fences. Creation requires scope-management power; ordinary reads
return only that actor's targeted notices. See [authorization](./authorization.md).

## Targeted Creation

The scoped surface offers synchronous `create(params)` and
`broadcast(params)` aliases, `notify(userId, params)`,
`notifyUsers(userIds, params)` and `notifyRole(role, params)`.
Do not pass a tenant selector or sender supplied by an untrusted caller; the
request service owns those bindings.

`CreateNotificationParams` requires `title`; optional fields are
`type` (info), `priority` (normal), `body`, `actionUrl`,
`metadata: Record<string, unknown>` and `expiresAt: number`.
Types are info/warning/success/error/system; priorities are
low/normal/high/urgent. Epoch timestamps use milliseconds.

The accepted record contains `notification_id`, nullable `tenant_id`,
type/priority/title, nullable body/sender/action URL/expiry and
`created_at`. `target_type` is all/user/users/role;
`target_value` holds an exact ID/role or JSON-encoded ID array.
`metadata` is stored as JSON text. The notice ID is generated server-side.

## Reads And Deletion

Scoped `get/getById(id)` returns the actor-visible record or null.
`list/getForUser()` returns notices with optional `receipt`;
`getUnreadCount()` excludes read/dismissed notices.
`getReceipts(id)` requires management authority in that exact scope.
`delete/deleteNotification(id)` requires management and removes the notice
and associated receipts through ReactiveDB in a transaction.

Expiry is maintenance-driven: `deleteExpired()` on the raw trusted service
deletes rows whose expiry is strictly before the current time, across system
scopes. It is deliberately unavailable on the ordinary request facade.
Do not describe an expiry field as an exact-time guaranteed disappearance;
the managed scheduler normally performs hourly cleanup.

## Trusted Composition

The public raw constructor is `new NotificationService(db, tenancyMode?)`.
Its optional scope/actor/commit-fence arguments are composition primitives;
omitting scope is allowed only in single mode. The service itself does not
authenticate a caller or infer live roles from a supplied string. Prefer the
managed scoped service rather than rebuilding its authority checks.

## Errors And Verification

HTTP/service projections use normal Guardian forbidden/not-found/current-state
errors. Writes remain tracked system-plane ReactiveDB operations; direct
notification-table client mutation is not the supported write path.
Test manager creation, ordinary targeting, deletion/receipts and cross-tenant
IDs with synthetic data; do not infer successful delivery from a local list.

- [Receipts](./receipts.md) owns per-user acknowledgement.
- [Routes](./routes.md) supplies client wire formats.
- [Configuration](./configuration.md) owns cleanup and composition defaults.
