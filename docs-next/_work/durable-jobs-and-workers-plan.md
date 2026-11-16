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
| Torrent handoffs | Actor-preserving commit-acknowledged enqueue, native HTTP/SDK/hooks and scope retirement; exact sealed job handoffs use these existing receipts. | Native cross-service adoption qualification; do not introduce a second execution/retry engine. |
| Cron | Lightweight scheduler remains compatible; optional durable jobs own nominal occurrences, restart/misfire, overlap and admitted control APIs in source. | Finish deployed/package qualification and operator/service acceptance, not another cron engine. |
| Time selection | Tested timezone/DST/misfire selection is integrated with persisted cursors and atomic occurrence creation in opt-in jobs. | Final native/deployed acceptance; calendar recurrence remains a distinct postponed domain. |
| Durable jobs | Private validated admissions/realm, indexed wake catalog, scoped Fabric lifecycle; Guardian/Torrent bridge, fair bounded dispatch, opt-in managed config, facade/HTTP/SDK, source outbox, live summaries and operator UI in source. | Finish semantic-audit/cross-service qualification, UI browser review and exact deployment/package qualification. |
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

### Operator-read contract slice (review and source follow-up, November 15)

The review identified these prerequisites before assembling the native
management view. Checked items are source implementations, not released UI:

- [x] Publish code-owned, payload-safe definition/capability discovery and
  per-schedule action availability through the same server policy. A browser
  role/owner check cannot reconstruct custom management policy, service-owned
  readmission or an administrator's inability to impersonate another actor.
- [x] Share a bounded scheduling/execution summary across list, detail and live
  reads. Earlier list pages omitted next due, blocked reason and occurrence
  changes, so equal-page coalescing hid meaningful runtime updates.
  Keep paused scheduling separate from an older generation's still-running work.
- [x] Give browser mutations a typed, static failure contract retaining their
  original idempotency key and explicit uncertainty/reconciliation requirement.
  Transport loss or an invalid acknowledgment is not proof of rejection. Never
  create a new key to bypass an uncertain write or interpret a null receipt as
  permission to replay an external effect.
- [ ] Expose linked Torrent run observation only where its own authority admits it.
  A job-management permission does not automatically grant arbitrary workflow
  control, and `dispatched` is not evidence the provider effect completed.
- [ ] Distinguish retained quota stops from temporary pool pressure. Do not propose
  deleting permanent receipts or rotating service principals as capacity repair.

This source slice adds `definitions.list`, live-request action availability and
bounded latest/active-generation summaries without changing the original
mutation/receipt shape, private schema or histories. Native routes and SDK
parsers share the contract; service eligibility/parser code is not executed for
discovery. A first managed/operator/SDK group passed **30 tests / five files /
229 expectations**. The independent frozen combined follow-up then passed
**45 tests / nine files / 433 expectations**, including actual native
live-completion/eligibility-block changes without a fabricated schedule revision,
ordinary-user discovery, administrator non-impersonation, private history,
logging and index-plan checks. Its type phase found three new parser/test
narrowing errors; these were corrected with explicit typed action construction
and literal fixtures, not disabled checks or unsafe transport casts.

Independent review also rejected a broad auth-code regex in the mutation error
projection. Only explicit recognized pre-admission codes are now retained;
unrecognized auth-prefixed response content remains code-null/unknown. Explicit
unknown outcomes override any apparent rejection. The final frozen focused
follow-up passes **22 tests / four files / 138 expectations** and the expanded
strict direct-Bun TypeScript group. It preserves the dispatched key despite
caller mutation, retires late rejected responses after scope replacement, and
does not retry or expose raw response messages/bodies. These overlapping groups
are deliberately not summed or described as a complete-framework suite.

Documentation checks remain **892 pages/unique IDs reachable, zero problems**.
All owned synthetic runs/dependencies were removed by finally/EXIT; the dedicated
Colima profile remains stopped. Source and warm caches are retained. Full
operator UI, admitted Torrent run detail/control, source semantic-run audit and
final release qualification remain outstanding, not implied by these reads.

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

## Native operator and semantic-audit follow-up — November 15

This entry supersedes the earlier prototype/next-pass descriptions above; those
are retained as historical evidence, not current claims of missing source APIs.
Calendar backend/UI and the backup-service implementation remain paused.

Implemented in the current source candidate:

- `JobsWorkspace` in `src/components/jobs/`, exported through the frontend jobs
  feature barrel. It reuses native DataTable offset paging/default twenty rows,
  rolling totals, scoped live queries, Select, ScrollArea, list/detail layout,
  Zero icons and ControlledModal. Application-owned creation/edit/run/owner
  adapters are explicit; no fake generic parser schema or borrowed credential
  client is introduced. See the [workspace manual](../frontend/jobs-workspace.md).
- Original action/revision/idempotency identity survives confirmation and
  uncertainty. `runNow` correctly accepts its independent one-off schedule ID;
  ordinary controls remain bound to the original schedule. Unknown outcomes
  only read the original receipt, never send another command. Rapid clicks,
  client/scope replacement, late responses and unmount retire safely.
- Definitive live read failure withdraws rows, details and actions. The native
  creation extension is disabled too. Read retry does not temporarily resurrect
  denied inspector content; fresh selected details are independently authorized.
- Actual committed-change invalidation reaches the selected inspector even when
  its job is off-page or the latest/active summary is unchanged. A separate closed
  invalidation bit is coalesced through native watch/SSE/SDK/hooks; periodic
  unchanged authority checks stay quiet. Table pages use their actual snapshot,
  not fabricated INSERT/UPDATE events or a second HTTP read for each live frame.
- Canonical job controls, handoff/blocking and observed terminal transitions
  append payload-free semantic workflow evidence atomically into the existing
  source outbox. Jobs suppress redundant generic record events only for their
  own source. Claims, no-ops, materialization, polling, replay and idle reads do
  not create audit activity. Capture remains optional and policy-controlled.
- Native activity/detailed HTTP controls own true user attribution; background
  observations identify the fixed system source and link the schedule, without
  impersonating an expired session or claiming an explicit preserved initiator.
  Fixed-source delivery wakes after its lease is released even if a committed
  command's final reply becomes unknown. That wake grants no replay/acceptance.
- A native managed file-backed jobs/Torrent/AI-decision regression holds one
  actual service callback while another job and an application-file write
  progress. It proves exact activity pinning, logout/revocation late-output
  fencing and cancellation preserving physical pool occupancy until settlement.
  Provider bytes are mocked at the configured service transport; no real provider
  call, model-quality result or universal latency claim is implied.

Qualification at this point: a fresh frozen dependency installation passes
**89 tests / eighteen files / 956 expectations**, including real managed HTTP,
native scheduler/Torrent, Fabric/source delivery/investigator, SDK retirement,
and Chromium with both motion preferences. Earlier isolated browser probes
caught an ambiguous test locator after a legitimate run-now duplicate label;
the selector was scoped to the actual heading, not papered over with `.first()`.
The first semantic-audit probe rejected a test's undeclared claim-only field;
the fixture was corrected without relaxing the closed production command.

The expanded strict type phase then found two readonly-array assertion-type
errors in the new native-service test. Expected arrays were explicitly copied;
the original type run remains failed. A fresh narrow test/type follow-up is
now complete: **one native-service test / 64 expectations passed**, followed by
the expanded strict direct-Bun TypeScript group covering workers, jobs,
semantic logging, watch/SDK/hooks, the complete workspace/Chromium fixture and
preview script. The follow-up used another independently installed frozen tree;
it is not a relabeled rerun of all 89 tests and the overlapping totals are not
summed. No production implementation changed for the two assertion-type fixes.

Current documentation structural gate: **894 pages/unique IDs, all reachable,
zero problems**. The [service-composition guide](../backend/workers/service-integration.md)
states actual AI/automation/notification/email/Storage boundaries, including the
absence of a universal durable SMTP-send or generic private jobs-artifact adapter.
Do not claim every app/provider is exactly-once merely because Torrent and jobs
have permanent receipts.

This is still an unreleased feature checkpoint. Final exact installed archive,
Linux/bundled jobs/UI integration, exports and normal-updater qualification remain
separate gates. Existing diagnostic emulated-worker evidence is not relabeled as
a full native/default-timeout deployment pass. No main merge, archive selection,
production change, calendar implementation or backup service is implied.

Phase cleanup: both independent installations and all owned preview servers,
Chromium leases, actor/database handles, generated CSS/screenshots and synthetic
roots were retired by their creating finally/EXIT handlers. The worker fixture
parent is empty and no dependency tree/link remains in this worktree. The
dedicated Colima profile remains stopped; this pass did not start Docker or
touch a production context. Source, conversation history, shared warm caches
and the separately pinned calendar preview remain preserved. Storage checks
still report the approved external-only exception: approximately 229 GiB free
externally, with the separate internal-drive warning around 74 GiB, not repaired
or bypassed by this work.

### Final independent review and qualification preparation (November 15)

The pre-release review found and corrected concrete boundary defects rather
than treating focused source tests as deployment qualification:

- Official builds now preserve the canonical jobs migration sources and complete
  realm identity, so a bundled parent can reopen state created with the matching
  retained source actor. Runtime checksum checks are not relaxed.
- A quarantined/unconfirmed worker generation still occupies physical capacity,
  but does not prevent a different healthy idle/free slot from serving work.
  Pre-aborted acquisition cannot allocate a child. Failed retirement stays visible.
- Async validator results are rejected synchronously and genuine rejected
  promises are observed without executing authored thenable getters.
- Jobs ticks and their queued wake callbacks explicitly leave the initiating
  request's logging lifetime. Background observations retain their system
  attribution rather than borrowing a live or expired HTTP actor.
- A successful SSE reconnection triggers a distinct authorized inspector refresh,
  even if an off-page change occurred during the gap and the visible page is
  equal. This is not a fabricated commit hint or a second execution engine.
- The root server's durable definition type is `DurableJobDefinition`; its
  existing local-timer `JobDefinition` remains compatible. Dedicated jobs exports
  retain their own `JobDefinition` name.

The first expanded follow-up retained its failed result: 62 tests passed and
one new hook fixture failed because changing AppProvider's initial client prop
does not replace its owned client. The corrected fixture deliberately remounts
the provider, as required by that contract. A later diagnostic strict check
found the duplicate root type export and two probe type errors; those were
corrected rather than suppressing the checks.

A subsequent long-lived-build regression also disproved a URL-query cache-key
fix: Bun 1.4.4 reused the physical module, and the second synthetic migration
kept its first checksum. That failed four-pass/one-fail probe is retained as a
failure. Canonical jobs migration capture now uses a bounded, fresh Bun
pure-import process with an empty environment and dotenv disabled, verifies the
source hash before/after import, and confirms child exit. It creates no helper
files or application/database runtime. Its replacement regression checks both
executable migration behavior and checksum/fingerprint identity after changing
an owned synthetic source. The follow-up passed **six tests / two files / 27
expectations**, including child environment isolation; it is not added to the
overlapping group below as a new total. Compiled CLI invocation fails closed;
use the source Bun CLI for official builds, including compiled app output.

After those corrections a fresh, independently frozen dependency installation
passed **64 tests / nine files / 414 expectations**, including managed native
activity/detailed logging with both timer/request wakes and Chromium ordinary/
reduced motion. Its expanded strict type phase also passed, including the new
installed Linux probe, public compatibility types and host qualification scripts.
The independent dependency tree and all owned test fixtures were retired.

New exact-archive Linux qualification uses only public application imports,
independently installs/frozen-reinstalls the selected package, compares every
archive-owned file independently, exercises the official build and retained
file-backed source-to-bundle restart, and checks actor entry/environment and
semantic evidence. Pending-work assertions must prove the process stopped
before the due instant; terminal history alone cannot establish restart recovery.
Its synthetic state and labelled local container are owned/removed in finally.
This new probe is not yet a passed release gate merely because it is written.

The first exact-archive Linux attempt at `8beea911f074e999657965ebf6255ef991b8452e`
(`5aec2dfdc50aa15a51360be754e3e9c15f11c43a4f42a45afd4b4642e223be45`)
completed both consumer installs, then failed fixture admission before boot:
the probe incorrectly used CommonJS `require.resolve` for import-only public
exports. The qualifier now uses Bun's actual consumer import resolver. This is
a fixture correction, not a change to or relaxation of the public exports; the
original failed diagnostic remains retained under core-workers-release.

The second exact attempt, `c401dbd68b29efbc185e55273d37e71aac3bd536`
(`984d619076a73161983405f0f7cfbc191f5aa03cceb0fdf9f059e15f6e1277e3`),
verified every installed file, then correctly rejected an invalid deployment
fixture: the code registry accepts one graph per name, not two code graph
versions with the same name. The fixture now registers one explicit graph and
pins activity version 1 over a newer default activity version 2, using the real
public contracts. It explicitly declares its database capability and one total
attempt. A new cheap registry-admission regression passed (one test/five
expectations) before the next packaged runtime probe. Both failed containers,
synthetic roots and transient candidate packages were retired; their small
failure reports remain. No framework guard or production default was relaxed.

The next Linux archive (`a49f84ae20f7143b7e292b9586381660bd1c2476`,
`9bc085909611303bdcceeab42e0b5c77265b49690d23157b41d0585644ebf470`)
passed source execution, the official build, minified restart against retained
source-created state, and the bundled native HTTP controls/receipt path. Its
application-endpoint SDK enqueue then failed the unchanged 60-second completion
deadline. This is a failed candidate, not a qualified bundle result; source and
retained-state substage observations remain distinct from overall failure.
The next probe records only closed public occurrence/schedule fields and
content-free runner/pool health before retiring its synthetic state, to identify
the actual stalled boundary without retaining private inputs or increasing the
deadline. Independent review also identified a generic shared-pool async-context
handoff risk; that requires its own regression and correction, not an inferred
explanation of the Linux failure without supporting state.

The cheap deployment-registry test passed at runtime but its strict phase found
the required registration-context argument missing from the test. It now passes
the native `{ ai: null }` disabled-service context and awaits setup. Final source
types remain a required gate; that failed type phase is not called a pass.

The safe-state diagnostic on `ecf0e32aa00722fcaf8bcdeb370abc3e113d6f9d`
(`dbb95ef17b94eaaf46c9a84eaf2b3573794167c1bc23cf9df7ebae2d356331ff`)
failed earlier, on a source-mode receipt-reconciled enqueue: the occurrence was
still pending with no workflow/activity, while dispatch had reported an unknown
outcome and later admissions reported database conflicts. This disproves a
bundle-only diagnosis. Root review identified two concrete shared boundaries:

- WorkPool refill used the preceding callback's async context instead of the
  queued callback's submission context. A separate committed-baseline probe
  reproduced `first-caller` where `second-caller` was required; the corrected
  pool preserves `second-caller`. The bound execution includes PromiseLike
  assimilation, not only the synchronous function call.
- A retired/throwing logging-context getter ran before actor dispatch but outside
  the actor error boundary. Its plain error was normalized to unknown and the
  shared authority lease could be held until a still-healthy actor exited.
  Pre-dispatch capture now fails as sanitized authority-changed/not-started.
  Real dispatched-unknown handling remains unchanged.

After those corrections, a fresh frozen focused group passed **110 tests /
eight files / 1,180 expectations**, followed by expanded strict types. It covers
the real actor lease regression, existing dispatched-unknown settlement fences,
WorkPool/messaging compatibility, canonical builds, real managed activity/
detailed audit delivery and native jobs/Torrent/AI-service independent progress.
The native regression proves no held/shared lease, successful exclusive admission,
no rejected row/receipt, later accepted same-key writes and no healthy actor
generation change. This is not yet an exact Linux archive pass. A final review
also found analogous supported clock/timeout preflight and diagnostic-clock
failure paths; their bounded correction and fresh recheck are in progress.

That follow-up is now implemented and checked: preflight pins the configured
clock/timeout before actor dispatch and final-edge attribution, and diagnostic
clock failures cannot replace the original outcome or skip retirement. The
shared-authority presence writer uses the same preflight. A fresh focused
recheck passed **76 database tests / two files / 943 expectations**, including
the expanded real-actor failure cases and the unchanged dispatched-unknown
settlement tests, followed by expanded strict types. These overlap the prior
110-test run; they are reported separately, not summed into a new total.

All focused dependencies/owned fixtures are retired. The dedicated external
Colima profile is stopped between native checks and the next Linux phase. No
normal updater selection, main merge, production change or calendar work has
occurred. The feature checkpoint (not a release) is preserved on both remotes.

### Corrected exact installed Linux jobs boundary (November 15)

Committed runtime candidate `bc396a957c1e0fb85ac935bfa5b1d6dfdfb8b0b3`,
archive SHA-256 `957019bbc8cdfd7d236355476dd47622c9fbd78e85e3530e556d38b5430dfeb7`,
now **passes** the independent Linux/x64 installed-archive probe. This is a
qualified substage, not selection of the normal updater or a complete framework
release gate.

The report verifies every archive-owned installed file, consumer frozen reinstall,
public import resolution, native source execution, the official build, minified
server startup against source-created file-backed application/SYSTEM/private jobs
state, and a further retained bundled restart. Three app boots executed eight
version-pinned local activities exactly once. All 32 expected semantic job events
arrived with the intended user/system attribution and no replay duplicates.
Six observed jobs actor processes used the exact installed fixed source entry
and excluded the synthetic parent environment sentinel. Both previously stalled
native/application-endpoint enqueue paths completed without changing deadlines.

Evidence: `artifacts/zero-platform/diagnostics/core-workers-release/`
`bc396a957c1e0fb85ac935bfa5b1d6dfdfb8b0b3-jobs-installed.json` on the external
development volume. It records the pinned Bun image, exact archive/consumer-lock
hashes, all stage flags and confirmed retirement/cleanup. The VM is aarch64 with
Linux/x64 emulation; this is not a native x64 CPU latency measurement. The
logging fixture explicitly uses a 30-second cold-start budget; jobs actors keep
their unchanged default launch configuration. No real providers, genuine unknown
transport fault, multi-host election or compiled jobs application are qualified
by this probe.

The container, private databases, app bundle/build copies, dependencies and
transient candidate package were removed by their owning finally handlers. A
stale control socket in the dedicated test VM was repaired through its own
force-stop/start commands; its VM disks/download cache and unrelated profiles
were preserved. Small reports remain, not full successful fixture copies.
Next: release-neutral reference wording and a final frozen-source sweep, followed
by exact final worker/deployment/package/updater qualification. Do not restart
calendar/backend/backup work or infer a main merge from this passing substage.

The first frozen-source attempt at `6739fe54dd90e2211cddc1ae43d17ca406cb8cac`
correctly stopped at the root TypeScript gate: four stream-iteration typing errors
in three new test/deployment helpers were hidden by the earlier ESNext-focused
type invocation. The source package targets ES2022/DOM, so those helpers now use
standard explicit stream readers with finally-released locks instead of widening
the root library/target. Browser diagnostic draining is observed at teardown.
No production scheduling/authority code or test assertion/deadline was relaxed.
No complete test inventory ran in that attempt, and it is not reported as one.
Its independently installed root/payments dependencies, exact private Chrome SDK
source fixture, temporary artifacts and owned awake process all retired, with
the failed type output and small source/provenance report retained. The next
frozen candidate must run the normal full source gate from the beginning.

The dedicated external Colima profile was started for this qualification phase;
it must be stopped after owned containers retire. Calendar/backups, real
applications and production state remain untouched. The normal selected release
is still 2.10.5 until the final committed archive and updater gates pass.

### Resumed qualification after the interrupted source sweep

The frozen `5038b5fa1988223f6ae639761768c9d7147a4332` attempt passed the root
TypeScript, package/export and PDF runtime gates. Its full inventory admitted
1,475 files, but completed only **491 files: 489 passed and two failed** before
the host storage interruption terminated Bun processes. It is an interrupted
run, not a complete baseline or an all-green release gate. Its bounded original
logs/provenance remain unchanged; no focused-finalization exception can turn
those missing files into completed coverage.

The failures require separate dispositions:

- The Guardian example compiler found a bare `authorization:` property fragment
  in the RBAC guide. That unchanged baseline example is now a complete typed
  `defineAuthConfig` declaration, with the same permissions and explicit single
  tenancy. The example test is unchanged; no fence is skipped or diagnostic
  assertion relaxed.
- The AI-agent public inference compiler test exceeded its existing 30-second
  deadline at approximately 32 seconds. Its sequential isolated recheck at
  `da6b425` passed in 26.1 seconds under that unchanged deadline. The Guardian
  example check and full root typecheck also passed in that run. This supports
  a contention-sensitive compiler fixture, not a production AI latency claim;
  the original failed attempt is not relabeled as passing.

The host recorded USB I/O errors and an unclean APFS remount around the native
Bun instruction faults. A later live read-only filesystem verification did not
produce a final verdict and its waiting client was retired. Ordinary file access
does not certify filesystem integrity. The release owner subsequently explicitly
overrode the storage instructions/hold for this Zero task. This scoped permission
is recorded as an exception, not as a successful disk repair or verification;
global maintenance and its hold remain unchanged. Source, real state, other apps,
history and shared caches remain protected. Only this run's independently
verified owned synthetic outputs may be retired.

Final read-only review also identified worthwhile combined recovery coverage:
the real managed runner must privately recover a genuine Torrent receipt after
an injected lost bridge return/receipt-observation outage, schedule cancellation,
creator revocation and restart. The new regression uses existing composition
boundaries, the actual claim lease and the existing 120-second per-test ceiling.
It must not claim real IPC death or abrupt crash durability from a graceful
restart fixture. The first attempt at `da6b425` reached 16 assertions, then failed
when a read-only evidence probe opened the private SQLite file after its managed
binding had closed. That failed result remains retained. The corrected fixture
at `0ad8a5b` takes its closed-after-read snapshots only while the actual native
observer has admitted the live binding. Its focused run passed all 44 assertions
in 68.3 seconds, with a fresh frozen dependency installation and full root
typecheck. The original claim and real lease survive restart unchanged; recovery
finds the same single workflow with one activity invocation, no new enqueue and
no SYSTEM receipt. This is source recovery coverage, not final archive qualification.

The corresponding focused evidence is
`0ad8a5b19f41352d20cc55360a89e8ce9dd0bd8d-source-focused-b5640e11-7e77-4477-8932-ae4c47b67471`
in the external `core-workers-release` diagnostics. All disposable outputs were
retired. A following full-gate attempt (`afd9edd0-bda9-4ad3-9bd0-8f9dd53e4ed6`)
was deliberately interrupted during typecheck, before any full inventory ran,
to correct the JobsWorkspace guide's nonexistent `@zero/framework/frontend`
subpath to the actual public `@zero/framework` export. Its interrupted result
is not a typecheck failure diagnosis or a completed baseline; its owned outputs
were also retired before the next freeze.

### Completed foundation sweep and targeted failure investigation (November 16)

The frozen `93fce89ac2fb74939a0312a7eb9ee34933d1f0f4` source sweep completed
all **1,476 files: 1,467 passed, nine failed or timed out, zero unrun, no
inventory interruption**. This is a completed **failed** baseline, not a release
pass. Root types, package contracts and PDF installation/status passed before
the sweep; later build/audit/final-documentation stages did not run in that
driver after the failed sweep. Original receipts remain unchanged under
`93fce89ac2fb74939a0312a7eb9ee34933d1f0f4-source-gates-f556a5c5-b9bc-4425-9db0-395644f2f34d`
in the external `core-workers-release` diagnostics. Its temporary dependencies,
private SDK snapshot, processes and synthetic outer fixture were retired.

The failures have separate dispositions, not one presumed runtime cause:

- Two static guards had not admitted the deliberately additive jobs/workers
  facade. The frontend guard now asserts the exact eleven jobs and two workflow
  export declarations while preserving the original ordered contract digest.
  Its type/alias check requests the same facade diagnostics directly instead of
  checking the entire unrelated program before filtering them. The machine
  projection guard now explicitly requires both new capabilities to remain null.
- Four installed consumers (messaging, profile settings, tooltip and mail)
  exceeded their existing phase or outer deadlines. Their soft-termination-only
  child helpers and interrupted teardown did not establish prompt retirement.
  The replacement test helpers retain Bun, compiler arguments, assertions,
  consumer strings and all existing test/phase deadlines. They add bounded
  process-group retirement/output, whole-root ownership/pin checks, body/startup
  settlement fences and immediate owned dependency cleanup. They do not replace
  a compiler timeout with a permitted failure. Their focused reruns are still
  required; this paragraph is an implementation record, not their pass result.
- The app-function cases returned database-unavailable on Beta's first physical
  file acquisition/write; hot admission returned a non-JSON initial seed error
  before its busy-auth cycles. Bounded native event diagnostics were added to
  those test files without changing requests, policy, production settings or
  deadlines. Neither original error code was captured, so its cause is not
  retrospectively asserted from a later pass.
- The installed automation/Torrent consumer crossed a recorded 1%-battery
  low-power hibernation (03:16:57–03:34:38 local time) and its watchdog retired
  the child. This was a managed gateway/runtime phase, not a TypeScript phase.
  The interrupted result remains failed; the successful rerun is separate.

A controlled comparison reconstructed the failed messaging consumer with its
exact retained archive, manifest, lock and TypeScript settings. Both existing
Bun 1.4.4 and Node using the same installed TypeScript 5.9.3 passed, in 61.359s
and 61.310s respectively, under the original 180s compiler budget. The ordered
pair is not a cold-cache benchmark and does not establish the old timeout's
cause. No engine substitution is justified. Diagnostic inputs/outputs were
owned and retired, retaining only bounded evidence and copied small inputs in
`93fce89ac2fb74939a0312a7eb9ee34933d1f0f4-messaging-types-e6d02e8c-8913-49f0-82ed-ed9dd5efa507`.

At `05fd85a849f01eceb721971e06f19754f43b23f2`, a fresh frozen installation and
root typecheck preceded a canonical sequential focused group. All five files
passed: frontend exports (8.419s), app functions (24.899s; both cases, 80
assertions), populated hot auth/audit (285.774s; 153 assertions), installed
automation/Torrent (49.856s including retirement; 13 assertions) and request
projection (0.317s; 48 assertions). The hot case retains the original <2s
foreground auth assertions, all 20,267 committed audit events and zero failed or
pending audit work. Its entire backlog/recovery duration is not login latency.
The app-function authority fence still rejects the revoked source. These passes
do not erase the unexplained original native failures. The focused report
`05fd85a849f01eceb721971e06f19754f43b23f2-source-focused-group-3b21d9f8-9bfd-4d83-8cca-de90dd027555`
records `focused-only-not-release-gate` and no retained disposable resources.

The production candidate remains unchanged since `bc396a9`; subsequent changes
are test/documentation corrections. Final source qualification, the exact
installed archive/browser/Linux matrix and the normal updater are still required.
No release-owner test/documentation-only finalization exception has been granted
for this candidate. Normal selected main remains 2.10.5; calendars, backups and
application/production changes remain out of scope.

The replacement consumer fixtures were then committed at
`7a2f4159a7ac2b583b002e9ae6632794f628684e`. A fresh frozen installation and root
typecheck passed, followed by all four canonical installed-consumer files:
messaging 116.674s, profile settings 120.031s, tooltip 111.822s and mail 92.897s,
including their owned cleanup. Profile's browser/server build, complete installed
TypeScript program and SSR phase took 71.076s within its unchanged 90s child
budget. Messaging's installed TypeScript phase took 62.966s within its unchanged
180s budget. Mail exercised the actual synthetic SMTP/IMAP send/receive path;
no external provider was called. All four reported confirmed process/fixture
retirement. The outer report
`7a2f4159a7ac2b583b002e9ae6632794f628684e-source-focused-group-c0e3fc43-9ead-43e1-bc7e-bbfe723eb392`
records `focused-checks-passed`, no retained disposable resources and
`releaseQualified:false`. Both feature remotes contain this checkpoint.
The separately retained original messaging timeout fixture was also retired
after its complete input/content/identity provenance was established; a new
small sibling receipt preserves that cleanup without altering either original
failed baseline or compiler diagnostic. No runtime fix is inferred from the
later passing consumers. The final complete source gate and exact archive
deployment/updater gates remain outstanding.

The following `f4b4d20` attempt passed its fresh types and all three preliminary
regressions (Guardian examples, AI inference and real handoff recovery). It was
deliberately retired during `test:package`, before a full inventory ran, after
review found a new mail-test portability regression: its replacement cleanup
helper had inherited the other consumers' Mac-only scratch path and `lsof`
requirement. This is not a new native mail/auth failure or a completed full gate.
Its owned outputs retired with no retained exceptions.

Mail alone now preserves Linux's configurable `PROJECT_SCRATCH_DIR`/temporary
root, while keeping the Mac's external-only allocation and `lsof` proof.
Linux retains the same settled body/child groups/server callbacks and checks
its own file descriptors through `/proc/self/fd`, failing on missing/unreadable
proof or an owned open descriptor. This is owned-process/server/self-FD proof,
not a whole-machine `lsof` equivalent. No compiler, assertion or deadline changed.
The exact helper (`05ebf811fd69e8431b0de650cb9b6a9d8392a8ff8087db3420e066875543ea8d`)
passed six native Linux/arm64 cases with Bun 1.4.4 and `lsof` absent: empty and
closed-owned acceptance, open-owned rejection, unrelated-FD tolerance, and
deleted-owned rejection until close. The container was read-only, networkless
and privately labelled. The helper-only driver nevertheless reports **failed**
because VZ retained host filesystem-cache descriptors after container retirement.
The operator then stopped only the dedicated Colima profile, verified no open
handles, and retired that exact marked host fixture. Original evidence remains
unchanged; the small `mail-fixture-linux-7ec18136-6865-400e-ad1b-6bbca60668a7-retirement.json`
companion records this separate successful retirement. There are no remaining
probe containers/fixtures. These helper checks do not qualify the mail service
or replace final package/Linux/updater gates.

The next frozen candidate requires a fresh complete source sweep and exact final
installed archive/browser/Linux/updater checks. Main, tags and normal archive
selection remain unchanged until those gates and final review finish. Calendar
backend work, backup implementation, app migrations and production remain out
of scope.

### Complete final sweep and isolated Select investigation (November 16)

The next frozen source candidate, `2d7482055d44b1185546a1060a491b494b9762ca`,
completed all **1,476 files: 1,475 passed, one failed, zero unrun, no inventory
interruption**. Fresh root/payments installations, root types, package contracts
and PDF install/status passed. All nine files from the preceding failed baseline
passed in this complete inventory. The original failed results remain unchanged;
later passes do not establish the unrecorded original native failure causes.

The sole failure is the first light-mode case in
`src/components/controls/select/select-morph.browser.test.ts`: the content
became visible, but its seven-second settled predicate timed out. The other
nine cases in that file passed. The relevant Select implementation, fixture,
overlay code and browser lease helper are unchanged from the earlier completed
baseline where that file passed. This does not establish a harmless failure or
prove that the menu remained mounted/opening: native Radix also dismisses on
window blur or resize, and the old diagnostic did not retain its final DOM state.

The test now records bounded existing-frame counters, resize/focus/blur/visibility
events, safe synthetic geometry/ref/phase observations and page errors if opening
fails. Diagnostic reads are best-effort and bounded; the original exception,
animation calibration, assertions and deadlines are preserved. No new frame,
warm-up, focus override, functional retry or production Select change is added.
Its focused investigation is pending, not claimed as a pass or release approval.

Original complete evidence remains under
`2d7482055d44b1185546a1060a491b494b9762ca-source-gates-089d19ac-884a-4673-b68e-2dd6b1a4c142`
in the external `core-workers-release` diagnostics. The full-gate driver stopped
before build/audit/final-documentation stages after the failed sweep and retired
all its claimed temporary resources (`retained: []`). Main, tags and the normal
2.10.5 updater selection remain unchanged. The release-owner finalization
exception has not been granted; this record does not substitute focused checks
for the required final gate or authorize application changes.
