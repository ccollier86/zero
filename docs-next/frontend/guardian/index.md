---
id: zero.frontend.guardian
type: index
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: frontend-overview
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Guardian Components, Hooks And Client Facades

[Frontend index](../index.md) · [Documentation index](../../index.md)

Guardian's frontend layer turns the canonical account/session/permission system
into authentication flows, safe visibility gates and adaptable user/organization
control planes. Components own presentation and interaction; hooks/facades own
authenticated transport and scoped loading; the backend owns authority.

Choose the [Guardian profile](../../backend/guardian/modes.md) and
[server policy](../../backend/guardian/configuration.md) first. Enabling a button
or hiding an element is not a permission grant, and rendering an organization
name is not a Fabric database binding.

The focused frontend guides are being reconciled against public component,
hook and SDK exports. This internal draft entrance is not a release-qualified
manual or a claim that every preview native host adapter is bundled.

## Canonical Contract Links

- [Frontend configuration](./configuration.md): server policy versus optional UI
  placement, extension callbacks and mode adaptation.
- [Public Guardian SDK facades](./sdk-surfaces.md): account, tenant, global account,
  application/platform control and credential namespaces.
- [Low-level AuthClient and errors](./auth-client.md): controller ownership,
  transport boundary and committed-session recovery.
- [Frontend roadmap](./roadmap.md): known direction separated from current contracts.

- [Organization onboarding controls](./onboarding-controls.md): selection,
  creation, exact invitation acceptance, retained join requests and domain proof.
- [Tenant switching](./tenant-switching.md): committed session replacement and
  AppShell workspace presentation.
- [API-key controls](./api-key-controls.md): optional target-specific management
  and one-time credential handling.
- [Audit/readiness controls](./audit-controls.md): authorized history and
  application data readiness barriers.

- [Adaptive people/organization control plane](./people-control-plane.md): one
  list/detail/action surface that follows profile and live capabilities.
- [Management hooks](./management-hooks.md): account, application RBAC,
  Administration/customer directories and independently retried onboarding slices.

- [Login, registration and continuations](./authentication-flows.md): policy-aware
  forms and completion guards, not token-presence shortcuts.
- [Account action forms](./account-actions.md): password recovery/setup/change,
  email verification and self-editable properties.
- [MFA controls](./mfa-controls.md): enrollment, challenge, continuation and
  current-account method status.
- [Native browser UI](./native-ui.md): continuation-preserving auth links and
  non-authoritative identifier hints.

- [Authorization gates and hooks](./authorization-gates.md): global roles,
  scoped permissions, organization conditions and their distinct meanings.
- [Account auth hooks](./auth-hooks.md): restoration, continuations, public
  configuration, account actions and typed user-property preferences.
- [Authentication primitives](./auth-primitives.md): layout/header, password
  feedback, keyboard-accessible reveal, OTP interaction and social button composition.

- [Account authentication](../../backend/guardian/login.md) and
  [session completion](../../backend/guardian/sessions.md) distinguish restored,
  signed-out and limited ceremony states.
- [Authorization](../../backend/guardian/authorization.md) and
  [RBAC](../../backend/guardian/rbac.md) define scoped requirements and grants.
- [Account management](../../backend/guardian/accounts.md),
  [tenant management](../../backend/guardian/tenant-administration.md) and
  [platform control](../../backend/guardian/control-plane.md) explain why the
  adaptable UI shows different operations.
- [Native SDKs](../../backend/native-auth/index.md) define credential-owning
  runtime boundaries separately from web authentication UI.
- [Reactivity](../../concepts/reactivity.md) explains cache/callback retirement
  when identity, organization or current authority changes.
