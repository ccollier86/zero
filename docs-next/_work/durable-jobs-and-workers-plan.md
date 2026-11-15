---
id: zero.work.durable-jobs-and-workers
type: implementation-plan
audience: [developer, agent, operator]
owner: scheduler
status: in-progress
visibility: internal
system: scheduler
feature: durable-jobs-and-workers
maturity: planned
applies_to: ["feature/durable-scheduling-foundation; proposed contracts unless explicitly qualified"]
---

# Shared scheduling, jobs and worker foundation

[Scheduler](../backend/scheduler/index.md) ·
[Calendar return handoff](./calendar-return-handoff.md)

User approved implementation on 2026-11-14. Calendar backend work is paused.
This document is the execution/decision record and must be updated as work
lands. Proposals below are **not existing APIs** merely because they appear in
an example. No main merge, release archive, updater selection or deployment is
implied by a local implementation checkpoint.

## Outcome and boundaries

Give Zero one coherent, opt-in background-job foundation that simple apps can
use without assembling process launch, cron, Fabric and Torrent themselves.
Preserve the existing lightweight `zero.scheduler` behavior. Share infrastructure
with native features deliberately; do not rewrite working service protocols or
make scheduling depend on messaging's private implementation.

The terms are different responsibilities:

| Owner | Responsibility |
| --- | --- |
| Scheduler/Croner | Calculate/wake due times; a timer is a hint, not durable acceptance. |
| Durable scheduling realm | Accepted schedules, bounded occurrence materialization, next-due indexes, revision/fencing and handoff intent. |
| Torrent | Pinned execution graphs, sealed authority, durable runs/steps, retries, waits, cancellation and recovery. |
| Shared work pools | Bounded concurrent admission, fairness, abort/deadline handling and lifecycle. A pool is not a durable queue. |
| Process executor | Execute registered code off the HTTP event loop where configured; a subprocess is not a security sandbox. |
| Fabric | Private per-scope state and ordered per-file SQL; independent files may write concurrently. |
| Guardian | Current actor/scope/capabilities at admission and effect boundaries, never a cached role in a job payload. |

No second workflow step/retry engine; no arbitrary code/closure serialization;
no globally sequential AI queue; no multi-host/distributed-consensus claim.
One managed app plus its supervised local children is the initial supported
deployment. Multi-host ownership needs a separate qualified coordination design.

## Inspected baseline (main 05344d4 / 2.10.5)

- `src/scheduler`: app-local named cron registry. Per-job overlap guard is local;
  callbacks and status are in memory. Restart re-registers code but does not
  replay missed cron occurrences. No `AppConfig.scheduler` switch exists.
- `src/databases`: Bun subprocess Fabric actors with bounded IPC, per-file writer
  ordering/readers, restart/generation retirement and explicit environment.
- `src/logging`: separate delivery subprocess and Fabric storage actors already
  exist. Keep their custody, source acknowledgment and strict-admission contracts.
- `src/workflows`: durable Torrent runs and permanent idempotent start receipts.
  System enqueue acknowledges commit without awaiting the first activity;
  actor-preserving `startOnce` currently joins eager initial execution. Add the
  equivalent queued actor path rather than converting user work to SYSTEM.
- `src/messaging/work-pool.ts`: domain-local bounded asynchronous pool, default
  configured concurrency `max` = 100. Promote an independent reusable primitive,
  then adopt it compatibly; do not publish messaging internals as the platform API.
- Source automation lanes are sequential per physical database. They must only
  perform short durable handoffs; long AI/network work executes outside them.

## Proposed public shape

Use **`zero.jobs`** for admitted durable job/run and schedule operations. Keep
**`zero.scheduler`** as the existing trusted local timer API. A worker is an
execution choice behind jobs, not something every app must spawn manually.
Expose typed standalone pool/worker building blocks through a focused workers
entry; managed apps obtain current-authority facades, not raw process handles.

Proposed shape, subject to the contract tests before publication:

```ts
// Code-owned/versioned definition, validated input and explicit capabilities.
// Existing Torrent workflow references are reused, not stored JavaScript.
const accepted = await zero.jobs.enqueue('reports.refresh', { reportId }, {
  idempotencyKey: requestId,
});
await zero.jobs.schedules.create({
  definition: 'reports.refresh', input: { reportId },
  timing: { at: '2026-12-01T15:00:00Z' },
}, { idempotencyKey: scheduleRequestId });
```

The receipt acknowledges durable admission, not completed work. Result/state
queries, pause/resume/cancel, run-now, revision-checked schedule edits and receipt
reconciliation need equally clear semantics. Do not invent a synchronous success
when a write may have committed. Database-supplied names/inputs cannot select
unregistered handlers, imports, executable paths, credentials or tenant files.

Configuration is additive and opt-in (proposed `jobs` module); omitted/false
opens no job-owned files or processes. `true` selects safe defaults with explicit
code registration; objects control pools, private placement and lifecycle.
Require Guardian and Torrent for managed durable jobs, reporting configuration
errors before opening resources. Disabling preserves retained state for recovery.
Use existing public facade conventions for HTTP, SDK and machine/background
bindings; a browser cannot claim SYSTEM or choose another tenant by request input.

## Core execution and transaction boundaries

1. Admit current actor/scope and definition access, validate bounded input, pin
   definition/schema/version and capture allowed provenance.
2. Commit the schedule/occurrence/handoff intent and source-local semantic audit
   metadata atomically in the private scheduling realm. Duplicate request keys
   replay the accepted intent; changed input conflicts.
3. After commit, wake short dispatch. Claim with an expiry and monotonic
   generation in a short SQL operation; release the database/authority lease.
4. Enqueue Torrent using the original stable intent identity and appropriate
   sealed actor/system authority, **outside** an outer SQL transaction.
5. Persist the exact handoff receipt. Death between steps 4/5 reconciles the same
   run rather than creating another. Source and SYSTEM files are not one atomic
   transaction; the durable intent and permanent receipt bridge them.
6. Execute admitted activity in the configured pool/executor. Recheck live
   resource/owner eligibility before an effect and before publishing results.
7. Publish scoped state/change hints through existing reactive transport. Do not
   poll full tables or treat a hint as authority or accepted-write evidence.

No pool wait, provider call, timer sleep, AI generation, or human wait may hold
a SQL writer/Guardian admission lease. A job created by a user retains that
initiator; an explicitly organization-owned service job has a separate sealed
service principal and an app-owned eligibility rule. Never silently elevate a
revoked/deleted user to SYSTEM to keep their queued work running.

## Durable model and compatibility

Private Fabric realm: schedules, immutable admitted occurrence intents, dispatch
receipts and safe run summaries. SYSTEM holds a private ownership/wake catalog;
job payloads do not become generic client-sync tables. Single-tenant placement
is a named feature file; multi-tenant scopes have distinct admitted files.
Root/realm/owner identity is retained and validated. A missing established file
requires restore, never an empty replacement. Use additive realm contributions,
supported migrations and portable source-to-bundle checksums.

Schedules retain ID, revision, code-owned definition/version, creator/owner,
scope, validated input, timezone, timing, misfire/overlap/deadline policies,
enabled state and indexed next due time. Occurrence identity includes schedule
generation and the nominal resolved instant; retries are not new occurrences.
Do not duplicate Torrent's canonical step/attempt state into another engine.
Queries are bounded, stable-cursor, live-authorized and omit private input unless
the registered definition deliberately supplies an authorized projection.

Torrent's permanent receipt limits are real (currently 100,000 per actor or
system-principal/scope namespace). Do not delete receipts, randomize keys or
rotate principals to evade them. Before claiming indefinite recurring execution,
qualify a compact permanent tombstone/retention contract or expose an explicit
capacity stop with alert and operator reconciliation. Materialize only a bounded
rolling due window, never an infinite series of future workflow runs.

Code registration is immutable by name/version. Separate code-managed schedules
from user-managed schedules; startup cannot silently overwrite database edits.
Pending jobs pin their old code version; missing code blocks them with a stable
reason instead of executing the newest handler. Upgrade/downgrade compatibility
must be declared for retained jobs and definitions.

## Time, overlap and missed work

- Durable cron requires an explicit IANA timezone; convenience defaults should
  resolve to UTC, not whichever host happens to run a worker. Preserve existing
  local cron's current defaults for backward compatibility.
- One-off input is an unambiguous instant. Keep nominal scheduled time, actual
  admission/start/finish time and lateness separately. Inject time in tests.
- Make skip, latest-only and bounded catch-up explicit. Catch-up has maximum
  age/count/rate and fairness budgets. Choose safe documented defaults; reminders
  also have an expiry/eligibility fence, so downtime never sends obsolete alerts.
- Verify Croner's actual gap/fold behavior against its installed version. Record
  policy for clock movement and timezone-rule updates. Cron is not RFC 5545
  calendar recurrence; do not reuse the calendar demo's local arithmetic.
- Default no overlap for one schedule, not one global executor. Support bounded
  allow/queue-one policies deliberately. An app may serialize a resource key
  inside a scope; it must not create cross-tenant lock starvation.
- Revision changes, pause/resume and deletion retire stale wakes and occurrences
  according to a stated rule; never rewrite an already accepted past effect.

## Shared pools and isolated workers

Default concurrency is **`max` within a finite explicit capacity**, not infinity
and not one. Distinguish asynchronous I/O concurrency from CPU process count and
provider quotas. Per-scope fairness and bounded waiting prevent a busy tenant or
bulk job from starving interactive/reminder work. Report capacity/retry-after;
do not silently drop accepted work. Queue wait and execution deadlines differ.

The reusable pool must handle immediate/queued abort, cooperative running abort,
shutdown drain, rejection without leaks, synchronous throws, thenables, fairness
and metrics. A callback that ignores abort still occupies its slot until it
actually settles; rejecting the caller must not oversubscribe that work.

Separate Bun subprocess execution requires a fixed registered handler catalog,
version/digest checks, bounded serializable IPC, parent nonce/generation fencing,
explicit empty child environment by default, no shell and no implicit dotenv.
Never boot the web app in a worker. Close and prove process settlement before
removing an owned private launch directory. Subprocess isolation is **not** an
OS permission sandbox. CPU tasks cannot inherit the entire server service bag;
service-capable work needs narrow authority-bound broker calls or a separately
reviewed managed service integration. No arbitrary module URL from job data.

Worker death, expired claim, cancellation and timeout distinguish not-started,
not-committed, unknown and terminal accepted effects. Use abort plus fencing to
prevent stale result publication. External operations need downstream idempotency
or explicit reconciliation/manual review. A timeout is not proof a charge/email
failed, and cancellation cannot undo an effect already accepted by a provider.

## End-to-end integration matrix

| Integration | Required behavior and owner |
| --- | --- |
| Managed createApp | Pure validation before resource opening; isolated app-local service keys, startup/recovery ordering, failed-boot teardown and drain. |
| Guardian/RBAC | Current session/API-key capabilities, tenant isolation, owner vs service authority, live revocation, safe new-permission adoption. |
| Fabric/ReactiveDB | Private realm/file ownership, short commits, source receipts, independent files, scoped committed update hints. |
| Torrent/automations | Commit-acknowledged actor/system enqueue, version pinning, one retry engine, short sequential-source handoffs. |
| AI | Existing model/decision facade in bounded activities, provider quotas and abort; no raw prompt/result logging or auth from model output. |
| Email/notifications | Native delivery facade, per-intent identity and actual provider evidence; unknown sends reconcile, no automatic duplicate. |
| Storage | Private job/result artifacts, expiring capabilities and reauthorization, orphan reconciliation without deleting accepted references. |
| Logging | Semantic schedule/run control evidence plus safe operational health; no audit event for every timer tick/heartbeat/poll. Optional logging stays optional. |
| HTTP/SDK/MCP | Same admitted contracts, bounded schemas/cursors, stable errors, no raw worker PID/path/SQL/credential escape. |
| Frontend | Native DataTable/filter/count primitives and scoped live updates; denial immediately withdraws content/actions, transient same-scope errors may retain. |
| Doctor/docs | Detect long eager work on automation lanes, unbound callbacks, unsafe tenant/actor patterns, obsolete imports and missing version/worker configuration. Avoid heuristic false claims. |
| Packaging | Public exports/declarations, normal updater, source and bundled Linux/amd64 matching workers with no main-app boot/secret inheritance. |
| Calendars | Only after foundation qualification: revision-fenced reminders, booking workflows and generic scope/permission rules, not UI-local timers. |

Adoption of existing feature workers is incremental and evidence-driven. Do not
replace logging's proof/custody protocol with the generic pool, or migrate a
working domain state machine just to share a class. Provide compatibility wrappers
when promoting messaging's pool; preserve its capacity/error/shutdown behavior.

## Implementation phases and acceptance gates

- [x] Inventory current workers, cron, Fabric, Torrent and source queues.
- [x] Preserve return-to-calendar requirements and source checkpoints.
- [x] Shared typed bounded/fair work-pool primitive; adopt messaging without
  changing its facade; focused lifecycle/concurrency regressions.
- [x] Commit-acknowledged actor enqueue and request facade, preserving sealed
  actor authority, exact-key replay, current-scope checks and eager compatibility.
- [x] Registered isolated worker protocol/executor with lifecycle/version/IPC
  tests; no CPU-offload claim from an in-process Promise pool.
- [x] Native queued actor HTTP/SDK/hook surfaces and scope-retired results;
  read-only Doctor worker-entry/environment checks. Branch source only.
- [ ] Opt-in private durable scheduling realm/config, owned startup/teardown and
  bounded migration; no new schema/files while disabled.
- [ ] Scoped `zero.jobs` facade: one immediate job and one durable future job
  complete through real managed createApp; accepted/unknown outcomes qualified.
- [ ] Cron/timezone/misfire/overlap and revision cancellation with clock/DST and
  worker-death recovery tests; no unbounded catch-up or receipt growth claims.
- [ ] HTTP/SDK/reactive operations and selected service adapters, semantic audit
  coverage and actual live revocation; operational metrics without log feedback.
- [ ] Doctor/adoption docs and examples; every new public export exercised from
  the installed archive, with obsolete/current/proposed contracts distinguished.
- [ ] Exact installed Chromium flows where UI is added, Linux/amd64 bundled
  worker startup/restart, concurrent independent-file writes and long-AI progress.
- [ ] Normal release provenance/archive/updater qualification; then return to
  calendar backend design with the user. No production app migration here.

Tests must use proven synthetic fixtures and cleanup in finally/EXIT on success
and failure. Reuse external build/cache paths, retain only bounded evidence and
owned intentionally pinned previews. No live data/provider/account access. Test
source transaction rollback, source/Torrent acknowledgment loss, duplicate wakes,
full queues/disk errors, revocation during work, worker SIGKILL, app shutdown and
restart, missing retained files/handler versions, mixed pools and tenant fairness.

## Working record

2026-11-14: implementation opened on `feature/durable-scheduling-foundation`.
Existing main worktree has unrelated fixture-cleanup edits and remains untouched.
Storage guard currently reports internal pressure (about 78 GiB free), external
healthy (about 233 GiB free). Approved maintenance did not recover that pressure;
the user approved the external-only exception for this implementation's tests
and packaging. Mount/integrity/external-space checks remain enforced. Never
disable the guard or silently move output internally.

Implementation checkpoint: `src/workers` now reuses the existing generic Fabric
subprocess transport/server (no new IPC protocol), with fixed task catalogs,
bounded JSON, shared pools and opt-in managed `workers` configuration. Native
`zero.workers.run()` is current-actor/scope bound; SYSTEM/API-key execution is
not silently granted. Queued actor starts use `zero.workflows.enqueueOnce` /
`WorkflowService.enqueueAsActorOnce`; eager starts are unchanged. Messaging uses
a compatibility wrapper around the shared pool. The consolidated focused source
run passes **131 tests in 17 files / 711 expectations**, including real
createApp/Guardian HTTP, actual child death/timeouts, native queued actor HTTP,
SDK/hooks compatibility and bounded timezone/misfire math. No release archive or
Linux qualification has been claimed. An initial full TypeScript check identified
three local errors in new worker code; those were corrected. Final verification
and two additional queued-hook regressions are being checked before checkpoint.

Worker contracts now enforce canonical/idempotent pure parser results. One-way
normalization is rejected before handler dispatch, avoiding a second silent
transformation at the child boundary. Handler failures/results after dispatch
remain unknown, never reclassified as a safe not-started retry. Idle worker death
reconciles the exact process generation before replacing its slot; failed
settlement stays counted and can be explicitly retried.

The private, unexported `src/jobs/schedule-time.ts` prototype supplies injected
time, explicit IANA timezone and bounded skip/latest/catch-up selection; it does
not persist or run schedules. Tests found Croner 6 can return a **past** instant
during a repeated fall-back hour. This prototype guards monotonic first-fold-only
selection and tests the installed spring-gap forward-shift behavior. Existing
`zero.scheduler` timers are unchanged; this is not a claim that legacy cron or
calendar recurrence has acquired these semantics.

Outstanding production containment qualification: graceful close, hard task
timeout and observed child death pass source tests. Abrupt parent SIGKILL while
a child is synchronously CPU-bound still needs the actual Linux supervisor/
container qualification. A JavaScript cleanup callback cannot run after SIGKILL;
do not claim standalone OS orphan prevention or introduce an unreviewed watchdog
or executable protocol to disguise that boundary.

Next implementation boundary: finish the private Fabric schedule realm, owner
catalog and durable intent/receipt handoff before publishing `zero.jobs`. Define
user-owned versus explicit service-owned authority and future-session behavior
first; neither cached permissions nor automatic SYSTEM fallback is acceptable.
No schedule DB/schema, future-job API or calendar backend is advertised yet.

The user explicitly approved external-only tests/builds for this task despite
the internal pressure warning, and required immediate cleanup. Tests temporarily
reuse the existing main dependency tree by a symlink removed in EXIT; no second
dependency installation is retained. Worker tests create no provider traffic;
managed/bundle fixtures carry exact synthetic markers and clean themselves only
after server/process closure, on success and failure. The allocator also removes
its exact newly allocated empty directory if marker allocation fails. Tests do
not recursively delete unknown files or unconfirmed-live launch directories.
Temporary run children under
`/Volumes/code-bank/tmp/scratch/zero-platform/zero-workers-tests` were inspected
empty and no task-worker children remained after the focused run. Existing
pinned calendar preview/source worktrees and shared dependencies are preserved.
Changed documentation link checks passed (214 local links, none missing).
