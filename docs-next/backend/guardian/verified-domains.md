---
id: zero.guardian.verified-domains
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: dns-and-mailbox-proved-domain-onboarding
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Verify Company Domains For Onboarding

[Guardian index](./index.md) · [Documentation index](../../index.md)

Verified domains connect an ordinary organization to an exact company domain.
Guardian separately proves DNS control, mailbox control and the applicant's
current identity before creating a reviewable join request. A bare
`email.endsWith('@company.com')` check is not this feature.

## Enable The Capability

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  tenancy: {
    mode: 'multi',
    onboarding: {
      verifiedDomains: {
        enabled: true,
        allowedRequestRoles: ['member'],
        defaultRequestRole: 'member',
      },
    },
  },
});
```

Disabled is the default. Admission is `request-to-join`, not unrestricted
automatic membership. Allowed/default request roles are declared, bounded,
non-system customer-assignable roles; default member. Administration/platform
roles cannot be requested through a company-domain policy.

This requires working DNS resolution and mailbox proof delivery. Additional
shared-mailbox domains can be rejected explicitly; a public shared email
provider must not become an organization's claim to all its users.

## Claim And Prove DNS Control

Selected customer-org administration endpoints:

| Endpoint | Required authority / input |
| --- | --- |
| `GET /auth/tenant/domains` | `tenant.domains:read`; returns claims, request roles and capabilities. |
| `POST /auth/tenant/domains` | `tenant.domains:verify`; `{ domain }`. |
| `POST /auth/tenant/domains/:claimId/challenges` | Verify authority; current `expectedRevision`. |
| `POST /auth/tenant/domains/:claimId/verify` | Verify authority; current `expectedRevision`; awaited DNS check. |
| `PATCH /auth/tenant/domains/:claimId/policy` | `tenant.onboarding:manage`; enabled, requestRoleKey (string/null), expectedRevision. |
| `POST /auth/tenant/domains/:claimId/release` | `tenant.domains:release`; expectedRevision, expectedPolicyRevision, confirmDomain. |

Use the server-issued exact TXT hostname/value. Do not let untrusted client
input choose arbitrary resolver targets. DNS proof has expiry, cooldown and
reverification leases; it is not a permanent grant.

Release is a deliberate destructive authority transition requiring confirmation
and policy revision. Ordinary manager verify permission does not imply release.

## Applicant Mailbox And Admission

The three-stage applicant flow is:

1. `POST /auth/onboarding/domain/start` with optional `identityContinuation`
   or an admitted session starts mailbox proof work. The response is uniformly
   `{ accepted: true }` after admission, avoiding a domain/account-existence oracle.
2. `POST /auth/onboarding/domain/complete` with `{ proofToken }` consumes the
   delivered mailbox proof and produces the bounded admission continuation.
3. `POST /auth/onboarding/domain/admit` with `continuation` and, when required,
   `identityContinuation` rechecks the exact identity and domain/policy proof,
   returning HTTP 202 for the resulting request.

Mailbox proof is bound to user, email generation, freshness, application and
domain state. A changed email, released claim or stale admission continuation
must not authorize the old membership request. An invalid explicit bearer
credential cannot be replaced by a different identity continuation to rescue
that request.

The configured request role is fixed by server policy. The applicant cannot
submit owner/administrator or a stronger role as part of the proof.

## Timings And Resolver Bounds

Defaults:

| Setting | Default |
| --- | --- |
| DNS challenge / check cooldown | 24h / 30s |
| Reverify interval / grace / failed reverify retry | 7d / 3d / 1h |
| Mailbox proof freshness / link TTL | 30m / 30m |
| Admission continuation / denied retry cooldown | 10m / 7d |
| DNS timeout | 5s |
| TXT answers / joined TXT bytes | 32 / 8192 |
| Claims per tenant | 20 |

`resolveTxt(hostname)` is an optional trusted server adapter returning arrays
of TXT segments. Output and wall-clock work are bounded by configured limits;
the resolver must not introduce an unbounded external lookup or follow
caller-selected hostnames.

The mailbox landing page is a public app-relative route. The full option
reference includes positive duration bounds and integer ranges.

## Verification And Observation

Test wrong/missing TXT records, resolver rejection/timeout/oversized answers,
cooldowns, expired/reverified leases, exact-domain matching, shared domains,
mailbox replay, email-generation changes, denied retries and authority loss
during DNS work. Admission must create only the intended reviewable request,
not immediate broad access.

Use standard `AUTH_DOMAIN_*` events. Never log proof tokens, raw mailed links
or entire resolver results containing unneeded user data.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Email verification](./email-verification.md) can provide a bounded mailbox proof.
- [Join requests](./join-requests.md) explains reviewer admission.
- [Request admission](./request-admission.md) bounds anonymous/pre-session work.
- [Tenant administration](./tenant-administration.md) manages accepted memberships.
