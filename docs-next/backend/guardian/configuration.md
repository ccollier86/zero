---
id: zero.guardian.configuration
type: reference
audience: [developer, agent, operator]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: configuration
maturity: supported
applies_to: ["2.1.1 source with unreleased Guardian configuration corrections"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Guardian Configuration Reference

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian configuration is trusted server code resolved during managed app
construction/service startup. Restart/recompose to change it. It is not a
database-editable policy document supplied by an untrusted client.

This reference includes two unreleased corrections: reserved MFA
rememberDevice/recoveryCodes true values now reject, and an API-key role
allowlist may include declared Administration-only roles. They do not implement
new MFA methods or widen customer assignment/credential ceilings.

## Public Entry And Read Time

`defineAuthConfig` and `resolveAuthBehaviorConfig` are public from
`@zero/framework/auth`. The define helper preserves inference and returns its
input; the resolver validates/normalizes behavior. Neither creates a user,
starts a listener or executes an app migration.

Managed `AppConfig.auth` accepts omitted/false (disabled), true (enabled
defaults), or an auth object (enabled configured behavior). Object fields and
nested accepted keys are validated; null is not a disabled alias. Managed
auth additionally accepts accessTokenTTL/refreshTokenTTL; those are token
construction inputs, not top-level fields accepted by the standalone behavior
resolver.

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  tenancy: 'multi',
  authorization: {
    mode: 'advanced',
    registryVersion: 1,
    permissions: { 'notes:read': { scope: 'tenant' } },
    roles: { reader: { permissions: ['notes:read'] } },
  },
  bootstrap: 'disabled',
  registration: { mode: 'admin-only' },
  apiKeys: { enabled: true, selfService: true },
});
```

This fragment intentionally does not provision an owner. Choose the real
[bootstrap ceremony](./bootstrap.md) before deploying an empty installation.

## Token And Page Settings

| Path/input | Type/default | Resolution and effect |
| --- | --- | --- |
| auth.accessTokenTTL | Duration string, 15m fallback. | Config > ACCESS_TOKEN_TTL > default at TokenService construction. |
| auth.refreshTokenTTL | Duration string, 7d fallback. | Config > REFRESH_TOKEN_TTL > default at TokenService construction. |
| AUTH_SIGNING_KEY | Server environment private JWK JSON or base64 JWK. | Read at key initialization; otherwise generated ES256 keypair is durably persisted in system SQL. PEM is rejected. |
| AppConfig.loginPath | Safe local path, /login. | Managed page unauthenticated destination and native login route. |
| AppConfig.registrationPath | Safe local path, /register. | Native registration continuation page. |
| AppConfig.postLoginPath | Safe local path, /. | Fallback after login/already-authenticated login-page visit; safe redirect return path wins; cannot resolve to loginPath. |
| AppConfig.routeAuth | protected-by-default or explicit. | Protected-by-default when auth enabled; explicit uses page/layout declarations. |
| AppConfig.publicPaths | Path array, derived auth/public defaults when omitted. | Explicit array is authoritative; include required public lifecycle pages. |

Page cookie name/HttpOnly/SameSite behavior is not a user-configurable key.
The [session contract](./sessions.md) owns cookie, rotation and revocation.

## Tenancy

See [mode selection](./modes.md) and [tenant sessions](./tenancy.md).

| Path under auth.tenancy | Accepted values / default | Interaction |
| --- | --- | --- |
| tenancy shorthand | single or multi; single. | Object form enables additional fields. |
| mode | single or multi; single. | All four tenancy/authorization combinations exist. |
| terminology.singular | String; organization. | Multi only; trimmed/lowercase, nonempty, up to 40 characters. |
| terminology.plural | String; organizations. | Same rules; presentation only, not renamed API fields. |
| creation.mode | authenticated, platform-admin, disabled. | Multi default authenticated; single creation disabled. |
| administration.adoptTenantId | Exact trimmed internal ID, 1–256 characters. | Multi-only deliberate administration adoption, not a slug or public selector. |
| onboarding | Object. | Multi only; complete subtrees below. |

Single mode rejects the multi-only terminology, creation, onboarding and
administration subtrees rather than silently ignoring them.
Guardian tenancy does not itself enable Fabric or migrate application rows.

## Authorization Registry

See [access requirements](./authorization.md), [RBAC](./rbac.md) and
[control plane](./control-plane.md).

| Path under auth.authorization | Accepted values / default | Interaction |
| --- | --- | --- |
| authorization shorthand | simple or advanced; simple. | Object supplies registry/adoption fields. |
| mode | simple or advanced; simple. | Simple scope projection versus retained advanced assignments. |
| registryVersion | Safe integer 1–2147483647; 1. | Increment for semantic registry changes before deployment. |
| permissions | Record keyed by validated permission key. | Includes immutable framework definitions; normalized ceiling at most 512 entries. |
| permissions[key].label | Nonempty trimmed string, at most 120; key. | Human-readable control labels. |
| permissions[key].description | Optional nonempty trimmed string, at most 500. | Human-readable help. |
| permissions[key].scope | application or tenant. | Defaults application single / tenant multi. |
| roles | Record keyed by validated role key. | Normalized ceiling at most 128 entries. |
| roles[key].label | Nonempty trimmed string, at most 120; key. | Display metadata. |
| roles[key].description | Optional nonempty trimmed string, at most 500. | Display metadata. |
| roles[key].permissions | Unique array of declared permission keys; empty. | Unknown/duplicate keys reject. |
| roles[key].allPermissions | Boolean; false. | Cannot combine true with a nonempty explicit permission array. |
| roles[key].system | Boolean; false for app declarations. | Protected role template, not a normal grantable role. Framework owner semantics cannot be overridden. |
| ownerAdoption.userId | Exact existing internal user ID, or use email instead. | Exactly one selector; single/advanced only. |
| ownerAdoption.email | Valid canonical email, or use userId instead. | Deliberate owner adoption, not a runtime user request. |
| legacySimpleRoleAdoption | Only true when supplied. | Explicit multi/advanced legacy adoption; not available in other profiles. |

Tenant-only app roles are assignable inside both customer and Administration
organizations. Roles containing application permissions are Administration-only.
Declarations do not themselves attach a rule to a route or table.

## Bootstrap, Registration And Account

| Path | Accepted values / default | Effect |
| --- | --- | --- |
| bootstrap shorthand / bootstrap.mode | secret, public, disabled; secret. | First-owner ceremony only. |
| bootstrap.secret | String at least 32 characters; omitted. | Only valid in secret mode; omission leaves empty-install bootstrap unavailable. Never projected. |
| registration.mode | public, admin-only, disabled; public. | Ordinary account creation after bootstrap; disabled also rejects administrator account creation. |
| account.requireEmailVerification | Boolean; false. | Ordinary registration/login account gate; first bootstrap owner exempt. |
| account.emailVerificationPath | String; /verify-email. | Public verification page, not API rename. |
| account.allowAdminMarkEmailVerified | Boolean; false. | Privileged manual proof-substitution capability. |

[Registration](./registration.md) and [verification](./email-verification.md)
describe completion unions. Client capability projection contains safe policy/
readiness, not a bootstrap secret or a wholesale server configuration object.

## Required First-Use Profile Completion

This subsection records unreleased working source observed against
`ae85a4b6efe11eeb74ab89b15ed02a23e982c59f` plus the adaptive-profile dirty
changes on 2026-10-06. It does not widen the historical frontmatter baseline
or establish package qualification for this capability.

Configure `auth.userProfile.completion` only when deliberately requiring a
[completed profile before application access](./profile-completion.md).
The parent `userProfile.enabled` must also be true. Required field policies are
the ordinary enabled/editable `userProfile.fields` policies, not a second schema.

| Path under auth.userProfile.completion | Accepted values / default | Effect |
| --- | --- | --- |
| enabled | Boolean; false. | Opt-in identity-only completion before tenant/full-session admission. |
| onSignup | Boolean; true. | Durably enrolls new signup accounts when completion is enabled. |
| onInvitation | Boolean; true. | Enrolls newly created invitation/admin-provisioned identities; does not reopen completed existing identities. |
| existingUsers | `none` or `onSignIn`; `none`. | Explicit existing-account rollout. Enabling completion does not implicitly enroll old accounts. |
| ttl | Positive seconds/minutes duration, 1–30 minutes; `10m`. | Lifetime of an opaque one-time completion proof. |

Configuration is resolved at runtime startup; restart/recompose to change it.
There is no environment alias or database-editable browser policy. Unknown keys,
invalid types/rollout values, and TTL outside the bounds reject. Required avatar
or contact-proof options are not supported by this completion contract.
Migration 043 installs the fixed SYSTEM enrollment/policy/continuation substrate;
managed `migrate: false` leaves missing schema blocked rather than silently
creating it. A newer installed policy fingerprint prevents an older runtime
or proof from issuing credentials under stale requirements.

See the [completion guide](./profile-completion.md) for ordering, actual response
unions, native consent preservation, compare-and-swap retry and safe rollout.

## MFA

See [MFA enrollment, challenge and enforcement](./mfa.md).

| Path under auth.mfa | Type/default | Effect |
| --- | --- | --- |
| enabled | Boolean; false. | Master capability. |
| policy | optional, required, admin-required; optional. | Live global/per-admin enforcement. |
| methods | Nonempty array of email/totp; both. | Deduplicated, preserves configured order. Readiness separately filters actual availability. |
| allowUserChoice | Boolean; true. | Enrollment presentation/method choice. |
| allowMultipleMethods | Boolean; false. | Multiple-method enrollment policy. |
| rememberDevice | Omitted/false only in corrected source. | Reserved; true rejects AUTH_CONFIG_UNSUPPORTED_FEATURE, not an enabled capability. |
| recoveryCodes | Omitted/false only in corrected source. | Same reserved-feature rejection; no recovery-code UI/API. |
| challengeTTL | Duration string; 10m. | Limited challenge/setup proof lifetime; consumer validates duration. |
| challengeCooldown | Duration string; 1m. | Email OTP resend pacing. |
| maxAttempts | Finite number >=1; 5, floored. | Verification attempts per challenge. |
| totp.issuer | Optional trimmed string; app name used by enrollment when omitted. | Authenticator label. |
| totp.encryptionKey | Server-only string; omitted. | Required for ready TOTP; protects persisted seeds. Not an automatic env binding. |
| totp.qrRobustness | L, M, Q, H; M. | QR display correction level. |

Required/admin-required enforcement needs a ready configured method.
Existing unenrolled accounts can enter login-time setup; limited setup proofs
do not grant general API access. Safe config projects readiness and whether
encryption is configured, never the key.

## Lifecycle Email, Branding And Templates

See [password lifecycle](./password-recovery.md) and
[email verification](./email-verification.md).

| Path under auth.accountEmails | Type/default | Effect |
| --- | --- | --- |
| adminCreatedUser | Boolean; false. | Default setup-email choice for administrator creation; per-request sendSetupEmail can select it. |
| passwordReset | Boolean; true. | User/admin reset email capability; delivery readiness still required. |
| passwordChangedNotice | Boolean input, resolves false. | Reserved/deprecated; no committed-change notification sender. |
| manualPasswordReset | Boolean; true. | Direct administrator password replacement. |
| actionTokenTTL | Duration string; 1h. | One-time account action proof. |
| requestCooldown | Duration string; 5m. | Same-user/type active action-email cooldown. |
| resetPath | String; /reset-password. | Public reset page appended to resolved branding/app public URL. |
| setupPath | String; /setup-password. | Public setup page. |

Account path normalization trims, falls back when empty and prefixes a slash.
That does not replace managed safe-local-path/public-route validation.

Branding is an optional string object:
appName overrides app.name (then “Zero app”); publicUrl overrides app.publicUrl;
logoUrl is optional; supportEmail overrides app.supportEmail;
brandColor defaults #2563eb after auth override. These values describe links/
presentation, not credential admission. Email readiness requires the configured
provider/sender/credentials and usable public origin where links are needed.

auth.emails is a function registry with accepted keys accountSetup,
passwordReset, passwordChanged, emailVerification, domainMailboxProof, emailOtp,
mfaEnabled, mfaDisabled and recoveryCodesRegenerated. A callback receives typed
branding, user, default copy and relevant actionUrl/code/expiry metadata,
returning {subject,text,html?} synchronously or asynchronously.
Register with defineAuthEmailTemplates from @zero/framework/auth if desired.

An accepted template key does not implement its corresponding reserved event.
Do not claim password-change notices or recovery-code regeneration merely
because their future-compatible template keys exist. Templates are trusted
server callbacks and may receive secrets; they must not log their context.

## User Profile And Optional Services

`userProfile` configures the ordinary own-account surface independently from
administrative writers. It defaults enabled with first/last name editing; other
typed fields, separate username, regional preferences, contacts and avatars are
independently opt-in. Field policies specify enabled/editable/required. Regional
configuration selects locale/timeZone/timeFormat/weekStartsOn and inherited
defaults. Read [own profiles](./user-profiles.md) for exact field/default/CAS rules.

`userProfile.contacts` enables purpose-bound mailbox proof/email change and typed
phone possession. Actual email/provider readiness and native writer ceilings
remain authoritative. `phoneVerificationAdapter` is a trusted dependency, not a
browser-editable provider selector. See [contacts](./contacts.md).

`userProfile.avatars` accepts a boolean or bounded presentation/media policy.
It requires the existing Storage service and private SYSTEM provisioning, and
shares the account profile revision. See [avatars](./avatars.md).

`presence` is independently disabled by default. It configures activity/lease
timings, semantic statuses and optional On call/custom intent. One SDK tracker
and one SYSTEM owner supply fresh, live-scoped observations. Fabric actors need
the same public presence contribution in their actual realm declaration. See
[presence](./presence.md) for topology and SQL contracts.

Enabling a feature after deployment is not a UI-only switch. Install its fixed
SYSTEM migrations and required service/realm contribution under the deployment's
normal migration policy, then restart/recompose. With migration disabled,
missing/incompatible substrate remains blocked rather than silently repaired.
Disabled optional features retain data; no application-configured arbitrary
columns are added to every organization database.

## User Properties

See [property trust](./user-properties.md).

| Path | Type/default | Effect |
| --- | --- | --- |
| strictUserProperties | Boolean; false. | Reject unknown keys when enabled. |
| userProperties | Record; empty. | Canonical account metadata schema. |
| userProperties[key].type | string, enum, boolean, number; inferred. | values => enum; Boolean/number default => type; otherwise string. |
| label / description | Optional strings. | UI metadata, not permission. |
| values | String array. | Required/nonempty for enum. |
| default | String, number or Boolean; absent. | Canonical string representation, fills missing defaults rather than overwriting existing values. |
| editableBy | user, admin, system, none; user. | Write/deletion policy. |
| useInPolicies | Boolean; false. | Only admin/system/none editors may opt into trusted authorization predicates. |

## API Keys

See [API-key lifecycle](./api-keys.md).

| Path under auth.apiKeys | Type/default | Effect |
| --- | --- | --- |
| shorthand | Boolean; false. | true enables keys+self-service, not administrator issuance. |
| enabled | Boolean; false. | Master capability. |
| selfService | Boolean; false. | Eligible subjects may manage their own keys. |
| administratorIssuance | Boolean; false. | Admitted managers may issue for eligible subjects. |
| eligibleScopeRoles | Optional nonempty unique string array. | Live scope-role allowlist; advanced roles must be declared. Administration-only roles allowed in corrected config without widening customer assignment. |
| defaultTTL | Positive s/m/h/d duration; 30d. | Default finite credential expiry. |
| maxTTL | Positive s/m/h/d duration; 90d. | Maximum, Date-compatible expiry; defaultTTL <= maxTTL. |
| maxActivePerUser | Safe integer 1–100; 10. | Per-user/per-scope active credential cap. |

Enabling issuance with keys disabled rejects configuration. Secret-free public
config omits role eligibility internals; management pages return actor/subject
capabilities. No service-HMAC/env service-key option exists here.

## Invitations And Join Requests

Paths below auth.tenancy.onboarding:

| Path | Type/default | Effect |
| --- | --- | --- |
| invitations.enabled | Boolean; true. | Multi invitation capability. |
| invitations.accountCreation | Boolean; true. | Permit exact email-bound account creation on acceptance. |
| invitations.defaultTTL | Positive duration <=90d; 7d. | Default expiry. |
| invitations.maxTTL | Positive duration <=90d; 30d. | Issuer ceiling; defaultTTL <= maxTTL. |
| invitations.delivery.default | manual or email; email when enabled, otherwise manual. | Request omission policy. |
| invitations.delivery.allowManual | Boolean; true. | Allow one-time raw token for trusted manual delivery. |
| invitations.delivery.email.enabled | Boolean; false. | Durable outbox delivery; app email/public URL required. |
| invitations.delivery.email.landingPath | Safe app-relative path 1–200; /accept-invitation. | No query/fragment/whitespace or protocol-relative path. |
| invitations.delivery.email.encryptionKey | Unpadded base64url 32-byte server key. | Required when email enabled; wraps queued invitation data keys. |
| invitations.delivery.email.previousEncryptionKeys | Array, at most 3 distinct prior keys; empty. | Controlled rewrap rotation; cannot duplicate current/each other. |
| invitations.delivery.email.template | Optional trusted sync/async typed template callback. | Overrides invitation copy, not admission. |
| joinRequests.enabled | Boolean; true. | Ordinary applicant request/review capability. |

At least one delivery mode must be permitted; selected email default requires
email enabled, manual default requires allowManual. See
[invitations](./invitations.md) and [join requests](./join-requests.md).

## Verified Domain Onboarding

Paths below auth.tenancy.onboarding.verifiedDomains.
Positive duration fields use s/m/h/d and cap at 365d, except DNS timeout <=60s.

| Path | Type/default | Effect |
| --- | --- | --- |
| enabled | Boolean; false. | Requires joinRequests.enabled; request-to-join only. |
| allowedRequestRoles | Nonempty declared role list; member. | Non-system bounded customer roles, never owner/allPermissions/platform roles. |
| defaultRequestRole | Role key; member. | Must be in allowedRequestRoles. |
| challengeTTL | Duration; 24h. | One-time DNS proof lifetime. |
| dnsCheckCooldown | Duration; 30s. | DNS check pacing. |
| reverifyInterval | Duration; 7d. | Lease reverification. |
| gracePeriod | Duration; 3d. | Admission grace after lease expiry. |
| reverifyRetryInterval | Duration; 1h. | Recheck failure pacing. |
| mailboxProofMaxAge | Duration; 30m. | Freshness of mailbox proof. |
| mailboxLinkTTL | Duration; 30m. | Delivered proof link lifetime. |
| admissionTTL | Duration; 10m. | Proof-bound continuation. |
| deniedRetryCooldown | Duration; 7d. | Denied/cancelled request retry pacing. |
| mailboxLandingPath | Safe app-relative path 1–200; /domain-onboarding. | Dedicated public proof page. |
| sharedMailboxDomains | Exact normalized domain array; empty extra entries. | Additional shared domains to reject. |
| resolveTxt | Optional trusted async (hostname) => TXT-segment arrays. | Bounded DNS adapter, not browser-chosen targets. |
| dnsTimeout | Positive duration <=60s; 5s. | Wall-clock resolver bound. |
| maxTxtAnswers | Safe integer 1–256; 32. | Resolver response bound. |
| maxTxtBytes | Safe integer 128–65536; 8192. | Joined response bytes. |
| maxClaimsPerTenant | Safe integer 1–100; 20. | Retained exact claim limit. |

[Verified domains](./verified-domains.md) owns proof/lifecycle semantics.

## Public Request Admission

Paths under auth.requestAdmission:

| Path | Type/default | Effect |
| --- | --- | --- |
| enabled | Boolean; true. | Atomic public-flow admission. |
| cleanupBatchSize | Safe integer 1–10000; 100. | Expired-row cleanup per request. |
| trustedProxyRanges | String CIDR/address array; empty. | Peers allowed to supply forwarded chain. |
| forwardedForHeader | String; x-forwarded-for. | Explicit custom header requires trusted ranges. |
| sourceKey | Optional synchronous trusted resolver. | Mutually exclusive with configured proxy/header options. |
| bootstrap, registration, login, invitation, joinRequest, domainOnboarding | Flow objects. | Each accepts window and maxGlobal/maxPerSource/maxPerSubject. |

[Request admission](./request-admission.md#defaults-and-flows) gives every
flow's default. Window positive <=1d; caps safe integer 1–1000000.
No-source disables only that local bucket, not global admission.

## Native Public Clients

Paths below auth.nativeApps; see [provider protocol](./native-provider.md).

| Path | Type/default | Effect |
| --- | --- | --- |
| enabled | Boolean; true if clients exist. | Explicit false disables; enabled requires at least one client. |
| issuer | Valid canonical URL; app publicUrl/auth fallback in managed composition. | HTTPS outside loopback; not an untrusted Host value. |
| requestTTL | Positive duration <=1h; 15m. | Authorization request expiry. |
| codeTTL | Positive duration <=10m; 3m. | One-time code expiry. |
| refreshTokenTTL | Positive duration <=365d; 30d. | Native family expiry, distinct from browser refresh TTL. |
| clients | Array; empty. | Unique registered public clients. |
| clients[].clientId | Public validated identifier 1–128. | Never a secret. |
| clients[].name | Nonempty already-trimmed string. | Consent label. |
| clients[].redirectUris | Nonempty unique validated URI array. | Exact safe callbacks; loopback port exception only. |
| clients[].scopes | Unique native scope array; defaults openid/profile/email. | Supported: openid, profile, email, phone, profile:write, contacts:write. Must include openid; writer scopes also require profile. These are explicit credential ceilings, not app permissions. |

Adding a writer scope to a registered native client does not add it to existing
credentials or to the browser/native SDK's default request. Request it explicitly
when the app needs self-profile/contact writes, and preserve the independent
server-enabled profile policy. See [native scopes](./native-provider.md#multi-tenant-and-live-revocation).

Native requestAdmission accepts cleanupBatchSize (100, max10000),
maxOutstandingGlobal (1000), maxOutstandingPerClient (100),
maxOutstandingPerSource (20), rollingWindow (1m, <=1d),
maxAdmissionsGlobal (300), maxAdmissionsPerClient (60),
maxAdmissionsPerSource (20), trustedProxyRanges (empty), forwardedForHeader
(x-forwarded-for) and sourceKey. Limits are positive safe integers <=1000000.
Proxy/resolver exclusivity follows the same source-trust rules above.

Native refreshRotation accepts cleanupBatchSize (100, max10000),
minRotationInterval (30s, 0 allowed, <=1h),
maxRotationsPerFamily (4096, 1–100000) and
maxActiveFamiliesPerUserClient (10, 1–1000).
These are separate from general auth requestAdmission.

## Audit

Paths under auth.audit:

| Path | Type/default | Effect |
| --- | --- | --- |
| retentionDays | Safe integer 1–3650; 365. | Durable event retention, not an enable flag. |
| pruneBatchSize | Safe integer 1–10000; 1000. | Bounded deletion transaction. |
| pruneInterval | Duration 1m–7d; 6h. | Background pruning lifecycle. |

[Audit](./audit.md) owns query/export and access.

## Direct Plugin Dependency Options

createAuthPlugin from @zero/framework/auth accepts the same behavior plus:

| Option | Meaning |
| --- | --- |
| db | Required caller-owned ReactiveDB where auth installs canonical tables. |
| runtime | Optional owning ZeroAppRuntime for managed app-local services/observability. |
| emailRuntime / getEmailRuntime | Fixed/lazy owning app email boundary; do not bind another app. |
| platformTokenService / getPlatformTokenService | Fixed/lazy platform token dependency; explicit null selects legacy action storage. |
| onRuntimeCreated | Composition callback receiving this plugin's AuthRuntime. |
| accessTokenTTL / refreshTokenTTL | Token construction overrides described above. |
| nativeIssuer / nativeAudience | Advanced canonical issuer/audience; must share origin; audience is origin without path. |
| loginPath / registrationPath | Native browser ceremony local paths, /login and /register. |

identityProjection/dataRealmReadiness fields are marked internal managed
composition dependencies, not ordinary browser/app config selectors.
[Integration](./integration.md) demonstrates app-local getters.

## Diagnostics And Public Projection

The corrected development source keeps auth public-path checks active when
managed accessTokenTTL/refreshTokenTTL overrides are present; those two fields
are removed before strict behavior normalization. This is not a claim about
the original inspected package's Doctor behavior.

Doctor resolves selected auth policy/readiness paths and checks bootstrap
exposure/missing secret, owner adoption, email/MFA readiness and required public
account routes. Its native checks validate canonical origin/client policy.
Doctor imports trusted configuration modules: it is not a static-only security
sandbox and must not execute untrusted project config for inspection.

Public /auth/config returns selected safe capabilities; admin/config and
tenant/platform projections provide actor-appropriate details. No projection
returns encryption/bootstrap/signing secrets or full server callback objects.
Doctor output must likewise redact secrets; checking configuration is not
authorization to print an environment file.

## Related Guides And Next Steps

- [Modes](./modes.md) is the starting point before selecting settings.
- [Integration](./integration.md) wires the normalized policy into services.
- [Errors](./errors.md) distinguishes configuration, admission and domain failure.
- [Roadmap](./roadmap.md) labels ideas that are not available config fields.
