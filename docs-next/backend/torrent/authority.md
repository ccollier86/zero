---
id: zero.torrent.authority
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: authority
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Workflow Ownership And Live Execution Authority

[Torrent](./index.md) · [Runtime services](../runtime/server-services.md) · [Documentation index](../../index.md)

Authentication alone does not authorize another user's run or another tenant.
Definition access, run ownership/management, activity admission and sealed
execution authority are independent boundaries.

## Human Requests

Run read/action routes require current Guardian scope and either the run's
started_by user or management authority in that same scope.
Single-tenant mode preserves global admin behavior. Multi-tenant mode ignores
users.role=admin by itself: current tenant owner/allPermissions or
workflows:manage must establish management authority.

WORKFLOW_MANAGE_PERMISSION is "workflows:manage". Hidden UI controls do not
enforce it. An Administration Organization member with an ordinary app role
can use permitted app features without gaining another tenant's workflow data.

Definition access supports start/inspect rules: authenticated, admin or a
nonempty live role array. start defaults authenticated; inspect defaults start.
Current scoped management authority can inspect/start within that scope.
A global identity role is not a substitute for multi-tenant membership.

## Actor And System Starts

startAsActor/runAsActor(name, input, authContext, options?, fence?) captures
current Guardian identity/credential ceilings and persists a secret-free seal.
The context must originate from the verified server boundary, not fabricated
browser JSON. Membership/role/session/API-key revocation is revalidated during
execution and before sensitive commits.

startAsSystem/runAsSystem requires trusted principal, bounded reason and an
explicit source-derived scope in multi-tenant mode. It is privileged audited
background execution, not a way to avoid authenticating an external webhook.

Compatibility start/run without an authority provider exists for explicit
trusted standalone composition. Managed authority must not be sidestepped by
importing a low-level service and omitting its provider.

## Handler Provenance And Services

context.execution distinguishes actor and system. Actor identity includes
user/platformRole, scope/membership, roles/permissions, authorization revision
and credential kind/reference—never raw JWT/API key or raw user properties.
System identity records principal/reason/scope and deliberate privilege.
Private authority envelopes are MAC-sealed; arbitrary copied row values do not
become valid authority.

context.zero is the installed scope-closed service facade, or null.
Strict background projections hide unsafe/raw/global service handles. The live
assertCurrentAuthority callback is especially important before app-owned
external/security-sensitive effects. It cannot undo remotely accepted I/O.

The public provider interfaces separate authority capture/revalidation from
service projection. Explicit standalone implementers must maintain both
synchronous final-commit and async revalidation semantics; a once-at-start
check is not enough.

## Actions, Responses And Failure

Mutations capture current authority and recheck inside the final transaction.
Interaction responder policy is separately checked; owning a run need not
authorize every delegated response, and an interaction ID is not a bearer key.

Cross-scope resources fail closed/hidden instead of leaking metadata.
Codes include WORKFLOW_AUTHORITY_REQUIRED/CHANGED, SCOPE_REQUIRED/INVALID,
and auth errors from Guardian. No cached output may preserve revoked access.

Related: [interactions](./interactions.md), [HTTP](./http-api.md),
[realtime](./realtime.md), [database automation services](../database-automations/services-and-authority.md).
