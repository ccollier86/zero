---
id: zero.work.calendar-integration-plan
type: architecture
audience: [developer, agent, maintainer]
owner: calendar
status: draft
implementation_state: in-progress
visibility: internal
system: calendar
feature: managed-calendar-integration
maturity: planned
applies_to: ["proposal reviewed against 2.11.0 and b237bf4 foundation follow-up; not an available calendar backend"]
---

# Calendar: end-to-end managed integration plan

[Working index](./index.md) · [Preserved UI and return handoff](./calendar-return-handoff.md) ·
[Current frontend contract](../frontend/calendar/index.md)

Originally reviewed 2026-11-16; completion ledger refreshed 2026-11-18 against
`8bd8f25` and the working feature branch. The original review preceded backend
implementation. At that planning baseline, the selected 2.11.0 package provided
experimental frontend components only. The branch now implements configuration,
private persistence, connected one-off booking and the foundations described
below, but has not published a qualified Calendar backend archive. Inspect the
installed package by commit/hash rather than treating historic version references
as a statement about all current source. Later-stage names remain proposals until
their row below is implemented and qualified.

Implementation has begun on `feature/calendar-backend-foundation`. The
[managed core source guide](../backend/calendar/index.md) now documents the
connected one-off implementation. It is not yet released or updater-selected;
statements above about the selected 2.11.0 archive remain unchanged. Core API
names in that guide are implemented on the branch; later-stage names below are
still proposals.

## Finish-line execution ledger

This is the authoritative remaining-work list. Historical checkpoints below are
evidence, not a substitute for completion. **The finish line includes recurrence,
self-booking, reminders/effects and the complete connected management/clinical UI;
an observation-only bridge or one-off calendar does not complete this plan.**

Status vocabulary: **source checked** means native-memory/type evidence, not
physical/browser/deployment acceptance; **in progress** and **queued** are not
available capabilities. Only the exact qualified and updater-selected artifact
may be labelled **released**. No completion percentage is inferred from file or
unit-test counts.

### Definition of done

An app can opt into the feature on a new or existing Zero installation, preserve
its tenancy, identities, data and themes, configure permissions/timezones/catalogs,
and mount native Calendar workspace/management components. Every enabled control
uses canonical supported APIs, real authorized reactive data and the existing Zero
services. Optional recurrence, public booking, clinical workflows and channels are
deliberately configurable; enabled features work end to end, while unavailable
dependencies produce a truthful setup/blocked state, never a working-looking local
preview. Approved visual anatomy and Zero tokens/motion remain intact.

Source authority, rollback/receipt/audit truth, file-mode concurrency/performance,
recovery, real-browser flows, installed Linux actors and normal update/adoption
must pass before release. No application deployment, live-data migration or hosted
demo change is implied by framework completion.

| Order | Work package and completion test | Current state |
| --- | --- | --- |
| F1 | **Existing-owner and lifecycle admission.** Reject stale physical schema/ledger or wrong/missing/substituted owner before write-capable open/preparation. Explicit setup can migrate only after proving established ownership. Retired rules do not block unrelated bookings; removed active rules require review without orphaning accepted/unknown evidence. Zero-rule evidence-only recovery remains possible. | Source-atomic operator requests, ordered physical drain, read-only native cold admission and readiness/evidence split implemented/source checked. Physical rejection proof unexecuted. |
| F2 | **Working versus durable-history capacity.** Completed history must not exhaust a live-work quota. Preserve original schedule/receipt/Torrent identities and factual historical counters. Bound active/unknown/review occupancy, expose pressure, keep retirement/reconciliation headroom and use an explicit configurable storage/history budget. More than 1,000 completed reminders on one unchanged source must remain readable and permit new work. Scale resident owner/capability hydration separately from retained files. | Additive Jobs003/004, finite policy/writer conservation, native read-only attachment, physical pins, SYSTEM wake coverage, bounded resident eviction and demand hydration are source/MEMORY checked. Source-control and schedule pools have independent finite capacity. Historical evidence/identities survive idle release. Actual file/actor/performance qualification remains open. |
| F3 | **Managed activation, adoption and controls.** Wire the existing dormant Calendar/Jobs/Torrent owner into normal startup, typed opt-in config, authorized operator API/SDK and clear readiness. Add read-only adoption planning, explicit prepare/retire/reactivate/disable procedure and Doctor checks. Unknown/nonterminal work prevents a false safe-disable result. | Private owner/inspection/audited acceptance and fresh/populated staged-migration repair are source implemented. Calendar now admits the original 001–016 boundaries with unchanged hashes and a retained pre-manifest016 pin. Public feature configuration/mount, adoption/disable procedure and Doctor remain gated on the actual F5/F7 capabilities, not the private observation exemplar. |
| F4 | **Complete canonical scheduling commands.** Support the rich editor's persisted fields through one atomic update contract, current resource/type/visit/participant policy, receipts and semantic evidence. Independent override permission/reason; retain history. Add local-date all-day handling and reviewed effective eligibility where supported. No sequential saves presented as atomic or raw CRUD bypass. | Atomic016 rich edits, canonical017 untyped all-day appointments, canonical018 effective resource/location policy and canonical019 independently granted manual appointment-overlap review/save are source implemented through final writers, bounded queries, HTTP/SDK/live hooks and connected rich editor behavior. Final checking is recorded in qualification. Physical/browser qualification remains required; holds/blocks are still timed-only and later day-type/series contracts remain separate. |
| F5 | **Series and coverage.** Standards-tested daily/weekly/monthly/yearly engine, nominal occurrence identity, exceptions, one/future/all edits and split lineage. Bounded all-resource materialization commits conflicts consistently; expose durable coverage, not unbounded free-time promises. Existing Jobs/Torrent extends horizons without a second Calendar timer system. | Private bounded timed engine/conformance source checked. Reviewed implementation design below specifies immutable versions, staged atomic publication, explicit one/future/all semantics and sparse UTC coverage. No series persistence, automatic coverage or facade/UI activation yet. |
| F6 | **Authoritative self-booking and invitations.** Real bounded offers, member/invitation/approved-guest proof, notice/horizon/type/recipient policy, abuse limits, actual any-provider allocation, expiry and atomic confirmation. Explicit pending-review capacity semantics and approve/reject. Hash/revoke capabilities; no private busy/detail leak or staff-audit requirement for public artwork. | Authenticated subject-bound holds/confirm source checked. Offers/proofs/review/RSVP/public routes and native booking UI queued. |
| F7 | **Actual effects and optional service adapters.** Versioned source-owned reminder/transition rules, immutable due/lateness, fresh recipient/domain checks after waits, native notification/email adapters and exact supersede/cancel/reconciliation. Partial acceptance and unknown SMTP remain distinct; manual review never invents provider evidence. Storage/presence/contact/AI adapters are optional and admitted explicitly. | Observation-only cutoff/recovery source checked. No actual reminder/channel, invitation or AI adapter is enabled. |
| F8 | **Connected clinical and management experience.** Canonical optional progress/outcome/lobby/attention axes and current action/reason policy; online presence never implies arrival. Connect the reviewed rich editor, all card/agenda/context/status entry points, scoped geography, catalogs/hours/blocks/grants and public booking through the shared async controller. Day/week/month/list, fixed gutter, dense provider scrolling, empty/setup/denied/unknown states and native modal lifecycle work with real data. | Approved rich content composes one native async owner and is the connected workspace default, with whole-resource-set/type/visit/participant atomic writes. Lifecycle/receipt review and combined source checks passed. Management/clinical/booking completion remains required. |
| F9 | **Integration and operational qualification.** Single/multi tenancy, populated upgrades, files/WAL/HOT/restarts/kill, real managed optional/compliance logging, quiet revocation/reconnect, measured file-mode budgets and real Chromium. No passing mock/model/unit result substitutes for a browser or actor run. | Extensive source/MEMORY evidence; physical definitions partly prepared. Real physical/browser/performance qualification blocked by the existing storage-integrity hold. |
| F10 | **Release and adoption.** Final docs/Doctor/public exports, full frozen-candidate validation, exact installed source archive and official Linux/amd64 bundle/actors, updater preservation, commit/hash/provenance and both remotes. Normal updater selects the qualified artifact; handoff shows new/existing-app setup and app-owned hooks. | Queued. No Calendar backend release selected. |

### F2 implementation contract: working state, finite history and settlement

The first source increment adds Jobs migration `003`, retained schedule working
membership and all-generation open-occurrence counters. A source may complete
more than 1,000 schedules without exhausting its 1,000 **working** slots; its
historical count remains factual and monotonic. File working quotas are shared
by actor-owned and source-owned work. A closed cursor releases its schedule slot
only when every generation has no pending, claimed, dispatched or blocked
occurrence. Unknown and review-blocked work remains occupied. Capacity version 2
separates these working measurements from the unchanged retained file ceilings;
the retained per-source measurement has no fictional enforced limit/remaining.
This increment is source/MEMORY checked, not a completed F2 or physical release.

The next coherent package implements the following contract in the native
actor and final writer, not only in a parent preflight or application query:

- A trusted Jobs capacity policy contains finite `retained` ceilings for
  schedules, schedules per actor owner, ordinary intents, actor recovery intents,
  source recovery intents, occurrences, sources and source policies, plus a
  finite `transport.keyLimit`. Existing retained ceilings remain the omitted
  configuration defaults; raising a historical ceiling is an explicit operator
  storage decision, not an automatic multiplier. The transport ceiling can only
  reduce the existing Fabric hard ceiling of 1,000,000 permanent key identities.
  Lowering a configured ceiling below retained usage stops affected new
  admission; it does not reject original evidence reads or erase history.
- Add an optional **realm-owned native writer-admission definition**. Its
  semantic identifier and synchronous normalizer, validation and aggregate
  projection code are imported in the actor, like registered commands. Trusted
  coordinator binding carries only detached bounded policy data and its
  fingerprint. The actor normalizes it and proves the same policy fingerprint
  in its bind acknowledgement. No callbacks, SQL, provider handles or
  caller-selectable `recovery` flag cross IPC. Unrelated realms omit this
  contract and retain their present behavior. Jobs command handlers receive a
  frozen trusted policy through their actor-local context, never through command
  input. A new configuration cannot reuse an actor bound under a different
  policy; normal runtime/configuration authority fences still apply.
- Add additive migration `004` and a transaction-owned settlement-units ledger.
  Backfill and validate it against preserved `001`–`003` state without rewriting
  any original schema checksum, schedule, admission, logical receipt, occurrence,
  historical usage counter or Torrent identity. A pending or claimed occurrence
  owes two units (handoff evidence and terminal evidence); dispatched owes one;
  terminal/cancelled owes zero. Review-blocked occurrences conservatively retain
  two units for their permitted factual resolution, even while current review
  policy leaves them occupied. Each occupied source schedule and active source
  owes one further control-settlement unit. An occupied active actor schedule
  owes two (pause then cancel), a paused one owes one, and a cancelled/closed
  schedule owes zero. Open occurrences after cursor closure remain counted.
  All generations count. Keep separate actor/source
  control-unit aggregates so logical recovery-receipt reserve is conserved too.
  Track bounded per-object membership and aggregate counters transactionally;
  do not recount ordinary startup or scan history on an admission decision.
- Conserve `permanentTransportKeys + outstandingSettlementUnits <= keyLimit`
  atomically with domain mutation and transport-receipt insertion. For an
  already over-budget legacy file, freeze ordinary admission and expose the
  exact deficit; do not fabricate headroom. Its factual settlement may make only
  deficit-nonincreasing progress and must still respect the hard physical key
  ceiling; the projection cannot promise that every old obligation will fit.
  Existing original-key receipt
  lookup/replay occurs **before** new-key admission. Ordinary commands, including
  materialization, registration/readmission, claim/reclaim and defer, cannot
  spend settlement headroom. Once ordinary headroom is exhausted, only a closed
  actor-code classification whose successful transaction strictly decreases
  settlement units may create a new transport key. Its decrease must cover that
  key; failed commands, fresh-key no-op replays and retries roll back without
  consuming reserve. A successful dispatch fact decreases two units to one;
  terminal observation decreases one to zero. Cancel/retire decreases the
  corresponding control obligation. This bounds retry spending without claiming
  that finite reserve supports unlimited retries or unlimited retained writes.
- Preserve normal dispatch's lease/current-authority checks. Add a separate
  narrow evidence-only handoff reconciliation command for an already admitted
  occurrence. The native runner first opens the retained sealed authority and
  inspects the **original** Torrent key, before buying any recovery claim. An
  accepted immutable receipt may settle the original handoff after lease expiry
  using exact current occurrence/admission/generation/claim CAS and pinned
  workflow/receipt identity; this path cannot create/reclaim an occurrence or
  authorize enqueue. It does not weaken normal dispatch. A missing receipt is
  not absence proof while the native enqueue gate or physical work is unsettled.
  At pressure, retain that unknown occupancy and use read-only inspection/backoff
  rather than repeatedly spending new UUID transport keys. Review-blocked work
  does not become terminal or free capacity merely because a budget is full.
- Keep finite logical receipt headroom as well as transport headroom. Existing
  source cancel/retire receipts retain their original namespace and reserved
  accounting. Actor pause/cancel needs separately accounted finite recovery
  receipts so a full ordinary intent budget cannot prevent stopping admitted
  work. New ordinary work must also leave enough actor/source recovery-intent
  room for its control obligations. Only an actual control-unit decrease spends
  that logical reserve; a fresh-key no-op is ordinary admission or rejection,
  not a way to drain it. Existing recovery counters keep their original meaning.
  Original logical receipt reads/replays never require current admission
  eligibility or a new receipt identity. No global key deletion, identity
  rotation, unsafe capacity bypass or new archive service is introduced.
- Expose a private, authority-fenced, aggregate-only writer retention/admission
  facade: permanent keys, configured/hard key ceilings, settlement units,
  ordinary remaining headroom, reserved remaining headroom/deficit, retained
  result/tombstone/byte measurements and the policy fingerprint. It is a
  non-mutating operation, available under pressure and containing no raw receipt
  identities or SQL. Jobs source inspection composes truthful working, retained
  and transport measurements through that facade; Calendar consumes that native
  projection rather than reaching into private tables. A policy/configuration
  change requires the current configured native facade and actor binding; old
  historical evidence remains accessible through the original evidence lane.

Implementation order and owned surface:

1. Add the generic realm admission contract and its closed bind/fingerprint
   validation in `databases/database-realm.ts`, actor protocol/binding and
   coordinator contract/config/binding. Add final transactional validation in
   `database-writer-engine.ts` and trusted actor-local command context support;
   retain the existing final physical/authority guard ordering. Add the private
   aggregate retention facade through the actor and trusted lease/executor, not
   the public CRUD client. Fabric must not import Jobs.
2. Add Jobs policy resolution, additive settlement schema/migration/helpers and
   fixed command classification; wire trusted config through
   `jobs/config.ts`, `persistence-config.ts`, `runtime.ts` and the fixed realm.
   Apply configured history ceilings at every actor/source new-admission budget
   and preserve all historical counter meanings. Settlement and generic receipt
   accounting must commit or roll back together.
3. Add the evidence-only handoff command and runner read-before-claim/pressure
   behavior. Wire actor pause/cancel recovery receipts and native capacity
   projection. Do not claim this package complete while policy is merely parsed
   or a parent-only check exists.
4. Qualify the resident-owner lane separately: retained Calendar owners are not
   disposable configuration, and the coordinator's resident-owner ceiling and
   Jobs source broker's global 1,024 resident capability ceiling are not retained
   history quotas. Use durable native wake/dirty metadata, safe non-retiring
   release of idle hydration and on-demand admission; never auto-retire or rotate
   an identity to evict it. Unsettled callbacks/gates retain physical occupancy.
   Source/file admission remains bounded even if hydration is evictable.

Required source/MEMORY tests cover omitted-policy compatibility for unrelated
realms and Jobs; invalid/callback-bearing or mismatched bind policy; real managed
populated `003`→`004` preservation and atomic corrupt-backfill rejection; exact
ordinary boundary and one-unit settlement conservation; actor/source shared
quota; all-generation, unknown and blocked obligations; no double release;
rejected/replayed/late-authority-failed command rollback including generic keys;
ordinary materialize/readmit/claim/defer denied at reserve; original-key receipt
reads at pressure; accepted late handoff reconciliation without a fresh claim or
fresh enqueue; no receipt/absence inference while a gate is physically active;
and repeated pressure retries consuming zero reserved keys. Facade tests prove
bounded aggregate-only output and current policy fingerprint. After verified
filesystem recovery, F9 must still run real file/actor/restart/WAL/corrupt-source
and measured capacity gates; MEMORY evidence does not substitute for them.

#### F2 native residency and durable owner coverage

The private native composition now connects the SYSTEM wake catalog to bounded
Calendar residency and on-demand Jobs attachment. Its catalog mode processes
durable due pages instead of loading every retained owner into `cells`/`refs`.
The 64-cell limit is a resident bound, not a total-owner limit. Physical proof
and retained policy inventory are staged before publishing a cell; an unreadable
owner retains a durable retry without consuming a resident slot. The original
standalone coordinator behavior remains available for narrow source fixtures.

Jobs' separate process-wide `JobsSourceBroker.live` still admits at most 1,024
resident native bindings. Its source-authority `WeakMap` is not that quota and
must not be cleared to revoke evidence. Per-file retained source/history
ceilings, physical file budgets and Fabric actor-cache bounds remain independent.
Jobs' configured file budget can be smaller than Calendar's; finite pressure
must be reported honestly. Source/MEMORY checks do not establish physical
10,000-owner performance or an installed deployment qualification.

The target keeps the existing resident ceilings, original owner/source/receipt
identities and one native absolute wake. It does not add a timer engine, rotate
identities, auto-retire removed configuration or delete settled/unknown history.
Durable unknown/review work retains Jobs working and settlement charges even
when an idle physical capability is detached. It does **not** pin resident RAM
forever. Actual queued/running callbacks, gates and physical source leases pin
hydration until their real bodies settle; caller cancellation, an expired lease,
an empty receipt lookup or a successful bounded drain is not that proof.

1. **Source-checked increment: native Jobs read-only attach/detach.** The private
   `SourceJobs` facade has a closed native hydration surface,
   `hydration.attach({originalActivateKey, expectedRegistration, pinInput})` and
   `hydration.tryDetach()`. This is native-only, not public API.
   Attach uses the installing capability's physical owner/current eligibility,
   compiled native contract and fixed graph pin; it serializes on the source
   gate, reconciles the original accepted activation receipt and proves the
   exact current active registration/generation/revision/policy hash before
   publishing the resident binding. It never invokes `jobs.source.register`,
   creates a logical/transport receipt, changes an epoch or prepares a policy.
   A missing original receipt is not permission to fall back to activation.
   Stale/retired/unselected policy cannot hydrate fresh authority; original
   evidence reads retain their independent lifetime.

   Detach is a compare-and-release of the **exact** current capability/binding,
   never of a guessed source id or a later replacement. It performs no durable
   write and does not abort owner/evidence signals or delete the WeakMap entry.
   Release succeeds only when no queued/running source control, schedule
   mutation, reconciliation barrier or fresh-dispatch callback still references
   that binding. Track physical pins inside the actual WorkPool callbacks and
   release them in their inner `finally`, not when an outer cancelled promise or
   activation token finishes. A dispatch pin survives `prepareDispatch()` until
   the native enqueue callback physically settles, including late callbacks
   after caller timeout. Full/busy hydration is recoverable `JOBS_NOT_READY`,
   not a definitive no-start/retirement or permanent occurrence block. The
   existing global 1,024 resident limit remains enforced and observable.

2. **Durable SYSTEM coverage before idle Calendar eviction.** Add a separately
   inspected/additively installed native integration-wake catalog, leaving the
   existing `_calendar_owners` declaration, domain migration checksums and
   established owner identities unchanged. It needs one row per established
   owner, exact owner/root/scope identity, `wake_at`, monotonic dirty generation
   and a bounded failure/retry classification. A small scan-state record stores
   the configuration/reconciliation generation, keyset cursor, captured catalog
   tail and an explicit `complete` flag. Seed/backfill in bounded indexed metadata
   pages; new owner establishment seeds its wake atomically, including owners
   inserted behind a running scan's cursor. Resuming a partial scan never implies
   the unseen catalog is quiet. Configuration stamps schedule reconciliation;
   they are not fresh source/effect authority.

   Every relevant Calendar domain/native integration command marks its owner
   dirty in SYSTEM **before** acquiring the private writer lease. Marker-admission
   failure means that private write never started. The one-way order is a short
   SYSTEM admission and release, then private verification/read/write and lease
   release, then a short SYSTEM generation-CAS publication. Never retain a
   Calendar/Jobs SQL lease across a SYSTEM wait or call SYSTEM while holding an
   opposing source lease. Once all in-process owner writes settle, sample the
   current dirty generation, read canonical `calendar.integration.nextWake`, and
   publish only if that generation is unchanged. This must account for the
   pass's own policy/claim/ack writes, not compare against a generation captured
   before them. A crash after private commit but before publication leaves a due
   marker. Failed physical owner proof gets a durable retry/review wake; it does
   not repair the source or silently disappear from coverage.

3. **Bounded Calendar resident leases and fair turns.** Replace total-catalog
   retention with an async bounded resident registry. `ready`, operator control,
   background processing and fresh hydration acquire the same canonical owner
   cell with explicit pins; never create competing controllers for one owner.
   Ordinary readiness remains a fresh physical proof plus capture preparation,
   not dependency activation or a global all-owner readiness gate. Process bounded
   due pages ordered by `(wake_at, owner_id)` with a fixed turn horizon and a
   keyset continuation; a backed-off or permanently dirty early prefix cannot
   starve later owners. The scan cursor/checkpoint and incomplete coverage remain
   visible across restart. One global native absolute wake comes from the next
   due catalog row or unfinished scan, not from the set of resident cells.

   After publishing canonical wake state, release an idle cell only after its
   readiness/intake/controller/dispatcher bodies and local uninvoked-claim cleanup
   have physically settled, and all of its exact native source bindings can
   detach. Closing that idle controller may fence its fresh eligibility; it must
   not close the retained runtime/evidence owner or erase durable retirement
   markers. A partially detachable multi-rule cell must not silently lose another
   rule's physical pin. Keep busy cells charged and apply bounded backpressure;
   do not call an LRU map deletion a safe release.

4. **On-demand dispatch without a lock cycle.** After original Torrent receipt
   inspection, Jobs may request attachment through a fixed native source-domain
   resolver registered by managed composition, not application JSON or a provider
   callback sent over IPC. Resolve the canonical retained source identity and
   exact admitted origin through the existing Jobs native realm/facade, then
   prove the Calendar owner and full current configured policy/pin. Reuse the
   canonical controller/current-policy cell and the read-only attach operation.
   Never hydrate an unselected active rule, locally retired rule, stale A epoch
   during desired B activation, or a source whose original activation is still
   unknown. Wake ordinary durable control reconciliation and return not-ready.

   This path must not await `coordinator.process()`, `dispatcher.runBatch()` or an
   owner intake queue that can be waiting on the same Jobs schedule gate: the
   runner already holds that gate, so doing so creates a cycle. It performs only
   owner/current-policy proof and exact existing-source attachment on the separate
   source gate, with no fresh prepare/activate/create side effect. Accepted Torrent
   facts and transient historical evidence execution continue without resident
   intake allocation; their original owner lifetime survives idle release.

   The native resolver is bound once during managed construction, before Jobs
   start/tick seals the binding, and is retired during quiesce. Source controls
   use a separate bounded WorkPool, not merely a different key in the schedule
   pool: every schedule slot can already be occupied awaiting hydration. Native
   demand tests hold all schedule slots and the owner intake lane while the
   original read-only attachment completes. This is not extra provider work or
   an unbounded background pool.

Implement/review step 1 before Calendar wake/runtime changes. Its concrete files
are `jobs/source-service.ts`, `source-authority.ts` only if lifetime helpers need
to move, `runner.ts` for a physical dispatch pin, and focused native source-gate/
service tests. Steps 2–4 then touch a dedicated Calendar SYSTEM wake module,
`calendar/runtime.ts`, `integration-coordinator.ts`, narrow controller/dispatcher
idle hooks, the native Jobs source-hydration query/facade and
`frontend/server/app-calendar-integration.ts`. Keep public configuration/routes
and release claims behind F3/F9. No app-owned SQL access is introduced.

Required MEMORY gates include more than 64 retained owners and more than 1,024
sequential resident attachments without exceeding either resident bound; physical
pins refusing detach after cancellation until late acceptance/body settlement;
idle detach preserving exact receipts, unknown working/settlement usage and later
read-only attachment; stale capability detach unable to remove a replacement;
retired/unselected/config-A→B attach refusal; zero domain/transport writes or
provider calls during attach; original activation miss never registering fresh;
full global hydration returning recoverable not-ready; and a schedule-gate-held
hydration test proving no controller/dispatcher deadlock. Wake-catalog gates cover
populated metadata upgrade, partial scan/restart with explicit incomplete
coverage, insertion behind cursor, dirty-before-write refusal, private commit
before publication failure, generation races, same-pass self-writes, permanent
early failures, fair later-owner progress and cleanup refusal retaining occupancy.
Operator inspection must distinguish retained owners, resident owners/bindings,
physical pins, dirty/due/backed-off owners and incomplete catalog coverage. Until
scan completion plus native unknown/physical evidence is proved, it must not
report globally quiet or safe-to-disable. Physical restart/file/actor proof stays
under the existing F9 integrity hold.

### F3 implementation contract — managed activation, evidence and adoption

This is an implementation sequence, not enabled public configuration or a passed
readiness gate. Preserve the existing core configuration: `calendar: true` or a
core object already enables authenticated one-off scheduling; omitted/false is
inert, explicit `auth: false` rejects enablement, missing scheduling timezone
requires setup, and unsupported recurrence/reminder/self-booking enablement
fails closed. Do not rewrite those behaviors or imply Jobs/Torrent are missing
from every Calendar application. Core-only Calendar must retain its independent
mount, logging composition and no-integration readiness cost.

**Existing native seams, not replacement infrastructure.**

**Fresh-bootstrap defect found during this review.** A raw fresh MEMORY
`Migrator` running the real Calendar registry, without predeclared domain tables,
fails in `001` with `no such table: main.calendar_resources`. The actor currently
passes migrations to `DatabaseRuntime.open()` before ReactiveDB table definition.
The normal MEMORY service aliases `ephemeral` and skips that migration path, so
its successful open is not a fresh-file bootstrap proof. Resolve the native
initial-table preparation boundary without editing `001`–`016`, predefining a
later schema over retained state or weakening cold owner admission. This is a
required F3 correction, not an acceptable deployment limitation.

The reviewed repair is an optional actor-imported declarative per-migration
table-stage manifest, not replacement `up` handlers. Calendar `001`–`015` each
assume their introduced tables already exist; `016` owns its additive DDL.
The original cumulative checkpoints are `CALENDAR_TABLES`, scheduling, holds,
locations, types, lifecycle, visit bindings, participants, working-hours policy,
integration, ownership, controls, queue, inspection and operator maps, then the
`016` atomic-update map. The corresponding new-table counts are
`8,6,4,8,10,6,3,3,3,8,1,4,1,1,1,3`. Only the first fifteen boundaries request
table preparation. Schema metadata such as `009`'s `_identity` is not SQL column
DDL; its unchanged original indexes still establish those identities.

Generic definition admission must clone/freeze the ordered checkpoint maps,
match every registered version and the final realm schema, and require unchanged
prior-table declarations at a `create-added-tables` stage. Only opted-in realms
include manifest checksums/flags in their native fingerprint. Omitted manifests
retain exact existing behavior/fingerprints. Jobs does not opt in: its original
`001` already owns base-table creation.

Readonly cold classification admits a pristine binding-only file, a genuine
checksum-valid applied prefix matching its checkpoint, or a failed-attempt image
which still exactly matches the preceding applied prefix. It rejects ledger
holes/unknown versions, missing/malformed old tables, unledgered/precreated or
future-stage application tables, mismatched owner and unexplained artifacts
before writable service preparation. Native/legacy ledger recognition remains
explicit; no constructor imports a legacy ledger during this read. Table/ledger
proof is not arbitrary historical trigger-equivalence proof.

Inside the existing original migration transaction, recheck the applied prefix,
create **only** the current boundary's admitted new tables, call its unchanged
`up`, validate the resulting checkpoint, then record original checksum/history/
success. DDL, backfill and success evidence roll back together; the normal failed
attempt remains retained. Never commit a bare baseline first, wrap/rehash an old
`up`, redefine the latest schema before upgrading, or add an outer transaction
around the Migrator's backup/WAL lifecycle. `migrate:false`/current admission
cannot invoke preparation. Realm copy/composition and Guardian-anchor behavior
must deliberately preserve or reject the optional manifest rather than dropping
it. Physical and HOT publication still require qualification.

Implement in a focused `database-realm-migration-tables.ts` plus a Calendar stage
manifest, with narrow realm admission/fingerprint, Migrator per-boundary,
DatabaseRuntime and readonly actor-open integration. Raw MEMORY tests must run
fresh through all sixteen unchanged handlers without predeclared application
tables; stop/reopen/populate each prefix; exercise `011` source ownership, `014`
pending-presence and `016` current-resource backfills; prove no future tables,
atomic failure/retry before/after original handlers and unchanged checksums/
successful ledger rows. Wrong/partial/current-withheld sources must reject with
unchanged bytes and sequence. Normal realms and fresh Jobs remain unchanged.
The source repair now implements this manifest contract and the actual Calendar
realm opts in. Raw fresh and populated-prefix MEMORY tests exercise the real
original migrations, not a latest-schema fixture. The current fingerprint changes
because table-stage declarations are part of realm identity; the genuine previous
016 identity remains an explicit historical policy pin. Physical file/actor/HOT
publication is still unqualified. Current-source admission must not decode all
retained receipt/logging payloads merely to reopen an unchanged file; full retained
source validation belongs to actual preparation boundaries.

- `frontend/server/app-calendar.ts` already composes the canonical runtime,
  participant directory, Guardian facade, logging and routes; it captures provider
  ownership before fallible publication and makes close retryable without
  reopening intake.
- `frontend/server/app-calendar-integration.ts` already prepares one dormant
  Calendar/Jobs/Torrent owner inside an unsealed native dependency hook. Its
  source prepares capture before business writes, its fixed activity can reconcile
  retained evidence before discovery/publication, and its dependency owns physical
  intake/evidence joins and final Calendar provider release. Reuse this owner.
- `app-jobs.ts` already exposes dormant preparation, exact-owner/catalog checks,
  one construction-time dependency, sealing, pre-recovery cancellation and shared
  close. `workflow-plugin-runtime.ts` already waits for `beforeRecovery` before
  recovery/publication. Do not add a Calendar timer system, second Torrent owner,
  service-provider bag or startup promise that recursively waits on itself.
- Native inspection and source-atomic initiating-actor retire/reactivate requests
  already exist. Original actor receipt lookup precedes new desired-policy
  compilation; current Guardian/Logging authority still fences replay and delivery.
  Local acceptance is distinct from downstream control settlement and effect
  completion. Public HTTP/SDK/request-facade mounts are not implemented yet.

**Closed configuration and catalog admission.** Add typed integration admission
in `calendar/config.ts` and cross-service validation/composition in
`frontend/server/types.ts`, with no files, actors, registration, schema work or
timers during configuration resolution. Public configuration must select the
approved F5 series/coverage and F7 reminder/workflow capabilities and their
versioned domain rules. Do not publish the private observation exemplar's
`CalendarObservationRule[]` as the permanent production configuration, or call
observation execution reminder delivery. Keep observation private while it
qualifies the wiring; actual feature enablement stays closed until that feature's
canonical writer, fixed graph, adapters and controller are complete.

Fresh-generation activation and evidence-only ownership need distinct admitted
states. Evidence-only retains the native owner, exact historical graph versions,
source identities, receipt/reconciliation and retirement lanes while admitting no
new feature generation. A zero desired-rule set already supports evidence work;
it is not proof that retained active rules were retired. A retired rule must not
block unrelated bookings, while removal of a still-active rule remains explicit
review/retirement, never inferred cleanup or silent reactivation. Plain omission
or `false` must not be advertised as safe removal of an already-used integration.
Any persisted adoption/disable marker is additive, owner-bound and versioned;
configuration alone cannot reconstruct an unobserved A→disabled→A transition.

Dependencies must be admitted, not silently enabled or replaced. Require the
normal Jobs owner and non-disabled normal Torrent owner, explicit feature/adaptor
dependencies, current Guardian and required Logging admission. Preserve existing
workflow defaults; do not misreport that an already-enabled owner is absent just
because its configuration object was omitted. Compose native source-only Job
definitions into the existing catalog using exact branded identity, and register
the fixed Workflow/activity catalog before application registration and recovery.
Authored reserved-name collisions fail, even for equivalent clones. Retain the
required historical code/graph versions in evidence-only mode. Neither browser
JSON nor public config supplies raw SQL, provider handles, arbitrary activities,
native source capability, workflow pins or recovery authority.

**Normal startup and teardown sequence.** The concrete integration point is
`frontend/server/app-platform-services.ts`, not an application entry point:

1. Resolve the closed capability/configuration graph and catalog composition
   before any optional provider is opened. Register native graphs purely with a
   late lookup of the exact integrated executor; retain the existing Messaging
   registration and app registry callback rather than replacing either.
2. In the existing `beforeRecovery(workflows, {signal})`, prepare dormant Jobs,
   then `prepareManagedCalendarIntegration` using that exact unpublished Torrent
   service and Jobs owner. Supply current managed Auth/Logging dependencies.
   Complete this attachment **before** `sealDependencies()`; the current ordinary
   branch seals immediately after Jobs preparation and must change only for this
   explicitly admitted integration branch.
3. Do not separately call `mountManagedCalendar` for the integrated branch. The
   integrated preparation already creates/publishes its core facade/routes once.
   Continue the existing ordinary mount unchanged when integration is absent.
4. Finish normal recovery/publication. The recovered fixed activity must already
   find its native evidence owner; it must not look up a published service or wait
   for the startup whose recovery it is currently executing.
5. Verify the exact published Torrent owner, await integrated
   `start(scheduler)`, recheck publication after waits, and only then call the
   prepared Jobs owner's `start(scheduler)` to enable automatic wakes. Keep the
   existing absolute Scheduler wake seam; construction, pinning and dormant
   readiness do not start timers or dispatch Jobs.
6. Reuse shared shutdown: quiesce Calendar facade/construction and fresh Calendar/
   Jobs eligibility; join actual Calendar intake and Jobs runner callbacks; stop
   Torrent and join its physical activities; join Calendar evidence callbacks;
   close Jobs and finally Calendar's provider. Preserve exact-owner retry and
   cleanup registration after failures. Cancellation inside an unsealed factory
   may use `cancelPreparation`; it must not recursively stop its waiting Workflow
   initializer or pretend bounded caller drainage is physical settlement.

**Read-only adoption and explicit preparation.** Add a bounded native planning
operation before enabling an existing installation. It inspects existing SYSTEM
ownership and existing Calendar/Jobs/Torrent state without creating files,
constructing a mutating ledger, migrating, pinning, registering sources or
changing any source/receipt sequence. Reuse F1 readonly binding/owner admission
and constructor-free ledger inspection, with actual file identity and query-only
source handles, rather than a new private-SQL application inspection path.
Report configured versus actual realm/catalog/policy generations, stale/missing/
substituted ownership, retained rules and unresolved controls/effects, dependency
and capacity gates, and exactly which explicit preparation is needed. Report
unreadable/incomplete evidence as unknown, not as an empty new installation.
Scope-owned views reveal only the admitted scope; host-wide planning is a separate
trusted setup operation, not a tenant manager's cross-tenant directory.

Current `CalendarRuntime.open` admits the SYSTEM owner catalog, but older established
source files are upgraded lazily by the existing canonical provisioning/bind lane.
Integration discovery is existing-only and must not implicitly migrate them. A
public adoption procedure therefore still needs explicit per-owner preparation
for populated files, rechecking its readonly plan and exact same owner immediately
before preparation, with install permission and preserved original checksums,
records, receipts and semantic identities. Do not rotate IDs, rebind a foreign
file, backfill old appointments into fresh effects, or mark SYSTEM current before
physical preparation succeeds. A current SYSTEM fingerprint with stale physical
ledger is an integrity refusal, not blanket permission to repair. Interrupted
multi-owner preparation needs truthful per-owner outcomes and resumable original
identities; there is no cross-file atomic migration claim.

**Operator facade and safe disable.** Extend the typed Calendar contract and
native service composition with narrow scoped inspection/planning, original
operator-request receipt reads, retire and reactivate operations; explicit setup
preparation additionally requires the host's installation authority. Wire them
through `calendar/http.ts`, native request-service projection and
`frontend/client/calendar-client.ts`, with closed detached payloads, current
browser/Guardian/Logging admission, expected policy selection and stable request
keys. Reuse `integration-operator-request-service.ts`, not direct calls to
`owner.operations`. Native providers/coordinators never become request or activity
services. A source-local retire/reactivate receipt must not acquire invented
downstream fields, physical drain claims or automatic retries after unknown.

The operational sequence is plan → explicitly prepare → activate, then retire
each selected generation → reconcile original controls/effects → retain
evidence-only ownership until native physical/gate and terminal evidence permit
removal. Existing inspection deliberately always says
`evidenceOwnerRequired: true` and observes source/Jobs separately; neither an empty
queue nor a downstream retirement acknowledgment currently certifies safe disable.
F3 still needs a native admission/certificate for removal that covers every
relevant owner/generation and outstanding Jobs/Torrent enqueue, callback, unknown,
review-blocked and admitted-but-unsettled effect. Unavailable evidence or
nonterminal work refuses a safe-disable result. Preserve historical receipts and
readability after intake is stopped; never delete history to manufacture a pass.

**Readiness, Doctor and acceptance.** Keep configuration admission, physical schema/
owner readiness, capture readiness, downstream registration, automatic intake,
evidence availability and channel delivery separate. `readiness: 'configured'`,
an installed route, a running coordinator or a local actor receipt does not prove
the others. Extend `doctor/platform-doctor-calendar.ts` with dependency/catalog
and adoption/retirement findings; replace its outdated core-only capability hint.
Reuse safe existing SYSTEM inspection and the readonly adoption planner for
opted-in operational evidence. Doctor must never start the owner, migrate, create
files, register work or expose appointment/recipient payloads. Missing evidence
is a qualified warning/error, not a health assertion.

F2's native resident-owner/capability path is now source/MEMORY checked: the
64-owner bound applies to active residency, not the retained catalog. Jobs'
resident/source budgets remain shared and finite; larger limits or identity
rotation are not a substitute for safe release. Adoption planning must expose
actual pressure, incomplete coverage and missing physical evidence. Broad
automatic activation still needs actual file/actor qualification and the
completed F5/F7 contracts.

Required MEMORY checks cover omitted/core compatibility and disabled inertness;
invalid/callback-bearing config and missing dependencies; Job/Workflow collisions;
one integrated core mount; exact startup order and retained execution before
publication with dormant Jobs; construction/cancellation/publication failures and
shared physical joins; zero-rule evidence and removed-active-rule review;
readonly new/populated planning with zero mutations; explicit same-owner prepare
and partial preparation outcome truth; scoped HTTP/SDK parsing, current authority,
operator receipt replay/unknown and Logging attribution; and Doctor's no-write,
no-provider/readiness distinctions. Actual createApp/file/actor/WAL/restart/kill,
optional/compliance Logging and installed-bundle adoption remain F9/F10 gates.
The storage-integrity hold currently prevents that physical qualification.

### F4 remaining contract — LocalDate, exceptional override and effective eligibility

Keep `001`–`016` maps/functions, timed payloads, normal receipt digests, half-open
occupancy and historical interpretation intact. Canonical `017` is now registered
with the complete untyped appointment writer, read/transport and connected UI
path. Its pure compiler remains a conversion helper, not booking authority.
The series family must follow the latest reviewed F4 migration (currently019);
no series schema or capability is enabled by the all-day/effective-location packages.
Both genuine pre-manifest and staged016 policy identities
remain retained. Source/MEMORY integration is not physical/browser/package release.

**LocalDate authority.** The private input is
`{kind:'all-day-local-v1',startDate,endDate,timeZone}`, with exclusive `endDate`,
strict Gregorian four-digit dates and at most 31 nominal days. Its frozen output
preserves those facts and adds day count, canonical UTC boundary/occupied instants,
zero minute buffers and runtime/ICU conversion provenance. This is not a timed
input coercion or pinned-tzdb guarantee. Derive each boundary from Temporal's first
valid instant of that date: a midnight gap can start at 01:00; a wholly missing
boundary date fails the roundtrip instead of silently changing its date. Require
a representable four-digit exclusive end; never clip the last supported day.
UTC occupancy is positive and at most 33 elapsed days, not `dayCount * 24h`.
This fits the current 33-day indexed lookback envelope without changing timed
admission or scanning retained history. See
[RFC 5545 event ends](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6.1)
and [Temporal day boundaries](https://tc39.es/proposal-temporal/docs/plaindate.html#date-tozoneddatetimeitem-object-string-temporalzoneddatetime).

The first persistence target is explicitly **all-day appointments only,
untyped-only**. Required fixed-minute resource type policies still reject an
untyped all-day candidate; do not coerce a minute type into a day type or silently
clear a binding. Preserve existing availability semantics: an all-day reservation
must fit actual admitted occupied coverage, not treat ordinary 9–5 windows as
whole-day permission. A reviewed later day-duration type catalog may extend this.
Future APIs need a distinct date-interval branch, reject mixed timed/date input,
preserve omitted interval intent and require explicit conversion between kinds.
Current timed objects and wire digests stay unchanged; new views/renderers branch
on the explicit kind rather than showing an all-day event as timed midnight data.
Store authoritative kind/dates plus immutable conversion history and sealed UTC
occupancy; missing/malformed current metadata fails closed. Title/participant or
status-only edits do not recompute accepted boundaries under a later timezone
engine. Busy responses remain redacted occupied ranges.

All-day blocks/holds remain explicitly unavailable in that first target.
`calendar_blocks`, `_calendar_block_reservations` and `calendar_holds` have
historical 31-elapsed-day CHECKs, so 31 LocalDates spanning fall-back cannot be
made valid by appending metadata. Full support requires a separately reviewed,
genuinely FK/trigger/seal-preserving current-schema migration, preserving rows,
identities, references, counters, receipts and hold-confirmation equivalence.
Do not edit old declarations, blindly relax checks, create fake timed records,
split one logical block into hidden children, or hide a 30-day clamp. A latest
kind-aware 33-day envelope must retain the original 31-day bound for timed rows.
Public capability/readiness remains closed for each family until its complete
writer/query/HTTP/SDK/UI and migration path is qualified. F5 schema starts only
after the reviewed shared interval seam/migrations; its current pure timed source
must continue to reject all-day rules until it has a distinct LocalDate dialect.

**Reviewed canonical package and date-native reading.** Adopt017 only with the
complete appointment writer, query, HTTP/SDK and managed editor/render path—not
as a schema-only release. Keep existing flat timed inputs, outputs and digest
families unchanged. New mutually exclusive nested `interval` intent expresses
`timed-v1` or `all-day-local-v1`; reject mixed shapes. Normalize structure before
receipt lookup, but compile fresh time boundaries only after replay/CAS. Omitted
interval and an identical LocalDate tuple retain the accepted stored fact.
Legacy flat rescheduling of an all-day appointment rejects fresh admission after
original-receipt reconciliation. An explicit nested timed interval performs the
conversion back. Conversion of a typed appointment requires explicit
`appointmentType: null`, and still obeys each resource's current required-type
policy. Hold confirmation produces timed facts; a later conversion cannot make
the original confirmed-hold evidence unreadable.

The implemented `appointments.queryDates` and `watchDates` use exclusive Gregorian
date bounds for all-day appointments. Registered 017 includes sealed kind/date
fields in the current-time projection and an indexed bounded date-overlap lane.
Apply whole-resource details authorization before LIMIT/truncation, as for the
existing appointment query. Do not scan retained time history. Existing UTC
appointment/busy queries retain their meanings and redaction.

The managed workspace combines timed UTC and authored-date watches, deduplicates
logical appointment/revision identity, and renders a dedicated all-day lane in
day/week headers and month cells. It must not fabricate timed-midnight events or
shift authored date labels into the viewer's zone. A Kiritimati-authored January1
can be absent from Honolulu's January1 UTC window; merely widening a window by a
guessed offset is not the public date-query contract. Show the scheduling zone
when useful. Gregorian/string-based helpers must handle supported year boundaries
without host-local Date normalization or JavaScript's year0–99 constructor rule.
The rich editor still uses one async atomic save/receipt owner, preserving newer
drafts and explicit unknown reconciliation. Standalone approved preview defaults
remain unchanged.

**Independent override, canonical019 source package.**

The [reviewed implementation design](./calendar-overrides-design.md) fixes initial
scope to manual one-off appointment overlaps and details the complete authority,
readonly review, keyed witness, final writer, private history and UI contracts.
It is implemented as unreleased branch source, with physical/package gates still
open. See the [native facade guide](../backend/calendar/overrides.md). Preserve the four-right
`CalendarGrant`/`setGrants` replacement contract. Add a separate explicit override
capability, disabled by default, with an independently compiled current Guardian
requirement and separate Calendar-owned object grants/history. Resource ownership,
ordinary manage, platform labels and a prior accepted override do not imply the
new capability. Existing `hasCalendarRight` owner/manage shortcuts cannot decide
it. Require normal all-resource booking/management rights as well as the independent
override check, a nonblank private reason and current policy/decision selection.
Expose only a closed reviewed set of overridable conflict classes; never a generic
`force` flag. Authorization, actor/owner integrity, type/visit/effective eligibility,
unknown coverage, live hold expiry/subject checks and storage/quota safety remain
non-overridable. Recompute the actual conflict decision inside the final short
writer; stale conflict review cannot authorize a different later conflict set.
Conflict discovery/witnesses must not reveal hidden titles, participants or IDs.

One atomic create/update records the actual exception, private reason, policy and
decision digest/history with its ordinary receipt/effect; semantic evidence reports
safe categories and reason-presence, not free text. No-op or refused operations
manufacture no override success. Original receipt replay precedes fresh exception
admission but still requires current object/view authority and grants no new power.
The UI obtains current allowed actions, requests a reason/review and uses the same
async owner/receipt/unknown boundary; declining that interaction performs no write.

**Effective eligibility, not a new identity/provider system.** Current source
already enforces active resources, all-resource grants, pinned active type duration/
buffers, common active in-person location versions, bounded weekly-local hours/date
overrides, blocks/live holds and synchronous SYSTEM checks for newly added native
participants. Do not rewrite these as another permission engine or reinterpret
resource owner/profile preferences as clinical credentials. The implemented 018 native
geographic increment is scope-owned versioned effective resource/location assignment
coverage, admitted against the whole resulting occupied interval under the same
resource revision and writer decision. Legacy static assignments retain their
all-time meaning until an explicit policy replacement; legacy replacement APIs
must not flatten a richer effective policy. Interval-aware authorized location
discovery aids selection, while ordinary location/region facets remain directory
filters rather than permission. No remote jurisdiction, licensure or patient-state
guarantee is inferred from those fields. Asynchronous app-file eligibility remains
unavailable without an independently reviewed synchronous final consistency fence.

Restrictive policy changes preserve accepted history; fresh booking/hold confirmation
and meaningful occupancy/resource/visit changes revalidate the resulting candidate.
Unchanged history, cancellation, receipt reconciliation and unrelated title edits
must not require fresh target eligibility. Keep newly added participant checks and
their existing SYSTEM final fence separate from retained unavailable references.

Canonical 018 supplies `locations.policy.get/replace/watch` and the corresponding
private native HTTP/SDK/hook surface. The closed formats are `static-v1` and
`effective-utc-v1`, with bounded normalized UTC windows per location. The original
004 directory union keeps its facet/visibility role, while explicit legacy versus
policy selectors and immutable source/window history own eligibility. Original
017 data and receipts are preserved; new resource creation initializes its selector
in the same transaction. Adopted state cannot disappear into a legacy fallback.
Fresh legacy replacement refuses an effective policy after original receipt
reconciliation. Explicit static policy is the deliberate downgrade path.

`locations.forVisit` accepts optional occupied UTC bounds and qualifies the whole
common set before pagination. Omission remains directory discovery, not free-time
or all-time eligibility. The connected rich editor uses representable timed bounds
with buffers and unchanged all-day frozen facts; new/changed LocalDates disclose
save-time eligibility rather than guessing UTC in the browser. All native final
writers still enforce the exact policy. See the
[effective-location contract](../backend/calendar/location-policies.md) and
[qualification record](../backend/calendar/qualification.md). Management UI remains
separate unfinished work; canonical019 adds only the documented one-off overlap
review/save and composable grant APIs, not a complete management screen.

After the pure compiler, review the actual current-schema migration and canonical
interval/override/assignment contracts before implementation. Qualify populated
`016` upgrade preservation and atomic corrupt-upgrade refusal; 23/25-hour dates,
half-hour changes, midnight/whole-date gaps, leap/year boundaries and 31-day DST
spans; all-resource timed/date conflicts and adjacency; hold/block kind refusal;
independent permission/owner/manage cases and revocation at final commit; reason,
stale-decision, rollback, no-op/replay/unknown truth; effective assignment boundaries,
grandfathered history and private discovery; and native editor/list/month/all-day
lane lifecycle. MEMORY evidence cannot replace the still-blocked real file/actor,
FK migration, browser/layout and performance gates. F2 hydration remains first for
automatic integration activation.

The earlier preparatory appointment-only storage increment introduced the reviewed
additive parent kind, immutable time history, forward-only current pointer,
singleton state and effect/update-history seals before `017` was registered.
Ordinary timed rows receive no fabricated semantic history. Native structural
normalization precedes replay; identical accepted date/zone tuples reuse frozen
UTC/provenance without Temporal. The latest map copies/freeze-protects historical
declarations. Exact empty partial additions can be admitted; malformed/populated
additions, missing `016` state and unexpected new-table SQL artifacts are rejected.
Canonical commands, read records, HTTP/SDK and the rich editor are now wired to
registered 017 as recorded above. This remains feature-branch source, not a released
all-day capability or completion of the rest of F4.

### F5 implementation breakdown — canonical series and coverage

This is the next **proposed** native vertical, not an enabled API or a passed
runtime gate. Keep recurrence configuration closed until creation, exceptions,
one/future/all edits, splits, on-demand/automatic coverage and their connected
controllers work together. The reviewed timed engine is the compiler foundation;
its 366-day query/work caps are not a permanent 31-day product horizon. All-day
LocalDate series remain an explicit F4/F5 contract, never UTC-midnight conversion.

**Source families.** Add after `016`, preserving every historical map/function:

| Private records | Owned facts |
| --- | --- |
| `calendar_series`, `_calendar_series_generations`, `_calendar_series_segments` | Stable lineage/segment IDs, current published revision, immutable authored source/template, scheduling zone/fold, authority/policy and engine generations, split predecessor and nominal cut. |
| `_calendar_series_occurrences`, `_calendar_series_occurrence_versions`, `_calendar_series_exception_history` | Unique `(lineage, segment, nominal key)` and stable logical appointment ID; immutable effective booking versions; explicit cancel/move/addition facts. Moving one instance never changes its anchor; EXDATE does not refund RRULE COUNT and extra dates do not consume it. |
| `_calendar_series_publications`, `_calendar_series_publication_cells`, `_calendar_series_cell_members` | Durable preparation, immutable candidate facts and bounded working cell projections; a single publication marker exposes the complete change. Current cell selection indexes exclude retired/aborted preparation, not scans of retained history. |
| `_calendar_series_resource_epochs`, `_calendar_series_coverage`, `_calendar_series_resource_members` | Current resource obligation index and sparse **UTC occupancy-slab** certificates, bound to the exact resource/series reservation epoch; per-effective-version resource sets remain bounded like `016` current membership. |
| `_calendar_series_receipts`, `_calendar_series_native_receipts`, `_calendar_series_effect_intents` | Human command acceptance/publication links, source-owned batch outcomes and immutable child revision/binding seals. Human keys share the existing `(scope, principal, requestId)` namespace, including operator commands; native keys are a distinct `(scope, established owner, series generation, logical command)` family. |
| `_calendar_series_horizon_intents`, `_calendar_series_horizon_dispatch` | Indexed bounded native claims, original Jobs operation/receipt associations, due/lateness and reconciliation, using the existing coordinator/source bridge rather than another timer. |

Series children need immutable candidate/effective versions so a large edit can
prepare without changing an accepted appointment. The common appointment resolver
must select their published version and bounded resources; ordinary one-offs keep
the `016` representation. Factor booking/type/visit/participant/occupancy admission
into shared canonical helpers, not a second implementation of those invariants.
Add cross-family logical-ID guards and additive seals for the new effect family;
the old type/visit/participant/resource seals must not become bypassable merely
because a child was committed by native series work.

**Commands and cutover.** Proposed `series.preview/create/editOne/editFuture/`
`editAll/cancel`, change inspection/watch/abort and native
`series.coverage.prepare/commit/reconcile` all have closed payloads. Omission,
reason rules, expected series/child/exception revisions and explicit
preserve-versus-rebase exception policy participate in the normalized human
intent. Exact receipt replay precedes fresh compilation. A plan receipt means
**accepted for preparation**, not that all reservations changed; only its matching
publication receipt may settle the UI as applied. Rejection before acceptance,
blocked preparation, publication and unknown settlement remain distinct.

Fixed native compilation runs outside SQL and Guardian leases. The private broker
binds detached candidates to the authored intent hash, source/cursor/exception
revisions, current code/policy generation and resource revision vector; browsers
cannot submit compiled UTC candidates, cursors, grants or publication markers.
The source writer verifies that exact native contribution and current CAS/final
authority, then writes bounded batches. Small changes may use the same protocol's
bounded fast path. Large plans stage capacity-consuming, expiring reservations;
exclude only their exact selected old occurrences, never the whole series or other
staged candidates. Old published reservations stay authoritative throughout.

Publish one complete manifest atomically after every batch/claim/expiry/policy
fence is current. Candidate appointment and resource-occupancy cells are indexed
by fixed UTC ranges plus publication identity, so queries select current cells
before pagination and never scan all superseded generations. Prepared-cell working
membership is bounded separately from immutable evidence. A stale base requires
explicit recompile/review; no partial visible sequence of browser updates may be
called an all-series edit. Configurable horizon, cell, recipient, exception and
edit-work/storage budgets need actual file-mode qualification; exceeding a short
writer budget invokes durable staging, not a hidden months-ahead restriction.

`editOne` keeps the nominal anchor. Time/template-only future edits preserve
existing anchors; repeat-pattern replacement explicitly splits at a reviewed
nominal key, retains the predecessor's past/accepted facts and records replaced
future identities rather than silently renaming them. “All” must name its policy:
all **unstarted** occurrences plus future source, preserving past/terminal facts;
an authorized historical one-instance correction is a separate explicit action.
Legacy appointment update/reschedule/cancel/transition/participant commands must
reject a series child after current object admission and direct callers to the
canonical series action; they cannot make an unrecorded exception.

**Coverage and native authority.** A nominal engine watermark is not a UTC
availability guarantee. On demand, compile every current series obligation that
can overlap the requested UTC slab, including maximum elapsed duration/buffers,
zone offsets, moved exceptions and split segments. A certificate is published only
when all required reservations/conflicts are accounted for at the same resource
epoch. Writes read indexed current certificates plus live occupancy/holds/staged
claims in their final transaction. Missing coverage yields checking/setup/blocked,
not free. A month-ahead request drives bounded on-demand qualification of that
slab; it need not materialize every intervening date or wait for wall-clock time.
Resource/time/rule/exception changes invalidate the relevant proof atomically;
ordinary live reservations still use fresh conflict checks. Missing working-hours
coverage is separately qualified from its exact retained policy generation.

Finite weekly working-hours coverage and effective-location windows are authored
authority, not disposable caches. Automatic series continuation must never move
their end dates or reinterpret missing coverage as unrestricted. A rolling source
format would need its own explicit reviewed policy contract. Preserve these
independent fences when qualifying a later series occupancy slab.

The current bounded pure expander restarts from DTSTART and has a 4,096-candidate
work ceiling. It is not, unchanged, a durable continuation protocol: sparse rules,
invalid local dates or gaps can exhaust work without emitting a reservation.
Before automatic materialization, persist source/engine/generation-bound progress
that advances over examined nominal candidates even when none are emitted. Keep
RRULE valid-occurrence counting distinct from EXDATE/additional-date handling;
do not refund COUNT for an excluded occurrence or consume it for an added one.
An unqualified cursor cannot issue a UTC coverage certificate, and caller-authored
cursors/compiled cells cannot authorize native writes. Test zero-output batches,
long sparse histories, engine replacement and recovery without a forever-retry
loop or source-wide scan at every continuation.

Automatic work uses a fixed source-owned **SeriesGrant**, not the initiating
user's retained session or an invented `CalendarActor`. Separate reservation
authority from factual `createdBy`/initiation. Fresh source ownership, generation,
resource/type/visit policy and synchronous native SYSTEM participant eligibility
are checked at the actual commit fence, including after pool waits. Persist a
source-owned continuation bound to the qualified engine/source generation;
COUNT/gap progress is never asserted by browser JSON or recomputed over accepted
history after an unreviewed timezone-engine change.

One fixed horizon Jobs/Torrent definition coalesces indexed work per established
scope owner, not one source/timer per appointment. It performs the same preparation
and publication protocol, reconciles original identities across every crash
boundary and cannot revive retired generations. Source cancellation cutoff and
actual physical settlement remain distinct. Logging records human acceptance and
real publication/materialization facts once, not claims, polls or retries.

**Implementation order and gates:** (1) source/authority/receipt plus immutable
version/publication schema and genuine populated `016` upgrade; (2) atomic native
batch/cell staging and publication with shared booking invariants; (3) complete
one/future/all/exception/split commands and legacy guards; (4) sparse coverage,
on-demand qualification and fixed Jobs/Torrent continuation; (5) scoped facade,
SDK/hooks and reviewed connected controls. Qualify false-free prevention, whole
change rollback/cutover, concurrent booking and competing plans, moved identity,
COUNT/UNTIL/DST, unknown replay, revocation during every wait, stage expiry,
retirement/engine change, coverage gaps, bounded query plans and nonterminal drain.
This completes F5 only together with the physical/browser/release gates—not when
the first series row or preview is implemented.

#### First implementation family — compatibility and admission before series writes

The complete `016` baseline is captured before this family changes the registry:
realm fingerprint
`sha256:2b0e98dabe59b6cf27edf49b3bb37b3f11dc6b1e6d0274c6a590db5a3ba601b5`,
declared schema
`a9de3c82718367f9dfb5db628706f7a2b2fda542d12fc27be8d2d589a8d1f2a4`,
and `016` migration checksum
`0553be4d7a34a76f3e0c9335f056c7abaefab7fac910c127d503060ee061a2d8`.
Retain its exact table map, migration functions and explicit command/query name
lists in genuine historical fixtures; filtering a later registry by version is
not a historical definition. Pin native compatibility before appending the next
reviewed interval/series migration; this series plan does not reserve `017`.

The first source increment has factored `appointment-type-bindings.ts` and `visit-bindings.ts` into private
scope-only policy/catalog primitives, retaining their existing actor-taking
wrappers. Their current policy implementations use only `actor.scopeId`; this
does not justify creating a synthetic actor. The private `booking-admission.ts`
owns one canonical `CalendarBookingCandidate` (normalized interval, complete
resource set, type/visit references) and returns detached accepted snapshots.
It performs **both** policy intersections before either selected catalog lookup,
then exact duration/buffers, working-hours and live occupancy checks. Explicit
create/edit revalidation masks preserve current grandfathering: all resulting
resources for changed occupancy, added resources for availability on an unchanged
interval, and the existing type/visit change rules. No-op/terminal checks, current
old-manage/new-book authorization, participant-manager admission, CAS, replay,
budgets, binding/history writes, receipts, effects and audit stay in their existing
human wrappers. Hold confirmation keeps its exact captured hold exclusion. Prove
unchanged old digests/results and rollback before routing series through this core.

Native series admission is a separate fixed owner-bound route, analogous to the
existing `CalendarIntegrationOwner`, not `CalendarActor` JSON. Its broker injects
scope/physical owner identity and final synchronous fences; callers cannot supply
those fields or compiled candidates. A durable **SeriesGrant** names exactly the
series/source generation, sorted permitted resources and allowed native operation
set. Issuance requires the configured trusted series authority and current human
resource admission; a human request is not itself an enduring user session.
Actual batches recheck the immutable owner, live grant/retirement generation,
resource activity and current type/visit/availability policies. New occurrences
re-admit every participant in SYSTEM at COMMIT; an edit checks the explicit added
reference diff against the accepted child revision. No leases surround expansion
or Jobs calls. Do not expose this route before the final participant fence works.

The first additive schema contract is intentionally private/inert until the later
publication/occupancy families are complete. Proposed row grains are:

| Record | Required identity and binding columns |
| --- | --- |
| `calendar_series` | `(scope_id,id)`, monotone `control_revision`, factual `created_by`, lifecycle, current grant ID, published generation/publication IDs (nullable before first publication), at most one active preparation ID. A source acceptance revision is not an appointment publication revision. |
| `_calendar_series_generations` | Unique `(scope_id,series_id,generation)`; immutable normalized authoring/template JSON and digest, predecessor generation, base publication ID, engine/policy generations, acceptance receipt ID. Timed-local and eventual native-LocalDate kinds are distinct; do not persist a falsely converted all-day rule. |
| `_calendar_series_segments` | Unique stable segment ID within lineage; generation, predecessor segment and explicit nominal cut, immutable start/rule/template and local bounds. Time-only future edits retain anchors; pattern replacement creates a named successor segment. |
| `_calendar_series_grants` | Unique `(scope_id,series_id,grant_revision)`; established owner/source identity, source generation, allowed operation/resource digest and issuance evidence. Immutable grant facts plus a current pointer/retirement epoch, never credentials or profile data. |
| `_calendar_series_receipts` | Existing human key hash `(scope,principal,requestId)`; intent digest, series/control revision, accepted preparation ID and base publication ID. Immutable acceptance cannot say applied. |
| `_calendar_series_native_receipts` | Domain-separated owner/source/generation/phase/logical-batch key; exact candidate/cursor/policy digest and outcome. Original-key reconciliation survives claim expiry; a fresh claim is not a fresh operation. |
| `_calendar_series_publications` | Unique preparation/publication identity; series/base/new generation, accepted source/grant generation and complete immutable manifest digest. Mutable preparation/claim state is separate from the immutable final publication fact. |
| `_calendar_series_effect_intents` | Human/native receipt family discriminator plus exact receipt, source generation, publication and child-version bindings; one seal per real accepted effect. This does not yet authorize legacy appointment-table writes. |

Private acceptance and publication contracts are separate discriminated results:
`series.plan.accepted` carries `requestId/seriesId/controlRevision/preparationId/`
`basePublicationId`; `series.publication.applied` carries the preparation and exact
published generation/manifest identity. A joined status read may report preparing,
blocked, published, aborted or unknown, but never mutates the original receipt or
settles an editor from plan acceptance alone. Public facade types remain absent
while recurrence config is closed. Native keys use the fixed
`calendar-series-native-v1` domain and never share the human principal namespace.

Extend one fixed-family human-key resolver across ordinary, block, hold, location,
type, lifecycle, operator and series receipts in **both** directions. This remains
a bounded number of indexed point probes; do not add an unbounded history union.
The next reviewed series migration's additive insert guards must prevent a series acceptance and any existing family
from occupying the same human tuple, including INSERT OR REPLACE. Existing
001–016 SQL/source/checksums remain exact. The native receipt family is distinct
and cannot be used to grant human replay access.

Before any runtime mutation, review exact DDL, identity/scope/FK/retention/late-seal
guards and CAS transitions against these grains. The migration must create and
validate its own tables before ReactiveDB definition, leave all old rows/usage/
sequence/effects intact, and roll back new DDL on late failure in a genuinely
populated `016` native MEMORY upgrader. Admission factoring is a prerequisite,
not permission to activate partial series creation or bypass sparse coverage.

### Recorded implementation decisions and boundaries

- Keep one private conflict domain per admitted application/tenant scope, not one
  file per provider and not a change to the app's own data topology.
- Preserve durable proof/history in the existing Fabric-backed services. Separate
  bounded work occupancy from permanent history and give history an explicit
  configurable operational budget with visible pressure. Do not add the separately
  planned backup/archive service, delete unknown proof, recycle logical identity,
  or claim bounded disk plus unlimited retained writes.
- Source-owned horizon maintenance will reuse Jobs scheduling and pinned Torrent
  runs. Appointment recurrence follows Calendar/RFC semantics, not Croner. Only
  bounded upcoming effect work enters the working schedule window.
- Organizational work retains independent service authority. Initiating users are
  provenance, never reconstructed background sessions. Private read/commit/effect
  fences remain separate from physical completion and provider delivery.
- Retire-before-disable is explicit. `calendar:false` stays inert and cannot record
  a retirement that never happened. Retained unknown work requires an evidence-
  capable setup and visible resolution, not silent provider removal.
- Keep the existing browser-session ceiling until native/API-key parity is
  separately implemented and qualified. Facebook/external-calendar integration,
  cross-tenant atomic booking, a backup service and legal certification are not
  added to this Calendar finish line.
- Review-mode booking supports an explicit capacity policy: reserve with bounded
  expiry, or unreserved request with a fresh conflict decision at approval. Neither
  may be shown as confirmed or guaranteed before its canonical acceptance.
- Optional contact/guest/Storage/presence/AI/channel capability must either have an
  admitted adapter and end-to-end proof or remain explicitly unavailable. Never
  silently widen Guardian-user references or expose private provider handles.

### Execution and verification discipline

From source checkpoint `22dcdad`, deliver the remaining work in this dependency
order, reviewing coherent end-to-end packages rather than announcing isolated
helpers as finished features:

1. Finish **F2 hydration**: first read-only native attach/physical-pin-aware
   detach, then durable SYSTEM wake/scan coverage, bounded resident owners and
   schedule-gate-safe demand admission. Prove pressure, cancellation and recovery
   before permitting idle eviction. Preserve the already-checked final-writer
   capacity and cold-owner fences.
2. Finish **F4/F5 canonical scheduling**: LocalDate/all-day and separately
   authorized overrides; persisted series, exceptions, one/future/all edits,
   staged atomic publication and on-demand UTC coverage. Shared booking
   admission is already factored; no second authorization or conflict engine.
3. Finish **F6 booking/invitations** using those canonical reservations: real
   offers and scoped proofs, any-provider allocation, review/approval semantics,
   capability expiry/revocation and no private busy-detail exposure.
4. Finish **F7 actual effects and F3 managed activation** together: admitted
   native notification/email/workflow adapters, due/lateness/recipient checks,
   original evidence reconciliation, then normal startup, read-only adoption,
   explicit preparation/retirement and scoped operator/Doctor APIs. Do not ship
   the private observation example as reminder delivery.
5. Complete **F8 connected UI** over those real capabilities: optional clinical
   axes and reason actions, resource/location/catalog/hours/grant/block
   management, all schedule/list/context entry points and public self-scheduling.
   Preserve approved compact anatomy, tokens, native motion/icons/surfaces and
   robust setup/empty/denied/unknown states. No editable control may pretend to
   persist an unsupported field.
6. Freeze the whole candidate for **F9/F10**: verified storage, real file/WAL/HOT
   and worker failure/recovery, actual Chromium, measured file-mode performance,
   full repository release checks, exact installed Linux/archive/updater
   acceptance, final docs/adoption handoff, both remotes and normal release
   selection. A passing source checkpoint is not an updater-ready artifact.

Implement F1/F2 foundations before opening automatic integration; pure F4/F5
domain/engine and F8 component work can proceed independently behind closed
capabilities. Connect canonical persistence, facades and UI together per feature,
then integrate real coverage/effects and public setup. Do not keep declaring tiny
internal slices as if the full system were almost released.

Each package has focused native tests and independent security/lifecycle review.
Run the broad frozen candidate suite and exact-package/browser/Linux/updater gates
once the complete candidate is ready, rather than restarting unrelated release
qualification for every source iteration. Document baseline versus later focused
checks honestly; follow repository rules if a runtime change invalidates the final
candidate. All generated fixtures need exact ownership and `finally` cleanup.

The current filesystem-integrity hold blocks physical fixtures, installs, builds,
Docker and release packaging. Source work and the established cache-off MEMORY
checks can continue; no internal-disk fallback or fabricated deployment pass is
allowed. Verified filesystem recovery is an external prerequisite for F9/F10,
not a reason to mark unfinished implementation complete.

## 1. Review outcome and baseline

The earlier handoff correctly preserves the UI and identifies eight important
backend prerequisites. It does not yet specify complete configuration, service
admission, consistency, mutation, live-query or operational contracts. This plan
fills those gaps; it does not replace the reviewed visual design.

Use source `b237bf40bb491bcc71d3bc957ffa288f67d269d4` for this review. It includes
source-verified follow-up worker context, detached workflow audit-lifetime,
Jobs query-plan and direct-dependency fixes. Those fixes are **not** in the
selected 2.11.0 archive at `4d2eb26034783cb77622a249c0cc57f48760331e`.
Require the matching newly qualified artifact before a calendar deployment
relies on them; see the [foundation review record](./durable-jobs-and-workers-plan.md#post-release-review-boundary).

The review found three core integration gates, not capabilities to assume:

1. A calendar source outbox has no existing source-bound Jobs scheduling facade.
   Current `ScopedJobs` still requires a live session even when execution is
   service-owned. Add a narrow verified source/service bridge before relying on
   outbox-to-Jobs scheduling; do not fabricate user authority or use `unsafe`.
2. Jobs `service.isEligible` is synchronous, not an asynchronous calendar Fabric
   lookup. Define its limited policy role and an actual fresh calendar-state
   check before dispatch/effect; never close over a stale appointment snapshot.
3. Current retained Jobs budgets are finite. A production reminder design must
   qualify schedule/receipt/occurrence lifecycle and capacity, not allocate an
   indefinitely growing schedule for every reminder and assume automatic pruning.

Existing building blocks are [scope-bound request services](../backend/runtime/server-services.md),
[Fabric](../backend/fabric/index.md), [Guardian](../backend/guardian/index.md),
[Jobs](../backend/scheduler/durable-jobs.md), [Torrent enqueue](../backend/torrent/enqueue.md)
and [worker/service composition](../backend/workers/service-integration.md).

## 2. Product scope and defaults

One opt-in native calendar system must serve personal calendars, organization
scheduling, resources/rooms and delegated schedulers. Clinical scheduling is a
configurable preset/example, not the domain model or a requirement for every app.

Recommended defaults, subject to product approval before implementation:

- `calendar` omitted/false: mount no calendar routes, files, actors, definitions,
  timers, subscriptions or provider work. Retained state is not deleted.
- Enabling core calendar requires Guardian and a valid private Fabric placement;
  explicit `auth:false` is rejected. Do not change application tenancy/topology.
- The small default offers private authenticated calendars, one-off appointments,
  resources, availability, blocks and the reviewed day/week/month/list UI.
  Public self-scheduling, outbound channels, AI and automatic clinical behavior
  are off. No fictional providers, patients, locations or demo settings are seeded.
- Recurrence, automatic horizon maintenance and reminders have explicit capability
  settings. Durable work requires admitted Jobs/Torrent registrations; an explicitly
  disabled dependency is never silently overridden. Decide whether the simple
  enablement shorthand includes recurrence during configuration/API review.
- Scheduling timezone must be deliberately selected before publishing availability
  or bookings. Do not infer it from the host, browser, a user's preferred zone,
  a geographic filter or a provider's current presence.
- Missing optional email/messaging/Storage/AI providers make that capability
  unavailable; they do not prevent unrelated core calendar use or trigger installs.

Make the dependency matrix explicit: core one-off use needs Guardian/private
Fabric only; automatic recurrence-horizon maintenance and future-due effects need
Jobs/Torrent; immediate durable transition hooks use Torrent without inventing a
timer; each outbound channel needs its configured adapter; AI, media and presence
are independent optional capabilities. Pure bounded recurrence preview
alone is not automatic future reservation. If a dependency is unavailable, disable
the dependent capability with a clear setup state rather than partially enabling it.

## 3. Configuration and existing-project adoption

Design typed `CalendarConfig` with pure resolution before side effects. Admit
and detach trusted callbacks, reject unknown settings/accessors and invalid limits,
and expose only a safe capability/readiness summary to clients. Configuration
resolution is not proof storage or adapters are ready.

| Configuration area | Required design |
| --- | --- |
| Storage/lifecycle | Private root, fixed actor launch, explicit child environment, file/hot placement and bounded active databases/readers. File is first-class. |
| Access | Guardian requirements plus calendar/resource/object grants; delegated scheduling and management are independent. |
| Time | Scheduling/default display zones, week start, visible hours, supported precision, recurrence dialect/horizon and DST behavior. |
| Catalogs | Generic appointment types, durations/buffers, visit modes, colors, resources, locations and optional clinical transition preset. |
| Policies | Conflicts, exceptional overrides, holds, booking windows, cancellation/reason rules and series-edit behavior. |
| Integrations | Versioned reminder/workflow definitions; separately enabled channel adapters, directory adapters and optional AI tools. |
| Limits | Bounded query ranges/pages, occurrences, participants, holds, input sizes, worker/provider occupancy and retained-state budgets. |
| Delegated settings | Code-owned ceilings; optional scope-admin-editable schedules/catalog settings with revisions and semantic audit. No executable/provider-secret settings in browser JSON. |

Code establishes allowed capabilities and policy ceilings. If delegated settings
are included, scope administrators may change only declared fields, with expected
revision and current permission; tenant settings cannot enable a platform-disabled
channel, weaken global privacy or choose a provider endpoint/actor entry.
Do not make the first release depend on building an unrelated general config UI.

Catalog/type/mode/status/resource IDs are stable and versioned. Deactivation or
replacement must preserve historical interpretation and readable old appointments;
never silently relabel/default an unknown retained value or convert it during an
unrelated edit. Define read-only preservation versus explicit reviewed migration.
Removing a calendar/location/resource does not implicitly erase appointment history
or cancel future reservations without an explicit authorized operation.

Specify a bootstrap-owned durable policy generation and final fences, or qualify
single-runtime exclusion that prevents overlapping old policy owners. Read, write,
after-await and effect boundaries must reject retired policy/channel/adapter handles.
Configuration A → B → A is a new generation, not revival of the first A. Snapshot
revision metadata alone does not retire another process. Disable/re-enable follows
the same rule and never deletes retained state.

Expose disabled, setup-required, ready and blocked states with safe reason codes.
An empty calendar is not a failed mount. Missing established storage is blocked,
not an empty-start screen. Setup must be recoverable by the actual delegated
manager, including non-admin schedulers in single/advanced configurations.

For an existing app: Doctor/read-only planning reports required permission-registry
version changes, SYSTEM owner/catalog migrations, private roots, missing adapters,
build entries and conflicting paths. Use normal explicit migration preparation;
preserve users, assignments, Storage, app schemas and retained evidence. Never
reset Guardian to install new calendar permissions, auto-convert single tenancy,
inject demo data or overwrite public/authenticated theme tokens. Test disable,
re-enable and same-version replay against populated retained state.

## 4. Ownership and private Fabric placement

Recommended placement is **one private calendar conflict domain per admitted
application/tenant scope**, with multiple calendars/providers/resources inside
that file. Single tenancy uses application scope; multi tenancy uses the current
committed tenant scope. A selection session is not tenant calendar access.

This feature-owned Fabric plane must work independently of the app's primary
shared-row versus tenant-file topology. `zero.data` is intentionally unavailable
for some app modes and does not supply calendar object policy; never fall back
to raw primary SQL or `unsafe` when it is null.

Use the messaging/Jobs ownership pattern: SYSTEM stores private ownership/wake
metadata, while the calendar file stores domain records, receipts and source
intents. Pin opaque file identity, root identity, owner, schema/realm fingerprint
and established state. Reject overlapping/aliased roots across app, SYSTEM,
calendar, Jobs, logging, blog, messaging, Storage and build/public paths.
Missing established files or mismatched identities require explicit recovery.
Actors never boot the app or inherit dotenv/provider credentials.

Do not create a file per provider: an appointment reserving a provider and room
needs one short atomic conflict decision. Cross-tenant/cross-file atomic bookings
are outside the first contract; reject them rather than promising distributed
transactions. Scoped calendar data is not a cross-organization directory.

Conceptual records (names/schema still to be designed):

| Records | Owned facts |
| --- | --- |
| Calendars/resources/locations | Stable identity, timezone, capacity, effective assignments and object grants. User identity references are not a copied user store. |
| Types/availability/blocks | Versioned permitted types, working intervals, exceptions, duration and buffer/capacity policy. |
| Series/occurrences/exceptions | Recurrence source, nominal occurrence key, effective time, revision and cancellations/splits. |
| Appointments/participants | Actual reservation, generic lifecycle and authorized person/contact/guest references. |
| Holds/requests | Expiry, resource reservation, subject/proof binding, request-versus-confirmation state and consumption receipt. |
| Reminder/effect intents | Immutable logical identity, source revision, eligibility, channel status and reconciliation history. |
| Command receipts/outbox | Duplicate-safe accepted mutation and durable integration handoff, atomically owned by the source file. |

Index range/resource/state/expiry and outbox discovery explicitly. Stable IDs
must not be derived from mutable names, current email addresses or a retry number.
Define deletion, tombstones, holds and receipt retention before admitting writes.

Choose identity-reference admission explicitly. The recommended small first model
uses server-validated opaque canonical user/membership references, with scope checks,
deactivation/deletion tombstones and no pretend Guardian foreign keys. If native
Guardian foreign keys are introduced instead, register and qualify the separately
owned calendar plane as an identity-projection target, including ownership/readiness
barriers; app/tenant projection is not automatically installed in every private realm.

## 5. Guardian, privacy and directory integration

Close every normal service/HTTP/query/watch facade over existing `ServiceDataScope`
and live authority. Browser input cannot choose a tenant, principal, path or database
reference. Verify Guardian and domain policy before reads, after asynchronous
lookups, at final mutation admission and before delivering private results.

Keep these grants separate: free/busy visibility, appointment details, participant
details, booking own/another calendar, editing/rescheduling/cancelling, status changes,
availability/catalog management, self-booking eligibility and exceptional conflict
override. Compiled Guardian requirements plus calendar object grants own access;
do not hard-code a global `admin`/provider label as the whole policy. Current
server-derived allowed actions aid UI discovery but never authorize a mutation.

Location/state/property filters operate only within the already authorized set.
A provider may have multiple effective state/location assignments; self-editable
profile properties cannot grant eligibility. Tenant-local assignments belong in
the calendar/domain scope, not global canonical user profiles. Use only admitted
trusted Guardian properties for authorization; a preference is not a permission.
Empty geography facets mean all currently admitted choices, while an empty selected
calendar/resource array remains empty. Prune invalid selection/focus explicitly;
do not silently select a different provider or broaden a narrowed view. Valid no
matches, loading, setup and denial have different presentation states.

Return distinct busy-grid and detail projections. Busy-only responses must omit
titles, attendees, notes, reasons, contacts and private IDs not needed by that view;
CSS hiding of a full appointment is not redaction. Authorize counts, facet values,
search, pagination and exports too, to avoid query oracles.

Define a bounded authorized directory adapter for staff, contacts and app-defined
participants (a patient is an app participant type, not a core user kind). Manual
guests have separate identity/proof/consent contracts; never create fake Guardian
users. SYSTEM remains canonical for profiles; shadow identity anchors are not
names, avatars, status, permissions or a license to read another person's profile.
Use native authorized profile/avatar/presence projections and retire their caches
with scope. Presence is optional UI context, never attendance or bookable capacity.

App-specific participant eligibility needs an explicit consistency contract.
Guardian and calendar-owned grants can have final canonical fences; an asynchronous
app-file lookup is not a cross-file atomic security check. Where an adapter cannot
prove the required current fence, fail closed for that policy or require a reviewed
calendar-owned authority projection with hydration/revocation semantics. Do not
claim that a stale directory snapshot makes a domain invariant atomic.

Browser-session admission is the baseline. Native sessions need explicit proposed
calendar credential ceilings and parity across native configuration, authorization,
discovery, consent, client types and SDKs before calendar use is admitted. Existing
`profile`/`profile:write` scopes and Guardian roles alone do not grant that native
capability; test narrowed/missing scope and client/session revocation. API-key/
machine calendar access, if included, needs separately declared capabilities and
scope projection—not automatic reuse of actor-only Jobs/Workers. Public booking
has its own proof below. Deferred credential types must fail closed and be documented.

## 6. Public facade and domain commands

Proposed server request surface: nullable `zero.calendar`; proposed SDK surface:
`client.calendar`. Add both through normal request projections, client lifecycle,
HTTP serialization, authorization and exports—not a privileged service bag exposed
to an app/browser. Keep lifecycle/registration on trusted setup only.

Organize server code under `src/calendar/`; preserve UI under
`src/components/calendar/`. Use a separate focused server entry, not server imports
in the existing browser `@zero/framework/calendar` entry. Add contract/type and
installed-package tests for every supported export.

Design one canonical implementation per domain operation, shared by UI, routes,
workflow adapters and explicit app hooks. Proposed families:

- Safe configuration/capabilities and authorized directory/resource catalogs.
- Bounded calendar range/free-busy queries, detail/history and scoped watches.
- Appointment create/update/reschedule/transition/cancel and conflict overrides.
- Series preview/create/edit-this/edit-future/edit-series with exception policy.
- Availability/block management, booking offers/holds/confirm/requests and RSVP.
- Original command receipt reconciliation; no raw CRUD around invariants.

Every mutation uses a stable caller request identity and normalized command hash;
existing records require expected revision. The writer atomically commits domain
changes, accepted receipt, integration intents and configured semantic evidence.
No-op saves make no false mutation or success audit. Exact replay returns the
original receipt; the same key with another command conflicts. Read the current
record separately. Scope/principal bind the receipt; private commands are never
cross-tenant de-duplicated through caller-selected keys.

Replay/reconciliation preserves immutable operation identity and outcome, not a
permanent authorization to its original private payload. Reauthorize current
calendar/object/detail fields before delivery; narrow or withhold detail snapshots
after grant loss. Receipt errors and lookup results must not become an existence
oracle or bypass busy-only privacy.

Differentiate not-started, rejected/not-committed, accepted and unknown. Lost
acknowledgment or post-commit authority loss never claims rollback or safe replay.
Reconcile using the same request identity under current authorization. A missing
receipt after authority replacement does not prove the write never committed.
HTTP and SDK must preserve safe machine-readable outcomes, not raw provider errors.

Hooks are explicit, versioned integration seams: bounded synchronous validation/
commit contributions where atomicity is promised, or durable post-commit handlers.
Never let an asynchronous app callback run inside the SQL transaction or turn a
committed accepted appointment into a falsely rejected appointment.

## 7. Time, recurrence and booking truth

Use canonical UTC instants for timed reservations plus the intended local date,
wall time, IANA scheduling zone and explicit ambiguity resolution. All-day records
are local date intervals, not midnight UTC durations. Intervals are half-open;
adjacent appointments conflict only through declared buffers/capacity. Keep
appointment, location, provider and viewer zones distinct and visibly labeled.
Support cross-midnight and non-hour offsets; the prototype's 7 AM–7 PM and 15-minute
suggestions are not domain limits. Typed exact times and backend precision agree.

Use the reviewed daily/weekly/monthly/yearly preferences as a bounded recurrence
dialect, not the current browser-local preview as a server engine. Select and pin
the recurrence/timezone implementation only after a standards/runtime test spike.
Unsupported rules must reject or remain read-only intact, never silently simplify.

The standards reference is [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html):
section 3.3.10 defines recurrence handling, and section 3.6.1 defines event interval
ends. Calendar rules must not inherit Croner's job-time semantics. In particular,
invalid/generated gap occurrences are skipped rather than shifted/counting as
normal instances. A directly entered nonexistent local time should require
correction; repeated local times require a documented, visible resolution policy.
Also reject a start date inconsistent with the selected repeat pattern, or require
an explicit visible correction. The prototype unconditionally includes its first
date; that does not establish a valid DTSTART/RRULE pair. Define COUNT and inclusive
local end-date conversion without silently adding or dropping an occurrence; see
[RFC 5545 section 3.8.5.3](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.5.3).

Persist stable series identity and **nominal** occurrence identity, separate from
the currently effective UTC start. Moving an instance must not create a second
logical occurrence. Define this-instance/all/future edits, EXDATE/RDATE equivalents,
split-series lineage, exceptions, COUNT/UNTIL, timezone-rule changes and which
future reservations are revalidated. Preserve historical occurrences and receipts.
Rendering must handle repeated/missing local hours and offset labels correctly,
not force a fixed 24-hour grid or overlap visually indistinguishable fold instances.

Expand/materialize only a bounded horizon with a durable coverage watermark.
Requests beyond qualified coverage must not report a slot as guaranteed free.
A series proposal must specify all-or-none versus explicit partial/conflict-review
behavior over the admitted horizon; never silently book only the easy instances.
Unbounded future conflict guarantees are not part of the contract. Horizon extension
is version-fenced durable work; it must not send duplicate invitations/reminders.

Availability is authoritative server policy: effective provider/resource/location
assignments, working hours, holidays/overrides, blocks, appointment status/capacity,
buffers, notice and horizon. A busy presence ring is not a reservation. Check all
required resources and capacity together inside the final short writer decision.
Two competing requests cannot both win a capacity-one reservation.

Holds carry opaque IDs, source/policy revision, subject/proof binding and server
expiry; acquire/consume/expire atomically in that conflict domain. Correctness
uses expiry checks at reads/commands, not whether a cleanup timer fired on time.
An exceptional override needs its own grant, reason and semantic event.

## 8. Self-scheduling and participant invitations

Production self-scheduling defaults off. The preview's `enabled:true` is synthetic
UI data, not a configuration default. Staff management and visitor booking are
different permission boundaries.

When enabled, configure permitted calendars/types, notice/horizon/buffers, identity
mode (member, scoped invitation or separately approved guest proof), rate/abuse
admission, verified contact/consent requirements and request-for-review versus
instant confirmation. Native mutation/CSRF/audit rules still apply to their proper
route class. A public booking proof grants only its narrow capability; it is not
an authenticated staff session or access to private files/calendar details.

Offers expose opaque versioned slot/hold identities and canonical times, not private
appointment data. An any-provider booking reserves and returns the actual admitted
resource, not the preview's deterministic first resource. Recheck eligibility,
policy and capacity at confirmation. Define whether pending review reserves capacity
and its expiry; never label an unacknowledged request or approval-pending item confirmed.

Invitation and RSVP state are per participant. Contacting an external attendee,
accepting an invitation and granting access to a calendar are separate operations.
Hash capability secrets, bind scope/purpose/expiry/use policy, redact URLs/tokens,
apply correct referrer policy and invalidate superseded invitations. Recipient
consent/addresses stay private. Core Zero need not integrate a telehealth provider,
Facebook, external calendar account or app-specific patient portal to support this.

## 9. Appointment → Jobs → Torrent → provider integration

The intended pipeline is a short, durable, locally integrated chain—not another
calendar scheduler, per-appointment polling loop or network wait in SQLite:

```text
authorized calendar command
  → same calendar-file commit: reservation + receipt + integration intent
  → bounded source dispatcher → verified Jobs handoff/reconciliation
  → pinned Torrent activity → fresh calendar/domain admission → channel effect
  → reconciled effect outcome → authorized live projection + semantic evidence
```

Calendar command, calendar occurrence/revision, reminder intent, Jobs command,
Jobs occurrence, Torrent run and provider effect have distinct stable identities.
Retry attempts never become new logical send identities. Job inputs contain bounded
opaque references/revisions, not private notes, copied contact lists or user seals
in public views. Source acknowledgments wait only for durable handoff, not AI/send.

Configured domain transitions can trigger code-registered Torrent rules: for example,
accepted cancellation with a reason can enqueue permitted notification/follow-up
work. Rule/version and effect identities are captured in the source intent, not
selected by an arbitrary browser callback. Immediate source-bound Torrent events
reuse the supported enqueue seam; future timed effects use the Jobs bridge below.
Run no provider effect before commit and do not turn a post-commit integration
failure into a false rejection of an already accepted appointment.

### Required new source/service Jobs bridge

November 18 implementation update: the shared
[native source-owned Jobs foundation](../backend/scheduler/source-owned-jobs.md)
now implements the distinct source ownership/epoch/receipt/control family and
uses the existing runner/Torrent path. Its additive Jobs `002` retains `001` and
legacy evidence. It is internal feature-branch source, not an activated calendar
adapter. The source claim/acknowledgment queue, actual calendar owner/lifecycle
composition, authoritative effect cutoff, retained-capacity operating procedure
and physical/deployment qualification below still gate automatic calendar work.

Design a fixed source-bound admission/control/receipt capability for calendar-owned
intents: verified source and scope, fixed registered definition and workflow pin,
stable intent key, source-revision fence, current policy and retirement signal.
It must support create/reconcile/supersede/cancel without constructing a synthetic
`JobsAuthority`, retaining a request facade or exposing raw `JobsService`.
An atomic appointment commit and a later Jobs commit remain **two files**;
permanent receipts and reconciliation connect them, not a distributed transaction.

Specify success/replay/unknown and crash recovery before implementing this seam.
Source-bound Torrent enqueue already exists; replacing Jobs with long timer workflows
would be a separate architecture decision, not an implicit workaround.

November 17 source review makes the next bridge slice explicit:

- Add a true source-owned Jobs origin/control family with an additive migration.
  Existing request admission owns schedules as a human actor even when execution
  is service-owned; assigning invented actor/principal values is not an adapter.
  Keep the initiating person only as factual provenance for source-owned work.
- Bind registration to the verified established calendar owner/root/realm/scope,
  one fixed definition/workflow version, durable policy generation, due/expiry and
  normalized opaque intent. Version parser/eligibility semantics explicitly:
  the current definition fingerprint excludes callback bodies and is not proof
  that executable policy stayed unchanged.
- Add indexed bounded source dispatch state beside immutable effect references.
  Claim with a nonce/generation/expiry in a short source transaction; release
  the lease before Jobs, then acknowledge its exact durable receipt in another
  short transaction. Crashes on either cross-file boundary reconcile the original
  logical identity. Retired/cancelled work still needs read-only reconciliation;
  no new send is authorized merely because an acknowledgment was lost.
- Compose the new source lifecycle with logging rather than replacing the single
  logging source hook. Mount ownership dormant, then start reconciliation after
  Jobs/Torrent readiness; stop source intake before those dependencies close.
- SYSTEM execution seals validate scope shape, not current tenant/calendar/channel
  policy. Recheck those domain facts after pool waits and at a source-owned effect
  admission commit. That commit defines cancellation cutoff; release SQL/Guardian
  leases before a provider wait. Do not promise recall after dispatch.
- Qualify one bounded one-off integration before claiming automatic reminders.
  Current Jobs retained limits are 10,000 schedules/file, 1,000/owner, 100,000
  receipts and 100,000 occurrences. Two once schedules per appointment exhaust
  one owner's schedule envelope after 500 appointments before revisions; a
  once-per-minute recurring dispatcher exhausts 100,000 occurrences in roughly
  69.4 days. Neither pattern solves lifecycle retention. Surface a durable
  capacity-blocked state, never silently prune evidence or rotate scopes.

Required bridge tests include both crash boundaries, cancellation during every
await/pool wait, policy A → B → A retirement, source/tenant disablement, forged
source/scope/definition rejection, unavailable old pins, capacity exhaustion and
receipt reconciliation after retirement. This list originated as planning
requirements; the implemented shared source foundation is documented above.
It does not complete calendar dispatch or authorize recurrence/reminders.

November 18 source review preserves two additional gates before that bridge:

- A source command delayed past its original once-due time must either be visibly
  expired/suppressed or admit that original due identity within its lateness
  budget. The source-owned Jobs path now admits that original due instant within
  lateness; ordinary request-owned Jobs creation retains its existing rejection
  of past-due initial admission. Neither path moves a nominal occurrence to a
  retry's current time merely to make admission pass.
- `calendar:false` intentionally mounts no calendar lifecycle or state writes.
  A fully disabled startup therefore cannot itself persist retirement of policy A.
  Durable A → disabled/B → A retirement requires a reviewed separate source-lifecycle
  registry or an explicit durable-disable protocol. A matching config hash or new
  AbortSignal is insufficient. Do not silently weaken disabled inertness or claim
  an unobserved retirement was recorded. The first shared bridge now chooses an
  explicit durable-retire-before-disable protocol and new-generation reactivation;
  calendar's actual lifecycle/operator procedure must still implement it before
  stage 4 can complete. Automatic feature-manifest retirement is not implemented.

### Ownership and fresh eligibility

November 18 dispatch implementation decision: keep the first calendar bridge
private and unactivated while qualifying its cross-file protocol. Add separate
calendar policy history/current, immutable integration intents, bounded mutable
claims, Jobs receipt associations and final effect-admission/outcome evidence in
additive migration `010`. Do not alter the six historical effect-reference
families: those references also seal appointment binding generations.

The canonical changed-appointment receipt writer captures work after all bindings
and its historical effect reference exist, in the same source transaction. Only
explicitly installed policies participate; old appointments are not backfilled.
Every new appointment revision supersedes earlier integration eligibility without
erasing an accepted Jobs receipt or an already-admitted effect. A claim nonce and
lease generation identify an attempt, never a new logical effect or due instant.

The initial downstream adapter is **observation only**. It proves the durable
handoff and source-local cutoff without enabling email, notifications, AI,
recurrence or public booking. Jobs schedule acceptance is not Torrent acceptance,
provider acceptance, delivery or human attention. A replayed effect admission is
historical evidence, not permission to execute again.

Dispatchers use a distinct private, fixed-operation calendar owner facade. They
do not invent a `CalendarActor`, retain request authority or expose raw Jobs to
request code. Source acquisitions are existing-only, require established/current
SYSTEM ownership, and verify the physical `_calendar_owner` on the acquired
lease. Native cold admission now proves the owner and current physical ledger/
declared schema through a read-only handle before writable actor preparation;
explicit older-schema preparation must first prove established ownership.
Each replacement generation receives and acknowledges the detached contract.
This is not full arbitrary-trigger equivalence or current request authority.
Physical startup/ownership qualification remains a gate before managed activation.

The cross-file protocol is explicit: local activating epoch → exact Jobs source
registration → local activation acknowledgment. Retirement closes local intake
first; old receipts remain reconcilable. A missing receipt during unknown writer
settlement never proves rejection: retry the exact original operation through
its Jobs gate. New admission must also bind the exact expected registration,
not whichever later policy generation happens to be live after a wait.

This private protocol alone does **not** complete stage 4. Managed fixed-workflow
registration, dormant startup/hydration, dependency-ordered shutdown, durable
retire-before-disable operations, sustainable retained-capacity handling and
physical/package qualification must be connected and reviewed before exposing
automatic calendar integrations as an application feature.

Recommended organizational reminders are explicitly service-owned, with original
human initiation retained as provenance. The scheduler's later logout does not
cancel an independently valid organizational appointment. Actor-owned custom work
remains available deliberately and stops new handoffs when that authority retires.
Neither model falls back from revoked actor authority to SYSTEM.

Existing synchronous Jobs `service.isEligible` can gate fixed code policy and scope
but cannot fetch a live calendar file. Require an explicit asynchronous domain
admission step for the calendar intent and another fresh check in the effect
activity. If an eligibility projection is introduced, specify hydration/readiness,
revision ordering, expiry, restart and revocation; fail closed while stale. No
current-appointment guarantee may be inferred from a captured setup snapshot. An
asynchronous calendar read before a different-file Jobs write is not an atomic
source fence: either establish a reviewed revision/projection protocol or explicitly
tolerate stale scheduling and suppress it at the authoritative domain/effect boundary.

Each reminder has immutable due time, expiry/maximum lateness and recovery policy.
Check revision, recipient eligibility and expiry after provider-pool waiting,
immediately before effect dispatch and before private result publication. Jobs'
pre-handoff lateness check is not a final send deadline. Suppress expired reminders
visibly after downtime; never blindly catch up yesterday's reminders today.

Calendar effects use reviewed fixed adapters over Zero services. Strict activity
capability labels do not expose raw email/AI/database handles. Service work cannot
use the actor-only native Worker facade by pretending to be a user; CPU-heavy
recurrence needs an explicitly admitted fixed trusted worker adapter with fresh
publication fences. AI is optional advisory work, never booking authority.

### Reschedule/cancel and downstream-effect cutoff

Atomically obsolete prior reminder intents when appointment time/status/revision
changes. Stop old Jobs generations through the durable bridge and reconcile any
uncertain prior handoff before new dispatch. Already accepted Torrent work still
checks the intent; pausing a job does not undo an accepted workflow/send.

Define a source-owned dispatch claim/cutoff: pending or claimed intents can be
suppressed; once a downstream effect is dispatched it may be in flight. This
includes a native notification's separate SYSTEM-file commit, not only a network
call. Cancellation still succeeds for the appointment but cannot promise recall.
A source check followed by another-file publication/send has an interleaving
window—do not claim no reminder can arrive after cancellation. Never hold SQL/
Guardian leases over a provider wait.

Track pending, suppressed/superseded, dispatched, accepted, rejected, unknown and
delivery/read evidence separately. Native notifications can use their permanent
duplicate-safe publication API. Email retains actual partial-address outcomes;
provider idempotency/reconciliation is used only where supported. Unknown SMTP
acceptance goes to a private review/reconciliation state, not blind resend.
Local sent-copy/audit failure after acceptance must not become permission to send twice.

Version internal definitions/activities and retain pinned old versions while work
depends on them. Retiring a version or channel yields visible blocked/review state,
not silent re-pinning, message loss or a different provider selected by a browser.

## 10. Capacity and local-first performance

Before production reminder rollout, resolve the retained Jobs lifecycle gate.
Current per-file ceilings are 10,000 schedules, 1,000 per owner, 100,000 receipts
and 100,000 occurrences. These are retained budgets, not only concurrent work.
A concentrated initiating owner—or a future shared service owner if that bridge
design is selected—and minute-level dispatcher occurrences can exhaust them.
Current service-owned Jobs still retain their initiating human owner; execution
principal is not the same as that owner. Concurrency does not solve lifetime growth.

Record realistic appointment/recipient/channel/horizon/revision volumes and choose
a reviewed Jobs lifecycle/capacity design preserving duplicate safety and original
receipts. If this needs a core extension, land and qualify it first. Do not silently
prune identities, rotate scope files to evade limits, invent another calendar timer
system or promise indefinite storage. Expose approaching capacity and blocked work
through safe operational state, with an explicit operator recovery procedure.

File mode must be fast without HOT mode. Keep booking transactions short and index
overlap/range, hold expiry, future intent and wake discovery. No retained-history
scan/count on every viewport refresh; no opening every scope every timer tick;
no source lane waiting on model/provider completion. Use bounded shared fair I/O
pools and separately bounded CPU processes; keep physical occupancy until actual
settlement. Choose per-scope waiting limits below global totals where headroom is
required. One SQLite writer per file is intentional; independent scope files must
continue progressing concurrently.

Define benchmark hardware, cold/warm file-mode fixtures, data sizes and accepted
latency/event-loop/memory budgets before release. Include a 15-resource day viewport,
populated history, multiple scopes and a slow/uncooperative provider alongside
interactive reads/writes. Report measured p50/p95 and queue behavior, not a universal
lightning-fast or exactly-once claim inferred from unit tests.

## 11. Authorized reactive UI and mutation lifecycle

Provide a connected native calendar workspace (working name `CalendarWorkspace`)
over the SDK/hooks and the existing AppProvider, so an app can add its calendar
page without reimplementing every query, command, subscription and overlay.
Keep the existing controlled pieces independently usable. Permit reviewed action/
field/detail composition without substituting raw service handles or bypassing
domain commands. A management/settings surface exposes only currently delegated
catalog/availability controls; an optional public booking surface uses the separate
proof-bound API over the same domain. Routes/AppShell placement remain app-owned.

Geography and other property facets need declared stable field/value IDs and
server-allowed filter operators, with authorized catalogs—not arbitrary SQL,
property reflection or unfiltered directory reads. Reuse appropriate native filter
controls while retaining the reviewed compact location/calendar anatomy.

Use private commit hints plus bounded reauthorized snapshots/live transport, following
the existing Jobs/Fabric contracts. Do not expose raw private realm tables through
permissive Sync or fabricate INSERT/UPDATE events. Snapshots bind authority generation,
scope, authorized resource selection, range, display zone, policy/config revision,
file-local cursor and server time. Enforce range/page caps and return truncation/
continuation explicitly. Cursors are not global across files.

Specify initial load, valid empty, transient same-scope error, disconnected/stale,
denied and retired states. Reconnect reconciles gaps; out-of-order/old-scope results
cannot replace current state. Denial/scope retirement immediately withdraws private
events, details, selection, menus and actions—no exit animation retaining denied data.
Idle heartbeats/rechecks stay quiet. Coalesce actual changes without hiding capacity
or conflict state. Keep day/list multi-resource and week/month one focused resource.

Calendar commit hints alone cannot detect an idle Guardian/domain grant revocation.
Specify authority-change signals and bounded live revalidation, including paused
directory/detail reads. Server delivery/commit boundaries fail closed; clients
withdraw content on observed retirement/revalidation, not instantaneous remote
erasure of an offline browser. Qualify domain assignment/grant changes even when
no appointment row or calendar commit hint changes, including a quiet watch.
Directory search,
facet/count/truncation and receipt paths must preserve the same privacy boundary.

Introduce an additive async controller/adapter instead of passing Promises into
the current synchronous editor/booking/modal callbacks. Keep independently usable
local pieces compatible. One mutation-intent boundary handles editor, card, agenda,
details, status popover, context menu and any future drag/resize. The server supplies
allowed transitions and required reason/approval; no alternate surface skips them.
Declining a reason dialog produces no write. Clinical progress, outcome, lobby and
attention remain separate axes; online presence is not office/telehealth arrival.

UI states: editing → submitting → accepted/rejected/unknown, plus conflict and retired.
Capture request identity/base revision; block duplicate submission; preserve newer
typing while an older request settles; do not replace a dirty draft with live data.
Show conflict resolution/reload explicitly. Retired callbacks cannot apply to another
account/client/scope. Unknown stays reconcilable; do not automatically retry or
pretend dismissal/AbortSignal rolled back an accepted command.

Only a matching accepted domain receipt with no newer unsaved edits may close the
still-current editor/session as saved. If typing advanced, acknowledge the submitted
revision and preserve the newer draft for an explicit next save. Late responses
never close a reopened or retired owner. Zero's manager owns accept/exit/focus
restoration; no second overlay system or arbitrary delay. Use Zero Link for
navigation and preserve the shared AppProvider/collector.
Provide deliberate empty/setup/loading/error states and server-configured types,
hours/zones; never replace the compact reviewed editor with a generic form.

Visual acceptance locks in the compact icon-led/composable anatomy, bounded scroll
viewport and fixed gutter/header, tokenized density/category/same-hue attention
shading, rightmost collapse carets and native Morph Select/date picker/menu/tooltip/
modal/drawer behavior. Use Zero icons first with documented exact-glyph fallbacks.
Pending/reason/conflict/error feedback fits those surfaces. The stored theme
candidate remains separately opt-in; no site-wide theme replacement is implied.

## 12. Audit, files, hooks and service boundaries

Use native configurable logging; calendar must work with logging disabled and obey
required admission when enabled. Source-transaction semantic events describe actual
accepted appointment, availability, hold/booking and transition operations once.
Replays/no-ops, rendering, timer polls, claims and idle stream maintenance do not
manufacture user activity. Provider acceptance, delivery, read and human attention
are distinct evidence. Initiator, service action and affected record remain explorable
under native investigator authorization.

Record safe identities/revisions and declared change categories, not titles, clinical
notes, free-text cancellation reasons, contact details, prompts, credentials, raw
URLs or document contents. Store sensitive domain values only in authorized calendar/
app storage. Native view/list/duration evidence and app extensions follow the existing
auditing APIs, with human-readable resolvers reauthorized during investigation.
Transport success is not proof a person viewed a record. Public assets/booking
artwork never acquire a staff audit-handshake requirement.

Optional attachments use native Storage identities, grants, staged uploads and
authorized private delivery. An appointment reference does not grant object access;
refresh/revoke grants with calendar policy. No filesystem-path or public-URL shortcuts.
Native profiles/avatar/presence integrate through their admitted projections.
Notifications, email and messaging use the same configured Zero service contracts;
none is a mandatory external dependency of a basic calendar.

## 13. Managed lifecycle, recovery and operations

Boot order: pure config/policy admission → explicit migrations/owners → Guardian,
Fabric and configured logging → admitted domain registrations/adapters → Torrent
recovery/Jobs → calendar intent reconciliation and authorized routes/live reads.
Specify exact readiness dependencies to prevent cyclic startup. Recovery may inspect
private receipts without granting an expired user fresh action authority.

Shutdown retires intake/subscriptions, drains short calendar commands/handoffs,
retires provider admission and waits boundedly for physical effects, then closes
calendar logging sources/actors before their Fabric/provider/Guardian owners.
Durable unacknowledged work remains recoverable; forced death cannot run finally.
Qualify the actual supervisor's child containment and source/bundle bootstrap.
Do not create a second calendar-only worker manager or global current-app singleton.

A bounded drain timeout is not physical settlement. Report unknown effects and
unconfirmed resources, retain/quarantine occupancy, retire late publication authority
and use the supervisor's containment policy. Never report a clean stop merely
because the wait deadline elapsed.

Expose safe backlog age, coverage, held/expired counts, capacity pressure, blocked
adapters, unknown effects and reconciliation state—not payloads/seals or noisy
success rows. Define manual-review authorization and actions; resolving an uncertain
effect must not manufacture provider-confirmed evidence.

Document coordinated backup/restore requirements for SYSTEM, calendar, Jobs/Torrent,
logging and referenced Storage. This plan does not implement the separately planned
backup service. A restored stale source must not re-send completed effects or silently
adopt missing identities; reconciliation and operator recovery are mandatory.
Source/receipt divergence after restore blocks automatic effect readmission pending
reconciliation or manual review. A provider acceptance erased by restoring local
history, particularly SMTP, cannot be reconstructed or safely resent merely because
the restored intent says pending.

## 14. Delivery stages and acceptance gates

November 18 next-phase decision, following the reviewed private dispatch
checkpoint: build the fixed native observation catalog and owner-readiness
machinery before managed activation. An optional asynchronous readiness hook
must cover established as well as newly bound owners, release physical proof
leases before waiting, share only owner-lifetime work, preserve the initiating
request's final authority check and leave historical receipt reconciliation
available. Logging-only composition must retain its existing behavior and cost.

Then add durable native activation/retirement control and original-command
settlement barriers. Capture exact Jobs command key/CAS before attempting it;
persist local retirement before Jobs retirement; do not substitute a null
receipt read for physical settlement. The Jobs/Torrent dependency is bidirectional
once recovered observations inspect Jobs execution evidence, so lifecycle work
must distinguish dormant construction, recovery, dispatch admission, evidence
availability and final physical close. Public config/automatic observation stays
closed until those recovery, retry/fairness, capacity and shutdown gates pass.

The next private source phase now implements that fixed catalog, optional
owner-readiness hook, original-key Jobs settlement barriers, genuinely dormant
Jobs construction and an additive `012` registration-control journal/controller.
The [integration contract](../backend/calendar/integrations.md) explains their
exact boundaries; [qualification](../backend/calendar/qualification.md) records
actual checks, not deployment claims. Readiness cannot hide accepted business
receipts. Policy preparation makes no Jobs calls; activation/retirement record
their exact CAS and operation key before crossing the file boundary. Local
retirement and synchronous eligibility quiescence precede downstream retirement.
Late accepted acknowledgments preserve history without restoring intake.

The following source pass now implements a bounded private coordinator and the
shared managed Jobs dependency seam. It adds additive `013` source-class fairness,
canonical indexed next-wake queries, indexed SYSTEM owner pages, one native
absolute Scheduler wake, state-aware control recovery and separate intake/evidence
drainage. Managed Jobs is constructed dormant before Torrent recovery and starts
dispatch only after publication. The native coordinator is still not mounted by
public calendar configuration. Its explicit 64-retained-owner envelope is not a
claim to automatically hydrate the full 10,000-file domain catalog.

Current managed-coordinator integration checklist, not a reminder/provider adapter:

1. **Implemented in source:** inert Jobs evidence construction before recovery;
   cancellation waits actual dependency preparation. Do not put recovery behind
   an activity's own promise, inspect receipts or start work from that hook.
2. **Native composition implemented, public mount pending:** compose owner
   readiness and logging; hydrate fixed current policies
   and pending control keys without request-user authority or source-lease waits.
3. **Implemented in the private envelope:** indexed startup discovery and one
   coalesced absolute wake, future retries/expired claims and durable fairness.
   Resolve larger catalog hydration and shared retained capacity before public activation.
4. **Native managed phases implemented; public mounting pending:** the
   quiesce/drain/final-close boundaries keep Calendar and Jobs evidence
   available until physical callbacks and recovered Torrent work settle. Current
   controller/dispatcher close is not a shared physical drain certificate. Jobs
   now tracks actual callback settlement separately from cancelled callers.
   Torrent's native physical barrier also retains ignored/late invocation bodies
   after compatibility disposal grace; managed Jobs joins it before final close.
5. **Native capacity, selected controls, inspection and private actor acceptance
   implemented; public operator projection pending:** exact current selection/CAS, explicit
   retire/reactivate, bounded indexed source/effect presence and redacted Jobs
   accounting are private native contracts. Guardian inspection remains read-only.
   Private managed mutations now use source-atomic initiating-actor receipts and
   semantic audit; they are not direct native-control projection. Finish public
   admission/qualification and explicit retire-before-disable/adoption,
   sustainable retained capacity and larger bounded owner hydration before
   opening configuration. Empty queues or retired controls never certify that
   running effects finished or their evidence owner can be removed.
6. Qualify actual actors, interruption/restart, managed logging, browser, Linux
   bundle, exact archive and updater after storage integrity is verified.

Private managed composition is implemented; it is not public activation.
A two-phase Calendar core owner composes logging and integration
sources inside the exact unpublished Torrent owner's dependency hook, after
dormant Jobs preparation. Pure fixed workflow registration and an exact branded
Jobs catalog precede that hook. Native code pins must reject scoped name
shadowing, not merely match a name/version. Dependency attachment is explicitly
sealed before recovery; coordinator hydration precedes automatic Jobs startup.
One shared lifecycle owns Calendar intake, actual Jobs callbacks, Torrent
invocations, raw Calendar evidence callbacks and final providers, in that order.
No subordinate runtime cleanup may bypass an unsettled physical barrier. The
source-atomic actor/receipt/audit boundary and its private managed projection are
implemented in `015`. Public activation still requires qualified cold ownership
admission and the explicit adoption/disable procedure—not simply mounting the
existing native mutation methods behind a route.

Capacity review also found that the ordinary receipt ceiling could prevent
new cancel/retire operations. Add separate bounded source recovery headroom of
21,024 receipts, retaining the existing ordinary 100,000 budget, immutable
receipt namespace and every historical counter. Only cancel/retire use it;
new registration/create/readmission remain ordinary. Add a private existing-only
capacity projection using fixed usage primary-key reads. This is finite recovery
headroom, not a solution for indefinite retained history or automatic reminders.
The subsequent private operator checkpoint adds source realm `014`, preserving
all `001`–`013` closures/maps. Inspection uses fixed usage counters, indexed
existence checks and at most eight current rules. A trigger-maintained derived
pending-effect presence table avoids reading retained effect history on every
inspection. Selected controls share the retained coordinator/controller and
final source CAS. Registered reactivation must settle original retirement first;
unknown results require inspection/reconciliation rather than a new replay key.
Historical contract recovery admits only pinned native `010`–`013` fingerprints
against fresh current physical ownership; new installs still require the current
realm. See the [native operator contract](../backend/calendar/integrations.md#selected-native-controls-and-inspection).

The following `015` phase adds source-local initiating-user acceptance, with the
policy transition, actor-bound receipt, enabled semantic audit and capacity charge
in one transaction. Original receipt replay precedes new selection/config/graph
compilation and remains currently authorized. There is no new worker queue: the
existing local pointer and native control journal resume downstream work. Retired
readiness is bypassed only on this existing-only repair lane, never for ordinary
booking. Changed retirement receipts have bounded recovery headroom; no-op and
reactivation receipts stay ordinary. The exact Logging source owner and live
required admission fence the private request facade. Genuine `014` compatibility
is pinned as well; no old contract is rewritten. Accepted local facts, native
downstream settlement and physical effect completion remain distinct.

Sustainable retained-capacity, public audited operator/adoption and larger owner
hydration still gate public activation. No public configuration, application
deployment or release selection is part of this checkpoint.

Each stage gets source/type tests and focused review before proceeding. Public
activation and the physical/deployment gates above remain future requirements.

1. **Contract decisions.** Approve private scope placement, visibility/delegation,
   generic/clinical defaults, dependency matrix, recurrence guarantees, guest proof
   and reminder ownership. Resolve the three core bridge/eligibility/capacity gates.
2. **Config/ownership.** Typed config, Doctor, permissions/adoption, private realm,
   owner/migration lifecycle, safe disabled/setup state and startup/close parity.
3. **Domain/facades.** Authoritative time/availability/resources, receipts/revisions,
   atomic conflicts/holds, catalogs, status reasons and scoped API/SDK queries.
4. **Durable source/horizon groundwork.** Verified source-to-Jobs seam, pinned
   Torrent handoffs, retained-capacity design, fresh domain eligibility, coverage
   extension protocol, semantic audit and crash/reconciliation qualification.
5. **Series, booking and effects.** Standards-tested recurrence/exception/split and
   bounded coverage; offers/proofs, requests/confirmation, invitation policy and
   concurrency; stale-reminder suppression, channel idempotency/unknown review and
   configured Storage/presence/directory adapters. Automatic future coverage cannot
   ship before stage 4. Pure preview tests alone do not complete this stage.
6. **Native UI.** Async controller and shared transition boundary; authorized live
   snapshots, drafts, dialogs, filters, booking, management and empty/error states.
7. **Qualification/docs/release.** Synthetic real managed runtime, populated upgrades,
   real Chromium and exact installed source/official bundled Linux/amd64 deployment,
   restart/kill/retirement, performance, package/Doctor and normal updater checks.

Minimum matrix:

| Boundary | Required evidence |
| --- | --- |
| Modes/config | Single simple/advanced and multi shared-row/tenant-file; auth:false rejection; disabled inertness; populated enable/disable/re-enable; A→B→A policy retirement; registry-version changes without lost assignments. |
| Authority/privacy | Delegated non-admin scheduler, location constraints, participant/busy redaction, guessed IDs, narrowed native scopes/client revocation, API-key/public proof limits, quiet-watch/paused-read revocation, safe receipt replay after grant loss and no cross-scope late render. |
| Booking | Competing provider+room reservations, buffers/capacity, hold-expiry/confirmation race, stale revisions, override reasons, request-for-review capacity and same-command replay. |
| Time/series | Different viewer/provider/site zones, DST gaps/folds, non-hour changes, leap/month-end/fifth weekday, DTSTART/pattern mismatch, COUNT/UNTIL, all-day/cross-midnight, all/future/one edits, exceptions, moved identity and bounded horizon conflict behavior. |
| Handoff/recovery | Death before handoff, after Jobs/Torrent commit and before source acknowledgment; claim expiry, revoked actor versus service lifetime, restart and retained old workflow definitions. |
| Effects | Cancel while pending/claimed/queued/in-flight; lost acceptance; partial email rejection; unknown SMTP; permanent notice replay; no blind retry after accepted-but-local-failed result. |
| UI | Every status/cancel entry point, pending/unknown/conflict, newer typing surviving older acceptance, catalog/policy change mid-edit/booking, retired/reopened owners, native focus/exit, narrow screens, motion modes, 15 providers and empty first calendar. |
| Reactive/performance | Coalescing, reconnect gaps/out-of-order, resource removal, immediate denied-content withdrawal, no idle audit spam, concurrent scope progress and populated file-mode budgets. |
| Release | Matching actors with empty child env; never boot app in actor; exact installed archive and official bundle; updater preserves application state/themes; owned fixtures clean themselves. |

Do not deploy/migrate PracticeIQ or any other app as part of framework development.
App acceptance and rollout remain separately authorized. Existing UI, demo archive,
source history and conversation history stay preserved. External calendar sync,
payments, telehealth/video, Gantt/timeline, site-wide theme replacement and generalized
backup implementation remain separate work.

## Implementation checkpoint

The initial private realm/admission/ownership foundation is now connected into
a larger managed core vertical path: optional AppConfig, canonical root isolation,
dedicated bounded Fabric runtime, Guardian-scoped namespaces, native private
`/api/calendar` HTTP, SDK retirement, hooks, semantic source-transaction logging,
and `ConnectedCalendarWorkspace` using the preserved UI. Creation, separate
resource grants, redacted busy reads, details, query, reschedule, cancel and safe
receipt reconciliation are implemented. Source migration identity is preserved
by the official JS build plugin; compiled default actor launch fails closed.

Review corrected mismatched config/query ceilings (31 days / 100 rows / 16
resources), raw query errors losing domain codes across worker IPC, native
transport replay after realm upgrades, owner-bind/live-query races and private
snapshot retention behind SSE backpressure. Existing-only file acquisition,
live target reauthorization on receipt replay and unknown-outcome fences remain.

Evidence includes real in-memory native writer/realm transactions, Guardian
service-to-runtime integration, source-audit rollback/replay, transport, hook,
SDK boundary and pure UI-model checks. The physical coordinator/file process
seams are explicitly simulated where used. They do not replace file-backed
worker death/recovery, actual managed compliance, browser, installed Linux/amd64,
bundle and updater acceptance. No qualified calendar artifact is selected yet.

Recurring working-hours/holiday expansion, offer/slot generation/public booking proofs,
participant/catalog/location models, recurrence, clinical statuses,
source-to-Jobs/Torrent effects, notifications,
self-booking and AI are still future stages. Unsupported feature enablement
rejects instead of claiming partial readiness. Existing standalone rich editors
and self-booking previews remain local UI; the connected core never silently
persists their unsupported fields. The default app/public theme is unchanged.

No application or production state was touched. The active filesystem-integrity
hold is unchanged; source edits and memory-only checks continue, but fresh heavy
qualification and packaging remain blocked until storage recovery is verified.

The [November 17 review checkpoint](../backend/calendar/qualification.md) records
the subsequent lifecycle cancellation/close-retry, subscription retirement,
scope-owned reconciliation and bounded interval-index corrections. It separates
passing memory/HTTP/UI/type checks from the then-prepared eight physical actor/file
and two managed-compliance scenario definitions, all unexecuted. These
changes do not make the richer standalone UI, reminders or public booking into
implemented backend capabilities.

### November 17 explicit availability and one-off blocks

The next approved source stage now implements explicit per-resource UTC windows
or unrestricted policy, with bounded normalized windows, immutable policy history
and a resource-revision-controlled current pointer. An explicit empty window set
is closed. New appointment creation and UTC-occupancy changes must fit each
resource's current policy, including buffers. Restrictive policy changes never
cancel or move accepted appointments; unchanged occupancy and zone-only corrections
remain grandfathered. This is not recurring local working hours, holiday/DST
expansion, presence inference or an authoritative slot-offer API.

Appointment, block and availability watches share the current-authority native
subscription/SSE machinery, bounded quiet checks and SDK retirement. Busy reads
bound each resource/store partition before merging a global redacted page rather
than sorting all retained matching rows. The completed checkpoint for this stage was
279 memory/HTTP/SDK/UI/readable-label tests plus four pure migration-transform
tests, with no-emit source/regression compilation; see the qualification guide
for exact counts and the physical scenarios that remain unexecuted.

Private one-off blocks have canonical instants, an explicit zone, title, creator,
revision, fixed resource membership and active/cancelled history. They have no
buffers and are bounded to 31 days. Appointment and block reservations share one
atomic capacity-one conflict domain; creating/rescheduling a block rejects both
reservation kinds rather than cancelling anything. Cancellation releases all
owned block reservations. Current manage on every resource is required for
writes and replay; all-co-resource details authorization occurs before read
membership/truncation. Redacted busy reads combine both stores under one global
limit/order without exposing private record identity or titles.

The additive `002` migration preserves the existing `001` migration source and
receipt constraints. Separate block receipt/effect tables retain true block target
identity while sharing the stable scope/principal/request-key namespace with old
commands; reusing a key across families conflicts. Canonical accepted availability
and block changes append source-atomic opaque semantic facts once; no-op, replay
and rollback produce no false audit change. Effect-reference intents still do not
dispatch work or enable Jobs, Torrent, reminders or notifications.

The block suite passed 16 native-memory tests / 164 assertions on pinned Bun 1.4.4,
using real tracked writer transactions and copied bounded read sessions, including
late-create/update rollback, current-grant replay revocation, mixed busy truncation
and the maximum interval boundary. The completed scheduling-stage checkpoint was
279 integrated tests / 5,765 assertions / 35 files, plus four pure migration-transform
tests / 15 assertions; see the historical evidence in the
[qualification guide](../backend/calendar/qualification.md). No physical fixture,
worker process, build, dependency install or release output was created by this
stage. The storage-integrity hold remains unchanged. Physical additive upgrade,
recovery/contention, managed compliance, browser, bundle, installed Linux/amd64 and
normal updater acceptance still gate release. No production-qualified result,
application migration, hosted-demo change, richer editor persistence or complete
calendar-plan implementation is implied.

### November 17 authenticated temporary holds

Authenticated `holds.acquire/get/query/watch/release/confirm` now join the scoped
server/browser facade. This is not public self-booking, guest proof/slot offers,
or a new native hold UI. `selfBooking` remains false; the connected appointment
workspace, richer local editors and hosted demo are unchanged.

Holds reserve a fixed resource set and buffered UTC occupancy under current
all-resource book, active, availability and conflict checks. The server derives
identity and binds both principal and initiating user. Requested TTL is an integer
1–900 seconds, default 300, clipped to a strictly future start. At server expiry,
the held row is virtually expired for reads, conflict checks and live quota, with
no timer-driven write or cleanup dependency. Expired retained holds for the same
future interval do not block it. Fixed live quotas are 16 per principal and 1,000
per scope, alongside 100,000 retained holds and the global 200,000 receipt budget.

Private reads/releases require the original principal and user with current book
on every co-resource, or manage on every co-resource; authorization precedes
range membership/limit/truncation. Only the exact original subject can confirm,
even if another actor manages all resources. Confirmation requires the hold
revision, an unexpired held state, current book and every captured resource
revision. Grant/availability changes can stale a hold. Its resource membership,
instants, zone and buffers are immutable and sealed by acquisition evidence.

Confirmation supplies title only for the new ordinary appointment. The canonical
appointment writer freshly checks the same conflict/policy domain, excepting only
this owned hold, then atomically creates the appointment/reservations and consumes
the hold. The result is `appointment.created` with the new appointment ID, not a
hold confirmation receipt. Expiry, contention, revision/capacity rejection and
late insertion or audit failure roll the whole decision back. Release never
claims to cancel an already confirmed appointment. Unknown outcomes keep the
original key for receipt reconciliation and a separate authorized current read;
there is no automatic resend/reacquire. Acquire replay after expiry returns the
old accepted receipt, not renewal.

Additive `003` preserves both earlier migration source checksums and schema-map
generations. Private hold receipts/effect references share the existing
scope/principal/request-key namespace across families; they do not enable Jobs/Torrent dispatch.
Source-atomic acquired/released/confirmed facts are distinct and opaque; title,
scheduling times and private subject content are not copied. No-op, replay,
rollback and idle expiry emit no false semantic changes. Quiet watch expiry can
publish a changed authorized page with `invalidated:false`; existing scope/denial
retirement, backpressure and SDK owner boundaries remain in force.

Busy reads now combine three stores with no private target identity or kind. Each
resource/store partition is bounded before global merge, materializing at most
`48 * (limit + 1)` candidates, or 4,848 at 16 resources and a 100-result limit.
Expiry-first hold indexes skip retained expired prefixes before occupancy checks;
range/busy branches may sort the live set bounded by the 1,000 scope ceiling.
Appointment/block start indexes remain unchanged. These are query-plan/algorithm
bounds, not physical throughput or wall-clock benchmarks.

The focused hold suite passed 24 native-memory tests / 234 assertions, including
expiry/replay, co-resource privacy, quotas and expiry-index plans, canonical
confirmation/revision fences, competing transactions, partial rollback and late
source-audit backpressure. The integrated authenticated-hold stage passes 332
tests / 7,049 assertions / 40 files, plus four pure migration-transform tests /
15 assertions and no-emit source/regression-fixture checks; see the
[qualification guide](../backend/calendar/qualification.md); the completed
279-test scheduling checkpoint above is historical, not a new hold-stage total.
Nine native file/actor definitions and two managed-compliance variants now include
prepared hold coverage, but are **not executed** under the unchanged filesystem
integrity hold. Source/memory checks create no physical fixtures, actors, builds,
dependency trees or release output, and do not authorize retained-domain upgrades,
application migration, public booking or normal updater selection.

### November 17 versioned location directory and resource facets

The next implemented source stage adds scoped location create/replace/get/list,
resource assignment replacement and live catalog/detail facades. Catalog writes
require the scope calendar manager; resource management never grants global
catalog editing. Non-managers see only locations with a currently accessible
assigned resource, filtered before pagination. An internal visibility witness is
resolved by the service and checked again in the source transaction, preventing
guessed hidden IDs from becoming visible through a new assignment.

Location/region filters constrain the same current assignment and only narrow
existing resource grants. Empty facets do not add authority, and an empty
appointment resource selection remains empty. Inactive metadata remains readable;
deactivation does not cancel bookings. This is not effective-dated geographic
eligibility or an appointment visit-location model.

Additive `004` retains the preceding three checksums/schema generations and
original receipt identities. Immutable history preserves labels and assignments;
a bounded current-members projection avoids querying retained history on every
live read. Resource revision changes invalidate older captured hold revisions.
Accepted semantic facts join native source-transaction logging without copying
labels/regions or manufacturing events for no-ops, replay or quiet reads.

The native server/browser APIs and live hooks include filter/authority retirement,
strict keyset DTOs, private SSE and original-key reconciliation. Known commit hints
during a read/final authority await discard the stale page before publication;
one-shot reads bound rechecks instead of spinning indefinitely under writes.
The standalone demo is unchanged, and backend support is not a new geographic
management editor or a qualified released package. Final evidence is recorded in
the [qualification guide](../backend/calendar/qualification.md).

### November 17 appointment-type catalogs and typed booking policy

This source stage adds versioned appointment types, scope-managed per-resource
unrestricted/optional/required type policy, selected-resource catalog intersections,
historical record bindings and server/HTTP/SDK/live-hook facades. Catalog and policy
management require the scope calendar manager, not mere resource ownership.
Selected resources require current book/details authority before pagination.
Explicit empty selection remains empty; manager omission is a separate full-catalog
setup operation. Inactive type history stays retained, not silently substituted.

Typed booking/hold input pins a type ID/revision. The final source transaction
checks current per-resource policy, active type version, exact UTC duration/buffers,
availability and conflicts. Omitted creation/acquisition buffers use the pinned
generation's defaults only after policy admission. Versioned typed wire intents
normalize without reading an unavailable catalog; missing/old/hidden type probes
cannot reveal catalog existence through different policy rejections. Earlier
untyped command digests remain exact. Accepted replay checks original identity and
current object rights without re-admitting the old command against new policy.

Types never rename or reshape accepted appointments. Reschedule omission preserves
the accepted binding at the expected revision; explicit reference switches it and
null clears only when permitted. Time/buffer or type changes freshly admit type
policy. Unchanged occupancy remains grandfathered for availability; genuine no-op
and timezone-only corrections retain the old type even if retired. Typed holds
cannot confirm against a stale catalog generation or transfer to a mismatched
appointment type. Parent/type/binding changes share one tracked transaction.

Additive `005` preserves all four earlier migration/schema identities and true
receipt target kinds. Immutable binding/policy history is sealed against late
attachment to a resource generation completed by another operation. Accepted
semantic audits include no labels/default values; late source-audit failure rolls
back parent, reservations, bindings, usage and receipts together.

The subsequent connected UI pass adds type selection/defaults while keeping
catalog/resource-policy administration for later. The hosted demo remains unchanged.
Source/memory evidence and prepared physical
restart coverage are documented in the [qualification guide](../backend/calendar/qualification.md);
this is not a newly selected updater archive, production qualification or completion
of the participant/status/recurrence/Jobs/Torrent stages.

### November 17 generic lifecycle and required reasons

The next source stage is a deliberately bounded generic lifecycle, not a clinical
state machine: tentative/confirmed → permitted active or terminal outcomes;
completed/no-show/cancelled are terminal. Only cancellation releases reservations.
Clinical progress, office/telehealth lobby, attendance and attention remain
separate future axes. The default policy is virtual revision 1 with extended
outcomes off and optional reasons. A scope calendar manager can explicitly change
the extended/reason policy through the same scoped facade; resource ownership alone
cannot weaken that policy. See [the lifecycle contract](../backend/calendar/lifecycle.md).

Additive `006` retains all five earlier migration/schema identities, then adds
immutable scope-policy and appointment lifecycle/reason history plus forward
projections. The policy has a genuine sixth receipt/effect family in the single
global scope/principal/key namespace. Appointment transitions retain appointment
targets in the existing family. Historical meanings/reasons are not rewritten.
Current detail reads expose private lifecycle facts; busy/action/receipt/evidence
projections never copy the reason. Audit records only safe fixed status, revision,
policy revision and reason-presence facts. No-op, replay and rejection are quiet.

The source writer supplies live allowed transitions under manage rights on every
co-resource, then rechecks exact appointment and policy revisions at mutation.
The older reschedule/cancel APIs cannot bypass terminal states or required reasons.
Original reason-less cancellation digests and default legacy wire shape remain
unchanged; accepted replay precedes fresh policy readmission while retaining current
object authorization. A later policy change does not invalidate an old receipt.

The connected workspace now discovers server actions and uses the native modal
manager for transition review/reasons. It preserves newer typing, blocks duplicate
submission, checks receipt identity/revision and reconciles unknown outcomes under
the original key. Known mutation/read denial immediately retires the surface rather
than waiting for the independent watch. A review found that passive modal-owner
cleanup could retain hosted private content until after paint; native controlled
owner retirement now uses layout cleanup. Memory ReactDOM tests reproduce the old
gap, verify StrictMode/identity behavior and preserve accepted native exit ownership.

The hosted demo/theme is unchanged. Source/memory tests and prepared file/actor/
managed fixtures are not real browser or Linux qualification. There is still no
dispatched reminder/channel/AI workflow or public booking offer enabled here.

### November 17 retained visit bindings and native editor composition

The next additive stage attaches optional in-person location versions or phone/video
modes to appointments and holds. A current active physical location must be in every
selected resource's current assignments, after all-resource booking admission.
The binding is descriptive compatibility, not medical/geographic eligibility,
presence or telehealth provider enablement. Private snapshots resolve immutable
location history; busy/effect/audit payloads never copy location details.

The writer checks typed and visit assignment policies before client-selected
catalog lookups/defaults. Visit-v1 wire digests compose with types without changing
any earlier no-visit identities. Reschedule preserves the original expected-revision
binding unless explicitly replaced/cleared. Occupancy/visit changes freshly admit
the visit; unchanged-zone/type-only corrections keep grandfathered facts. Hold
confirmation rechecks and exactly transfers its captured visit through the same
canonical appointment writer. All source facts, reservations, audit, budgets and
receipts still commit or roll back together. Migration `007` preserves all six
preceding identities and requires no backfill or new receipt family.

The native editor now has a composable visit field family and authorized reactive
location selector, rather than retaining local demo mode values without persistence.
The reviewed theme/demo is unchanged. Source/model/memory checks do not replace
physical, managed compliance, real-browser or installed Linux qualification.

The native-account participant stage now follows the separately preserved
[admission/final-fence notes](./calendar-participant-admission-notes.md). Its
[source guide](../backend/calendar/participants.md) records the explicit offline
Guardian subject policy, scope-manager-only discovery/private binding surfaces,
opaque cursors, fixed hold captures and source version `008`. Ordinary details
and busy views remain redacted. New target checks run under opaque final commit
authority, not after accepted work; current presentation resolves after the last
asynchronous viewer check. The subsequent connected pass now wires these native
hooks into creation and a separate participant replacement dialog. No preview user, copied profile,
async app lookup or invitation is treated as authoritative identity. Domain
contacts/guests require later reviewed adapters/proofs. Physical/browser/archive
qualification remains outstanding; these source APIs are not selected for update.

### November 18 connected type/participant editor

The [connected workspace guide](../frontend/calendar/connected-workspace.md)
records the implemented source composition: fixed native scoped capability
discovery; server-bounded resource/range/participant selection; exact type
duration/buffer defaults and retained generations; optional native participant
creation; private current names/tombstones; and separate CAS participant
replacement. Current management/participant denial retires old actions. Turning
off participant controls retires an open creation rather than silently dropping
its draft. Unknown original-key recovery retains the expected source revision
after an editor closes; no UI receipt check substitutes for current read access.

The richer local editor and approved hosted demo remain unchanged. There is no
new migration, background timer, owner allocation during capability discovery,
invitation, provider call or cross-service effect. Catalog management, recurring
working hours/series, clinical progress/lobby/attention, domain contacts/guests,
Jobs/Torrent delivery and public scheduling remain separate stages. Memory
ReactDOM/controller checks are not physical, installed-browser or Linux/archive
qualification. The [qualification record](../backend/calendar/qualification.md)
keeps those unexecuted gates explicit.

### November 18 authoritative weekly availability

The next implemented stage-3 increment is
[weekly working hours and date exceptions](../backend/calendar/working-hours.md),
not automatic recurring appointments or stage-4 handoff. The canonical policy
facade selects either complete explicit UTC availability or versioned weekly-local
source with bounded local-date coverage and explicit fold/override rules. A meaningful
policy write freezes normalized UTC windows using native Temporal; booking reads
only indexed current generations and refuses unqualified buffered occupancy.
No weekly expansion, provider wait or background scheduler runs during booking.

Additive `009` preserves `001`–`008` source functions, full prior declarations,
accepted evidence and application state without backfill. Source no-ops/replay
precede conversion; runtime/ICU metadata is provenance, not an IANA database pin.
Legacy whole-policy APIs cannot overwrite active weekly format accidentally.
Current scope/resource checks, resource revisions, hold staleness, atomic multi-resource
booking and private source audit remain on their canonical paths. The new SDK
and hook provide current authorized policy views, not a management UI or slot offer.

Automatic coverage extension, general holiday feeds, series/exception materialization,
public booking and reminders remain later stages. The source-owned Jobs review
above is not an implemented bridge. The approved demo is unchanged, and the
[qualification guide](../backend/calendar/qualification.md) keeps memory/source
checks distinct from unexecuted physical, browser and archive qualification.

## 15. Documentation deliverables and open decisions

Create a canonical calendar backend guide/index with configuration/defaults,
permissions/modes, public SDK/server contracts, time/recurrence, availability/booking,
integrations, recovery/errors and populated upgrade instructions. Update the main
agent/start-here guides, server service members, client/hooks/exports, build/actor
guide, Doctor and frontend composition docs. Examples must use public facades and
clearly distinguish accepted, delivered, rendered and unknown outcomes.

Before implementation, review these recommendations with the user rather than
burying product choices in code: private per-scope domain placement; private/detail
visibility defaults and delegated grants; recurrence/dependency defaults and coverage
guarantee; initial self-scheduling proof/approval modes; organizational service-owned
reminders; and which delegated settings belong in the first management workspace.
The source-to-Jobs admission, synchronous eligibility boundary and retained Jobs
lifecycle also require an explicit technical design/qualification decision.

### Source review anchors

- Scope/authority: `src/auth/service-data-scope.ts`,
  `src/auth/service-data-authority.ts`, `src/frontend/server/request-database-client.ts`.
- Owned private feature precedent: `src/messaging/config.ts`,
  `src/messaging/runtime.ts`, `src/jobs/runtime.ts` and owner/persistence configuration.
- Missing source Jobs seam: `src/jobs/service-authority.ts`, `src/jobs/definition.ts`,
  `src/frontend/server/database-automation-execution-services.ts`,
  `src/frontend/server/database-automation-torrent-services.ts`.
- Retained capacity/cancellation: `src/jobs/realm-model.ts`,
  `src/jobs/realm-control.ts`, `src/jobs/realm-dispatch.ts`, `src/jobs/runner.ts`.
- UI boundary: `src/components/calendar/types.ts`,
  `components/appointment-editor.tsx`, `components/appointment-status-popover.tsx`,
  `components/calendar-surfaces.tsx`, `models/booking-model.ts` and
  `models/recurrence-model.ts` within that family.
- Native service constraints: [profiles](../backend/guardian/user-profiles.md),
  [identity projection](../backend/guardian/identity-projection.md),
  [presence](../backend/guardian/presence.md),
  [field access](../backend/resources/field-access.md),
  [Fabric consistency](../backend/fabric/consistency.md) and
  [Torrent activities](../backend/torrent/activities.md).

### Review status

The main pass and independent authority/configuration, execution/recovery and
UI-contract reviews were completed against the source baseline above. A second
cross-review corrected late-save modal closure, catalog preservation, native
credential ceilings, quiet-watch revocation, narrowed receipt replay, policy-owner
retirement, reminder lateness, downstream cancellation cutoffs, dependency order
and restore/drain uncertainty. These are planned requirements, not passed runtime
tests or new framework capabilities.

The original plan-review change was documentation only. Its instruction not to
publish an archive merely for planning still applies to documentation-only edits.
The user has since approved implementation; current source changes and their
actual qualification are tracked above and in the backend guide. Follow the
repository's release gates for an implementation artifact, not the historical
planning-only validation instruction.
