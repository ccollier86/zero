---
id: zero.guardian.errors
type: operations
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: safe-errors-security-and-observability
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

# Present Auth Errors And Record Safe Evidence

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian exposes domain codes and safe user messages while sending internal
diagnostics through Zero observability. Treat credentials, proofs and profile
contents as secrets/sensitive data; attaching them to an error object does
not make them safe to publish or log.

## HTTP Boundary

Auth namespace failures have the public shape:

```json
{"error":"Invalid credentials","code":"INVALID_CREDENTIALS"}
```

The HTTP status is part of the contract. Preserve the code when adapting UI
presentation; do not parse English text to decide whether a credential expired.

| Failure | Public behavior |
| --- | --- |
| Domain AuthError below 500 | Stable code and actionable domain message/status. |
| Internal AuthError 5xx | Same domain code/status, generic “Authentication service unavailable.” |
| Elysia validation | 422, `AUTH_VALIDATION_FAILED`, “Invalid auth request.” |
| Malformed request body | 400, `AUTH_REQUEST_PARSE_FAILED`. |
| Unknown auth route | 404, `AUTH_ROUTE_NOT_FOUND`. |
| Auth SQL commit conflict not committed/retryable | 409, `AUTH_COMMIT_CONFLICT`, safe retry boundary. |
| Expected email-delivery error | Provider/domain code with safe rejected/unavailable text, not raw SMTP details. |

OAuth endpoints use the corresponding protocol error format instead of
pretending to be ordinary JSON login APIs. The focused native guide describes
their admission.

Do not automatically retry an operation whose outcome may already have
committed. A not-committed conflict permits a fresh-authority retry; an
accepted write with a failed follow-up callback is a different outcome.

## Common User Decisions

- 401 can mean invalid/missing/revoked identity, not just a wrong password.
- 403 can mean current suspension, verification, forced password change or a
  live permission/eligibility denial.
- 409 can require refreshing state/revision or restarting an auth ceremony.
- 429 is request admission; present bounded retry guidance.
- 503 indicates readiness/availability, not permission to use unscoped services.

Link users to the actual recovery/enrollment flow for the relevant condition.
Do not bypass required MFA or verification by treating these as ordinary UI
validation failures.

## Standard Observability

Managed Guardian binds platform code emission to the app-local observability
runtime. Standalone auth composition retains the legacy process-wide sink
unless an app runtime is supplied. Missing managed observability is a setup
failure, not a reason to send the event to another app's global sink.

Stable `OBS_CODES.AUTH_*` families cover startup, bootstrap, account lifecycle,
MFA, keys, request admission, audit and identity projection. Invariant failures
use `AUTH_STATE_INVARIANT_FAILED` with stable component/invariant metadata.
Framework emissions go through the established sink, not hand-written
`console.log` calls with request bodies.

Application feature errors should follow the same
[runtime observability conventions](../runtime/observability.md). Emit safe
semantic outcome and identifiers, not arbitrary structured user input.

## Never Record These Values

Passwords; bootstrap secrets; API-key raw secrets; access/refresh/page/action/
transition tokens; native authorization codes/verifiers; MFA OTP/TOTP codes or
seeds; complete email action URLs/bodies; private signing JWKs; encryption keys.

Also avoid raw Authorization/Cookie headers, full request bodies, free-form
provider exceptions and trusted policy-property values in broadly visible
telemetry. An exception may contain these values even when its top-level
message looks harmless.

Guardian audit intentionally records bounded secret-free metadata. Operational
logs and browser permission hints serve different audiences; do not copy a
private auth response into either one.

## Security Boundaries To Keep Intact

- Resolve live sessions, not only JWT signatures.
- Scope app data using server-owned membership/Fabric binding.
- Admit API keys explicitly on app operations; keep management session-only.
- Preserve protected ownership and actor grant ceilings.
- Retire old client rows and asynchronous callbacks on authority change.
- Keep local identity anchors ID-only and non-authorizing.
- Require limited proofs to finish their own enrollment/onboarding ceremony.

These are implemented contract boundaries, not optional recommendations that
an integration can silently disable to make an action succeed.

## Verification

Exercise safe 5xx presentation with synthetic internal failures. Verify errors
retain stable codes/statuses but do not contain credentials, SQL/internal state
or provider details. Verify event routing stays within the owning app when two
apps exist in one process.

This documentation/source review is not a claim of a comprehensive security or
compliance certification.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Sessions](./sessions.md) explains live revocation.
- [API keys](./api-keys.md) defines key and management ceilings.
- [Audit](./audit.md) records durable control-plane decisions.
- [Runtime observability](../runtime/observability.md) owns emitters/sinks.
