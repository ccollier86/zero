---
id: zero.inventory.platform-tokens
type: inventory
audience: [maintainer, agent]
owner: platform-tokens
status: draft
visibility: internal
system: platform-tokens
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed server app", "server plugin composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: committed-baseline-clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Platform Tokens System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Platform Tokens provides server-side opaque action and resume-token primitives.
Source is Zero package version 2.1.1 at
`a3a5f726768dac890f241a3899c0a1acb66265d9`; documentation-only `HEAD` is
`cd643b5b862f83b4ab40320486e1b89df1154c87`. Source-observed only.

## Purpose And Terminology

Platform tokens are purpose-bound, opaque credentials for short-lived actions
or continuation/resume workflows. They are distinct from Guardian browser
sessions, access tokens, API keys, and SDK refresh tokens. The issuing service
and persistence store are server-side; readers must not treat raw tokens as
public identifiers.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Planned guide | Review |
| --- | --- | --- | --- | --- | --- |
| Action tokens | Supported; opaque, consume-once | `createActionToken`, `inspectActionToken`, `consumeActionToken`, `revokeActionToken`, `discardUndeliveredActionToken`, `cleanupExpiredActionTokens` | service/store/types and `token-service.test.ts` | [Action tokens](../../../backend/tokens/action-tokens.md) | First draft, qualification pending |
| Resume tokens/resources | Supported; reusable until expiry/revoke/rotation | `createResumeToken`, `verifyResumeToken`, `rotateResumeToken`, `revokeResumeToken`, `revokeResumeTokenById`, `cleanupExpiredResumeTokens` | service/store/types and `token-service.test.ts` | [Resume tokens](../../../backend/tokens/resume-tokens.md) | First draft, qualification pending |
| Plugin/table composition | Supported; managed app/server plugin | `createPlatformTokenPlugin`, table definitions, getters/config | `src/tokens/token.plugin.ts`, app platform service wiring, migration `003_platform_tokens.ts` | [Configuration](../../../backend/tokens/configuration.md), [Integration](../../../backend/tokens/integration.md) | First draft, qualification pending |

## Public Surface Map

Package export: `@zero/framework/tokens`. Barrel `src/tokens/index.ts` exports
`PlatformTokenService`, `PlatformTokenStore`, token-table definitions,
plugin/configuration functions, defaults/errors, and strongly typed
create/lookup/rotate records. Managed app composition mounts token services
before auth/plugin consumers. No client hooks/UI/CLI were identified; API
credentials must stay server-only.

## Integration Map

- Guardian account action flows use `AuthActionTokenService` as a policy/error
  adapter over the generic platform service when managed app composition
  provides it. The adapter binds user/generation metadata and requires the same
  transaction domain as the Guardian store; its email/HTTP semantics remain
  Guardian-owned. Generic tokens can also be consumed by other server features.
- App composition creates the platform token plugin against platform SQL. The
  plugin exposes the app-local service; raw secrets are returned once while
  SHA-256 hashes are stored. Action consume is transactional and consume-once;
  resume tokens are reusable until expiry, revocation, rotation, or flow end.
- Both records bind purpose/flow, optional subject, scope/resource and metadata;
  expiration and revocation are checked by the service. Observability emits
  stable codes with token IDs, not raw token values.
- Token lifecycle events should use observability codes without including raw
  token values.

## Configuration Inventory

`PlatformTokenServiceConfig` is `{actionTokenTTL?: string,
resumeTokenTTL?: string, actionTokenCooldown?: string | false}`. Defaults are
15m, 30d, and 5m respectively. Per-create/per-rotate `ttl` overrides the service
TTL; create-action `cooldown: false` disables the active-token cooldown.
Durations are parsed when an operation creates/rotates a token. There is no
`AppConfig.tokens` field or environment binding: managed app composition
constructs a service with defaults, while the `PlatformTokenService` constructor
and `createPlatformTokenPlugin` accept service config for explicit composition.
There is no exported `createPlatformTokenService` factory.
No config was imported or executed, and no Doctor token-specific validator was
found.

## Evidence And Verification

Inspected token exports/source, platform token migration, managed app wiring,
and `src/tokens/token-service.test.ts` plus runtime-isolation integration tests.
These are distinct from `src/auth/token-service.test.ts`, which covers
Guardian's JWT/access/refresh service. Tests were read by source, not run.

Source entry points: [`src/tokens/index.ts`](../../../../src/tokens/index.ts),
[`src/tokens/token-service.ts`](../../../../src/tokens/token-service.ts),
[`src/tokens/token-store.ts`](../../../../src/tokens/token-store.ts).

## Findings

### Independent Source Review Supplement

token-service.ts confirmed opaque-token hash storage, shared transaction-domain identity and operation-time TTL resolution. Generic action/resume tokens remain distinct from Guardian JWT/native/API-key surfaces; frontend flows use the owning HTTP/SDK contracts.

### Authorized Development Corrections

The original pinned baseline above remains historical. Detailed guide review
reproduced exact-deadline acceptance and unstructured/unsafe duration handling:
generic regressions initially0pass2fail; the direct Guardian action path also
failed its cross-mode exact-expiry check. Current development source rejects
when now is at/after expiry, cleans up the same deadline and validates runtime
type, integer duration precision and expiry addition before storing a token.
Malformed/unsafe values throw existing public PlatformTokenError with
TOKEN_INPUT_INVALID/400. TTL0s is immediately expired; cooldown0s remains a
valid disabled-duration policy. No token API was renamed.

The final synthetic generic/runtime-isolation/Guardian-action run passed
26tests/115assertions on Bun1.3.14 with automatic env-file loading disabled.
Independent final source review and rerun passed the same26tests/115assertions;
no app data, credential or
provider was used. This is working-source evidence, not a package qualification.
New [six-page manual](../../../backend/tokens/index.md) replaces the planned
homes with actual linked drafts; the internal helpers remain unexported.

This targeted independent source review is complete for this inventory. It keeps the pinned main baseline distinct from authorized working-tree fixes; it does not complete whole-platform or exact-package gates.

- Name collision risk: Guardian/session/action-token flows and generic platform
  action/resume-token primitives need a clear ownership map.
- No automated verification was run; publish operational/transaction promises
  only after package checks and independent review.
- Source version is not release qualification.

## Known Future Plans

No plans established from this scan; use
`docs-next/backend/tokens/roadmap.md` for sourced proposals.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned home:
`docs-next/backend/tokens/index.md`, configuration/roadmap, and action/resume
references. Link Guardian, workflows, storage/SQL, and observability.

## Completion Review

- [x] Targeted independent source/default/public-boundary review completed; no whole-platform or package qualification inferred.

- [x] Find token-specific service/store tests and map each public operation.
- [x] Trace confidentiality, expiry, binding, rotation, transaction and cleanup contracts in source/tests.
- [ ] Run package checks and receive independent review.
- [ ] Whole-platform independent review completed.
