---
id: zero.guardian
type: index
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: overview
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Guardian: Identity, Sessions And Access

[Backend systems](../index.md) · [Documentation index](../../index.md)

Guardian is Zero's integrated identity and authorization system. Configure the
application's account policy once, then use the same live identity and access
rules in endpoints, resources, synchronization, background work and packaged
account-management UI. The package APIs remain named `auth`; Guardian is the
system's product name, not a new import or route prefix.

Authentication answers who is calling. Authorization answers what that caller
may do in a particular scope. A signed-in user, an organization membership, a
role label, a local foreign-key anchor and a hidden UI control are not
interchangeable proofs of permission.

## Choose And Integrate

- [Configuration reference](./configuration.md): exact accepted fields, defaults, read time, secrets and mode interactions.
- [Choose a profile](./modes.md): single/multi tenancy and simple/advanced
  authorization are separate choices; understand their scopes before configuring
  a new application or changing an existing one.
- [Bootstrap](./bootstrap.md): establish the protected first owner safely.
- [Integration](./integration.md): compose named Elysia plugins, middleware and authority-scoped services.

## Accounts And Human Authentication

- [Registration](./registration.md): create accounts and optionally their initial organization.
- [Login](./login.md): handle account, verification, MFA and tenant completion gates.
- [Sessions](./sessions.md): distinguish API bearer tokens, refresh rotation and safe page cookies.
- [Password recovery](./password-recovery.md): reset, first-password setup, signed-in changes and admin recovery.
- [Email verification](./email-verification.md): prove mailbox ownership and handle identity changes.
- [User properties](./user-properties.md): declare defaults, editor rules and policy trust.
- [Own profiles and regional preferences](./user-profiles.md): whitelisted personal editing, accepted revisions and SYSTEM rollout.
- [Contact possession](./contacts.md): verified email changes, typed phone numbers and trusted phone-provider ceremonies.
- [Private avatars](./avatars.md): staged/cropped/normalized media, account receipts, private delivery and retained cleanup.
- [Presence](./presence.md): activity leases, availability, fresh scoped reactive feeds and real Fabric SQL projection.
- [Required profile completion](./profile-completion.md): restricted first-use continuation, enrollment and explicit existing-user rollout.
- [Canonical accounts](./accounts.md): manage profiles, global status and protected account lifecycle separately from memberships.
- [MFA](./mfa.md): enroll, challenge and enforce email OTP/TOTP with live session assurance.

## Authorization And Organization Control

- [Authorization](./authorization.md): attach declarative access requirements to operations.
- [RBAC](./rbac.md): declare permission/role registries, revisions and delegation ceilings.
- [Control plane](./control-plane.md): separate canonical accounts, Administration powers and customer workspaces.
- [Tenancy](./tenancy.md): create, select and replace tenant-bound sessions.
- [Tenant administration](./tenant-administration.md): manage members, roles, suspension and ownership in the selected organization.
- [Invitations](./invitations.md): email-bound, one-time grants with manual or durable email delivery.
- [Join requests](./join-requests.md): review applicant-initiated membership requests.
- [Verified domains](./verified-domains.md): exact DNS and mailbox proofs for company-domain request onboarding.

## Machine Clients, Data And Operations

- [API keys](./api-keys.md): configure user/membership eligibility and session-only key administration.
- [Request admission](./request-admission.md): durable, atomic bounds for public authentication work.
- [Audit](./audit.md): query, export and retain secret-free control-plane evidence.
- [Identity projection](./identity-projection.md): preserve real app-data foreign keys without copying authentication.
- [Native provider](./native-provider.md): authenticate desktop, mobile and extensions with public clients and PKCE.
- [Errors and observability](./errors.md): preserve domain codes and safe evidence across auth boundaries.

The backend feature guides are organized around real account and authority
lifecycles. Related frontend/SDK guides are being reconciled separately; this
internal draft tree is not a release-qualified documentation set.

- [Roadmap](./roadmap.md): separate available capabilities from security/provider
  expansion and unresolved design ideas.

## Integration Map

- [Service boundaries](../../concepts/service-boundaries.md) separates trusted
  composition, admitted requests and live authority-scoped background work.
- [Data planes](../../concepts/data-planes.md) explains why canonical identity
  lives in the system database, apart from application records.
- [Schema identity references](../schema/guardian-references.md) gives application
  tables real local user/membership foreign keys without copying authentication.
- [HTTP endpoints](../runtime/endpoints.md) uses Guardian's declarative access
  requirements before handing a request to application services.
- [Reactivity](../../concepts/reactivity.md) explains authorized delivery and why
  a tenant or account transition retires old rows and callbacks.

## Design Principles

These principles are inferred from the inspected composition and enforcement
boundaries, not additional APIs or promises of future functionality.

The implementation consistently separates authentication, authorization,
validation, domain rules and persistence. Managed composition supplies app-local
services; request projections bind those services to admitted authority rather
than asking each feature to invent its own token cache or tenant selector.

In a multi-tenant app, the protected Administration Organization is also an app
workspace. Its members may hold ordinary app roles, platform-administration
roles, or both. Platform powers come from their live assignments, not merely
from membership in that organization. The same organization/user distinction
continues through Fabric, resource policies and user-bound API keys.
