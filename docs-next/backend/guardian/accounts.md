---
id: zero.guardian.accounts
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: canonical-user-profile-and-administration
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

# Manage Canonical Accounts And Profiles

[Guardian index](./index.md) · [Documentation index](../../index.md)

A Guardian account is canonical identity across its organizations.
Its global role, status and security gates are not a selected membership's
roles or status. Choose the account or membership operation deliberately;
a platform account suspension affects every workspace that account can use.

## Current User

`GET /auth/me` requires a full live session and returns the sanitized account:
userId, username, email, names, global role, status, password/verification/MFA
gates, timestamps and canonical properties. Password hashes and credentials
are not included. Missing property defaults are applied before projection.

This is not a public profile-directory endpoint. A local app database's
ID-only users anchor cannot provide this profile and must not become a
substitute authentication record.

Current-user metadata routes are described in [user properties](./user-properties.md).
Self password change uses the dedicated proof in
[password lifecycle](./password-recovery.md). This source does not expose a
generic self profile PATCH or self email-change endpoint simply because the
administrator editor can edit those fields.

## Canonical Administrator Directory

The session-only `/auth/admin` surface is guarded by current global admin
in single mode and live Administration application-user permissions in multi
mode. Advanced single application-role management is a separate
`/auth/application` surface, not a blanket replacement for global user controls.

| Endpoint | Use |
| --- | --- |
| `GET /auth/admin/config` | Safe effective account/readiness settings and actor capabilities. |
| `GET /auth/admin/users` | Canonical account list with limit, offset, search, global role and status filters. |
| `GET /auth/admin/users/:userId` | One admitted profile. |
| `POST /auth/admin/users` | Create identity with optional setup delivery. |
| `PATCH /auth/admin/users/:userId` | Validated profile/security/property transition. |
| `DELETE /auth/admin/users/:userId` | Guarded identity deletion when retained history permits it. |

The directory returns offset pagination:
`page: { limit, offset, count, total, hasMore, nextOffset }`.
Limit defaults to 50 and is bounded at 200; offset is normalized nonnegative.
This differs from membership/audit cursor pages; do not implement Next by
guessing a membership cursor from the canonical offset.

Config capabilities distinguish `canManageUsers` from
`canManageGlobalAdmins`. A delegated multi platform operator can manage
ordinary users without acquiring authority to promote/demote legacy global
administrators. Use actual actor capabilities for actions.

## Profile And Security PATCH

Accepted fields are username, email, firstName, lastName, global role,
active/suspended status, passwordChangeRequired, mfaRequired and configured
properties. Email canonicalization and security-boundary checks occur in the
domain service, not just input controls.

```http
PATCH /auth/admin/users/<target-user-id>
Authorization: Bearer <admitted full session>
Content-Type: application/json

{"status":"suspended"}
```

This suspends the account globally. To suspend one organization's membership,
use [tenant administration](./tenant-administration.md) instead.

A new forced password gate must use setup/reset delivery, not arbitrary
passwordChangeRequired=true PATCH. MFA requirements require a ready supported
method. Account email changes reset verification state appropriately.
Trusted property changes alter authority, while harmless display-name editing
does not pretend to be a role grant.

Admin property operations also support PUT/DELETE
`/auth/admin/users/:userId/properties/:key` and PATCH
`/auth/admin/users/:userId/properties` with `{ properties }`.
They use the same configured editor/trust rules and invalidate authority
when a trusted property actually changes.

## Deletion And Protected Access

Administrative actions guard self-targeting and the last recoverable active
administrator. Protected application/Administration ownership additionally
uses its dedicated role/membership lifecycle. Destructive identity deletion
can be refused when tenant history must be retained
(`USER_HAS_TENANT_HISTORY`); do not bypass it with SQL.

Password reset, MFA reset and forced change have separate self/owner recovery
constraints. Being able to edit a display name does not imply being able to
destroy that account's assurance or current ownership.

Every mutation rechecks the actor's current authority at the relevant commit
boundary. Security changes invalidate affected credentials/generations.
A management panel loaded before revocation cannot continue mutating by
reusing an old session object.

## UI Composition

The reusable user/org control plane can adapt its list, detail panel and action
bar to canonical users, the selected membership directory and permitted
platform organization management. Keep profile/property/role information in
the selected detail context and lifecycle actions in the shared action surface.

Render capability-driven controls; do not add global password/suspension
actions to an ordinary organization manager's view. The same coherent component
can show different operations because the backend surface distinguishes
identity, scope and actor authority.

## Verification

Test ordinary/delegated/global admin actors, global suspension versus one-org
suspension, security gate transitions, stale pending authority, owner protection,
retained-history deletion and safe profile projections. Directory search/filters
must not hide role-scope distinctions.

## Related Guides And Next Steps

- [Configuration](./configuration.md) controls registration, properties, email and MFA policy.
- [Control plane](./control-plane.md) separates app administrators from ordinary members.
- [Tenant administration](./tenant-administration.md) manages one membership.
- [Email verification](./email-verification.md), [password lifecycle](./password-recovery.md) and [MFA](./mfa.md) own security ceremonies.
