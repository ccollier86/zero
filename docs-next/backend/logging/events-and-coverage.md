---
id: zero.logging.events
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: events-and-coverage
maturity: preview
applies_to: ["2.6.0 main builds containing the opt-in logging preview"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "09d31583e6c4160aaf2843e2d40079080fdbf16d"
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
| Storage, AI, payments, communications and custom tasks | Use declared service-stage instrumentation. Opening the log database does not automatically add complete domain-specific capture to every service. |
| Investigation reads | Durable admission evidence opens a five-minute window per actor/scope/query fingerprint. Repeated stream snapshots reuse that window; this is not a count of every physical database read. |
| Holds and reviews | Their state and attributable activity event commit atomically in the private audit actor. |
| Evidence export | Records generation before release. Generation is not proof of download or review. |

The `basic`, `activity`, and `detailed` presets select families; they do not
fill an uncovered surface. See [configuration](./configuration.md) and the
[remaining qualification gates](./roadmap.md). The strict compliance preset
still rejects with `LOGGING_NOT_READY`.

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
