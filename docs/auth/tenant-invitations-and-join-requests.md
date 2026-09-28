# Tenant Invitations and Join Requests

> Status: implemented in this unreleased candidate
>
> Last reviewed: 2026-09-28

Zero's multi-tenant onboarding layer admits a proven identity to an existing
organization without widening ordinary public registration. It provides two
explicit paths:

- An authorized tenant member issues an exact-email, bounded-role invitation.
- An authenticated identity submits a retained join request for an authorized
  reviewer to approve or deny.

Both paths use the existing auth completion, tenant-session, authorization,
email-outbox, and request-admission boundaries. They are available only when
`auth.tenancy.mode` is `multi`.

## Configuration

Manual delivery is the headless default. It returns a copyable invitation token
exactly once to the authorized issuer and requires no email provider:

```ts
auth: {
  tenancy: {
    mode: 'multi',
    onboarding: {
      invitations: {
        enabled: true,
        defaultTTL: '7d',
        maxTTL: '30d',
        accountCreation: true,
        delivery: {
          default: 'manual',
          allowManual: true,
        },
      },
      joinRequests: { enabled: true },
    },
  },
}
```

`defaultTTL` cannot exceed `maxTTL`; neither may exceed 90 days. An issuer can
request a shorter `expiresIn` duration, but cannot exceed the configured
ceiling. `accountCreation: false` requires invitees to authenticate an existing
exact-email account.

Email delivery uses Zero's durable auth outbox, the configured app identity,
and an operator-held key-encryption key (KEK):

```ts
auth: {
  tenancy: {
    mode: 'multi',
    onboarding: {
      invitations: {
        delivery: {
          default: 'email',
          allowManual: true,
          email: {
            enabled: true,
            landingPath: '/accept-invitation',
            encryptionKey: Bun.env.AUTH_TENANT_INVITATION_ENCRYPTION_KEY,
            previousEncryptionKeys: parsePreviousKeys(
              Bun.env.AUTH_TENANT_INVITATION_PREVIOUS_ENCRYPTION_KEYS,
            ),
            template: (context) => ({
              subject: `Join ${context.tenant.name}`,
              text: context.defaultText,
              html: context.defaultHtml,
            }),
          },
        },
      },
    },
  },
}
```

Email delivery also requires a ready Zero email provider and
`app.publicUrl`. `landingPath` must be a local absolute path beginning with one
slash; origins, protocol-relative paths, query strings, fragments, whitespace,
and paths longer than 200 characters are rejected at startup.

The public `GET /auth/config` response exposes only whether invitations,
account creation, manual delivery, email delivery, and join requests are
available. It never exposes the landing path, template, KEK, prior keys,
envelope keyring, invitation hash, or raw token.

## Generate and Protect the Email KEK

The email KEK is a canonical, unpadded base64url encoding of exactly 32 random
bytes. Generate it with a cryptographically secure source:

```sh
bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
```

Store the result in the deployment's secret manager, not in source control or
the SQLite database:

```txt
AUTH_TENANT_INVITATION_ENCRYPTION_KEY=<secret-manager value>
```

Zero rejects malformed encodings and common placeholder/repetition mistakes,
including all-zero, all-same, and low-unique-byte values. That validation is a
deployment-error defense; no program can prove that a supplied key was
generated with adequate entropy.

The database stores random data-encryption keys only after AES-256-GCM wrapping
under this external KEK. Invitation outbox ciphertext uses its own AES-256-GCM
envelope and AAD bound to the outbox job, invitation, and canonical recipient.
A database snapshot alone therefore cannot decrypt queued invitation tokens.
Conversely, a restorable backup containing queued invitations requires both
the database and the correct external KEK.

Never print, log, document, or return the configured KEK. Losing every usable
KEK makes the persisted envelope keyring intentionally unrecoverable. Zero
fails startup instead of generating a replacement and silently stranding live
queued invitations.

### Rotate the operator KEK

Use a two-deployment rotation:

1. Generate a new 32-byte base64url key.
2. Configure the new key as `encryptionKey` and the old key as the first entry
   in `previousEncryptionKeys`.
3. Start every new Zero instance. Startup decrypts the persisted data-key ring
   with the explicitly supplied old KEK and atomically rewraps every data key
   under the new KEK.
4. Retire all instances still using the old configuration.
5. On the next deployment, remove the old key from
   `previousEncryptionKeys`.

Example transition:

```ts
email: {
  enabled: true,
  encryptionKey: Bun.env.AUTH_TENANT_INVITATION_ENCRYPTION_KEY_NEW,
  previousEncryptionKeys: [
    Bun.env.AUTH_TENANT_INVITATION_ENCRYPTION_KEY_OLD!,
  ],
}
```

At most three distinct prior KEKs are accepted. Supplying a new active key
without the required prior key fails closed with an actionable startup error.
After successful rewrapping, a restart with only the new key succeeds and a
restart with only the old key fails. The internal `rotateDataKey()` maintenance
primitive rotates the invitation data-encryption key; it does not rotate the
operator KEK.

## Invitation Delivery Lifecycle

Issuance and delivery have one consistent failure model:

1. Zero validates the active tenant, caller permissions, role grant ceiling,
   exact canonical email, TTL, delivery mode, email readiness, and public URL.
2. It creates a random 32-byte `zinv_...` bearer. The invitation row receives
   only its SHA-256 hash.
3. For email delivery, Zero encrypts the bearer in memory and inserts the
   invitation plus outbox job in one SQLite transaction. Queue capacity or
   envelope failure rolls back both rows.
4. The worker decrypts only for the send attempt, then revalidates the live
   immutable invitation hash, tenant, email, status, and expiry.
5. Every retry uses the same provider idempotency key. A lost provider
   acknowledgement therefore does not require a new invite and can be
   deduplicated by the provider.
6. Delivery, suppression, or terminal failure scrubs the encrypted secret and
   recipient from the terminal outbox row. Revocation/expiry before delivery
   suppresses the job. A permanent or retry-exhausted delivery failure also
   revokes the still-pending invitation.

If email delivery is requested while the provider or `app.publicUrl` is
unavailable, the request fails before invitation issuance. Zero never creates
an undiscoverable live invite. An authorized issuer can explicitly select
`delivery: 'manual'` only when `allowManual` is true; the raw token appears in
that single response and is never available from list/detail APIs afterward.

Application templates receive safe tenant/invitation metadata plus
`actionUrl`, `defaultSubject`, `defaultText`, and `defaultHtml`. The action URL
is the only template field containing the bearer token. Templates and email
providers must not log it.

## Identity, MFA, and Account Gates

Invitation possession is tenant admission authority, not identity proof.
Acceptance requires one of:

- a live completed Bearer session for the exact invited email;
- `onboarding.continuation`, returned only after password, email-verification,
  password-change, account-status, and MFA gates complete; or
- invitation-bound creation of the exact invited email when
  `accountCreation` is enabled.

The accept API has no existing-account password mode. Supplying a password by
itself cannot consume an invite or create membership, including for identities
that require MFA.

For invitation-bound account creation, the invite substitutes for ordinary
email verification but does not bypass MFA. When required MFA—or explicitly
requested optional enrollment—is pending, Zero commits only the exact-email
identity. It returns `invitationAcceptancePending: true`, leaves the invitation
pending, and creates no membership. After MFA succeeds, the shared auth
completion returns a ten-minute `onboarding.continuation` even when tenant
creation is disabled. Resubmit the original invitation token with that proof;
Zero atomically consumes both proof and invitation, creates the bounded
membership, and issues the tenant-bound session. A retry can win only once.

Every fully authenticated zero-membership completion now includes:

```ts
{
  tenantOnboardingRequired: true,
  onboarding: {
    reason: 'no_active_tenant_membership',
    continuation: 'zct_...',
    expiresAt: 0,
    tenantCreation: { allowed: false },
  },
}
```

The identity continuation exists independently of tenant-creation policy so it
can be used for an invitation or join request. When creation is allowed,
`tenantCreation.continuation` remains available for compatibility and points to
the same single-use proof. Tenant creation still rechecks its own live policy.

## HTTP Routes

Public/pre-session routes are source- and subject-throttled by Zero's auth
request-admission service:

| Method and route | Proof | Behavior |
| --- | --- | --- |
| `POST /auth/invitations/inspect` | invitation token | Returns a generic unavailable result or safe tenant name/slug, masked email, expiry, and sign-in/create hint |
| `POST /auth/invitations/accept` | completed Bearer, onboarding continuation, or exact-email account creation | Atomically consumes the one-time invite and admits the bounded membership |
| `POST /auth/tenant-join-requests` | completed Bearer or onboarding continuation | Always returns the same accepted shape; a guessed/missing tenant slug is not disclosed |

Active-tenant administration routes derive the tenant exclusively from the
live Bearer session. No route accepts a tenant ID:

| Method and route | Permission | Behavior |
| --- | --- | --- |
| `GET /auth/tenant/invitations` | `tenant.invitations:read` | Cursor-page safe invitation DTOs |
| `POST /auth/tenant/invitations` | `tenant.invitations:manage`; non-default roles also require `tenant.roles:manage` | Issue manual/email invitation within the actor grant ceiling |
| `DELETE /auth/tenant/invitations/:invitationId` | `tenant.invitations:manage` | Idempotently revoke a pending invite |
| `GET /auth/tenant/join-requests` | `tenant.join-requests:review` | Cursor-page reviewer-safe retained requests |
| `POST /auth/tenant/join-requests/:joinRequestId/approve` | `tenant.join-requests:review`; selectable non-default roles also require `tenant.roles:manage` | Requires the loaded `expectedRequestRevision`; atomically approve or explicitly re-admit retained membership |
| `POST /auth/tenant/join-requests/:joinRequestId/deny` | `tenant.join-requests:review` | Requires the loaded `expectedRequestRevision`; atomically deny a pending request |

Opaque IDs are scoped to the Bearer's active tenant. A guessed ID from another
tenant receives the same `404` contract as a missing ID. List DTOs do not expose
token hashes, envelopes, accepted user IDs, issuer internals, reviewer IDs,
credentials, MFA state, global roles, or session metadata.

## Browser SDK

The public client surface mirrors the routes:

```ts
const inspection = await client.inspectTenantInvitation(token);

// A current completed session proves an existing identity.
const accepted = await client.acceptTenantInvitation({ token });

// A zero-membership result can prove identity before a session exists.
await client.acceptTenantInvitation({
  token,
  continuation: result.onboarding.continuation,
});

// Exact-email creation is available only when inspection/account policy says so.
await client.acceptTenantInvitation({
  token,
  email: 'ada@example.com',
  username: 'ada',
  password,
});

await client.submitTenantJoinRequest(
  'acme',
  onboarding.onboarding.continuation,
);
```

An active-tenant administrator can use:

```ts
const issued = await client.issueTenantInvitation({
  email: 'ada@example.com',
  roles: ['member'],
  expiresIn: '3d',
  delivery: 'email',
});

const invitations = await client.listTenantInvitations({
  status: 'pending',
  limit: 50,
});
await client.revokeTenantInvitation(invitations.invitations[0]!.invitationId);

const requests = await client.listTenantJoinRequests({ status: 'pending' });
const request = requests.requests[0]!;
const roleSelection = request.approvalPolicy.roleSelection;
await client.approveTenantJoinRequest(request.joinRequestId, {
  expectedRequestRevision: request.requestRevision,
  // A custom reviewer UI may replace these defaults with a non-empty subset
  // of roleSelection.roles, up to roleSelection.maxRoleCount.
  ...(roleSelection.mode === 'selectable'
    ? { roles: roleSelection.defaultRoleKeys }
    : {}),
  ...(request.reactivationRequired ? { reactivateMembership: true } : {}),
});

await client.denyTenantJoinRequest(request.joinRequestId, {
  expectedRequestRevision: request.requestRevision,
});
```

Do not send `roles` for `fixed` or `default` approval policies—not even the
role shown in the projection. Those modes
keep the assignment on the server so a browser cannot override policy-bound or
ordinary least-privilege access.

The transport uses Zero's shared authenticated fetch/session-completion
boundary. Acceptance that returns tokens updates the normal browser auth state,
page session, Sync scope, and active tenant; applications must not store or
attach tokens themselves.

## Hooks and Packaged UI

`useTenantOnboardingAdministration()` loads active-tenant configuration,
invitations, and join requests according to actor capabilities. It exposes
issue/revoke/approve/deny mutations and never accepts a tenant ID.

Zero packages three accessible components:

```tsx
import {
  TenantInvitationForm,
  TenantJoinRequestForm,
  TenantOnboardingManagement,
} from '@zero/framework/components/auth';

// Public app-owned `/accept-invitation` route.
<TenantInvitationForm token={searchParams.token ?? ''} />

// Public/applicant route after completed auth.
<TenantJoinRequestForm
  tenantSlug="acme"
  continuation={authResult.onboarding.continuation}
/>

// Protected organization settings route.
<TenantOnboardingManagement />
```

`TenantInvitationForm` inspects generically, supports exact-email invited
account creation, composes the packaged MFA continuation UI, and automatically
finishes deferred acceptance with the post-MFA onboarding proof.
`TenantJoinRequestForm` preserves the non-enumerating response contract.
`TenantOnboardingManagement` adapts to delivery capabilities and actor
permissions, shows a manual token only in transient component state, and
provides retained-request re-admission controls. In advanced authorization it
also renders a role picker only when the request's server-projected approval
policy permits reviewer choice. The projection distinguishes:

- `default`: use the ordinary least-privilege admission role without sending a
  browser-selected role (including simple mode);
- `fixed`: preserve a policy-bound assignment, such as a verified-domain
  request role, which the browser cannot override; and
- `selectable`: choose only from the non-system, non-owner roles inside the
  live reviewer's grant ceiling, up to the projected selection limit.

The projection also carries a reviewer-specific `canApprove` result. The
packaged UI leaves denial available but disables approval when the current
reviewer cannot grant the request's required access. This is an ergonomic
projection, not authority: approval re-resolves and revalidates the actor,
policy mode, role registry, grant ceiling, and request provenance at commit.

These are components, not routes. The application owns URL layout and must add
its invitation/sign-in/request pages to `publicPaths` when using
`protected-by-default` page auth.

## Join-Request Retention and Re-admission

There is one retained row per tenant and identity. Repeated submission while
pending is idempotent. A later submission after approval, denial, or
cancellation increments `requestRevision` and reopens the row rather than
erasing reviewer history.

Approval and denial serialize on the live tenant and update only a currently
pending row. Concurrent reviewers cannot both perform different transitions;
every decision must echo the loaded request's integer `requestRevision` as
`expectedRequestRevision`. A reopen or policy/provenance replacement advances
that revision, and a stale reviewer receives
`TENANT_JOIN_REQUEST_REVISION_CONFLICT`. Repeating the already winning same
decision with the same revision is idempotent; a different decision conflicts.

Verified-domain provenance is bound to the exact request revision and source.
A generic submission cannot reopen a denied or release-cancelled domain request
before its denial cooldown or release quarantine expires. Once the block
expires, generic resubmission advances the revision and receives the ordinary
server-owned default policy; old fixed-role provenance cannot carry forward.
Migration `021` marks pre-fence provenance `legacy-unbound` rather than guessing
that it belongs to the current revision. Such a request cannot be approved
until the applicant explicitly resubmits generically or completes a fresh
verified-domain admission.

Invitation issue/revoke and join-request approve/deny also revalidate actor
authority at their commit boundary. After the tenant write lock is acquired,
Zero resolves the original session reference again and recomputes current
permissions and any advanced-role grant ceiling inside the transaction. A
session, membership, assignment revision, role, or trusted-property change
between HTTP authentication and the write returns
`409 AUTHORIZATION_CHANGED` without consuming or mutating the target record.

An active membership makes a request a no-op. A suspended or removed retained
membership sets `reactivationRequired`; approval fails until the reviewer sends
`reactivateMembership: true`. Re-admission increments membership authorization
generation, so captured old browser, page, native, extension, HTTP, and Sync
authority fails its next live validation. An owner membership can never be
created, reassigned, suspended, removed, or re-admitted through onboarding.

## RBAC and Role Safety

Invitation and approval roles are normalized against the live declared role
registry in both simple and advanced authorization modes:

- Simple mode requires exactly one non-system role.
- Advanced mode accepts up to 32 distinct non-system roles.
- `owner` and every system role are always rejected.
- The issuer/reviewer cannot grant a role containing permissions outside its
  own live permission ceiling.
- An actor without all-permissions authority cannot grant an all-permissions
  role.
- Selectable join-request policies expose only labels and role keys inside the
  live reviewer's grant ceiling. Fixed/default policies expose only the
  required/default role's display key and label; an ungrantable fixed role is
  paired with `canApprove: false`. No mode serializes role permissions,
  protected role choices, or a verified-domain request's private provenance.
- Clients omit `roles` for fixed/default approval. The server derives those
  assignments, and fixed policy rejects a conflicting override. Selectable
  approval accepts at most the server-projected `maxRoleCount` and remains
  subject to commit-time revalidation.
- Stored invitation roles are revalidated at acceptance, so removed or newly
  protected role definitions fail closed.

UI filtering is only a convenience; every constraint is repeated at the
Elysia plugin/service boundary and inside the serialized transition.

## Stable Failure Contracts

Applications should branch on `code`, not error text. Important codes include:

| Code | Meaning |
| --- | --- |
| `TENANT_INVITATION_UNAVAILABLE` | Invalid, expired, revoked, used, email-mismatched, or otherwise unusable invite; intentionally generic |
| `TENANT_INVITATION_IDENTITY_PROOF_REQUIRED` | Existing identity must finish login/account gates |
| `TENANT_INVITATION_ACCOUNT_AUTH_REQUIRED` | The exact email already belongs to an account; authenticate it instead of creating another |
| `TENANT_ONBOARDING_PROOF_INVALID` | Continuation expired, was consumed, belongs to another app, or was invalidated by auth generation |
| `TENANT_ONBOARDING_PROOF_AMBIGUOUS` | Both Bearer and continuation were supplied |
| `TENANT_INVITATION_MEMBERSHIP_BLOCKED` | A suspended/removed retained membership prevents silent invitation rejoin |
| `TENANT_JOIN_REACTIVATION_REQUIRED` | Reviewer must explicitly acknowledge retained-membership re-admission |
| `TENANT_JOIN_REQUEST_REVISION_CONFLICT` | The loaded request revision is stale because the request reopened or its server-owned policy/provenance changed; reload before deciding |
| `TENANT_JOIN_REQUEST_STATUS_CONFLICT` | The same revision already reached an incompatible terminal decision |
| `TENANT_JOIN_REQUEST_BLOCKED` | Exact-revision verified-domain provenance is still inside its denial cooldown or release quarantine |
| `TENANT_JOIN_REQUEST_PROVENANCE_UNBOUND` | Pre-`021` domain evidence cannot safely be attributed to the current revision; the applicant must explicitly resubmit or complete fresh verification |
| `AUTH_DOMAIN_REQUEST_ROLE_FIXED` | A client sent `roles` for a verified-domain request whose role is fixed by server policy |
| `TENANT_JOIN_REQUEST_ROLE_SERVER_OWNED` | A client sent `roles` for an ordinary/default request whose role is selected by the server |
| `TENANT_OWNER_ROLE_PROTECTED` | Onboarding attempted to grant protected owner/system authority |
| `TENANT_ROLE_ESCALATION_FORBIDDEN` | Requested role exceeds the acting member's grant ceiling |
| `AUTHORIZATION_CHANGED` | Actor session, scope, roles, or authority-bearing properties changed before the mutation could commit; reload before retrying |
| `TENANT_INVITATION_EMAIL_UNAVAILABLE` | Runtime email/outbox service is unavailable |
| `TENANT_INVITATION_EMAIL_CAPACITY` | Durable queue could not accept the job; issuance was rolled back |

Inspection and join submission intentionally do not distinguish nonexistent,
expired, revoked, or guessed public targets.

## Persistence and Upgrade

Migration `013` creates the invitation/join-request tables, widens the
historical auth-request admission table for the two public tenant-onboarding
flows, and rebuilds the historical auth email outbox to support invitation
envelopes while preserving queued password-reset and email-verification jobs.

Migration `021` adds the verified-domain provenance source/revision fence.
Existing evidence is retained as `legacy-unbound` instead of being assigned to
an unverifiable request revision. It also freezes the binding in release
history; no data is deleted, and explicit generic resubmission advances to a
clean default-policy revision after any applicable cooldown or quarantine.

Migration `022` is the append-only admission-schema convergence point. It
preserves migration `012` as the immutable three-flow historical definition,
retains every existing pseudonymous admission row, recreates the admission
indexes, and makes fresh and upgraded databases accept exactly `bootstrap`,
`registration`, `login`, `invitation`, `join-request`, and
`domain-onboarding`. Current runtime schema creation uses the same six-flow
contract. Tenant-only public onboarding routes are not mounted in single mode,
so they return Zero's stable concealed-route response before admission work.

Before upgrading a durable installation, take a consistent database backup and
retain the external invitation KEK separately. After deployment, test manual
issuance, email issuance/delivery, revocation-before-send, existing-account
MFA acceptance, invited account creation, join request approval/denial,
explicit re-admission, cross-tenant IDs, and tenant switching in the actual
ingress/email environment.
