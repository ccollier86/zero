---
id: zero.workers.service-integration
type: architecture
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: workers
feature: service-composition
maturity: preview
applies_to: ["2.11.0 local source candidate; not a selected updater or deployment qualification"]
reviewed_against:
  package: "@zero/framework"
  version: "2.11.0"
  commit: "c401dbd68b29efbc185e55273d37e71aac3bd536"
  snapshot: dirty
  date: "2026-11-15"
  evidence_level: source-observed
---

# Compose services without serializing the application

[Workers](./index.md) · [Durable jobs](../scheduler/durable-jobs.md) · [Local-first performance](../runtime/local-first-performance.md)

Zero runs locally integrated services. These layers have different ownership;
sharing a process does not mean holding a database transaction while waiting for
an AI model, provider or CPU computation. File-backed mode is first-class.
This guide describes the implemented 2.11.0 local source candidate. Final exact
installed-archive/Linux qualification and normal updater selection remain
pending; source implementation alone does not approve an application deployment.

## Choose ownership, not another queue

| Layer | Owns | Does not establish |
| --- | --- | --- |
| ReactiveDB/Fabric transaction | Ordered atomic state and source outbox changes within its file. | Provider completion, human attention or cross-file atomic commit. |
| Source automation | A short durable handoff using its stable delivery identity. | A suitable place to await a long AI call in the per-file automation lane. |
| Jobs | Nominal times, versioned definition admission, immutable occurrence/intent identity, exact Torrent handoff and reconciliation. | Execution of arbitrary browser code or provider delivery. |
| Torrent | Pinned activity graph, attempt lifetime, waits, deliberate retry policy and durable execution state. | Permission for every external effect merely because admission once succeeded. |
| WorkPool | Fair bounded asynchronous admission and actual callback occupancy. | Persistence, an OS sandbox or durable side-effect idempotency. |
| ProcessWorkPool | Fixed registered computation away from the HTTP event loop, observed process settlement. | Automatic access to credentials, raw databases or the full Zero service bag. |
| Logging | Private admitted evidence, source-atomic capture where supported and supervised delivery. | A replacement executor or proof that a provider delivered a message. |

Use the existing `zero.torrent.enqueue(...)` source-bound automation handoff or
actor-preserving workflow enqueue facade. Do not await the complete provider
workflow while occupying the source's sequential automation queue. Jobs likewise
release their handoff capacity when Torrent accepts; they do not keep a jobs SQL
lease until the workflow's model call finishes.

## AI and decision activities

Code-owned registered activities can capture a reviewed, fixed service adapter
at startup. Declare the permitted model/tool/contract and apply an appropriate
shared WorkPool around provider I/O. Do not instantiate a new pool per message
and call that a global capacity limit. A job admission ceiling and a provider
pool are separate budgets: after handoff, Torrent owns execution.

Preserve the activity's physical attempt signal and current-authority checks:
before work is admitted, after a queue wait, immediately before an effect, after
a result and before publishing it through authorized native data/Storage APIs.
Combine cancellation signals rather than overwriting the native attempt signal.
If an upstream operation ignores cancellation, keep its pool slot until the
actual callback settles; a rejected caller wait is not physical settlement.

The strict activity facade intentionally does not expose unrestricted raw
AI/email/private-object services. An activity declaring a capability is not an
escape hatch to arbitrary provider credentials. Build a fixed reviewed adapter
over actual service contracts, not a user-selected URL/import/service object.
Queued data remains bounded private input; public job views contain no prompts,
results, seals or credentials.

The native synthetic progress regression exercises managed jobs → pinned Torrent
→ the real AI decision service with a startup-captured mock provider transport.
It holds one call while another job and an application-file data write progress,
then checks logout/revocation and cancelled-attempt late-output fences. It also
keeps a same-actor successor queued until an uncooperative callback physically
settles. This proves orchestration/authority behavior, not live Laya/Jev quality,
provider throughput or a universal latency claim. Default `max` remains finite.

## Messages, email and notifications

Every effect needs its own stable logical identity. Torrent retries are safe only
where that downstream contract makes them safe. A successful provider acceptance
is not a delivered/read receipt, and a lost response is not evidence of failure.

The native notification `notifyUsersOnce` path has a permanent duplicate-safe
receipt. Do not recreate a deleted notice by changing its request key. Email's
provider result preserves actual accepted/rejected addresses; Resend may use
provider idempotency, while SMTP cannot promise it. Raw `EmailService.send()` is
not a generic permanent intent ledger. Do not wrap an uncertain SMTP send in a
blindly retrying activity or claim jobs makes it exactly-once. Domain-specific
send reconciliation remains necessary; a universal durable email-job adapter is
not supplied by this foundation. Existing authentication-mail and inbox protocols
retain their specialized ownership rather than being replaced by a generic pool.

## Private results and files

Use native Storage integration for private bytes and registered domain adapters
for authorized publication. Retain opaque references, verify content/identity,
fence publication and reauthorize every later download. A code-owned background
adapter must reconcile publication-before-acknowledgment without blindly writing
another copy. A public URL or a workflow ID is not a private-file grant.

Storage's private-object/CAS primitives exist, but this foundation does not expose
raw private namespaces to browser/strict workflow code or invent a generic jobs
artifact/download API. Jobs inspection's `renderRun` is an application extension
for an independently authorized workflow view, not a download or execution grant.
Use the service-specific documented facade; unsupported adapters stay unavailable.

## Audit and recovery

Canonical jobs schedule controls and observed handoff/terminal changes use the
existing private source outbox transaction and supervised logging workers.
Payload-free evidence is optional under the configured workflow capture policy.
No-op controls, replay, timer/claim/poll work and unchanged authority checks do
not manufacture audit activity. Background observations identify the system
source honestly and link `scheduleId` to the original initiating control; they
do not impersonate the creator's expired session.

A command may commit before the caller's final authority check retires. Preserve
its unknown outcome and original receipt identity. Waking its fixed logging
source drains durable facts without granting acceptance or replay authority.
Likewise, an already accepted workflow must be reconciled before deciding a
provider effect is safe to try again. Readiness of a process/health route alone
does not qualify these end-to-end boundaries.
