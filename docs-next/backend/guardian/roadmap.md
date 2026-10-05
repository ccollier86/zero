---
id: zero.guardian.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: future-direction
maturity: planned
applies_to: ["Planning only; not an available configuration contract"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Guardian Roadmap

[Guardian index](./index.md) · [Documentation index](../../index.md)

This records known product direction and explicit ideas, without dates,
priority promises or invented configuration fields. An unchecked item is not
an available feature. Current contracts live in the focused guides and
[configuration reference](./configuration.md).

## Foundations Already Available

- Single/multi tenancy and simple/advanced authorization are independent profiles.
- Canonical users, durable sessions, page cookies and live role/membership authority.
- Protected Administration ownership with ordinary app roles and additional
  platform roles, delegated ceilings and tenant-bound control operations.
- Invitations, request review and exact verified-domain/mailbox onboarding.
- Email OTP/TOTP, login-time required enrollment and administrator recovery.
- User-bound API keys with explicit app-route admission, rotation, expiry,
  eligibility and live credential ceilings.
- ID-only local projection for application FK integrity.
- Public native OAuth/OIDC clients with PKCE and shared account policy.
- Durable audit/query/export/retention and standard observability.

These statements describe current inspected source, not completion of every
future extension or release/security qualification.

## Recorded Product Direction

- [ ] Integrate the separately developed external OAuth plugin with current
  Guardian account linking, MFA, tenancy, audit, system-plane storage and
  Fabric service boundaries. External social/provider login is different from
  Guardian's existing installed-app OIDC provider.
- [ ] Extend the authentication-provider ecosystem with social OAuth, enterprise
  SSO, passkeys and CAPTCHA/bot-control capabilities where coherent plugin
  boundaries can share the same account/session lifecycle.
- [ ] Design network allow/deny policy across appropriate app, administrator,
  tenant, user, session, API-key and service-route scopes. Define trusted proxy
  semantics, IPv4/IPv6 normalization, precedence, lockout recovery, audit and
  enforcement across official transports.
- [ ] Add a deliberate server-only project profile, initially single tenancy
  with simple/advanced permissions, secure owner bootstrap and headless
  account/credential management. HMAC/service-role policy is design work,
  not a currently shipped Guardian service key.
- [ ] Integrate a billing/payment plugin with roles/account status/credits and
  lifecycle rules without making Guardian itself a payment processor.
- [ ] Improve role/permission/organization gating and adaptable account/control
  UI where a real application case exposes a missing composable primitive.
- [ ] Evaluate focused compliance evidence/control packs, including access
  review, retention/export and deployment responsibility maps. A plugin cannot
  certify an application's legal/regulatory compliance by installation alone.

## Ideas That Still Need A Contract

- [ ] Remembered-device MFA with revocation, bounded trust lifetime and
  user-visible device management.
- [ ] Recovery codes with one-time consumption, secure regeneration and
  explicitly audited recovery assurance.
- [ ] Committed password-change notifications with accurate outcome/delivery
  semantics.
- [ ] Service credentials/HMAC and potentially later mTLS, with a distinct
  non-human principal, rotation, scope ceiling and commit-time revocation.
- [ ] A narrow migration assistant for a well-defined simple single-to-multi
  case, after data ownership/placement can be proven. Do not promise arbitrary
  application conversion.

These are deliberately not accepted `true` capability switches today.
Do not put credentials/policy in invented settings or advertise an unsupported
UI while their domain/lifecycle behavior remains unimplemented.

## Definition Of Done For Future Work

A new auth capability must be integrated through declared config, app-local
Elysia/service composition, current identity/session and tenant boundaries,
standard errors/observability, safe SDK contracts, adaptable accessible UI
where appropriate, focused concurrency/revocation/recovery tests and exact
documentation. Optional provider methods must not fork canonical users or
copy authentication into application tenant databases.

Before expanding configuration, establish capability/readiness, actor/subject
authority, secret handling, durability and upgrade behavior. Existing app API
names should stay stable unless a deliberate migration is agreed.

## Related Guides And Next Steps

- [Configuration](./configuration.md) lists only real inputs and reserved boundaries.
- [Integration](./integration.md) preserves services/middleware/lifecycle.
- [Errors](./errors.md) preserves safe domain diagnostics.
- [Native provider](./native-provider.md) is already an implemented public-client protocol.
