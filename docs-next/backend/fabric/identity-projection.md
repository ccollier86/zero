---
id: zero.fabric.identity-projection
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: identity-projection
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Minimal Identity Anchors And Provisioning

[Fabric index](./index.md) · [Documentation index](../../index.md)

Guardian users, sessions, organizations, memberships and permissions remain
canonical in the system database. An app/tenant database receives only the
required shallow identity anchors needed for declared SQLite foreign keys.

## Declare References, Not Profile Copies

Use [Guardian Schema references](../schema/guardian-references.md) for app rows
owned by users/memberships. The framework owns anchor tables and projection;
do not declare replacement credential/profile tables in the realm.

Anchors provide existence/key relationships. They do not store usable passwords,
sessions or authority, do not grant access, and are not a substitute for the
canonical user's profile. Use normal Guardian services for profile/account
administration.

Pinned app targets and tenant targets have mode-appropriate projection.
Tenant projection carries the identities required for that admitted
organization, not a full copy of every platform user.

## Provision And Reconcile

Onboarding can schedule best-effort target provisioning after canonical
Guardian changes. Scheduling is not the correctness barrier: each admitted
target must establish owned file/realm identity, run its required initialization
and catch up projection before reporting ready.

Source/target installation binding, a durable projection journal and watermarks
support catch-up/recovery. A mismatched/unavailable target cannot inherit
readiness from another file or the source alone.

Ready means the admitted target is usable, not that every external email,
billing or application-specific seed succeeded. App-defined seed/migration work
belongs in the explicit realm/feature lifecycle.

## User Experience

The data-realm readiness API/UI distinguishes provisioning, retrying, ready and
safe failures. Keep the user in a truthful setup state when admission is waiting;
do not expose provisional data or call a missing FK a successful registration.
See [Guardian readiness](../guardian/index.md) and frontend Guardian guides.

Framework anchor writes are not ordinary app CRUD: pinned ReactiveDB does not
register anchors as app-mutable tables; Fabric command/automation capabilities
protect registered anchors as read-only. Raw trusted SQL is a different privileged
boundary, not automatically guarded application code.

## Lifecycle And Ownership

A retained anchor supports historical FK relationships; it does not prove the
user is currently active or still a member. Suspend/revoke authority in Guardian.
Projection and realtime catch-up remain independently bounded.

See [tenant isolation](./tenant-isolation.md),
[realms](./realms.md), [runtime planes](../runtime/data-planes.md) and
[database automations](../database-automations/index.md).
