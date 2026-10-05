---
id: zero.guardian.identity-projection
type: architecture
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: local-identity-anchors-and-realm-readiness
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

# Give Application Records Real Identity Foreign Keys

[Guardian index](./index.md) · [Documentation index](../../index.md)

Canonical accounts, credentials, sessions, roles and memberships live in the
system database. Application records live in the app database or a Fabric
tenant database. Since SQLite foreign keys cannot cross those files, Guardian
projects small local identity anchors into the plane that needs them.

An anchor proves referential existence. It never proves authentication,
membership status, permission or current account profile.

## Declare A User Or Membership Reference

```ts
import { defineTable, field } from '@zero/framework/schema';

export const notes = defineTable('notes', {
  author_id: field.guardianUser(),
  author_membership_id: field.guardianMembership({ required: false }),
  body: field.text({ required: true }),
});
```

Membership references require multi tenancy; a user reference works in single
or multi mode. Both require Guardian enabled. The exact schema/options,
nullable development correction and FK admission are owned by
[Schema's Guardian-reference guide](../schema/guardian-references.md).

Reference builders carry immutable metadata as well as SQL FK declarations.
Serializing table definitions through JSON strips symbol metadata and is not
a supported declaration transport.

A hidden author field is not authorization. Derive it from the admitted server
actor or validate the app's resource/domain write rule before committing.

## What Is Mirrored

| Local anchor | Fields |
| --- | --- |
| `users` | `user_id` only. |
| `tenant_memberships` | `membership_id`, `tenant_id`, `user_id`. |

No passwords, email, profile names, account status, permissions, session tokens
or MFA state are copied. Membership anchors imply user anchors because they
depend on that local user reference.

Read full account/profile information through the admitted Guardian/server
surface where appropriate; do not expand the local anchor into another auth
database. Raw multi-mode system services remain privileged.

## Where Projection Applies

Managed composition discovers reference requirements and partitions them by
physical table placement. The application plane receives anchors required by
its tables. Fabric tenant planes receive the relevant user/membership anchors
needed for their own references, not a full canonical identity dump.

The same mechanism works for declared named database targets. Custom adapters
must honor the public projection target contract and durable receipt ordering.
Selecting a target is trusted server work; an untrusted path or arbitrary tenant
ID is not an anchor-admission capability.

## Durable Delivery And Commit Barrier

Guardian coordinates identity lifecycle with a durable system-plane outbox.
Each target has ordered sequences, leases, retry state and receipts.
`IdentityProjectionService.ensureAnchor()` waits for the target's durable apply;
`ensureAnchorSync()` is the in-process synchronous barrier.

An application write that needs a new user/membership FK must not run ahead of
its anchor. Actor-backed Fabric targets use awaited asynchronous reconciliation;
process-pinned targets can reconcile without yielding past the request/startup
barrier.

Target application is idempotent only for the same event, sequence and anchor
fingerprint. Conflicting replay or installation/target mismatch is not silently
accepted. A target can enter quarantined state; it must not be advertised as
ready or assigned fabricated anchor rows to hide the conflict.

Public advanced integration types are available from `@zero/framework/auth`:
`IdentityProjectionService`, `IdentityAnchorStore`,
`IdentityProjectionTarget`, `SynchronousIdentityProjectionTarget`,
`IdentityAnchor` and receipt/state types. Managed app users normally let
composition provide them instead of constructing parallel projection workers.

## Readiness API

A full authenticated session may inspect its derived data realm:

- `GET /auth/data-realm/readiness`
- `POST /auth/data-realm/readiness/retry`

Neither accepts tenant, target, file or database selectors. The adapter resolves
the realm from live Guardian authority and receives the request AbortSignal.
Responses are private/no-store and conform to the readiness snapshot contract.

A retryable unavailable projection/DB maps to `DATA_REALM_NOT_READY` (503);
nonretryable availability maps to `DATA_REALM_UNAVAILABLE` (503).
An invalid adapter snapshot is `DATA_REALM_READINESS_INVALID` (500).
Show provisioning/retry information without opening unready application data.

## Revocation Is Still Canonical

An anchor remains useful for historical ownership even after a membership is
removed or the account is suspended. Its presence is not a reason to keep that
user's API/sync permission. Guardian's current account and role/membership
generations determine live authority independently.

This preserves app-data referential integrity without forcing authentication
tables into the developer's main app database. It also prevents shallow mirror
rows from becoming a stale permission cache.

## Verification

In an isolated app, create a canonical user/member, verify its anchor reaches
only required planes, insert a real owned record through admitted services and
prove missing/incorrect FKs fail. Hold projection delivery and confirm the
dependent write cannot report accepted success before the barrier.

Test restart/replay receipts, wrong target/installation, out-of-order delivery,
quarantine and revocation. Verify profile changes remain canonical rather
than turning into mirrored authentication data.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Schema identity references](../schema/guardian-references.md) is the authoritative field contract.
- [Data planes](../runtime/data-planes.md) explains application/system/named/Fabric handles.
- [Request services](../runtime/server-services.md) prevents unscoped system reads.
- [Tenancy](./tenancy.md) establishes the admitted membership scope.
