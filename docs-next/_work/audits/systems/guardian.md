---
id: zero.inventory.guardian
type: inventory
audience: [maintainer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed server app", "direct auth plugin composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Guardian System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Guardian owns server identity, authentication, authorization, tenant membership,
and administrative identity workflows. Its application contract is in the
framework package; separately maintained native clients are tracked in
[Native Auth SDKs](./native-auth-sdks.md). Source baseline is `main` at
`a3a5f726768dac890f241a3899c0a1acb66265d9`. Documentation-only `HEAD` is
`cd643b5b862f83b4ab40320486e1b89df1154c87`; `git diff main..HEAD` contained
only docs-next authoring files. Package metadata says 2.1.1. This is source
observation, not evidence of a released artifact.

## Purpose And Terminology

Guardian is Zero's identity and authority system. It includes identity records,
browser sessions, API keys, tenant/session context, permission checks, and
administrative controls. An authenticated identity is not itself permission;
tenant and resource access must use the relevant live authority contract.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Canonical draft guide | Review |
| --- | --- | --- | --- | --- | --- |
| Bootstrap and first administrator | Supported; app setup | `auth.bootstrap` (`secret` default, `public`, `disabled`), optional `bootstrapSecret` in first registration | `auth-config-account.ts`, `auth-registration-service.ts`, `auth-bootstrap.integration.test.ts`; secret minimum 32 chars, never projected | [bootstrap](../../../backend/guardian/bootstrap.md) | Source observed |
| Registration and public admission | Supported; server/browser | `auth.registration.mode`: `public` default, `admin-only`, `disabled`; `POST /auth/register`; `auth.requestAdmission` | `auth-registration.plugin.ts`, `auth-registration-service.ts`, `auth-request-admission*.ts`, registration/admission tests | [registration](../../../backend/guardian/registration.md) | Source observed |
| Password login and identity resolution | Supported; server/browser | `POST /auth/login`; username/email identifier and password; login throttling | `auth-login.plugin.ts`, `auth-login-service.ts`, request admission tests | [login](../../../backend/guardian/login.md) | Source observed |
| Browser page sessions and cookies | Supported; browser/server | `AuthSessionService`, page-session cookie synchronization; `auth-session*` routes | `auth-session.plugin.ts`, `page-session.ts`, `page-session.test.ts`, session-boundary tests | [sessions](../../../backend/guardian/sessions.md) | Source observed |
| Access-token issuance and JWKS | Supported; server/browser/native | `TokenService` access-token issuance; default TTL 15m; JWKS publication; env `ACCESS_TOKEN_TTL`; `AUTH_SIGNING_KEY` | `token-service.ts`, `auth-signing-keys.ts`, JWT/JWKS tests | [sessions](../../../backend/guardian/sessions.md) | Source observed |
| Refresh-token rotation and revocation | Supported; server/native | `TokenService` refresh rotation/reuse handling; default TTL 7d; env `REFRESH_TOKEN_TTL`; session/security-generation checks | `token-service.ts`, `auth-session*`, refresh/revocation tests | [sessions](../../../backend/guardian/sessions.md) | Source observed |
| Password recovery and reset | Supported; email-enabled for delivery | `POST /auth/forgot-password`; reset action links and `POST /auth/reset-password`; `accountEmails.passwordReset` | recovery/action services/plugins; outbox and recovery integration tests | [password recovery](../../../backend/guardian/password-recovery.md) | Source observed |
| First-password setup for admin-created user | Supported; email-enabled for link | `accountEmails.adminCreatedUser` default false; setup link uses `setupPath` default `/setup-password`; one-time action token | `admin-user-create-service.ts`, `auth-password-action.plugin.ts`, delivery tests | [password recovery#administrator created first password](../../../backend/guardian/password-recovery.md#administrator-created-first-password) | Source observed |
| Email verification and resend | Supported; optional policy | `account.requireEmailVerification` default false; `emailVerificationPath` `/verify-email`; resend route; account email template override | `auth-email-verification*`, `auth-verification-resend*`, integration tests | [email verification](../../../backend/guardian/email-verification.md) | Source observed |
| Email change / canonical identity transition | Supported server mutation; verify lifecycle separately | admin/user update paths, identity projection/outbox; changed address returns unverified when policy requires | `admin-user-update-service.ts`, `auth-email-identity.ts`, identity projection integration tests | [email verification#changing the account email](../../../backend/guardian/email-verification.md#changing-the-account-email) | Source observed |
| Password change and forced change | Supported; authenticated server | `POST /auth/change-password`; `password_change_required` state; admin force-reset controls | `auth-change-password.plugin.ts`, `TokenService` state checks, admin tests | [password recovery#signed in password change](../../../backend/guardian/password-recovery.md#signed-in-password-change) | Source observed |
| User properties and profile | Supported; server + React client | `auth.userProperties` record; types string/enum/boolean/number; `editableBy` user/admin/system/none; `useInPolicies` only with trusted editor; strict unknown-key option defaults false | `auth-config-user-properties.ts`, `user-property-service.ts`, profile hooks/routes and tests | [user properties](../../../backend/guardian/user-properties.md) | Source observed |
| Avatar | Not located as a dedicated Guardian/avatar upload feature in inspected auth exports/source | No distinct avatar service/config/export identified; may be app property/storage composition | auth exports and auth/component source scan; recheck whole frontend/storage inventory | [user properties](../../../backend/guardian/user-properties.md) (state absent or app-owned) | Coverage gap to reconcile |
| MFA enrollment and method management | Supported; optional feature | `auth.mfa.enabled` default false; methods default `['email','totp']`; user choice true; multiple methods false; TOTP issuer/encryption key/QR level | `auth-mfa.plugin.ts`, `mfa-service.ts`, `mfa-method-store.ts`, `mfa-service.test.ts` | [mfa](../../../backend/guardian/mfa.md) | Source observed |
| MFA challenge, OTP/TOTP and assurance | Supported; optional/required/admin-required | policy defaults optional; challenge TTL 10m, cooldown 1m, 5 attempts; email/TOTP challenge routes | `mfa-challenge-service.ts`, `mfa-challenge.plugin` via auth assembly; challenge tests | [mfa](../../../backend/guardian/mfa.md) | Source observed |
| Admin MFA reset | Supported; administrator-only mutation | dedicated admin MFA route/service | `auth-admin-mfa.plugin.ts`, `admin-mfa-user-service.ts`, admin hardening tests | [mfa#administrator requirement and recovery](../../../backend/guardian/mfa.md#administrator-requirement-and-recovery) | Source observed |
| Simple role authorization | Supported; default mode | `authorization: 'simple'`; builtin user roles and middleware policy | `auth-authorization.plugin.ts`, authorization kernel/access tests | [authorization](../../../backend/guardian/authorization.md) | Source observed |
| Advanced RBAC and custom roles | Supported; opt-in `authorization: { mode:'advanced', permissions, roles }` | static permission/role registry, `AuthorizationRoleService`, admin role/control-plane routes | `authorization-kernel.ts`, role service/store, registry/config tests | [rbac](../../../backend/guardian/rbac.md) | Source observed |
| Delegated role grants and owner protection | Supported; advanced authorization | grantable role set constrained by actor's own authority; protected owner transfer/adoption | `authorization-role-grant.ts`, application/tenant administration services and tests | [rbac](../../../backend/guardian/rbac.md) | Source observed |
| Application owner and tenant administration organization | Supported; multi/advanced control plane | `authorization.ownerAdoption` exact userId/email; `tenancy.administration.adoptTenantId`; app vs tenant scopes; application scope in multi mode only through live administration membership | `auth-config-authorization.ts`, tenancy reconciliation, auth admin integration tests | [control plane](../../../backend/guardian/control-plane.md) | Source observed |
| Single/multi tenancy, tenant create and select/switch | Supported; `tenancy` defaults single; creation defaults authenticated in multi | `auth.tenancy.mode`, terminology, creation mode; tenant-session routes / active tenant projection | `auth-config-tenancy.ts`, `tenancy-service.ts`, `auth-tenant-session.plugin.ts`, session integration tests | [tenancy](../../../backend/guardian/tenancy.md) | Source observed |
| Tenant/member administration and ownership | Supported; multi-tenant | organization tenant/member CRUD/status/role/ownership routes; member roles and generations | `auth-tenant-administration.plugin.ts`, service/mutation modules and integration tests | [tenant administration](../../../backend/guardian/tenant-administration.md) | Source observed |
| Invitations | Supported; multi-tenant onboarding default enabled; email delivery opt-in | invite inspect/accept, issue/revoke/list; default TTL 7d, max 30d; manual delivery default unless email enabled | onboarding types/config, invitation services/plugins/tests and transactional outbox | [invitations](../../../backend/guardian/invitations.md) | Source observed |
| Join requests | Supported; multi-tenant onboarding default enabled | submit/list/approve/deny, request-admission flow | `auth-tenant-join-request*`, onboarding plugin/config and integration tests | [join requests](../../../backend/guardian/join-requests.md) | Source observed |
| Verified-domain onboarding and membership verification | Supported; multi/onboarding opt-in | DNS TXT claim, mailbox proof, admission request; `verifiedDomains` subtree, custom TXT resolver supported | `auth-verified-domain*`, onboarding config/types, verified-domain and onboarding integration tests | [verified domains](../../../backend/guardian/verified-domains.md) | Source observed |
| User-bound API keys and management ceilings | Supported; disabled by default | `auth.apiKeys`: enabled/selfService/administratorIssuance false; TTL 30d default/90d max; max 10 active per user/scope; role allowlist | `auth-api-key-config.ts`, service/store/plugins, API-key tests and migration 029 | [api keys](../../../backend/guardian/api-keys.md) | Source observed |
| Service-HMAC API credentials | No Guardian service-HMAC API credential found in auth exports/config scan | `AUTH_SIGNING_KEY` is JWT signing JWK config, not an API key HMAC; inspect other platform systems separately | auth exports and `auth-signing-keys.ts`; storage HMAC belongs to storage, not Guardian | [api keys](../../../backend/guardian/api-keys.md) (explicit boundary) | Not a Guardian feature as inspected |
| Audit log/query/export/retention | Supported; always enabled with auth | `auth.audit`: 365d retention, batch 1000, interval 6h; platform/tenant event query/export/prune | audit config/service/plugin/tests; events omit email/freeform messages | [audit](../../../backend/guardian/audit.md) | Source observed |
| Identity projection and data-plane readiness | Supported; managed app + Fabric | Guardian identity anchors/projection/outbox; readiness plugin validates realm/foreign-key prerequisites | `identity-projection-*`, `identity-anchor-store.ts`, `data-realm-readiness.plugin.ts`, app/schema integration tests | [identity projection](../../../backend/guardian/identity-projection.md) | Source observed |
| Native OIDC public clients | Supported server protocol; separately maintained clients vary in maturity | `auth.nativeApps`: auto-enabled when clients exist; 15m request, 3m code, 30d refresh defaults; unique client IDs/exact redirects | native config/routes/storage and registration/recovery/tenant integration tests | [native provider](../../../backend/guardian/native-provider.md) | Source observed |
| Bootstrap/login/registration request admission | Supported; default enabled | `auth.requestAdmission`, six flow-specific rolling windows and caps; trusted proxy ranges or custom source resolver mutually exclusive | `auth-request-admission-config.ts`, schema/service, admission/rate-limit tests | [request admission](../../../backend/guardian/request-admission.md) | Source observed |

## Public Surface Map

The 31 original groups above now have focused authoritative draft destinations;
closely related account-token ceremonies share section-level homes rather than
parallel contracts. Canonical user administration is a separately reconciled
32nd group: [accounts](../../../backend/guardian/accounts.md) covers current-user
projection, canonical directory pagination, actor capability ceilings, profile/
status transitions and retained-history deletion. Source: `auth-current-user.plugin.ts`,
`auth-admin-query.plugin.ts`, `auth-admin-user-update.plugin.ts` and their domain
services. [Configuration](../../../backend/guardian/configuration.md),
[integration](../../../backend/guardian/integration.md),
[errors](../../../backend/guardian/errors.md) and
[roadmap](../../../backend/guardian/roadmap.md) supplement the feature homes.

Backend package export is `@zero/framework/auth` (`package.json` `./auth`),
including `defineAuthConfig`/`resolveAuthBehaviorConfig`, `AuthRuntime`,
`AuthSessionService`, `TokenService`, account/MFA/API-key/audit/tenant/admin
services and schemas, `AuthorizationKernel`/`AuthorizationRoleService`,
`UserStore`, identity projection and readiness helpers, auth plugin factories,
types, defaults, and errors. The standalone protocol internals are not all
application-level route APIs. `createApp({auth})` owns app-local service
composition. Frontend surfaces include `useAuth`/auth client provider,
authorization hooks and user/tenant/admin hooks under the frontend/client
entrypoints; `src/components/auth/` and `src/components/admin/users/` provide
login/registration/verification and user-management UI. The client auth package
is distinct from backend `@zero/framework/auth`. No Guardian-specific CLI
command was identified in inspected dispatch.

## Integration Map

- Guardian owns authentication and authorization; UI visibility is not an
  enforcement boundary. `extractAuthContext()` hydrates from a bearer token;
  `TokenService.resolveAuthContext()` checks live user, token/security
  generation, session, active tenant/membership, role and profile state rather
  than relying on the JWT role snapshot alone.
- Identity references bridge to application tables through declared Guardian
  metadata and schema checks (`src/schema/guardian-references*`,
  `src/frontend/server/identity-projection-config.ts`). Multi-tenant references
  have managed storage/foreign-key requirements.
- `createApp()` migrations and lifecycle own server services; session/action
  tokens are persisted in platform SQL. Email is a separate delivery system
  invoked by verification, recovery, invitation, and lifecycle features.
- Authorization scopes are application or tenant. In multi mode, application
  permissions are usable only through a live membership in the protected
  administration organization. `administrator` / `access-manager` are
  administration-organization role templates; they are not a customer tenant's
  owner. Tenant `owner` and application `owner` are separate protected
  assignments and transfer lifecycles. Applications may declare roles and
  permissions; delegation is limited to the actor's grantable ceiling.
- Tenant/authority mutations bump generations/revisions and are rechecked at
  service/commit boundaries. Identity projection uses an outbox/reconciler so
  Guardian identity anchors exist before application FKs commit. Data-realm
  readiness validates configured tables before serving. These transitions
  affect sync/Fabric and SDK scope state; verify each caller before claiming
  downstream revocation semantics.
- Stable auth event codes and redaction route through Zero observability.

## Configuration Inventory

Independent boolean-form check: `auth.apiKeys:true` enables keys and self-service, but not administrator issuance; false/omitted disables those capabilities. Object booleans are normalized separately. This distinction comes from auth-api-key-config.ts, not a blanket assumption that every true form enables every related feature.

Primary app type is `AppConfig.auth?: boolean | AuthBehaviorConfig`; `false`
disables Guardian, `true` or an object enables it. `createApp()` resolves auth
behavior before service startup through `resolveAuthBehaviorConfig()`; direct
`createAuthPlugin()` config also passes through normalization. At app level,
`auth.accessTokenTTL` / `auth.refreshTokenTTL` are duration strings and override
the environment. `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` then override defaults
15m / 7d when `TokenService` is constructed. `AUTH_SIGNING_KEY` is read by
`loadOrCreateAuthSigningKeys()` at startup; accepted key is private JWK JSON or
base64 JWK, PEM is rejected. Without it, app SQL durably stores a generated
ES256 keypair. No `.env` was read.

`AuthBehaviorConfig` top-level fields and normalized behavior (unknown keys
rejected):

| Config path | Type / accepted values | Default / effect | Secret/time notes |
| --- | --- | --- | --- |
| `auth.audit` | `{retentionDays,pruneBatchSize,pruneInterval}` | 365 days, 1000 rows, 6h (bounds 1–3650d, 1–10000 rows, 1m–7d) | SQL-backed; app service owns prune lifecycle |
| `auth.tenancy` | `'single'|'multi'` or object `{mode,terminology,creation,onboarding,administration}` | single; multi labels organization(s), creation authenticated, invitations/join requests true, verified domains false | Multi-only subtree rejected for single mode |
| `auth.authorization` | `'simple'|'advanced'` or `{mode,registryVersion,permissions,roles,ownerAdoption,legacySimpleRoleAdoption}` | simple, registryVersion 1; scope defaults application single / tenant multi | Static config; owner adoption only single/advanced; legacy adoption only multi/advanced |
| `auth.registration.mode` | `public|admin-only|disabled` | public after bootstrap | Empty-install bootstrap gate is separate |
| `auth.bootstrap` | `secret|public|disabled` or `{mode,secret}` | secret mode; no secret means unavailable | Secret >=32 chars; server-only, never projected |
| `auth.requestAdmission` | enabled, cleanup batch, trusted proxy ranges/header or custom source callback, per-flow limit objects | enabled true, cleanup 100, header `x-forwarded-for`, no trusted proxies | Callback is exclusive with proxy fields; startup-resolved |
| `auth.account` | `{requireEmailVerification,emailVerificationPath,allowAdminMarkEmailVerified}` | false, `/verify-email`, false | Verification requirement affects token issuance |
| `auth.mfa` | enabled/policy/methods/choice/multiple/remember/TTL/cooldown/attempts/recoveryCodes/TOTP object | disabled, optional, email+totp, choice true, multiple/remember/recovery false, 10m, 1m, 5 attempts, QR `M` | `totp.encryptionKey` secret; issuer defaults app name |
| `auth.accountEmails` | booleans, TTL/cooldown and reset/setup paths | adminCreatedUser false, passwordReset true, manualPasswordReset true, action 1h, cooldown 5m, `/reset-password`, `/setup-password`; `passwordChangedNotice` resolves false | Delivery depends on app `email`; one-time action records/outbox are SQL-backed |
| `auth.branding` | optional string fields appName/publicUrl/logoUrl/supportEmail/brandColor | omitted values absent | Auth pages and lifecycle email context |
| `auth.emails` | function map accountSetup/passwordReset/passwordChanged/emailVerification/domainMailboxProof/emailOtp/mfaEnabled/mfaDisabled/recoveryCodesRegenerated | empty | trusted callbacks resolved at startup |
| `auth.userProperties` | record `{type,label,values,default,editableBy,useInPolicies,description}`; type string/enum/boolean/number | inferred type, editor user, policy trust false; enum requires values | `useInPolicies:true` only for admin/system/none editor |
| `auth.strictUserProperties` | boolean | false | unknown user-property writes are not rejected by strict-key mode |
| `auth.nativeApps` | `{enabled,issuer,requestTTL,codeTTL,refreshTokenTTL,requestAdmission,refreshRotation,clients[]}` | enabled if clients exist; request 15m, code 3m, refresh 30d; scopes openid/profile/email | exact redirects/issuer validated at startup |
| `auth.apiKeys` | boolean or `{enabled,selfService,administratorIssuance,eligibleScopeRoles,defaultTTL,maxTTL,maxActivePerUser}` | all capabilities false; 30d default/90d max; 10 active keys per user/scope | secret shown once; hash+hint stored; no HMAC service key field |

Admission defaults, each shaped `{window,maxGlobal,maxPerSource,maxPerSubject}`:
bootstrap 10m/100/10/5; registration 10m/10,000/100/5; login
5m/100,000/100/20; invitation 10m/10,000/100/20; join-request
10m/10,000/50/10; domain-onboarding 10m/10,000/30/5.

Multi-tenant onboarding: invitations enabled/accountCreation true, TTL 7d/max
30d, manual delivery allowed and selected unless email delivery is enabled;
email delivery disabled, landing `/accept-invitation`, operator wrapping key
required if enabled. Join requests default enabled. Verified domains default
disabled; request-to-join only, allowed/default role `member`; challenge 24h,
DNS cooldown 30s, reverify 7d, grace 3d, retry 1h, mailbox proof max age/link
TTL 30m, admission 10m, denied retry 7d, DNS timeout 5s, 32 TXT answers,
8192 TXT bytes, 20 claims/tenant. Resolver integer bounds are enforced in
`auth-tenant-onboarding-config.ts`.

Doctor's auth email and public-path checks call the same resolver; wider checks
and each token-signing/environment branch should still be reconciled against
Doctor before a feature config page is verified. All behavior config resolves
during app configuration/startup; token TTL/signing environment is read when
the app-local token service/keypair is constructed. No app config was imported
or executed during this audit.

## Evidence And Verification

### Adaptive Account Capability Correction: 2026-10-06

This is a narrow supplemental dirty-source observation on top of
`39c0ed1de0501986810a2b99366f484e66ba80dc` (Zero 2.5.0), not a change to
the historical audit or a published profile-settings feature. The
[account inventory](../../../frontend/guardian/account-actions.md#current-profile-composition-and-capability-boundaries)
distinguishes actual identity/security/property/preference contracts from
missing self-edit/managed-avatar capabilities. No new account backend or
profile organism is claimed.

The existing MFAManagementPanel unconditionally loaded methods and remained
visible with MFA disabled, and guessed email/TOTP choices when actual
availability was empty. Its [capability correction](../../../frontend/guardian/mfa-controls.md#capability-correction-250-working-update)
now hides a definitively disabled panel without a request, treats unknown/
refresh/error states explicitly, and admits enrollment only for current ready
configured-and-available methods after accepted method status. It reuses the
monotonic authorization boundary fence and standard auth UI error/observability
helpers. Local request/enrollment state retires across policy, account and
organization changes; no server policy or enrollment service was rewritten.

Focused policy/lifecycle/SSR/config/enrollment regressions passed **13 tests /
52 assertions**. Independent policy/request review passed **8 / 36**. Actual
isolated Chromium passed **6 / 36**, covering disabled no-request behavior,
loading/config failures/missing capability, method failures/retry, availability,
policy refresh, account replacement, logout and delayed list/setup completions.
One initial browser timeout was a synthetic fixture leaving authorization
`ready` after clearing its user; fixing the fixture to match the SDK's
`unauthenticated` logout model resolved it without a production workaround.

The completed integrated production TypeScript check was clean. A later redundant
full compiler run was interrupted and is not counted as a pass; final browser
fixture bundling and acceptance passed separately. No app, credentials, provider,
live database or Pantheon file was used. These working checks do not assert a
released artifact or a full Guardian security audit.

### Authorized Configuration Truthfulness Corrections

The original source baseline remains pinned above. On 2026-10-05, independent
guide preparation found two configuration contradictions and reproduced them
before correcting the working tree:

- Reserved `mfa.rememberDevice` and `mfa.recoveryCodes` accepted `true` and
  projected enabled capabilities despite having no corresponding implementation.
  They now reject `true` at normalization with `AuthError`, code
  `AUTH_CONFIG_UNSUPPORTED_FEATURE`, status 422. Omission and explicit `false`
  remain compatible; this adds no remembered-device or recovery-code feature.
- `apiKeys.eligibleScopeRoles` incorrectly required every selected role to be
  assignable to customer organizations. This blocked an administrator-only
  user-key policy inside the Administration Organization, despite supported
  Administration tenant key bindings. The global allowlist now accepts declared
  roles from either organization kind. Role assignment still rejects
  administration-only roles in customer organizations; neither key scope nor
  permission ceilings have been widened.

Initial targeted checks had **3 passed and 4 failed** (one other integration
case was filtered); the failures included both reserved flags, administration
eligibility config admission and startup of that administration-key fixture.
After correction,
`bun --no-env-file test src/auth/auth-config-capability.test.ts src/auth/auth-api-key-advanced.integration.test.ts src/auth/auth-config.test.ts src/auth/auth-api-key-management.integration.test.ts`
passed **38 tests, 0 failed, 307 assertions across 4 files**, on Bun 1.3.14.

The new Administration integration proves that an eligible mixed-role member
can issue a user key bound to that exact Administration tenant/membership and
use granted app APIs. Removing its app role removes that permission; removing
the eligible administration role makes the key unavailable. Customer role
assignment remains rejected, and API keys cannot administer users or mint
other keys through session-only control routes. Removing platform authority
also invalidates the old administration session; an unchanged owner session
inspects the unavailable key through the active-tenant member-key API.

Production edits are limited to
[auth-config-account.ts](../../../../src/auth/auth-config-account.ts) and
[auth-api-key-config.ts](../../../../src/auth/auth-api-key-config.ts); focused
tests are in [auth-config-capability.test.ts](../../../../src/auth/auth-config-capability.test.ts),
[auth-api-key-advanced.integration.test.ts](../../../../src/auth/auth-api-key-advanced.integration.test.ts)
and the updated original config assertion. These tests use fresh ephemeral
databases and local synthetic Elysia fixtures. No existing app configuration,
credential, live database, external delivery or provider was used. This is
working-source evidence, not package or comprehensive security qualification.

Inspected package exports and source composition, auth/native source tree, auth
and frontend tests by filename, and current auth docs under `docs/auth/` as
research only. Relevant test evidence includes `src/auth/*.integration.test.ts`,
native provider integration tests, migrations, and `src/frontend/server/guardian-fabric.integration.test.ts`.
The original inventory pass observed tests from the clean source baseline
without executing them. The authorized correction checks above were run later
against the dirty development source; neither observation qualifies a released
artifact.

Source entry points: [`src/auth/index.ts`](../../../../src/auth/index.ts),
[`src/frontend/server/app-platform-services.ts`](../../../../src/frontend/server/app-platform-services.ts),
[`src/frontend/server/identity-projection-config.ts`](../../../../src/frontend/server/identity-projection-config.ts).

## Findings

### Independent Source Review Supplement

Actual account/MFA/tenancy/audit/API-key/native defaults and managed service composition were spot-checked. This is not a complete auth security audit. Frontend Guardian coverage is reconciled through [components](../catalogs/frontend-components.md), [hooks](../catalogs/frontend-hooks.md) and [SDK members](../catalogs/frontend-sdk-members.md), without conflating UI visibility with backend enforcement.

This targeted independent source review is complete for this inventory. It keeps the pinned main baseline distinct from authorized working-tree fixes; it does not complete whole-platform or exact-package gates.

- Coverage is broad; the new docs must separate authentication, authorization,
  tenancy, application/platform administration, and UI behavior rather than
  treating “auth” as one feature page.
- Auth configuration defaults and environment precedence are source-mapped
  above; targeted tests and live-session/authority transitions still need
  independent review before the reader guides make operational guarantees.
- Release applicability is unresolved: source version metadata alone does not
  prove shipped package behavior.

## Known Future Plans

The [Guardian roadmap](../../../backend/guardian/roadmap.md) now reconciles known
user/product direction: external OAuth integration, optional authentication
providers, network policy, server-only/service credentials, billing integration
and deliberate future MFA recovery/device capabilities. It does not expose
planned configuration or infer shipment from historical design drafts.

## Navigation And Cross-Link Plan

Parent index: [systems](./index.md). Reader system home:
[Guardian](../../../backend/guardian/index.md), with 28 drafted pages including
configuration/roadmap and all 32 feature groups mapped to focused section
contracts. Closely related action-token/MFA groups share one canonical page
rather than duplicate contracts. Runtime, Schema, service-boundary, data-plane,
reactivity and Guardian feature links are reciprocal where context requires.
Frontend/SDK companion contracts remain independently owned, not silently
completed by the backend guides.

### Detailed Guide Review Evidence

The draft rewrite was checked directly against auth config normalizers/types,
named Elysia route composition, account/session/token/MFA services, permission
compiler, registry/assignment/delegation services, Administration/customer
admission, invitation/join/domain routes and proof types, key management/
authority, audit projection/retention, native OIDC provider and identity
projection/readiness. It uses public imports and preserves exact mode,
credential, scope, revision and completion boundaries.

`bun --no-env-file test docs-next/_work/checks/guardian-examples.test.ts`
passed **1 test, 0 failed, 2 assertions**, compiling 19 actual complete/explicit
dependent Markdown TypeScript examples against public source exports using an
in-memory TypeScript host. It did not execute config, load env, create a DB,
start a listener or contact providers. This is source example verification,
not packaged artifact qualification.

The structural checker passed at a stable completed batch with
**181 pages / 181 unique IDs / 181 reachable / 0 problems**. Concurrent new
Scheduler/frontend pages may temporarily add their own in-progress targets;
Guardian itself had no unresolved target/index/backlink issue.

Root-owned Doctor correction was independently reviewed and rerun:
`bun --no-env-file test src/doctor/auth-public-path-checks.test.ts` passed
**5 tests, 0 failed, 16 assertions**. Managed token TTL overrides no longer
suppress public auth-page warnings in the corrected source; invalid behavior
reporting remains composable. The new configuration guide labels this as a
development correction, not clean baseline behavior.

## Completion Review

- [x] Targeted independent source/default/public-boundary review completed; no whole-platform or package qualification inferred.
- [x] All 32 feature groups assigned a real detailed backend draft home, with configuration/index/roadmap.
- [x] Actual TypeScript examples checked against public source contracts without execution.
- [x] Source review reconciled live authority, data-plane readiness, errors and safe observability.

- [ ] Every exported auth symbol/route/config option checked against source.
- [ ] All auth UI components/hooks individually reconciled to canonical homes.
- [ ] Identity projection, live authority, revocation, lifecycle, errors, and
  observability reviewed against focused tests.
- [ ] Whole-platform independent review completed.
