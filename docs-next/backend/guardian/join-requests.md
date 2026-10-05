---
id: zero.guardian.join-requests
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: applicant-submission-and-review
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

# Review Requests To Join An Organization

[Guardian index](./index.md) · [Documentation index](../../index.md)

Join requests let an identified applicant ask to enter an ordinary organization.
A request is a retained review item, not immediate membership authority.
Approval chooses bounded roles under the reviewer's live grant ceiling.

## Configure And Submit

Join requests are enabled by default in multi mode:

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  tenancy: {
    mode: 'multi',
    onboarding: { joinRequests: { enabled: true } },
  },
});
```

`POST /auth/tenant-join-requests` takes `tenantSlug` and optional
`continuation`. The applicant must present an admitted full session or
supported identity continuation. The slug selects an organization to validate;
it is not permission to inspect its database or members.

Submission returns HTTP 202. Show a pending-review state rather than treating
it as accepted app access. The dedicated request-admission flow limits
pre-session submission work.

## Reviewer Surface

The current organization reviewer uses:

| Endpoint | Contract |
| --- | --- |
| `GET /auth/tenant/join-requests` | Bounded limit/cursor and pending/approved/denied/cancelled status. |
| `POST /auth/tenant/join-requests/:joinRequestId/approve` | Required positive `expectedRequestRevision`, optional `roles` and `reactivateMembership`. |
| `POST /auth/tenant/join-requests/:joinRequestId/deny` | Required `expectedRequestRevision`. |

These require `tenant.join-requests:review`, a live selected organization
and the appropriate grantability at commit. Role selection cannot assign
protected owner/system roles or exceed the actor's permissions. List
projections include what can currently be approved; use that context in the UI.

Revision checks prevent a stale review panel from overwriting a decision made
elsewhere. On conflict, reload and show the current decision; do not
automatically approve a freshly changed request.

`reactivateMembership` is an explicit request to reactivate a retained
eligible membership. Approval is not an implicit bypass around removed/
suspended state or owner protections.

## Domains And Administration

[Verified-domain onboarding](./verified-domains.md) can create a proof-bound
request with a configured fixed role, but it still uses review admission.
“Has a company email suffix” alone does not create membership.

This ordinary request-to-join feature is for customer organizations.
Administration invitations/member additions are deliberate privileged control
plane ceremonies; do not expose an “ask to become platform admin” shortcut
through a customer request UI.

## After Approval

The applicant must complete an admitted organization selection/login lifecycle
to receive the appropriate session. Re-read live membership authority.
Do not reuse a pre-approval scope or attach a local tenant ID to a previous
unbound credential.

If the reviewer loses role authority while a decision is pending, the service
must reject the stale commit. Approval/rejection and role generation effects
belong to Guardian's domain service, not an optimistic client table update.

## Verification

Test submission without identity proof, unknown/unavailable slug, duplicate
requests, approval/denial races, stale revision, grant ceiling, explicit
reactivation and denied-retry policy for domain-origin requests. Verify the
applicant receives no application rows before accepted membership/session
completion.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Tenancy](./tenancy.md) completes organization selection after admission.
- [RBAC](./rbac.md) constrains roles assigned during review.
- [Verified domains](./verified-domains.md) adds company-domain/mailbox proofs.
- [Tenant administration](./tenant-administration.md) manages the resulting membership.
