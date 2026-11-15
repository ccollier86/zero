---
id: zero.work.durable-jobs-and-workers
type: roadmap
audience: [developer, agent, operator]
owner: scheduler
status: draft
implementation_state: in-progress
visibility: internal
system: scheduler
feature: durable-jobs-and-workers
maturity: planned
applies_to: ["feature/core-worker-runtime-upgrades; proposed contracts unless explicitly qualified"]
---

# Shared scheduling, jobs and worker foundation

[Working evidence](./index.md) · [Scheduler](../backend/scheduler/index.md) ·
[Calendar return handoff](./calendar-return-handoff.md)

User approved implementation on 2026-11-14. Calendar backend work is paused.
This document is the execution/decision record and must be updated as work
lands. Proposals below are **not existing APIs** merely because they appear in
an example. No main merge, release archive, updater selection or deployment is
implied by a local implementation checkpoint.

Platform-wide governing requirement reaffirmed 2026-11-15:
[local-first performance](../backend/runtime/local-first-performance.md).
Zero's integrated services must not require external coordination hops or HOT
mode to be responsive. Review avoidable barriers across auth, file-backed
reads/writes, Fabric, workers, reactive delivery and logging. Preserve per-file
SQLite ordering, security and durability; measure mixed-load and tail latency
rather than treating a functional test or extra hardware as a performance proof.

## Confirmed scope — the complete framework foundation before calendars

The user's latest clarification supersedes the earlier artificial split between
core workers and durable scheduling. **Cron/durable scheduling, worker pools and
cross-service integration together are the prerequisite Zero upgrade.** Complete,
review and qualify that foundation before resuming calendar-specific backend
implementation. Include the concrete earlier execution/integration gaps below;
do not turn this into a rewrite of unrelated completed Zero features.

Four original scheduling drafts (`src/jobs/error.ts`, `model.ts`,
`realm-schema.ts`, `validation.ts`) remain independently preserved on
`feature/parked-scheduling-drafts`, commit `2cc8bd5`. Reviewed/corrected versions
are now in the active foundation branch, with a private Fabric realm/lifecycle
and code-owned definition contracts. Managed AppConfig, guarded native routes,
the request facade and SDK are now wired in source. The updater has not been
selected, and this is not evidence that a qualified durable service has shipped.

Core checkpoint gap-close checklist:

Active gap-close implementation is now on `feature/core-worker-runtime-upgrades`.
The older scheduling branch/worktree name is historical. Calendar application
work is paused; shared durable scheduling belongs to this foundation.
The same source worktree now lives at
`/Volumes/code-bank/tmp/scratch/zero-platform/core-worker-runtime-upgrades/source`;
it was moved with Git after checks settled, not duplicated. The preserved
calendar preview and its pin were not moved or changed.

- [x] Source checks: per-scope waiting limits and usable spare capacity under a saturated key,
  preserving the existing messaging adapter's queue behavior.
- [x] Source checks: explicit worker cancellation outcome, observed process settlement, idle
  generation recovery and simultaneous acquire/close regression coverage.
- [x] Source checks: typed registered-task references through the managed facade; fixed catalog
  admission remains authoritative, not caller-selected parsers/permissions.
- [x] Source checks: actual managed Torrent-to-worker integration and independent progress;
  existing AI/automation concurrency contracts remain compatible.
- [x] Source checks: actionable source-only Doctor guidance for eager long work on a sequential
  automation lane, with narrow syntax ownership and no automatic rewrites.
- [ ] Source/bundle/package exports, Linux process lifecycle qualification,
  cleanup, current documentation and an honest release readiness record.

These are implementation checkpoints within one framework upgrade, not a
requirement to publish an intermediate worker-only release before scheduling.

## Stocktake and step-by-step execution

### Actual state, not release claims

| Area | Present now | Still required |
| --- | --- | --- |
| Shared workers | Bounded fair async pool; fixed typed task catalogs; isolated processes; managed scoped facade; messaging compatibility; coordinated native concurrency proof. | Finish deployment qualification, including Linux startup/containment. |
| Torrent handoffs | Actor-preserving commit-acknowledged enqueue, native HTTP/SDK/hooks and scope retirement. | Reuse these receipts in durable scheduling; do not introduce a second execution/retry engine. |
| Cron | Existing lightweight in-memory scheduler remains compatible. | Durable occurrence ownership, restart/misfire handling, overlap policies and admitted control APIs. |
| Time selection | Private, tested timezone/DST/misfire prototype. | Integrate with persisted cursors and atomic occurrence creation; it is not currently an enabled scheduler. |
| Durable jobs | Private validated admissions/realm, indexed wake catalog, scoped Fabric lifecycle; Guardian/Torrent bridge, bounded dispatch loop, opt-in managed config, facade/HTTP/SDK, source outbox and live hooks implemented. | Finish live/security/recovery review, broader service adapters, operator view and exact deployment/package qualification. |
| Documentation/release | Working guides and this plan. | Supported/planned consistency, adoption instructions, exact final package/updater qualification. No new release has been selected. |

The [private storage checkpoint](./durable-jobs-storage-checkpoint.md) records
the earlier storage-only stage. The [durable source contract](../backend/scheduler/durable-jobs.md)
records the subsequent managed integration, without claiming a qualified release.

### 1. Close the existing execution foundation

Finish fair capacity, cancellation, failed/idle-generation recovery, concurrent
acquire/close and source/bundle task identity. Preserve both per-file SQLite
ordering and independent work across files. Repair brittle test preconditions
without loosening production authority or replay rules. In the native managed
concurrency test, coordinate actual task entry rather than assuming two separate
HTTP requests arrive within a 200 ms CPU window. Use a small IPC probe to diagnose
platform failures before repeating expensive package installs. Keep failed
intermediate evidence visible.

Gate: real native actor/worker/data progress and revocation pass; slots remain
counted until actual settlement; optional workers stay disabled without side
effects. This checkpoint can be committed while the later foundation work
continues; it is not a release-readiness claim.

### 2. Freeze durable ownership and admission contracts

Review the parked drafts against actual Guardian/Fabric/Torrent contracts before
restoring them. Define versioned, code-owned job definitions and workflow pins,
bounded inputs, explicit actor-owned versus service-owned execution, current
scope and a deliberate future-session policy. Actor authority must not silently
become SYSTEM after expiry/revocation. A long-lived service schedule needs an
explicit code-admitted service principal, permitted scope, provenance and live
eligibility checks. Preserve the initiating user separately from the executor.
Review API-key/machine support and the currently intentional SYSTEM/API-key
worker restrictions; do not simply remove a guard to make integration work.

Gate: ordinary users, administrators, machines, tenant changes, revoked owners
and service-owned work have explicit supported/denied behaviors and tests.

### 3. Implement the private Fabric scheduling state

Use existing supported realm contributions, ownership registration and migration
boundaries. Persist schedules, immutable admitted generations, due cursors,
occurrence intents, fenced claims and exact dispatch receipts in the appropriate
private scope/file. Validate retained realm identity; missing established state
requires recovery, not an empty replacement. Keep disabled configuration inert
and preserve retained state when disabled. Do not expose authority seals, inputs
or internal lease tables through generic client Sync.

Gate: atomic intent/cursor changes, rollback, duplicate identity, scoped queries,
independent-file writes, restart and retained-file errors pass using synthetic
owned databases only.

### 4. Implement durable scheduling and dispatch

Connect explicit-timezone cron/one-off calculation to bounded due selection,
misfire age/count budgets, overlap policy, monotonic ownership/revision fences
and pause/resume/cancel/run-now. A short timer wake discovers work; it does not
prove acceptance. Release SQL/authority commit leases before queue waits or
Torrent/provider calls. Dispatch to the pinned Torrent workflow using a permanent
logical receipt; reconcile death between enqueue and receipt persistence.
Respect receipt capacity with an observable safe stop unless a separately
qualified permanent compact-receipt design is implemented.
Review the existing local timer's registration/control validation, per-runtime
observability and stop/drain behavior as well; fix confirmed integration gaps
compatibly rather than assuming that a new durable module repairs old callers.

Gate: downtime, DST gap/fold, clock movement, duplicate wakes, stale claims,
revision edits, worker death, no-overlap and independent concurrent schedules
produce the intended bounded occurrences without duplicating effects.

### 5. Wire the Zero public facade end to end

Finish pure optional configuration, managed startup/recovery/drain, typed
`zero.jobs` and scheduling operations, native admitted HTTP contracts, SDK and
scope-retired hooks. Preserve compatible `zero.scheduler` calls; do not imply
legacy callbacks have become durable. Browser/machine adapters use the same
service admission, stable errors and accepted/unknown semantics, not raw actor
handles or caller-selected database paths. Reuse existing reactive transport
with current-authority snapshots and commit-derived update hints.

Gate: enable/disable in existing and new apps, each supported auth/topology mode,
real immediate/future runs, reads/control writes, SDK replacement, denial and
reconnect all work through public surfaces.

### 6. Close the earlier cross-service integration gaps

Use the integration matrix below as the checklist: Torrent and source automations
for short durable handoffs; AI/decision calls with independent bounded progress;
email/notifications with per-intent identity and truthful provider outcomes;
authorized private Storage/result references; Guardian at admission/effect/result
boundaries; Fabric at persistence; semantic logging at accepted control/effect
boundaries. Do not audit every timer/lease/heartbeat or expose prompts/results.
Map long-running built-in callers to the right existing mechanism deliberately;
do not replace logging custody or other feature-specific protocols with a generic
pool merely to share infrastructure. Declare unsupported adapters explicitly.

Gate: representative real managed integrations pass, including slow AI not
holding unrelated work or database leases, uncertain external effects needing
reconciliation and genuine revocation still stopping publication.

### 7. Review operator/developer experience and documentation

Provide the planned native job/schedule control view and live scoped state using
existing DataTable/filter/count/modal primitives where included in the supported
boundary. Distinguish admitted, queued/running, completed, blocked and unknown.
Document configuration, permissions, definition/version changes, recovery,
backpressure, cancellation, topology, worker deployment and application adoption.
Complete narrow Doctor guidance and public examples; link the main references
to individual APIs. No custom polling/audit substitutes or fabricated row events.

Gate: examples match the installed public exports; live denial withdraws old
content; inspection/control UI and guides explain actual supported behavior.

### 8. One final polish and release qualification

Use targeted tests during implementation; do not restart every unrelated suite
after every edit. Freeze the complete foundation candidate, then perform the
repository-required final security/recovery/types/package/browser-if-UI/Linux
and normal-updater qualification. Record exact commit/archive/hash, original
failures and the final successful checks. Clean owned fixtures, containers,
temporary dependencies and builds on each phase's success/failure; retain only
small evidence and useful bounded caches. Publish/merge/select only when the
actual release gates are satisfied. No production app/data changes here.
Reconcile the then-current main before that final freeze, preserving unrelated
work. Final candidate qualification uses its own frozen dependency installation,
not a borrowed dependency symlink used for quick source diagnostics.

Then return to the preserved calendar backend requirements. The user's additional
Zero improvements requested for after scheduling stay in a separate backlog;
the [built-in backup service](./built-in-backup-service-plan.md) is recorded
there as a native service with destination adapters, not work to start during
this foundation pass. Other follow-on improvements remain separately ordered.

### Core gap-close working evidence (November 14)

Keep unsuccessful intermediate results visible. One diagnostic group used Bun's
five-second default and finished 133 passing / one timed-out cross-tenant auth
test (19 files); that was not a successful qualification. A fresh independently
installed run with the documented 120-second test deadline passed that boundary
but found an idle-generation reuse race (139 passing / one failure, 20 files).
The old child can die between pool selection and catalog acknowledgment. The
correction permits exactly one replacement of a reused generation **before task
dispatch**, only for a transport failure and after confirmed retirement plus an
authority recheck. It does not replay dispatched tasks or weaken unknown outcomes.
Focused process revalidation passed all 16 then-current tests, including five
repeated death races. The final expanded group and Linux/package checks are
recorded below only once they actually finish.

Subsequent stocktake: an independently installed source group completed 143
tests (141 passing, two failing). Its packed/public-export consumer passed. One
failure was a 30-second managed-fixture deadline under host I/O load; the other
was a restart fixture whose due retry had already been correctly completed by
startup recovery before its explicit poll. That fixture now keeps the retry in
the future until the intended poll. Targeted restart (one test) and managed
requests (two tests) pass. Strict TypeScript checks of worker exports, typed
facades, native fixtures, Doctor and qualification scripts pass. These targeted
source diagnostics used an EXIT-cleaned dependency link; they are not relabeled
as final independent-package qualification.

Another targeted group passed 21 tests and failed one native concurrency timing
assertion: separate HTTP enqueues need not arrive within a 200 ms CPU window.
Phase 1 replaced that brittle timing precondition with coordinated real task
entry before release, retaining the distinct-process/overlap/independent-progress
assertions. Final targeted revalidation passes **26 tests / five files / 131
expectations**, including the native worker requests and real Torrent/AI/data
fixture, process races, task contracts and configuration. Earlier failures remain
recorded, not relabeled. The runtime/planning checkpoint is saved as `a796f1d`;
the coordinated test fix is saved in the follow-up checkpoint. This is not a
full-suite, final-archive or normal-updater qualification claim.

Two isolated Linux/amd64-on-Colima/Rosetta archive runs completed: three passing /
18 failing, then 12 passing / nine failing after ordinary fixture budgets were
aligned with the actual execution default. The remaining failures cluster at
the five-second child-start deadline under emulation. The latter run passed the
real managed requests, Torrent/AI/worker integration and minified worker case.
No successful full Linux qualification or compiled/supervisor qualification is
claimed. A small payload-free IPC probe can exchange a message in that environment;
further startup diagnosis is still required. Dedicated labelled containers and
synthetic bind roots were removed by their creating scripts after both failures.
The reusable external-backed Colima profile/image/package cache is intentionally
retained, not production state. Calendar source/preview pins remain untouched.

## Outcome and boundaries

### Managed integration working evidence — not final release qualification

At committed checkpoint `5c1e9d3b692df699b136bb39882175ce4b25c70b`,
`scripts/qualify-worker-foundation.ts` completed with its own frozen dependency
installation: **234 passing / 42 files / 1,300 expectations**, followed by strict
direct-Bun TypeScript. That includes an independently packed/installed public
worker check, not just a borrowed dependency link. The script retired its owned
dependencies and synthetic runs afterward. This is the focused core group,
**not the entire framework suite or final selected archive**.

Subsequent, overlapping source checks added native file-backed job dispatch
across two managed restarts and explicit service-owned eligibility after creator
logout: **eight passing / two files / 82 expectations** before the follow-up
review below. The strict fixture type check caught an overly narrow nullable
startup-handle inference; its typed holder was corrected. Do not confuse that
fixture type correction with a runtime authorization change.

The follow-up review now closes a whole-batch scope barrier, adds immediate
bounded slot refill and indexed keyset discovery, and fences retry admission
locally when durable wake publication is busy or fails. Tests include more than
100 backed-off roots followed by healthy work. Never-started stale generations
remain wake-visible for bounded `not-dispatched` retirement; expired claims
still require original-receipt reconciliation. A child IPC server now imports
the portable protocol directly rather than bootstrapping parent-executor code.
Its independent transport/import-graph group passes **21 tests / two files /
125 expectations**. These changes remain source work pending the final combined
checks; earlier evidence is not silently reassigned to them.

The raw Bun-only Linux/amd64 IPC probe, with no Zero imports or databases,
completed both immediate-ping and ready-then-ping paths under Colima/Rosetta.
Parent ready times were 4,598/4,338 ms and reply times 5,515/5,277 ms. This
isolates a real emulation startup cost; it is not a native Linux latency claim.
Production's five-second startup default is unchanged. An explicitly named
`--emulated-smoke` uses a 15-second diagnostic deployment budget for source,
bundle, compiled worker and supervised-parent-death checks, and explicitly does
not relabel the earlier default-budget matrix as passing. A warm repeat of the
raw probe also passes delayed-listener delivery: ready/reply times were
527/607 ms (immediate), 632/713 ms (after-ready), and 820/887 ms (250 ms delayed
listener). Cold/warm and contention variance must remain visible; there is no
claim that emulation always requires five seconds or that messages are lost.

The first explicit-budget package attempt failed before source worker startup.
A later attempt passed source/bundle/compiled work but caught a containment
fixture error: its second container set a TMPDIR that did not exist. The fixture
now creates that private directory and immediately reports a failed launch
instead of swallowing it until an unrelated deadline. The subsequent diagnostic
archive **`3f6083e060e48d0e76cf6f43b75ad2c27210af0176d674b39a667977e1d0f80d`**
passes source, minified bundle, compiled executable and entered-CPU parent
SIGKILL/container-init containment using the explicit 15-second startup policy.
Image: `oven/bun@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d`.
This was an independently packed/frozen-installed working candidate, **not the
final release archive or a successful default-budget full Linux matrix**. Later
jobs changes are not qualified by that earlier archive. Its creating script
removed the labelled containers, extraction/dependencies, binaries and exact
synthetic fixture after settlement; only the shared warm package cache remains.

A concurrent host group produced a five-second actor-start failure under load
and a test-precondition failure after keyset ordering changed. The concurrency
fixture now explicitly places its slow root first rather than assuming insertion
order survives ordered discovery. The corrected pure dispatcher and real SDK
retirement group passes **seven tests / two files / 28 expectations**; the
subsequent fixed-horizon case and final combined file-backed group are tracked
separately. No failed host group is relabeled as passing or used to loosen
production startup/security defaults.

The final focused combined run for this follow-up used its **own frozen
dependencies** and passed **52 tests / nine files / 424 expectations**, then the
strict direct-Bun TypeScript group passed. It covers fixed-horizon discovery,
100-root fairness, durable-deferral failure, bounded stopped-generation
retirement, native file/WAL/indexed discovery, real managed restarts, deliberate
service ownership, tenant isolation, source/outbox evidence, SDK/watch retirement
and child protocol/import boundaries. The earlier standalone type diagnostic
caught an unsupported test-only `Bun.build.write` option and overly narrow test
boolean inference; those fixture issues were corrected before this passing run.
Documentation: **892 pages/unique IDs reachable, zero structural problems**.
Do not add overlapping group counts or claim a full-framework/final-updater pass.

The creating scripts retired all owned synthetic state and dependency trees;
the fixture parent is empty and the dedicated `zero-workers` Colima profile is
stopped. Shared warm caches and the separately pinned calendar preview remain
intentionally retained. At completion external free space was about 229 GiB;
the internal-drive guard still warns (about 74 GiB), under the user's explicit
external-only exception. Source, history and real runtime data are preserved.

### Remaining operator-read contract slice (review, November 15)

Complete these before assembling the native management view; they are not
implemented just because the current request facade already has controls:

- Publish code-owned, payload-safe definition/capability discovery and
  per-schedule action availability through the same server policy. A browser
  role/owner check cannot reconstruct custom management policy, service-owned
  readmission or an administrator's inability to impersonate another actor.
- Share a bounded scheduling/execution summary across list, detail and live
  reads. List pages currently omit next due, blocked reason and occurrence
  changes, so equal-page coalescing can hide a meaningful runtime update.
  Keep paused scheduling separate from an older generation's still-running work.
- Give browser mutations a typed, static failure contract retaining their
  original idempotency key and explicit uncertainty/reconciliation requirement.
  Transport loss or an invalid acknowledgment is not proof of rejection. Never
  create a new key to bypass an uncertain write or interpret a null receipt as
  permission to replay an external effect.
- Expose linked Torrent run observation only where its own authority admits it.
  A job-management permission does not automatically grant arbitrary workflow
  control, and `dispatched` is not evidence the provider effect completed.
- Distinguish retained quota stops from temporary pool pressure. Do not propose
  deleting permanent receipts or rotating service principals as capacity repair.

Review also found jobs omitted from two existing SDK retirement paths. They now
clear the logical jobs subscription boundary during read-authority invalidation
and explicit tenant transitions. Auth response chunks were already guarded;
the corrected defect was an old imperative watch surviving to reconnect under
replacement authority, not established disclosure of old response bytes.

The next source pass connects `AppConfig.jobs`, Guardian-bound `zero.jobs`,
private Fabric state, exact Torrent pins/receipts, bounded dispatch, the native
HTTP/SDK facade and coalesced live pages. The same worktree was moved with Git
to `core-worker-runtime-upgrades/source` after its processes/dependency link
settled. No calendar component or calendar backend implementation was changed.

- Real Guardian/Torrent bridge and existing enqueue/system-start checks:
  **25 passing / four files / 159 expectations**. A prior fixture incorrectly
  expected an activity to have entered immediately after commit acknowledgment;
  it now observes actual entry before testing revocation. Enqueue still does
  not await the activity.
- Private jobs plus managed facade/live routes and SDK checks: **41 passing /
  12 files / 323 expectations**. Includes real Fabric subprocesses, owned files,
  restart, indexed future/idle wakes, slow/independent work, cancellation,
  revocation, immutable pins, source/outbox/investigator evidence and live pages.
- Subsequent native multi-tenant check: **one passing / 11 expectations**;
  identical logical keys are scoped independently and cross-tenant read/control
  fails closed. Subsequent watcher/SDK checks: **six passing / 26 expectations**,
  including stopped readers, retired late results and definitive-denial cleanup.
  These groups overlap earlier tests and must not be summed into a full-suite run.
- The first native HTTP group caught Elysia stripping an unexpected scope field
  before broker validation. Job mutation routes now preserve raw JSON for the
  admitted service's closed validation; a later successful group includes it.
  Intermediate logging-fixture setup/query errors were corrected, not treated
  as successful runs.
- Strict direct-Bun TypeScript checks pass for managed jobs, configuration,
  logging, native fixtures, SDK, stream/watch and hook modules. These source
  diagnostics used an EXIT-cleaned dependency link, **not** a final independent
  frozen package installation. Documentation checks: **890 IDs/pages reachable,
  zero problems** at this pass.

The actor source records accepted schedule controls once at their canonical
write. Payloads/seals, replay, idle reads and claim leases are not audit events.
Full semantic run/outcome presentation, remaining native service adapters,
operator UI/Doctor review and final independent package/browser/Linux/updater
qualification remain required. The earlier unsuccessful Linux evidence remains
applicable and has not been relabeled passing. There is no selected new archive,
main merge, release publication or production change from this checkpoint.

All runs here used the approved external-only storage exception. Owned synthetic
state and temporary dependency links are cleaned by their creating finally/EXIT
handlers. Existing warm caches, the stopped Colima profile and preserved calendar
preview pins are retained; source/history are not cleanup targets. The internal
free-space warning persists even though external free space is about 230 GiB.

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
and two additional queued-hook regressions were checked before checkpoint.
The queued-hook/configuration/ownership-cleanup follow-up passes 37 tests in
three files. Source is preserved in feature checkpoint `e8ba379`; no main merge
or release publication is implied.

A later process-only load recheck found two shutdown failures (8 passed / 2
failed); retain that evidence, not a claim that every interim run passed. The
100 ms graceful ack/exit bounds were too aggressive. They are now 1,000 ms, and
retirement explicitly reconciles an already observed exit plus private-directory
release before freeing its slot. Unsettled exits/cleanup failures still reject.
A deterministic delayed-shutdown fixture and failed-start cleanup regression
cover the correction. Final focused requalification passes **139 tests in 19
files / 734 expectations**; no full framework-suite pass is implied.

The repository-wide TypeScript check completed with one portable-declaration
error in the earlier calendar layout helper: inference named `csstype` through
the temporary dependency symlink. An explicit exported `CSSProperties`/rest
return annotation removes that path dependency without changing the UI. Final
focused declaration/type checks cover this correction; the failed full-check
result is not relabeled as a passing full check.

Final strict focused checks passed for the worker implementation/configuration/
process tests and calendar helper. A separate strict `--declaration --noEmit`
check passed for worker exports, schedule-time selection and calendar layout;
no declarations/build trees were retained. Final cleanup verified no owned task
children or synthetic fixture directories, and the dependency symlink was
removed by EXIT. External free space is about 233.4 GiB. The internal 77.8 GiB
warning remains under the user's explicit external-only exception, not a claim
that machine-wide storage pressure has been repaired.

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
The deliberately noncooperative synthetic worker now has a ten-second hard-stop
fuse too, so killing the runner cannot strand an infinite test CPU loop. This
fixture safeguard does not stand in for Linux production containment testing.

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
