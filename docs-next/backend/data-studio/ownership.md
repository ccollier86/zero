---
id: zero.data-studio.ownership
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: ownership
maturity: supported
applies_to: ["2.1.1 baseline with unreleased datetime calendar correction"]
modes: [multi, advanced-RBAC, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Organization Ownership And Actor References

[Data Studio index](./index.md) · [Documentation index](../../index.md)

The active Guardian organization owns the Data Studio plane.
Current users/memberships are attributed through canonical IDs and minimal
local FK anchors; password/profile/session information remains in systemDb.

## Admitted Actor

DataStudioService takes a bound data capability and {userId,membershipId}.
The normal server route derives both from verified current authority.
Realm commands assert the matching local canonical actor references before
mutation and use those IDs for creation/update attribution.

A fabricated actor input in trusted raw composition is not a login.
A shallow anchor proves key existence, not permission/current membership.
Live Guardian and Fabric commit fences remain authoritative.

## Ordinary And Administration Workspaces

Both can own/use their own logical tables.
App-only roles are sufficient when they grant Data Studio permissions; separate
platform roles can coexist but are not automatically required for app records.

Platform user/organization management doesn't grant unrestricted cross-org
record access. Personal UI placement also doesn't create a per-user physical DB
or make all rows private to their creator.

## Schema References

Fixed Data Studio backing schemas declare required user/membership anchors.
For your ordinary app schemas use the public
[Guardian reference declarations](../schema/guardian-references.md), not copied
credential tables.

User/membership deletion/suspension and historical attribution are different:
retained keys cannot authorize a suspended user.
See [Fabric projection](../fabric/identity-projection.md),
[permissions](./permissions.md), [realm integration](./realm-integration.md)
and [profiles](./profiles.md).
