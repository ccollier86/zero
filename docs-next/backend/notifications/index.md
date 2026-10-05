---
id: zero.notifications
type: index
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: overview
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

# Notifications

[Backend index](../index.md) · [Documentation index](../../index.md)

Notifications are persisted notices addressed to Guardian users or effective
roles, plus recipient-specific seen/read/dismissal receipts. Managed composition
stores them in the **system database**; Fabric application databases are not
the notification store. Server policy filters HTTP and Sync delivery.

## Feature Guides

- [Service](./service.md): creation/targeting, records, deletion and expiry maintenance.
- [Receipts](./receipts.md): per-user acknowledgement and idempotent transitions.
- [HTTP routes](./routes.md): authenticated endpoints and exact wire shapes.
- [Authorization](./authorization.md): active scope, audience and management powers.
- [Configuration](./configuration.md): composition, defaults and table ownership.
- [Frontend hooks/UI](../../frontend/notifications/index.md): realtime projections and presentation.
- [Roadmap](./roadmap.md): channel/presentation direction, not current chat APIs.

Use request-bound `zero.notifications` in normal server code. The raw
`NotificationService` exported from `@zero/framework/notifications` is a
trusted composition service, not an authenticated SDK. Each role-target match
uses the server's complete live role set; browser global-role comparisons must
not discard additive organization roles.

The source architecture favors one persisted notice and recipient receipts,
not an email copy for every reader. Notifications do not guarantee mailbox
delivery, offline push or a realtime latency SLA. Use [Email](../email/index.md)
for mail and [Rooms](../rooms/index.md) for collaboration membership.

This development draft includes safe notification JSON/enum admission changes;
it is not an exact released-package qualification.
