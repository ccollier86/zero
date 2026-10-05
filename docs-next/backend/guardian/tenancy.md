---
id: zero.guardian.tenancy
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: organization-creation-selection-and-switching
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Create, Select And Switch Organizations

[Guardian index](./index.md) · [Documentation index](../../index.md)

Multi tenancy separates the canonical account from its organization
memberships. A session selects one live membership and binds application work
to that scope. A browser-provided tenant ID is a selector to validate, not
permission to open an arbitrary Fabric file.

## Enable Multi Mode

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  tenancy: {
    mode: 'multi',
    terminology: { singular: 'workspace', plural: 'workspaces' },
    creation: { mode: 'authenticated' },
  },
  authorization: 'advanced',
});
```

The default is single. Multi creation defaults `authenticated`; alternatives
are `platform-admin` and `disabled`. Terminology affects presentation, not
API field names or security scopes. Default terms are organization/organizations.
Multi-only terminology/creation/onboarding/administration settings are rejected
when configured for single mode.

## Complete A Multi Login

Normal auth completion can return:

| Result | Next action |
| --- | --- |
| `accessToken`, `refreshToken`, `activeTenant` | Use the bound session. |
| `tenantSelectionRequired` and `tenantSelection` | Select one listed live membership. |
| `tenantOnboardingRequired` and `onboarding` | Create/join an allowed organization; no unrestricted session exists yet. |

Selection includes a limited `continuation`, expiry and server-owned tenant
choices. The continuation is not an app access token.

`POST /auth/tenants/select` takes `{ continuation, tenantId }` and returns a
full token pair with `activeTenant` only after that selected membership remains
admitted. An expired selection or removed/suspended membership fails closed.

## Create An Organization

`POST /auth/tenants/create` accepts `name`, optional `slug`, and the appropriate
`continuation` or existing `refreshToken` proof. The name is 1–120 characters;
slug is 1–63 alphanumeric segments separated by hyphens.

The server applies creation policy, derives the canonical owner, creates the
organization/owner membership and returns a session bound to the new organization.
It does not trust a requested arbitrary `ownerUserId` in this self-service
ceremony. Platform-created organizations use the separate control-plane route.

[Registration](./registration.md) can also request one-step creation with
organizationName/organizationSlug. The initial multi bootstrap organization is
always the protected Administration Organization, irrespective of later
self-service creation policy.

## List And Switch

`POST /auth/tenants/list` takes `{ refreshToken }` and returns admitted tenant
choices plus `activeTenantId`.

`POST /auth/tenants/switch` takes `{ refreshToken, tenantId }`. It consumes the
live refresh proof and replaces the browser parent session with a new
tenant-bound parent. Successful response includes a new access/refresh pair
and `activeTenant`; page cookie authority is updated too.

Adopt the replacement credentials together. Old access/page/refresh authority
must not continue authorizing the previous organization. Clear protected rows,
selection, pending edits and stale request completions when switching, even
if the same canonical user remains signed in.

Do not mutate a local `tenantId` property and keep using the previous session.
The authoritative binding comes from durable Guardian rows.

## Guardian And Fabric

Guardian defines tenant identity/membership and admitted scope. Fabric maps
that scope to the correct application database when configured. Multi Guardian
can also run with shared application tables; topology is a separate choice.

Canonical users, credentials and membership policy remain in the system
database. Local [identity anchors](./identity-projection.md) enable application
FK ownership without copying password/session state into every tenant file.

Provisioning/identity readiness must succeed before operations depending on
that realm commit. A freshly created organization is not permission to skip
its migration/projection lifecycle or leak another database's cache while
waiting.

## Verification

Test no membership, one/multiple live memberships, expired selection, removed
membership, suspended organization, create-disabled/platform-admin policy and
concurrent switches using the same refresh proof. Verify that replacement
credentials, page reloads, APIs and sync all resolve one identical scope.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Modes](./modes.md) separates tenancy from authorization and database topology.
- [Tenant administration](./tenant-administration.md) manages the selected organization.
- [Invitations](./invitations.md), [join requests](./join-requests.md) and [verified domains](./verified-domains.md) provide onboarding alternatives.
- [Sessions](./sessions.md) explains parent replacement and refresh replay.
