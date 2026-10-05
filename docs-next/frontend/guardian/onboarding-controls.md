---
id: zero.frontend.guardian.onboarding-controls
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: organization-entry-and-domain-controls
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

# Organization Creation, Invitations And Join Controls

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

Import the packaged components from `@zero/framework/components/auth`.
Choose [server onboarding policy](../../backend/guardian/configuration.md)
first. A returned request acknowledgment is not membership, and a proved
company email is not permission to choose an arbitrary database.

## TenantSelectionForm And TenantCreationForm

`TenantSelectionFormProps` requires a tenant-selection completion result;
optional props are `terminology: { singular, plural }`,
`onSuccess(session)`, `onBack` and `className`.
It renders allowed server-projected choices with keyboard radio navigation,
then exchanges the exact continuation/tenant ID for a tenant-bound session.
It does not list other people's organizations.

`TenantCreationFormProps` has `continuation?`, `onSuccess?`, `onBack?`,
`className?`. Omit the continuation only when the existing browser refresh
family proves the eligible creator. The form asks name/optional slug and
delegates `createTenant`. Completion survives the expected old-subtree unmount
during valid scope replacement; local pending/error state is mount-guarded.
Server creation mode/ownership/quota/readiness stay authoritative.

```tsx
import { TenantCreationForm, TenantJoinRequestForm } from '@zero/framework/components/auth';

export function OrganizationEntry({ slug }: { slug: string }) {
  return (
    <>
      <TenantCreationForm />
      <TenantJoinRequestForm tenantSlug={slug} />
    </>
  );
}
```

Choose which entry methods your app displays; the sample is composition, not a
suggestion to expose every operation under every policy.

## TenantInvitationForm

`TenantInvitationFormProps` requires the exact `zinv_...` token from an
app-owned landing route. Optional: `continuation`, `signInHref`,
`onBeforeSignIn(): boolean | void`, `onSuccess(result)`, `className`.

It inspects the invitation, supports the invitation-bound exact-email account
creation/acceptance ceremony, and routes MFA/other completion continuations
without treating the token as a session. A changed token/continuation resets
the local flow. An omitted sign-in URL returns to the local invitation page.
A host-owned secret handoff may run before sign-in; false or a throw prevents
navigation.

The app owns invitation-token navigation/storage hygiene. Do not expose it to
analytics, logs, unrelated referrers or broadly readable persisted state.
Read [invitation lifecycle](../../backend/guardian/invitations.md).

## TenantJoinRequestForm

Props: required `tenantSlug`; optional pre-session `continuation`,
`signInHref`, `onSubmitted`, `className`.
The form requires a completed session or server-issued onboarding proof,
checks public policy and submits a non-enumerating request. Success wording is
intentionally the same when the target is unavailable. The callback means
“request submitted,” not “membership granted.”
See [join-request review](../../backend/guardian/join-requests.md).

## TenantOnboardingManagement

Props: `className`, `pageSize` (50, bounded1–100), `title`, `description`.
This is active-tenant invitation/join-request review with policy/capability-aware
sections, role choices, pending lists, revocation and approval/denial.
Administration terminology adapts to its protected scope. Public-policy and
protected-read failures are distinct and retry independently.
It can compose domain management when that feature is enabled.

The full panel is optional: for a compact invite affordance inside a people
control plane use `useTenantInvitationAction`.

## useTenantInvitationAction

Options: `label?`, `pageSize?`,
`onInvitationIssued?(result: AuthTenantIssueInvitationResult)`.
Result: `secondaryPrimaryAction: RecordPrimaryAction | undefined`,
`dialog: ReactNode`, `canInvite`, `canViewPendingInvitations`.

Render both the action and its dialog through your existing control plane.
Capabilities determine whether issuing/pending-view access is available.
Manual tokens are one-time sensitive UI state, cleared when closed or scope
changes. The callback receives only current-scope accepted results.
The hook delegates to [onboarding administration](./management-hooks.md);
it does not add an independent transport/policy layer.

## DomainOnboarding And useDomainOnboarding

`DomainOnboardingProps`: `identityContinuation?`, `className?`,
`title?`, `description?`, `onSubmitted(result)?`.
Disabled verified-domain policy renders null; unavailable public policy shows
its loading/error state. The flow proves the canonical current email before
disclosing a matching organization, then submits request-to-join.

`useDomainOnboarding({ enabled?, identityContinuation? })`, from
`@zero/framework/react/hooks`, returns `status`, `completion`,
`admission`, `error`; `start(): Promise<void>`,
`complete(proofToken): Promise<AuthDomainOnboardingCompletion>`,
`admit(): Promise<AuthDomainOnboardingAdmissionResult>`, `reset()`.
Reset retires local flow state, not a server's retained request.
Identity/tenant/continuation changes retire old results.

## TenantDomainManagement And useTenantDomainAdministration

`TenantDomainManagementProps`: `className?`, `title?`, `description?`.
The active-tenant control handles exact-domain claims, DNS challenge presentation/
copy, verification, request-role policy and confirmed release. It is not wildcard
domain discovery or auto-membership/SSO.

`useTenantDomainAdministration({ enabled? })` returns
`administration`, readonly `claims`, `challenge/challengeClaimId`,
`isLoading/isMutating/error`, `reload`, `dismissChallenge`.
Methods: `createClaim(domain)`, `issueChallenge(claimId)`,
`verifyClaim(claimId)`,
`updatePolicy(claimId, { enabled, requestRoleKey })`,
`releaseClaim(claimId, confirmDomain)`.
The hook applies current revision/target checks through SDK operations and
aborts superseded reads. Release returns the retained release result; a domain
is not immediately available for another organization.
The backend [verified-domain guide](../../backend/guardian/verified-domains.md)
owns cooldown, DNS/mailbox proof and grant bounds.

## Verification And Related Guides

Test each configured entry mode, exact email/token mismatch, stale proof,
revoked invitation, denied review authority and role-above-grant-ceiling.
An invitation acceptance and organization switch must not leak prior tenant
lists/details/manual tokens.

- [Management hooks](./management-hooks.md) explain independently retried review slices.
- [Native UI](./native-ui.md) preserves browser authorization through entry flows.
- [Tenant administration](../../backend/guardian/tenant-administration.md) owns member/owner invariants.
