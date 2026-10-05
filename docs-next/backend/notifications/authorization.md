---
id: zero.notifications.authorization
type: reference
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: scope-and-audience
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

# Notification Scope And Audience Authority

[Notifications index](./index.md) · [Documentation index](../../index.md)

Scope selects the application in single mode or the authenticated active
organization in multi mode. It is not an arbitrary tenant ID from request JSON.
All notifications remain system-plane rows with a scope column, even when app
data uses one Fabric file per organization.

## Management Versus Recipient

`notifications:manage` is the tenant-scoped management permission in
advanced profiles. Single/simple compatibility uses the platform-admin
authority; other profiles use live Guardian scope permissions/roles through
the shared service-data authority resolver. Administration organization
membership by itself is not cross-organization notification access.

Management permits creation, manager receipt inspection and deletion within
the scope. Audience membership permits notice reads and one's own receipt
writes. Management does not automatically put an actor into every notice's
audience. A platform role is not permission to mark another recipient's notice
read.

Role targets use the complete server-resolved effective role set, including
additive advanced app roles. The browser's canonical user.role/retained
tenantRole is not that complete set.

## Server And Sync Integration

Normal `zero.notifications` binds scope/actor and checks live authority
synchronously before operation/commit. The raw service takes trusted scope/
roles; its constructor and public getters do not authenticate an ID.
[Request services](../runtime/server-services.md) explains the difference.

Managed Sync filters notices by tenant and audience, and receipts by tenant
and recipient. It protects both tables from arbitrary client mutation.
Frontend role-target display therefore trusts the already-filtered projection;
it does not reconstruct backend role matching from one global role string.

## Verification And Related Guides

Test the full effective role set, removal/revocation, cross-tenant IDs, manager
not in audience and ordinary user without management. Verify HTTP, scoped
server facade, snapshots/catch-up/live projection agree. UI-only filtering is
not a security regression test.

- [Guardian authorization](../guardian/authorization.md) owns live grants.
- [Service](./service.md) distinguishes privileged/raw and normal facades.
- [Frontend hooks](../../frontend/notifications/hooks.md) explains scope retirement.
