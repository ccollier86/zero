---
id: zero.scheduler.source-owned-jobs
type: reference
audience: [developer, agent, maintainer]
owner: scheduler
status: draft
visibility: internal
system: scheduler
feature: source-owned-jobs
maturity: experimental
---

# Source-owned Jobs: native integration boundary

[Scheduler](./index.md) · [Durable Jobs](./durable-jobs.md) · [Calendar plan](../../_work/calendar-integration-plan.md)

This is implemented feature-branch source, not a selected release archive or a
public application SDK. It adds a native source ownership/control family to the
existing Jobs service, runner and Torrent handoff. It does **not** enable calendar
reminders, recurring appointments, provider sends or a second scheduling engine.
The [calendar qualification record](../calendar/qualification.md) distinguishes
memory evidence from physical process/deployment qualification.

## Ownership, definitions and authority

An actor-created schedule still belongs to that actor even when its execution
uses an explicit `service` policy. Source-owned scheduling is different: the
native service owns the work independently of the initiating person's session.
Its schedule has no fabricated user, session principal or `updated_by` user.
Optional `initiatedBy` is factual, private provenance, never authority.

`defineJob` now accepts `origin: 'request' | 'source' | 'both'`, defaulting to
`request`. Existing default/request definition fingerprints are unchanged.
Explicit source/both declarations enter the fingerprint. Source-only definitions
are absent from request discovery and cannot be invoked through ordinary request
admission, including by an administrator. Human operator reads/controls exclude
source-owned schedules; `manageAll` does not imply authority to impersonate a
native source. Existing HTTP/SDK request contracts otherwise remain unchanged.

Native composition mints an opaque, process-local `TrustedJobSource`. It binds:

- Domain, established database ID, permanent physical owner, canonical root hash
  and service scope. A registry identity is not itself proof of those facts.
- Current realm fingerprint, explicit policy version and parser/eligibility
  semantics version, one registered Jobs definition and one exact Torrent pin.
- Trusted owner/current-policy checks and an owner/runtime lifetime signal.
  Policy retirement is separate so historical evidence can still be reconciled.

The installing native service must first verify its established owner/root/realm
and scope, and keep those checks current. JSON, cloned tokens and guessed IDs
cannot mint authority. This internal capability is deliberately absent from
public barrels, HTTP, request and activity projections. Do not construct it in an
application handler or replace native owner checks with constant callbacks.
Callback bodies are not hashed; changing parser or eligibility semantics requires
an explicit version change. A matching metadata hash is not executable integrity.

## Durable registry and control

The Jobs file retains a stable source identity, immutable policy generations and
permanent command receipts. Native registration uses expected-revision CAS.
Changing A → B → A, or retiring and reactivating A, creates a new generation even
when the final policy hash equals an earlier hash. A new command key with stale
CAS fails, including a semantic no-op. Exact original command replay instead
returns its original durable result.

The private `JobsService.forSource` surface supports:

- Registration get/activate/retire. Activation takes a canonical representative
  `pinInput` to validate the fixed workflow pin, not to execute it.
- Owner-only `registration.reconcile(originalKey, { signal })` and
  `schedules.reconcileCreate(originalCreateKey, { signal })` settlement barriers.
  They join the same source/schedule mutation gate, then read existing evidence
  without running parsers, eligibility or a writer. A returned null describes
  settlement at that barrier, not absence against future or pre-gate writers;
  native intake must first be quiesced. Cancelling/rejecting the barrier proves
  nothing about its original mutation. Create reconciliation rejects receipt
  families from cancel, replace or registration operations.
- One-off schedule create, exact-revision replace/supersede and monotone cancel.
  Cron/source recurrence is deliberately rejected by this first integration.
- Current schedule inspection and original command-receipt reconciliation, even
  after retirement or cancellation. Evidence reads do not run current parsers.
- Private `capacity.get()` returns explicit **version 3** working, retained-history
  and native transport-settlement accounting. It verifies the existing owner and
  current bound capacity policy on the same retained lease; aggregate usage uses
  fixed primary-key lookups, not history scans. Missing existing Jobs storage
  returns `null`, not an invented empty/provisioned database. Registration
  presence is not proof that a source is currently eligible or active. No seal,
  executable contract, scheduling input or other source identity is exposed.
- Bounded original occurrence execution evidence: `executions.get` proves the
  exact MAC-sealed Torrent start key, including before Jobs' dispatch
  acknowledgment. It returns safe IDs/pin/hash/status, never authority seals or
  input. A different native start with the same principal/pin/input is not proof.

Private source create/replace can also supply `expectedRegistration`. Original
receipt replay precedes that fence; new admission must match its exact active
ID/generation/revision/policy hash after waits and retain the same live binding
at the final writer edge. This prevents delayed old work acquiring a newer epoch.
See the [private calendar protocol](../calendar/integrations.md) for a concrete
observation-only consumer, not an activated application adapter.

### Bounded recovery headroom

The next branch-source pass keeps the existing 100,000 ordinary receipt budget
and adds a **separate 21,024-receipt native source recovery allowance**:
10,000 retained schedules + 10,000 source policy generations + 1,024 sources.
Only source cancellation and retirement use that allowance. Registration,
creation and readmission still use the ordinary budget; request-oriented Jobs
contracts do not gain source control authority.

An ordinary-capacity refusal must not by itself prevent a new cancel/retire
receipt. Original-key lookup still happens first in the same immutable receipt
namespace, with unchanged IDs, intent digests, results and scope/owner fences.
Replays spend neither budget. Historic controls charged to the old shared
counter remain there; they are not relabelled, recounted or refunded. New
recovery receipts use their own additive usage key in the existing accounting
table. No migration closure, declaration map or historical evidence is changed.
Registering the new private query does change the Jobs realm declaration
fingerprint. Existing retained metadata still requires the normal explicit
upgrade permission; this does not bypass `migrate:false` or repair a missing
established file. Physical installed-file adoption remains a qualification gate.

This allowance is finite headroom, **not unlimited emergency admission or a
sustainable archive/retention solution**. If it also fills, new controls fail
closed while existing receipt reconciliation remains available. Capacity reads
are observations, not reservations. Native operators must expose pressure and
unsettled work; never delete receipts, rotate identities or blindly replay an
unknown effect to make capacity appear available.

Activation replay alone never reinstalls a retired/superseded generation.
Source controls and the existing runner share the same per-schedule gate.
Retirement quiesces live dispatch at writer admission and fences an activation
already awaiting its own writer/acknowledgment. A pre-aborted or invalid control
does not quiesce healthy work. Provisional retirement fences are tied to the
target CAS epoch and honor cancellation; an old retirement receipt retry cannot
fence a newer activation while its prior binding is quiesced. A proven rejected
activation may restore its prior live binding; an unknown write stays quiesced
until reconciled. Retirement preflight reads the original receipt and durable
current revision before fencing, so an obsolete CAS cannot poison a newer
registration which already committed but is still awaiting acknowledgment.
In-flight activation tracking is
bounded and removed on settlement; retired source history is durable in Jobs,
not an ever-growing process-local retirement cache.

Existing-only reads do not provision an owner/file. After activation, schedule
and stop controls use existing-only writes. Missing established storage is a
state failure, not an opportunity to create an empty replacement. Only a new
registration may establish a previously unowned Jobs scope normally. An orphan
file or malformed retained owner is rejected rather than treated as absence.
Each existing-only read lease also verifies the file's immutable Jobs owner ID
and scope against SYSTEM, with a read-only primary-key lookup on that same lease.
The proof is not cached across later acquisitions or actor eviction. A missing
or mismatched private owner never triggers owner binding or repair during a read.

## Handoff and recovery

The original one-off due instant is immutable. A delayed admission within its
maximum lateness retains that instant; an expired new admission is rejected.
Retry time never becomes a replacement due time. Claim and final handoff enforce
both not-before and expiry, including clock rollback after materialization or
during an enqueue wait. An early uncertain claim still reconciles first and
remains recoverable; it is not falsely labelled retired.

The runner opens the original sealed authority and inspects the exact permanent
Torrent start key **before** evaluating new-dispatch eligibility. If Torrent
already accepted the start, Jobs records that original receipt even if the source
has since retired. A lost acknowledgment or expired claim never authorizes a new
logical identity. Fresh handoff requires the durable current source epoch, a
hydrated native capability, current owner/policy checks and the exact registered
definition/workflow pin. Torrent repeats the synchronous final fence.

An active durable source which is not hydrated after restart is `JOBS_NOT_READY`,
not permanent retirement. It retries through existing bounded runner backoff.
A not-ready claim is shortened to at most one second without dropping its
uncertain state or original start key; hydration does not impose the normal
60-second handoff lease. The next attempt still reconciles Torrent first.
A proved retired or superseded epoch cannot start new work. Closing Jobs stops
source intake before draining the runner, pool and private runtime.

Accepted/replayed means the Jobs command and receipt committed; it does not mean
workflow completion, provider acceptance, delivery, or human attention. Active
pool cancellation can settle before the physical writer does. The source mutation
gate therefore preserves `JOBS_OUTCOME_UNKNOWN` once a write may have started;
known completed transaction rejections keep their not-committed result. Reconcile
the original key. Do not automatically replay unknown work with a new key.

## Capacity, evidence and upgrade

Source work shares retained Jobs budgets: 10,000 schedules, 100,000 ordinary
command receipts and 100,000 occurrences per private file. A source's former
1,000-schedule ceiling now bounds **working** schedules, not lifetime history.
Each file admits at most 1,024 source identities
and 10,000 policy generations. Live sources, concurrent native activation
preparation and concurrent retirement preparation are each bounded to 1,024 per
broker. Exhaustion fails visibly; no
evidence is silently pruned and scopes are not rotated to evade limits.

The additive `003` working projection preserves every original schedule,
admission, occurrence, receipt and historical usage counter. A schedule releases
its working slot only when its cursor has no further due work **and** every
generation's unresolved occurrence count is zero. Pending, claimed, dispatched
and blocked/review work remain occupied. Cancellation, source retirement or a
missing receipt alone does not prove closure. Readmitting a closed schedule
reacquires quota atomically; duplicate terminal observation cannot release twice.
Working file ceilings are 10,000 schedules and 100,000 occurrences, including
actor and source schedules together. Actor-specific retained owner quotas are
unchanged in this increment. These are logical work facts, not physical handler
drain or provider-delivery certificates.

The native capacity projection is deliberately versioned rather than silently
changing the old fields' meaning:

```ts
{
  version: 3,
  source: { id, registered },
  working: { sourceSchedules, fileSchedules, fileOccurrences },
  retained: {
    sourceSchedules: { used }, // factual lifetime count, no fictitious limit
    file: { schedules, intents, actorRecoveryIntents, sourceRecoveryIntents, occurrences,
            sources, sourcePolicies }
  },
  transport: {
    policyFingerprint, permanentKeys, keyLimit, hardKeyLimit, settlementUnits,
    ordinaryRemaining, settlementRemaining, deficit,
    actorControlUnits, sourceControlUnits,
    retainedResults, expiredTombstones, retainedResultBytes, retainedByteLimit
  }
}
```

Budget entries have `{used, limit, remaining}`. The unbounded-in-principle source
history measurement has only `used`; the existing file history budgets remain
finite and enforced. Working closure does not decrement those history counters.
This permits more than 1,000 sequential closed one-shots on the same source,
not unlimited retained disk usage. Version 2 was the prior branch-only row
projection; version 3 composes those facts with the actual writer's receipt store
and current policy. It does not fabricate transport counts from domain rows.

Additive `004` derives settlement memberships without altering the original
`001`–`003` closures, counters, receipts or identities. Pending/claimed/blocked
occurrences owe two transport units; dispatched owes one, terminal/cancelled
owes zero. Active/paused occupied actor schedules owe two/one control units;
occupied source schedules and active sources owe one each. Every generation
counts. The actual native writer conserves permanent transport keys plus these
obligations inside the domain/receipt/final-authority transaction. Fresh ordinary
claims, defers and retries cannot spend settlement reserve. Pressure permits only
fixed native factual/control commands whose accepted transaction reduces the
obligation; failed/no-op retries do not consume reserved keys. Exact-key replay
still precedes new-key admission.

The native runner checks the original sealed Torrent handoff before buying a new
claim. Accepted original evidence may settle after lease expiry with exact claim
CAS; it cannot authorize enqueue. Missing evidence remains unknown, not rollback.
Legacy policy deficits freeze ordinary admission and remain visible. Genuine
settlement may only preserve/reduce those deficits and cannot bypass the hard
physical key ceiling. An already hard-full file cannot mint another key merely
because its logical obligations shrink. Result compaction does not erase
permanent identity tombstones. Larger bounded resident-owner hydration and real
file/actor qualification remain Calendar production gates.

Canonical schedule changes use the existing native logging source/outbox. Events
distinguish source/policy generation and factual initiation without impersonating
a human or copying private input, root paths, seals or provider responses. Claims,
lease renewal and polling do not generate semantic audit noise.

Additive Jobs migration `002` preserves historical `001`, legacy normalized
admission digests, sealed authority, receipts and existing indexes/triggers. It
rebuilds the affected FK graph inside the managed transaction with FK enforcement
continuously enabled. Staging stays inside the same private Fabric file, never
the host-default SQLite TEMP directory, and is removed within that transaction,
not retained as a backup chain. Unexpected incoming FKs, inconsistent history or late migration
errors fail and roll back rather than dropping unknown relationships. Use normal
managed migration preparation; never rewrite old migration ledgers manually.

## Remaining calendar integration gates

### Native idle attachment and physical shutdown

The private `SourceJobs.hydration` surface now separates resident capability
attachment from durable registration. `attach` requires the original accepted
activation key, exact current active registration and compiled pin. It performs
read-only evidence checks and publishes only that proven existing binding; a
missing receipt never falls back to registration. `tryDetach` compares the exact
capability and refuses while source callbacks or dispatch permits remain
physically pinned. It changes neither durable source state nor historical
evidence authority. The global 1,024 resident-source ceiling remains finite.

Queued and running source bodies retain physical pins through their actual
`finally` blocks, not merely until a caller times out. A prepared dispatch permit
is single-use and remains pinned through the real native enqueue callback.
Final Jobs close seals new source admission, abandons only never-invoked permits,
and joins pre-gate owner confirmations/evidence reads before closing SQL. Earlier
quiesce/drain deliberately keeps evidence available for dependent Torrent work.
There is no timeout that fabricates physical settlement.

The native `JobsService.tryDetachSources(handles, expectedSourceIds?)` releases an entire
minted-handle set atomically. It validates all owner guards, then every physical
pin and exact current capability, before the no-callback/no-await removal phase.
Absent bindings succeed; a live replacement outside the supplied set or any
busy source refuses the entire operation. Fabricated/foreign/accessor/proxy
handles are not an administrative detach capability. Selected and prior native
handles for one source can be supplied together. Individual `tryDetach()` uses
the same path. This changes residency only, not registration, retirement,
receipts, epochs, working capacity, settlement reserve or evidence lifetime.

The optional expected IDs are refusal predicates only: any still-live unknown
binding or physical activity for an ID prevents release. Naming an ID does not
grant a capability to detach it.

The private native Calendar composition now binds a construction-only source
hydrator before Jobs start/tick. The runner still inspects original Torrent
evidence first, proves native dispatch admission before the callback and proves
it again afterward. A callback cannot substitute registration or confer
authority. Missing, retired or presently unselected local capability remains
recoverable not-ready unless the durable source actually retired.

Registration, retirement, read-only attachment and registration-evidence barriers
use an independent bounded source-control pool; schedule operations retain their
original per-schedule pool/order. A different key in the schedule pool would
still deadlock when every schedule slot awaited attachment. Early drain keeps
both evidence lanes available; final close joins both actual callback sets
before persistence closes. The Calendar registry is now source/MEMORY checked;
physical file/actor/deployment scalability qualification remains open.

The [private calendar protocol](../calendar/integrations.md) now implements
bounded indexed dispatch beside immutable effect references, exact Jobs/Torrent
proof and a source-local observation cutoff. It also has a closed workflow
catalog, readiness seam and durable registration controller. These are internal
source foundations, not enabled managed automation. Both cross-file crash
boundaries still require physical qualification. No cross-file transaction or
cancellation recall is promised by this bridge.

Native calendar lifecycle must compose this capability with logging, prove its
actual established owner and hydrate before intended dispatch. Jobs can now be
constructed genuinely dormant: external mutation wakes remain disabled until
successful scheduler startup, and failed startup callbacks never become live on
retry. Explicit trusted ticks retain their internal refill behavior. Managed
composition now prepares this dormant Jobs owner before Torrent recovery without
enabling premature dispatch. A source-owned
effect-admission commit must recheck appointment revision/status, recipients,
channel policy and expiry after pool waits. Its committed claim defines the
effect cutoff; release SQL/Guardian leases before waiting on a provider.

Disabling a native feature without mounting it cannot persist an unobserved
retirement. This first bridge supports an **explicit durable retire before
disable** protocol and new-generation reactivation; it does not infer A → disabled
→ A from configuration equality. Automatic feature-manifest retirement is not
implemented. Calendar automation must not be enabled until that lifecycle and its
operational procedure are integrated and qualified.

The subsequent source lifecycle now provides private Jobs `quiesce()` and
`drain()` before final `close()`. Request/mutation intake retires separately from
the native evidence owner. Drain waits the actual per-schedule gate callbacks,
including callbacks whose cancelled callers already received unknown, while
original receipts, keyed barriers and exact execution evidence remain readable
for dependent Torrent work. It does not time out and declare settlement.
`WorkPool.close()` alone is not that proof. Final close retires evidence only
after its dependent execution has stopped; a forced outer deadline must report
unconfirmed work and apply containment, not replay or false rollback.

Managed Jobs now prepares this dormant owner through Torrent's private
before-recovery hook, then starts dispatch after recovery/publication. This is
framework composition, not a provider bag or an application setup callback.
The private calendar coordinator additionally supplies indexed source wakes and
durable class fairness, but its public configuration/operator/capacity and
physical qualification gates are still open.

File-backed actors, kill/restart/disk-full behavior, native logging workers,
bundled Linux/amd64 and exact-archive/updater checks remain release gates. Memory
tests cannot qualify those boundaries. No app, live database or hosted calendar
demo is changed by this source-only stage.
