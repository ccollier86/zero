---
id: zero.storage.studio-permissions
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: studio-permissions
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Declare Studio Permissions And Roles

[Storage index](./index.md) · [Documentation index](../../index.md)

Storage publishes fragments; it does not automatically install app roles when
Studio is enabled.

## Permission Keys

| Key | Capability |
| --- | --- |
| storage:catalog:read | Discover visible managed drives |
| storage:drives:provision | Provision org/application drives |
| storage:drives:manage | Edit/lifecycle management |
| storage:drives:delete | Permanent managed deletion |
| storage:personal-drives:provision | Eligible current-user personal provisioning |

STORAGE_STUDIO_PERMISSION_REGISTRY supplies labels/descriptions and leaves scope
to Guardian's mode default: application in single mode, tenant in multi mode.
It is not a list of platform application.* superpowers in multi mode.

## Role Fragments

Public viewer, provisioner, manager, personal and admin fragments compose those
keys. The manager intentionally lacks permanent delete; the admin fragment
contains the full Studio set.
STORAGE_STUDIO_ROLE_FRAGMENTS is a convenience registry of fragments, not
preinstalled role assignments.

Merge them into the app's declared permission/role registry and choose its real
role keys. A member must still receive that current role/permission through
Guardian.

## Object ACL Is Separate

Catalog/manage/provision authority is not a blanket read grant to all private
personal files or another organization's drive. Engine ACL/owner scope and
managed lifecycle still govern bytes.
Default ACL grants installed at provisioning are a distinct server policy.

Personal self-service additionally depends on owner-mode configuration.
A frontend New Drive button must reflect current server capability, not just
check a hardcoded role name.

See [Guardian](../guardian/index.md), [permissions](./permissions.md),
[provisioning](./studio-provisioning.md), [authority](./studio-authority.md)
and [installation](./studio-installation.md).
