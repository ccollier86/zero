---
id: zero.workers.index
type: reference
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
implementation_state: implemented
visibility: internal
system: workers
feature: task-execution
maturity: preview
applies_to: ["2.11.0 source/local APIs; deployment requires matching artifact provenance and qualification"]
modes: [managed-bun, trusted-standalone]
reviewed_against:
  package: "@zero/framework"
  version: "2.11.0"
  commit: "bc396a957c1e0fb85ac935bfa5b1d6dfdfb8b0b3"
  snapshot: clean
  date: "2026-11-15"
  evidence_level: source-observed
---

# Workers and concurrent execution

[Backend](../index.md) · [Request services](../runtime/server-services.md) ·
[Expansion plan](../../_work/durable-jobs-and-workers-plan.md)

Zero 2.11.0 implements shared execution pools, isolated Bun
task processes and the managed `zero.workers.run()` facade, together with the
optional [durable jobs/schedule facade](../scheduler/durable-jobs.md). Existing
cron and Torrent APIs remain compatible. See [cross-service composition](./service-integration.md)
for the boundaries between admission, provider work and authorized results.
This is a source/local API manual, not a release-status receipt. Match the exact
installed commit/archive checksum, runtime and deployment topology to its
qualification record. A version number or passing source check alone is not
deployment approval.

## Choose the layer

| Need | Surface |
| --- | --- |
| Concurrent asynchronous I/O | Trusted `WorkPool` from `@zero/framework/workers`. |
| Computation off the HTTP event loop | Admitted `zero.workers.run(task, input, options?)` (typed reference), or the compatible name form. |
| Process lifecycle in trusted composition | `ProcessWorkPool` / `WorkerService`, never raw request capabilities. |
| Durable user-owned workflow handoff | `zero.workflows.enqueueOnce(name, input, { idempotencyKey, version? })`. |
| Short database-automation handoff | Existing source-bound `zero.torrent.enqueue(...)`. |
| Local maintenance timer | Existing `zero.scheduler`. |
| Durable one-off/recurring schedules | Optional `zero.jobs`, private Fabric files and exact pinned Torrent handoffs. |

A Promise pool is not CPU isolation or persistence. A subprocess is not an OS
sandbox: registered code retains the application's OS privileges. Never execute
user-supplied code/imports/commands. No queue wait or task may hold SQL/Guardian
commit leases. Durable acceptance and retry policy belong in Torrent/jobs.

Queued callbacks retain their own submitting async context, including an
intentionally empty background context; refill cannot borrow the preceding
caller's audit frame. This does not extend authority: if the callback's own
request/audit lifetime has retired, its native checks still fail closed. Use a
durable admitted handoff for work that must outlive the initiating request.

The source-reviewed `feature/core-foundation-polish` follow-up also preserves
submitter context for synchronous abort listeners, foreign cancellation/close
and execution deadlines created during refill. It eagerly rejects startup
deadlines outside the portable 1–2,147,483,647 ms range at configuration
admission. These corrections are **not in the selected 2.11.0 archive**; consult
the [review and qualification record](../../_work/durable-jobs-and-workers-plan.md#post-release-review-boundary)
before relying on a newer package. Cancellation still retains physical capacity
until the actual callback/process settles, and a retired audit frame stays retired.

## Fixed task catalog

Example side-effect-free `server/worker-tasks.ts`, shared by parent and child:

```ts
import { defineWorkerTask } from '@zero/framework/workers/tasks';

export const totalTask = defineWorkerTask({
  name: 'reports.total', version: '1', access: 'admin',
  parseInput(value) {
    if (!Array.isArray(value) || value.some(n => typeof n !== 'number')) {
      throw new Error('Expected numbers');
    }
    return value as number[];
  },
  parseOutput(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite total');
    return value;
  },
  run: values => values.reduce((sum, value) => sum + value, 0),
});
export const workerTasks = [totalTask];
```

Parsers are pure synchronous JSON-to-JSON validators/normalizers. Their canonical
results must be accepted unchanged by the same parser; Zero checks a second
normalization and rejects noncanonical contracts. Do not use one-way or
effectful transformations. The actual task handler runs once, not once per
validation. Names are unique, 1–96 portable characters starting
with a letter; versions are explicit 1–64 portable characters. Change the version
when handler/validation semantics change. Catalog comparison uses sorted
names/versions, not `function.toString()`; it is not executable-integrity proof.
Deploy the matching catalog and worker entry with the app.

Both directions validate/detach JSON: maximum 1 MiB, 10,000 nodes and depth 24,
plus the inherited bounded IPC envelope. Reject getters, proxies, cycles,
nonfinite numbers, special prototype keys, dates, binary/service handles and
code. Private Storage references require a separately authorized adapter; a
worker does not automatically acquire Storage or the complete Zero service bag.

## Child entry and configuration

Dedicated `server/worker-entry.ts` must not import/boot the app:

```ts
import { runWorkerIfRequested } from '@zero/framework/workers/actor';
import { workerTasks } from './worker-tasks';
try {
  if (!await runWorkerIfRequested({ tasks: workerTasks })) process.exitCode = 64;
} catch { process.exitCode = 70; }
```

Normal `createApp`/`defineZeroConfig` fragment:

```ts
workers: {
  tasks: workerTasks,
  launch: { kind: 'source', entrypoint: './server/worker-entry.ts' },
  processes: 'max', env: {},
},
```

Relative source/bundle entries resolve against `projectRoot`. Source launch adds
`--no-env-file`; a compiled Bun executable uses an owned empty private launch
directory. Reviewed fixed command-prefix launch is also supported. The complete
child environment is only `env`, empty by default; never spread `process.env`.
Ship the entry/catalog and qualify the application's bundle/source parity.

Omitted/`false` is disabled. Explicit configuration requires Guardian (omitted
auth selects its defaults; explicit `auth:false` is rejected). Configuration is
validated before resources open. Children start lazily and are reused. The
managed runtime owns shutdown and failed-start cleanup.

In an admitted native endpoint or actor-bound workflow activity:

```ts
if (!zero.workers) throw new Error('Workers unavailable in this context');
const total: number = await zero.workers.run(totalTask, [12, 25, 8]);
```

Import `totalTask` from the same side-effect-free catalog registered in `workers.tasks`.
The reference form infers input and output; `WorkerTaskInput`/`WorkerTaskOutput`
are exported from `@zero/framework/workers` and `@zero/framework/workers/tasks`.
A same-name/version task from another catalog is not a substitute: Zero checks
the exact registered reference before running its
parsers. Passing a string remains compatible but returns `unknown` and still
uses the registered validators and access requirement. Do not import the child
entry into parent request code; it is an executable bootstrap, not a catalog.

The facade closes over current actor/scope, checks the task's access and derives
an opaque fairness key. It rechecks authority after queue waits, before dispatch
and before returning results. It exposes no environment, path, process handles,
tenant selector, registration or shutdown. Default task access is administrator.
Anonymous/uncommitted and API-key contexts currently receive null. SYSTEM
workflows need an explicit reviewed adapter, not impersonated user authority.

## Pools, deadlines and outcomes

`WorkPool` defaults `concurrency` to `max` within `maxConcurrency` (100 by
default; configurable 1–10,000). An explicit concurrency accepts 1 through that
ceiling. It supports `maxQueued` (100; configurable 0–100,000),
`maxQueuedPerKey` (defaults to `maxQueued`), `maxConcurrentPerKey` (defaults to
pool capacity), queue/execution deadlines (neither enabled by default) and
`shutdownGraceMs` (10,000). Queued keys rotate fairly. `maxQueued:0`
admits only immediately runnable work. A fairness key is not a tenant capability.
The total waiting budget is global. Set `maxQueuedPerKey` below that budget to
prevent one key from occupying all waiting slots. Round-robin ordering and this
limit do not reserve execution slots or guarantee admission for every tenant.
Blocked keys cannot strand an otherwise usable execution slot. The standalone
default preserves existing messaging behavior, including 100 waiting calls.

`ProcessWorkPool` defaults `processes` to `max` = min(4, available CPUs), explicitly
configurable 1–64. CPU process count is separate from the I/O concurrency default.
Options include `maxQueued` (100), `maxQueuedPerKey` (min(25, `maxQueued`)),
`maxConcurrentPerKey` (process capacity), `queueTimeoutMs`, `executionTimeoutMs` (30,000),
`startupTimeoutMs` (5,000) and `shutdownGraceMs` (10,000). Queue waiting has no
default timeout. One process executes one task; independent processes overlap.
Quarantined processes still occupy capacity.
Managed keys are current-scope keys derived by Zero, not caller-supplied tenant
IDs or per-user quotas. One scope can use every free process by default.

Run options: `signal`, `queueTimeoutMs`, `executionTimeoutMs`. Queue expiry is
not-started; execution timeout/worker death may be unknown. Native caller
cancellation returns `WORKER_CANCELLED` (HTTP 409): `not-started` before task
dispatch and `unknown` after dispatch. The latter requires reconciliation of any
external effect; cancellation does not prove rollback. A cancelled Promise
callback occupies its slot until it really settles. Isolated CPU generations
can be terminated using the existing transport's bounded shutdown/SIGTERM/
SIGKILL and observed-exit protocol. Disconnect alone is not settlement. Never
delete child launch contents recursively or claim failed drain succeeded.

Native request workers inherit the request signal. Native legacy and graph
workflow activities (including interaction validators) inherit their physical
attempt's signal automatically; an explicitly supplied run signal is combined
with it. Cancel, pause or runtime shutdown can therefore retire that attempt's
worker without every handler remembering `{ signal: context.signal }`.
This signal carries lifetime only, not actor identity or permission. Existing
current-authority checks still run before dispatch and before returning results.

The task executor allows 1,000 ms each for graceful acknowledgment and exit,
then 500 ms for SIGTERM and 1,000 ms for observed SIGKILL settlement. A delayed
graceful acknowledgment may require termination; cleanup reconciles an already
observed exit and retries the transport's private-directory release once. It
does not replay the task or free an unconfirmed physical slot.

Sanitized native errors preserve `WorkerError.code`/`outcome`, not raw child
exceptions. Only not-started capacity/queue rejection is advertised retryable.
No automatic task retry occurs. Use Torrent with deliberate downstream
idempotency/reconciliation for external effects. Workers alone have no durable
job receipt or automatic source-transaction semantic audit append.

## Operation and cleanup

`await pool.close()` rejects queued work, interrupts active processes and waits
for observed settlement. An unresolved process remains counted/quarantined;
failed close can be explicitly retried. An idle child that exits is reconciled
before its physical slot is reused. Never treat a rejected Promise or IPC
disconnect as proof that a CPU-heavy child has stopped.

If a reused idle generation dies during its catalog handshake, Zero may replace
that generation once after observed retirement and another authority check.
Only the pre-dispatch handshake is repeated: no task was sent. A dispatched task,
contract/version mismatch, initial startup failure, cancellation or shutdown is
not automatically retried through this path.

Use a production supervisor/container with child-process containment: request
graceful shutdown from the parent, then contain surviving children at the final
forced-stop deadline. Actors are detached from the parent's terminal process
group; a signal to that group alone is not containment. Ordinary
graceful shutdown, task timeout and observed child exit are covered in source
tests. A bounded Linux/x64 emulated diagnostic also passed CPU-bound child
containment after parent SIGKILL with an explicit 15-second startup budget.
That diagnostic is distinct from the production 5,000 ms startup default and
does not qualify every native/default-budget deployment.
JavaScript `finally` cannot run after SIGKILL. Do not claim
this library alone prevents OS-level orphans after forcible parent death; the
Linux deployment/restart qualification must verify the actual supervisor.

Doctor checks declared source/bundle entry existence and reports fixed-wrapper
review plus the explicit-environment contract without launching code or reading
secret values. A passing existence check is not a worker readiness certificate.
See [Doctor](../../cli/doctor/index.md).
Its source-only background check also warns about a directly awaited eager
Torrent handoff inside an owned durable database function, or a directly
discarded enqueue receipt. It does not infer arbitrary aliases, evaluate code,
rewrite handlers, or certify a source lane free of slow work. Use the matching
`enqueue`/`enqueueEvent` only when commit acknowledgment is the intended boundary.

## Qualification

Focused source tests cover real child reuse, CPU/event-loop separation,
independent processes, explicit environment, catalog mismatch, safe values,
handler failure, process death, hard timeout, pool fairness and teardown. A real
managed createApp/Guardian HTTP fixture verifies `zero.workers`, administrator
admission and member/anonymous denial. Fixtures clean owned state after closure.
An additional real managed native-auth/Torrent fixture holds a local SDK-mock AI
call, completes two independent worker-backed workflows and a data write before
releasing it, and verifies inherited cancellation for both engine formats.
Raw app-global AI remains deliberately unavailable in the sealed workflow
service bag; this fixture uses an explicit trusted fixed-model adapter with
authority checks, not a new unscoped AI escape hatch.

The source fixtures also exercise the queued actor HTTP/SDK path, current-scope
retirement, result revocation, Doctor and minified bundle catalog parity. Owned synthetic
fixture allocation registers exact markers and cleans state in `finally` after
all owned handles close. No provider traffic is used.
The deliberately unresponsive fixture has its own ten-second exit fuse; it
cannot spin forever if the creating test runner is forcibly killed. Normal
tests still require the parent to terminate that generation much earlier.

The [foundation record](../../_work/durable-jobs-and-workers-plan.md) keeps exact
commit/archive receipts and source, installed-app, Linux and diagnostic evidence
separate. Check the receipt matching the artifact and topology you intend to
run; worker-process evidence does not automatically qualify a compiled jobs
application. Source tests alone do not approve a deployed app.

Maintainer checks (run the required storage preflight first):
`TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file scripts/qualify-worker-foundation.ts`
owns a new frozen dependency installation, runs the focused worker/jobs/local-cron
and compatibility group plus strict types, and removes that installation in
`finally`. The TypeScript compiler runs directly under Bun rather than falling
through a Node shebang. Its ten-minute diagnostic bound accommodates a loaded
external development drive; it does not change a production task/claim timeout.
The script refuses an
existing `node_modules` instead of borrowing or replacing it. The package test
independently installs a temporary archive and exercises public task/pool/actor
entries plus a minified child without app boot. These are focused checks, not
a substitute for the repository's complete release gate.

`scripts/qualify-worker-linux.ts` targets only the exact external local
`colima-zero-workers` context. It owns labelled disposable containers and a
marker-owned synthetic root, checks source/compiled workers and supervised
parent death, and retires its containers/dependencies/builds before removing
the root. It never changes the active Docker context, main branch, saved release
or application databases. Linux results must be recorded separately before
claiming that deployment boundary passes. Run storage checks first and use the
approved external `TMPDIR`; starting/stopping the local VM is an operator action.
