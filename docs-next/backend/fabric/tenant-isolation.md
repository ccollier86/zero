---
id: zero.fabric.tenant-isolation
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: tenant-isolation
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

# Guardian-Bound Tenant Database Access

[Fabric index](./index.md) · [Documentation index](../../index.md)

## Normal Request Boundary

In tenant-database mode, the platform projects `zero.data` from the request's
verified current Guardian identity and organization membership. The consumer
cannot retarget that capability with a tenant ID, file path or arbitrary
executor.

Raw `zero.db`, `zero.sql` and `zero.databases` are trusted setup/explicit unsafe
surfaces, not ordinary tenant request APIs. Do not rebuild isolation by putting
a caller-supplied tenant ID into a raw manager call.

## Live Authority

Tenant reads check current authority before dispatch and again before returned
data is released. Managed writes use live authority/commit fences so stale
membership, role or credential state cannot silently retain a previously
admitted tenant capability.

Current organization suspension, membership state, permission revocation and
credential ceilings still matter. A storage identity anchor or client-cached
profile cannot replace those checks.

The Administration Organization can use its own app data with ordinary
tenant-scoped roles. Separate application-scoped platform powers remain explicit;
holding an administration membership alone does not authorize other tenant data.

## Isolation Is Not Every App Policy

A bound physical file prevents cross-tenant retargeting; it does not
automatically supply every feature permission or business row/field constraint.
Use the normal route/service permission checks and declared resource policies
for “can edit this note,” ownership, masked fields and organization feature access.

For app-verified machine credentials, the public
[authority-scoped service projection](../runtime/machine-services.md) requires
trusted server binding and live asynchronous/synchronous fences. Do not fabricate
a human browser session to access Fabric.

## Switching And Readiness

The frontend must retire old organization state, queries, selections and
pending work on scope change. Server admission waits for a correctly bound,
migrated and reconciled target; it never authorizes against a half-provisioned file.

See [identity projection](./identity-projection.md),
[Guardian authorization](../guardian/index.md),
[realtime](./realtime.md) and [operations](./operations.md).
