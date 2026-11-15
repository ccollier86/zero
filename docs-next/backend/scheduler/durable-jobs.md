---
id: zero.scheduler.durable-jobs
type: reference
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: durable-jobs
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

# Durable jobs and schedules

[Scheduler](./index.md) · [Foundation plan](../../_work/durable-jobs-and-workers-plan.md)

The 2.11.0 local source candidate implements managed configuration, Guardian
admission, private Fabric storage, pinned Torrent handoffs, HTTP/SDK contracts,
live reads, semantic audit and the native
[operator workspace](../../frontend/jobs-workspace.md). These are current source
APIs, not proposed contracts. Final exact installed-archive/Linux qualification
and normal updater selection remain pending. No published release or deployment
approval is implied by source implementation.
Calendar components and the calendar backend remain outside this work.

## Responsibilities

`zero.scheduler` remains the trusted app-local timer registry. `zero.jobs`
accepts durable schedules and one-off jobs. Fabric orders transactions within
each private scope database; independent files can progress concurrently.
Torrent executes the exact admitted workflow version and owns activity retries,
waits, cancellation, recovery and terminal execution state. A jobs handoff does
not wait for an AI/provider call, and a work pool is not a second durable queue.

One managed Bun app and its supervised children is the current topology. This
is not a multi-host leader election or distributed-consensus implementation.

## Configure explicitly

The root `@zero/framework/server` entry exports the durable definition type as
`DurableJobDefinition`. Its existing `JobDefinition` remains the compatible
in-memory timer type. The dedicated `@zero/framework/jobs` entry exports the
durable type as `JobDefinition`; neither type is interchangeable with the other.

```ts
import { defineZeroConfig, defineJob } from '@zero/framework/server';

const report = defineJob({
  name: 'reports.daily',
  version: '1',
  workflow: { name: 'reports.daily', version: 1 },
  access: 'admin',
  parseInput(value) {
    // Validate and return canonical JSON using the application's schema.
    return value;
  },
});

export default defineZeroConfig({
  db: { mode: 'file', path: './data/application.sqlite' },
  auth: true,
  tables: {},
  workflows: {
    register(registry) {
      // Register the corresponding versioned Torrent graph/activities here.
      // Legacy step-array workflows cannot be used as pinned job definitions.
    },
  },
  jobs: { definitions: [report], concurrency: 'max' },
});
```

Omitted/false jobs configuration is inert: no jobs owner schema, private file,
actor, timer or jobs routes are installed. Enabling jobs requires Guardian and
Torrent; explicitly disabled dependencies are not silently overridden. An
omitted auth setting is enabled when jobs is enabled, consistent with other
managed Guardian features. Enabling against retained file-backed SYSTEM state
requires the normal explicit migration preparation; do not manually write its
owner catalog.

The default private root is `data/zero.jobs` under the configuration project
root. Each application/tenant scope gets a separately owned Fabric file. Job
roots cannot overlap application/control files, asset/build output, Storage,
logging, blog or messaging roots. Canonical startup checks also reject aliases.
Jobs actors use the fixed actor entry, not the application entry, and default
to an empty child environment. Bundled/compiled deployment still needs final
package qualification; do not assume source execution proves that deployment.

Official jobs builds use the source Bun CLI (`bun run zero build`, or the
installed source-backed `zero build` command). Its jobs-only build helper captures
canonical migration sources in a fresh, pure-import process with an empty
environment and dotenv disabled; it does not start the app. A compiled Zero CLI
cannot run that source snapshot helper and fails closed. Building a compiled
application from the source CLI is a separate capability; its complete jobs
runtime remains outside the current installed-bundle qualification.

## Definitions, ownership and authority

- A definition is an exact code-registered object or a registered name. Multiple
  explicit definition versions may coexist, with at most one default per name.
  `default` is true when omitted; set it false on retained non-default versions.
  Name-only admission requires an available default. Browser/HTTP clients send
  names, never executable parsers or a caller-selected workflow pin.
  Omitted definition `access` means administrator, not every signed-in user.
- Inputs are detached, bounded canonical JSON (32 KiB). Parsers must be pure,
  synchronous and idempotent: their canonical output must be accepted unchanged
  by the same parser. Admission checks a second normalization, and handoff checks
  the retained canonical input against its registered definition. Version
  parser/policy changes explicitly. Definition fingerprints describe metadata,
  not executable code integrity or proof of equivalent semantics.
- Actor-owned work retains its exact sealed authority. Logout/revocation does
  not silently turn it into SYSTEM work. New handoff requires current actor
  authority, current source eligibility, and the same admitted graph pin.
- Service ownership is a separate optional code policy (`service.principal`,
  allowed scope kinds and synchronous `isEligible`). It must be explicitly
  selected at admission. Eligibility is checked again before a new handoff.
- HTTP/SDK jobs currently support authenticated sessions, not API-key or
  anonymous admission. Native facades take scope from live Guardian, never a
  request body or a user-selected tenant. Unsupported machine/SYSTEM projections
  remain unavailable rather than receiving a raw service escape.
- Owners can inspect/control their own schedules. Native scope administrators
  can inspect/control schedules in their scope; an optional `jobs.manage`
  Guardian requirement can replace that management policy. Administrators may
  stop another actor's work but cannot readmit it as that actor.

Raw inputs, authority seals, claim nonces and actor handles never appear in
public schedule/run views. Trusted setup receives the lifecycle owner; ordinary
handlers receive only the admitted `zero.jobs` facade.

## Operator reads and action discovery

`zero.jobs.definitions.list()` and `client.jobs.definitions.list()` use native
`GET /jobs/definitions`. They return only permitted code registrations: name,
version, default selection and declared actor/service ownership support in the
current scope. They do not expose access policies, callbacks, workflow pins,
inputs or credentials. Reading discovery never runs a parser or dynamic service
eligibility callback. Available metadata is not a promise an arbitrary input or
future workflow handoff will succeed.

List/detail/live pages share `JobScheduleSummary`: the original identity and
control fields plus `nextDueAt`, `skipped`, a closed `blockedCode`,
`latestOccurrence`, `activeOccurrence` and server-owned `actions`.
Each action has `allowed` and a closed unavailable `reason`. Use these advisory
prerequisites rather than guessing permissions from a browser role. Mutations
still validate current authority, revision, definition, inputs and eligibility.
In particular, administrators can stop another actor's schedule but cannot
resume/update it as that actor; run-now is a new admission by the initiator.

Scheduling control and execution are separate. A paused schedule can retain
older active work. `latestOccurrence` is the latest nominal occurrence;
`activeOccurrence` is one claimed/dispatched representative, preferring the
oldest active generation. It is **not** a total/count or a complete history of
concurrent work. Use paged occurrences for that history. A dispatch receipt is
not proof an AI/provider effect completed or a grant to control its Torrent run.

Summary changes participate in the existing coalesced live page, even when a
schedule's control revision stays unchanged. A nonrepresentative concurrent
occurrence change may leave this bounded summary equal; its actual committed
hint still revalidates, and its history remains inspectable. No full-history
count or scan is needed merely to render each row. Mutation acknowledgments
and permanent receipts remain the original ten-field `JobScheduleView`; they
are not silently rewritten as current summary snapshots.

## Commands and receipts

```ts
// Within an admitted native endpoint, using its request-scoped zero facade:
const accepted = await zero.jobs!.enqueue('reports.daily', { reportId }, {
  idempotencyKey: requestId,
});
const original = await zero.jobs!.receipts.get(requestId);

const scheduled = await zero.jobs!.schedules.create({
  definition: 'reports.daily',
  input: { reportId },
  timing: {
    kind: 'cron', pattern: '0 0 8 * * *', timezone: 'America/New_York',
    misfire: 'latest', maxLatenessMs: 60_000,
  },
  overlap: 'queue-one',
}, { idempotencyKey: anotherRequestId });

await zero.jobs!.schedules.pause(scheduled.id, {
  expectedRevision: scheduled.revision, idempotencyKey: pauseRequestId,
});
```

Every mutation requires the caller's stable idempotency key. Retrying the same
semantic command returns its original accepted receipt, not a second schedule
and not an updated projection. Reusing a key for a different command conflicts.
Read the current schedule separately. Controls require the accepted revision.
Unknown outcomes require reconciliation using the **same** request identity;
neither server nor SDK invents a replacement key or automatically replays an
uncertain external effect.

Browser mutations throw the exported `JobsMutationError` after a dispatched
request fails or returns an unverifiable acknowledgment. It retains the
original `idempotencyKey`, safe `status`/`code`, `outcome`,
`requiresReconciliation` and `requiresSameIdempotencyKey`. Messages are static;
raw response bodies/provider errors are not copied into it. Explicit native
rejections remain `not-started`/`not-committed`; missing responses, malformed
acknowledgments and explicit unknown outcomes remain `unknown`. There is no
automatic retry. Scope/cancellation failures retain the `AbortError` name so
retired views can discard their callbacks, without asserting no write occurred.
Local validation/pre-dispatch cancellation still issues no request.

A null receipt under replacement authority does not prove the old operation
never committed. Keep the same logical identity when reconciling uncertainty;
do not generate another key or blindly repeat an external effect.

`enqueue` and schedule creation return an accepted schedule identity, not AI
output or a completed workflow. Native HTTP uses `/jobs/enqueue`,
`/jobs/receipts/:key`, `/jobs/schedules` and per-schedule inspection/control
routes. Enqueue/create acknowledge with 202. `pause`, `cancel`, `resume`,
`update` and `runNow` are separate controls. Resume/update deliberately readmit
with fresh current authority and a new generation. A cancelled identity cannot
be revived. Resuming an elapsed one-off time is invalid; select a new future
time or explicitly create a new immediate run.

`runNow` creates an independently admitted one-off job from the inspected
schedule under the current initiating authority. It does not
rewrite the original nominal occurrence or impersonate its creator. Pausing or
cancelling scheduling does not claim that already handed-off Torrent work or an
external delivery has been undone. Inspect/control that actual run separately.

## Timing, overlap, capacity and recovery

- Once timing requires a canonical UTC instant. Cron requires an explicit IANA
  timezone and supports `skip`, `latest` and bounded `catch-up` misfire policy.
  Defaults are `misfire: 'latest'`, `maxLatenessMs: 60_000` and
  `catchUpLimit: 10`. Lateness accepts 0–366 days in milliseconds; the catch-up
  limit accepts integers 1–100 and caps the total recovery batch. Excess missed
  occurrences are skipped, not recovered through an unbounded paging loop.
  Repeated fall-back times select the first fold only; nonexistent spring-gap
  times retain Croner's forward shift. Timezone changes are explicit schedule
  updates, never changes inherited from the host clock configuration.
  These are job timings, **not appointment recurrence/RFC 5545 series**.
- `skip` suppresses overlap, `allow` admits independent runs, and `queue-one`
  retains the latest unstarted occurrence while prior work is active. Older
  generations' active work still counts for overlap.
- Due cursors and occurrence intents commit atomically. Claims are fenced by
  nonce/generation/expiry. Stale claims reconcile their exact permanent Torrent
  key first, including after pause/cancel/revocation, before any new dispatch.
- Never-started pending occurrences from paused, cancelled or replaced
  generations retire in bounded batches as `not-dispatched`. They cannot stay
  misleadingly pending or revive on resume. This does not retire an uncertain
  claim or claim that already admitted Torrent work was undone.
- Private receipt reconciliation after revocation is read-only. Public receipt
  reads and fresh execution retain current authorization checks. The actual
  workflow's exact graph identity/fingerprint is verified on reconciliation.
- Indexed SYSTEM wake metadata discovers due scope files. Future/idle scopes
  do not require opening every private actor every second. Dirty-before-write
  publication and generation-fenced wake refresh preserve recovery. Active
  claims/runs still require bounded status reconciliation.
- Due discovery uses indexed wake/id pages. Each free scope slot refills on
  completion rather than waiting for an unrelated slow scope or the next timer.
  Failed roots back off locally even when durable wake publication is fenced;
  bounded discovery continues past those roots to other eligible files.
- Omitted `concurrency` and `concurrency: 'max'` both mean a finite admission
  ceiling of 100; an explicit integer accepts 1–100. This is not unlimited
  providers/processes or a promise every task starts instantly. Per-schedule
  controls/handoff are ordered; unrelated schedules use shared fair capacity.
  SQL/authority leases are not held while waiting on provider work.
- Per-file retained budgets currently stop admission at 10,000 schedules,
  1,000 schedules per owner, 100,000 permanent logical receipts, or 100,000
  occurrences. Capacity exhaustion is visible and does not recycle identities
  or delete receipts. This is not an indefinite high-frequency retention plan.
- Missing established files, changed roots and inconsistent retained ownership
  require explicit recovery, never empty replacement.

## Live reads, logging and remaining qualification

The SDK's `client.jobs` uses the same native routes. Account/scope replacement
retires pending acknowledgments. `schedules.watch()` and `useJobSchedules()`
are backed by coalesced private commit hints plus reauthorized bounded pages,
not fabricated Sync row events. Denial retires the subscription and clears the
hook's visible page. A bounded SSE lifetime forces fresh HTTP admission; it does
not bypass audit delivery or credential checks. Streams contain public views,
not job payloads. The live boundary is implemented; final exact installed-archive
and deployed-browser qualification remain separate from source coverage.

Watch listeners may accept a second `JobWatchUpdate` argument. Its closed
`invalidated` boolean reports an actual admitted source-change hint, not an
INSERT count or evidence of a particular semantic effect. Such a hint can
revalidate selected detail/history even when the visible list page is equal.
Periodic authority rechecks remain quiet when the projection is unchanged.
`useJobSchedules().invalidationRevision` carries these notifications within its
current client/selection boundary; it is not a persistent database sequence.
The browser transport separately supplies optional `reconnected: true` on the
first valid snapshot after replacing a previously published connection.
`useJobSchedules().reconnectRevision` carries these successful re-admissions so
an off-page inspector reconciles changes that may have occurred in the stream
gap. Initial/idle/failed connection attempts are not successful re-admissions;
this notification never changes `invalidated` or claims that a commit occurred.
Both revisions retire with their client/query/authorization boundary and never
retry a command.
No caller receives raw commit hints or another scope's source metadata.

Canonical accepted schedule controls and observed handoff/terminal transitions
join the existing private actor logging outbox **in the source transaction**.
The optional logging preset's `capture.workflow` governs these semantic facts,
independently of generic record capture. Jobs suppress their redundant generic
row-change events; generic capture for other Fabric realms is unchanged.

Events are `jobs.schedule.created`, `.paused`, `.cancelled`, `.readmitted`,
`.blocked`, and `jobs.occurrence.handed-off`, `.blocked`, `.terminal-observed`.
They retain safe schedule/occurrence/workflow identities and closed status,
revision and generation values. Actual source-change sequence identities make
replay duplicate-safe without recycling receipts or adding another audit ledger.
Source rollback/backpressure rolls back the corresponding control or observation
as well; an already accepted external workflow is reconciled, not replayed.

Native HTTP controls establish the actual initiating user attribution in every
enabled capture preset. Background timer/runner observations truthfully identify
the bound system source, not a still-active user session; their `scheduleId`
links back to the initiating control evidence. They do not currently claim a
separate preserved human `initiatorId`. App-owned background services must own
their attribution explicitly, rather than inheriting a retired HTTP lifetime.

Payloads, seals, prompts and raw provider results are excluded. Replays, no-op
controls, idle reads, timer wakes, cursor materialization and claim leases do
not append audit rows. Supervised delivery is awakened for actual semantic
commands; no handler waits on a remote sink while holding its SQL transaction.
An accepted handoff is not a completed workflow, and a completed workflow is
not proof of provider delivery. Final managed/deployed acceptance remains part
of the foundation qualification, not implied by an audit-row append.

Shutdown retires job intake, stops its exact registered timer, drains shared
admission/dispatch, then closes logging sources and Fabric before Torrent and
the underlying providers. Scripts own cleanup of their synthetic files and
temporary dependencies on success/failure. Source checks are not a substitute
for the final frozen archive, real browser UI, Linux lifecycle and updater gates.
