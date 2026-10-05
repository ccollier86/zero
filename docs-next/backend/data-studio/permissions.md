---
id: zero.data-studio.permissions
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: permissions
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

# Data Studio Roles And Live Permissions

[Data Studio index](./index.md) · [Documentation index](../../index.md)

The feature publishes tenant-scoped data-studio:read, data-studio:write and
data-studio:manage permissions. Read views tables/rows; write edits records;
manage creates/edits/archives logical schemas.

## Fragments

Viewer contains read; Editor contains read+write; Manager contains all three.
Merge DATA_STUDIO_PERMISSION_REGISTRY and role fragments into the app's actual
advanced Guardian registry. Fragment keys are not automatically installed
roles or grants.

Management permission is not a hidden platform application.* power.
It may be granted as an ordinary app role in the Administration Organization as
well as a customer organization.

## Live Enforcement

HTTP routes and admitted resources use current tenant authority and explicit
session/API-key admission. Credential permission ceilings and revocation still
apply. A cached frontend capabilities object is display guidance, not server
authorization.

Direct creation/replacement/status calls must use their required read/write/
manage boundary. A UI schema editor hidden from viewers does not protect a
permissive app-owned server endpoint.

## Scope And Attribution

The bound service selects only the current organization DB and stamps canonical
actor references. Organization membership alone does not grant all Data Studio
permissions, and platform administration alone does not select another
organization's data file.

Data Studio records are organization-owned with actor attribution, not private
per-user databases automatically created by the table editor.
App-specific ownership policies can be designed above the supported boundary,
but do not relabel a member ID as a tenant/physical database selector.

See [ownership](./ownership.md), [profiles](./profiles.md),
[HTTP API](./http-api.md), [realtime](./realtime.md) and
[Guardian authorization](../guardian/index.md).
