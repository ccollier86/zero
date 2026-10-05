---
id: zero.guardian.api-keys
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: user-bound-keys-and-management-ceilings
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Issue And Manage User-Bound API Keys

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian API keys are optional user-bound app credentials. In multi mode they
are also bound to one exact tenant and membership. They retain the user's live
permissions and availability; possession of a key does not manufacture a
platform role, tenant selector or unrestricted system-service connection.

This guide includes an authorized development configuration correction:
`eligibleScopeRoles` now accepts declared Administration-only roles as well as
ordinary app roles. A global eligibility policy can permit an Administration
member without making that role assignable to customer organizations.
The corrected source is not yet a release-qualified artifact.

## Configure Availability, Eligibility And Issuance

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  tenancy: 'multi',
  authorization: 'advanced',
  apiKeys: {
    enabled: true,
    selfService: true,
    administratorIssuance: true,
    eligibleScopeRoles: ['administrator', 'owner'],
    defaultTTL: '30d',
    maxTTL: '90d',
    maxActivePerUser: 10,
  },
});
```

Keys are disabled by default. Boolean `apiKeys: true` enables keys and
self-service, but **does not** enable administrator issuance. Object-form
booleans default false independently; issuance cannot be enabled while keys
are disabled.

`eligibleScopeRoles` is an optional nonempty, unique allowlist. Eligibility is
evaluated against the subject's live scope roles, not solely the operator who
is issuing the credential. An eligible owner/admin is not exempt from an
explicit allowlist, active-account requirements or limits.

Default lifetime is 30 days, maximum 90 days, maximum 10 active keys per
user/scope. Active-key limit accepts 1–100. Caller-selected TTL must be positive
and no greater than the configured maximum; defaultTTL cannot exceed maxTTL.

## Three Separate Decisions

1. **Capability:** Does the application enable API keys/self-service/admin issuance?
2. **Subject eligibility:** May this current user/membership hold a key in this scope?
3. **Actor authority:** May this full-session caller manage their own or another
   subject's keys?

A manager's issuance permission does not make an ineligible target eligible.
The target's eligibility does not give a different user permission to issue
its key. Role eligibility does not add permissions to the resulting credential.

## Management API

Management is session-only. An API key cannot list/issue/rotate/revoke other
keys or call human account-management routes just because its owner can.
The request credential resolver for app APIs is deliberately distinct from
the TokenService-only management surface.

| Scope | Routes |
| --- | --- |
| Self | GET/POST `/auth/api-keys`; POST `/auth/api-keys/:keyId/rotate`; DELETE `/auth/api-keys/:keyId`. |
| Single app administrator | GET/POST `/auth/admin/users/:userId/api-keys`; POST `/auth/admin/api-keys/:keyId/rotate`; DELETE `/auth/admin/api-keys/:keyId`. |
| Multi current org manager | GET/POST `/auth/tenant/members/:membershipId/api-keys`; POST `/auth/tenant/api-keys/:keyId/rotate`; DELETE `/auth/tenant/api-keys/:keyId`. |
| Multi platform operator | GET `/auth/platform/api-keys`; GET/POST `/auth/platform/tenants/:tenantId/members/:membershipId/api-keys`; POST `/auth/platform/api-keys/:keyId/rotate`; DELETE `/auth/platform/api-keys/:keyId`. |

The single administrator user-key target is not available in multi mode;
use a membership-bound target instead. Multi platform management requires live
Administration application user read/manage and tenant-read authority.
Current-org management cannot target a key in another organization.

Issue/rotate body is `{ label, ttl? }`; label is 1–100 characters. Lists use
bounded limit/cursor and return `apiKeys`, actor `capabilities`, and page
count/hasMore/nextCursor. Render these capabilities, not assumptions based on
the current page URL.

## Display The Secret Once

Issuance/rotation returns `{ apiKey, secret }`. Persisted Guardian records
hold a hash and hint, not the raw secret. Lists return secret-free summaries:
scope, subject, label/hint, expiry, last use and status.

Show a one-time copy/reveal control and clearly explain that closing it loses
the opportunity to recover the raw value. Never persist it in a user property,
send it to analytics, put it in a URL or print it in logs.

Rotation produces a new credential and revokes the predecessor through the
management transaction. Consumers must adopt the returned secret; refetching
the list cannot recover it.

## Admit Keys On App Operations Explicitly

```ts
import type { AccessRequirement } from '@zero/framework/auth';

export const machineRead = {
  tenant: 'required',
  permission: 'documents:read',
  credentials: ['session', 'api-key'],
} satisfies AccessRequirement;
```

Use that declaration on the managed endpoint/resource that supports machine
calls. Default admission remains session-only. The authenticated key context
stays bound to its server-owned scope; changing an arbitrary header/query
tenant ID does not switch it.

Ordinary app APIs can accept a key without accepting it for global user,
organization or role administration. This credential ceiling is intentional,
including for a key issued to an Administration owner.

## Live Availability And Revocation

Every key resolution checks enabled capability, secret hash, expiry/revocation,
current user eligibility/auth generation, current tenant/membership and live
role eligibility. Role removal removes its permission immediately; losing
the eligible role makes the key unavailable.

Summary statuses distinguish active, expired, revoked, invalidated (security
generation changed), and unavailable (current identity/scope no longer admits
use). Temporary availability is not a promise that an invalidated security
generation may revive. Last-used writes are throttled; the timestamp is not
an exact per-request metering ledger.

Background work may capture a non-secret API-key authority reference and
re-resolve it at commit. Such a reference remains key-generation/user/scope
bound and cannot outlive revocation.

## Service HMAC Is Not This Feature

No Guardian environment-backed service-role/HMAC API credential contract was
found in this source. There is no supported `serviceKey` or HMAC-signing
configuration field to enable here. `AUTH_SIGNING_KEY` is JWT private JWK
material, and storage URL signatures are a different system.

Applications with separately verified machine credentials should use the
supported [authority-scoped machine service boundary](../runtime/machine-services.md)
with mandatory live fences. Do not fabricate a browser session or import
internal files to obtain unscoped system access.

## Verification And Errors

Test issuance-disabled versus subject-ineligible, actor ceiling, expiry,
active-key limits, one-time secret display, rotation, direct revocation,
membership suspension, role removal, account/security generation changes,
customer platform-role rejection and Administration app-only/mixed roles.

Management with a raw API key fails session authentication, typically
`UNAUTHORIZED` (401), not “allowed because the key owner is an admin.”
Domain failures retain `AUTH_API_KEY_*` codes. Standard issuance/revocation/
rejection events never include raw secrets.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Authorization](./authorization.md) attaches explicit credential admission.
- [RBAC](./rbac.md) defines live roles and customer/Admin ceilings.
- [Sessions](./sessions.md) describes human session management separately.
- [Control plane](./control-plane.md) identifies eligible platform actors.
