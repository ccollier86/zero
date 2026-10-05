---
id: zero.guardian.user-properties
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: metadata-defaults-and-trusted-properties
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

# Declare User Properties And Their Trust

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian user properties are app-specific metadata on canonical accounts.
Declare their types, defaults, editor and policy trust independently. A field
being visible in an account editor does not make its value trustworthy for
authorization.

## Declare Fields

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  strictUserProperties: true,
  userProperties: {
    department: {
      type: 'enum',
      label: 'Department',
      values: ['operations', 'engineering'],
      default: 'operations',
      editableBy: 'admin',
      useInPolicies: true,
    },
    darkMode: {
      type: 'boolean',
      default: false,
      editableBy: 'user',
    },
  },
});
```

Supported types are `string`, `enum`, `boolean` and `number`. Enum requires
a nonempty `values` array. If type is omitted, values imply enum, a Boolean or
numeric default implies that type, and otherwise the type is string.

`editableBy` is `user` (default), `admin`, `system` or `none`.
`useInPolicies` defaults false and may only be true for admin/system/none
editors. A user-editable “isPaid” or “isAdmin” property must not become a
trusted authorization gate simply because its name sounds important.

Defaults are stored using Guardian's canonical string property representation.
The declaration's Boolean/number type drives validation and typed consumption;
raw property routes do not promise arbitrary JSON objects or arrays.

## Current-User API

These routes require a full live session:

| Endpoint | Result |
| --- | --- |
| `GET /auth/me/properties` | `{ properties }` |
| `GET /auth/me/properties/:key` | `{ key, value }`, or `PROPERTY_NOT_FOUND` (404) |
| `PUT /auth/me/properties/:key` with `{ value }` | Validates a user write, stores it, returns `{ ok: true }`. |
| `DELETE /auth/me/properties/:key` | Validates deletion policy and returns `{ ok: true }`. |

Read responses are private/no-store. PUT accepts bounded unknown input before
type normalization; it is not a loophole for writing undeclared structured
policy data. `strictUserProperties: true` rejects unknown property keys;
the default false preserves loose-key behavior without granting policy trust.

Administrator writes pass through the same declaration but use the admin
editor policy. Admin cannot silently write a system-only or immutable field
by copying it into the profile PATCH.

## Defaults And Existing Accounts

Creation applies configured defaults; login and current-user projection apply
missing defaults for existing accounts. A default fills an absent value,
not a replacement for a user/operator's existing selection.

Changing a trusted property changes effective authorization. Administrative
property changes that alter policy authority invalidate the prior security
boundary; applications must handle the resulting auth/scope transition instead
of retaining a cached “allowed” Boolean.

## Use In Policies

Declare the trusted field first, then reference it through Guardian's structured
access requirements or resource policies. The authorization compiler rejects
untrusted-property requirements rather than treating arbitrary metadata as
a permission. Read [authorization](./authorization.md) before combining
properties with roles and permissions.

Properties do not replace tenant membership, role assignments, account status
or billing-domain records. A user can belong to multiple organizations while
the account's properties remain canonical account data.

## Avatars Are App-Owned

There is no dedicated Guardian avatar-storage/management feature in the
inspected auth exports. If your application needs avatars, compose its storage
service with an app-owned reference or declared profile property and the
appropriate resource policy. Do not invent an `auth.setAvatar()` SDK method
or copy credentials/profile rows into each tenant database.

## Verification And Errors

Test every editor category, enum rejection, numeric/Boolean normalization,
unknown-key strictness, default fill without overwrite and trusted-property
revocation. Rejected writes emit `AUTH_USER_PROPERTY_REJECTED` through standard
observability with bounded field metadata; avoid logging submitted values.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Authorization](./authorization.md) combines trusted properties with scoped requirements.
- [Control plane](./control-plane.md) describes administrator profile actions.
- [Identity projection](./identity-projection.md) explains why local FK mirrors contain no profile metadata.
