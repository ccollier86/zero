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
applies_to: ["2.7.0 activity auditing replacement; verify the qualified release commit"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.7.0"
  commit: "d702d72c09e94eb95eb65cc270dad2aa8ab5c2ac"
  snapshot: clean
  date: "2026-10-29"
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

Managed AI and outbound email record admission under the initiating `backend`
or `system` origin. Only an actual provider-confirmed terminal stage uses
`origin: 'provider'`. The transition preserves the original source, actor,
API-key initiator, application/tenant scope, request/correlation references,
policy version and invocation target. It does not replace the actor with the
provider or change which tenant owns the evidence. Rejected or uncertain
stages keep their original origin and matching server-confirmed/incomplete
evidence. The ordinary `record()` facade cannot make this transition.

If required post-send logging genuinely fails after email acceptance, the
caller receives `EMAIL_SEND_OUTCOME_UNKNOWN`, not permission to resend. This
requires reconciliation; acceptance is never downgraded to a definite provider
rejection. SMTP and Resend share this behavior through the managed email service.
Installing a provenance correction does not retroactively confirm old uncertain
calls or replay their side effects. Reconcile any affected prior sends before
deciding whether a new attempt is appropriate.

## Automatic and Declared Capture

| Surface | Current branch behavior |
| --- | --- |
| Backend diagnostics | Automatically bridges code, level, time and category when enabled. Excludes raw messages/errors/arbitrary metadata. Best effort. |
| Guardian audit | Mirrors newly appended Guardian audit events into a same-transaction source outbox. The existing Guardian trail and its public APIs remain intact. Existing historical events are not automatically backfilled. |
| Pinned application ReactiveDB mutations | Captures committed creates/updates/deletes, opaque row target and source sequence. Rollback removes the queued evidence too. Private underscore-prefixed tables and raw SQL are excluded. |
| Shared-row tenant resources | Uses registered resource storage fields for tenant attribution. A missing tenant rejects the captured mutation; tenant identity is not taken from browser claims. |
| Managed tenant/named Fabric actors | Writer-local same-commit capture, manager-proven scope, required bind-policy readiness proof, existing-only source discovery/recovery and independent delivery. Raw SQL is still excluded. Source crash guarantees follow the selected placement/durability. |
| Request-owned source mutations | `zero.logging.run()` carries trusted actor/scope attribution during its operation. Without an attributed operation, automatic database capture honestly identifies a system actor. |
| Native data/Resource reads | `/api/data`, generated Resource list/get and request `zero.data.get/list/find/findPage` prepare ordered private result receipts after domain projection and source release; final live authority is checked again. This proves preparation, not display. |
| Managed Sync/collections | Authorized snapshot chunks, final catch-up rows, live releases and canonical default mutation acknowledgments carry opaque provenance. Native codec-equivalent copies preserve it; optimistic or arbitrary mapped copies do not. Preparation does not hold the application writer/authority lease. |
| Native table/detail displays | Committed DataTable row models and mounted MasterDetail panes bind the actual released selection. Filter/order/page/reactive changes retain displayed revisions; prefetch, held arrivals and hidden panes do not count as displays. Bounds and failures are explicit. |
| Custom semantic reads/displays | Use `prepareResult()` after domain authorization and pass its receipt to the native server adapter or `useLoggingResultView`. `useLoggingRows` selects positions from released objects. `read()` remains preparation-only; identity-only `useLoggingView` cannot supply historical membership/revision. A SQL SELECT is not evidence of what a person saw. |
| Navigation | Generated route content emits after commit, mapped to a registered static page ID/label. Dynamic path values, queries and fragments are not retained. A URL change alone is not successful rendering. |
| Browser views, copy and print | Configured view bindings report elapsed/foreground/active intervals, gaps and close state. Explicit copy/print actions can bind to their currently displayed receipt; generic DOM observations cannot establish a record or actual clipboard/paper delivery. |
| Managed HTTP | Required admission/release fences remain, including actual failures/interruption. Successful transport bookkeeping is retained only with `diagnostics.http: true`, and is excluded from grouped user activities. Explicit public assets need no staff delivery handshake. Fixed logging RPCs reuse an audited investigation window instead of recursively logging refreshes. No raw URL, body or exception text. |
| Managed AI provider calls | Automatic admitted and completed/unknown provider stages through the managed AI service, including the native decision facade. SDK streams complete only after their finish part and stream completion. Provider/model selectors are opaque digests; no prompts, tools, results or chunks. A provider return is not proof that the app accepted or used it. |
| Managed platform email sending | Automatic admitted and provider accepted/rejected/unknown stages with recipient counts, not addresses, subjects or bodies. Acceptance is not delivery to a recipient. Lost post-send evidence returns an unknown send outcome; auth mail does not blindly send it again. |
| Custom AI service/provider instances and direct vendor SDKs | Explicit instrumentation. Supplying an already-built service does not magically wrap every SDK call, tool or provider callback. |
| Storage, payments, receiving/inbox providers, workflow and messaging semantics | Partial automatic coverage through Guardian audit, committed metadata mutations and strict managed HTTP. Apps declare actual semantic read/release/provider/durable-task stages through the scoped facade. Do not infer file delivery, payment settlement, message delivery or job completion from a row mutation. |
| Investigation reads | Durable admission evidence opens a five-minute window per actor/scope/semantic filter fingerprint; continuous reads extend it without another timer-driven activity. Page positions, limits and internal exact-row membership lookups reuse it; different semantic criteria open distinct windows. Denial is recorded explicitly. This is not a count of every physical database read. |
| Holds and reviews | Their state and attributable activity event commit atomically in the private audit actor. |
| Evidence export | Automatic atomic request/state evidence, private artifact publication, separate download authorization, producer completion/interruption and expiry/cleanup stages. Generation or producer completion is not proof of human review. |

The `basic`, `activity`, and `detailed` presets select families; they do not
fill an uncovered surface. See [configuration](./configuration.md) and the
[remaining qualification gates](./roadmap.md). Strict mode adds required
delivery, custody and source-durability controls, not an assertion that every
application semantic operation has been automatically discovered.

## Privacy and Attribution

The [activity projection](./activity-auditing.md) groups only declared invocation,
read or sequenced-view correlations. It preserves original immutable evidence,
source-time differences, failed/unknown facts and missing/gap markers. It never
groups unrelated events merely because their actor, label or time is similar.
Historical results retain ordered opaque identities/revision references and only
explicit finite approved field values. Default change values are redacted.
Neither a source mutation nor a prepared result proves human attention.

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
