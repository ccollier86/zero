---
id: zero.guardian.profile-completion
type: how-to
audience: [developer, agent, operator]
owner: guardian
status: in-review
visibility: internal
system: guardian
feature: first-use-profile-completion
maturity: preview
applies_to: ["Adaptive profile working source; release qualification pending"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, native]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "ae85a4b6efe11eeb74ab89b15ed02a23e982c59f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Require A Profile Before Application Access

[Guardian index](./index.md) · [Documentation index](../../index.md)

Required first-use completion is an optional, server-enforced stage of Guardian
authentication. A person proves their identity, completes any mandatory email
and MFA ceremonies, then supplies the required profile fields before Guardian
issues application credentials. A hidden button or application-side redirect
is not the enforcement mechanism.

This page describes unreleased working source, not support already shipped in
the inspected 2.5.0 baseline. It covers required editable profile fields only;
requiring an avatar, contact proof or notification preference is not implemented.

## Configure A Deliberate Rollout

This is an auth-configuration fragment, not a complete application:

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  userProfile: {
    fields: {
      firstName: { enabled: true, editable: true, required: true },
      preferredName: true,
      bio: true,
    },
    completion: {
      enabled: true,
      onSignup: true,
      onInvitation: true,
      existingUsers: 'none',
      ttl: '10m',
    },
  },
});
```

`completion.enabled` defaults to false. `onSignup` and `onInvitation` default to
true, but do nothing while completion or the parent profile feature is disabled.
`existingUsers: 'none'` is the default: enabling the feature does not silently
enroll previously created accounts. Choose `existingUsers: 'onSignIn'` for an
explicit existing-account rollout. Read the complete option table in
[Guardian configuration](./configuration.md#required-first-use-profile-completion).

Each required field must be enabled and editable. The existing
[profile field validation](./user-profiles.md) applies; enabling completion does
not permit disabled fields, trusted properties, account status or roles in the
profile patch. Empty/blank required text and an empty required social-link list
do not satisfy a requirement. A profile already satisfying the current policy
does not require an extra completion screen.

## Authentication Order And Restricted Authority

The normal sequence is:

```text
Identity and required password/email proof
  → required MFA enrollment/challenge
  → required profile completion
  → tenant selection/onboarding when needed
  → full application session
```

Signup and newly created invitation accounts have durable enrollment records.
An invitation retains its exact admitted tenant/membership binding while the
profile is completed. In a multiple-membership sign-in without an explicit
binding, completion precedes the existing tenant chooser; it does not pick an
organization for the user or issue an unbound multi-tenant session.

The auth response at this stage has `user`, `profileCompletionRequired: true`
and a `profileCompletion` value. It has **no access or refresh token**. The
opaque `continuation` is an identity-only, purpose-specific proof, stored as a
hash in private SYSTEM storage. It cannot authenticate ordinary APIs, Sync,
`/auth/me`, own-profile routes or contact operations as a Bearer token.

`UserProfileCompletion` contains:

| Field | Meaning |
| --- | --- |
| `continuation` | Opaque proof, supplied only to the restricted completion endpoints. |
| `expiresAt` | Expiry time in Unix milliseconds. |
| `profile` | Actual `UserProfileSnapshot`, including current revision and field capabilities; null if the profile substrate is blocked. |
| `missingFields` | Required profile-field keys not currently satisfied. |
| `state` | `ready` or `blocked`; blocked is not a fabricated empty profile. |

Previously achieved MFA assurance is retained server-side. A native
registration request continues through its existing validated authorization
request and consent flow after completion; its state, PKCE challenge and nonce
are not replaced by this profile proof. Completion does not grant a native
client additional `profile:write`, contact scopes or application permissions.

## Inspect, Edit And Finish

The restricted HTTP surface is:

| Endpoint | Body | Successful result |
| --- | --- | --- |
| `POST /auth/profile/completion/inspect` | `{ continuation }` | Current `UserProfileCompletion`, without application credentials. |
| `POST /auth/profile/completion` | `{ continuation, expectedRevision, changes }` | The normal auth completion union: full session, tenant selection or tenant onboarding. |

`changes` uses the same typed whitelist as ordinary own-profile editing. The
browser must use the revision in the actual inspected snapshot, not infer it
from its draft. Unknown keys are rejected, including when they accompany valid
fields; transport normalization must not silently make an invalid patch valid.

The frontend SDK's `auth.profileCompletion` namespace provides
`inspect(continuation, signal?)` and `complete(input, signal?)`. It participates
in the existing auth-attempt owner: only a real full-session result installs
application credentials. A tenant continuation remains a restricted auth state.
Both calls bound response headers and JSON-body reads to 30 seconds. A timeout
or caller cancellation does not prove a completion mutation failed to commit:
while the originating scope remains current, its in-memory proof and draft
remain available, no result is accepted optimistically, and no request is
automatically repeated. Authority replacement still retires the old flow.
Explicitly inspect
the latest profile before retrying an ambiguous save. If that one-time proof
was consumed or has expired, begin sign-in again rather than reusing it. Late
response bytes cannot install credentials after the request retired.
Use the [Guardian frontend integration](../../frontend/guardian/profile-settings.md)
instead of copying the proof into a token store or manually inserting headers.
`ProfileCompletionForm` renders and validates only enabled required profile fields,
including an extended field if the application explicitly makes it required.
It narrows a local presentation policy; the original server policy still governs
the request and final session admission. Optional profile and regional settings
remain in the ordinary account-settings form and are not cleared by completion.
Both endpoints return private no-store responses. A successful full completion
also installs the ordinary HttpOnly page-session cookie; tenant-only results
do not leave a previously authenticated page cookie as the new identity.

## Atomicity, Conflicts And Recovery

Profile acceptance is a durable compare-and-swap operation. Final session
admission then rechecks the current account generation, live required policy
and retained binding. Consuming the one-time completion proof and admitting its
resulting session/tenant continuation happen in the same writer transaction.
Concurrent submissions cannot consume the same proof into two refresh families.

Signing is asynchronous and deliberately outside SQLite's synchronous writer.
If signing fails after a profile was accepted, the profile remains saved but the
completion proof is unused. Inspect again and retry with the new revision. Do
not pretend that the earlier patch failed to persist or blindly repeat its old
revision. An enclosing app-controlled SQL transaction cannot start async
completion; the endpoint/service rejects that composition.

Policy fingerprints bind continuations to the current declared requirements.
A newer runtime's installed policy retires stale runtime admissions. Changing
requirements requires a fresh sign-in proof, not continuation reuse against a
different policy. An account which completed an older policy is treated as an
existing account for a later rollout: `existingUsers: 'none'` does not silently
require its newly added fields. Existing active credentials are not mass-revoked
merely by setting the rollout option; browser/native issuers and refresh writers
still refuse to mint new credentials for an eligible incomplete identity.

The separate migration-039 profile generation also fences required-completion
services against stale optional-profile configuration, including A→B→A changes.
It does not change the required-field enrollment fingerprint merely because
contacts or avatars were enabled. Bootstrap commits the optional-profile clock
and completion-policy marker together; constructing a store cannot replace either
policy. A retired required-completion service can return
`AUTH_PROFILE_POLICY_CHANGED` (409); begin a fresh flow through the current runtime.

The durable enrollment and hashed continuation survive reconstruction of their
service owners while unexpired. Runtime retirement prevents an in-flight signer
from later admitting a session. Closed or corrupt retained authority fails
closed, with safe invariant reporting rather than value coercion.

Proof creation uses the existing private auth request-admission engine plus
fixed completion-ledger budgets: at most 10 active proofs per identity, 5,000
active globally and 50,000 retained completion proofs. Expired/consumed proofs
are cleaned during new proof admission. These limits are not app configuration
keys or an unlimited background queue.

## Provision Existing Applications Safely

The fixed SYSTEM profile substrate is migration 039; completion's policy,
enrollment, context and private purpose table are migration 043. The additive
completion migration does not rename the existing tenant continuation table or
redirect verified-domain foreign keys. No profile copy is created in each
Fabric organization database.

Use the normal [migration workflow](../migrations/apply.md). With managed
`migrate: false`, a missing required completion substrate remains unavailable;
Guardian does not perform opportunistic DDL or return fictitious ready values.
An enabled signup requirement cannot be durably enrolled until that substrate
exists, so its registration fails safely rather than creating an ungated account.
A colliding framework-owned schema is not overwritten or marked successfully
migrated. Keep the previous package and runtime backups until the rollout passes.

## Errors And Observability

| Code | Response/action |
| --- | --- |
| `AUTH_PROFILE_VALIDATION_FAILED` / `AUTH_PROFILE_REQUIRED_FIELDS` | 422; fix the displayed field values. |
| `AUTH_PROFILE_REVISION_CONFLICT` | 409; inspect/review the accepted latest profile. |
| `AUTH_PROFILE_COMPLETION_VALIDATION_FAILED` | 422; reject malformed/unknown completion commands. |
| `AUTH_PROFILE_COMPLETION_INVALID` | Invalid, consumed, expired or security-generation-retired proof; sign in again. |
| `AUTH_PROFILE_COMPLETION_CHANGED` | 409; policy changed, so restart sign-in. |
| `AUTH_PROFILE_COMPLETION_CAPACITY` | 429; avoid repeated attempts and retry later. |
| `AUTH_PROFILE_COMPLETION_NOT_READY` | 503; inspect migrations/runtime readiness. |
| `AUTH_PROFILE_COMPLETION_REQUIRED` | Full browser/session issuer or refresh is blocked until requirements are satisfied. |
| `AUTH_STATE_INVARIANT_FAILED` | Retained private state is invalid; inspect safe operational diagnostics. |

Native grant endpoints normalize an incomplete profile into an OAuth
`invalid_grant` response requiring interactive sign-in. Unavailable/stale native
runtime policy is `temporarily_unavailable`; it is not disguised as successful
rotation. Accepted profile and completion events use the standard
`auth.user_profile.updated` and `auth.user_profile.completed` codes only after
commit. Proofs, submitted field values and private contact data are not event
metadata.

Focused synthetic source checks cover signup, invitation binding, MFA/email
ordering, tenant selection, native consent/PKCE, concurrent use, revision and
generation rejection, signing failure, shutdown and numbered migration safety.
These passing source tests are not a claim of installed-package or production
rollout qualification.

## Related Guides And Next Steps

- [Own profiles](./user-profiles.md) defines fields, regional inheritance and shared profile revisions.
- [Guardian configuration](./configuration.md#required-first-use-profile-completion) owns rollout defaults and startup read time.
- [MFA](./mfa.md) and [email verification](./email-verification.md) describe preceding identity ceremonies.
- [Tenant sessions](./tenancy.md) owns the subsequent organization choice and application scope.
- [Native authentication](../native-auth/index.md) owns native request binding and consent ceilings.
- [Profile UI](../../frontend/guardian/profile-settings.md) composes the reusable account/continuation experience.
