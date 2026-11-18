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
- One-off schedule create, exact-revision replace/supersede and monotone cancel.
  Cron/source recurrence is deliberately rejected by this first integration.
- Current schedule inspection and original command-receipt reconciliation, even
  after retirement or cancellation. Evidence reads do not run current parsers.

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

Source work shares existing Jobs budgets: 10,000 schedules, 100,000 command
receipts and 100,000 occurrences per private file. A source additionally has a
1,000-schedule retained envelope. Each file admits at most 1,024 source identities
and 10,000 policy generations. Live sources, concurrent native activation
preparation and concurrent retirement preparation are each bounded to 1,024 per
broker. Exhaustion fails visibly; no
evidence is silently pruned and scopes are not rotated to evade limits.

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

The calendar still needs its own bounded indexed dispatch state beside immutable
effect references: claim in the source transaction, release the source lease,
reconcile/create the exact Jobs command, then acknowledge its receipt in another
short source transaction. Both cross-file crash boundaries require qualification.
No cross-file transaction or cancellation recall is promised by this bridge.

Native calendar lifecycle must compose this capability with logging, prove its
actual established owner and hydrate before intended dispatch. A source-owned
effect-admission commit must recheck appointment revision/status, recipients,
channel policy and expiry after pool waits. Its committed claim defines the
effect cutoff; release SQL/Guardian leases before waiting on a provider.

Disabling a native feature without mounting it cannot persist an unobserved
retirement. This first bridge supports an **explicit durable retire before
disable** protocol and new-generation reactivation; it does not infer A → disabled
→ A from configuration equality. Automatic feature-manifest retirement is not
implemented. Calendar automation must not be enabled until that lifecycle and its
operational procedure are integrated and qualified.

File-backed actors, kill/restart/disk-full behavior, native logging workers,
bundled Linux/amd64 and exact-archive/updater checks remain release gates. Memory
tests cannot qualify those boundaries. No app, live database or hosted calendar
demo is changed by this source-only stage.
