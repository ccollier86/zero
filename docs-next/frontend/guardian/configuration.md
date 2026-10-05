---
id: zero.frontend.guardian.configuration
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: frontend-configuration
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

# Configuring Guardian's Frontend Layer

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

Server configuration determines available policy and modes. Frontend props
choose placement, copy, optional extensions and controlled/custom presentation.
There is no independent browser configuration that grants roles, enables
API keys or makes a tenant database writable.

## Configuration Owners

| Layer | Canonical guide |
| --- | --- |
| Auth enablement, registration/bootstrap/MFA/tenancy/RBAC/keys | [Backend Guardian configuration](../../backend/guardian/configuration.md) |
| Frontend provider/client ownership | [Runtime configuration](../runtime/configuration.md) |
| Network/server URL/SDK transport | [SDK configuration](../sdk/configuration.md) |
| Component props and extension callbacks | Focused guides in this folder. |
| Native client registration and host adapters | [Native configuration](../../backend/native-auth/configuration.md) |

Mount the configured provider once at the intended app boundary. Do not create
a second AuthClient in every form or manually insert Bearer headers in each UI.

## Profile Adaptation

`UserManagement` self-wires from public tenancy/authorization config and active
tenant kind. Controlled `data` deliberately chooses identity management.
Use explicit `TenantMemberManagement` or `PlatformWorkspaceManagement` only
when the screen intentionally needs that specialized surface; don't rebuild
the mode resolver in application code.

Organization vocabulary follows
`auth.tenancy.terminology.singular/plural`. Props can override local title/
description/label without changing API/table/type names.
Declared role labels/descriptions and capability projections drive choices.
An Administration app-only member must not be forced into a platform-role UI.

## Authentication Pages

Use real route hrefs rather than default `#login/#register/#forgot-password`
fragments when pages are separate. Keep them publicly reachable after signed-out
state settles. Configure already-signed-in login routing on the server; form
`onSuccess` is a distinct app navigation callback.

`respectRegistrationPolicy`/`respectEmailPolicy` default true. False
customizes UI gating only; it is not a server bypass. Social provider arrays
contain callbacks, not provider credentials/configuration. Remember-me is a
deprecated no-op UI prop; do not document it as session persistence.

Native auth pages use the existing continuation helpers rather than arbitrary
redirect query propagation.

## Action And Detail Extensions

In the adaptive people view, use identity-specific versus tenant-specific
extension props deliberately. Context/info/roles belong in the selected detail
pane; compact account/security commands belong in navigation actions.
Return mutation acceptance promises from controlled async callbacks.

Optional API-key/audit/MFA/property panels are never “enabled by rendering.”
Read capabilities/loading/denial and use server policy for admission.
The data-realm gate is optional presentation of server readiness; backend
application-data operations still enforce their own boundary.

## Migration And Verification

Existing simple identity call sites can retain their props. Advanced/multi
self-wired mode gains the appropriate scoped control plane. A controlled list
remains an explicit identity surface; use tenant extension props if moving it
to self-wired membership management.

The current development OTP `disabled` prop is additive, and keyboard access
to PasswordInput reveal changes interaction rather than value/callback shape.
No component API is renamed to Guardian or made to infer server authority.

- [People control plane](./people-control-plane.md) gives the exact extension contract.
- [Authentication flows](./authentication-flows.md) lists links and policy-aware props.
- [API-key controls](./api-key-controls.md) separates supported modes/targets.
