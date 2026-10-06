---
id: zero.inventory.email
type: inventory
audience: [maintainer, agent]
owner: email
status: draft
visibility: internal
system: email
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed server app", "standalone email runtime"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Email System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Email is a standalone delivery service integrated into Guardian workflows.
Inspected Zero source is package version 2.1.1 at
`a3a5f726768dac890f241a3899c0a1acb66265d9`; documentation-only `HEAD` is
`cd643b5b862f83b4ab40320486e1b89df1154c87`. These are source findings, not
package/release qualification.

## Purpose And Terminology

The email system provides provider-neutral message delivery and runtime
registration. Guardian owns identity policy and message intent; Email owns
transport/provider adaptation. Distinguish the generic `EmailService` from
Guardian's transactional outbox, which gives auth-triggered email durable
queue/retry behavior.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Canonical draft guide | Review |
| --- | --- | --- | --- | --- | --- |
| Send contract | Supported; server | `EmailService.send({to,from,replyTo,subject,text,html,tags,metadata,idempotencyKey,signal})` | `src/email/email-service.ts`, service tests | [service](../../../backend/email/service.md) | Source observed |
| Resend provider | Supported; server/network | `EmailConfig.provider:'resend'`, optional `resend.apiKey/baseUrl` | `resend-email-provider.ts` | [providers](../../../backend/email/providers.md) | Source observed |
| Console/memory/no-op providers | Supported/test/development; server | built-in provider names, captured-message helper | provider adapters and email service tests | [providers](../../../backend/email/providers.md) | Source observed |
| Custom provider adapter | Supported extension seam; server | `EmailProvider.send(EmailMessage)` object | `types.ts`, runtime provider resolution | [providers](../../../backend/email/providers.md) | Source observed |
| App-local runtime and readiness | Supported; managed app/standalone | `createEmailRuntime`, `registerEmailRuntime`; compatibility `configureEmail`, getters | `runtime.ts`, app factory and lifecycle tests | [configuration](../../../backend/email/configuration.md) | Source observed |
| Auth action email / outbox | Supported; Guardian | setup, reset, verification, OTP, MFA, domain/invitation templates | auth email/outbox modules, migration 007 and outbox integration tests | [guardian-delivery](../../../backend/email/guardian-delivery.md), [outbox](../../../backend/email/outbox.md) | First draft, qualification pending |

## Public Surface Map

Package export is server-only `@zero/framework/email`, re-exporting
`EmailError`, `EmailService`, four built-in provider classes, runtime creators/
getters/readiness, and message/config/provider/runtime types. App config is
`email?: boolean | EmailConfig` (default false); `true` selects default Resend,
object config selects one built-in or a custom provider and optional `from`,
`replyTo`, `resend` fields. `configureEmail()` is a legacy ambient compatibility
surface; managed app code receives its app-local runtime. No email UI/CLI was
identified.

## Integration Map

- Auth workflows trigger verification, password recovery, invitation, and
  lifecycle messages. Identity resolution must preserve canonical address and
  tenant/domain policy.
- Generic `send()` calls delegate to the configured provider; durable auth
  delivery uses SQL-backed outbox records, idempotency keys, leases, retries,
  and app shutdown handling. The outbox remains Guardian-owned, not a promise
  that arbitrary EmailService sends are queued.
- Runtime belongs to each app; do not imply a cross-app global transport or
  message store. Credentials and provider payloads are server-side secrets.
- Stable auth/email events route through observability; message bodies and
  credentials must not leak into logs.

## Configuration Inventory

`createApp({email:false|true|object})`: omitted/false creates disabled/no-op;
`true` resolves `{provider:'resend'}`; object provider defaults to Resend.
`email.from` overrides `EMAIL_FROM`, and `replyTo` overrides
`EMAIL_REPLY_TO`, resolved while the app-local runtime is created. Resend
`resend.apiKey` overrides `RESEND_API_KEY`; Resend base URL defaults to
`https://api.resend.com`. Real delivery readiness requires enabled config,
non-empty `from`, and for built-in Resend a configured key; console/memory/noop
are not equivalent production delivery. Custom provider owns readiness. The
auth outbox has its own retry/backoff/lease options, not an `EmailConfig`
subtree. No Doctor behavior was verified for provider readiness in this pass.

## Evidence And Verification

The [seven-page Email manual](../../../backend/email/index.md) is now drafted,
including sender/key precedence, captured readiness, custom/test providers and
the exact four durable outbox kinds. Generic send is not described as a queue,
and console/memory are not described as real mailbox delivery.
Detailed guide/example/independent package qualification remains open.

Inspected public email barrel, config/runtime/resolver and app composition; tests exist in
`src/email/email-service.test.ts`, auth email outbox unit/integration tests,
delivery-hardening and invitation tests, and lifecycle integration. No tests
were run. Existing `docs/auth/*` pages are research only.

Source entry points: [`src/email/index.ts`](../../../../src/email/index.ts),
[`src/email/runtime.ts`](../../../../src/email/runtime.ts),
[`src/auth/auth-email-outbox.ts`](../../../../src/auth/auth-email-outbox.ts).

## Findings

### Independent Source Review Supplement

Runtime/provider/readiness/send code was checked. Explicit blank from/replyTo are trimmed and fall back to environment at construction; Resend key precedence is nullish, not nonempty-string precedence. The original main readiness check could disagree with the credential captured by the adapter (explicit empty key or later ambient-env changes). The authorized working-tree correction now uses ResendEmailProvider.isConfigured(), which checks that captured credential snapshot. Synthetic explicit-empty/captured/later-env tests in [email-service.test.ts](../../../../src/email/email-service.test.ts) passed 15/15 with automatic env-file loading disabled; no provider delivery was attempted.

This targeted independent source review is complete for this inventory. It keeps the pinned main baseline distinct from authorized working-tree fixes; it does not complete whole-platform or exact-package gates.

- Avoid conflating best-effort generic email with durable auth outbox semantics.
- Config precedence is mapped above; verify the provider behavior against the
  focused tests before turning it into a user-facing guarantee.
- Package metadata/version is not a shipped artifact qualification.

## Known Future Plans

The [Email roadmap](../../../backend/email/roadmap.md) now records the user's
additional email/SMTP and potential SMS/push product direction, distinct from
implemented adapters and configuration.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned home:
`docs-next/backend/email/index.md`, `configuration.md`, `roadmap.md`, and focused
service/providers/Guardian delivery/outbox pages. Cross-link Guardian, tokens,
observability, SQL persistence, and deployment operations.

## Completion Review

- [x] Targeted independent source/default/public-boundary review completed; no whole-platform or package qualification inferred.

- [x] Confirm option/default and runtime exposure from public types/resolver.
- [x] Trace outbox transaction, retry, concurrency, retention and shutdown in source.
- [ ] Independently review delivery behavior and run focused package tests.
- [ ] Distinguish tests present from actual verification.
- [ ] Whole-platform independent review completed.
