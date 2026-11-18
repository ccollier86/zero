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
it does not send messages or call providers. Managed activation, public
configuration and lifecycle/operator integration remain pending. Do not import
these internal modules into an application to bypass that boundary.

## Source truth and retained identities

The six historical `*_effect_intents` families are immutable operation references
and seals for their binding generations. They are not runnable queues and remain
unchanged. Additive calendar migration `010` installs separate integration state.
Migrations `001`–`009` and their complete historical declaration maps retain their
recorded checksums; no old appointment is reinterpreted or backfilled.

A changed appointment's canonical writer records the ordinary receipt/effect seal,
then captures integration work **in the same transaction**. Creation, hold
confirmation, rescheduling, cancellation, lifecycle changes and participant
replacement all use this seam. Replay and unchanged commands create no new work.
Every new appointment revision obsoletes the prior integration eligibility;
terminal lifecycle outcomes create no new observation. Old accepted or uncertain
downstream evidence remains retained.

Only explicitly installed policy epochs participate. Their fixed adapter, rule
and semantic versions, physical source identity, exact Jobs definition, complete
Torrent pin, due offset and maximum lateness are retained. Job input contains
opaque intent/revision/epoch references, not appointment titles, participant
details, notes or provider payloads. The original initiating user is factual
provenance, never the source's execution authority.

| Private state | Meaning |
| --- | --- |
| Policy history/current/registration mapping | Immutable rule generation and exact Jobs epoch acknowledgment; local intake is activating, active or retired |
| Integration intent | Immutable source effect, appointment revision, original due/expiry, payload and permanent create/cancel keys |
| Dispatch row | Bounded mutable claim, eligibility, retry time, safe blocked code and handoff state |
| Jobs receipt association | Exact durable create/cancel result; not proof of workflow execution or delivery |
| Effect admission | Unique source-local cutoff for one intent/execution; not proof an effect completed |
| Effect outcome | Separate immutable observation result; retained after later cancellation or retirement |

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
retired-policy work and ordinary ready classes is bounded/indexed but does not
yet have a durable fairness bound. The managed coordinator must close that
remaining starvation gate before production activation.

The initial adapter has no background retry timer. Later managed composition
must supply startup discovery and coalesced scheduler wake-ups for durable
backoff and expired claims. It must not create a recurring per-minute Jobs
schedule, poll each appointment, or run providers in a database automation queue.
Calling `wake()` alone does not establish restart recovery or future retries.

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
drain. This stage does not change managed startup or enable those workers.

Local retirement must happen before Jobs retirement and its exact acknowledgment;
only a completed operator protocol may then declare safe-to-disable. A later
reactivation must create a new epoch. `calendar:false` remains entirely inert and
cannot retrospectively record an unobserved A → disabled → A transition. The
operator-facing retirement/adoption procedure is not yet implemented.

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
automatic reminder service**. Managed configuration, fixed workflow registration,
restart/retry discovery, durable retirement operations, capacity management,
provider-specific uncertainty handling and physical/browser/Linux/package/updater
qualification remain explicit gates. Current source/memory evidence and test
paths are recorded in the qualification guide.
