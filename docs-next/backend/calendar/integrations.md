---
id: zero.backend.calendar.integrations
type: architecture
audience: [developer, agent, maintainer]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: private-source-integration-protocol
maturity: experimental
applies_to: ["feature/calendar-backend-foundation; internal source protocol, not activated or selected for zero-update"]
---

# Calendar integration handoff and effect admission

[Calendar index](./index.md) · [Source-owned Jobs](../scheduler/source-owned-jobs.md) ·
[Qualification](./qualification.md) · [Full plan](../../_work/calendar-integration-plan.md)

This is the **private protocol foundation**, not a supported application reminder
configuration. It connects the canonical calendar writer, an owner-bound native
dispatcher, source-owned Jobs, original sealed Torrent execution evidence and a
source-local effect cutoff. The only effect adapter is an internal observation;
it does not send messages or call providers. A fixed native catalog, readiness
hook, durable policy controller and bounded native coordinator are implemented
internally. Managed Jobs now constructs dormant evidence before Torrent recovery;
automatic calendar mounting, public configuration and audited operator mutations remain
pending. Do not import these internal modules into an application to bypass that
boundary.

## Source truth and retained identities

The six historical `*_effect_intents` families are immutable operation references
and seals for their binding generations. They are not runnable queues and remain
unchanged. Additive calendar migration `010` installs separate integration state.
Migrations `001`–`009` and their complete historical declaration maps retain their
recorded checksums; no old appointment is reinterpreted or backfilled.

The subsequent additive `011` permanently binds each calendar rule to exactly
one Jobs source identity, and each source to one rule. Neither retirement nor a
new policy epoch frees or rotates that binding. Consistent `010` history derives
the same bindings without altering old evidence; conflicting shared/rotated
history blocks migration for explicit recovery rather than choosing a winner.

Additive `012` journals native registration controls before crossing into Jobs.
It preserves `001`–`011` migration functions and complete declaration maps. Its
one deliberate old-guard extension allows a late registration acknowledgment
only when the exact accepted control result already proves it. This can retain
historical truth after retirement without reactivating the current pointer.
The migration checks the old guard before replacing it; unexpected definitions
fail rather than being silently overwritten. Existing accepted registrations
backfill a bounded source-presence marker, not fabricated control receipts.

Additive `013` adds one durable scope-owned dispatch cursor, preserving all prior
migration/declaration generations. Claims rotate between expired leases,
obsolete-policy accepted work and ordinary ready work; a continuously nonempty
class receives service within three successful selections, including limit-one
batches and restarts. Empty claims and read-only previews do not advance state.

A changed appointment's canonical writer records the ordinary receipt/effect seal,
then captures integration work **in the same transaction**. Creation, hold
confirmation, rescheduling, cancellation, lifecycle changes and participant
replacement all use this seam. Replay and unchanged commands create no new work.
Every new appointment revision obsoletes the prior integration eligibility;
terminal lifecycle outcomes create no new observation. Old accepted or uncertain
downstream evidence remains retained.

Additive `014` adds an indexed admitted-but-unsettled presence projection and a
bounded private inspection query. Source admission and settlement maintain the
projection atomically; the explicit migration alone backfills historical
admissions without outcomes. No inspection read scans the admission history or
rewrites it. All `001`–`013` closures and complete declaration maps are preserved.

Only explicitly installed policy epochs participate. Their fixed adapter, rule
and semantic versions, physical source identity, exact Jobs definition, complete
Torrent pin, due offset and maximum lateness are retained. Job input contains
opaque intent/revision/epoch references, not appointment titles, participant
details, notes or provider payloads. The original initiating user is factual
provenance, never the source's execution authority.

| Private state | Meaning |
| --- | --- |
| Policy history/current/registration mapping | Immutable rule generation and exact Jobs epoch acknowledgment; local intake is activating, active or retired |
| Registration control/result/attempt | Original activation or retirement key and captured Jobs CAS/registration, immutable result and bounded mutable retry state |
| Registered-source marker | Permanent evidence that the rule's owned Jobs source existed; missing storage cannot become a false never-registered success |
| Integration intent | Immutable source effect, appointment revision, original due/expiry, payload and permanent create/cancel keys |
| Dispatch row | Bounded mutable claim, eligibility, retry time, safe blocked code and handoff state |
| Jobs receipt association | Exact durable create/cancel result; not proof of workflow execution or delivery |
| Effect admission | Unique source-local cutoff for one intent/execution; not proof an effect completed |
| Effect outcome | Separate immutable observation result; retained after later cancellation or retirement |

## Native readiness and registration lifecycle

`CalendarRuntimeSource.ready` is an optional asynchronous owner hook, composed
with existing logging rather than replacing it. For a new business command, the
runtime verifies the established physical owner, releases its proof lease and
waits for readiness before entering the canonical calendar writer. Concurrent
requests share only bounded in-flight owner work, not a user's lifetime or a
permanent successful-readiness cache. The original request's authority is
rechecked afterward. A failed readiness operation means the business command
**did not start**, even if a separate policy control is uncertain.

An authorized original receipt bypasses readiness and still re-enters ordinary
digest/current-permission validation. A later readiness failure therefore cannot
hide an appointment already accepted. Logging-only sources do not gain this
extra receipt preflight or readiness overhead.

The private `CalendarIntegrationPolicyController` provides:

- `prepare(policy)`: capture-only source preparation; it makes no Jobs calls.
  Identical live policy reuses its epoch. A changed policy requires prior
  unresolved controls to be reconciled before replacement.
- `activate(ruleId)`: commit the exact Jobs key and observed full registration
  before invoking Jobs. Original-key receipt barriers and replay hydrate the
  capability without silently rebasing an uncertain CAS or creating a new key.
- `retire(ruleId)`: synchronously stop new eligibility, persist local retirement
  first, settle older controls, then retire the actual owned Jobs registration.
  That registration may still be A when a newer local B was never applied.
- `quiesce()` / `close()`: stop controller intake and drain its callers. These
  are **not** proof that shared Jobs callbacks, Torrent or effects have drained.

Work is bounded across rules, serialized per rule, and releases source leases
before every Jobs wait. Retry failures update one attempt row rather than append
unlimited history. Backoff does not hide an older unresolved control. Accepted
late results remain historical evidence; no result revives a retired policy.
If Jobs was never registered, retirement reports `no-registration` without
inventing a downstream retirement receipt. If retained presence proves that a
registration existed but it is now missing, the operation fails closed instead.
Neither result promises `safeToDisable`; pending work/effects still require the
shared physical drain and a completed operator procedure.

### Selected native controls and inspection

The private managed owner exposes `operations.inspect(scope)`,
`operations.retire(scope, {ruleId, expected, signal?})` and
`operations.reactivate(scope, {ruleId, expected, signal?})`. `expected` is the
inspection's exact `{id, epoch, policyDigest}` selection. These are native
composition contracts, **not public app imports, browser routes or SDK methods**.
Controls share the coordinator's retained controller and per-owner intake queue;
they do not create an independent eligibility owner. The native wrapper's cutoff
begins when its queued work is admitted, not when the wrapper is first called.

Selected controls check the current selection in the keyed controller and final
source transaction. A stale, forged or pre-aborted selection cannot quiesce a
newer healthy cell. Explicit retirement is sticky against automatic preparation.
Reactivation requires a running coordinator, a configured rule and settled
original downstream retirement (or proven never-registration), then creates a
new epoch even for A → A. Removed rules remain inspectable and retireable, but
cannot be reactivated merely by naming their old ID.

Selected installation keys are separated between controller instances so two
concurrent identical requests must compete on the actual source CAS, not share a
transport replay. These selections are not human idempotency receipts. After an
unknown result, inspect and reconcile original controls; do not blindly replay a
stale selection. A queued cancellation starts no operation, while cancellation
after dispatch is conservatively unknown. Multi-stage reactivation can leave an
accepted new local epoch with downstream activation pending; it is not rolled
back by a later refusal.

Inspection is existing-only and bounded. It returns retained usage budgets,
current selections, one indexed pending control per rule, dispatch existence
flags, admitted-but-unsettled presence, redacted downstream registration facts
and Jobs capacity. It never provisions missing owners/files, hydrates rules,
pins workflows, starts timers or mutates Jobs. Source policy changes across Jobs
waits refuse the combined response as stale. Source and Jobs observations are
still **not an atomic cross-database snapshot** or an exact backlog count.
No contracts, workflow pins, keys, capabilities, seals or payloads are returned.

`inspectionForAuthority(request).get({signal?})` is the private managed read-only
projection. It derives the canonical Guardian scope, requires Calendar management
permission, and revalidates captured authority before reading and before returning
private data, including between internal owner/source/Jobs waits through transient
trusted callbacks. Public read options still allow only cancellation, never caller-
authored authority callbacks. It exposes only `get`. Mutating request projection remains gated
on a source-atomic initiating-actor/operator-receipt/semantic-audit contract;
an authorize → native call → post-audit sequence would leave a crash gap.

Retirement, empty queues and even an acknowledged downstream retirement do not
prove that running effects finished. Inspection and control results deliberately
retain `evidenceOwnerRequired: true`, with no `safeToDisable` field. Shared
Jobs/Torrent physical joins and Calendar evidence drainage still precede provider
disposal. Setting `calendar:false` is not a replacement for that procedure.

Historical source contracts retain their original realm fingerprint. Recovery
accepts only the current realm or the pinned genuine `010`–`013` native realms,
while still matching every physical identity, catalog and semantic field against
the freshly proven current owner. New policy installation still requires the
current realm. No old policy or Jobs receipt is rewritten to make an upgrade fit.

## Fixed native observation catalog

`zero.calendar.observation.v1` is a closed versioned Torrent graph with one
code-only observation activity and one total attempt. Its source-only Job is
absent from ordinary request discovery/admission. Registration itself opens no
files, starts no timers and resolves no execution dependency. A late native
executor lookup happens only after nonlegacy SYSTEM source/input checks.

The activity receives a narrowed immutable context with no request services,
provider bag or workflow memory. Actual source/occurrence/pin proof still runs at
the observation boundary below; the compilation exemplar is not an admitted
intent. Policy hashes include rule and scheduling semantics, while the permanent
source identity belongs to the rule, not a temporary version.

Jobs construction and mutation hints now remain dormant until explicit successful
scheduler startup. Trusted manual ticks remain possible, including internal
refill. A failed registration's captured callback stays inert after a later retry;
cleanup cannot unregister someone else's replacement. This is a dependency
construction prerequisite, **not** completed calendar recovery composition.

## Native coordinator and recovery order

The private coordinator is inert on construction. Its source readiness prepares
fixed policy captures without invoking Jobs; `start()` is a separate operation
after dependencies recover. SYSTEM owner discovery is keyset-paged through the
established-owner index, without provisioning or acquiring calendar actors.
Recovered execution uses a direct canonical scope lookup and transient evidence
capability, independent of discovery, intake capacity or successful hydration.

The current **private envelope is 64 retained owners**, each with at most eight
permanent rule identities. It deliberately does not evict/recreate identities to
evade Jobs' shared 1,024-source limit. Those slots are not reserved exclusively
for Calendar. Larger catalog hydration and sustainable retained schedule capacity
remain public-activation gates; the normal calendar domain's 10,000-file ceiling
is not a promise of 10,000 automatically hydrated integration owners.

Explicitly retired rules are never resurrected by stale desired configuration.
Removed/unselected retained rules stop for operator review before Jobs calls.
Pending original controls settle before new policy versions are prepared, and
live retirement is reconciled even when it retains the same policy ID. Retry
wakes distinguish durable control backoff from local failures. Advisory commit
hints are coalesced; bookkeeping does not create human-activity audit facts.

Managed workflow construction now has a private before-recovery seam. It builds
the Jobs evidence owner from the exact unpublished Torrent service, with runner
wakes still disabled. Only after real recovery/publication does Jobs start.
This hook cannot perform ordinary workflow starts or receipt inspection, which
would invalidate initialization-only recovery. It must never await the recovery
it is preparing. Cancellation waits its physical callback before disposing the
workflow provider; partial Jobs construction cleans itself without recursively
calling workflow stop from inside that hook.

Shutdown order is intake quiescence → physical Jobs callback drainage → Torrent
stop → Torrent physical drain → final native evidence/provider close.
`JobsService.drain()` retains
registration/receipt/execution evidence and does not use an elapsed timeout as
proof of physical settlement. Torrent's ordinary stop/dispose grace is likewise
not physical completion: its new native `drainPhysical()` joins actual tracked
activity/validator/submission promises after logical retirement and before
adjacent providers close. Detached, unawaited app work is not covered. Calendar
intake drainage and `closeEvidence()` are separate phases. Native wake-cancellation
failures retain their exact outstanding handle and reject clean drainage. Failed
wake registration/rearming retires fresh Jobs eligibility to a diagnostic dormant
state, not a falsely running service with no retry timer. Explicit native
`start(scheduler)` can recover original durable work and rearm without rotating
source identities or duplicating accepted schedules. Captured failed callbacks
remain inert. A supervisor timeout still requires containment
and unknown-outcome handling; it is not a successful drain.

Automatic calendar composition/configuration is not enabled by this source pass.
The existing `calendar: true` core remains independent of Jobs/Torrent, and false
remains inert. Installed-file upgrades, actual managed workers/browser/Linux
execution and normal updater selection remain unqualified.

### Private managed composition checkpoint

The subsequent native factory now composes the actual Calendar core and logging
source with the coordinator and exact dormant Jobs/Torrent owners. It is not
selected by public configuration or mounted automatically. Framework composition
registers the fixed observation graph purely, prepares Jobs with the exact
branded source-only definition, and prepares Calendar inside the unpublished
Torrent owner's before-recovery hook. It explicitly seals dependency attachment
before permitting recovery. After publication, coordinator hydration precedes
automatic Jobs dispatch. Disabled and ordinary core/logging-only Calendar keep
their independent path; applications must not import this private factory.
Startup checks the exact published Torrent service before and after asynchronous
hydration. Missing, swapped or retired publication refuses startup; loss during
a separate writer wait quiesces fresh eligibility without erasing accepted
receipts. Recovered execution remains available before that publication check.

The pin adapter uses native `pinRegistered`, not ordinary name precedence. It
requires the exact registered code graph, explicit version, immutable graph
content/fingerprint and application definition ownership. A same-named scoped
database definition is rejected even when its version or fingerprint matches.
Ordinary authored workflow resolution is unchanged.

One shared cleanup owner retires Calendar facade/intake and Jobs intake, joins
their actual bodies, stops/drains Torrent, then joins Calendar's raw evidence
callbacks **before** final Jobs close and Calendar logging/Fabric disposal.
Subordinate Calendar cleanup delegates to that owner. A rejected bounded pool
close cannot let runtime cleanup continue underneath a still-running callback.
Native `drainPhysicalIntake()` and `drainPhysicalEvidence()` have no success-by-
timeout shortcut; bounded-close failures are still reported after physical
settlement. A callback that never settles needs outer process containment, not
a fictional clean close. Unsealed preparation failure cleans native dependencies
without recursively stopping the Workflow initializer that is awaiting it.
Partial Calendar provider ownership is retained before fallible facade/route
publication. A refused final provider close may retry that same retired owner;
completed physical joins, their failures and Workflow stop are not replayed.

The source-owned Jobs capacity projection and separate finite recovery receipt
headroom support this native lifetime. They do not finish public operator
retire/reactivate/adoption, sustained retained-history capacity or large-catalog
hydration. Those gates, actual managed authentication/logging, actors, browser,
Linux deployment and exact-package/updater qualification remain open.

## Bounded claim → Jobs → acknowledgment

`CalendarIntegrationDispatcher` uses explicit bounded batches and coalesced
advisory wakes. It claims indexed work with a nonce, monotone generation and
reclaim deadline in a short calendar transaction. It releases that lease before
calling Jobs, then acknowledges the exact receipt in another short transaction.
A stale claim cannot acknowledge over a newer generation or restore eligibility.
Healthy accepted rows do not repeatedly consume the ready queue. Retry state is
updated in place; a failed attempt does not append unlimited diagnostic history.
New work starts at the trusted source-write time, not zero, so a stream of fresh
work does not always jump older due retries. Selection across expired claims,
retired-policy work and ordinary ready classes is bounded/indexed and uses `013`'s
durable round-robin cursor. This is a selection bound, not a time-to-delivery
guarantee when capacity or a downstream provider is unavailable.

The dispatcher itself has no background timer. The private native coordinator
adds bounded startup discovery and one coalesced absolute Scheduler wake.
`calendar.integration.nextWake({})` uses the source clock and indexed probes for
ready retry times, claim expiry, obsolete accepted work and pending control
attempts. Healthy accepted work sleeps until its expiry marker. Reads do not
claim work or advance fairness. There is no recurring per-minute Jobs schedule,
per-appointment timer, per-owner idle poll or provider call in a database queue.
Calling a dispatcher's `wake()` alone still does not establish restart recovery.

Original Jobs command receipts are checked first. A null receipt during an
uncertain writer is **not** proof that no commit can still arrive. Recovery
re-enters the original command through Jobs' shared per-schedule gate, retaining
the original payload, due instant and key. Fresh create/replace also require the
exact expected source registration; an old intent cannot silently acquire a
later A → B → A policy generation while waiting. Exact historical replay returns
the original result before that fresh-admission fence.

After a genuinely proven first-attempt non-commit, the dispatcher may restore
the source's no-attempt provenance. This narrow case permits eventual expiry
suppression after capacity failure. Unknown, unclassified or accepted results
cannot acquire that permission. Lost source acknowledgment likewise cannot
authorize another logical schedule.

Only native typed Jobs/Database errors with a proven no-start/non-commit outcome,
or a native Worker no-start, establish that proof. An authored object containing
an `outcome` field does not. A known source acknowledgment refusal after Jobs
acceptance is not proof that the Jobs write failed.

Controlled batch exit also restores untouched first-attempt claims using tracked
no-invocation proof and the owner lifetime, not an already-aborted dispatcher
signal. Invoked, previously uncertain and accepted rows stay reconcilable. This
is graceful-exit proof; it cannot be fabricated after a process crash.

`close()` drains intake/caller work, **not physical Jobs settlement**. Shared
Jobs callbacks may still be draining, and owner-bound evidence reads currently
have no separate per-call cancellation option. Native shutdown must keep calendar
and Jobs evidence owners alive until shared drainage. Unconfirmed claim cleanup
retains bounded IDs/codes, rejects close and blocks new intake instead of
reporting a clean stop or growing unbounded diagnostics.

## Original Torrent execution, not merely the same principal

Jobs exposes a private `executions.get(scheduleId, { generation, scheduledAt })`
read. It verifies the exact source-owned occurrence and its historical admission,
opens the original MAC-sealed authority, and reconciles the original permanent
Torrent start key. Its safe result contains IDs, pin/hash, source epoch and
workflow status—not the seal or private input. It works before Jobs records its
dispatch acknowledgment and remains available after source retirement.

The fixed observation adapter requires a real nonlegacy SYSTEM activity context
with the correct source principal/scope, original input and permanent graph pin.
It then matches that activity's instance ID against the exact Jobs execution
evidence. Another native SYSTEM start with the same principal, graph and input
but a different start key does not qualify. A browser or workflow administrator's
ordinary actor execution cannot impersonate the native source.

## Final cutoff, cancellation and unknown outcomes

After all workflow/pool waits, a short calendar writer checks local active policy
epoch and acknowledged registration, exact immutable intent/pin, current
appointment revision, effective nonterminal lifecycle, original not-before and
expiry, and current eligibility. Committing the unique admission is the cutoff.
No calendar or Guardian lease is held over Jobs, Torrent or a future provider wait.
The deadline is sampled inside the source writer after queue/acquisition waits,
and checked again immediately before its admission insert. A timestamp captured
by the calling activity cannot authorize late execution.

Cancellation/supersession **before** cutoff prevents a new effect. Cancellation
**after** cutoff still changes the appointment but does not promise recall of
already authorized work. Historical factual settlement stays possible after
cancellation or policy retirement; it does not authorize a new publication.

Each physical admission attempt uses a fresh native transport key. The logical
effect identity remains the immutable intent. Otherwise a transport replay could
return its old `admitted:true` and be mistaken for new execution permission.
An existing admission instead returns evidence-only `admitted:false`.

Observation results distinguish:

- `observed`: the separate source-local observation outcome exists.
- `admitted`: the cutoff exists, but its outcome is unsettled/unknown. This is
  **not** an observation, provider success, delivery or human attention. A later
  workflow result does not erase that uncertainty, and replay cannot manufacture
  settlement or permission to repeat an external effect.

## Native owner and lifecycle boundaries

The runtime exposes a separate internal fixed-operation owner facade. It injects
scope/owner/command identity, rejects caller-authored routing fields and binds
installed contracts to the current root, owner, database and realm. It never
constructs a fake `CalendarActor` or exposes raw SQL/Jobs through request APIs.
Every operation requires established/current SYSTEM metadata, existing-only
acquisition and physical `_calendar_owner` proof on that same lease. Proof is not
cached across reopening. Owner lifetime is separate from policy retirement so
old evidence can still be reconciled.

The shared cold actor's existing open path can prepare/validate schema before
the domain-owner check. The new facade does not explicitly migrate, bind or
provision, but it is **not a guarantee that the lower layer is read-only**.
Physical startup/ownership behavior still needs qualification before activation.

Logging and dispatch sources can be composed with independent advisory wakes,
partial-start cleanup and full reverse-order close. Managed composition must
still mount dormant before recovery, hydrate after Jobs/Torrent are ready, stop
source intake before those dependencies, and keep the owner alive for their
drain. The shared managed Jobs preparation/stop sequence is now implemented;
automatic calendar coordinator mounting remains disabled.

Local retirement must happen before Jobs retirement and its exact acknowledgment;
even that acknowledgment does not declare safe-to-disable. A later
reactivation must create a new epoch. `calendar:false` remains entirely inert and
cannot retrospectively record an unobserved A → disabled → A transition. The
public operator-facing retirement/adoption procedure is not yet implemented.

## Capacity and remaining activation gates

The private calendar envelope is eight rules, 10,000 retained policy generations,
100,000 integration intents and at most 100 claimed rows per batch. Source
transaction capacity exhaustion rejects before commit and rolls back the whole
appointment change, rather than accepting an appointment with missing required
intent evidence. Subsequent Jobs capacity failure becomes retained blocked work;
it does not falsely reject an already committed appointment. No history is
silently deleted and no identity/scope is rotated to evade limits.

Derived integration due instants must also fit Jobs' actual four-digit UTC-year
contract: epoch through `9999-12-31T23:59:59.999Z`. A rule producing a due outside
that range rejects in the source transaction; it cannot leave an impossible
schedule retrying forever. Ordinary calendar dates without an installed rule
retain their broader supported range. Lateness is bounded separately to 31 days.

Jobs still retains at most 1,000 schedules/source, 10,000 schedules/file and
100,000 receipts/occurrences. This finite one-off bridge is **not yet a sustainable
automatic reminder service**. Public managed configuration, final native catalog
mounting, larger catalog discovery/hydration, public audited operator retirement/adoption,
capacity management,
provider-specific uncertainty handling and physical/browser/Linux/package/updater
qualification remain explicit gates. Current source/memory evidence and test
paths are recorded in the qualification guide.
