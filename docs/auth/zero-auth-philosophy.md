# Zero Auth Philosophy

> Status: authoritative product and security direction
>
> Implementation status: this unreleased tree implements the `single/simple`,
> `single/advanced`, `multi/simple`, and `multi/advanced` profiles, including
> tenant-bound sessions, registered-resource and managed-service isolation,
> scoped role assignments, invitations/join requests, control-plane clients,
> and packaged UI. Omitted values remain `single/simple`. Installation
> bootstrap transactionally provisions the first application owner in
> `single/advanced`, or the protected Administration Organization, its owner,
> a tenant-bound session, and platform administrator in `multi`.
> Opt-in verified-company-domain request admission and the bounded append-only
> authorization/control-plane audit are implemented in this candidate. The
> protected Administration Organization, its SDK/hooks/UI, and the bounded
> customer-tenant directory/lifecycle/member control plane are implemented.
> Break-glass support,
> tenant-custom roles, broader populated-app discovery/migration tooling beyond
> exact pre-024 administration reconciliation, domain
> autojoin/aliases/direct transfer, and upstream enterprise SSO remain separate
> future capabilities. Shared-file runtime replicas now receive durable Sync
> changes and auth/session invalidations, and resource field allow-lists are
> enforced across every managed transport. Multi-mode startup now validates actual non-partial
> tenant-leading indexes, tenant-scoped business uniqueness, and composite
> tenant consistency for foreign keys between registered tenant resources. The
> implementation checklist—not
> the presence of a config field—defines when each profile is ready to release.
>
> Last reviewed: 2026-10-01

This document defines the stable principles that new Zero authentication and authorization
work must preserve. It is intentionally smaller than the
[working design](./multi-tenant-sso-rbac-working-design.md), which remains the audit record
and source of detailed rationale. Delivery is tracked in the
[implementation checklist](./multi-tenant-auth-implementation-checklist.md).

## Product promise

Zero should make the secure path the easy path. An application can keep the
compact single-tenant authentication model, add fine-grained authorization
without adding tenants, add tenant isolation with a simple role model, or
enable both. Those choices extend one auth system; they do not select unrelated
stacks.

For framework-managed routes, resources, Sync, services, and clients, identity and scope
must be resolved once, enforced consistently, and fail closed. Application authors declare
what an operation requires. They should not have to remember tenant filters, rebuild token
refresh, or reproduce authorization in every transport.

## Non-negotiable principles

1. **Extend the current system.** Keep the global user, credential, account-gate, MFA,
   refresh, page-session, and native-client lifecycle that already works. Do not create a
   second identity table or a parallel tenant-auth stack.
2. **Separate identity from authority.** A user is one global identity. A membership grants
   access to one tenant. A role or permission is evaluated inside a server-validated
   authorization scope.
3. **Keep capability axes independent.** Tenancy is `single` or `multi`; authorization is
   `simple` or `advanced`. Authentication being disabled remains a separate existing state.
4. **Preserve compatibility deliberately.** Existing auth configuration normalizes to
   `single/simple`. Existing global `role`, `admin`, `auth: 'admin'`, `adminOnly()`, and
   `requireAdmin()` meanings never become tenant-scoped. They preserve a legacy
   global-administrator boundary, not the application-permission authority projected by
   an advanced role or Administration Organization membership; neither implies the other.
5. **Make the server authoritative.** A header, URL slug, host, email suffix, JWT claim, or
   UI selection may identify a candidate; none grants tenant authority. Authority comes
   from live server state and a validated session binding.
6. **Treat tenancy as an isolation boundary.** Tenant scope is mandatory and sits outside
   discretionary role, permission, ownership, and custom policy. No `anyOf`, owner rule, or
   custom callback may reopen another tenant's rows.
7. **Enforce one policy across official surfaces.** HTTP, Elysia and Zero routes, file APIs,
   SSR, generated CRUD, `/api/data`, Sync, Storage, rooms, notifications, workflows,
   background work, and installed clients consume the same authorization kernel.
8. **Keep policy declarative and typed.** Zero compiles route, resource, plugin, and page
   declarations into one access vocabulary. Parent requirements may be strengthened but
   not accidentally weakened.
9. **Use request-scoped services.** Normal handlers receive services already bound to the
   validated authorization scope. They do not pass a tenant ID as proof. Unrestricted SQL,
   database, filesystem, or raw-plugin access is an explicit trusted-code escape hatch.
10. **Resolve live security state.** Signed token claims identify the intended session;
    current account, session, membership, tenant, role, permission, and generation state
    decide whether it is still valid.
11. **Make scope changes atomic.** A tenant switch replaces the durable session binding,
    invalidates old credentials, restarts Sync, purges old-scope client state, and discards
    late results from the previous authorization epoch.
12. **Separate registration from admission.** Creating a global identity, creating a
    tenant, and joining a tenant are different configurable decisions. Enabling one never
    silently enables the others.
13. **Use domains only for safer onboarding.** Control of `company.com` and control of an
    `@company.com` mailbox are separate proofs. A matching suffix may support discovery,
    request-to-join, or an explicitly enabled least-privilege auto-join; it is never ongoing
    authorization.
14. **Keep SSO tenant-bound.** Upstream enterprise identity is keyed by issuer and subject,
    not email alone. Authentication through tenant A's provider cannot grant entry to
    tenant B. Upstream SSO remains distinct from Zero's native OIDC provider role for
    desktop, mobile, and extension clients.
15. **Separate administrative planes.** Platform administration, tenant administration,
    and application permissions are different authorities. Platform support access to
    tenant data is explicit, narrow, short-lived, and audited.
16. **Let static configuration set the ceiling.** The application declares permissions,
    role templates, join methods, automatic-assignment limits, and available features.
    Runtime tenant configuration may disable or narrow them, never widen them.
17. **Fail early and visibly.** Invalid roles, unknown permissions, unsafe properties,
    unclassified managed tables, contradictory realms or exposure/loading declarations,
    and incomplete SSO recovery stop multi-tenant startup. Doctor reports the same stable
    diagnostics for local and CI use.
18. **Audit security transitions durably.** Membership, role, domain, SSO, recovery,
    elevation, session, and policy changes produce append-only, properly scoped events.
19. **Do not overclaim the boundary.** Zero can guarantee its managed transports and scoped
    service APIs. Server code that deliberately uses an unsafe raw capability remains
    trusted application code outside that guarantee.
20. **Bootstrap the installation, not just a user.** Setup is operator-controlled,
    one-time, and durable. In multi mode its single transaction creates the initial
    organization, owner membership, active tenant context, and platform administrator;
    public registration can never win those authorities.

## Capability model

The two auth axes normalize once during startup and are immutable for the app runtime.

| Profile | Intended use | Authority model | Default control surface |
| --- | --- | --- | --- |
| `single/simple` | Current Zero applications | Existing live global role and trusted properties | Existing account and platform-user controls |
| `single/advanced` | One app with finer capabilities | Application-scope role assignments and declared permissions | Application role/permission controls; no tenant chooser |
| `multi/simple` | Isolated organizations with coarse roles | Active membership with one app-configured role | Tenant switcher, members, invitations, coarse roles |
| `multi/advanced` | Full organization product | Active membership, multiple role assignments, live permissions | Full tenant control center and policy-aware controls |

Defaults and compatibility rules:

- `auth: false` or omitted auth keeps the existing auth-disabled behavior.
- `auth: true` and existing auth objects normalize to `single/simple`.
- Omitted `auth.bootstrap` means secret-gated setup with no secret configured,
  so a fresh authenticated app remains closed until the operator supplies one.
- Omitting `auth.tenancy` means `single`; omitting `auth.authorization` means `simple`.
- `simple` and `advanced` use one evaluator. Simple mode constrains assignment and hides
  permission-management complexity; it is not a weaker enforcement implementation.
- Tenant-only declarations fail startup in `single`. Permission declarations fail startup
  in `simple` unless an explicit supported compatibility mapping exists.
- Moving from `single` to `multi` requires an explicit data and membership adoption plan.
  A configuration toggle never guesses tenant ownership.
- The installed profile is durable, versioned, and generation-fenced. Exact
  restarts do not churn authority. A populated app may move from simple to
  advanced only through the profile-specific adoption ceremony below;
  reverse and tenancy-axis reinterpretation fail closed.
- The resolved static authorization registry has a separate monotonic
  `registryVersion` and durable semantic fingerprint. Same-profile permission
  or role semantic changes require an explicit version bump; presentation-only
  label/description changes do not. Same-version drift, version rollback, or
  corrupt durable state fails startup before new authority is published. A
  framework-owned evaluator-version marker also makes authorization-engine
  semantic changes participate in this fence.

Normal evolution is additive:

```text
single/simple -> single/advanced
       |              |
       v              v
 multi/simple  -> multi/advanced
```

Moving right is profile-specific rather than a generic role copy. For
`single/simple -> single/advanced`, global `users.role` remains the legacy
global-administrator boundary and is not projected as application-permission
authority. An existing installation names one exact
application owner through `ownerAdoption`; every other identity remains
unassigned until that owner grants access. For
`multi/simple -> multi/advanced`, Zero validates and transactionally adopts the
role key of every retained active or suspended membership into advanced
assignment history, excludes removed memberships, preserves current live
session families by rebinding their membership generation, and clears
incomplete native grants. A missing or retired role aborts the entire upgrade.

Migration `023` records `_auth_installed_profile` before these modes can be
reinterpreted. A legacy multi/simple operator should first deploy this version
without changing modes, let the normal restart record the marker, and enable
advanced authorization in a second rollout. Unmarked tenant data with no
assignment history is accepted as multi/simple only when that is the requested
profile. A direct one-step legacy upgrade to multi/advanced requires the narrow
`authorization.legacySimpleRoleAdoption: true` assertion after an operator has
verified the database's provenance. Pending registration provisioning blocks a
profile change until the installed profile finishes or recovers it. The marker,
adopted assignments, authority/session generations, shared authority revision,
and system-provenance audit event are one SQLite transaction.

Migration `027` persists `_auth_authorization_manifest`. A supported
installed-profile transition acknowledges only its tenancy/authorization-axis
change at the current version when permission, role, and evaluator semantics
are otherwise identical. If that rollout also changes permission keys/scopes,
role keys/permissions/`allPermissions`/system semantics, or evaluator
semantics, operators must increment `auth.authorization.registryVersion`.
Registry initialization and updates are durably system-audited. Existing
runtimes reject the changed shared authority revision with
`AUTH_PROFILE_CHANGED` until restarted. A
reintroduced role key cannot reclaim retained live assignments: startup uses
`AUTHORIZATION_ROLE_REACTIVATION_BLOCKED` until those assignments are removed
or replaced while the role remains retired, after which the role can be
deployed and granted deliberately.

## Authority model

The stable domain concepts are:

- **Identity:** one global `users` record and its credentials, MFA, account state, and
  security generation.
- **Tenant:** an immutable isolation identifier plus mutable product-facing name/slug and a
  tenant authorization generation.
- **Membership:** the retained relationship between one identity and one tenant, including
  status, role assignment, and membership authorization generation.
- **Authorization scope:** the application scope in `single`, or the active
  tenant/membership scope in `multi`.
- **Platform role:** the existing global `users.role`; it remains global.
- **Application role:** an app-defined role expanded inside the current authorization
  scope. Product copy may call it a tenant role in `multi`.
- **Permission:** an app- or framework-declared capability key such as `patients:read`.
- **Resource policy:** the record-level rule applied after authentication, scope, and
  capability checks.

An authorization decision follows this order:

1. validate the global account and durable session;
2. resolve the current application authorization scope;
3. in `multi`, validate the active tenant and membership;
4. evaluate required application role or permission;
5. apply ownership, resource, and request-specific policy;
6. apply the mandatory realm predicate to the actual read or write.

Platform admin never satisfies step 3 merely by being platform admin. Tenant owner/admin
never satisfies a platform-admin check.

## Sessions and tenant switching

Every completed application session has a durable parent identified by `sid`. Browser
refresh tokens, page sessions, native refresh families, and access tokens resolve through
that parent. In `multi`, it records one active tenant and membership, their generations,
and authentication provenance.

A tenant hint can guide login, but the server must verify the exact membership before
binding it. Zero memberships bind automatically when only one valid choice exists; multiple
memberships use a typed selection continuation. Switching creates or rebinds a replacement
session and invalidates the old session generation. It is never a client-only header or
state update.

Every client result is associated with an authorization epoch. Switching pauses scoped
mutations, closes old Sync/presence subscriptions, clears synchronized rows and other
tenant state, installs the replacement session, reconnects, and only then presents the new
scope. Late old-epoch responses are discarded.

## Declarative framework integration

One per-app `AuthRuntime` owns lifecycle and services. One `AuthorizationKernel` resolves
and evaluates authority. One named Elysia request plugin parses credentials and live-
hydrates the request, while typed macros and Zero's endpoint/router/middleware compiler
apply the normalized access requirement before handlers.

The same evaluator is used by file routes and pages, resources, generated data APIs, Sync,
and built-in plugins. Domain services remain plain services rather than accepting Elysia
contexts. Handler services close over a validated execution context. Background work uses
an explicit sealed execution context or an intentionally privileged, audited system
context—never a bare tenant ID or ambient process state.

Elysia and the Zero extension DSL remain the integration mechanisms. The upgrade should
strengthen those seams, not introduce a competing middleware framework.

## Data and transport boundary

The table-security model keeps five independent properties:

1. realm: global or tenant-scoped for app resources (service-owned identity
   scope remains a separate framework boundary);
2. managed client exposure: `internal`, `http`, `sync`, or `all`;
3. Sync loading strategy: full, lazy, or auto;
4. action and discretionary row policy;
5. managed-client field read/create/update/filter/sort allow-lists.

Applications should author that security declaration next to the table, but in
a server-only resource module. Shared `defineTable()`/`schema()` definitions
remain safe inputs for browser validation and generated UI; they are not an
authorization boundary and must not carry executable policy or secrets. The
current candidate implements those boundaries through typed or string-based,
server-only `defineResource()` declarations and one immutable registry.
`exposure` independently allows neither managed transport (`internal`), HTTP
resource/data only (`http`), Sync only (`sync`), or both (`all`). Omission
retains legacy `all` behavior only in single mode; multi mode requires an
explicit choice. Full/lazy/auto still controls loading after Sync is allowed,
never authorization. A sync-only resource is rejected if its configuration can
require lazy `/api/data` hydration. The client may receive only a sanitized,
server-evaluated action-capability projection for UI affordances; executable
policy, realm, and exposure stay server-side and the server always re-enforces.

Registered resources now implement that field boundary with immutable,
opt-in `fields.read/create/update/filter/sort` allow-lists. Once declared,
`read` is required, client writes default to none, and filter/sort default to
the readable set. Zero applies the same contract to managed CRUD, `/api/data`,
Sync snapshot/catch-up/live/ack delivery, lazy/full caches, packaged forms, and
cache-backed exports. Complete rows remain server-only inputs to realm and row
policy evaluation before output projection. Direct SQL, unregistered tables,
custom endpoints, and application-owned exports remain trusted code and must
apply their own field rules; hiding a generated form field alone is never data
protection.

Every independently queried or synchronized tenant-owned row carries a direct trusted
tenant discriminator. Creates are server-stamped. Reads and mutations include the tenant
predicate in the database operation. Client filters may narrow the server predicate but
can never widen it. Multi-mode startup validates tenant-leading non-partial
indexes, tenant-aware business uniqueness, and tenant-consistent composite
parent/child foreign keys for registered tenant resources. Unregistered tables
and deliberate raw SQL remain outside that managed schema guarantee.

Sync authenticates against the same durable session and live authorization revisions. Its
snapshot, catch-up, live delivery, mutations, state, presence, and mutation receipts all
obey the active scope. A changed membership, tenant, policy fingerprint, or elevation
closes and resets the connection. File-mode runtimes sharing a relevant SQLite
plane also share that plane's transactional change sequence/log. Migration `020`
adds a monotonic auth-authority revision so a security change committed by one
runtime promptly revalidates sockets and managed ephemeral bindings in the
others. A retention gap closes affected sockets for a clean snapshot rather
than silently skipping data.

That mechanism is intentionally topology-specific: it does not replicate
`hot` or `ephemeral` runtime databases, independently coordinated SQLite files,
application-owned caches, cross-host messages, or RAM-only ephemeral/presence
topic values. Fabric's actor-owned files remain inside one app coordinator and
root; deployments beyond that boundary need explicit external coordination, and raw
SQL writes remain responsible for participating in the tracked managed change
path when realtime fanout is required.

## Onboarding philosophy

Zero treats these as separate policies:

- unsolicited identity registration;
- invitation-bound identity creation;
- verified-domain identity creation;
- SSO JIT identity creation;
- tenant creation;
- tenant admission.

Invitation acceptance is token-bound, email-bound, short-lived, one-time, and transactional.
Domain onboarding requires both a currently verified exact domain claim and fresh eligible
mailbox-proof provenance. Matching is canonical and exact. The implemented first version
does not infer or separately accept aliases, wildcard coverage, or child domains.
Shared email providers, public suffixes, conflicting claims, and ambiguous coverage fail
closed.

After a tenant is created, Zero may offer to claim the creator's work-email domain, but the
mailbox alone does not prove control of the company domain. The tenant proves that control
with DNS TXT (or a separately trusted connection-specific enterprise proof), and each
coworker still proves their own mailbox before Zero reveals or applies an admission option.

The implemented domain mode is request-to-join only. Before mailbox proof,
discovery does not reveal whether a private tenant exists. A future auto-join
design would require explicit application and tenant opt-in, a fixed
non-system least-privilege role, and the same SSO and proof rules; it is not a
current capability. Background DNS reverification and the bounded
`verified` → `grace` → `lost` claim lifecycle are implemented. Losing proof
stops new domain admission, but never silently deletes existing memberships.

## SSO philosophy

Zero first establishes tenant isolation and membership, then adds upstream enterprise OIDC
as a focused auth plugin. OIDC uses Authorization Code plus PKCE, state, nonce, strict
issuer/audience/redirect checks, encrypted write-only secrets, and stable issuer/subject
linking. A successful callback enters the same account-gate, completion, session, and
membership machinery as local authentication.

SSO enforcement requires a tested connection and a recovery path. Authentication
provenance remains on the session so a tenant-owned provider cannot become global proof.
SAML, SCIM, group mappings, and tenant-custom roles are later breadth, not prerequisites
for the first safe OIDC release.

## Administration and packaged experience

Zero's product model keeps three visibly separate control surfaces:

- current-user account and membership management;
- tenant membership, invitations, domains, roles, and audit controls; and
- platform identity, recovery, and control-plane operations.

The current candidate packages global identity management, single/advanced
application access, active-tenant member/onboarding/domain/audit controls,
current-user continuation and switching UI, protected Administration
Organization people/invitations, and a bounded customer-tenant
directory/lifecycle/member console. Cross-workspace membership operations are
explicit application permissions and do not grant customer application-data
access. Tenant SSO controls remain future work.

Tenant controls operate on the active server-validated tenant rather than trusting an
arbitrary tenant ID from the browser. Tenant administrators cannot reset global passwords,
change global email/MFA, suspend global identities, or delete accounts. Platform operators
do not silently inherit tenant data access.

In multi mode, team-managed platform administration is one protected,
server-created Administration Organization that reuses the ordinary
role-assignment, invitation, grant-ceiling, revision, ownership, and audit
machinery. It is a distinct platform scope—not a discoverable customer
tenant—and its administration-only roles may grant explicit
`application.*` permissions without granting customer data access. This avoids
a second RBAC system and does not expose the single/advanced
`/auth/application` API in multi mode.

The bootstrap organization has `kind: 'administration'`; later ordinary
organizations have `kind: 'organization'`. The administration kind is excluded
from the customer directory and lifecycle targets, domain admission, and every
customer data realm. Its final owner cannot be deleted or converted; only the
exact still-pending bootstrap receipt may compensate a failed creation. The
browser never supplies its tenant ID to platform routes: authority comes from
the live active administration membership. See
[Platform Administration Organization](./platform-administration.md) for the
exact permission, SDK, hook, route, and packaged-control contracts.

Packaged React organisms may be self-wired or controlled and live behind narrow exports.
Applications own their routes, layout, terminology, and branding. Tauri/mobile and Chrome
clients consume the same headless continuation and authorization contract with credentials
owned by Rust/native secure storage or the extension service worker—not by presentation
code.

## Migration and release discipline

Schema changes land additively. Existing identities are not duplicated, and legacy
`emailVerifiedAt` values are not promoted into strong mailbox proof. Existing application
rows receive tenant scope only through an explicit, validated adoption migration with
backups and a controlled session cutover.

No capability is considered shipped because types, UI, or tables exist. It ships only when
the server enforcement path, all relevant transports, revocation behavior, migration path,
Doctor checks, compatibility fixtures, and adversarial tests are complete. The
[implementation checklist](./multi-tenant-auth-implementation-checklist.md) is the release
gate.

Authorization-registry deployments are migrations of authority even when no
application table changes. Review the semantic diff, increment
`registryVersion`, coordinate runtimes, and retain the system audit record. A
rollback must use a new higher registry version with intentionally restored
semantics; lowering the installed version is rejected.
