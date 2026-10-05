---
id: zero.notifications.configuration
type: reference
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: composition-and-defaults
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

# Notification Composition And Defaults

[Notifications index](./index.md) · [Documentation index](../../index.md)

There is no `AppConfig.notifications` switch or notification environment
subtree. Managed createApp mounts notifications when Guardian is enabled.
The plugin receives the separate system ReactiveDB and app-local auth/runtime/
scheduler dependencies. These are composition inputs, not browser settings.

## Defaults And Ownership

Type defaults info; priority normal; target all; sender/body/action URL/
metadata/expiry nullable. The service generates IDs and wall-clock timestamps.
No default expiry/retention TTL is assigned.

With a scheduler, startup registers `notification-cleanup` at
`0 0 * * * *` (hourly). It calls trusted `deleteExpired()` and emits
`NOTIFICATIONS_CLEANUP` when rows were deleted. Without a scheduler there
is no notification-owned periodic cleanup loop.

Persistent tables are `notifications` and `notification_receipts` in the
system database. Client SDK composition supplies platform tables; explicit
standalone clients can add `NOTIFICATION_TABLES` through the public
`@zero/framework/notifications` server barrel only in appropriate trusted
composition, or use the normal frontend SDK table map. Do not manually create
application copies as a substitute for system projection.

## Standalone Plugin

`createNotificationPlugin(config)` is public on
`@zero/framework/notifications`. Required `db` and optional runtime/
auth/authorization/scheduler getters and onServiceCreated callback enable
explicit trusted Elysia composition. Its named auth dependency is intentional.
Raw service and module getter are compatibility/composition seams; ambiguity
between multiple registered runtimes is not implicit selection.

Managed shutdown clears the exact runtime service registration. Scheduler/
database lifecycle belong to their own owners. Operational lifecycle emits
NOTIFICATIONS_STARTED/STOPPED using standard Zero events; do not put body or
recipient data into app logs.

## Configuration Verification And Next Steps

Check auth-disabled omission, app-local binding, system-table ownership,
cleanup registration and scope/auth wiring in synthetic startup fixtures.
There is no notification-specific Doctor toggle to infer.

- [Service](./service.md) owns per-record options.
- [Authorization](./authorization.md) owns scope/permission behavior.
- [Scheduler](../scheduler/index.md) owns periodic job lifecycle.
