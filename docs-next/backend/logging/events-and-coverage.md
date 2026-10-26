---
id: zero.logging.events
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: events-and-coverage
maturity: supported
applies_to: ["2.6.0 builds with managed compliance logging and native live audit tables"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "74264b034eba6c32975cc7822a21da18e682f41f"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: implementation-verified
---

# Logging Events and Capture Coverage

[Logging index](./index.md) · [Documentation index](../../index.md)

An event describes one stage, not an entire business transaction. It contains
a stable source/event identity, source timestamp, actor, application or tenant
scope, action, outcome, evidence class, optional opaque target and approved
scalar metadata. The log database assigns ingestion time and its own ordinal.

## Evidence Semantics

| Evidence | What it establishes |
| --- | --- |
| `server-confirmed` | The server recorded the named stage. A prepared response does not prove a person read it. |
| `provider-confirmed` | A trusted provider integration supplies the confirmation. A browser cannot make this claim. |
| `browser-observed` | An untrusted browser reported a signal. It is not independent proof of attention, clipboard contents or paper output. |
| `estimated` | A derived estimate; retain the derivation policy where relevant. |
| `incomplete` | Some evidence or delivery stages are missing. |

Outcomes are `attempted`, `succeeded`, `denied`, `failed`, or `unknown`.
A timeout must not become a successful operation. Separate attempts and later
confirmations retain their own identities rather than rewriting the original.

## Automatic and Declared Capture

| Surface | Current branch behavior |
| --- | --- |
| Backend diagnostics | Automatically bridges code, level, time and category when enabled. Excludes raw messages/errors/arbitrary metadata. Best effort. |
| Guardian audit | Mirrors newly appended Guardian audit events into a same-transaction source outbox. The existing Guardian trail and its public APIs remain intact. Existing historical events are not automatically backfilled. |
| Pinned application ReactiveDB mutations | Captures committed creates/updates/deletes, opaque row target and source sequence. Rollback removes the queued evidence too. Private underscore-prefixed tables and raw SQL are excluded. |
| Shared-row tenant resources | Uses registered resource storage fields for tenant attribution. A missing tenant rejects the captured mutation; tenant identity is not taken from browser claims. |
| Managed tenant/named Fabric actors | Writer-local same-commit capture, manager-proven scope, required bind-policy readiness proof, existing-only source discovery/recovery and independent delivery. Raw SQL is still excluded. Source crash guarantees follow the selected placement/durability. |
| Request-owned source mutations | `zero.logging.run()` carries trusted actor/scope attribution during its operation. Without an attributed operation, automatic database capture honestly identifies a system actor. |
| Semantic record reads | Use `zero.logging.read()` after domain authorization. A SQL SELECT alone does not identify what a person saw. |
| Browser views, copy and print | The authenticated AppProvider collector follows configured families and explicit opaque view bindings. All signals remain browser observations. |
| Strict managed HTTP | Automatic durable request admission, prepared response status and stream producer completion/interruption. Fixed logging projection RPCs retain the same authorization/delivery fences but use their durable investigation window instead of per-refresh transport events, avoiding recursive self-logging. No raw URL, body or exception text. Transport preparation is not semantic business success. |
| Managed AI provider calls | Automatic admitted and completed/unknown provider stages through the managed AI service, including the native decision facade. SDK streams complete only after their finish part and stream completion. Provider/model selectors are opaque digests; no prompts, tools, results or chunks. A provider return is not proof that the app accepted or used it. |
| Managed platform email sending | Automatic admitted and provider accepted/rejected/unknown stages with recipient counts, not addresses, subjects or bodies. Acceptance is not delivery to a recipient. Lost post-send evidence returns an unknown send outcome; auth mail does not blindly send it again. |
| Custom AI service/provider instances and direct vendor SDKs | Explicit instrumentation. Supplying an already-built service does not magically wrap every SDK call, tool or provider callback. |
| Storage, payments, receiving/inbox providers, workflow and messaging semantics | Partial automatic coverage through Guardian audit, committed metadata mutations and strict managed HTTP. Apps declare actual semantic read/release/provider/durable-task stages through the scoped facade. Do not infer file delivery, payment settlement, message delivery or job completion from a row mutation. |
| Investigation reads | Durable admission evidence opens a five-minute window per actor/scope/semantic filter fingerprint. Page positions, limits and internal exact-row membership lookups reuse it; different actor/action/date criteria open distinct windows. Permission denial is recorded explicitly. This is not a count of every physical database read. |
| Holds and reviews | Their state and attributable activity event commit atomically in the private audit actor. |
| Evidence export | Automatic atomic request/state evidence, private artifact publication, separate download authorization, producer completion/interruption and expiry/cleanup stages. Generation or producer completion is not proof of human review. |

The `basic`, `activity`, and `detailed` presets select families; they do not
fill an uncovered surface. See [configuration](./configuration.md) and the
[remaining qualification gates](./roadmap.md). Strict mode adds required
delivery, custody and source-durability controls, not an assertion that every
application semantic operation has been automatically discovered.

## Privacy and Attribution

Metadata is denied by default for application `record()` calls. Configure
`metadataKeys` explicitly. Keys associated with secrets, credentials, message
bodies, prompts and clinical content remain prohibited even if allowlisted.
Values must be bounded scalar strings, booleans, finite numbers or null.

Use opaque IDs, not names, email addresses, clinical text or raw URLs. A field
named `id` does not make a sensitive value safe. Session, request and correlation
identifiers are opaque references, never access tokens or cookies. Provider
confirmation is admitted only under a provider-origin envelope; the ordinary
request facade cannot promote browser input into provider evidence.

A browser cannot submit an actor, tenant, origin, evidence class, policy version
or filesystem selector. The server derives them from the admitted session.
API-key-origin trusted server records identify the service credential and its
initiating user separately. Sealed system background work uses a system actor,
not a fabricated user. Attribution is app-local and expires when its owned
operation settles.

## Related Guides and Next Steps

- [Server and client APIs](./api.md) shows declared read/mutation capture.
- [Browser collection](./browser.md) defines interval and transport limits.
- [Delivery](./delivery.md) explains source commits and recovery.
- [Evidence lifecycle](./evidence.md) covers retained proofs and review.
