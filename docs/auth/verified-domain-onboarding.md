# Verified Company-Domain Onboarding

> Status: supported end to end in Zero 2.0. The server
> routes, SQLite migration/runtime schema, bounded DNS verification worker,
> durable mailbox delivery, browser SDK/hooks, and packaged UI share the
> contract below. The capability is opt-in and is advertised only when its
> email and public-URL dependencies are operational.
>
> Last reviewed: 2026-09-28

This is the deliberately small first version of company-domain onboarding. A
tenant proves control of one exact DNS domain. A user proves control of the
primary email already bound to their Zero identity. The server may then retain
a request to join that tenant for administrator review.

It does not auto-join users, create identities from domains, accept a tenant or
role choice from the browser, match aliases or child domains, transfer claims,
or use SSO claims. Those are separate designs and must not be inferred from
this API. An owner-authorized release lifecycle is included so a mistaken or
retired claim never requires database surgery. In particular, ordinary public
registration or an invitation must create the identity first. Enabling this
feature does not make domain-bound registration available when registration is
disabled.

## Security boundary

The server remains authoritative for every consequential decision:

- The active tenant comes from the live Bearer session. Tenant administration
  routes never accept `tenantId` in a path, query, or body.
- `/start` derives the authenticated user's current primary email, or consumes
  a purpose-bound pre-session identity continuation. It never accepts an email
  supplied by the browser.
- Domain normalization, exact-domain matching, eligibility, policy lookup,
  request-role selection, membership checks, and duplicate-request checks run
  on the server. Browser code performs no suffix matching.
- `/complete` discloses a safe tenant option only after current mailbox proof.
  Its continuation is opaque, short-lived, purpose-bound, and does not create
  a login session.
- `/admit` accepts only that continuation and, when applicable, the same
  pre-session identity continuation. It never accepts a tenant, domain, or
  role. The server revalidates all bound state before retaining a request.
- Actor capability flags and safe request-role choices are presentation hints.
  The server re-authorizes each read and mutation.
- Claim and policy revisions are optimistic-concurrency tokens. The hooks use
  the revision from the current server projection; applications must not
  synthesize one.
- Release requires the owner-default `tenant.domains:release` permission, the
  current claim and policy revisions, and an exact case-sensitive copy of the
  normalized domain. It never accepts a replacement tenant or transfer target.

Before mailbox proof, both a successful and ineligible `/start` look exactly
the same: `{ accepted: true }`. UI must use generic language and must not reveal
whether a domain, tenant, or onboarding policy exists. After request admission,
an expected invalid/expired continuation or ineligible identity remains silent.
Unexpected identity-service, runtime-readiness, and mailbox-queue failures keep
the same public response and emit `AUTH_DOMAIN_START_FAILED` through the owning
app's private event `error` channel; the cause is never copied into the response
or event metadata.

## Configuration and public capability

Enable the feature only in multi-tenant mode:

```ts
auth: {
  tenancy: {
    mode: 'multi',
    onboarding: {
      joinRequests: { enabled: true },
      verifiedDomains: {
        enabled: true,
        allowedRequestRoles: ['member'],
        defaultRequestRole: 'member',
      },
    },
  },
}
```

Every allowed role must be declared in the active authorization profile,
assignable to a customer organization, and bounded/non-system. `owner`,
administration-only or application-scope roles, `allPermissions` roles, system
roles, and undeclared roles fail configuration resolution. These invariants are
validated even while verified-domain onboarding is disabled, so enabling the
feature later cannot activate a dormant invalid policy. The role is fixed in
the tenant policy; neither the applicant nor `/admit` can override it.

The remaining controls have conservative defaults:

| Setting | Default | Purpose |
|---|---:|---|
| `challengeTTL` | `24h` | Lifetime of one DNS challenge |
| `dnsCheckCooldown` | `30s` | Minimum interval between authoritative checks |
| `dnsTimeout` | `5s` | Resolver wall-clock limit; maximum `60s` |
| `maxTxtAnswers` / `maxTxtBytes` | `32` / `8192` | Bound resolver output |
| `reverifyInterval` | `7d` | DNS lease interval |
| `gracePeriod` | `3d` | Admission grace after a lease becomes stale |
| `reverifyRetryInterval` | `1h` | Retry after resolver unavailability or mismatch |
| `mailboxLinkTTL` / `mailboxProofMaxAge` | `30m` / `30m` | Mailbox evidence limits |
| `admissionTTL` | `10m` | Proof-bound admission continuation lifetime |
| `deniedRetryCooldown` | `7d` | Re-entry delay after reviewer denial |
| `maxClaimsPerTenant` | `20` | Transactionally enforced retained-claim limit |

`mailboxLandingPath` defaults to `/domain-onboarding`.
`sharedMailboxDomains` adds exact consumer/shared domains to the built-in
deny-list. `resolveTxt` is a server-only resolver seam for private DNS or tests;
it receives only Zero's derived `_zero-domain-verification.<domain>` hostname
and remains subject to the same timeout, answer-count, and byte bounds.

The server advertises only the safe, narrow capability through
`GET /auth/config`:

```ts
config.tenancy?.onboarding?.verifiedDomains
// { enabled: true, admission: 'request-to-join' }
```

Absence means unavailable. It is omitted unless tenancy is multi, the feature
and join requests are enabled, email delivery is ready, and a public app URL is
configured. Doctor reports enabled-but-inoperable email/public-URL combinations
as errors. The field does not expose claimed domains, tenants, role keys,
matching results, resolver configuration, or DNS state. `DomainOnboarding` and
`TenantDomainManagement` fail closed while configuration is absent or loading.

## Browser routes and DTOs

These contracts are browser-owned DTOs. They intentionally do not import
server services, database records, or token persistence types.

### Active-tenant administration

All routes require Bearer authentication. The active tenant is derived from
that session.

| Method | Route | Request | Safe response |
|---|---|---|---|
| `GET` | `/auth/tenant/domains` | none | `AuthTenantDomainAdministration` |
| `POST` | `/auth/tenant/domains` | `{ domain }` | claim plus one-time DNS challenge |
| `POST` | `/auth/tenant/domains/:claimId/challenges` | `{ expectedRevision }` | updated claim plus one-time DNS challenge |
| `POST` | `/auth/tenant/domains/:claimId/verify` | `{ expectedRevision }` | updated claim |
| `PATCH` | `/auth/tenant/domains/:claimId/policy` | `{ enabled, requestRoleKey, expectedRevision }` | updated claim |
| `POST` | `/auth/tenant/domains/:claimId/release` | `{ expectedRevision, expectedPolicyRevision, confirmDomain }` | immutable release receipt |

The list projection contains:

```ts
interface AuthTenantDomainAdministration {
  actor: {
    capabilities: {
      canReadDomains: boolean;
      canCreateDomains: boolean;
      canVerifyDomains: boolean;
      canManagePolicy: boolean;
      canReleaseDomains: boolean;
    };
  };
  requestRoles: ReadonlyArray<{
    key: string;
    label: string;
    description?: string;
  }>;
  claims: readonly AuthTenantDomainClaim[];
}

interface AuthTenantDomainClaim {
  claimId: string;
  domain: string;
  status: 'pending' | 'verified' | 'grace' | 'lost';
  proofMethod: 'dns-txt';
  verifiedAt: number | null;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  validUntil: number | null;
  challengeExpiresAt: number | null;
  revision: string;
  createdAt: number;
  updatedAt: number;
  policy: {
    enabled: boolean;
    admission: 'request-to-join';
    requestRoleKey: string | null;
    revision: string;
  };
}
```

Release returns only the released claim identity and fixed lifecycle times:

```ts
interface AuthTenantDomainReleaseResult {
  release: {
    claimId: string;
    domain: string;
    releasedAt: number;
    quarantineUntil: number;
  };
}
```

The route requires both opaque revisions and `confirmDomain` equal to the
server's normalized domain byte for byte. A mismatch returns
`AUTH_DOMAIN_RELEASE_CONFIRMATION_MISMATCH`; stale claim or policy state returns
the corresponding revision conflict. Released claims disappear from the
active list but remain private durable history.

Challenge issue/rotation is the only response allowed to contain plaintext DNS
material:

```ts
{
  claim: AuthTenantDomainClaim;
  challenge: {
    recordType: 'TXT';
    name: string;
    value: string;
    expiresAt: number;
  };
}
```

The server must persist a verifier/digest, not the plaintext value. List,
verify, and policy responses must never re-expose it. The React hook keeps the
one returned challenge only in component memory and clears it on dismissal,
reload, identity replacement, tenant switch, or transition instability.

### User onboarding

These routes use optional authenticated transport: the SDK adds Bearer
authority when a session exists, but the pre-session path can use an opaque
identity continuation produced by the shared identity flow.

| Method | Route | Request | Safe response |
|---|---|---|---|
| `POST` | `/auth/onboarding/domain/start` | `{ identityContinuation?: string }` | always `{ accepted: true }` |
| `POST` | `/auth/onboarding/domain/complete` | `{ proofToken }` | server-derived option, and only when actionable an opaque continuation |
| `POST` | `/auth/onboarding/domain/admit` | `{ continuation, identityContinuation?: string }` | retained pending join request |

After proof, completion is one of:

```ts
type AuthDomainOnboardingCompletion =
  | {
      option: {
        action: 'request-to-join';
        tenant: { name: string; slug: string };
      };
      continuation: string;
      expiresAt: number;
    }
  | {
      option: {
        action: 'request-pending';
        tenant: { name: string; slug: string };
        request: {
          joinRequestId: string;
          status: 'pending';
          createdAt: number;
        };
      };
    }
  | { option: { action: 'unavailable' } };
```

There is deliberately no tenant ID, domain choice, requested role, automatic
membership, or token/session result in this union.

## SDK and hooks

The same methods exist on `Client` and `AuthClient`:

```ts
await client.getTenantDomainAdministration();
await client.createTenantDomainClaim('your-company.com');
await client.issueTenantDomainChallenge(claimId, claimRevision);
await client.verifyTenantDomainClaim(claimId, claimRevision);
await client.updateTenantDomainPolicy(claimId, {
  enabled: true,
  requestRoleKey: 'member',
  expectedRevision: policyRevision,
});
await client.releaseTenantDomainClaim(claimId, {
  expectedRevision: claimRevision,
  expectedPolicyRevision: policyRevision,
  confirmDomain: 'your-company.com',
});

await client.startDomainOnboarding(identityContinuation);
const completed = await client.completeDomainOnboarding(proofToken);
if (completed.option.action === 'request-to-join') {
  await client.admitDomainOnboarding(
    completed.continuation,
    identityContinuation,
  );
}
```

Prefer the hooks for React screens:

```tsx
const domains = useTenantDomainAdministration();
await domains.createClaim('your-company.com');
await domains.verifyClaim(claimId);
await domains.updatePolicy(claimId, {
  enabled: true,
  requestRoleKey: 'member',
});
await domains.releaseClaim(claimId, 'your-company.com');

const onboarding = useDomainOnboarding({ identityContinuation });
await onboarding.start();
const option = await onboarding.complete(proofToken);
if (option.option.action === 'request-to-join') {
  await onboarding.admit();
}
```

The administration hook injects loaded claim/policy revisions automatically,
including both revisions required for release, and removes a released claim
from active state only after the server commits it.
Both hooks key state by authenticated identity, active tenant, and stable
session transition; the user flow additionally keys by the pre-session
identity continuation. Old results are masked immediately and late loads or
mutations cannot land after account replacement, tenant switch, continuation
replacement, or a preparing/reconciling transition.

## Packaged UI

```tsx
import {
  DomainOnboarding,
  TenantDomainManagement,
  TenantOnboardingManagement,
} from '@zero/framework/components/auth';

// User-facing mailbox proof and request flow. There is no email input.
<DomainOnboarding identityContinuation={identityContinuation} />

// Active-tenant DNS and request-policy administration.
<TenantDomainManagement />

// Existing invitation/join-request panel composes domain administration when
// the public capability is present.
<TenantOnboardingManagement />
```

The components provide loading, denied, empty, mutation, error, and accessible
live-status states. Clipboard rejection is surfaced locally. DNS plaintext is
labelled as one-time material. When release is authorized,
`TenantDomainManagement` presents an explicit destructive warning and keeps
the confirmation action disabled until the exact normalized domain is typed.
Default copy follows configured tenant terminology; caller-supplied titles and
descriptions still win. Neither component decides authorization, domain
eligibility, or role authority.

## Domain and DNS rules

Claims are exact normalized ASCII A-label domains. Zero rejects Unicode input
instead of silently converting it, along with IP literals, single-label names,
public suffixes, reserved names, shared mailbox domains, `example.com`,
`example.net`, `example.org`, and their children. A claim for `company.com`
does not match `child.company.com` or an alias.

Registrable-domain classification uses the vendored official Public Suffix
List with both ICANN and PRIVATE sections. The source URL, upstream version and
commit, SHA-256, and MPL-2.0 license are pinned beside the list. Run
`bun run auth:psl:update` to fetch and atomically validate a new official copy;
the updater refuses missing license/version/section metadata, and tests verify
the pinned hash plus wildcard, exception, and private-suffix behavior.

The only plaintext DNS secret is returned by claim creation or challenge
rotation. SQLite stores its digest. Verification leases the claim before a
bounded TXT lookup. An authoritative missing or mismatched record records a
proof failure; timeout, SERVFAIL, malformed/bounds-exceeding responses, and
other resolver failures release the lease and return
`AUTH_DOMAIN_DNS_UNAVAILABLE` without consuming the claim revision, challenge
rotation cooldown, or normal mismatch transition. The background worker uses
the same lease and schedules an unavailable lookup for retry. The resolver
wrapper retains the original lookup failure as its internal `cause`, and the
app-local DNS/worker event receives that failure through its private `error`
channel. Public Auth responses remain generic, and bounded event metadata does
not contain resolver/provider text.

A successful proof is rechecked after `reverifyInterval`. A later mismatch
moves a claim through `grace` and then `lost`; only a currently verified or
in-grace claim with an enabled policy can produce an admission option. Policy
or claim revision changes invalidate already-issued admission continuations.

## Mailbox proof, delivery, and replay safety

The dedicated mailbox link is separate from login and from an administrator
marking an address verified. Ordinary user-driven email-link verification may
mint the same explicit mailbox-evidence record, but admin overrides and tenant
invitation acceptance never do. Evidence is bound to application, user,
canonical primary email, email generation, auth generation, and (for a
pre-session flow) the exact identity continuation.

Outbox retries use an attempt-specific provider idempotency key. Because a
provider can accept a message and lose its response, retries retain a bounded
set of digest-only sibling tokens instead of replacing the first link. Any one
valid sibling atomically consumes all siblings. A consumed sibling suppresses
later delivery attempts. Raw mailbox and admission tokens are never persisted.

Admission rechecks the current identity, email/auth generations, proof age,
claim and policy revisions, tenant state, fixed configured role, existing
membership, invitation, retained join request, denial cooldown, and explicit
admission block in one transaction. A denied, suspended, removed, or otherwise
retained subject cannot replay mailbox proof to silently re-enter. Reviewer
approval uses the existing tenant role-grant ceiling and records domain
membership provenance.

Claim creation, challenge issuance, policy update, claim release, manual DNS
verification, mailbox proof, retained join request, and background
reverification success/failure events are registered on the outermost
ReactiveDB commit. A surrounding transaction rollback therefore persists
neither the state transition nor a misleading success event. Post-commit
notification failure cannot turn an already committed verification into a
false request failure. A stale reverification lease that finalizes no row emits
no result event and does not count as processed work.

Expired/consumed mailbox tokens, proofs, and admission transactions are
deleted in bounded startup/worker batches. Join-request and membership
provenance are retained; their optional evidence reference is cleared when the
short-lived proof expires. Per-tenant retained claim count and per-delivery live
token count are hard-bounded.

## Release, quarantine, and historical evidence

Claim release is a retirement operation, not a transfer and not a delete. In
one SQLite transaction Zero:

- disables the request policy and clears its role;
- clears DNS challenge/verifier material and any active worker lease;
- consumes every outstanding admission transaction for the claim;
- cancels every still-pending domain-derived join request, records the
  reviewing actor, advances its request revision, and binds the operational
  block to that exact cancelled revision through quarantine;
- marks the claim released with actor/time metadata and a seven-day
  `quarantineUntil`; and
- appends `tenant.domain-claim-released` to the durable control-plane audit.

The claim row and its domain/join/membership provenance remain durable. Before
cancelling a pending request, release copies its domain provenance into an
immutable release snapshot, including the exact request revision and source.
The retained operational provenance can therefore
point at a fresh claim after the cooldown without rewriting what the release
actually cancelled. Schema triggers protect the released claim, snapshot, and
released-claim membership provenance. Short-lived mailbox proof references may
still be nulled by the normal evidence-retention lifecycle, and tenant/account
lifecycle FKs keep their documented behavior. Claim/policy actor attribution
uses `SET NULL`, so attribution alone never strands account deletion. A
releaser recorded as the reviewer of a cancelled pending join request has
retained tenant history; normal deletion returns `USER_HAS_TENANT_HISTORY` and
the operator must suspend that identity instead of receiving a raw SQLite
failure.

The tenant that released a domain may create a fresh claim immediately, but it
gets a new claim ID and one-time DNS challenge; no prior DNS proof, policy, or
admission continuation carries forward. Every other tenant receives the same
generic `AUTH_DOMAIN_UNAVAILABLE` response until the fixed seven-day
quarantine expires. At expiry, competing claim attempts are serialized by a
database-wide one-active-claim unique index, so exactly one can win.

Generic join submission does not bypass this lifecycle. During the denial
cooldown or release quarantine it keeps the retained terminal request closed
while preserving the public non-enumerating accepted response. At expiry it
may create a new generic request revision, whose role is the ordinary
server-owned default; the old domain-fixed role and membership provenance do
not carry into that revision.

Released rows count toward `maxClaimsPerTenant`. This is intentional: release
cannot become an unbounded private-history write primitive. An installation
that exhausts the retained-history ceiling needs an explicit operator data
retention decision rather than silently deleting security evidence.

## Permissions and operations

The packaged `manager` role includes `tenant.domains:read`,
`tenant.domains:verify`, `tenant.onboarding:manage`, and join-request review.
It deliberately does not include `tenant.domains:release`. Packaged owners have
that permission through their protected `allPermissions` role; an advanced
application may delegate it only by explicitly placing the framework-owned
permission on a custom role. Domain claim transfer and automatic admission
remain unsupported; verified-domain onboarding never grants either.

Operational events use stable `auth.domain.*` observability codes for claim,
challenge, verification/reverification, resolver unavailability, policy,
mailbox delivery/proof, retained join requests, and unexpected worker errors.
Migration `017_verified_domain_onboarding` is append-only and mirrors runtime
schema setup. Guarded migration `019_verified_domain_release` transactionally
rebuilds the claim graph to replace the original global unique constraint with
one-active-claim uniqueness; file-backed production migration requires the
migrator's verified backup. Additive migration
`021_verified_domain_request_provenance` marks existing operational/release
evidence `legacy-unbound` and adds the exact source/request-revision fence; it
never guesses that old evidence belongs to a currently reviewable revision.
Schema parity/idempotency and full graph
preservation are tested alongside DNS failure recovery, ambiguous email
delivery, evidence cleanup, claim limits, fixed-role admission, release/replay
and multi-connection competition, provenance, public capability, Elysia routes,
and the browser contract.

## Deliberate first-version exclusions

- no automatic membership;
- no identity creation based only on a matching domain, including when public
  registration is disabled;
- no alias, wildcard, or parent/child-domain matching;
- no claim transfer workflow (release and quarantine are supported);
- no trusted upstream SSO-domain shortcut; and
- no Administration Organization coupling: protected administration tenants
  cannot own domain claims or participate in join-request/domain admission.

Use public registration for the simple coworker flow: after the identity is
created, a user with no active membership receives the tenant-onboarding
continuation and the packaged `AuthFlowContinuation` offers company-domain
request onboarding (alongside tenant creation when allowed). If registration
is disabled, use an invitation or another explicit identity-provisioning flow;
the domain feature alone cannot create that account.
