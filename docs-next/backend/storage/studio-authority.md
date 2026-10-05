---
id: zero.storage.studio-authority
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: studio-authority
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

# Application, Organization And Personal Boundaries

[Storage index](./index.md) · [Documentation index](../../index.md)

Owner choice is organization or personal; canonical ownership is mode-aware:

| App mode/choice | Owner kind | Scope |
| --- | --- | --- |
| single + organization | application | application |
| multi + organization | organization | current tenant |
| single + personal | user | application |
| multi + personal | user | current tenant |

The server derives IDs from current authority. Public owner choice is not a
selector for a different user/tenant.

## Administration Organization

Its members can use ordinary app storage in their own organization with granted
tenant roles. Some also have platform control permissions.
Those powers are independent: membership alone is not platform superpower, and
a platform operator does not automatically read another organization's objects.

Catalog/manage capabilities are not blanket private personal-file ACL grants.
Keep current object/drive access and lifecycle checks in the byte path.

## Personal Self-Service

personalDrives and personalSelfService must permit the mode, and current
eligibility/permissions still apply. A user does not receive a separate tenant
because they own a personal drive inside an organization.

Custom trusted-property grants require server-approved provenance.
The client cannot authorize itself by setting profile metadata or retaining an
old capabilities object.

## Scope Replacement

Organization switching clears cached drive capabilities, selected records,
queries and pending mutation response acceptance.
Physical blob deduplication across drives doesn't widen metadata access.

See [Guardian](../guardian/index.md), [permissions](./permissions.md),
[Studio permissions](./studio-permissions.md),
[request authority](./request-authority.md) and
[client integration](./client-integration.md).
