---
id: zero.guides.organization-app
type: how-to
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: organization-app
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [single, multi, simple-RBAC, advanced-RBAC, single-topology, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Build An Organization-Owned Application

[Guides index](./index.md) · [Documentation index](../index.md)

Start with the organization as the owner of shared business data. Users access
that data through current membership and declared permissions; they do not each
need their own tenant database unless that is the actual product model.

For the coherent file-by-file wiring, follow
[organization assembly](./organization-assembly.md). It joins server configuration,
the side-effect-free actor realm, browser-safe tables, account pages and Studio
controls without relying on scattered fragments or importing server secrets into UI.

## 1. Declare Guardian's Profile

Choose multi/simple or multi/advanced. Declare app permissions with tenant scope,
and app roles containing those permissions. Add platform/application permissions
only for genuine platform administration. Declare onboarding/creation policy
and the first-owner [bootstrap ceremony](../backend/guardian/bootstrap.md).

Roles are definitions, not automatic assignments. The Administration owner,
operators and ordinary app-only members must use the same supported membership/
role lifecycle as other organizations, with protected-owner rules intact.

## 2. Choose The Data Boundary

Shared-row resources retain their declared tenant discriminator.
Fabric tenant-database resources resolve the physical file from live trusted
organization authority; their tables need not duplicate a discriminator just
to identify that same file. User ownership, row policy and references still matter.

Contribute the schema and operations to an immutable realm. Assemble topology,
actor launch, storage placement and app tables consistently. The server entry
must perform the [same-entry actor branch](../backend/fabric/actors.md)
before normal app startup; actors must not accidentally start another web server.

## 3. Let Readiness Be A Service Boundary

New organization creation records provisioning intent. Fabric admits its
database, schema/migrations and required identity anchors before returning usable
operations. The browser waits for the supported readiness/outcome rather than
constructing paths, weakening FKs or treating KV as a temporary authority store.

Unknown outcomes require reconciliation/idempotency, not a blind duplicate
provisioning request.

## 4. Install Adaptive Controls

Use the packaged [Guardian control plane](../frontend/guardian/index.md) for
users, memberships, roles, invitations and authorized workspace switching.
Choose supported configuration/capabilities and placement in your app.
Do not rebuild backend authority merely to hide a button.

Storage Studio can manage permitted organization drives. Data Studio's complete
feature requires multi+advanced+Fabric tenant-database; install its official
tables/resources/realm contribution/permissions/router, not just its frontend.

## 5. Exercise Real Isolation

Use two organizations with the same logical table shape. Write a user-owned
record in each, show realtime updates only to the admitted members, remove an
app role, and verify old sessions/keys cannot retain that authority.

Also test the Administration Organization's app-only and mixed-role members.
Its ability to use the app is not implicit access to customer data.

See [Guardian tenancy](../backend/guardian/tenancy.md),
[Fabric](../backend/fabric/index.md), [resources](../backend/resources/index.md),
[Storage Studio](../backend/storage/studio-installation.md),
[Data Studio](../backend/data-studio/installation.md) and [verification](./verification.md).
