---
id: zero.backend.calendar.qualification
type: reference
audience: [developer, agent, maintainer]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: managed-core-qualification
maturity: experimental
---

# Calendar core: qualification and remaining gates

[Calendar index](./index.md) · [Integration plan](../../_work/calendar-integration-plan.md)

This is feature-branch evidence, not a release certificate. No calendar backend
archive has been selected by normal `zero-update`, and no application deployment
or data migration is authorized by these checks.

## November 18 follow-up review and polish

The requested review of source-owned Jobs and the preceding working-hours stage
found and corrected four concrete boundaries before adding new calendar features:

- **Policy transition retries.** A replacement used to discard its prior live
  epoch while awaiting its writer. A historical retirement could then fence the
  wrong pending activation. The prior binding now stays explicitly quiesced with
  its observed revision; provisional retirement fences match the intended epoch
  and honor queued cancellation. Owner/receipt/durable-CAS preflight returns old
  evidence or rejects obsolete retirement before it can affect newer work,
  including a newer registration already committed but awaiting acknowledgment.
  Known rejected replacements restore their prior binding. Unknown replacements
  remain quiesced until original-receipt reconciliation. All pending activation
  and retirement preparation is bounded, and final writer fences remain intact.
- **Read-only file ownership.** Cold existing-only Jobs reads checked SYSTEM and
  physical Fabric identity, but not the private file's permanent Jobs owner.
  Every existing-only read lease now verifies the exact owner ID and scope using
  the registered native query on that same lease before returning evidence.
  Missing/mismatched owners reject without binding, provisioning or repair; the
  proof is not cached across subsequent acquisitions or actor eviction. Tests use
  actual owner-check SQL and verify rejection before evidence and lease release.
- **Request write settlement.** The source mutation gate protected post-commit
  cancellation, but the ordinary request Jobs facade still leaked a raw abort
  after a successful actor write. Both now use the shared execution signal and
  write-phase contract. Create, update and cancel report unknown after potential
  acceptance, with the original receipt retained. Pre-admission aborts perform no
  work. Completed native Jobs/Database errors with proven non-acceptance retain
  that result; unknown/null outcomes and forged plain outcome objects do not
  acquire permission to replay. The native actor reproducer failed before the
  correction with a raw DOMException and passes with truthful uncertainty.
- **Repeated-midnight closure.** `fold: 'later'` previously applied to a previous
  date's `endMinute: 1440`, leaking its tail into an explicitly closed next date
  or exceeding exclusive coverage. The exclusive date end now uses the earlier
  next-midnight occurrence; authored same-date boundaries still honor fold and
  nonexistent-boundary rules remain unchanged. Native Temporal and actual
  Guardian/service/realm regressions cover both repeated hours, buffered spill,
  SQL publication and no receipt/source mutation on rejection. The before-fix
  test reported three failures, including an incorrectly accepted closed-date
  booking. Retained snapshots/no-ops are not silently rematerialized.

The combined memory regression baseline passed **935 tests, 16,183 assertions,
118 files** in 113.30 seconds. The final Jobs/Torrent, existing-owner, settlement,
working-hours and populated-upgrade set passed **192 tests, 2,028 assertions,
27 files** in 19.70 seconds after the last settlement corrections. These counts
are distinct runs, not additive coverage or a claim of whole-framework testing.
The final no-emit graph covers 336 roots and 3,945 imported source files with zero
diagnostics. One test-only generic inference diagnostic was corrected without
weakening the expected owner proof. The documentation graph remains 906 pages,
all reachable with zero structural problems.

Independent source reviews did not identify another concrete defect in the
reviewed historical migration retention, scope isolation, quotas, indexed
availability containment or canonical replay. That is a scoped review, not a
claim of perfection or deployment qualification. Memory databases, query
sessions, pools and Torrent owners close in `finally`; no dependency trees,
builds, file-backed fixtures or retained test processes were created.

No new calendar feature, app change, live-data conversion, main-branch merge,
hosted-demo change or updater selection accompanies this polish. The external
filesystem integrity hold remains active. Physical actor/file recovery, real
Chromium, managed compliance workers, bundled Linux/amd64 and the exact
archive/updater checks remain unqualified, not bypassed.

## November 18 source-owned Jobs/Torrent foundation

The [native source-owned Jobs guide](../scheduler/source-owned-jobs.md) records
this larger shared foundation. The same Jobs runner, bounded pool and sealed
Torrent bridge now accept a distinct private source origin: no invented user,
session principal or updated-by identity. Source-only definitions cannot be
admitted through a request, including an administrator request, and human
operator queries do not disclose/control source schedules. Immutable source
policy generations, permanent command receipts and revision-CAS controls cover
create, replace/supersede, cancel, retirement and reactivation. A → B → A never
reuses an epoch. Factual initiation is separate from execution authority.

Additive Jobs `002` keeps the exact `001` migration checksum
`e685208b804564ef8099324f5218dbd6cc783d8d0541e4689cba348fb42a4749` and a golden
legacy admission digest unchanged. Populated memory upgrades retain every old
field, authority seal, dispatch receipt, original index/trigger SQL and FK.
FK enforcement stays on. The child-first graph rebuild avoids a confirmed SQLite
parent-drop/deferred-FK trap which could pass `foreign_key_check` yet fail COMMIT.
Staging stays inside the owned file/transaction, not the host TEMP directory.
Indexed row-equivalence checks avoid large `EXCEPT` sorting trees. Late failures
and unknown incoming relationships roll back; source history is not backfilled
into runnable work.

Focused review closed concrete runtime issues:

- Definitive retirement differs from an active source not hydrated on restart.
  Not-ready work remains reconcilable rather than being permanently blocked.
  Its claim shortens to one second without dropping uncertainty or changing the
  original Torrent key, avoiding a needless 60-second hydration delay.
- Not-before joins expiry at claim/final handoff. Backward clock movement cannot
  start early work; original sealed receipt inspection still happens first.
  Late one-off source admission retains its original due instant within lateness.
- First-source absent receipts return null without provisioning. Existing-only
  source reads/writes, retained binding and wake refresh never recreate a missing
  Jobs file. Orphan/malformed ownership fails closed. Loss after commit preserves
  the acknowledged result and durable dirty wake rather than falsely rejecting it.
- Activation tokens fence the actual writer, not merely its acknowledgment.
  Retirement, cancellation, owner replacement and pool abort cannot install late
  authority. Pre-aborted/invalid retirement and historical control retries do not
  evict a later healthy generation. New-key no-op controls still require CAS.
- Actual pool execution signals reach final checks. Cancellation after a writer
  may have started remains unknown; known completed transaction rejections retain
  their not-committed result. Unknown receipts reconcile without a new identity.
- Source registration/receipt state is bounded. Shared retained quotas and source
  limits reject atomically, including semantic evidence; no timer/claim audit spam
  or silent history pruning is introduced.

The final native Jobs/Torrent set passed **128 tests, 856 assertions, 20 files**
in 15.62 seconds. It includes actual JobsService/broker/runner and real in-memory
Torrent authority seals, activity execution, permanent receipts and terminal
reconciliation. Fault cases cover lost Jobs replies, abort after commit, Torrent
acceptance before Jobs acknowledgment, retirement, A → B → A, restart hydration,
shared-gate cancellation, tenant isolation, forged capabilities and request/admin
exclusion. A separate actual JobsRuntime seam test uses real SYSTEM memory state
and real commit-authority checks with fake existing-file leases; it proves
existing-only routing and complete lease release. These physical seams are
explicitly simulated, not represented as disk/process qualification.

The broader memory regression baseline passed **916 tests, 16,050 assertions,
116 files** in 119.06 seconds across calendar/HTTP/SDK/hooks/UI models, Jobs,
auditing and modal helpers. Subsequent retirement-fence corrections and migration
polish were rechecked in the final 128-test Jobs set; that distinction is not a
claim that the whole framework or final installed archive was run. The no-emit
graph review covers 334 roots/3,943 imported sources with zero diagnostics.
Documentation has 906 pages, all reachable, with zero structural problems.

Unsuccessful diagnostics remain part of the record: an earlier 117-file attempt
passed 915 tests but could not collect the installed-consumer fixture because
the borrowed read-only dependency resolver lacked `shiki/core` mapping. That
consumer was excluded from the later memory-only baseline, not relabelled passed;
no dependency install or package qualification was attempted. Earlier memory
fixture failures used migrations outside their required transaction and an old
audit expectation excluded newly explicit factual-initiation metadata; both
fixtures were corrected without weakening identity/privacy assertions. A new
writer-race test initially blocked on an eager promise matcher before releasing
its own latch. Its two owned memory-only processes were retired; native promise
settlement corrected the test, which then passed. Test-only generic/narrowing
diagnostics were also corrected before the zero-diagnostic review.

All final memory handles, query snapshots, pools and Torrent owners close in
`finally`, including fixture construction failure. No files, actors, containers,
build trees or dependencies were generated by these checks. Transpiler cache and
TypeScript emit/incremental output were disabled. Existing source, archives,
protected history, preview and release selections remain intact.

The existing external filesystem integrity hold remains active. File-backed
actor death/restart/disk-full, real Chromium, native logging workers, bundled
Linux/amd64 and exact archive/updater qualification are not executed or bypassed.
Native calendar ownership/lifecycle composition, bounded source dispatch/ack,
effect-admission cutoff, explicit retire-before-disable procedure and sustainable
retention/capacity remain stage-4 work. This foundation does not enable calendar
reminders, recurring appointments or provider sends; the hosted demo and normal
updater archive are unchanged.

## November 18 versioned working-hours checkpoint

The [working-hours guide](./working-hours.md) describes the new whole-policy
facade, bounded weekly-local/date-exception dialect and retained UTC snapshot.
Policy writes use native Temporal once, after replay/CAS/no-op checks. Ordinary
bookings/holds use the current selector and an indexed single-window containment
probe, without expansion or provider waits. Unqualified coverage is not free.
The new facade, native authenticated routes/SSE, SDK, scope-owned hook and semantic
audit share the existing Guardian/Fabric and accepted/unknown boundaries.

Additive `009` preserves all eight earlier function identities and the full `008`
declaration. Before modification, actual `008` function hash was
`1dd8c3a24f0710f6e2e2f19304d9e0e318dd42bbb3230fa1107ee9cbe7f2eb94`;
the complete declared `008` table hash was
`7ce743df06584e0c59f1da3f839796c000daf3fe29d3abc282e2ed3eaf7117dd`.
The populated upgrade covers every prior table family, participant/type/visit
generation, receipt/digest, SQL definition/index/trigger, ledger and source
sequence. The new source/selector/window tables begin empty, without backfill.

Review closed these concrete issues:

- Successive legacy saves across a legitimate grant-revision gap initially failed:
  selector activation revalidated old-pointer equality after that same transaction
  had advanced the legacy pointer. The publication path now checks the correct
  intermediate identity/resource fence, with SQL enforcing the exact new parent.
  The untouched regression body passes; new corrupt/missing old-pointer cases
  still fail closed.
- A missing selector with retained new-policy history could otherwise become
  implicit legacy/unrestricted state. An indexed existence probe now rejects
  that damage; first publication captures its prior selector before history append.
- New table declarations and identity arrays are frozen so the migration's closure
  cannot silently drift after import. Incomplete, unordered, stale or post-seal
  window publication rejects, and all source/receipt/quota/audit writes roll back.
- Compatibility never hides weekly policy behind old explicit data. Existing
  command replay precedes the format gate, retaining truthful receipts without
  switching current state. Unknown accepted results never authorize a new-key replay.
- Actual HTTP tests reject forged authority, engine/expansion fields, unknown and
  duplicate query parameters. SDK projections reject private expanded windows,
  noncanonical rules, forged resources and impossible receipt revisions.

The first broad run reported 755 passing and 15 failing tests in 94 files. Those
failures were stale cumulative migration-list expectations and one old upgrade
allocator not declaring the new target tables. Fixtures now admit the full target
schema and append `009`; none of the historical checksum/schema/row/receipt pins
were changed. A subsequent focused upgrade run exposed the genuine successive
legacy-save bug above; it was fixed in runtime, not by weakening the old test.
These failed runs remain recorded rather than relabelled as successful evidence.

The initial qualification command in a worker accidentally selected the package
suite wrapper and an unpinned Bun 1.3.14 child without Temporal. The corrected
commands use native pinned Bun 1.4.4 with `test` before its flags and transpiler
cache disabled. The wrapper's exact temporary failure report self-cleaned; its
absence and owned process shutdown were verified. All actual source/HTTP fixtures
are memory-only and close databases, read snapshots, streams and runtime owners
in `finally`.

The successful combined runtime sweep reports 790 tests, 0 failures, 15,204
assertions across 96 files in 98.85 seconds. After a final test-only null assertion
for type safety, the final policy/upgrade/SDK/hook set passed 94 tests and 4,292
assertions across 15 files in 17.34 seconds. The final no-emit review covers 263
roots and 3,851 imported source files with zero diagnostics; the documentation
graph has 905 pages, all reachable, with zero problems. No emit or incremental
compiler cache was generated. These are scoped source/memory checks, not an
entire-framework or installed-archive qualification. Physical process/file recovery,
real Chromium, bundled managed compliance, Linux/amd64 and exact archive/updater
checks remain unexecuted under the existing filesystem integrity hold. No working-
hours management UI, automatic coverage extension, appointment series or reminders
are enabled by this stage. The selected archive and hosted demo remain unchanged.

## November 18 connected type and participant workspace checkpoint

The [connected workspace](../../frontend/calendar/connected-workspace.md) now
composes the native appointment-type, visit and optional account-participant
contracts. Existing participant edits have their own exact-revision command and
native modal; rescheduling never hides a second participant write. New fixed
`capabilities.get/watch` discovery returns only current scoped UI flags/configured
limits, without enumerating accounts or allocating a calendar owner/file/actor.
No source migration, provider, background job or site-theme change accompanies
this composition pass. The approved hosted local-state demo remains unchanged.

Independent review and real ReactDOM/native-modal controller checks closed:

- Current detail/management/participant denial now invalidates retained action
  callbacks; an old button cannot reopen withdrawn private management.
- Participant capability changes retire an open creation rather than silently
  omitting its chosen references. Existing participant dialogs are also retired,
  not automatically restored when capability returns.
- A removed/inactive calendar no longer invisibly occupies the configured
  selection ceiling when the user explicitly selects its replacement.
- The separately exported core editor now keys account/client/provider/scope/
  session/record-generation ownership. Old callbacks/receipts cannot mutate a
  replacement, and unrelated initial-prop refreshes do not erase a dirty draft or
  redefine its accepted baseline.
- Scope-owned receipt reconciliation retains mutation target and base revision
  after overlay retirement. Matching key/operation alone cannot accept an
  impossible generation, absent mutation target or false transition no-op.
- Unknown participant outcomes and accepted-but-unsent newer edits remain native
  dirty/review work even after the visible selection returns to its old baseline.
  Native close admission warns; Keep editing does not resend the request.
- New type choices missing from the current page lose their metadata and cannot
  submit. Accepted historical generations remain distinct. Exact-minute duration
  defaults reject DST gaps/folds or same-day overflow instead of clipping time.
- The date field no longer imports a `.ts` helper through a public wildcard that
  only exports `.tsx` UI modules. Actual installed-package resolution is still a
  separate unexecuted release gate.

The two final parent regressions were **executed before their runtime fixes**:
six tests passed and two failed, reproducing participant-dialog resurrection and
the unusable replacement-calendar choice. That failing result is preserved here;
the corrected parent/controller regressions subsequently passed. Early no-emit
findings also corrected explicit generic broker typings, discriminated detail
actions and test-fixture scope readers rather than weakening the public types.

The final focused controller set passed 42 tests / 714 assertions across three
files. It mounts the actual ReactDOM hook/native-modal owners, but intercepts
parent host widgets and drives their declared field/form callbacks. This is not a
real browser test of layout, keyboard/focus, touch, animation or installed assets.

The parent capability-restoration and removed-resource-ceiling cases were
executed before their corrections: six parent tests passed and two failed.
The failures showed an automatically reopened participant modal and an absent
schedule after choosing the replacement calendar. They pass after the fixes;
the original failing run remains development evidence, not a passing result.

| Final connected-stage evidence | Result | Boundary |
| --- | --- | --- |
| Integrated calendar/native-memory HTTP/SDK/hooks/upgrade/UI/readable-audit/modal/transform set | 737 passed, 0 failed, 13,947 assertions, 89 files; Bun 1.4.4, 91.04 seconds | Transpiler cache disabled; memory database/coordinator/actor simulation, not installed package or physical/browser qualification |
| Actual connected editor, parent and exact-revision recovery controller set | 42 passed, 0 failed, 714 assertions, three files | Real ReactDOM/native-modal owners with test-only host interception; includes actual native dirty-close admission |
| Full scoped no-emit review | 250 roots, 3,838 imported source files, zero diagnostics | No emit/incremental cache; prepared physical fixture source is type-checked, not executed |
| Documentation graph | 904 pages, 904 reachable, zero problems | Native capabilities, reusable connected UI, plan/return notes and source-versus-release limits |

Physical actor/file recovery, bundled managed compliance, installed browser,
Linux/amd64 package and archive/updater qualification remain unexecuted under the
existing filesystem integrity hold. Source/memory review does not retire that
hold or make this branch available through normal update. Tests close their
synthetic memory handles, roots, streams and modal owners; no generated disk
fixtures, dependencies, build trees or new release archives are retained.

## November 18 native participant checkpoint

Additive `008` preserves actual migration function identities `001`–`007` and
the complete `007` table declaration. A genuinely populated native-memory upgrade
retains every preceding table family, row, SQL definition, ledger, sequence,
receipt/digest and historical type/visit generation without participant backfill.
Indexed current binding reads remain bounded independently of retained history.

Native account discovery is explicitly enabled and scope-manager-only. Eligibility
uses canonical finalized/token-eligible SYSTEM accounts, actual active tenancy
and compiled offline Guardian role/permission/trusted-property policy. Opaque
query/scope-bound cursors hide skipped identities. Names remain minimal current
presentation; unavailable retained refs carry no former name or contact fields.
Directory watchers reuse existing quiet revalidation, not another polling timer.

The review closed these concrete integration gaps:

- A bounded-scan continuation could disclose an ineligible account ID. Tokens are
  now opaque, bounded, expiring and reusable for equivalent live continuations.
- Subject revocation/name changes during the final asynchronous viewer check
  could publish stale identity. One-shot/live reads now resolve again synchronously
  after that wait. This is not a cross-database atomic snapshot claim.
- SDK normalization attempted to assign into immutable detached records; valid
  participant create/acquire now produce separate normalized objects.
- Combining target admission with every runtime guard could turn a later target
  change into uncertainty after an accepted source write. A separate internal
  final-commit guard now fences new work only; ordinary viewer checks still fence
  every wait, accepted receipt and publication. Post-acceptance target revocation
  is covered and remains a truthful accepted receipt.
- Proven final-edge authority refusal maps to a safe calendar denial with the
  original known noncommit outcome. Unknown settlement is classified first and
  never relabelled as a rejection; no private callback cause is exposed.
- Provisioning-marker insert/delete/retarget previously lacked clock coverage.
  The canonical clock now includes them; lease metadata stays quiet. Native
  finalization/retirement checks use `RETURNING`, excluding trigger-inclusive
  SQLite change counts. Actual UserStore lifecycle regressions cover rollback.
- Native HTTP reads initially returned `503 CALENDAR_NOT_READY`: unchanged SYSTEM
  transaction completions caused the directory to invalidate its own final Guardian
  confirmation repeatedly. A connection-local, constant-time `total_changes()`
  wake watermark now suppresses unchanged completions without altering generic
  ReactiveDB commit semantics or caching eligibility. The exact failing native
  reproducer and all five connected HTTP scenarios pass after this correction.
  Twenty read-only root transactions remain quiet while actual profile/property/
  provisioning mutations still wake; the owned statement is finalized on teardown.

The first broad memory sweep reported 649 passing and one failing test across
79 files. The failure was an old location fixture assuming independent read/write
microtasks settled in invocation order. It now correlates exact fixed operation
names while preserving detachment/invalid-command checks; both focused files
passed 21 tests/193 assertions. This history is retained, not relabelled as a pass.

| Final participant-stage evidence | Result | Boundary |
| --- | --- | --- |
| Integrated calendar, native-memory HTTP/SDK/hooks/upgrade/UI/readable-audit/modal/transform set | 657 passed, 0 failed, 12,969 assertions, 80 files; Bun 1.4.4, 87.44 seconds | Transpiler cache disabled; native memory databases with explicit physical coordinator/actor simulation, not installed package/browser/Linux |
| Connected SYSTEM directory/service/native HTTP regression | 27 passed, 0 failed, 325 assertions | Includes all five actual auth + app.handle HTTP/SSE scenarios; no network listener, physical file or actor |
| Populated upgrade family | 25 passed, 2,732 assertions across seven files; retained-history participant follow-up 4 passed/828 assertions | Real memory migrator and actual 001–007 function/full 007 schema pins; not physical WAL upgrade/recovery |
| Full scoped no-emit review | 233 roots, 3,821 imported source files, zero diagnostics | Includes prepared file-backed source; does not execute it |
| Final changed-directory/HTTP/public-barrel no-emit check | 4 roots, 3,180 imported source files, zero diagnostics | Rechecked after wake-filter fix; no emit or incremental cache |
| Documentation graph | 903 pages, 903 reachable, zero problems | Updated native contracts, configuration, UI/plan handoffs and background-work orientation |

The separately composable participant picker preserves token/native-surface
anatomy, masks retired names/actions and represents unavailable references without
an ID fallback. The subsequent connected pass above integrates it into the native editor.
Domain contacts/guests, invitations, avatar delivery and broader participant grants
remain separate later capabilities.

Two additional physical fixture definitions are prepared on the existing owned
allocator/finally boundary: actual SYSTEM/Guardian service/native actor commit
races via an independent SYSTEM connection/coordinator/file fence, plus tenant
membership, exact held transfer and retained refs/tombstones across full restart.
The original thirteen test bodies remain unchanged. All fifteen file-backed tests
remain **unexecuted** under the filesystem integrity hold, as do installed-browser,
managed-compliance bundle, Linux/amd64/archive/updater and performance qualification.
The independent Guardian writer here is a second real connection with its own
coordinator, not a separately spawned Guardian process. No generated disk state,
new dependencies, build caches, processes or release archive were created.

## November 17 visit/location binding checkpoint

Additive `007` preserves the six earlier migration functions/checksums and complete
`006` declaration. The populated native-memory upgrade includes every preceding
table family and verifies rows, SQL definitions, ledger, sequence and accepted
typed/untyped receipts survive without backfill. Explicit post-upgrade visits first
bind at their accepted appointment revision. Scope/principal request identities and
all existing receipt families remain unchanged.

Visit admission composes current all-resource rights, assignment intersection,
current active location/version, type/duration/buffers, availability and conflicts.
Immutable snapshots retain old location labels/regions, explicit replacement/clear
is revisioned, and hold confirmation exactly transfers the fixed visit through the
canonical appointment writer. Replays do not consult later location admission.
Busy, audit and effect outputs never copy private location details.

The visit selector is now bounded independently of the 10,000-location catalog:
after authorizing every resource, its first probe uses the existing resource-first
current-assignment index and `LIMIT 17`. At most 16 candidate IDs reach the catalog
intersection query; oversized state fails closed. Real SQLite `EXPLAIN QUERY PLAN`
and a 2,048-unassigned-location regression verify this bound and identical results.
This is algorithm/query-plan evidence, not a disk throughput/latency benchmark.

Independent review closed these additional UI gaps:

- Only accepted source history may retain a named location after current choices
  change; unsubmitted catalog metadata missing from the current authorized page is
  masked and blocks saving until reviewed, without silently changing the draft.
- Transient management-read failure masks/disables the form while preserving its
  draft and exposing Retry. Known denial retires it, and an unavailable read never
  turns into an automatic resubmission or a successful save.
- A native non-searchable select now supplies its selected caption explicitly,
  fixing a reproduced empty initial server-rendered value without changing native
  morph/presence behavior. This is not a general calendar SSR qualification.
- Control-character titles are rejected before creating a dispatched UI identity.

| Visit-stage evidence | Result | Boundary |
| --- | --- | --- |
| Final integrated calendar/native-memory HTTP/SDK/hooks/upgrade/UI/readable-audit/modal/transform set | 589 tests, 11,283 assertions, 72 files; passed on Bun 1.4.4 | Memory-only, runtime transpiler cache disabled, no physical coordinator/actors/browser/archive |
| Dedicated populated upgrade set | 22 tests, 2,068 assertions, 6 files; passed | Real memory migrator; preserves every old table family, not an existing file/WAL upgrade |
| Focused visit-domain set | 17 tests, 168 assertions; passed | Includes bounded actual query plans and semantic-audit backpressure rollback |
| Final scoped no-emit TypeScript | 218 root files, zero diagnostics | Includes new source/UI/client and prepared file/managed definitions; not emitted or executed physical scenarios |
| Final documentation graph | 902 pages, 902 reachable, zero problems | Includes visit guide and indexed/backlinked participant-admission notes |
| Final type-only fixture correction recheck | 12 tests, 618 assertions, 3 files; passed | Populated visit upgrade plus visit-draft/presentation models after generic/readonly test annotations |

The first native setup/upgrade runs exceeded Bun's default five-second test
deadline under local contention. Those failures remain part of the history; the
final explicit run uses a bounded 30-second per-test deadline and the new populated
fixtures declare bounded deadlines. No runtime retry, admission delay or production
timeout was weakened to obtain a pass. Earlier fixture assertion/type errors were
corrected without changing historical checksum pins.

A thirteenth file/actor restart definition now covers retained location labels,
stale hold rejection, visit changes, exact remote-hold transfer and original receipt
replay. Both managed `createApp` variants also include real location selection,
in-person hold transfer and private investigator metadata assertions. These remain
**prepared, not executed** under the filesystem integrity hold. No new disk-backed
fixtures, build/cache trees, dependencies or release artifacts were created.
The hosted demo/theme and normal updater selection remain unchanged.

## November 17 lifecycle checkpoint

Additive `006` adds a virtual-default/versioned scope lifecycle policy, immutable
appointment outcomes/private reasons and a genuine policy receipt family. All
five preceding migration checksums and the complete `005` declaration are pinned;
the populated memory upgrade preserves old rows, indexes/triggers, ledger,
sequence and accepted receipts without backfill. The original reservation status
domain remains unchanged. Completed/no-show retain occupancy and are terminal;
the older cancel/reschedule paths cannot bypass those outcomes or required reasons.

Current manager/all-co-resource authorization, exact policy and appointment
revisions, safe receipt correlation, quiet no-ops/replay and atomic source-audit
rollback are covered. Native-memory service/HTTP tests exercise the real facade,
broker, realm and auth composition while explicitly simulating physical
coordinator/file/process seams. Reasons remain private domain values, absent from
busy projections, receipts, source effect references and audit metadata.

The connected workspace now discovers server actions and uses native managed
transition/reason review. The review corrected local reason admission that could
otherwise create an unsettled identity before SDK dispatch, and known denial
retirement that could otherwise wait for an independent live query. Receipt
reconciliation also withdraws on access denial and verifies exact source revision.
The modal controller's owner-unmount teardown now runs in layout cleanup: a real
memory ReactDOM regression fails before that change and passes after it, checking
hosted entry removal/context abort before a sibling layout observer. StrictMode,
identity replacement, accepted exit retention and unrelated owners remain covered.
These are runtime memory checks, not a real browser animation pass.

| Lifecycle-stage evidence | Result | Boundary |
| --- | --- | --- |
| Integrated native-memory calendar/HTTP/SDK/hooks/UI models/readable-audit/modal/source-transform set | 536 tests, 10,269 assertions, 63 files; passed on pinned Bun 1.4.4 | Memory-only; no file-backed coordinator, actors, browser, bundle or installed-package execution |
| Focused controlled-modal ownership/regression set | 57 tests, 269 assertions, 5 files; passed | Actual memory ReactDOM/effect lifecycle plus native modal state; not animation pixels |
| Scoped no-emit TypeScript | 206 root files, zero diagnostics | Calendar source/UI/client checks, controlled-modal adapter and prepared physical/managed fixtures; no emitted build or claim those fixtures executed |
| Documentation graph | 900 pages, 900 reachable, zero problems | Includes new lifecycle/reason guide and linked API/UI documentation |

The two managed `createApp` variants now include policy/required-reason/terminal
outcome commands and investigator assertions; a twelfth native file/actor fixture
adds lifecycle policy, private reasons, original receipt replay and terminal
occupancy across complete SYSTEM/actor restart. **Prepared, not executed.** Their
canonical synthetic allocator and `finally` shutdown/cleanup remain in force.
No test directories, database files, build trees or dependencies were created by
this checkpoint. The existing filesystem integrity hold is unchanged.

The generic lifecycle does not implement clinical progress, lobby membership,
arbitrary state catalogs or a terminal-correction operation. New appointments and
hold confirmations start confirmed and need an explicit transition for tentative.
No channel, reminder or AI effect starts automatically.

## November 17 source review

The managed core now retires queued admission on direct runtime close as well as
service close. Physical actor work remains tracked until actual settlement;
cancelling a wait does not release its lease early or turn a late accepted write
into a rollback. Failed native shutdown can be retried without reopening intake.
Watch retirement releases subscription handles even when abort occurs during
installation, and clears retained comparison state. Terminal stream denial never
publishes a late private read.

The connected UI's unknown-request ledger now serializes receipt reconciliation
and settles only the exact request owner. A late receipt cannot erase a newer
unsettled operation. Core-only agenda/month views no longer imply unsupported
visit/lobby state through a rich-demo icon. These changes do not modify the
approved standalone demo.

The writer admits a maximum 31-day appointment and two buffers of at most one
day each. Range reads and conflict checks use that shared invariant to bound
the existing start-time index from below, retaining the exact half-open overlap
predicates. A growing prefix of older retained appointments is therefore not
part of every overlap lookup. This is not a wall-clock throughput benchmark or
an assertion that arbitrary future recurrence rules have the same duration bound.
Changing the admitted interval invariant must update both validation and lookup.

## November 17 appointment-type and typed-booking stage

The next source checkpoint adds versioned type catalogs, scope-managed resource
type policies, historical appointment/hold bindings and native server/HTTP/SDK/live
hook composition. New bookings and hold confirmation check the active exact
catalog generation, resource-policy intersection, duration/buffers, availability
and conflicts in the canonical source transaction. Catalog edits do not relabel
or reshape existing appointments. Timezone-only/no-op grandfathering, explicit
reschedule preserve/switch/clear semantics and historical binding replay remain
separate from current admission.

Selected-resource catalogs authorize every resource before applying active-type
intersection and limits. Busy-only access cannot query type selectors. Omitted
selection is a manager setup catalog; explicit empty selection is empty, including
in SDK DTO admission. Catalog and resource-policy editing are scope-manager-only.
Type/detail/policy hooks use the existing known-commit and current-scope retirement
path; SDK reset, tenant switch and disconnect retire all three stream families.

The independent review identified and corrected two concrete defects:

- A rejected type reference could distinguish existing/missing/unavailable
  generations through different errors/default normalization. Typed v1 intents
  now normalize from wire fields alone before receipt lookup. New callback policy
  checks precede every client-selected catalog lookup, including missing/revoked
  type, default-overflow and reschedule probes. Accepted replay still checks the
  original digest and current rights without fresh policy readmission. Legacy
  untyped intent hashes remain exact, even after a later first typed binding.
- A policy could otherwise be appended to a resource revision completed by a
  different operation. Additive `005` now seals policy history/member/pointer
  generation against every same-resource effect intent. Binding guards also seal
  accepted appointment/hold generations, enforce nullable-pair/interval consistency
  and require exact typed-hold transfer in both directions.

Native-memory populated `004 → 005` migration tests preserve all preceding rows,
trigger SQL, ledgers, true receipt kinds and untyped history without backfill. All
four old function checksums and the full `004` declaration remain pinned. Actual
registered selector SQL plans after 1,000 retained policy revisions use indexed
current-pointer/history/member identities, with all-resource intersection before
pagination. This is not a disk throughput or latency benchmark.

| Type-stage evidence | Result | Boundary |
| --- | --- | --- |
| Final integrated calendar domain/runtime/native HTTP/SDK/hooks/presentation/readable-audit set | 441 tests, 8,935 assertions, 53 files; passed on pinned Bun 1.4.4 | Memory-only; physical coordinator seams remain explicitly simulated |
| Scoped source and regression-fixture no-emit TypeScript | 193 root files, zero diagnostics; passed | Includes the prepared physical definitions, not their execution |
| Pure migration build-transform tests | 4 tests, 15 assertions; passed | Not an executed bundle, actor or installed archive |
| Documentation structural graph | 899 pages, 899 reachable, zero problems | Canonical IDs, links and anchors |

Source-atomic type/policy/typed-booking evidence contains opaque identity and bounded
revision/count/mode/active facts only. Replay/no-op emits no false change. Late audit
pressure rolls back parents, reservations, bindings, pointers, usage and receipts.
Owned memory/query/logging/stream handles close in `finally`; no physical fixtures,
actors, builds, dependency trees or release artifacts were created.

Eleven native file/actor test definitions are now prepared, including typed
catalog/policy/booking/hold history across full actor/SYSTEM restart. They and the
two managed variants are unexecuted under the unchanged filesystem-integrity hold.
The connected editor/type-management UI, recurrence, participants, Jobs/Torrent
effects and physical/browser/Linux/archive/updater qualification remain unfinished.
The hosted demo and selected updater release are unchanged. This is not full
calendar completion or application deployment authorization.

## November 17 location-directory and reactive-resource stage

The source branch adds scope-owned versioned locations, resource assignments,
authorized location/region facets and native server/HTTP/SDK/live-hook integration.
Global catalog editing requires the scope manager. Per-resource management does
not grant global location visibility or editing: private assignment witnesses are
resolved from an authorized resource and revalidated inside the final writer.
Guessed hidden locations cannot be disclosed by attaching them to one's calendar.
Both selected facets must match the same current assigned location; empty facets
remain narrowing defaults, never grants or implicit resource selection.

The source transaction preserves immutable label/region/assignment generations
and replaces only the bounded current lookup projection. Deactivation retains
history and does not cancel bookings; changed assignments advance the resource
revision and stale older holds. Location metadata is not effective-dated provider
eligibility, a visit location or geographic authorization.

The review corrected four integration boundaries before this checkpoint:

- Hidden-ID assignment discovery now requires a current, final-transaction
  visibility witness. Ephemeral witness changes select a native transport attempt
  without changing canonical scope/principal/request-key identity or intent digest.
  Reconciliation still checks the normalized original command and current rights.
- Directory visibility/filtering uses indexed current members, not a retained
  history prefix. The query-plan fixture retains 1,000 assignment revisions with
  only three current members and checks ten actual registered-query plans/results.
- Catalog and location/assignment details use native watches and current-scope
  hooks. A known domain commit during query/final authority await discards the old
  result before publication. Direct reads retry at most four times and unsubscribe
  in `finally`; continuous churn fails closed rather than spinning indefinitely.
  These are strong-query snapshots plus observed-commit fences, not an atomic
  transaction spanning Guardian and the separate calendar file.
- Composed native auth exposed repeated numeric-query transformation failures.
  Catalog and range-live limits now validate bounded decimal wire strings before
  explicit numeric conversion. Raw query-key checks reject authored authority
  fields and duplicates instead of letting query normalization silently strip them.
  Browser keyset DTOs are bound to the captured cursor/limit and strict ID order.

Additive `004` pins all three earlier migration checksums and the complete `003`
schema generation. A populated native-memory `003 → 004` Migrator run preserves
old rows/triggers/ledgers/receipts and leaves locations genuinely empty. Location
receipts retain true target kinds while joining the existing global command-key
namespace. Accepted semantic audit facts contain opaque identity and bounded
revision/count/active fields only, never labels/regions; no-op, replay, rollback
and quiet reads do not emit false changes.

| Location-stage evidence | Result | Boundary |
| --- | --- | --- |
| Integrated calendar domain/runtime/native HTTP/SDK/hooks/presentation/readable-audit set | 379 tests, 7,954 assertions, 46 files; passed on pinned Bun 1.4.4 | Native memory only; physical coordinator seams remain explicitly simulated |
| Final type-only query-spy fixture correction recheck | 14 tests, 358 assertions; passed | Preserves generic SQLite row/parameter types; no runtime, dependency or packaging change after the integrated run |
| Calendar source and all regression-fixture no-emit TypeScript | 182 root files, zero diagnostics; passed | Includes the ten prepared file/actor tests and two managed variants, not their execution |
| Pure migration build-transform checks | 4 tests, 15 assertions; passed | Executable behavior/source-identity transform, not an actual bundle |
| Documentation structural graph | 899 pages, 899 reachable, zero problems | Canonical guide IDs, links and anchors |

The 1,000-revision query-plan case checks actual bound SQL, current-projection
indexes, authorized membership before limits and bounded results. It is not a
disk latency/throughput benchmark. Native-memory paused-read regressions verify
direct/detail/assignment withdrawal after domain grant loss and bounded direct
retry under continuous mutation. An independent source review found no remaining
concrete location-stage defect after the recorded corrections.

At the location checkpoint, the prepared file-backed suite contained ten tests, including location-first
provisioning, catalog/assignment persistence and original receipt replay across
full SYSTEM/actor restart. The existing two managed-compliance variants remain
prepared. None of these physical definitions, real-browser flows, Linux bundles
or release archives were executed under the unchanged filesystem-integrity hold.
Source/memory qualification does not select an updater archive or modify the
hosted demo, an application or real calendar state.

All owned memory/read/logging/stream handles close in `finally`. No physical
fixtures, actors, dependency trees, builds or release artifacts were created.
Storage status/check still return code 3 for the existing integrity hold;
cleanup/build guards were not bypassed. Source and documentation remain retained
in the existing feature worktree and branch; no generated run needs later cleanup.

## November 17 authenticated-hold stage

The next source stage adds authenticated acquire/get/query/watch/release/confirm
facades, not public self-booking or a new native hold editor. Holds reserve fixed
resources and buffered occupancy in the same capacity-one domain as appointments
and blocks. Requested TTL defaults to 300 seconds and admits integer 1–900 seconds,
clipped to a strictly future start using the trusted server clock. Expiry is
virtual: at the boundary a held row stops occupying time, appearing in live
ranges and consuming live quota, without a timer-driven mutation. Retained
expired holds for the same future interval cannot block a new reservation.

Private get/query/release requires the exact principal and initiating user with
current book on every co-resource, or current manage on every co-resource.
Authorization precedes membership and pagination. Confirmation requires the
exact original subject even when another actor is a manager, current all-resource
book rights, the expected hold revision and all resource revisions captured at
acquisition. Grant or availability changes can stale a hold without revoking
book. Instants, buffers and resources remain immutable; the accepted acquisition
receipt seals resource membership.

The canonical appointment writer creates a fresh ordinary appointment and its
reservations before the same transaction consumes the hold and releases its
reservations. The result is `appointment.created` for the new appointment ID,
not a hold confirmation receipt. Expiry, contention, capacity, late reservation
failure and late semantic-audit pressure roll the whole decision back. Accepted
acquired/released/confirmed hold evidence contains opaque identity and bounded
source facts only; no title, scheduling time or private subject snapshot is
copied. Replay, no-op, idle expiry and rollback do not produce false change facts.

Live ceilings are fixed at 16 per principal and 1,000 per scope. Retained holds
have a separate 100,000-row budget; the existing 200,000 receipt budget remains
global across command families. Quota probes use expiry-ordered live indexes.
Hold range and reservation indexes are also expiry-first, excluding retained
expired prefixes before occupied-time filtering. A hold range/busy branch may
sort the remaining live set, bounded by the 1,000 scope ceiling, rather than all
retained same-interval history. Appointment/block start indexes are unchanged.

Three-store redacted busy reads materialize at most `48 * (limit + 1)` candidates:
4,848 at 16 resources and a 100-result limit. Each resource/store partition is
bounded before the global merge; no record kind, hold/appointment ID or title is
published. This is an algorithm/query-plan bound, not a disk-latency, throughput
or wall-clock performance qualification.

Hold watches reuse current-authority quiet reads, commit hints, backpressure and
scope/denial retirement. Quiet expiry can publish a changed page with
`invalidated:false`, without source writes or audit. An acquire replay after
expiry returns the old accepted receipt, not renewal. Unknown outcomes retain
the original key for reconciliation; missing receipts never authorize automatic
resend or reacquisition.

Additive migration `003` preserves both `001` and `002` source checksums and
declaration generations. Hold receipts/effect references use private tables while
sharing the existing scope/principal/request-key namespace. Memory migration
evidence does not establish a physical retained-file upgrade or authorize one.

| Authenticated-hold-stage evidence | Result | Boundary |
| --- | --- | --- |
| Focused canonical hold native-memory suite | 24 tests, 234 assertions, 1 file; passed on pinned Bun 1.4.4 | Real tracked transactions/read sessions; expiry and replay, principal/user/co-resource privacy, live/retained quotas, captured range and expiry-index plans, canonical confirmation, contention, revision fences, partial rollback, source audit and late backpressure |
| Final integrated calendar backend/HTTP/SDK/hooks/presentation/readable-audit set | 332 tests, 7,049 assertions, 40 files; passed on pinned Bun 1.4.4 | Includes the hold lifecycle, expiry, renewal/reconciliation, live revocation, populated upgrades and dense query plans alongside existing calendar regressions; physical coordinator seams are explicitly simulated |
| Pure source migration-transform checks | 4 tests, 15 assertions, 1 file; passed | Source identity transform, not an executed bundle or installed actor |
| Calendar source and regression-fixture no-emit TypeScript | Passed, 173 root files, zero diagnostics | Includes prepared file/actor and managed-compliance definitions; compilation is not physical execution |
| Documentation structural graph | 899 pages, 899 reachable, zero problems | Canonical guide links/IDs/anchors remain valid |

Review caught and corrected two integration issues without relaxing a boundary:
the initial 1,024-scope quota draft exceeded the native find ceiling, so the new
live scope limit is 1,000; and a multiline migration-array edit changed Bun's
representation of the old `001` method, so its original layout was preserved.
The pinned `001`/`002` checksums and original tables/trigger SQL remain unchanged.
An incorrectly ordered native-test invocation selected the package runner and
was rejected by its engine check; that diagnostic is not counted as runtime
evidence, and its exact owned temporary report was automatically cleaned.

All owned memory/read/logging handles close in `finally`. These runs create no
file fixtures, actors, dependencies, builds or release artifacts. Native
file/actor and managed-compliance definitions are prepared but **not executed**
under the existing storage-integrity hold. No updater archive, hosted demo,
application or real calendar state was changed.

## November 17 explicit-window and block stage

The preceding scheduling source stage added bounded, versioned explicit UTC availability policies and
private one-off blocks. Unrestricted availability is the backward-compatible
default; an explicit empty window policy is closed. Appointment creation and
UTC-occupancy changes check the full buffered interval against current policy on
every resource. Restricting a policy preserves accepted appointments; unchanged
occupancy and a zone-only correction are grandfathered. Recurring local working
hours, holidays, DST expansion and bookable-slot generation are not implemented.

Active blocks share the appointment conflict domain and half-open overlap
invariant, without buffers. They cannot displace appointments or other blocks.
Writes require current manage on all resources; details require all co-resource
rights before membership/truncation. Cancellation releases every reservation and
retains history. Busy projections use one global bounded order across appointment
and block occupancy, with no target kind, record ID or title.

The additive `002` migration preserves `001` source identity and retained receipt
constraints rather than rebuilding old evidence. Block receipts/effect references
use separate private tables but the same scope/principal/request-key namespace;
cross-family key reuse conflicts. Safe replay and receipt reads reauthorize current
target rights. Accepted transitions use the existing source-atomic semantic audit;
no-op/replay and rolled-back mutations emit no false changes. Private effect
references are still not a dispatch or reminder pipeline.

The standalone hosted demo is unchanged. The connected workspace remains an
appointment interface; the new management capabilities are scoped server/client
facades, not implied new working-hours or block editor surfaces.

Availability and block watches now share the native appointment watch boundary:
commit hints cause fresh authorized reads, quiet checks do not manufacture events,
private SSE retains dirty flags under backpressure, and account/scope retirement
closes old readers. Exact replay is silent. A new-key no-op can still append a
private receipt and invalidate the source without emitting semantic-change audit.

At that two-store checkpoint, mixed busy queries bounded each authorized
resource/store partition before merging the global page. The fixed
16-resource/100-result ceiling materialized at
most 3,232 candidates, rather than collecting every matching active interval for
a global sort. Tests compare the exact old SQL order against dense synthetic
current data and verify the executed per-partition index plans. This is a bounded
algorithm/query-plan qualification, not a disk-latency or throughput benchmark.

| Scheduling-stage evidence | Result | Boundary |
| --- | --- | --- |
| One-off block native-memory suite | 16 tests, 164 assertions, 1 file; passed on pinned Bun 1.4.4 | Real ReactiveDB writer/read sessions, both-kind conflicts, co-resource privacy, key reuse/revocation, atomic rollback, cancellation, audit/no-op truth, global busy truncation and bounded interval admission |
| Final integrated calendar backend/HTTP/SDK/hooks/presentation/readable-audit set | 279 tests, 5,765 assertions, 35 files; passed on pinned Bun 1.4.4 | Includes availability, blocks, populated migration, live watches/denial/reconnect, dense bounded busy queries and prior core regressions; physical coordinator seams remain explicitly simulated |
| Pure source migration-transform checks | 4 tests, 15 assertions, 1 file; passed | Legacy method and additive named-function migration identities remain independent; not a real bundle/build test |
| Calendar source and regression-fixture no-emit TypeScript | Passed, 164 root files, zero diagnostics | Includes new and existing source, browser-model fixtures and prepared physical/managed tests; compilation is not execution |
| Documentation structural graph | 899 pages, 899 reachable, zero problems | Canonical guide links/IDs/anchors remain valid |

All owned memory database/read/logging handles close in `finally`, including
setup failures. These runs create no file-backed fixtures, actors, dependency
trees, builds or packaged output. The external filesystem-integrity hold is
unchanged; this evidence does not bypass its physical-test/cleanup/build gates.

## Earlier core checkpoint, before the scheduling stage

| Evidence | Result | What it establishes |
| --- | --- | --- |
| Selected backend/native-memory HTTP/configuration/Doctor/readable-audit set | 124 tests, 1,412 assertions, 23 files; passed | Current core behavior over real native memory transactions and explicitly simulated physical seams |
| Calendar frontend models/presentation/client/hooks/SDK retirement | 104 tests, 2,751 assertions, 13 files; passed | Connected presentation, draft ownership, privacy retirement and SDK lifecycle behavior |
| Pure migration-source build transform | 3 tests, 12 assertions; passed | Exact source identity is preserved by the transform; not proof of a deployed bundle |
| Populated interval regression within the backend set, followed by strengthened focused recheck | 3 tests, 31 assertions; passed | 2,000 retained old rows, real SQLite query plans with two-sided index ranges, longest admitted interval, one-millisecond/adjacency and date-limit cases, including the buffered writer edge |
| Scoped source no-emit TypeScript | Passed | Calendar and transitive source with the existing borrowed dependency tree |
| Scoped physical/managed fixture no-emit TypeScript | Passed | New qualification fixtures and performance test compile; their physical scenarios were not executed |

The inner-loop runner borrowed the existing dependency tree rather than claiming
a fresh frozen install. Early HTTP test import failures were resolved in the
temporary runner's ESM mappings; framework runtime resolution was not weakened.
The hanging cancellation regression was corrected to observe its Promise before
cancelling it, rather than awaiting the cancellation result before triggering it.

## Physical scenarios prepared, not passed

At the earlier core/hold checkpoint, `src/calendar/file-runtime.integration.test.ts` defined nine actual file/WAL and
dedicated-actor scenarios: inert empty reads, independent scope progress, full
SYSTEM/actor restart, multi-resource contention and rollback, replay/current grant
checks, missing/changed placement recovery, exact-owned writer death/replacement,
empty child-environment proof, and hold expiry/competing-confirmation truth.
Persistence/restart definitions also retain hold source and exact receipt
evidence. The factory observer forwards to the production
subprocess executor; it does not substitute a mock coordinator or actor result.

`src/frontend/server/app-calendar.integration.test.ts` adds two real managed
`createApp` scenarios, with logging disabled and with the compliance preset. They
cover normal authentication/admission, native resources and booking HTTP, replay,
conflict/no-op truth, semantic source evidence reaching the native investigator,
privacy, and admission retirement/recovery. No live provider or clinical data is
needed. These are test definitions and type-check evidence, not successful runs.

The file-runtime and two managed definitions also exercise
availability/history and block receipt persistence across full restart, a real
appointment-versus-block race, complete block control/replay/no-op handling and
the new semantic evidence categories reaching the investigator. Their allocator
and exact-owned shutdown/cleanup requirements are unchanged. They have not been
executed under the current storage-integrity hold. The additional native hold
definition, expanded native hold persistence/replay, and both managed variants'
hold acquire/confirm/replay/release/expiry and investigator assertions are
likewise prepared source, not successful physical, managed or browser runs.

The canonical allocator records exact synthetic ownership. Each fixture closes
its app, actors, coordinator and database handles before cleanup; unconfirmed
shutdown preserves the precise owned path instead of deleting state underneath a
process. The new labels are not represented as already covered by unattended
maintenance's existing allocator-family allowlist.

The existing development-volume integrity hold remains in place. Physical
fixture allocation and cleanup still refuse that hold. No internal-disk fallback,
global guard change or fabricated physical pass was used. The small source/memory
checks above created no new file-backed databases or actor processes.

## Remaining release work

After a valid physical test environment is available: execute those scenarios,
qualify the connected managed workspace in a real browser, and exercise the exact
official JS bundle and installed Linux/amd64 package with its matching actors.
Then complete performance measurements, package exports/Doctor/adoption, the
repository's applicable suite, artifact hashing and updater selection. A compiled
executable with the default source actor remains deliberately unavailable.

Automatic working-hours coverage extension, offer/slot generation, public booking proofs,
domain-contact/guest participant adapters, type-catalog/resource-policy administration, effective-dated location eligibility,
recurrence, clinical visit/lobby/attention transitions,
source-bound Jobs/Torrent effects, reminders,
outbound channels, public self-booking and AI remain later stages of the approved
integration plan. The hosted local-state UI is not evidence that these backend
features are implemented. Keep the independent core useful without silently
enabling optional services or treating this checkpoint as full calendar completion.

The additive migrations and scheduling/block/authenticated-hold/location/type/lifecycle/visit paths also need physical
existing-file upgrade/recovery, actor restart/contention, managed compliance and
real-browser acceptance alongside the earlier core gates. Passing source/memory
checks is not evidence those scenarios have run or that a production domain may
be migrated.
