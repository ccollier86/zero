# Multi-tenant, SSO, and RBAC working design

> Status: temporary architecture audit and proposed design, not a released API contract
>
> Audit date: 2026-09-26
>
> Scope: Zero core authentication, sessions, authorization, Elysia/plugin integration, Sync,
> generated resources, server routes/services, packaged control UI, onboarding, native/
> extension clients, and platform services

> **Historical-state warning:** the audit passages below intentionally preserve
> the pre-implementation evidence and therefore use statements such as “no
> tenant-bound session exists” or “multi must add.” Those are not the current
> runtime contract. The unreleased feature branch now implements all four
> `single|multi` x `simple|advanced` profiles, durable browser and native tenant
> sessions, tenant switching, scoped assignments, registered-resource and
> managed-service isolation, invitations/join requests, and packaged control
> UI. Use [Zero Auth Philosophy](./zero-auth-philosophy.md) for the authoritative
> invariants and the
> [implementation checklist](./multi-tenant-auth-implementation-checklist.md)
> for current delivery status. Opt-in request-only verified-domain admission
> and the bounded append-only authorization/control-plane audit are now
> implemented. A protected Administration Organization/platform-tenant
> lifecycle, break-glass, tenant-custom roles, populated-app adoption tooling, domain
> autojoin/aliases/direct transfer, and upstream enterprise SSO remain separate
> future work. Shared-file replicas now use durable Sync fanout and migration
> `020` auth/session invalidation; separate-database/cross-host coordination and
> the RAM-only ephemeral topic bus remain outside that mechanism. Explicit
> server-owned resource client exposure and immutable field allow-lists are now
> implemented. Multi-mode startup now validates actual non-partial
> tenant-leading indexes, tenant-scoped business uniqueness, and composite
> tenant consistency for foreign keys between registered tenant resources.

## Executive decision

Zero has a strong single-tenant authentication foundation. Its current account lifecycle,
live user rehydration, security-generation invalidation, rotating refresh tokens, page
sessions, MFA gates, native OIDC flow, and resource-policy integration are all useful
building blocks. It should be extended rather than replaced.

At the time of the original audit, Zero was not a safely multi-tenant
authorization system. A user had one global `role`; administrative queries
operated across every user; request and Sync auth contexts did not carry a
tenant; and several platform services interpreted a role, owner, or
authenticated user globally. User properties could not safely close this gap.

The recommended upgrade is:

1. Keep `users` as the global human identity and account-security record.
2. Add explicit tenants and many-to-many tenant memberships.
3. Separate the existing platform role from application-scope roles and permissions.
4. Bind an active tenant and membership to sessions after server-side validation.
5. Add one table-security registry (realm, client exposure, and mutation policy) which all
   HTTP, generated CRUD, data query, Sync, and
   platform-service paths must obey.
6. Add permission-based authorization as an optional mode on top of the same live
   authorization scope; keep today's simple role checks as the compatibility default.
7. Separate identity registration, tenant creation, and joining a tenant into distinct,
   configurable onboarding policies.
8. Add upstream enterprise OIDC after the tenant and membership boundary exists. Add
   SAML and SCIM in later phases.
9. Normalize configuration into two independent choices: `single` or `multi` tenancy and
   `simple` or `advanced` authorization. Default to `single` plus `simple`, preserving current
   behavior and existing application contracts.

The key design rule is that tenant isolation must be a platform invariant across every
framework-managed transport and service. It cannot be a convention that each application
route is expected to remember. Server code deliberately using an unrestricted SQL/database
handle is trusted application code outside that guarantee and must be made conspicuously
explicit.

## Phase-0 audit finding and remediation status

The original audit found an authorization exposure independent of future tenancy. The
following bullets describe the **pre-hardening baseline**, not the current feature-branch
behavior:

- `createApp()` put `users`, notifications, rooms, workflows, and storage tables in the
  platform **write**-protected set, but did not read-protect them.
- the default Sync read policy allowed non-internal tables;
- the resource-to-Sync policy treated unmanaged tables as readable;
- notifications, rooms, and workflows were included in the full-snapshot allow-list;
- storage metadata was configured as lazy rather than full-snapshot, but remained eligible for
  a malicious catch-up/live subscription under the same broad table-read decision;
- a requested readable table could also receive catch-up and live changes even when it was not
  in the full-snapshot allow-list.

At that baseline, an authenticated raw Sync client could request unscoped framework rows. In
particular, `users` is not in the snapshot set but is still eligible for catch-up/live
subscription; notifications, rooms, and workflows can be eligible for complete snapshots;
and storage metadata can be eligible for catch-up/live delivery. Client UI conventions do
not mitigate a raw protocol client.

Related HTTP authorization gaps also existed at the baseline: a logged-in user could fetch a notification
by guessed ID without target validation; room detail/member reads only require login and
joining is open; and workflow listing, detail, event, and control routes are instance-global
for any authenticated user.

The baseline audit also found a property-policy trust mismatch. Resource `metadataPolicy()` validates
that a configured property opted into policy use and is not user-editable, but backend
middleware `matcher.properties` reads raw properties without the same validation. Unknown
properties are user-writable by default when `strictUserProperties` is false. Storage
property grants likewise accept arbitrary property keys and later treat a match as access.
An application that protects a route or storage drive with an unknown or user-editable
property can therefore let a user satisfy that policy themselves.

At the original baseline, ephemeral Sync topics were a broad boundary: the
caller supplied the topic for subscribe/write, delete did not enforce key
ownership or an operation permission, and the in-process topic store was
global. Managed topics now have server-owned namespaces and operation policy;
raw caller-defined topic families still must not treat a prefix as authority.

The former public first-user bootstrap was also an unsafe activation boundary.
Current `single` mode defaults to a secret-gated, durable, one-time installation
ceremony; public first-request compatibility is explicit and Doctor-warned, and
public config no longer exposes the exact user count. Current `multi` mode uses
that seam to create the initial organization, owner membership, active tenant
session, and platform administrator. Source-aware admission throttling and a
leased, exact whole-graph provisioning receipt protect concurrent/crashed
bootstrap attempts.

The feature branch applies the focused hardening slice as follows:

1. **Implemented:** default `createApp()` makes users, workflow definitions, and Storage
   metadata private to generic Sync and row-filters notifications/receipts, rooms/members,
   and workflow execution rows.
2. **Implemented:** snapshot, catch-up, and live delivery use the same platform row policy;
   framework table writes remain protected.
3. **Implemented:** notification detail and receipt mutations require an actual target and
   return the same 404 for missing/inaccessible IDs.
4. **Implemented:** room detail/member reads require membership; HTTP join is only
   idempotent for an already admitted member, while trusted server code owns admission.
5. **Implemented:** workflow execution reads and lifecycle actions require the starter or
   documented global-administrator control authority.
6. **Implemented:** middleware and Storage grants reuse the registered
   policy-trusted-property decision and fail closed when no trusted validator exists.
7. **Implemented for managed topics:** personal, room, and app-defined managed
   ephemeral topics derive a server-owned tenant namespace and enforce
   subscribe/write/delete policy. A deliberately raw caller-defined topic
   remains trusted application policy rather than implicit tenant isolation.
8. **Implemented for current single mode:** top-level `auth.bootstrap`,
   timing-safe secret verification, pre-hash rejection, transactional recheck,
   durable completion, packaged setup-key UI, safe config discovery, upgrade
   sealing, Doctor findings, and race/replay tests.
9. **Implemented in the unreleased tree:** all four capability profiles
   normalize, the authorization kernel is installed across managed surfaces,
   and multi bootstrap creates the initial organization/membership/session
   context. Doctor still blocks unsafe or unclassified multi-mode application
   data rather than guessing ownership.
10. **Implemented for this slice:** adversarial raw Sync, guessed-ID, membership,
   ownership, and self-writable-property regressions cover the hardened paths.

This remains design/audit evidence rather than the runtime contract. Release
readiness is governed by the implementation checklist and full verification,
not by the historical tense used in later audit sections.

## Terminology

- **Identity**: one global Zero user account, stored in `users`.
- **Tenant**: an isolation and administration boundary. Product UI may call this an
  organization, workspace, account, practice, team, or another configured label.
- **Membership**: the relationship between an identity and one tenant.
- **Mailbox proof**: persisted evidence that a particular identity controlled its current
  canonical email at a particular email generation, including the proof source.
- **Verified domain claim**: a tenant's current proof of control over one exact DNS domain
  plus its constrained discovery/admission policy; it is not itself a membership.
- **Platform role**: the existing global `users.role` value. The built-in `admin` meaning
  is platform-wide and remains separate from tenant administration.
- **Application role**: a named role evaluated inside the current authorization scope. In
  `single` it is assigned to the user/application relationship; in `multi` it is assigned
  through a membership and may be called a tenant role in product copy.
- **Permission**: an app-declared capability key such as `patients:read` or
  `billing:manage`.
- **Active tenant**: the tenant currently bound to a session and its resulting auth
  context.
- **Authorization scope**: the server-validated boundary within which roles, permissions,
  data, and services are evaluated. It is the application-wide scope in single-tenant
  mode and the active membership/tenant in multi-tenant mode.
- **Upstream SSO**: Zero acts as an OpenID Connect Relying Party or SAML Service Provider
  and accepts an enterprise identity provider's authentication.
- **Native OIDC**: the existing feature where Zero acts as the OpenID Provider for a
  registered desktop or mobile public client. It is the opposite side of the protocol
  from upstream SSO.

## Goals and non-goals

### Goals

- Preserve the current simple experience for apps that need one user population and basic
  authentication.
- Make tenancy (`single` or `multi`) and authorization (`simple` or `advanced`) independent,
  declarative choices.
- Let an application move from the current single/simple profile to a richer profile
  without replacing its login/session system or rewriting ordinary authenticated routes.
- Prevent data from tenant A appearing in tenant B over every official Zero transport.
- Let one person belong to multiple tenants without duplicate user accounts.
- Support configurable tenant creation and join policies.
- Let a tenant prove a company domain and offer privacy-preserving request or automatic
  onboarding to coworkers with independently proven matching mailboxes.
- Support app-defined roles and permissions without hard-coded role-name checks.
- Support tenant-specific enterprise OIDC connections with safe identity linking and JIT
  onboarding policies.
- Reuse the same identity, account gates, MFA, session, native app, and browser client
  infrastructure.
- Make configuration errors visible at startup and through Doctor.
- Supply a safe migration path for existing Zero applications and data.

### Non-goals for the first production slice

- A general-purpose identity-provider product for unrelated third parties.
- Arbitrary policy-language evaluation.
- SAML, SCIM, group synchronization, and tenant-custom role editing in the first slice.
- Automatically inferring tenant ownership from existing data.
- Treating URL slugs, request headers, email domains, or JWT claims alone as authorization.
- Giving platform administrators silent data-plane access to every tenant.

## Current system: end-to-end map

### 1. Startup and configuration

`createApp()` resolves auth behavior and mounts the Sync, auth, middleware, resource, data,
and page-routing layers. When application auth is enabled, page routes are protected by
default and Sync authentication defaults to required. Important current configuration
includes:

- registration mode: `public`, `admin-only`, or `disabled`;
- email-verification and account-lifecycle behavior;
- optional/required/admin-required MFA, with email and TOTP methods;
- configured user-property schemas and policy-trusted properties;
- registered native desktop/mobile public clients using Authorization Code plus PKCE.

There is currently no tenant, membership, permission-registry, upstream SSO, tenant
onboarding, or table-scope configuration.

Primary code boundaries:

- `src/frontend/server/types.ts`
- `src/frontend/server/app-factory.ts`
- `src/auth/types.ts`
- `src/auth/auth-config.ts`
- `src/auth/auth.plugin.ts`
- `src/auth/auth-runtime.ts`

### 2. Identity and credential persistence

The current model is global:

| Store | Current responsibility | Current scope |
| --- | --- | --- |
| `users` | identity, profile, global role, status, verification/MFA gates | global |
| `_credentials` | password hash | one per user |
| `user_properties` | configured profile/policy metadata | global per user |
| `_refresh_tokens` | browser refresh sessions | global per user |
| `_auth_user_generations` | durable access-token invalidation | global per user |
| auth action-token tables | setup, reset, verification actions | global per user |
| MFA tables | methods, challenges, recovery state | global per user |
| native OIDC tables | authorization requests, codes, refresh families | global per user/client |

`username` and `email` are globally unique. `users.role` is one arbitrary string; only the
exact value `admin` has built-in platform meaning. `UserStore` lists, filters, counts, and
admin safety checks across the full user population. The first user created through an
authorized bootstrap ceremony is atomically promoted to the bootstrap administrator, and
the durable completion marker prevents deletion from reopening setup.

Current user creation also creates a password credential atomically. Upstream SSO needs a
credential-optional identity path: an external-only user must not receive a fabricated
password, and password reset must not silently create an SSO bypass unless deployment and
tenant policy explicitly allow it.

User properties are useful metadata, but they are deliberately not a tenancy model. Even a
policy-trusted property has no membership lifecycle, invite state, per-tenant role set,
last-owner invariant, session revision, or relational isolation guarantee.

Primary code boundaries:

- `src/auth/auth-schema.ts`
- `src/auth/user-store.ts`
- `src/auth/auth-token-generation.ts`
- `src/auth/oidc/*`

### 3. Registration, login, and account gates

The current identity flow is:

1. The secret-gated installation ceremony creates the platform bootstrap administrator;
   explicit `public` mode preserves legacy behavior and explicit `disabled` mode requires
   trusted provisioning.
2. Later public registrations are accepted or rejected by one global registration mode.
3. Username/password authentication checks account status, forced password change, email
   verification, and MFA requirements.
4. Successful completion issues an access/refresh pair and a refresh-row-bound HttpOnly
   page-session cookie.
5. Password, status, role, and other security-sensitive account changes advance the user
   security generation or revoke session families.

Registration presently means both “create an identity” and, implicitly, “join the app.” A
multi-tenant system must split those concepts. Creating an identity cannot by itself grant
membership in every tenant or any tenant.

There is also a specific compatibility boundary for company-domain onboarding:
`createRegistrationUser()` currently sets `emailVerifiedAt` to the creation time when email
verification is not required. Other current checks intentionally interpret that as an
eligible account, but it does not prove that a challenge reached the mailbox. Existing login
behavior can remain compatible; domain admission must add explicit proof source and email
generation rather than redefining this field globally or trusting its truthiness.

The current `auth-email-identity.ts` seam trims/lowercases the full value and validates an
ASCII-domain pattern; it does not convert Unicode IDNA U-labels to DNS A-labels. Domain
onboarding must not add a second canonicalizer that disagrees with registration, login,
admin email changes, recovery, or the email outbox. Before Unicode-domain input is accepted,
introduce one shared domain canonicalization function and make every email/auth path use it,
with a collision audit for existing identities. Until that prerequisite lands, public input
supports explicit ASCII A-label domains only and rejects Unicode U-labels clearly.

Primary code boundaries:

- `src/auth/auth-registration-policy.ts`
- `src/auth/auth-registration-service.ts`
- `src/auth/auth-login-service.ts`
- `src/auth/mfa-*`
- `src/auth/auth-action-*`

### 4. Tokens, page sessions, and request authentication

Browser access JWTs contain user identity, global role, and the user's auth generation.
Middleware verifies the token, reloads the live user, enforces current account gates, and
returns:

```ts
interface AuthContext {
  userId: string;
  email: string;
  role: string;
  clientId?: string;
  sessionKind?: 'web' | 'native';
  scope?: readonly string[];
  sessionId?: string;
}
```

The live rehydration is a strong foundation: a stale role embedded in a browser JWT is not
treated as final authority. Native access tokens are also tied to a live native refresh
family. Page-session cookies resolve through their persisted refresh-token row, so logout,
rotation, revocation, suspension, deletion, and expiry affect SSR promptly.

No session is bound to a tenant or membership today. Consequently, adding only a
`tenantId` request header would be unsafe: a caller could select an arbitrary tenant unless
every path separately performed membership validation.

Primary code boundaries:

- `src/auth/token-service.ts`
- `src/auth/auth-context.ts`
- `src/auth/auth.middleware.ts`
- `src/auth/page-session.ts`

### 5. HTTP, page, and server-extension authorization

The common route helpers are `requireAuth()` and `requireAdmin()`. `requireAdmin()` checks
the global role string. File-routed pages can be public, authenticated, or global-admin
only. Server middleware matchers can require authentication, a global role, or selected
user-property matches. Unlike resource `metadataPolicy()`, that matcher path does not
currently validate that the property is policy-trusted; the immediate finding above covers
the resulting escalation risk.

There is no standard `requireTenant()`, `requirePermission()`, tenant-role matcher, or
membership-aware page guard. Custom raw routes remain application-owned and can bypass
resource policies unless the developer invokes an authorization helper.

Server-extension authentication may be optional by inheritance, and a raw Elysia plugin can
bypass Zero guards entirely. These remain intentional privileged escape hatches, but
multi-mode Doctor checks should flag unguarded application routes that touch declared
tenant data and documentation should lead with tenant-aware endpoint/router declarations.

The file router also has policy-composition gaps that the unified evaluator must close:
`route.ts` API dispatch occurs before page/layout policy evaluation and therefore does not
inherit a protected layout; global protected-by-default page behavior intentionally does
not protect APIs; and a layout import failure is currently observed and skipped rather than
failing its explicit policy closed. Existing documented Bearer-only API semantics should
remain, but API/layout requirements must be compiled deliberately and any policy-loading or
evaluation failure must deny rather than silently omit authorization.

Primary code boundaries:

- `src/frontend/router/auth-policy.ts`
- `src/frontend/server/server-policy.ts`
- `src/frontend/server/server-extensions.ts`
- `src/frontend/server/router-plugin.ts`

### 6. Generated resources and data queries

Registered resources are the strongest current authorization seam. Policies can require an
authenticated user or admin, make a resource read-only, apply ownership constraints, use
trusted metadata, or compose rules. Policy decisions are used by generated CRUD, lazy data
queries, and the resource-to-Sync adapter.

Owner policies can constrain reads and stamp an owner field on create. There is no
equivalent built-in tenant constraint and stamp. An app can hand-author a metadata or
custom policy, but that does not guarantee every table and transport is covered.

Primary code boundaries:

- `src/resources/resource-policy-types.ts`
- `src/resources/resource-policy-helpers.ts`
- `src/resources/resource-policy-evaluator.ts`
- `src/resources/resource-sync-policy.ts`
- `src/resources/resource-crud.plugin.ts`
- `src/sync/data-query.plugin.ts`

### 7. Sync authorization

Sync verifies the same live account context as HTTP. It calculates readable tables, applies
resource row filters, and records an authorization fingerprint/scope. Active authenticated
sockets are revalidated periodically; a changed user context or resource-policy fingerprint
closes the socket and clears its subscriptions and authorization state.

This is another strong foundation. Tenant and membership state must become part of the
context and fingerprint so a tenant switch, membership suspension, role change, or
permission change forces a reconnect and local authorization-boundary reset.

Current limitations:

- the comparable identity is only user ID, email, and global role;
- unregistered **app** tables use table-level callbacks and otherwise preserve the
  standalone-compatible allowed behavior;
- the default platform policy now makes private framework tables unreadable and applies
  target/membership/owner filters to scoped framework rows, but it has no tenant context or
  tenant predicates;
- app-owned raw tables are not automatically classified as global or tenant-scoped.

The Phase-0 implementation closes the audited framework-table raw Sync exposure. It does
not classify arbitrary app tables or turn the current single-scope row filters into tenant
isolation; those remain explicit requirements for the table-security registry.

Primary code boundaries:

- `src/sync/sync-auth.ts`
- `src/sync/sync-socket-access.ts`
- `src/sync/sync-socket-authorizer.ts`
- `src/sync/sync-socket-revalidation.ts`
- `src/sync/sync-authorization-scope.ts`
- `src/sync/sync-policy.ts`

### 8. Browser and native client state

The browser auth store exposes one current user and token session. The administrative UI is
a global user-management UI with global role/status filters. Native desktop/mobile clients
authenticate through Zero's OIDC Authorization Code plus PKCE implementation and then use
the same application permissions as browser clients.

Neither client surface has an active-tenant selector, membership list, tenant-aware token
state, tenant switch operation, or tenant-scoped administration. The native OIDC
authorization transaction will also need a validated tenant selection before it can issue a
tenant-bound application access token.

The existing `socialProviders` component input is presentation-only: it renders caller-wired
buttons and does not implement Google, Microsoft, Apple, GitHub, or enterprise federation.
Documentation should not describe those buttons as built-in OAuth providers until actual
provider flows exist.

### 9. Platform-service scope audit

Tenant support must include framework-owned services, not only application tables.

| Surface | Current authority/scope | Required multi-tenant treatment |
| --- | --- | --- |
| Notifications | global user IDs and global role/all targeting; HTTP and Sync now enforce actual target visibility | store tenant ID directly on notifications and receipts; role/all target only within tenant; keep receipt parentage tenant-consistent |
| Rooms | membership by global user ID; detail/member reads now require actual membership and HTTP admission is server-controlled | store tenant ID directly on rooms and members; tenant-filter every operation; retain room roles as a separate domain role |
| Storage | owner user ID plus global role/property/user grants; global `admin` bypass; metadata is private from generic Sync | store tenant ID directly on drives, objects, and grants; reject cross-tenant parent/grants; distinguish platform and tenant admin policy |
| Workflows | execution rows record `started_by` and are now starter-scoped, with a documented global-admin override; definitions use an authenticated API | store tenant ID on independently queried instances/steps/events; scope definitions as appropriate and authorize every lifecycle action |
| Per-user state Sync | keyed by authenticated user | decide whether state is global identity state or `(tenant, user)` app state; default app state to tenant-scoped |
| Ephemeral/presence | topics and user keys are not inherently tenant-qualified | namespace tenant-owned topics and reject subscriptions outside active tenant |
| Sync mutation receipts | idempotency principal/request hash are user-global | partition by stable tenant and membership/user scope without making benign authorization-version changes destroy replay safety |
| KV/cache/counters/limiters | server-side generic keys/namespaces; no automatic auth scope | provide tenant-scoped namespace helpers and require explicit global escape hatch; include tenant in rate-limit keys where policy is tenant-specific |
| Vector service | optional `tenantId` metadata exists, but server callers choose filters | provide scoped insert/search/delete handles that stamp and require tenant metadata; raw vector access is privileged |
| Generic platform tokens | app-defined subject/resource/scope, no first-class tenant binding | bind tenant-owned tokens to immutable tenant/membership context and validate it on inspect/consume/rotate |
| Scheduler | global platform-admin control; callbacks carry no tenant execution context | keep scheduler administration platform-global, but persist/restore tenant context for tenant-owned jobs and prevent cross-tenant job names/data |
| AI/email/PDF | mostly server services; app routes decide authorization and attribution | require tenant-aware wrappers where data, budget, branding, prompts, output, or delivery is tenant-owned; stateless PDF transforms still inherit caller data policy |
| Raw SQL/server services | intentionally privileged process-wide handles | add scoped repositories as the normal path; document/audit raw handles as an explicit escape hatch |
| Audit/observability | platform events have no standard tenant context | attach tenant/membership identifiers where applicable without leaking secrets or cross-tenant payloads |
| File-routed pages | authenticated/global-admin only | allow tenant-required and permission-required route config |
| Public page/ISR cache | cache identity is primarily pathname-based | include validated tenant/host and relevant tenant content generation before caching tenant-specific public output |
| Native apps/extensions | identity session, no tenant selection | bind tokens to a validated membership and expose select/switch APIs consistently |

Phase 0 closed the audited single-scope room-detail/membership/admission and workflow
owner/lifecycle gaps. Tenant work still must add a mandatory tenant predicate rather than
mistaking those user-level checks for tenant isolation. App-owned room content is also not
automatically protected merely because it has a `room_id`; its server resource/Sync policy
must explicitly bind reads and mutations to verified membership.

Storage presigned/download/upload capabilities also need explicit tenant semantics. Current
capability payloads identify drive/path/method/expiry but not tenant or an authorization
generation, and execution does not repeat normal user authorization. Tenant mode must bind
new capabilities to scope and either support revocation generation or clearly constrain and
document their short expiry; old unscoped capabilities must be invalidated during adoption.

## Why the obvious shortcuts are unsafe

### A `tenant_id` user property

This prevents one user from belonging to multiple tenants, has no invitation or membership
status, cannot express tenant-specific roles, and is easy for custom queries or services to
forget. It also conflates identity profile data with authorization state.

### One global `users.role`

A person can be an owner in tenant A, a viewer in tenant B, and have no access to tenant C.
One global string cannot represent that. Making a tenant owner a global `admin` would grant
cross-tenant platform power.

### A tenant header or URL slug

A header or slug is a routing hint, not proof of access. It is safe only after the server
resolves it to an immutable tenant ID, validates a live membership, and binds that result to
the issued/rotated session.

### Tenant filters only in UI code

Browser filters do not cover generated CRUD, `/api/data`, Sync snapshots and catch-up,
WebSocket mutations, storage, background workflows, custom server routes, or service calls.

### Adding SSO first

SSO proves who a user is. It does not establish which tenant data that identity may access.
Adding upstream SSO before membership and isolation would accelerate login into an
ambiguous authorization model.

## Required security invariants

1. In `single/simple`, current behavior, public types, and global-role meanings continue to
   work.
2. A global identity may have zero, one, or many memberships.
3. Membership suspension/removal does not delete or suspend the global identity.
4. Global account suspension invalidates access in every tenant.
5. A session may access tenant data only when it is bound to a current active membership.
6. A caller-supplied tenant hint is never authority by itself.
7. Tenant-scoped creates are stamped by trusted server code; caller attempts to substitute
   another tenant ID are rejected or overwritten according to one documented rule.
8. Tenant-scoped reads, updates, and deletes always include the active tenant constraint.
9. Tenant roles never imply the existing platform-admin role.
10. Platform administration does not silently imply tenant data access. Any support or
    break-glass access is explicit, time-bound, and audited.
11. Existing `admin`, `requireAdmin()`, `adminOnly()`, and `role` checks remain global/
    platform checks and can never be satisfied merely by tenant authority.
12. Unknown table security/realm classification fails closed in `multi` mode.
13. Permission and membership changes invalidate or revalidate HTTP, page, native, and
    Sync authorization promptly.
14. External identities are keyed by stable issuer/subject identity, not email alone.
15. Invitation, SSO-state, authorization-code, and similar bearer artifacts are one-time,
    short-lived, and stored hashed where feasible.
16. Every official route, resource, Sync, and service adapter evaluates through the same
    live authorization kernel; no transport may downgrade to token claims alone.
17. Client SDK convenience APIs never become the enforcement boundary; the server remains
    authoritative.

## Proposed domain model

The names below are architectural names, not a committed migration. Authorization/control
tables should be internal and should not be raw-synced to clients.

### Existing global identity

Keep `users` and its credential/MFA/account-lifecycle tables. Preserve global email and
username uniqueness for the first implementation. Preserve `users.role` as the legacy
platform role so existing apps do not change meaning.

Longer term, a `platform_role` name would be clearer, but renaming the physical field is not
required for the safe first release.

### Tenants

`_auth_tenants`

| Field | Purpose |
| --- | --- |
| `tenant_id` | immutable opaque identifier |
| `slug` | mutable human/routing identifier, uniquely normalized |
| `name` | display name |
| `status` | active, suspended, or archived |
| `authorization_generation` | tenant-wide emergency invalidation/version boundary |
| `created_by` | global user ID that created it |
| timestamps | lifecycle/audit support |

Suspending a tenant must make every tenant-bound session fail closed without suspending the
users themselves.

### Memberships

`_auth_tenant_memberships`

| Field | Purpose |
| --- | --- |
| `membership_id` | immutable identifier |
| `tenant_id` / `user_id` | logical relationship, protected by `UNIQUE(tenant_id, user_id)` |
| `status` | active, suspended, or removed |
| `role_key` | the one configured application role in `multi/simple`; null when advanced assignment rows are authoritative |
| `authorization_generation` | membership-specific invalidation/version |
| `joined_at`, `created_at`, `updated_at` | lifecycle/audit support |
| `created_by` | actor or provisioning source |

Pending invitations remain invitation records rather than partial memberships. Membership
creation happens atomically at acceptance/provisioning. A removed relationship normally
retains its row for audit and is explicitly reactivated/reinvited rather than duplicated;
the unique tenant/user constraint makes that lifecycle choice enforceable. All authorization
queries use only active memberships.

Create a composite unique key on `(membership_id, tenant_id, user_id)` and use it from
session and assignment records. This prevents a valid membership ID from being paired with
the wrong tenant or user by an application bug or partial migration.

### Roles and permissions

Start with one canonical permission registry composed from reserved framework/plugin control
permissions plus app-declared application permissions, and app-defined application-role
templates. For the first release, framework registration plus application configuration is
the source of truth for role-to-permission mapping. Persistence varies only with the selected
profile:

- `single/simple` projects the existing `users.role` and needs no new assignment table;
- `single/advanced` stores one or more role keys per user in
  `_auth_application_role_assignments`;
- `multi/simple` stores exactly one configured `role_key` on the membership;
- `multi/advanced` stores assignments in `_auth_tenant_membership_roles`, including
  `tenant_id`, `membership_id`, `role_key`, assignment source/source ID, actor, and
  timestamps.

The duplicated tenant ID in advanced membership assignments permits composite consistency
constraints and efficient scoping. All four persistence forms expand through the same
runtime role/permission evaluator.

Runtime-editable custom roles are explicitly later work. If enabled, add
`_auth_tenant_roles` and `_auth_tenant_role_permissions` with clear `app-template` versus
`tenant-custom` ownership/versioning; do not maintain two ambiguous sources of truth in the
initial release.

Recommended semantics:

- permission keys are explicit, namespaced strings;
- configuration fails at startup when a role references an unknown permission;
- a built-in owner role receives every registered tenant permission through an explicit
  `allPermissions` semantic, not an unvalidated wildcard string;
- at least one active owner must remain for each active tenant;
- advanced-mode role assignments are additive in the first version; simple mode has exactly
  one role key;
- app/resource constraints still apply after permission checks;
- deny and thrown-policy results fail closed;
- tenant-custom roles can be added later without changing the membership model.

Role-template and permission-registry deployment changes need an explicit reconciliation
plan. The implemented assignment services make a retained role absent from the current
registry inert, expose it as retired, prevent new grants, and let an owner remove it with
the same optimistic revision contract. Startup/Doctor drift reporting and explicit bulk
rename/migration tooling remain follow-up work; registry changes must never silently grant
authority.

If tenant-specific ABAC attributes are added later, they belong to a membership-attribute
store, not global `user_properties`. Any attribute used in authorization must be writable
only by system code or an explicitly authorized tenant administrator.

### Invitations and verified domains

`_auth_tenant_invitations` should contain tenant, normalized email, proposed roles, expiry,
status, creator, and only a hash of the invitation token. Acceptance must atomically validate
the email/identity, consume the invitation, create or reactivate the membership, and assign
roles.

`_auth_tenant_join_requests` should represent request-to-join separately from both
invitations and memberships, with tenant/user, source/domain, status, reviewer, expiry, and
timestamps. Approval atomically creates the membership and records its source.

Verified-domain admission needs stronger evidence than the current nullable
`users.email_verified_at`. Today self-registration deliberately writes that timestamp when
email verification is disabled, so legacy/current truthiness can mean “verification was not
required” rather than “a mailbox challenge succeeded.” Add an email generation plus an
explicit `_auth_email_proofs` record (or equivalently strong persisted model) containing
user, canonical email, email generation, proof source/authority, proven time, expiry or
revocation state, and safe provenance. Delivered email-link proof is eligible by default;
an explicitly trusted, connection-bound IdP proof is eligible only when application policy
allows that source. An administrative override is not
eligible for automatic domain admission unless application policy deliberately allows that
source. Changing the canonical email advances the generation and invalidates stale proofs.
The same proof service should satisfy invitation-email matching and explicitly allowed SSO
linking rules where suitable; do not create separate meanings of “verified email” in each
plugin. Existing account-gate compatibility may still project a Boolean/timestamp view.

Email-first onboarding may begin before a global user exists. Add a separate short-lived
`_auth_email_proof_transactions` store bound to canonical email, purpose, optional already-
authenticated user/email generation, token digest, attempts, expiry, and consumed state.
The current `_auth_action_tokens` shape cannot be reused as-is: it requires `user_id`, and
today completing `email_verification` immediately enters the normal auth-completion/session
path. Pre-registration/domain mailbox completion returns only an opaque onboarding result;
it never logs in, selects, or mutates an existing identity by looking up the submitted email.

An existing identity binds a fresh proof only from its normally authenticated session after
current account gates/MFA or required step-up. For a new identity, registration atomically
consumes the pending proof, rechecks global email uniqueness, creates the user, and writes
the first user-bound proof. If the address already belongs to an account, stop at the normal
sign-in/recovery or authenticated linking flow—even if the unauthenticated caller proved the
mailbox—because corporate addresses can be reassigned. Do not create a fully active dormant
user merely to send the challenge. Minimize and expire pre-identity email data like other
auth action material.

`_auth_tenant_domains` should be an explicit admission-policy record, not a cache of email
suffixes. It should contain the tenant, canonical ASCII/IDNA domain, display form, exact
domain versus explicitly approved subdomain coverage, verification method and status,
verified/last-checked/next-check/lost-at times, admission policy, request default role,
fixed automatic-join role, account-creation policy, policy revision, actor, and timestamps.
The selected roles must remain inside the application allow-lists. The row must not contain a
wildcard that silently turns proof of `team.example.com` into control of `example.com` or
vice versa.

Use separate short-lived `_auth_tenant_domain_challenges` rows for DNS proof. Store a digest
of the random challenge value, purpose, domain, expiry, attempt metadata, and consumed time;
show the plaintext TXT value only when it is created. A published DNS value is observable,
so it proves control of the DNS zone during verification but is not a bearer credential for
joining a tenant. Successful activation retains a reference to the expected digest for
periodic DNS checks; challenge expiry limits initial activation, while proof rotation uses a
new challenge and an atomic handoff. The setup UI tells owners whether the TXT record must
remain published. Proof through enterprise SSO is allowed only when Zero has an explicitly
trusted, tested connection whose administrative ownership and domain claim are bound to the
same tenant.

Domain verification is separate from a user's mailbox verification: the first proves that
the tenant controls onboarding policy for a domain, while the second proves that this user
controls one address at that domain. Pending claims do not reserve a domain indefinitely.
At most one active tenant in an application may use a canonical domain for discovery,
request admission, or automatic admission. Verification races, aliases, and transfers are
resolved transactionally through a unique ownership constraint; ambiguity or conflict
disables discovery/admission instead of choosing a tenant by guesswork.

### Upstream SSO

- `_auth_sso_connections`: owning authorization scope (`application` in single mode or a
  tenant in multi mode), stable connection key, protocol, issuer/metadata, encrypted client
  credentials/configuration, status, and policy.
- `_auth_external_identities`: connection, protocol authority/issuer, stable subject,
  global user ID, timestamps, and selected normalized claims. OIDC
  `(connection_id, issuer, subject)` is unique.
- `_auth_sso_transactions`: short-lived state, nonce, PKCE material, connection/owning
  application scope, return target, expiry, and consumed state.

If the same OIDC `(issuer, subject)` is encountered through another connection, it is only a
linking candidate, not automatic global authority. A separately connection-scoped identity
row may resolve to the same global user only through an already authenticated explicit link
or a platform-approved federation trust group; otherwise stop for conflict resolution. A
tenant-controlled connection cannot use that collision to enter another scope. SAML uses
its connection/entity plus configured stable identifier semantics. Pairwise subjects for
different clients naturally remain separate provider-identity rows that may still link to
the same user through an authenticated flow.

Secrets require application-level authenticated encryption under a separately managed key;
they must not be stored in logs, synced tables, browser configuration, or plaintext admin
responses.

Use an `_auth_completion_transactions` store for replay-sensitive local continuations such
as tenant selection and browser SSO handoff. It records a hashed opaque transaction/JTI,
purpose, user, eligible/selected tenant or connection, validated continuation, expiry, and
consumed time. Today's stateless transition JWT is a useful signed envelope but is not by
itself a one-time consumed transaction; tenant selection must add a distinct purpose and
durable replay protection.

### Durable authorization audit

Observability events are not a substitute for a durable security audit trail. Add an
append-only internal `_auth_audit_events` service/table with:

- event ID, timestamp, request/correlation ID, action, outcome, and safe reason code;
- tenant, actor user/membership/session, authentication provenance, and target identifiers;
- assignment/provisioning source and a bounded, schema-validated metadata payload;
- configured retention/export behavior and authorized platform/tenant query views.

It records bootstrap, tenant lifecycle, owner changes, invitations, membership/role changes,
SSO connection/enforcement/link/JIT events, SCIM changes, account recovery, session
revocation, and every break-glass attempt/outcome. Never record passwords, raw bearer/action
tokens, client secrets, MFA seeds/codes, or raw OIDC/SAML assertions. Identity deletion must
retain non-secret tombstone identifiers rather than cascading away the audit history.

### Elevated support sessions

Break-glass authority needs a real domain object, not a UI flag or temporary tenant
membership. `_auth_elevations` should record:

- immutable elevation ID, requester platform user/session, target authorization scope and
  tenant, and an explicit allow-list of permitted operations;
- mandatory reason, fresh assurance/step-up evidence, requester and optional independent
  approver, decision timestamps, and audit-event linkage;
- issuance, short expiry, revocation/termination, replacement, and elevation generation;
- notification state without storing credentials or sensitive tenant payloads.

An approved elevation creates a separate durable session binding (or a separately typed
child binding) whose auth context includes only a sanitized marker:

```ts
elevation?: {
  elevationId: string;
  targetScopeId: string;
  permissions: readonly PermissionKey[];
  expiresAt: number;
  generation: number;
};
```

The authorization kernel intersects ordinary platform authority with this narrow grant; it
does not add the operator as a normal member or accept a caller-chosen permission. Elevation
ID/generation/expiry are included in access-token/session validation and the Sync policy
fingerprint. Issue, approve, inspect, terminate, and status routes live under
`/auth/platform/elevations`; tenant owners receive a safe read/notification view under the
tenant audit boundary. Expiry or revocation invalidates HTTP, page, Sync, and background
capabilities and runs the same authorization-scope purge barrier as tenant switching.

### Session bindings

Add a durable `_auth_sessions` (or equivalent web/native session-family parent) rather than
attaching tenant state only to whichever refresh token happens to be current. It records:

- stable `session_id`, user ID, session kind, status, and session generation;
- active authorization scope, plus tenant and membership IDs in `multi`;
- authentication provenance/assurance;
- creation, last-used, expiry, revocation, and replacement metadata.

Rotating refresh-token rows and native refresh families reference this parent. Browser
access JWTs gain `sid` plus the session generation, and normal live auth-context hydration
validates the session just as native access already validates its refresh family. The
existing page cookie may continue to resolve through its refresh row, which then resolves
the same parent session.

Browser refresh/page sessions and native refresh families thereby gain bindings to:

- active scope kind/ID;
- active `tenant_id` and `membership_id` when multi-tenant;
- membership and tenant authorization generations when applicable;
- optional elevation ID/generation/expiry for a separately issued support session.

They must also retain authentication provenance: local password/MFA versus a specific
upstream connection and its owning application/tenant scope. Provenance is
authorization-relevant. A session authenticated by a tenant-managed IdP is trusted for that
connection's tenant, not as a universal proof that can enter every other tenant linked to
the same global user.

For native apps, the pending authorization request, authorization code, access token, and
refresh family all bind the same tenant/membership. The tenant cannot change between browser
authorization/consent and token exchange.

A tenant switch atomically creates/rebinds a replacement session and revokes or advances the
old session generation. The new access token receives the replacement `sid`; every old web
access JWT and its Sync socket then fails live session validation instead of remaining usable
until the access-token TTL. Switching one device/session does not silently switch all of a
user's other independently authenticated sessions.

Null is valid for current single-tenant mode. In tenancy mode, a short-lived
identity-authenticated tenant-selection transition may be unbound, but it is not a normal
application session and can never access tenant data.

Access tokens should carry only stable context identifiers needed to identify the intended
session boundary. Effective membership state, roles, and permissions should be loaded or
validated against live server state, following the same pattern Zero already uses to
rehydrate current user state. Do not trust a long-lived permission list merely because it
was signed earlier.

Tenancy-enabled Sync must require this live membership-aware resolver. Its current standalone
compatibility fallback, which can construct auth from token claims alone, is not sufficient
for tenant authorization.

## Proposed runtime auth context

Extend, do not replace, the current shape:

```ts
interface AuthContext {
  // Existing compatibility fields.
  userId: string;
  email: string;
  role: string; // Existing global/platform role.
  clientId?: string;
  sessionKind?: 'web' | 'native';
  scope?: readonly string[];
  sessionId?: string; // Durable app-session id in tenancy mode.
  sessionGeneration?: number;

  // Canonical authorization boundary. It can initially be synthesized from
  // today's global role in single/simple mode without new persistence.
  authorization?: {
    tenancy: 'single' | 'multi';
    mode: 'simple' | 'advanced';
    scopeKind: 'application' | 'tenant';
    scopeId: string;
    roles: readonly string[];
    permissions: ReadonlySet<string>;
    revision: string;
  };

  // Convenience detail present only for a validated tenant-bound session.
  tenant?: {
    tenantId: string;
    membershipId: string;
    membershipGeneration: number;
    tenantGeneration: number;
  };

  // Server-authoritative assurance/provenance, with only a safe subset public.
  authentication?: {
    kind: 'local' | 'federated';
    authenticatedAt: number;
    connectionId?: string;
    authorityScope?: {
      kind: 'application' | 'tenant';
      scopeId: string;
    };
    methods?: readonly string[];
  };

  // Present only on a separately issued, short-lived support elevation.
  elevation?: {
    elevationId: string;
    targetScopeId: string;
    permissions: readonly PermissionKey[];
    expiresAt: number;
    generation: number;
  };
}
```

The public/serialized browser representation should use a permission array rather than a
JavaScript `Set`. Internal request code can normalize it to a read-only set.

Add standard helpers:

```ts
requireAuth(): AuthContext;
requirePlatformAdmin(): AuthContext;
requireAuthorizationScope(): AuthorizationScope;
requireTenant(): TenantAuthContext;
hasPermission(permission: PermissionKey): boolean;
requirePermission(permission: PermissionKey): AuthorizationScope;
requireAnyPermission(permissions: readonly PermissionKey[]): AuthorizationScope;
```

Keep `requireAdmin()` as a deprecated-compatible alias for global/platform admin until a
major release can make the distinction unavoidable. New tenant code must never use it as a
tenant-admin check.

`authorization` is the common seam that prevents every service from branching on tenancy.
In `single` mode it describes the application-wide authorization scope. In `multi` mode it
describes the active tenant membership and `tenant` adds the tenant-specific identifiers and
generations. The public/browser form uses arrays and opaque revision values; read-only sets
are an internal convenience only. It is optional in the first public TypeScript contract so
existing code that constructs an `AuthContext` still compiles; the upgraded runtime
synthesizes it for every completed application session, and `requireAuthorizationScope()`
narrows it for handlers.

## Compatibility profiles: one auth system, four modes

This work must remain an upgrade to current auth, not a second authentication stack. Zero
should normalize two independent configuration axes:

- `tenancy.mode`: `single` or `multi`;
- `authorization.mode`: `simple` or `advanced` (role/permission RBAC).

These axes apply only after auth is enabled. Existing `auth: false` or omitted auth remains
an authless app. Within `auth: true` or an auth configuration object, omitting both axes
selects `single` plus `simple`, which is exactly the current product model.
`auth: true` and every existing auth configuration must continue to normalize to that
profile without new tables, screens, tenant selection, or response requirements.

| Profile | Intended use | Authority source | Visible control UI |
| --- | --- | --- | --- |
| `single` + `simple` | Today's ordinary Zero app | Existing live global user role and trusted properties | Existing profile/security and global admin UI only |
| `single` + `advanced` | One application boundary with fine-grained capabilities | App-scope role assignments and declared permissions | Role/permission assignment, with no tenant chooser |
| `multi` + `simple` | Multiple isolated organizations with a small coarse role set | Active membership and one configured application-role key | Tenant switcher, members, invitations, and coarse role assignment |
| `multi` + `advanced` | Full organization product | Active membership, role assignments, and live permission expansion | Complete tenant control center, including roles and SSO policy |

The profiles are capability levels, not separate implementations:

- identity login, password/email/MFA gates, refresh rotation, page sessions, native OIDC,
  browser SDK restoration, and audit semantics remain shared;
- `auth: 'user'`, `auth: 'admin'`, `requireAuth()`, and `requireAdmin()` keep their current
  meaning in every profile, so existing routes do not need to be rewritten;
- global/platform `admin` never silently becomes tenant admin;
- multi-tenant scope is applied by the platform even to existing authenticated resource and
  service paths; an old route may remain authentication-only, but it cannot bypass the
  active tenant boundary through an official scoped service;
- role and permission declarations enrich the same route/plugin/service contracts. They do
  not select a different middleware or token format;
- tenant-only declarations are rejected at startup in `single` mode instead of becoming a
  surprising no-op;
- permission declarations are rejected at startup in `simple` mode unless the application
  explicitly supplies a compatibility mapping. Authentication-only and coarse-role
  declarations remain valid after moving to `advanced`;
- `simple` means one application-role key per account (`single`) or membership (`multi`).
  Its role templates are app-configured and its optional role-to-permission mapping is
  static; there is no multi-role/custom-role editor. `advanced` uses the same permission
  catalog and evaluator but permits multiple assignments and richer role administration;
- in the exact `single/simple` compatibility profile, Zero may project the existing live
  `users.role` into that one application role. The source field still remains the global
  role, and the projection does not carry into `multi`; adoption explicitly maps users to
  memberships and leaves platform authority separate;
- mode-specific persistence is additive. `single` plus `simple` can synthesize its
  application authorization scope from the current user record. The other profiles enable
  only the assignment/membership tables they require.

An app should normally move monotonically:

```text
single/simple -> single/advanced
       |              |
       v              v
 multi/simple  -> multi/advanced
```

Moving right adds fine-grained authorization; moving down adds isolation and membership.
Neither move changes how a person proves identity. Moving down requires the explicit data
adoption and session cutover described later; changing a config value alone must never
guess tenant ownership for existing rows.

The implemented installed-profile gate makes the rightward transitions explicit
and atomic. `single/simple -> single/advanced` adopts only the exact configured
application owner and never copies global roles. `multi/simple ->
multi/advanced` validates and adopts every retained non-removed membership role,
including suspended history, while preserving current browser/native session
families. Reverse changes and populated single/multi axis changes fail closed.
Migration `023` persists the profile generation; legacy unmarked multi/simple
databases should boot once unchanged before enabling advanced mode. The narrow
`legacySimpleRoleAdoption: true` flag exists only for a verified one-step direct
upgrade and may be removed after the marker commits.

### One declarative policy vocabulary

Zero should normalize old scalar declarations and new structured declarations into one
internal `AccessRequirement`. A directionally concrete shape is:

```ts
type AccessRequirement =
  | false
  | true
  | 'optional'
  | 'user'
  | 'required'
  | 'admin' // Existing global/platform admin compatibility spelling.
  | {
      user?: 'required' | 'optional';
      platformRole?: string | readonly string[];
      tenant?: 'required';
      scopeRole?: string | readonly string[];
      permission?: PermissionKey;
      allPermissions?: readonly PermissionKey[];
      anyPermissions?: readonly PermissionKey[];
      properties?: Record<string, TrustedPropertyRequirement>;
    };
```

This is deliberately an extension of current `auth`, `role`, and trusted-property behavior.
The existing `matcher.role` continues to mean the global `AuthContext.role`; it must not
silently become a tenant role when multi-tenancy is enabled. New structured policy uses
unambiguous `platformRole` and `scopeRole` names.
For example:

```ts
// Existing declarations remain valid in every profile.
defineEndpoint({
  method: 'GET',
  path: '/profile',
  auth: 'user',
  handler: ({ user }) => user,
});

// The same declaration works in single/advanced and multi/advanced. The resolver
// evaluates the current application or tenant authorization scope.
defineEndpoint({
  method: 'POST',
  path: '/patients',
  auth: { permission: 'patients:write' },
  handler: ({ auth, zero, body }) => zero.resources.patients.create(body),
});

// A router applies policy once and children can only strengthen it.
defineRouter({
  name: 'billing',
  prefix: '/api/billing',
  auth: { tenant: 'required', permission: 'billing:read' },
  routes: [/* typed children */],
});
```

Page/layout config, `defineEndpoint`, `defineRouter`, `defineMiddleware`, and built-in route
plugins should accept the same normalized access vocabulary. Resources retain their richer
action/row-level `ResourcePolicy` composition; new permission/application-role helpers
delegate its access checks to the same authorization kernel rather than replacing resource
policy with `AccessRequirement`. Parent route policy is inherited and may be strengthened
but not weakened accidentally. A deliberate public child escape, if supported at all, must
be explicit and diagnosed rather than inferred from `auth: false` beneath a protected
parent.

Services should receive a request-bound `AuthorizationScope`, not an Elysia `Context` and
not a caller-supplied tenant ID:

```ts
await zero.access.requirePermission('patients:write');
await zero.resources.patients.create(input); // scope injected and enforced
await zero.notifications.send({ userId, message }); // target checked in same scope
```

The service API is identical in single and multi mode. A background job has no ambient
request, so it must receive an explicit, validated `AuthorizationExecutionContext` captured
at enqueue time or a deliberately privileged system context. It may not manufacture a
tenant header or pass a bare tenant ID to obtain authority.

## Configuration proposal

This is a directionally concrete API for implementation planning, not yet a promised public
shape:

```ts
// Existing configuration remains the zero-ceremony single/simple profile.
createApp({ auth: true });

// The fully configured form selects each capability independently.
createApp({
  auth: {
    bootstrap: {
      mode: 'secret',
      secret: Bun.env.AUTH_BOOTSTRAP_SECRET || undefined,
    },
    registration: {
      mode: 'public',
    },

    authorization: {
      mode: 'advanced',
      permissions: {
        'patients:read': { label: 'View patients' },
        'patients:write': { label: 'Edit patients' },
        'staff:manage': { label: 'Manage staff' },
      },
      roles: {
        owner: { allPermissions: true, system: true },
        admin: {
          permissions: ['patients:read', 'patients:write', 'staff:manage'],
        },
        member: { permissions: ['patients:read'] },
      },
    },

    tenancy: {
      mode: 'multi',
      terminology: { singular: 'practice', plural: 'practices' },

      creation: {
        mode: 'authenticated', // 'platform-admin' | 'disabled'
        // A successful creator is always the protected initial owner.
      },

      onboarding: {
        methods: ['invitation', 'verified-domain', 'sso-jit'],
        defaultRole: 'member',
        invitation: {
          expiresIn: '7d',
          requireVerifiedEmail: true,
          allowAccountCreation: true,
        },
        verifiedDomain: {
          // Application policy is the ceiling. A tenant may select an equal or narrower
          // policy for each domain it proves, but it cannot enable a mode omitted here.
          allowedAdmissionModes: ['invitation-only', 'request-to-join', 'auto-join'],
          defaultAdmissionMode: 'request-to-join',
          discovery: 'after-mailbox-proof',
          verificationMethods: ['dns-txt'], // add 'trusted-sso' only for a proven connector
          mailboxProof: {
            allowedSources: ['email-link'],
            maxAge: '24h',
            allowAdministrativeOverride: false,
          },
          accountCreation: 'after-mailbox-proof',
          allowedRequestRoles: ['member'],
          defaultRequestRole: 'member',
          allowedAutoJoinRoles: ['member'],
          defaultAutoJoinRole: 'member',
          domainCoverage: 'exact',
          reverifyEvery: '30d',
        },
        ssoJit: { mode: 'approved-domain' },
      },

      platformAdminTenantAccess: 'none',
    },

    sso: {
      enabled: true,
      protocols: ['oidc'],
      connectionManagement: 'platform-admin',
    },
  },
});
```

Configuration design rules:

- both axes accept a compact string when no options are needed, for example
  `tenancy: 'multi'` and `authorization: 'advanced'`, and an object with `mode` when they
  are configured;
- omitted `auth.tenancy` normalizes to `{ mode: 'single' }`; omitted
  `auth.authorization` normalizes to `{ mode: 'simple' }`;
- mode resolution occurs once during startup and every plugin receives the same immutable
  resolved capability object;
- Static application config defines the vocabulary and maximum available capability.
- Runtime tenant records define membership and enabled connections.
- No SSO secret is returned by `/auth/config` or bundled into browser code.
- Platform-owned tables register their own scope. Applications classify remaining
  client-visible tables in server-only, schema-adjacent resource declarations rather than
  hiding access policy in the shared client schema or one distant auth-config map.
- Registered resources contribute realm, exposure, and mutation/policy metadata to one
  canonical table-security registry.
- Duplicate or contradictory scope registration is a startup error.
- With multi-tenancy enabled, an unclassified public table is a startup/Doctor error, not an
  implicit global table.
- current `registration.mode` continues to control unsolicited identity registration;
  invitation account creation, verified-domain account creation, and SSO JIT creation are
  separately explicit admission paths and do not silently make public registration
  available. A domain flow may create an identity while public registration is disabled
  only when `accountCreation: 'after-mailbox-proof'` is explicitly allowed and the
  purpose-bound domain onboarding transaction is still valid;
- the bootstrap setup secret/ceremony is deployment-only, single-use, rejected before
  password hashing when unauthorized, and never returned by `/auth/config`;
  `registration.mode` applies only after bootstrap closes. Source-aware attempt throttling
  remains a required follow-up before multi-tenant bootstrap ships.
- tenant creation always creates a protected owner; configuration cannot downgrade or omit
  that invariant. Automatic invitation/domain/JIT roles must be non-system roles and may not
  be `owner` or carry `allPermissions`.
- both verified-domain request and auto-join role allow-lists exclude owner, system roles,
  `allPermissions`, and platform authority. Ownership uses the dedicated transfer ceremony;
- the application declares the maximum domain admission modes and roles eligible for
  automatic assignment. A tenant administrator may disable or narrow those choices per
  verified domain, but cannot widen them or submit an arbitrary role key from the browser;
- domain-ownership `verificationMethods` and user `mailboxProof` are separate policy axes.
  The latter defines eligible proof provenance/freshness; a tenant can require fresher or
  fewer sources but cannot accept sources the application disallows;
- `connectionManagement: 'platform-admin'` is the safest first release. A later
  `tenant-admin` mode requires an explicit `sso:manage` permission, tested recovery path,
  and the same connection-enforcement safeguards.

## Framework integration: Elysia, routes, plugins, and services

Tenancy and advanced authorization must be woven through Zero's existing framework seams;
they must not become a set of helpers an app author has to remember to call. The current
composition has good foundations: named Elysia feature plugins, a global request
`resolve`, typed Zero endpoint/router/middleware definitions, resource policy compilation,
and a file router mounted last. It also has several seams that are safe in the current
single-process/simple model but should be consolidated before adding tenant authority:

- `createAuthMiddleware()` resolves Bearer auth globally, while some auth subroutes still
  extract a token manually;
- feature plugins repeatedly mount the named middleware and rely on Elysia deduplication;
- file routes cast the Elysia context and implement a separate presence/global-admin check;
- Sync has a distinct verifier and a claims-only compatibility fallback;
- handler `zero` services are mostly process-wide service locators, including raw `db` and
  `sql`, rather than request-scoped authorization facades;
- plugin setup and tests depend on mutable `getAuthStore()`, `getTokenService()`, and
  `getSyncDB()` singleton boundaries;
- auth errors are mapped in multiple plugin/extension paths.

These are not reasons to replace Elysia. They identify where the upgrade needs a single
kernel and adapter layer.

### Target integration graph

| Layer | Responsibility after the upgrade | Required contract |
| --- | --- | --- |
| Config/Doctor | Normalize the two modes, roles, permissions, realms, onboarding, SSO, and control-UI capabilities | One immutable `ResolvedAuthConfig`; invalid combinations fail before listening |
| App runtime | Own persistence and construct auth services exactly once per app instance | Explicitly injected `AuthRuntime` and `AuthorizationKernel`; compatibility `get*` accessors are legacy adapters only |
| Auth root plugin | Compose account, session, MFA, native OIDC, tenancy, SSO, tenant-admin, and platform-admin feature plugins | Focused named child plugins under `/auth`, common schemas and error mapping |
| Request auth plugin | Parse the credential once and live-hydrate identity, session, authorization scope, and provenance | One request-local promise and one typed auth facade, exported with the Elysia scope consumers need |
| Zero extension DSL | Compile endpoint, router, and middleware declarations | The same normalized `AccessRequirement`, inherited monotonically and enforced before handlers |
| File router | Protect layouts, pages, loaders, and `route.ts` handlers | The same normalizer/evaluator; server/page session is authoritative before render |
| Resources/data query | Conjoin declared action policy with table realm and current authorization scope | Scope added by the server; client filters can only narrow it |
| Sync | Authenticate socket/session and authorize snapshot, catch-up, live, and mutation paths | The same runtime resolver, session/membership revisions, policy fingerprint, and table registry |
| Platform plugins | Scope Storage, notifications, rooms, workflows, state, presence, scheduler handoff, and other user data | Request-bound facade or explicit execution context; no caller-selected tenant authority |
| Browser/native/extension clients | Restore and switch the same server session/scope | One credential owner, one switch barrier, sanitized authorization state |

The desired Elysia order is:

1. resolve configuration, table/resource declarations, and diagnostics;
2. initialize the per-app persistence/runtime foundation;
3. construct and expose the immutable auth runtime and authorization kernel;
4. mount one global optional-auth request resolver;
5. mount the auth route composition root, which consumes that resolver before registering
   protected account/admin/tenant children;
6. mount Sync and built-in feature plugins against the same injected kernel;
7. mount resources, data query, and app-owned Zero extensions;
8. mount the catch-all file router last.

Today Sync owns early database initialization, so the transition can initially keep its
physical mount order while injecting a lazy, readiness-checked reference to the same
kernel. The durable target is for an app runtime/persistence foundation—not Sync and not a
module singleton—to own database readiness. The server must not begin listening until the
runtime required by configured auth and Sync modes is ready; a transient initialization
window must not downgrade to claims-only authorization.

New internal code must never discover authority through a process-global “current app.” A
legacy no-argument `getAuthStore()`/`getTokenService()` wrapper may delegate only when one
unambiguous default runtime is active; with multiple live app instances it must require an
app-bound accessor or fail explicitly, never select the last-started runtime.

### Elysia composition rules

Use Elysia as a thin, typed controller layer around framework-independent domain services:

- use `decorate` for an immutable app-level runtime/kernel dependency and `resolve` for the
  per-request actor and authorization scope;
- make `createAuthPlugin()` consume the same named request plugin before composing protected
  child routes, so standalone auth-plugin tests and full `createApp()` perform one
  hydration rather than falling back to manual token extraction;
- keep feature plugins named so repeated use deduplicates, but include a stable version and
  configuration fingerprint where distinct configured instances could otherwise share a
  name;
- keep lifecycle hooks local/scoped by default; export only the small request auth facade
  globally;
- implement tenant, membership, role, invitation, domain, SSO, session, and audit logic as
  plain services that do not accept an Elysia `Context`;
- keep schemas/models next to each focused feature plugin and return typed status bodies;
- give the per-app runtime controller sole start/stop ownership; plugin hooks and the app
  shutdown barrier await that controller rather than independently stopping global state;
- centralize auth/domain error-to-HTTP mapping so native Elysia routes, Zero extensions,
  and file routes expose the same status/code contract;
- use a typed macro or the existing Zero registration compiler to attach normalized policy
  metadata and guards rather than hand-written `beforeHandle` checks on each route;
- keep raw Elysia plugins supported as an explicit advanced escape hatch, with a
  `createZeroAuthorizationPlugin()` adapter for authors who need them.

On the supported Elysia 1.4 line (currently lock-resolved from `^1.4.27`), the request
resolver should continue using the supported scope/export form. Elysia 2 naming or lifecycle
changes should be contained behind the Zero adapter instead of leaking into app-auth
contracts. Relevant upstream guidance is
[Elysia best practice](https://elysiajs.com/essential/best-practice),
[plugin scope and deduplication](https://elysiajs.com/essential/plugin),
[extending request context](https://elysiajs.com/tutorial/patterns/extends-context/), and
[macros](https://elysiajs.com/patterns/macro), with lifecycle and error behavior defined by
[Elysia lifecycle](https://elysiajs.com/essential/life-cycle) and
[error handling](https://elysiajs.com/patterns/error-handling).

### One request-bound auth facade

The global request resolver should expose one namespaced `access` facade and keep today's
fields as compatibility aliases. In particular, Zero extension `auth` and `user` continue
to be the conditionally narrowed `AuthContext`, so existing handlers do not break:

```ts
interface ZeroRequestAuthorization {
  readonly context: AuthContext | null;
  readonly authorization: AuthorizationScope | null;

  requireUser(): AuthContext;
  requirePlatformAdmin(): AuthContext;
  requireAuthorizationScope(): AuthorizationScope;
  requireTenant(): TenantAuthContext;
  authorize(requirement: AccessRequirement): AuthorizationScope;
  hasPermission(permission: PermissionKey): boolean;
  requirePermission(permission: PermissionKey): AuthorizationScope;
  requireAnyPermission(permissions: readonly PermissionKey[]): AuthorizationScope;
}

// Canonical new handler surface. Existing `auth`/`user` values stay intact.
context.access.context;
context.access.requirePermission('patients:read');

// Compatibility aliases, backed by the same object/resolution.
context.authContext;
context.requireAuth();
context.requireAdmin();
```

Credential parsing and live hydration happen once per request even when a nested router,
feature plugin, middleware macro, and handler all ask for auth. The resolver may be lazy,
but every consumer awaits the same request-local promise. It must never put an active
tenant in Elysia `state`, `decorate`, a module variable, or another process-wide mutable
location.

Authentication and authorization remain distinct outcomes:

- no acceptable credential: `401`;
- valid identity but no selected/valid application scope: a typed tenant-selection or
  membership error, normally `409`/`403` according to the committed API contract;
- valid scope but missing capability: `403`;
- stronger authentication required: a typed step-up result, not a generic forbidden;
- temporarily unavailable auth runtime: fail closed with a stable service error, never
  anonymous or claims-only access.

### Declarative routes and monotonic inheritance

All route surfaces should normalize into the same pure, serializable
`AccessRequirement`. This is more than sharing similar TypeScript shapes: they must call the
same merge and evaluation implementation.

```ts
// File page or layout.
export const config = {
  auth: { permission: 'patients:read' },
} satisfies RouteConfig;

// Zero-native endpoint.
export default defineEndpoint({
  method: 'POST',
  path: '/api/patients',
  auth: { permission: 'patients:write' },
  body: PatientInput,
  handler: ({ auth, zero, body }) => zero.resources.patients.create(body),
});

// Middleware matcher. Existing `role` remains the global role.
export default defineMiddleware({
  name: 'clinical-audit',
  matcher: {
    path: '/api/patients/*',
    auth: { scopeRole: ['clinician'], anyPermissions: ['patients:read', 'patients:write'] },
  },
  run: ({ auth, access, zero }) => zero.observability.emitEvent({
    level: 'info',
    category: 'app',
    code: 'app.clinical_access',
    message: 'Clinical access',
    metadata: { actor: auth?.userId, scope: access.authorization?.scopeId },
  }),
});
```

Normalization rules must be explicit:

- current `true`/`required`/`user` and `admin` shorthands retain their exact identity and
  global-platform meanings;
- current `matcher.role` remains a global role check; `scopeRole` is new and unambiguous;
- an auth/role/permission requirement implies an authenticated identity;
- protected parent layout/router requirements cannot be weakened by a child;
- required scope and all-permission sets accumulate;
- each `anyPermissions` group remains its own OR group when parent and child merge;
- the strongest MFA/step-up requirement wins;
- trusted user-property requirements keep the existing policy-safety validation and are
  not a substitute for tenant scope.

The file router compiles a root-to-leaf requirement for both page rendering and colocated
API dispatch before either handler runs. New structured/multi-mode routes inherit protected
layout requirements by default. To avoid a silent breaking change, `single/simple` may keep
the current legacy page-only layout behavior during a deprecation window, with a Doctor
warning and an explicit migration switch. `multi` cannot use that legacy mode: every API
must have a compiled effective requirement, and policy import/evaluation errors fail closed.

For SSR pages, the server restores the page session, evaluates the full requirement, and
applies private/no-store headers before a loader or render. The browser route guard uses the
same safe serialized requirement only to wait for restoration, prevent a navigation flash,
and render the appropriate transition; it is not an enforcement boundary. Function
predicates, secrets, and server-only policy data are never serialized into the route
manifest.

### Request-scoped services, resources, and background work

`context.zero` should distinguish setup-time process services from handler-time authorized
services. A handler receives:

```ts
type AuthorizedZeroServices = Pick<ServerRouteServices, 'observability'> & {
  readonly access: ZeroRequestAuthorization;
  readonly resources: AuthorizedResourceFacade;
  readonly storage: AuthorizedStorageFacade | null;
  readonly notifications: AuthorizedNotificationFacade | null;
  readonly rooms: AuthorizedRoomFacade | null;
  readonly workflows: AuthorizedWorkflowFacade | null;
  readonly platform: RequestAwarePlatformServices;
  readonly unsafe: PlatformServerServices;
};
```

This sketch is a transformation of, not an unexplained reduction of, today's
`ServerRouteServices`. The capability matrix earlier in this document must classify every
current member:

- resource/Storage/notification/workflow data operations become request-scoped facades;
- observability remains available and automatically receives safe actor/scope correlation;
- tokens, KV/counters/limiters, AI, vector, PDF, email, and scheduler expose request-aware
  operations where work is tenant-owned and explicit platform/setup operations otherwise;
- raw DB/SQL, raw auth stores/token services, and deliberately unscoped service adapters
  live under `unsafe`/setup services;
- current aliases remain in `single/simple`; multi-mode use receives a deprecation or usage
  diagnostic instead of silently disappearing.

The authorized facades close over an immutable `AuthorizationExecutionContext`. Their APIs
do not take a tenant ID from an HTTP header/body as proof of authority. Resource reads and
writes always conjoin the caller's filter with the registered realm predicate, and
framework services validate both actor and target ownership.

For compatibility, raw database handles may remain at their current paths in
`single/simple` during a deprecation period. In `multi` they should be visibly moved or
aliased under `zero.unsafe`, documented as trusted application code outside the isolation
guarantee, and reported by usage audit/Doctor where static detection is possible. Zero must
not pretend it can infer safe policy for arbitrary SQL or raw Elysia code.

Jobs, scheduled work, workflow steps, event consumers, and deferred email/storage actions
receive an explicit execution context containing the actor/system provenance, scope ID, and
authorization revision. Enqueue validates and seals the context; execution revalidates it
according to the operation's lifetime. A privileged system context is a separate,
auditable capability—not a fabricated user request and not a bare tenant ID.

### Multipart and early authentication

The earlier authenticated-Eden multipart defect reinforces a wider integration rule: every
official transport must use the same credential owner and restoration/switch barrier.
Typed Eden calls, normal client fetch, progress-upload XHR, resource uploads, native calls,
and extension messages must not each read and attach tokens independently.

Elysia parses multipart bodies before a normal `beforeHandle` authorization guard. For a
protected file endpoint, the registration compiler should attach an early request/parser
boundary credential guard that rejects an absent or invalid session before accepting a
large body, while retaining full live scope/permission evaluation before the handler. Both
stages reuse the same request-local resolution promise, so a file is not authenticated
twice. This behavior must be proven against Zero's supported Elysia version and covered by a
test that confirms an unauthorized oversized/malformed upload is not consumed.

Transient application uploads should remain ordinary typed endpoints with bounded `t.File`
schemas (or a small `defineUploadEndpoint` convenience), not be forced into durable Zero
Storage. The client upload transport should own credential refresh, abort, progress, and
authorization-epoch stamping. Direct `client.token`/manual `Authorization` workarounds can
then be deprecated without changing endpoint contracts.

### Built-in plugin and escape-hatch rules

Every built-in Zero plugin that touches user or app data must declare its realm and consume
the injected authorization kernel. Notifications, rooms, workflows, Storage, state Sync,
ephemeral topics/presence, scheduler handoff, and future plugins may add domain-specific
checks, but cannot implement a second identity or tenant resolver.

Raw Elysia plugins remain useful and supported. In multi-tenant mode:

- `createServerRoute()` and `createZeroAuthorizationPlugin()` provide the safe typed path;
- raw plugins mounted through the Zero loader receive the shared resolver but must declare
  access for protected routes;
- usage audit should warn about raw routes or direct raw database access it can identify;
- the documentation must label unrestricted raw code as a privileged escape hatch;
- Zero does not claim tenant isolation for arbitrary code that deliberately bypasses the
  scoped services.

### Startup, Doctor, and public type contract

Configuration errors should stop `createApp()` before listening, and Doctor should emit the
same stable diagnostic codes for local/CI inspection. Blocking validation includes:

- mode-incompatible tenant or permission declarations;
- unknown role/permission keys, reserved owner misuse, or unsafe wildcard grants;
- contradictory/duplicate realm registrations, missing tenant columns, writable tenant
  discriminators, and client-visible unclassified tables in `multi`;
- unsafe user properties referenced by middleware/resources/Storage;
- verified-domain defaults outside the allowed mode/role sets, unsafe/unknown request or
  automatic roles,
  account creation without a real mailbox-challenge path, non-exact coverage in the first
  implementation, or `trusted-sso` selected without connector-specific proof semantics;
- SSO without canonical public URL, encrypted secret storage, tested recovery policy, or a
  closed bootstrap path;
- enabled control sections whose backing capability/permission is unavailable.

Doctor/usage audit should additionally flag detectable raw Elysia routes without declared
access, raw `zero.db`/`zero.sql` use near scoped code, unscoped built-in service calls,
manual `Authorization`/`client.token` patterns, missing tenant-leading indexes/foreign keys,
legacy `requireAdmin()` inside tenant-control code, and role-name checks where a declared
permission is expected. It should also report stale/reverification-failed domain claims,
claim conflicts/quarantines, legacy users lacking eligible mailbox-proof provenance, and a
Public Suffix List older than the framework's supported update window. These warnings do not
pretend static analysis can prove arbitrary code safe.

The type migration must converge today's separate contracts rather than add another one:

- extend `ZeroAuthRequirement`, middleware matchers, and conditional `ZeroLifecycleUser`
  around the shared `AccessRequirement` while preserving inference for old strings;
- replace the file router's loose `LoaderContext.auth` shape with the shared `AuthContext`
  and typed access/scope fields;
- extend `ResourcePolicyUser` with application scope, roles, and permissions while retaining
  its existing global `role` meaning;
- preserve `authenticatedOnly()`, `adminOnly()`, and current owner-policy
  behavior; the proposed scoped helpers ultimately shipped as the unified
  `authorizationPolicy(requirement)` adapter;
- export server-only config/runtime/policy types from server-safe auth entries and only
  sanitized snapshot/hooks from browser entries.

Compile fixtures are required for `defineEndpoint`, inherited routers, `defineMiddleware`,
the raw Elysia macro, `RouteConfig`, resources, old application source, and all four config
profiles. Package export/distribution tests must prove that browser and component entries do
not pull in database stores, secrets, or server-only Elysia runtime code.

### Framework-integration acceptance tests

Before the feature is production-ready, tests must cover:

- all four profile combinations and unchanged compile/runtime fixtures from current apps;
- plugin naming/deduplication, lifecycle ordering, scope propagation, and two app instances
  in one process without runtime cross-talk;
- one hydration per request through nested routers/plugins;
- one hydration for protected auth-root routes such as current-user and admin operations,
  with no parallel `extractAuthContext()` path;
- identical policy decisions and error codes across Elysia endpoints, Zero extensions,
  file API routes, SSR pages, resources, data query, and Sync;
- monotonic parent/child policy merging and server/hydration route-guard parity;
- browser Bearer identity versus page-cookie identity boundaries;
- multipart rejection before body consumption and refresh during an upload;
- authorization changes during handler execution, socket replay, and background work;
- raw-plugin diagnostics and explicit unsafe-service behavior;
- package exports and browser-safe dependency graphs for every new public helper.

## Tenant resolution and switching

### Identity login

Authentication first establishes the global identity and applies account, email, password,
and MFA gates. It does not accept a tenant hint as authorization.

Then:

- zero active memberships: show permitted create/request/join choices;
- one active membership: bind it automatically unless policy requires confirmation;
- multiple active memberships: use a tenant chooser;
- an incoming tenant hint: validate that exact active membership, then bind it;
- an SSO connection flow: validate the connection and resulting membership, then bind its
  tenant.

If the normal login/MFA pipeline reaches a multi-membership choice before a full app session
should exist, return a `tenantSelectionRequired` completion result backed by a short-lived
transition token. The existing transition-token mechanism is the right primitive, but the
growing password, verification, MFA, invitation, SSO, tenant-selection, and native
continuation decisions should be coordinated by a dedicated auth-completion service rather
than accumulated as conditionals in the MFA response path.

### Binding

The server issues or rotates a session with immutable tenant and membership IDs. A mutable
slug is never the stored authorization identity. Page sessions, access tokens, refresh
records, native refresh families, and Sync all resolve to the same bound context.

### Switching

Expose a server-validated operation such as `POST /auth/tenants/:tenantId/switch`:

1. require a valid current identity session;
2. load the requested active tenant and active membership;
3. verify the session's authentication provenance is trusted for the requested tenant;
4. enforce tenant/account policy and any fresh MFA/SSO requirement;
5. issue the replacement browser/native session and revoke or version the old `sid`;
6. return the new user/tenant context;
7. force Sync authorization restart and purge data outside the new scope.

A switch is not a client-side change to a header or local variable.

A locally authenticated session may switch among permitted memberships, except that entering
an `ssoRequired` tenant needs that tenant's step-up. A session authenticated by tenant A's
IdP may not switch into tenant B merely because the global user also belongs to B; it must
reauthenticate with a globally trusted method or tenant B's accepted connection.

### Routing hints

Subdomain, path, and explicit tenant-picker routing can be added as resolvers. Each produces
only a candidate tenant. The authenticated session must match that candidate before tenant
data is rendered or returned. Host-header handling must use configured trusted origins and
proxy rules. If host, path, session, and explicit hints disagree, reject the request rather
than silently choosing a precedence order.

## Authorization and policy composition

The authorization model answers “may this application scope perform this class of action?”
Row/resource policy then answers “on which records?” In multi mode, the tenant realm is an
additional unconditional isolation boundary. Every applicable check must pass.

### Schema-adjacent, server-owned declarations

Access control should be authored beside the table it protects, but not as
client-authoritative field metadata. Zero's shared `defineTable()`/`schema()`
objects are imported by browser code for validation and UI metadata. Putting
executable policies, server dependencies, or internal realm details directly
inside that shared object would create bundling/disclosure problems and invite
the false idea that browser metadata enforces access.

The implemented compatible foundation uses today's server-only
`defineResource()` declaration. It accepts a typed table definition, records a
mandatory multi-mode realm, explicit client exposure, and discretionary policy,
then compiles those into the sealed registry used by every managed data
transport. Exposure is `internal`, `http`, `sync`, or `all`. Multi mode requires
it explicitly; single mode preserves omitted-as-`all` compatibility. Table
`_sync`/`syncDefaults` still decide loading strategy rather than authority:
`sync` exposure must stay full, while lazy or auto-lazy Sync hydration requires
`all` because it also reads through `/api/data`.

```ts
// db/patients.ts — safe to import on server and client
export const patients = defineTable('patients', {
  tenant_id: field.text({ required: true }),
  assigned_to: field.text(),
  name: field.text({ required: true }),
}, { sync: 'lazy' });

// server/resources/patients.ts — current server-only declaration
export default defineResource({
  table: patients, // derives table name, primary key, and typed column names
  exposure: 'all', // lazy Sync hydration plus HTTP resource/data access
  realm: tenantRealm({ field: 'tenant_id' }),
  policy: {
    list: authorizationPolicy({
      tenant: 'required',
      permission: 'patients:read',
    }),
    get: authorizationPolicy({
      tenant: 'required',
      permission: 'patients:read',
    }),
    create: authorizationPolicy({
      tenant: 'required',
      permission: 'patients:create',
    }),
    update: allOf(
      authorizationPolicy({
        tenant: 'required',
        permission: 'patients:update',
      }),
      ownerPolicy({ userField: 'assigned_to' }),
    ),
    delete: authorizationPolicy({
      tenant: 'required',
      permission: 'patients:delete',
    }),
  },
});
```

Realm enforcement remains outside discretionary `policy`; `anyOf(adminOnly(),
ownerPolicy(...))` must never reopen another tenant. The browser receives only
a sanitized server-evaluated capability projection for controls such as
create/edit/delete—never evaluators, tenant predicates, callback source, or
secrets. UI capability gating improves ergonomics but never replaces backend
enforcement.

The startup boundary now validates each discriminator in both declared schema
and SQLite's actual `PRAGMA table_info`, then seals the registry. Managed CRUD
and Sync writes stamp the field, reject update input containing it, repeat the
tenant predicate in the final SQL statement, and atomically verify the stored
postcondition. `/api/data`, generated CRUD, and Sync revalidate live authority
after asynchronous policy work before their final read/write boundary.

Field-level resource declarations are now implemented as frozen allow-lists.
The same `fields.read/create/update/filter/sort` contract applies to CRUD,
`/api/data`, Sync snapshot/catch-up/live/ack delivery, local caches, packaged
forms, and cache-backed exports. Server-only realm, owner, and policy columns
remain available for enforcement before output projection. See
[`../framework/resource-policy.md`](../framework/resource-policy.md#field-projection-and-client-writes).

Recommended evaluation order:

1. valid global account;
2. valid application authorization scope;
3. in multi mode, valid active tenant and membership;
4. required simple role or advanced permission;
5. resource constraints, ownership, and request-specific policy;
6. in multi mode, tenant row constraint as an unconditional final boundary.

Examples:

```ts
route.get('/patients/:id', ({ requirePermission, zero, params }) => {
  requirePermission('patients:read');
  return zero.resources.patients.get(params.id); // request scope is injected
});

defineResource({
  table: patients,
  exposure: 'all', // HTTP resource/data routes plus lazy Sync
  realm: tenantRealm({ field: 'tenant_id' }),
  policy: allOf(
    authorizationPolicy({
      tenant: 'required',
      allPermissions: ['patients:read', 'patients:write'],
    }),
    ownerPolicy({ userField: 'assigned_to', create: 'stamp' }),
  ),
});
```

The tenant scope is not just another `allOf` member that a custom `anyOf` can accidentally
override. It is applied outside discretionary policy so no role or owner rule can reopen a
different tenant's row.

Scope and ownership fields also need mutation rules. `tenant_id` is immutable through
ordinary CRUD. An owner field stamped on create cannot be reassigned merely because the
current owner may update the row; transfer requires a separate explicit permission/action.
Update/delete persistence should include the authorized tenant/row predicate in the mutation
itself, avoiding a check-then-write window between loading a row and changing it.

Page and server middleware configuration should gain an object form while preserving the
current strings:

```ts
export const config = {
  auth: { tenant: 'required', permission: 'patients:read' },
};
```

## Table security and scope enforcement

Do not compress several security decisions into one `scope` enum. Every table known to the
runtime registers three independent axes:

1. **Realm/isolation**: `global`, `identity` with a trusted user column, or `tenant` with a
   trusted tenant column.
2. **Client exposure**: `internal`, `http`, `sync`, or `all`.
3. **Mutation/authorization policy**: server-only versus permitted generated/Sync actions,
   followed by permission, owner, metadata, and custom policy.

“Internal” is an exposure choice, not an ownership realm. “Public” is an authorization
choice, not proof that a row is global. Ownership is a discretionary resource policy layered
inside the mandatory identity/tenant realm, not a fourth realm that can weaken isolation.
Full/lazy/auto is a separate loading strategy: a Sync-only resource must be guaranteed
full, while lazy Sync needs `all` so it can hydrate through `/api/data`.

The registry records trusted scope columns and create-stamping behavior. It must be used by
all framework-managed access paths. Unknown/contradictory classifications fail enabled-mode
startup.

Every independently queryable or synchronized tenant-owned row needs a direct tenant
discriminator because current Sync row filters evaluate one row without joins. This includes
storage objects, notification receipts, room members, and workflow steps/events—not only
their parent drive, notification, room, or workflow instance. Parent/child writes use
composite tenant-aware foreign keys and reject cross-tenant references. A future proven
join-capable compiler could relax duplication, but parent-derived scope is not safe in the
current transport.

| Access path | Required enforcement |
| --- | --- |
| Generated list/get | inject tenant predicate before app filters |
| Generated create | server-stamp active tenant; reject incompatible caller value |
| Generated update/delete | constrain the lookup and mutation by tenant |
| `/api/data` | use the same compiled resource/table scope |
| Sync snapshot | select only rows in active scope |
| Sync catch-up/live fan-out | filter current and previous row by active scope |
| Sync mutation | constrain target row; stamp inserts; block tenant-column reassignment |
| Server service API | require an explicit `AuthorizationExecutionContext` or scoped service |
| Storage/blob metadata | scope metadata and permission grants before adapter operations |
| Background jobs/workflows | persist tenant context and restore it explicitly when executing |

Raw `db` access cannot be made magically safe, and Doctor cannot prove that arbitrary SQL
contains every required predicate. In tenancy mode, normal route/job context should lead
with `zero.tenant` scoped repositories/services. Move unrestricted handles behind an
explicitly privileged surface such as `zero.unsafe.db/sql` (or require an explicit
`unsafeRawDataAccess` capability), while preserving current `zero.db` compatibility when
tenancy is off and providing a deprecation path for existing apps. Framework code must avoid
the escape hatch entirely.

The threat model trusts application server code and deployment operators; Zero does not
sandbox code running in its own process. The tenant-isolation guarantee covers framework-
managed HTTP/data/resource/Sync/platform-service paths and scoped repositories, not a
malicious plugin with raw database or filesystem access.

Because arbitrary custom policy may be asynchronous, it can run before persistence, but it
cannot be the sole isolation check. The final write uses tenant-constrained conditional SQL
or compare-and-set plus current authorization-generation checks inside the database
transaction. This closes row/membership changes that occur while an async policy is
awaiting.

## Onboarding model

Identity registration and tenant onboarding are separate policy decisions.

### Tenant creation policy

- `authenticated`: any eligible verified user may create a tenant;
- `platform-admin`: only a platform administrator may create one;
- `disabled`: tenants are provisioned through code/admin integration only.

Creation and initial owner membership must be one transaction. A tenant cannot exist without
an active owner unless it is explicitly in a provisioning state.

**Implemented foundation:** `auth.tenancy` now resolves immutable terminology and the
three creation modes above. Initial multi-tenant bootstrap always creates its first tenant
and protected owner atomically, independent of the later policy. Ordinary registration may
create only an identity; eligible zero-membership completion returns a hashed-at-rest,
expiring, application-bound, single-use onboarding continuation and no application
credential. `POST /auth/tenants/create` derives user, actor, and owner from that proof or a
current browser refresh family. Tenant, owner, proof consumption/refresh rotation, bound
parent session, and refresh child share one transaction. Registration with explicit tenant
input remains an optional policy-checked one-step path. Exact-email invitations, retained
join requests, and request-only verified-domain admission described below are now
implemented; domain-created identities, autojoin, aliases, and direct transfer remain
future work.

### Invitation

The safe default and first implementation target:

1. an authorized tenant member creates an email-bound invitation;
2. Zero sends/stores only the one-time link according to existing email infrastructure;
3. an unauthenticated recipient may register or an existing user may sign in;
4. Zero verifies that the account controls the invited email;
5. invitation consumption and membership/role creation are atomic;
6. active sessions are reissued into the tenant only after all account gates pass.

Invitation possession does not silently weaken the configured email-verification policy.
If a deployment intentionally treats the email-delivered invitation as verification, that
must be an explicit documented policy with equivalent token and expiry guarantees.

### Verified company-domain onboarding

The intended experience is: Alice creates the Acme tenant with `alice@company.com`, Zero
offers “Verify `company.com` to make coworker onboarding easier,” and after Acme proves the
domain, Bob can verify `bob@company.com` and join or request access without exchanging a
secret or waiting for a hand-created account. Alice's verified mailbox alone must not make
her the owner of the entire domain; only domain control authorizes Acme to publish an
admission policy for other `@company.com` identities.

Domain membership is an **admission convenience**, not enduring authorization or proof of
employment. A membership, role, session, and every later request still use the normal Zero
authorization system. Changing a user's email or losing domain proof does not silently
remove an existing membership. Deployments that need continuous workforce lifecycle control
should enforce the tenant's SSO connection and eventually use SCIM/deprovisioning.

#### Initial claim setup

After tenant creation, Zero may derive an exact candidate domain from the creator's current
email proof and show a non-blocking setup card. It must suppress this prompt for public
consumer-mail domains, malformed/reserved domains, public suffixes, and email evidence that
was merely assumed because verification was disabled. The tenant can still invite coworkers
normally without claiming a domain. An existing user with only the legacy assumed timestamp
gets a one-time “verify your work email” action; this adds proof provenance without changing
or blocking their otherwise-compatible login state.

The suggested suffix is only a convenience prefill. An authorized tenant member (the owner
by default) may enter a different company domain—for example, an IT administrator using a
consulting address—but must hold the domain-verification permission and complete the same
DNS proof. Conversely, a matching creator email never skips DNS proof.

The domain setup ceremony is:

1. an authorized tenant member with `tenant:domains:verify` requests an exact canonical-
   domain claim;
2. Zero returns a one-time DNS TXT name/value and records only the challenge digest;
3. the actor/domain operator publishes it and asks Zero to verify;
4. Zero checks the live challenge, canonical claim uniqueness, tenant status, actor
   permission, and challenge expiry before transactionally activating the claim;
5. an actor with the appropriate onboarding permission selects a discovery/admission policy
   no broader than application config, plus request/automatic roles from their separate safe
   allow-lists;
6. Zero records the policy revision and audit event, then periodically revalidates proof.

Challenge creation and verification are rate-limited and idempotent. Zero derives the TXT
record name; it does not accept an arbitrary lookup URL/record target. DNS work uses bounded
timeouts, answer sizes/counts, retry/backoff, and a single leased worker per due claim across
runtime replicas so a tenant cannot turn “check again” into an outbound-resource loop.

DNS TXT should be the initial universally understandable proof mechanism. A future
`trusted-sso` proof is acceptable only for a connector that independently establishes the
tenant administrator's control of that domain. An arbitrary OIDC `email`,
`email_verified`, hosted-domain, or group claim is not domain-ownership proof.

#### Separate discovery, account creation, and admission

These are independent decisions, so the configuration and tenant UI should not collapse
them into one “domain enabled” switch:

| Decision | Choices | Safe default |
| --- | --- | --- |
| Discovery | hidden, or reveal a safe tenant summary only after mailbox proof | after mailbox proof |
| Identity creation | disabled, or allow through a purpose-bound verified-domain continuation | disabled unless the app explicitly enables it |
| Tenant admission | invitation-only, request-to-join, or auto-join | request-to-join |
| Request approval role | app allow-list intersected with the reviewer's grantable roles | the app's least-privileged member role |
| Automatic join role | fixed tenant selection from the app's narrower safe allow-list | the app's least-privileged member role |

`request-to-join` is the recommended out-of-box experience: after proving
`bob@company.com`, Bob sees “Request access to Acme,” authorized reviewers receive a tenant-
scoped request, and approval creates the membership. `auto-join` is a deliberate app-and-tenant
opt-in for teams that value zero-touch enrollment. It may never assign owner, platform
authority, a system role, `allPermissions`, or a browser-submitted role. `invitation-only`
allows a verified domain to route sign-in/SSO or show instructions without granting a new
membership. Automatic joins remain visible as a distinct member source, produce the normal
tenant audit event, and can trigger owner/security notifications according to tenant policy.

Role handling differs deliberately by mode. A request starts with the tenant's configured
`defaultRequestRole`; on approval, the reviewer may choose only from
`allowedRequestRoles` intersected with roles that actor may grant. The requester never asks
for or submits a role. Automatic admission uses one role selected in advance from the
usually narrower `allowedAutoJoinRoles` and revalidates it at commit. Both defaults must be
members of their corresponding allow-list at startup and after role-template changes.

Application configuration is the ceiling. A tenant may hide discovery, turn automatic join
into approval, or turn all domain admission off, but tenant UI/API cannot widen the app's
allowed modes, domain-verification/mailbox-proof sources, account-creation policy, or roles.
This keeps the feature
declarative for an app author while still letting each customer choose a stricter posture.

#### Coworker registration and join flow

The email-first flow must not disclose a private tenant before the person proves the
mailbox:

1. accept the candidate email for a new registration, or use the signed-in identity's live
   primary email; return a generic response, rate-limit by network/domain/address,
   and send the dedicated domain-onboarding mailbox challenge, whose completion cannot issue
   a login session;
2. after proof, create or resume a short-lived, single-use, purpose-bound onboarding
   transaction containing the existing user ID/email generation or a pending-registration
   proof reference, eligible exact domain, claim/policy revision, and validated
   continuation—not a caller-selected tenant or role;
3. apply precedence in this order: existing active membership; suspended/removed/blocked
   relationship; explicit reactivation/reinvitation; exact invitation; tenant-bound SSO
   continuation; verified-domain admission; then generic create/request choices;
4. if exactly one current claim is eligible, show its safe tenant name and the configured
   action; if more than one legitimate path remains, show an explicit chooser and never
   pick by ordering;
5. immediately before mutation, re-read the user/email proof, domain and tenant status,
   SSO requirement, admission policy/revision, safe role, invitation/membership state, and
   authorization generations;
6. atomically create one join request or membership, record its source, advance relevant
   generations, and append the audit event. Retries return the same logical result.

An exact invitation wins over the domain default because it may intentionally grant a
different safe role. An existing membership is never duplicated or downgraded. Repeated or
concurrent requests cannot create multiple pending requests/memberships, spam reviewers, or
bypass a denial/cooldown policy.

A suspended or removed membership, active tenant-specific admission block, or denied request
cooldown is a hard stop for request-to-join and auto-join. Merely proving the mailbox again
cannot reverse an administrator's decision. Reactivation requires a distinct authorized
tenant action or an invitation explicitly issued for reactivation, preserving the same
membership row and audit history; an ordinary domain continuation cannot supply that intent.

For an unauthenticated proof, an email collision with an existing global account yields an
authentication/recovery continuation, never that account's session or a newly attached
proof. The user signs in and passes current MFA/account gates before Zero binds the proof and
resumes the same purpose. Mailbox possession alone is not an account-linking credential.

If public registration is disabled, proving a matching company mailbox does not by itself
open global registration. New identity creation proceeds only when the application has
explicitly enabled verified-domain account creation; otherwise the user needs an invitation,
pre-existing identity, or allowed tenant SSO JIT path. The registration endpoint consumes
the opaque onboarding transaction and derives tenant/domain/role server-side.

For an allowed new local identity, the continuation fixes the proven email while the normal
registration UI collects the remaining username/password/profile fields and applies the same
password, account-status, MFA, consent, and abuse controls as ordinary registration. For an
allowed SSO-only identity, the shared proposed credential-optional identity path applies
once implemented; current Zero user creation still always creates a password credential.
Domain onboarding must not fabricate a password or turn password reset into an SSO bypass.

Implementation needs a proof-consuming registration transaction rather than calling today's
`createRegistrationUser()` unchanged. That transaction locks registration, revalidates and
consumes the exact pending proof, rechecks canonical email/username uniqueness and the live
domain policy, creates the user and credential, writes the user-bound proof, projects the
compatible `emailVerifiedAt` from the real proof time, and creates the join request or
eligible membership. It must not send a second verification message for the same proof. If
the canonical email became occupied before commit, the whole transaction fails without
attaching proof or membership to the existing account and continues through normal sign-in/
recovery. MFA/other account gates still complete before any tenant-bound session is issued.

Version one uses Zero's single globally unique canonical/primary email. For an existing
identity, domain matching therefore uses that current primary email only; domain onboarding
does not add an alias or silently replace the login/recovery address. A user whose account
currently uses `bob@gmail.com` can accept an invitation addressed according to tenant
policy, explicitly link the tenant's SSO connection while authenticated, or use an
admin-supported email update. Zero does not currently package a self-service primary-email
change ceremony. If added, it must require recent auth, prove the new address before commit,
recheck uniqueness, notify the old address, advance email/security generations, invalidate
old proofs/sessions, and then rerun domain admission explicitly. A future secondary-email
model would need its own global uniqueness, proof generation, recovery/linking, display, and
removal rules and should not be smuggled into this feature as an unmodeled string.

#### Domain and mailbox matching rules

- Store and compare a lowercased canonical DNS A-label, remove a terminal dot, and compare
  complete labels. The first release accepts explicit ASCII A-label input; accepting Unicode
  U-label input waits for the shared IDNA canonicalizer described above. A suffix string
  check must never make `evilcompany.com` match `company.com`.
- Use the Public Suffix List to reject claims such as `com` or hosted multi-customer suffixes,
  but do not mistake “registrable” for proof of organizational ownership. DNS proof remains
  mandatory.
- Reject IP literals, single-label/local names, reserved/test names in production, malformed
  labels, unsafe lengths, and configured shared consumer-mail providers.
- Version one matches the exact verified domain only. Verify `subsidiary.com`, aliases, and
  `team.company.com` as separate rows. Do not infer parent, child, wildcard, subsidiary, or
  brand ownership from one proof.
- A later `includeSubdomains` feature requires explicit parent-zone proof, warnings for
  delegated child zones, and non-overlap constraints. It must remain off by default.
- Join decisions use the live canonical email and active email-proof generation from server
  persistence. Never trust a submitted tenant/domain, request header, URL suffix, stale JWT
  email, legacy truthy `emailVerifiedAt`, or an unconfigured IdP claim.
- Proof source matters. A delivered email-link or specifically configured connection-bound
  IdP proof can qualify; an administrative “mark verified” shortcut does not qualify for
  automatic joining by default.
- Proof freshness is an admission rule distinct from the account's ordinary verified-email
  gate. If the proof is older than the configured `mailboxProof.maxAge`, Zero requests a new
  challenge before revealing or executing the current domain option.

#### Domain-management authority

The auth plugin should register stable tenant control-plane permissions and enforce them
through the same Elysia access evaluator and request-bound services as every other tenant
operation. No route should infer this authority from a role name or a visible settings tab.
The recommended initial split is:

| Operation | Required tenant permission | Additional safeguard |
| --- | --- | --- |
| View claims and health | `tenant:domains:read` | safe/masked metadata only |
| Create a claim, issue/check DNS, retry revalidation | `tenant:domains:verify` | active tenant; rate limits |
| Disable discovery, select invite/request mode, or manage request policy | `tenant:onboarding:manage` | policy revision check |
| Enable domain account creation or auto-join; change auto-join role | `tenant:onboarding:automatic-manage` | recent auth; app ceiling/safe role recheck |
| Read and decide join requests | `tenant:join-requests:review` | actor may grant only the resulting role |
| Release or transfer a verified claim | `tenant:domains:transfer` | recent auth, confirmation, cooldown, owner notification |

In `multi/simple`, Zero maps these to the fixed templates: owner receives all; admin may
receive read/verify/review and ordinary onboarding management; transfer and enabling the
broadest admission/account-creation settings remain owner-only by default through the
separate permissions above, not a handler role-name check. In
`multi/advanced`, the app may deliberately assign the registered permissions to other role
templates, but recent-auth, app-ceiling, safe-role, and transfer safeguards still apply.
Platform admin status supplies none of these permissions without an ordinary membership or
an explicit active break-glass elevation.

#### Ownership lifecycle, conflicts, and recovery

One canonical exact domain can drive active discovery/admission for only one tenant in the
application. Enforce that with a database uniqueness invariant, not an application-only
check. Multiple pending challenges may race, but activation has one winner; the loser enters
a non-enumerating conflict state and cannot discover or admit users.

This means version one has one domain “home tenant.” A company that legitimately owns
several tenants uses invitations, tenant-specific links/SSO, or separately verified aliases
for the additional tenants. Supporting one organizational owner that intentionally shares a
domain across child tenants is a later explicit model with an after-proof chooser and common
administration boundary—not multiple unrelated tenants independently claiming the suffix.

Domain claims are leases over verified control, not permanent assets. Periodic
reverification, tenant suspension, explicit revoke, stale proof, or a conflict immediately
stops new discovery and admission. It does not automatically eject or re-role existing
members; Zero records impacted domain-sourced memberships for owner review. Membership
removal remains an explicit policy/action so transient DNS failure cannot lock out an entire
company.

Releasing or transferring a verified domain requires fresh proof, a quarantine/cooldown,
notification to the current tenant owners, platform-assisted conflict resolution when
necessary, and complete audit history. It never moves existing users or memberships to the
new tenant. Alias removal has the same future-admission semantics. Sensitive policy changes,
including enabling auto-join or changing its role, should require recent authentication and
optimistic policy-revision checks.

Revoke/release is a state transition, not hard deletion. Historical claims remain as
tombstones for membership-source and audit integrity; the database uses a partial uniqueness
constraint over claim states currently allowed to discover/admit, with transfer/cooldown
records preventing an old row from being mistaken for active authority.

Audit events include claim requested, proof success/failure, revalidation, conflict,
policy/role/account-creation change, revoke/release/transfer, join request decision, and
automatic membership creation. Store stable IDs and safe reason codes; do not store the
plaintext DNS challenge, onboarding token, unnecessary email content, or SSO assertion.

#### Interaction with tenant SSO

A verified domain may route a proven user to a tenant's SSO connection, but routing is not
authorization. If Acme requires SSO, `bob@company.com` continues into Acme's tested SSO
connection and cannot join or enter the tenant using mailbox proof alone. Domain readiness
and SSO readiness are separate states in configuration and UI.

SSO JIT with `approved-domain` still requires a validated, connection-bound external
identity and an allowed mailbox-proof source. A claim from tenant A's IdP can never use a
matching email/domain to enter tenant B. Conversely, an email-first discovery hint does not
link global identities or select an upstream subject; the existing connection/issuer/subject
linking rules remain authoritative.

Domain handling should follow the [IDNA definitions in RFC 5890](https://www.rfc-editor.org/rfc/rfc5890.html)
and a pinned, routinely updated [Public Suffix List](https://publicsuffix.org/). The suffix
list establishes delegation boundaries; it does not replace DNS ownership verification.
Mailbox proof, canonicalization, anti-enumeration, and email-change work should follow the
[OWASP Email Validation and Verification guidance](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html).

### SSO JIT

Each connection chooses one of:

- disabled: SSO can authenticate only pre-existing linked memberships;
- invitation-only;
- approved-domain;
- open for that specific tenant connection.

JIT creates or links the global identity and tenant membership in a transaction after token
validation. Role assignment is a configured safe default; arbitrary upstream role/group
claims do not become Zero permissions unless an explicit, allow-listed mapping exists.

For an application-owned connection in `single` mode, JIT creates/links the identity and
binds the application authorization scope under its separately configured admission policy;
it does not create a synthetic visible tenant or bypass identity-registration policy.

### Admin provisioning

Tenant administrators can create invitations/memberships only inside their own tenant and
only with roles they are allowed to grant. Platform administrators manage global identities
and tenant control state through separate APIs and UI.

### Bootstrap separation

In `single/simple`, bootstrap now defaults to the closed secret-gated ceremony;
the legacy first-request-wins behavior requires explicit `bootstrap: 'public'`
configuration and produces a Doctor warning. In `multi`, successful bootstrap
must atomically create the first platform administrator, initial organization,
owner membership, and active tenant context in one transaction before the
durable completion marker is written. It must never be possible to win the
platform administrator role through public registration. Later tenant creation
remains a separate action and must not silently redefine every existing user as
a member of every future tenant.

## Upstream enterprise SSO design

### Tenant-owned identity-provider trust boundary

A tenant-managed IdP must not authenticate a user into unrelated tenants attached to the
same global Zero identity. If a user belongs to A and B, tenant A controls its own IdP and
could be compromised or malicious. Its assertion is authority for A's configured
connection—not a globally trusted credential for B.

In `single` mode the same connection machinery is owned by the application authorization
scope and no tenant chooser appears. The connection-scoped identity key and provenance
rules still apply so a future move to `multi` cannot retroactively turn an application IdP
into global cross-tenant authority.

Consequences:

- every enterprise SSO session is bound to the connection and its owning application or
  tenant authorization scope;
- in multi mode it exposes and enters only that tenant;
- switching elsewhere requires local/global reauthentication or the target tenant's SSO;
- a locally password-authenticated user entering an SSO-required tenant performs that
  tenant's step-up;
- SSO logout or SCIM deactivation revokes the connection/tenant sessions and membership,
  not the person's unrelated tenants;
- no upstream group or claim may grant platform administrator or tenant owner by default.

### Protocol order

1. OIDC Authorization Code flow first.
2. SAML 2.0 after the OIDC connection model and tenant onboarding are stable.
3. SCIM 2.0 provisioning/deprovisioning after membership APIs and audit behavior are stable.

OIDC is an authentication layer on OAuth 2.0; Zero is the Relying Party for this feature.
The implementation should use provider discovery where supported, exact issuer matching,
Authorization Code flow, PKCE, state, nonce, strict redirect handling, and full ID-token
validation. Current OAuth security guidance deprecates weaker flow patterns and informs
redirect, token, and PKCE handling.

Use mature protocol libraries rather than handwritten JWT/XML-signature validation. Protect
OIDC discovery, JWKS, and SAML metadata fetching against SSRF, unsafe redirects, oversized
documents, unavailable endpoints, and stale signing material. SAML should begin with
SP-initiated login and validate signature, issuer/entity, audience, recipient/destination,
time bounds, and single-use `InResponseTo` correlation. IdP-initiated SAML can wait until
the transaction and login-CSRF boundary is proven.

### Login discovery

Supported entry points can include:

- a tenant-specific login URL/button;
- a connection-specific login URL;
- email-first discovery using a uniquely verified domain;
- a tenant chooser for an already authenticated multi-membership user.

Discovery responses must avoid exposing whether a particular private user, tenant, or domain
claim exists. Before mailbox proof, return only a generic delivery/continuation result. After
mailbox proof, the shared onboarding transaction may reveal the one safe tenant summary and
action authorized by the current verified-domain policy. Email-domain discovery selects a
connection/admission candidate; it does not link an identity, create a membership, or bypass
tenant SSO authorization.

### External identity key and linking

The durable identity key is `(connection, issuer, subject)`. Email is mutable and may be
recycled; it is not an external subject identifier.

Safe linking order:

1. use an existing exact external-identity link;
2. accept a valid invitation bound to a verified matching email;
3. let an already authenticated user explicitly link the connection;
4. allow configured JIT creation/linking only with validated issuer, subject, and suitable
   verified-email evidence;
5. otherwise stop for administrative resolution.

Never silently merge accounts on an unverified email claim.

New JIT-provisioned identities must be creatable without a password credential. Password
reset must not create a local-login bypass for an SSO-only identity unless explicit policy
allows it. Before enabling any email-assisted linking, deployments must resolve legacy
canonical email collisions rather than choosing one matching account.

Because the current schema requires a globally unique non-null username, the first federated
slice may generate an opaque, collision-safe internal username and mark local/password login
disabled. It must not derive a guessable alternate credential from email. A later schema can
separate public profile handles and login identifiers cleanly; either way, absence of a
`_credentials` row is a supported state and login/reset code must handle it deliberately.

Provider group/role mappings need source ownership. Removing an upstream group removes only
assignments managed by that connection; it must not erase manually assigned roles or roles
managed by another source. JIT defaults to the least-privileged membership role and never
creates a tenant owner or platform administrator.

### MFA and assurance

By default, upstream SSO satisfies the primary authentication step but does not silently
disable Zero's account/MFA policy. A connection may map acceptable `acr`/`amr` assurance to
the local MFA requirement only through explicit configuration. Sensitive operations may
still require a local step-up.

### Tenant SSO enforcement and recovery

A tenant may require its connection for members, but rollout needs safe recovery:

- test/verify a connection before enforcing it;
- preserve an explicit, audited break-glass path;
- do not lock out the last owner during configuration;
- support connection disablement and key/client-secret rotation;
- display enough connection health to diagnose failures without exposing secrets.

### Browser callback and local session handoff

After validating the upstream callback, Zero should issue a short-lived, single-use local
handoff code. The callback page exchanges that code for the normal Zero auth result and
page-session cookie, then clears the code from browser history. Do not place Zero access or
refresh tokens in callback URLs. Setting only the existing HttpOnly page cookie is also not
enough because that cookie intentionally cannot authenticate browser API calls; the browser
SDK still needs the normal session result through a protected exchange.

The same completion pipeline can resume an invitation, tenant chooser, or pending native
authorization request after account, membership, MFA, and tenant binding have succeeded.

### Protocol references

- [OpenID Connect Core 1.0, errata set 2](https://openid.net/specs/openid-connect-core-1_0.html)
- [OAuth 2.0 Security Best Current Practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)
- [OAuth 2.0 Authorization Server Issuer Identification, RFC 9207](https://www.rfc-editor.org/rfc/rfc9207.html)
- [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [SCIM Core Schema, RFC 7643](https://www.rfc-editor.org/rfc/rfc7643.html)
- [SCIM Protocol, RFC 7644](https://www.rfc-editor.org/rfc/rfc7644.html)
- [SAML 2.0 Core](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf)
- [OpenID Connect Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html)

## Administrative surfaces

Do not stretch the current global users page into a combined interface. Zero should ship a
headless client contract, focused reusable blocks, and opinionated self-wired control-plane
organisms. Provide three visibly distinct surfaces:

- **Platform administration**: global accounts, tenant lifecycle, SSO connection support,
  system health, and audited recovery actions.
- **Tenant administration**: members, invitations, tenant roles, domains, and that tenant's
  SSO policy.
- **Current user**: profile/security settings, linked identities, memberships, and active
  tenant selection.

All list/search APIs take their tenant boundary from the authorized context, not a freely
trusted query parameter. Cross-tenant platform views use separate platform-admin endpoints
and still do not expose tenant application data by default.

### Existing UI seams to retain and correct

The current component system already supplies useful foundations:

- auth forms cover login, registration, password lifecycle, verification, MFA, user
  properties, layout, and visibility gates;
- `UserManagement` has a strong self-wired/controlled organism pattern with server
  pagination, action-policy resolution, confirmations, readiness notices, and master/detail
  presentation;
- `AppShell` has a generic workspace presentation seam;
- `DataTable`, `MasterDetailPage`, modal management, toasts, and the design-token primitives
  are suitable building blocks.

The upgrade must correct rather than amplify current ambiguity:

- `UserManagement` is global identity/platform administration. It exposes password, email,
  MFA, global role/status, and deletion actions and therefore cannot become tenant member
  management;
- `AdminGate`, `adminOnly()`, `requireAdmin()`, and existing `matcher.role` mean
  global/platform authority and retain that meaning;
- `PropertyGate` remains a presentation convenience, not an RBAC primitive;
- the generic AppShell workspace switcher may display tenants but currently has no atomic
  authorization switch state and must not choose the first item as authority;
- route guards need useful loading, selection, denied, revoked, and switching states rather
  than a blank page;
- `SocialLoginGroup` is caller-wired presentation and must not be relabeled as server-backed
  enterprise SSO;
- the narrow auth component barrel and broad frontend barrel currently disagree about some
  MFA exports, while older inventory names such as `AuthGate`/`RoleGate` do not match the
  real `Gate`/`AdminGate` exports. Normalize this public surface before adding tenancy
  components.

### Mode-aware default UI

The server's resolved capability document—not locally guessed config—drives the UI:

| Tenancy | Authorization | Packaged default |
| --- | --- | --- |
| `single` | `simple` | Exactly today's login, account security, gates, and platform `UserManagement`; no tenant terminology |
| `single` | `advanced` | App-scope role/permission assignment and permission gates; no chooser or tenant terminology |
| `multi` | `simple` | Tenant selection/switching, members, invitations, and fixed/configured coarse roles; no permission editor |
| `multi` | `advanced` | Full tenant control center with permission-aware role assignment and optional custom-role capability |

SSO, invitations, tenant creation, join requests, verified domains, custom roles, audit
export, and break-glass are separately advertised capabilities. Multi-tenancy does not make
every section appear automatically. Missing capability fields from an older server
normalize to `single/simple` in the client.

Single-tenant advanced authorization and single-tenant enterprise SSO remain valid. The
application scope is implicit, so these profiles never render a fake tenant chooser.
For `single/advanced`, Zero packages an `ApplicationAccessManagement` surface that assigns
application roles/permissions without tenant lifecycle or membership language. It reuses
the same security patterns as tenant role management while remaining separate from the
global-account mutation powers in `UserManagement`.
When an SSO connection is application-owned in either single authorization mode, an
`ApplicationSsoManagement` section uses the same tested, write-only-secret connection
workflow without presenting tenant membership controls.

### Client state and headless controls

Extend the existing auth session controller/store rather than adding an independent tenant
provider that can drift from its tokens. The committed client snapshot should contain:

```ts
interface ClientAuthorizationState {
  scope: {
    kind: 'application' | 'tenant';
    scopeId: string;
    tenant?: TenantSummary;
    membership?: MembershipSummary;
    roles: readonly string[];
    permissions: readonly string[];
    revision: string;
  } | null;
  memberships: readonly MembershipSummary[];
  epoch: number;
  phase:
    | 'restoring'
    | 'tenant-selection-required'
    | 'ready'
    | 'switching-tenant'
    | 'reauthentication-required'
    | 'error';
  pendingTenant?: TenantSummary;
}
```

Keep this distinct from `AuthUser`: identity/profile data is global, while membership and
authorization change with the application scope. The implemented browser client keeps the
authorization snapshot on `client.authorization`, groups single-scope application-role
administration under `client.applicationAdmin`, and preserves the established top-level
tenant and onboarding methods:

```ts
client.authorization;
await client.listTenants();
await client.createTenant(params);
await client.switchTenant(tenantId);
await client.inspectTenantInvitation(token);
await client.acceptTenantInvitation(params);
await client.submitTenantJoinRequest(tenantSlug, onboardingContinuation);
await client.applicationAdmin.getConfig();
await client.applicationAdmin.listUsers(params);
await client.listTenantMembers(params);
await client.issueTenantInvitation(params);
```

The earlier namespaced `client.tenancy`, `client.onboarding`, `client.tenantAdmin`, and
`client.platformAdmin` sketch was not implemented and is not a public API. Browser hooks and
gates currently include:

- `useAuthorization()` and `useAuthorizationScopeBoundary()`;
- `useTenantSwitcher()` and `useTenantMembers()`;
- `useTenantOnboardingAdministration()` and `useTenantDomainAdministration()`;
- `useDomainOnboarding()` and `useApplicationAccess()`;
- `useHasPermission()`, `useHasAllPermissions()`, and `useHasAnyPermission()`;
- `PlatformAdminGate`, `TenantGate`, and `PermissionGate`.

Visibility gates are UX only. Every action and data response is still enforced on the
server. Capability-driven navigation may hide irrelevant links, but it never supplies
authority.

### Control-plane API namespaces

The packaged UI needs a stable, typed API that mirrors the authority split. Directional
route groups are:

| Namespace | Examples | Authority |
| --- | --- | --- |
| `/auth/application` | current authorization snapshot, safe capabilities/terminology, authorized single-scope role assignment, and application-owned SSO management | completed application session plus operation-specific application/platform permission |
| `/auth/tenancy` | list memberships, create/request/join, begin/complete switch | current identity/session; server validates every target membership |
| `/auth/tenant` | members, invitations, join requests, domain claims/policies, roles, SSO policy, tenant audit/settings | active tenant plus section-specific permission |
| `/auth/platform` | global identities, tenant directory/lifecycle, bootstrap, support SSO, control-plane audit | platform permission/admin; no tenant data-plane access implied |
| `/auth/platform/elevations` | request, approve, inspect, terminate, and observe break-glass elevation | fresh platform step-up plus elevation policy; issued grant is target/operation/expiry bounded |
| `/auth/onboarding` | start/complete mailbox proof, inspect/accept invitation, resolve verified-domain options, request/join, and resume allowed registration | opaque purpose-bound continuation, then authenticated identity as required |
| `/auth/sso` | discovery/start/callback/link/step-up continuation | protocol transaction plus the shared completion coordinator |

Tenant-control list and mutation routes normally omit a caller-selected tenant ID and act on
the active validated scope. If an object path contains a tenant ID for REST identity or a
platform view, equality/authority is still checked server-side; the path is never the
boundary. Cross-tenant platform routes are separate rather than a query flag on tenant
routes.

Every mutation uses typed schemas, stable error codes, idempotency/replay protection where
appropriate, authorization revisions for concurrent owner/role/SSO changes, and append-only
audit. Browser API routes stay Bearer-authenticated; a page cookie alone does not gain
mutation authority. Responses expose safe capabilities and masked metadata only—never
invitation hashes, SSO secrets, assertions, refresh tokens, or recovery material.

The verified-domain route family should expose typed operations equivalent to:

- authorized tenant member: create/verify/revalidate a claim, update policy, release/transfer
  it, or approve/deny join requests only when the operation-specific domain/onboarding
  permission and step-up requirements above are satisfied;
- current identity: list onboarding options derived from the live proven email, create one
  idempotent join request, or consume an eligible auto-join continuation;
- unauthenticated user: start mailbox proof with a generic response and resume only through
  the opaque single-use continuation.

These may be concrete endpoints under `/auth/tenant/domains`,
`/auth/tenant/join-requests`, and `/auth/onboarding/domain`, but handler inputs must never
accept a tenant ID, domain, or role as admission authority. The server derives them from the
active tenant for administration or from the stored proof-bound onboarding transaction for
joining. Domain status/policy conflicts use stable non-enumerating error codes, and all
mutations recheck their revision inside the final database transaction.

### Current-user account surface

Package an `AccountManagement` organism for actions the current identity may perform:

- profile and configured user properties;
- password, MFA, linked identities, and eventually personal session/device management;
- active/invited/suspended/pending memberships with safe role labels;
- switch, leave, create, join, and request-access actions when capabilities allow them;
- an explicit manage-tenant link only when the active authorization scope permits it;
- warnings and safeguards when unlinking an upstream identity would remove the only allowed
  login path.

Reusable blocks should include `MembershipList`, `LinkedIdentityList`, `SessionList`,
`CreateTenantDialog`, `DomainOnboarding`, and `RequestTenantAccessDialog`. The domain
block begins/resumes mailbox proof, then renders only the server-returned join/request/SSO
choice; it never performs suffix matching in the browser. These blocks should compose the
existing account/MFA forms rather than duplicate their transport logic.

### Tenant control center

Package a self-wired and controlled `TenantManagement` organism. Its self-wired mode always
uses the active tenant from the validated session; it must not accept a tenant ID prop as
authority. Controlled mode can receive data/action adapters, but the backing endpoint still
validates active scope.

Recommended sections and component families are:

1. **Overview/settings — `TenantSettings`**
   - display name, slug/branding where supported, lifecycle state, member/invite counts;
   - authentication posture and actionable readiness warnings;
   - onboarding policy summarized in the application's configured tenant terminology.
   - after tenant creation, show a dismissible “Verify `company.com` to simplify coworker
     onboarding” action only when the server reports an eligible proven work-email domain.
2. **Members — `TenantMemberManagement`**
   - tenant-scoped search, filters, pagination, identity summary, membership state, roles,
     join source, and tenant-relevant last activity;
   - assign only grantable roles, suspend/reactivate/remove membership, revoke sessions for
     this tenant, and use a dedicated ownership-transfer flow;
   - “add member” creates an invitation or explicitly provisioned membership, not a global
     password account;
   - global email/password/MFA/status/deletion controls are absent. Any displayed global
     profile field is read-only.
3. **Invitations — `TenantInvitationManagement`**
   - invite, resend/rotate, revoke, expiry, delivery, accepted/revoked/expired states;
   - grantable-role filtering and one-time copy-link display only when configured.
4. **Roles/permissions — `TenantRoleManagement`**
   - simple mode shows only assignment from fixed/configured templates;
   - advanced mode shows grouped permission descriptions and assignment impact;
   - app-configured and system-owner roles are visibly locked;
   - tenant-custom role CRUD appears only behind a later explicit capability;
   - deletion requires reassignment and shows affected-member count.
5. **Verified domains — `TenantDomainManagement`**
   - pending, verified, revalidation-due/failed, conflict, quarantined, and revoked states;
   - one-time DNS TXT instructions/copy, retry/check, last/next verification, aliases as
     separately verified claims, release/revoke, and safe audit history;
   - separate controls for discovery, domain-enabled account creation, and admission:
     “invite only,” “ask an admin to approve” (recommended), or “join verified coworkers
     automatically” where application policy allows it;
   - separate request-default and auto-join role selectors: the first is constrained by
     `allowedRequestRoles`, while the second is constrained by the normally narrower
     `allowedAutoJoinRoles`; both show impact text and enabling auto-join requires recent
     authentication;
   - optional “require company SSO” linkage disabled until the tenant connection is tested;
   - conflict/transfer states direct the owner to the recovery ceremony rather than offering
     a force-claim button;
   - verification and automatic joining are visually and semantically separate decisions.
6. **Join requests — `TenantJoinRequestManagement`**
   - pending/approved/denied/expired requests with proven-domain source, requester identity,
     requested time, safe role outcome, pagination, and accessible empty/error states;
   - approve/deny is idempotent, revision-aware, permission-checked, and cannot grant a role
     outside the actor's grantable set;
   - approving a request races safely with invitation acceptance, auto-join, removal, domain
     revocation, tenant suspension, and an already-created membership.
7. **Enterprise SSO — `TenantSsoManagement`**
   - connection status/support-only view when management is platform-owned;
   - setup wizard for discovery/issuer, client ID, write-only secret, redirect URI, test,
     safe claim/JIT policy, activation, and later enforcement;
   - stored secrets never return to or render in the browser;
   - require-SSO remains unavailable until a test succeeds and a recovery path exists;
   - secret rotation, disablement, and enforcement are separate confirmed actions.
8. **Audit — `TenantAuditLog`**
   - server pagination/filtering by actor/action/target/result/time, safe detail diff, and
     permission-controlled export;
   - never render tokens, assertions, client secrets, or raw credentials.
9. **Danger zone**
   - ownership transfer and supported suspension/deletion operations;
   - step-up plus typed/hold confirmation and transactionally enforced last-owner rules.

Each organism should follow the successful `UserManagement` structure: focused data hooks,
an action-policy resolver, a mutation adapter, readiness and error states, controlled and
self-wired modes, and small testable domain subcomponents. It must not import or reuse the
global `UserManagement` mutation model.

### Platform control center

Keep global control-plane authority visibly separate:

- retain `UserManagement` and add the clearer alias `PlatformUserManagement`;
- add `PlatformTenantManagement` for tenant lifecycle, member counts, domain/SSO health,
  and control-plane operations without tenant application data;
- add `PlatformIdentityManagement` for global identity lifecycle plus read-only membership
  summaries;
- include bootstrap/readiness, cross-tenant control-plane audit, and platform-owned SSO
  support;
- make recovery and break-glass a dedicated workflow rather than ordinary row actions.

A platform administrator does not receive tenant navigation or application data because of
the global role. Normal access requires an ordinary membership. Exceptional support access
requires a separately issued, narrow, short-lived elevation.

### Authentication, registration, and onboarding UI

Generalize the current MFA-only continuation handling into one `AuthContinuation`/
`AuthFlow` coordinator for:

- email verification and MFA setup/challenge;
- tenant selection;
- invitation acceptance and invitation-enabled registration;
- work-email proof, verified-domain registration, and server-derived company join/request
  decisions;
- tenant create, join, or request-access decisions;
- upstream SSO redirect/step-up/callback status;
- final session commitment.

Extend `AuthCompletionResult` with a typed `tenantSelectionRequired` result backed by a
short-lived, single-use, purpose-bound transition token and safe eligible-tenant summaries.
Only final tenant binding returns the normal access/refresh session. Invitation and verified-
domain registration accept opaque proof-bound onboarding continuations, never a caller-
selected tenant, domain, or role. Password login, invitation/domain flows, upstream SSO,
native OIDC, mobile, and extension flows all feed the same completion coordinator. A
verified-domain continuation carries the current email-proof generation and domain-policy
revision so an email change, claim revocation, or policy change invalidates it before use.

Recommended blocks are `TenantSelectionForm`, `InvitationAcceptanceForm`,
`DomainOnboarding`, `TenantOnboarding`, `EnterpriseSsoLogin`, and `SsoCallbackStatus`.
`LoginForm` and
`RegisterForm` work unchanged in `single/simple`; when another transition is returned they
hand it to the coordinator rather than treating every non-MFA result as a completed session.
Enterprise SSO UI is server-backed and separate from the existing custom
`SocialLoginGroup`.

### Atomic tenant switching and AppShell integration

Package a dedicated `TenantSwitcher` and a `useTenantAppShellWorkspaces()` presentation
adapter. The switcher—not the generic workspace list—coordinates the authorization change:

1. show only the server-committed active tenant; never optimistically change it or fall back
   to the first membership;
2. let an optional `beforeTenantSwitch` UX callback stop before submission for unsaved
   work, but never treat it as authorization;
3. serialize switch requests, freeze new scoped work, and expose an accessible pending
   state;
4. abort or authorization-epoch-tag in-flight HTTP and multipart work;
5. disconnect old Sync/state/presence channels and purge scoped rows, subscriptions,
   ephemeral data, optimistic queues, buffered mutations, receipts, and admin caches;
6. install the rotated session/context, reconnect, and only then commit the visible tenant;
7. retain the old committed context after a definite rejection. After an ambiguous network
   loss, re-resolve server authority because the old session may already be revoked;
8. enter the typed continuation when the target requires different SSO/MFA assurance;
9. announce progress/completion and restore focus;
10. hide by default for one membership, provide onboarding for zero, and make many
    memberships searchable.

A switch must prove possession of the current durable session family, not merely a stolen
short-lived access bearer. Today the browser controller stores its rotating refresh token
in JavaScript-readable `localStorage`, while the page-session cookie is the separate
HttpOnly credential. The first compatible switch facade can consume/rotate the controller's
current refresh family plus bearer, but the design must not describe that localStorage token
as hardware- or HttpOnly-protected. A hardening track may move browser rotation/switch proof
behind the HttpOnly session or another non-JavaScript-readable mechanism, with an explicit
SDK migration. Native/Tauri and Chrome brokers perform the switch through a specified
refresh/token exchange using the broker-held rotating refresh token.
The server validates membership and authentication provenance, atomically consumes the old
refresh token, and returns the fully rotated session. Refresh credentials never leave the
native process or extension worker.

Browser `localStorage` credentials and the page cookie are origin-wide today, so the first
release has one active application scope per origin/session family. A switch in one tab
broadcasts the new session and authorization epoch; every tab pauses, purges, and restores.
Compare-and-set session updates prevent a late old refresh/401 from expiring the newly
switched session.
Holding different tenants in different tabs is explicitly unsupported until Zero has a
per-tab refresh/page-session architecture. One process-level owner in Tauri and one
extension service-worker owner follow the same rule naturally.

The authorization route boundary should render explicit packaged states for restoring,
tenant selection/onboarding, tenant unavailable/suspended, membership revoked, permission
denied, reauthentication, and switching. It must not render old-tenant children while the
scope is unsettled.

### Default packaging, exports, and scaffolding

Recommended narrow exports are:

```text
@zero/framework/components/auth
@zero/framework/components/tenancy
@zero/framework/components/admin/application
@zero/framework/components/admin/tenant
@zero/framework/components/admin/platform
@zero/framework/react/hooks
```

The main React entry can re-export the common hooks/blocks, while narrow entries make tree
shaking and server/browser dependency auditing clear. Add package-export, distribution, and
browser-safety tests for every entry.

Opinionated organisms ship in the Zero package and update with the Zero dependency. The
normal Zero update workflow must not copy or overwrite their source in an application.
When `create-zero` selects multi-tenancy, it should scaffold thin app-owned route wrappers
that import the packaged chooser, account, and tenant-control organisms by default. For an
existing app, an explicit `zero add auth-control` command can add the same wrappers. A
source-copy option may exist only as a separately named customization action.

The current blank/auth-disabled scaffold remains unchanged. Control routes are generated
only by an explicit auth preset or add command; selecting `single/simple` does not surprise
an existing app with tenant navigation.

Suggested app-owned wrapper routes are:

```text
/choose-tenant
/invitations/[token]
/account
/settings/<configured-tenant-label>
/platform/auth
```

Do not hard-mount a framework dashboard at runtime: that would collide with app routing,
branding, and deployment policy. Default prepackaging means the maintained components and
generated thin routes are the ordinary path, not that Zero silently takes over URLs.

Customization may supply routing adapters, terminology, branding/avatar renderers, extra
navigation/detail sections, empty/error slots, invitation fields, role ordering/labels, and
switch lifecycle callbacks. It cannot supply a Boolean that widens server capability or
permission decisions.

### UI behavior and acceptance criteria

- preserve layout with skeletons during initial restore; use compact `aria-live` feedback
  for background work;
- never show old-scope rows below a newly selected tenant label;
- do not optimistically commit sensitive role, ownership, SSO, invitation, or break-glass
  mutations;
- map `401` to session recovery, `403` to explicit access removal, `404` to a
  non-enumerating state, `409` to invariant refresh, and step-up to continuation;
- add an explicit mobile back action to master/detail lists;
- use full-height/full-page workflows for complex mobile SSO and role editing;
- give permission matrices semantic headers, keyboard controls, group labels, and textual
  state; never use color/tooltips alone;
- give pending controls `aria-busy`, announce status, return dialog focus, support touch,
  and honor reduced motion;
- use configured tenant terminology in visible and accessible copy.

Component tests need all four profiles, independent capability visibility, tenant/platform
admin separation, self-wired and controlled modes, switch success/rejection/ambiguous loss,
overlapping clicks, stale HTTP/upload completion, Sync reconnect, optimistic-queue purge,
multi-tab behavior, live permission removal, invitation and last-owner races, SSO
test/enforcement/recovery/rotation, secret absence from DOM/logs, break-glass lifecycle,
keyboard/focus/live-region/reduced-motion checks, mobile layouts, and package tree shaking.

### Platform account recovery versus tenant access

The current global admin surface can directly replace another user's password, reset MFA,
change email/status, or delete the identity. In a tenant system those powers can become
indirect account takeover, defeating `platformAdminTenantAccess: 'none'` even if tenant data
routes themselves reject platform admin.

Multi-mode defaults should therefore be:

- send a user-controlled recovery/setup link rather than manually set a password;
- do not create a local credential for an SSO-only identity without explicit user/tenant
  policy;
- require user verification for email replacement and sensitive external-identity unlink;
- treat MFA reset, forced email takeover, or support impersonation as break-glass actions;
- require platform-admin step-up, a reason, a short-lived separate elevation/session,
  prominent audit/notification, and optionally two-person approval for break-glass;
- make suspension possible as a protective global control without granting data access.

The packaged flow should use a dedicated `BreakGlassRequest` surface and, while elevated,
a non-dismissible `BreakGlassBanner` throughout AppShell showing the target tenant, narrow
capability, reason, and expiry countdown with “End access now.” Expiry or termination runs
the same complete scope purge as a tenant switch. Both platform and tenant audit receive the
event, and tenant owners are notified according to policy.

Global account deletion needs explicit cross-tenant semantics. The normal operation should
revoke every session, deactivate memberships/identity, and retain non-secret audit/tombstone
references. Irreversible personal-data purge is a separate compliance workflow that handles
tenant-owned records and retention obligations; it is not an unexamined cascade from the
platform users page.

Safety rules need tenant equivalents of current global last-admin protection:

- cannot remove, suspend, or demote the last active tenant owner;
- ownership transfer and concurrent updates are transactionally serialized and safe across
  runtime processes, rather than implemented as a count followed by a later write;
- an actor cannot grant a role/permission they lack authority to grant;
- invitation and membership events are auditable;
- external identity unlinking cannot leave a required-SSO account without an allowed login
  path.

## Revocation and live revalidation

Retain the existing user generation and add two narrower revisions:

- tenant generation: invalidates all sessions in one tenant;
- membership generation: invalidates one user's authorization in one tenant.

Advance the membership generation when status or role assignments change. Advance the
tenant generation for suspension, role-definition/permission-map changes, or emergency
policy invalidation. Resolve current membership and role permissions during auth-context
hydration.

Sync must include authorization scope kind/ID/revision and the effective policy fingerprint;
in `multi` it also includes tenant ID, membership ID/generation, and tenant generation, and
an elevated session includes elevation ID/generation/expiry. Any difference closes and
resets the socket. The browser Sync client must purge records from the old authorization
scope before applying the new snapshot.

Periodic revalidation remains the bounded fallback. The implemented shared-file
path adds migration `020`'s monotonic auth-authority revision: SQLite triggers
advance it in the same database as security-relevant account, session, tenant,
membership, and assignment writes. Every managed Sync runtime sharing that
file polls the revision, rehydrates its active sockets, revalidates managed
ephemeral bindings, and rejects stale live delivery instead of waiting for the
full interval.

The data-plane companion uses the SQLite-owned change sequence and retained
change log to relay other connections' writes into each file-mode runtime's
ordinary Sync policy/fanout path. Writer origins suppress local duplicates; a
retention gap closes sockets so reconnect obtains a clean snapshot. Neither
mechanism is a general distributed bus: `hot`/`ephemeral` runtime state,
separate database files, cross-host messaging, application-owned caches, and
RAM-only ephemeral/presence values require explicit external coordination.
Direct SQL is likewise trusted application code and must use a tracked managed
write path when realtime fanout is required.

Client scope reset must include synchronized rows, per-user tenant state, ephemeral/presence
state, subscriptions, optimistic queues, buffered writes, and tenant-partitioned mutation
receipts. Clearing only the main row store can still leak or replay tenant A state after a
switch to tenant B.

The canonical ordering is the numbered protocol under
[Atomic tenant switching and AppShell integration](#atomic-tenant-switching-and-appshell-integration);
transports and non-React SDKs implement that same barrier without importing the UI. Its
non-negotiable data rule is that every result is stamped with an authorization epoch and any
response from the old epoch is discarded rather than entering the new scope.

## Compatibility and migration

### Defaults

- `auth: false` or omitted app auth remains auth-disabled exactly as today;
- `auth.tenancy` omitted normalizes to `single`; no tenant tables are required and current
  behavior remains;
- `auth.authorization` omitted normalizes to `simple`; the existing single global role
  behavior remains;
- existing `AuthContext` fields remain present;
- existing `requireAuth()` and `requireAdmin()` continue to work;
- existing single-tenant access and refresh tokens keep their current interpretation in the
  `single/simple` profile;
- browser/native SDK additions are optional.

In `multi` mode, public `/auth/config` exposes only safe resolved tenancy capability
(`mode`, terminology, and creation mode) plus bootstrap state; it does not advertise the
global `userCount`. Tenant/member counts belong on authorized scoped endpoints.

### Schema rollout

Use additive migrations first. Do not rewrite or duplicate `users`. Internal tenant tables
can exist before the feature is enabled. Nullable session-binding columns preserve old
records during transition.

Do not backfill eligible mailbox-proof records from `users.email_verified_at`: that value
may have been populated because verification was disabled. Existing accounts retain their
login compatibility and complete a fresh mailbox challenge the first time they use domain
claiming/admission. This is a targeted proof upgrade, not a global forced re-verification or
an inferred production-data mutation.

Adoption is a staged deploy, not a single startup toggle:

1. deploy additive nullable schema and tenant-aware code with enforcement still off;
2. dual-write new rows to the chosen default tenant, or use a bounded maintenance window so
   backfill cannot race new unscoped writes;
3. backfill all realms and assignments;
4. validate zero unscoped rows, constraints, role mappings, and two-tenant adversarial tests;
5. invalidate tenantless sessions/capabilities and enable enforcement in a controlled
   cutover;
6. rebuild/enforce final `NOT NULL`, composite foreign-key, and uniqueness constraints after
   validation and backup.

### Adopting an existing application's data

Enabling tenancy on an app with existing rows requires an explicit adoption plan:

1. create a chosen initial tenant;
2. decide which existing users become members and explicitly map every legacy global role;
3. add/backfill tenant columns on every newly tenant-scoped table;
4. classify intentionally global tables;
5. audit storage, notifications, rooms, workflows, and background jobs;
6. invalidate/reissue old tenantless sessions before tenant data is served;
7. invalidate unscoped storage capabilities and migrate/clear tenant-ambiguous mutation
   receipts;
8. add tenant-leading indexes, composite uniqueness, and tenant-consistent parent/child
   foreign keys after the backfill is verified;
9. audit every global `UNIQUE` constraint and ReactiveDB `_identity`; include tenant in any
   business identity that may repeat across tenants;
10. run cross-tenant isolation tests before accepting a second tenant.

For a compatibility-oriented one-tenant adoption, existing platform admins can receive the
initial tenant's owner/admin membership while retaining their global platform role. That is
an explicit migration mapping, not a permanent rule that every platform admin owns every
tenant. Migrations that backfill or rebuild production tables require the platform's normal
backup/destructive-change safeguards.

Zero can generate and validate this migration, but must not guess or silently mutate
production data. Doctor should block startup in `multi` mode when rows are unscoped,
table classifications are missing, owner invariants fail, or legacy tenantless sessions
would gain data access.

### Client contracts

The implemented client adds a separate, optional authorization snapshot while keeping the
current global `client.user`. Application-role administration is namespaced; tenant and
onboarding operations use the established top-level client contract:

```ts
client.authorization;
await client.listTenants();
await client.createTenant(params);
await client.switchTenant(tenantId);
await client.inspectTenantInvitation(token);
await client.acceptTenantInvitation(params);
await client.submitTenantJoinRequest(tenantSlug, onboardingContinuation);
await client.applicationAdmin.getConfig();
await client.applicationAdmin.listUsers(params);
await client.listTenantMembers(params);
await client.issueTenantInvitation(params);
```

The unimplemented `client.tenancy`, `client.onboarding`, `client.tenantAdmin`, and
`client.platformAdmin` namespace sketch is not part of the public contract.

Desktop, mobile, and browser-extension auth use the same server membership/session model.
Their platform-specific callback and secure-storage code remains separate, but no client
receives an application secret or refresh credential outside its credential-owning process.
They expose sanitized authorization snapshots plus narrow list/switch operations. Existing
clients continue to function against `single/simple` servers and ignore additive discovery
capabilities they do not understand.

Company-domain onboarding also stays server-owned across clients. Browser apps render the
shared continuation directly; Tauri/mobile SDKs open the Zero system-browser authorization
flow; and a Chrome extension's service worker owns the interactive window and callback.
The Rust/UI process, mobile view, extension popup, and ordinary web component do not parse
an email suffix, select a tenant, or assign a role locally. They receive only typed states
such as `mailboxProofRequired`, `requestSubmitted`, `tenantSelectionRequired`, or the final
committed authorization snapshot. This keeps registration/onboarding behavior identical
without exposing PKCE material, tokens, or tenant-existence probes to a presentation shell.

## Phased implementation plan

> **Historical sequencing:** completion labels in this section are the plan's
> implementation-time snapshot, not current release status. In particular,
> multi-mode bootstrap, managed ephemeral policy, tenant sessions, switching,
> and packaged controls have since landed. Use the linked implementation
> checklist for current gates and intentional deferrals.

### Phase 0: contracts and safety harness

- **Completed in this branch:** close unscoped framework-table Sync reads and the audited
  notification, room, and workflow IDOR-style route gaps.
- **Completed in this branch:** close the user-property authorization trust mismatch in
  server middleware and Storage ACL grants.
- **Completed in this branch for managed topics:** enforce server-owned
  namespace, operation policy, and key ownership for ephemeral subscribe,
  write, and delete. Raw app-defined topic families still own equivalent
  policy, and the RAM topic bus remains process-local.
- **Completed in this branch:** fix the official Eden/fetch/progress-upload credential path
  and reject protected multipart requests before consuming unauthorized bodies.
- **Completed in this branch:** make explicit file-router policies fail closed on
  import/evaluation error and define parent layout policy for colocated `route.ts` APIs.
- **Completed for `single`:** closed one-time bootstrap admission, durable
  completion, UI/config discovery, Doctor diagnostics, upgrade sealing, and
  adversarial race/replay coverage.
- **Gated for `multi`:** expand that transaction to initial organization,
  owner membership, active tenant context, and platform admin; add source-aware
  throttling before enabling multi-tenant deployments. Config normalization alone
  does not enable the multi-tenant runtime, and Doctor remains blocking.
- Freeze the invariants and naming in an accepted architecture decision.
- **Implemented foundation:** the two-axis config normalizer accepts all four profiles,
  validates permissions/static role templates, and the shared serializable
  `AccessRequirement` has a pure monotonic compiler/evaluator with stable errors.
  Transport/compiler adapters for each current declaration surface remain open.
- Freeze the compatibility rule that `role`, `admin`, `adminOnly()`, and `requireAdmin()`
  remain global/platform concepts.
- Add a reusable multi-tenant adversarial test harness with two tenants and overlapping
  roles/data identifiers.
- Add Doctor table-security diagnostics in warning-only mode in `single` and blocking mode
  in `multi`.
- Inventory every framework table and route in a checked-in capability matrix.

Exit condition: current framework data is no longer broadly readable through raw Sync,
identified route gaps are closed, and every official access surface has an assigned
enforcement owner and test plan.

### Phase 1: tenant and membership foundation

- Replace internal process-global auth ownership with one injected per-app `AuthRuntime` and
  `AuthorizationKernel`, retaining `get*` compatibility wrappers.
- Add the named Elysia request resolver/macro, common auth error contract, request-scoped
  service facade, and the same evaluator in the file router and Sync bridge.
- Add tenant, membership, invitation, and role-assignment stores/services.
- Add tenant/membership generations and audit events.
- Add the durable append-only auth audit store, retention/export contract, and query
  authorization.
- Add durable web/native session-family records and live `sid` validation.
- Extend auth context, token/refresh/page/native session bindings, and browser types.
- Add tenant list/select/switch APIs, with refresh-family proof and atomic rotation.
- Preserve the complete `single/simple` suite and test all four config profiles.

Exit condition: sessions can be safely tenant-bound and switched with old credentials
invalidated, every control-plane change is durably attributable, but application data is not
yet advertised as multi-tenant.

### Phase 2: authorization and data-plane enforcement

- Add the permission registry and shared simple/advanced role evaluation.
- Apply structured requirements and type narrowing to Zero endpoints/routers/middleware,
  raw Elysia adapters, pages/layouts/loaders, and resources.
- Add canonical table-security registry and mandatory tenant realm enforcement.
- Add direct tenant discriminators and composite tenant-consistent constraints to every
  independently queryable/synchronized child row.
- Enforce scope in generated CRUD, `/api/data`, Sync snapshot/replay/live/mutations, and
  scoped service APIs.
- Tenant-scope storage, notifications, rooms, workflows, state, and presence.
- Require explicit execution contexts for background jobs/workflows and isolate raw
  database access under the documented unsafe escape hatch.
- Turn missing table classification into a `multi`-mode startup failure.

Exit condition: the adversarial two-tenant suite passes every official transport.

### Phase 3: onboarding and tenant administration

- Establish the one shared email/domain canonicalization seam; keep raw Unicode U-label
  input disabled until every auth path and migration collision check uses it.
- Tenant creation, invitations, DNS-verified exact domains, explicit mailbox-proof
  provenance/generations, join requests, and owner safeguards.
- Ship request-to-join as the domain default; make automatic joining an explicit app-and-
  tenant opt-in with a fixed least-privileged role after the same adversarial suite passes.
- Extend the shared completion coordinator for tenant selection, invitation registration,
  and proof-bound verified-domain registration/admission.
- Add the browser authorization snapshot, one credential-owning transport, authorization
  epochs, atomic switch/purge, multi-tab coordination, and useful route-boundary states.
- Ship `TenantSwitcher`, current-user memberships, separate tenant/platform control
  organisms, narrow component exports, and thin scaffolded route wrappers.
- Keep simple-mode UI coarse and reveal role/permission controls only in advanced mode.
- Replace direct account-takeover defaults with recovery-only operations and implement the
  explicit elevated, time-bound, audited break-glass workflow.
- Add membership-aware native/Tauri/extension snapshots and narrow broker-owned list/switch
  operations, with wire-version and conformance tests.
- Explicit migration/adoption tooling and Doctor blocking checks.

Exit condition: a multi-tenant app can onboard, administer, switch, and revoke members using
the packaged headless contract and control UI without custom auth/security code. A tenant
can prove `company.com`, accept a request from a freshly proven `@company.com` mailbox, and
lose/revoke that proof without exposing tenant existence or corrupting existing membership.

### Phase 4: upstream OIDC SSO

- Connection management and encrypted secret storage.
- Discovery, Authorization Code plus PKCE, state/nonce transactions, callback validation,
  external identity linking, and configured JIT policy.
- Credential-optional federated users, one-time browser handoff, and session authentication
  provenance that prevents a tenant IdP from authorizing other tenants.
- Assurance/MFA mapping and SSO enforcement with recovery controls.
- Add server-backed discovery/login UI and the tenant/platform SSO control-center sections;
  secrets remain write-only and test-before-enforce is mandatory.
- Connection conformance and hostile-callback tests.

Exit condition: a single application scope or one tenant can safely require enterprise OIDC
without granting authority to another tenant or disturbing native Zero OIDC clients.

### Phase 5: enterprise provisioning breadth

- SAML 2.0 Service Provider support.
- SCIM 2.0 users/groups provisioning and deprovisioning, with each credential and
  `externalId` namespace bound to one tenant/connection.
- Map SCIM `active=false` to tenant membership suspension/session revocation, not deletion or
  suspension of the global user.
- Optional upstream-group-to-role mappings.
- Tenant-custom roles if product requirements justify them.

## Test and review matrix

At minimum, automated tests need two tenants, a multi-membership user, a tenant owner,
tenant admin, ordinary member, non-member, suspended member, and platform administrator.

### Phase-0 current safety

- a raw authenticated Sync client cannot snapshot, fabricate catch-up for, or subscribe live
  to unauthorized users, notifications/receipts, rooms/members, workflows, or storage
  metadata;
- notification detail/receipt mutations reject a non-target user;
- room discovery/detail/member/join and workflow read/event/control operations enforce their
  documented membership/ownership policy;
- a user-written unknown or user-editable property cannot satisfy server middleware or a
  Storage ACL;
- ephemeral topic subscribe/write/delete enforces topic policy and key ownership.

### Modes and framework integration

- all four profiles normalize deterministically; old `auth: true` and object configs remain
  `single/simple` and compile unchanged;
- existing `role`, `auth: 'admin'`, `requireAdmin()`, and `adminOnly()` never grant scoped
  tenant administration;
- simple static role-to-permission mappings and advanced assignments produce decisions
  through the same evaluator;
- named Elysia dependencies deduplicate, request auth hydrates once, hooks run in the
  intended order, and two app instances in one process do not share runtime state;
- Zero endpoint/router/middleware, raw Elysia macro, file API, SSR page, resource, data
  query, Sync, and service facades return equivalent authorization decisions/error codes;
- parent route policies merge monotonically and SSR enforcement matches hydration UX;
- protected multipart rejects before body consumption and refresh/upload paths share the
  credential controller;
- compile-only fixtures verify conditional handler context narrowing for legacy and
  structured requirements;
- raw plugin/database escape hatches produce the documented Doctor/usage-audit findings.

### Isolation

- list/get/create/update/delete with guessed IDs across tenants;
- filters, sorting, pagination, aggregates, and lazy data query;
- Sync initial snapshot, reconnect catch-up, live inserts/updates/deletes, and client
  mutations;
- barrier-controlled races where tenant, owner, membership, or generation changes after an
  asynchronous policy check but before persistence;
- previous-row behavior when a row changes scope;
- storage paths, grants, signed URLs, and upload grants;
- rooms, notification targets, workflows, state, presence, and background execution;
- custom route examples and scoped service APIs.

### Session and revocation

- tenant switch rotates binding and purges old Sync data;
- tenant switch also purges state, ephemeral data, subscriptions, optimistic queues,
  buffered writes, and old-scope mutation receipts;
- membership role/status change invalidates current authority;
- last-owner races fail transactionally;
- global user suspension affects every tenant;
- tenant suspension affects only that tenant;
- replayed refresh/page/native session artifacts fail;
- a tenant switch immediately rejects the old web access JWT by durable session ID;
- a short-lived access bearer alone cannot switch scope and mint a new refresh family;
- concurrent/replayed browser, native, and extension switch exchanges atomically consume
  the old refresh credential;
- multi-tab propagation, compare-and-set refresh updates, and late `401` handling cannot
  clobber a newer switched session;
- old single-scope tokens cannot access tenant-required resources after multi-mode
  cutover.

### Onboarding

- invitation for new and existing users;
- invitation email mismatch, expiry, replay, role tampering, and concurrent acceptance;
- DNS challenge wrong-value, expiry, replay, rotation, delayed propagation, and concurrent
  verification behavior;
- mailbox/DNS challenge rate-limit exhaustion, email-bombing attempts, bounded DNS answers/
  timeouts, retry backoff, and multi-replica worker leasing;
- domain claim collision, uniqueness race, revoke/release, quarantine/transfer, periodic
  reverification failure, and tenant suspension during admission;
- `company.com` versus `evilcompany.com`, case/trailing-dot normalization, ASCII IDNA
  A-label acceptance, clear Unicode U-label rejection until the shared canonicalizer lands,
  and public-suffix/shared-provider/reserved/IP/single-label rejection;
- exact domain versus parent/delegated child, aliases verified separately, and fail-closed
  overlapping claims;
- real mailbox proof versus today's unproven `emailVerifiedAt` compatibility value,
  disallowed administrative proof, stale JWT/submitted/header email, and unconfigured IdP
  claims;
- pre-identity mailbox-proof creation, expiry, replay, and address-taken-at-commit race;
  completing that proof never issues a login/session or selects an existing user by email;
- existing-account email collision requires normal sign-in plus MFA/account gates and never
  binds proof by mailbox possession alone;
- proof-consuming registration writes durable provenance and the compatible verified-email
  projection without sending a second challenge; transaction failure leaves no partial user,
  credential, request, membership, or proof;
- an existing personal-primary-email account cannot silently add/replace a work address;
  primary-email change, invitation, and authenticated SSO linking follow their own flows;
- email change advances the generation and invalidates pending onboarding; stale proof and
  continuation replay fail;
- domain claim or policy revision changes between option display and final transaction;
- existing membership, exact invitation, tenant SSO, then domain-policy precedence;
- domain discovery remains non-enumerating before mailbox proof and reveals only safe tenant
  summary/action afterward;
- request-to-join idempotency, denial/cooldown, concurrent reviewer decisions, and race with
  invitation/auto-join/member removal;
- suspended/removed memberships and explicit admission blocks cannot be bypassed by a fresh
  mailbox proof, policy change, new request, or auto-join; only the explicit reactivation/
  reinvitation path restores the retained relationship;
- auto-join role tampering and attempts to gain owner/system/all-permissions/platform roles;
- domain read/verify/onboarding/review/transfer permissions remain independent in simple and
  advanced mappings; `tenant:onboarding:manage` cannot enable account creation/auto-join,
  while `tenant:onboarding:automatic-manage` remains bounded by app modes/role allow-lists;
- domain admission never bypasses required tenant SSO, and tenant A's domain/IdP never
  authorizes tenant B;
- disabled/admin-only/public identity registration combined with each tenant join policy;
- explicit domain-enabled account creation combined with disabled public registration;
- zero-membership, one-membership, and multi-membership login outcomes.

### SSO

- issuer, audience, signature, nonce, state, PKCE, time, redirect, and authorized-party
  validation;
- subject stability and email-change behavior;
- unverified email and account-link collision;
- malicious tenant A IdP attempting to enter an existing user's tenant B membership;
- SSO-only identity password-reset and local-credential bypass attempts;
- connection disabled/rotated/enforced states;
- JIT disabled/invite/domain/open modes;
- IdP assurance accepted and rejected for local MFA;
- tenant A's connection never provisions tenant B.

### Administrative audit and recovery

- platform recovery defaults cannot create a silent tenant-login path;
- break-glass requires step-up/reason/expiry, is tenant-bounded, and is durably audited;
- audit queries enforce platform versus tenant visibility and never expose stored secrets;
- identity deletion retains required non-secret audit/tombstone correlation;
- concurrent last-owner and bootstrap attempts preserve their database invariants.

### Packaged UI, exports, and SDKs

- capability flags render the correct hidden/read-only/editable sections in all four
  profiles;
- tenant member controls cannot invoke global password/email/MFA/status/delete actions;
- tenant/platform admin separation, current-user memberships, ownership transfer, and
  break-glass banner/expiry are covered;
- switching handles success, rejection, ambiguous loss, overlapping clicks, stale HTTP/
  upload results, Sync reconnect, queued mutation purge, focus, and live announcements;
- invitation, domain, SSO secret rotation/test/enforcement/recovery, and last-owner flows
  never expose secrets in DOM/logs;
- keyboard, screen-reader, reduced-motion, touch, responsive master/detail, and tenant
  terminology tests pass;
- all new narrow package entries pass distribution, tree-shaking, and browser/server import
  boundary tests;
- browser, TypeScript native, Chrome worker, and Rust/Tauri packages pass black-box session,
  membership, switch, and wire-version conformance against the same server.

### Compatibility

- complete existing auth, admin, MFA, page-session, native SDK, extension SDK, resource,
  and Sync suites in `single/simple`;
- existing app configuration compiles unchanged;
- existing public response fields remain stable;
- migration/Doctor results are deterministic and actionable.

## Review findings and recommended decisions

### Keep

- the global `users` identity and account-security lifecycle;
- live user rehydration instead of trusting stale JWT roles;
- security-generation invalidation and rotating refresh tokens;
- page sessions bound to persisted refresh rows;
- native OIDC Authorization Code plus PKCE design;
- current `single/simple` configuration, global-role meanings, and route shorthands;
- named, focused Elysia feature plugins and the Zero server-extension DSL;
- registered resource policies and Sync policy fingerprint/revalidation;
- bootstrap safeguards, upgraded to a closed setup ceremony in tenancy mode and kept
  separate from the tenant-owner invariant.

### Change

- add independent `single`/`multi` and `simple`/`advanced` capability axes over one auth
  runtime and evaluator;
- replace authorization dependence on one global role in advanced app code with live
  application-scope roles/permissions without reinterpreting the legacy global role;
- distinguish `requirePlatformAdmin()` from tenant permission checks;
- consolidate HTTP, page session, Sync, native, resources, and services onto one injected
  authorization kernel and normalized access requirement;
- make active tenant a validated durable session property and live-validate web `sid`;
- make every client-visible table's realm, exposure, and mutation policy explicit in
  tenancy mode;
- scope all framework services and background work;
- split registration from tenant joining;
- split platform and tenant administration;
- package mode-aware tenant controls and thin route scaffolds while leaving route ownership
  and branding with the app;
- replace platform-admin account-takeover defaults with recovery and audited break-glass;
- treat Zero as an upstream OIDC Relying Party for enterprise SSO while retaining its
  separate native OpenID Provider role.

### Do not use as the foundation

- user properties for tenancy;
- UI-only tenant selection;
- caller-provided tenant headers as authority;
- email alone for external account linking;
- tenant `admin` as a synonym for global `admin`;
- implicit global scope for unclassified tables;
- automatic production data backfills inferred from current rows.

### Recommended initial product choices

| Decision | Recommendation |
| --- | --- |
| Compatibility default | `single` tenancy plus `simple` authorization |
| Capability axes | tenancy and authorization selected independently |
| Product-neutral internal term | `tenant`; configurable UI label |
| Identity model | global user, many memberships |
| Global email uniqueness | preserve initially |
| Active context | one tenant per durable `sid`; validated switch revokes old session |
| Bootstrap | closed operator-controlled setup in tenancy mode |
| Platform-admin tenant data | none by default |
| Initial tenant roles | app-defined owner/admin/member templates |
| Initial role source | app config; DB stores membership-to-role-key assignments |
| Permission semantics | explicit additive permissions plus resource constraints |
| Legacy `admin`/`role` | always global/platform; never silently tenant-scoped |
| Framework integration | one per-app runtime/kernel, one request resolver, one access evaluator |
| Elysia app style | named feature plugins, request `resolve`, declarative macros/Zero DSL, plain services |
| Table security | separate realm, client exposure, and mutation/policy axes |
| Raw database handles | explicitly unsafe/trusted-app-code escape hatch |
| Tenant control UI | packaged self-wired/controlled organisms plus app-owned thin routes |
| Tenant member UI | membership/invitation controls only; no global account takeover actions |
| Security audit | durable append-only auth audit store |
| First join method | invitation |
| Domain ownership proof | DNS TXT, exact-domain matching, aliases verified separately |
| Mailbox evidence | explicit source/generation record; never legacy `emailVerifiedAt` alone |
| Domain-enabled registration | separate explicit app capability; never implied by domain match |
| Domain join default | request-to-join, not automatic |
| Domain auto-join | app-and-tenant opt-in, fixed least-privileged role, SSO policy still applies |
| First SSO protocol | OIDC Authorization Code plus PKCE |
| SAML / SCIM | later phases |
| Unclassified table behavior | fail startup in `multi` mode |
| Existing data migration | explicit generated adoption plan |

## Final assessment

The resulting upgrade is one additive system with independently selected
tenancy and authorization depth. Existing apps remain `single/simple`; new or
migrated apps may choose single-tenant permissions, multi-tenant coarse roles,
or multi-tenant advanced authorization without replacing the global identity
and account-security lifecycle.

This unreleased branch now carries the durable tenant/session/assignment
boundary through managed routes, resources, Sync, framework services, browser
switching, native sessions, and packaged application/tenant controls. The
authoritative checklist still gates release evidence and deliberately leaves
the Administration Organization/platform-tenant lifecycle, upstream SSO,
break-glass, tenant-custom roles, populated-app adoption tooling, and domain autojoin/aliases/direct
transfer for separately designed work. The independent Rust/Tauri and Chrome
packages remain private `0.0.0` previews.
