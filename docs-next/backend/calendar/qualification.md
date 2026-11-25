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

## November 25: full completion audit and private series implementation

The release review compared Calendar `25e9f06281ef850a2ee6aff995f1f04d6c4b7ab2`
with main `86c6141f125d73a3d5272310beb81e2139d648f9` (qualified 2.11.1). Main
contains Scheduler, durable Jobs, workers and experimental local Calendar UI,
but no Calendar backend/configuration/server export. Independent code review
confirmed the remaining work in the [finish-line ledger](../../_work/calendar-integration-plan.md#finish-line-execution-ledger).
It is not only an unrun-test backlog: persistent series/coverage, booking/proofs,
actual reminders, public integration activation and management/clinical controls
have missing implementation. They must not be described as completed or optional
exclusions from the agreed full-product release.

Implementation resumes at the private F5 source family:

- `human-request-key.ts` defines the fixed eight-family human receipt namespace,
  preserving existing ordinary/operator IDs and checks. Native series receipts
  remain in their distinct owner/source/generation namespace. Ordinary/operator
  writers use bounded primary-key probes, not a retained-history union. Family
  conflict does not grant replay access or bypass current target authorization.
- `recurrence-cursor.ts` adds immutable runtime-owned progress and explicit
  trusted-checkpoint restoration. COUNT, skipped dates and DST gaps advance in
  bounded batches instead of restarting indefinitely at the old 4,096-candidate
  ceiling. Progress is not a native grant or UTC occupancy certificate. Its
  expected digest must come from trusted retained source evidence, not caller
  JSON. Engine/source/generation replacement fails closed.
- `realm-series-migration.ts` defines the private candidate `020` source/grant/
  acceptance/publication storage family. It is **not registered in the current
  Calendar realm**, mounted, exposed through service commands or enabled by
  configuration. Existing `001`–`019` definitions/checksums and current owner
  identity remain unchanged. Schema acceptance/publication facts are not proof
  that appointment children or occupancy were actually materialized.

The next private F5 source increment adds an initial acceptance writer and its
read-to-compilation path:

- `series-source-writer.ts` structurally normalizes an original human intent
  before replay, compiles DTSTART outside SQL, then uses the tracked writer for
  current all-resource/hard-policy admission and atomic source, generation,
  segment, scoped native-grant, preparation, receipt, effect and audit facts.
  A successful result is `series.plan.accepted`, not an appointment publication.
  Real SYSTEM participant eligibility is rechecked by the supplied actual-COMMIT
  callback. The isolated MEMORY test installs that callback through ReactiveDB;
  the later private profile composes the callback through the runtime's real
  `DatabaseCommitAuthority` path. Physical broker/actor qualification and public
  managed activation remain required.
- `series-read-model.ts` keeps original acceptance separate from preparing,
  blocked, expired, aborted, published and retired outcomes. Historical
  publication does not disappear merely because its source later retires. Reads
  reapply current authorization and verify scoped evidence; they do not replay
  mutations, create grants or relabel expiry as rollback.
- `series-native-source.ts` reads the exact current initial single-segment source
  under fixed native owner/policy/lifetime guards. It returns a detached snapshot
  without Temporal expansion inside the SQL session. It neither reconstructs the
  initiating user's session nor treats snapshot validation as service authority.
- `series-compilation.ts` consumes that snapshot after the read closes. Its
  runtime-owned contributions bind the generation, preparation/manifest/expiry,
  policy, engine, complete grant set, resource revision vector and exact cursor
  progress. Nominal child identities are stable across effective-time changes;
  bounded zero-output work still advances. Every ordered candidate participates
  in the batch digest, including batches larger than one canonical-value limit.
  Nominal completion remains distinct from UTC occupancy coverage.

After the private native composition below, F5 still requires complete selected-child
edit composition, exception/split/one-future-all semantics, sparse coverage
and actual Jobs continuation, then facade/UI activation together. Physical
native composition also remains unqualified. No partial table, cursor, local
preview or passing source check completes that work.

### Subsequent private native materialization work

The feature branch now implements a private matching021 parent/actor profile,
fixed owner facade, locally retained HMAC/projection proof, initial acceptance
transport, whole-resource pending reservations and bounded child/day-cell staging.
The default019 realm and migration001–019 hashes are unchanged. The private
profile reuses Calendar's coordinator and actual final-commit callback path; it
does not allocate another coordinator for the same physical root, invent a
background user, boot the main app as an actor or pass provider/dotenv secrets.
Actual subprocess/file admission remains a qualification gate, not a result of
the controlled-executor MEMORY tests.

The matching read/compile/stage path includes original receipt reconciliation
before fresh engine/policy/target admission. Fresh work still checks exact local
packet identity and current engine at the final callback. Copied accepted intent
may reconcile proven history; a copied or self-rehashed intent cannot authorize
a new write. Native-window expiry does not erase published reservations or prove
that physically retained unfinished claims are gone.

Canonical publication and its native worker-turn controller are source/MEMORY
checked together, including same-cell horizon union, exact continuation-head/CAS,
receipt-last atomic selection and bounded proof-preserving cleanup. The
[implementation ledger](../../_work/calendar-integration-plan.md#private021-native-materialization-review--november-25)
records the budgets and outstanding integration work. This remains an
unregistered private source family, not a released recurrence API or UTC
availability guarantee.

### Additive022 selected-child composition (source/MEMORY checked)

The next private profile adds a selected-view pointer and immutable adoption
publication, exact logical child heads and whole-resource working intervals.
It preserves every001–021 migration function/ledger and does not register the
candidate in normal configuration. Current point/range/busy reads compose
ordinary appointments with selected recurring children without copying them
into `calendar_appointments` or multiplying one child by its day-cell footprint.
Pending native horizons remain hidden until their actual publication, even when
their container view is already current. All-resource authorization and exact
origin/view selection precede result limits. Participant presentation remains
in the existing scoped SYSTEM broker.

The fixed022 occupancy query and forward ordinary SQL guards use the same
selection predicates. Qualified selected heads supersede stale021 cells;
unpromoted sources keep their021 protection. Both pending-claim families and
stale physical published claims remain reconciliation obligations. Readonly
override review uses this same022 conflict model, not the older019/021 adapter.
Legacy edit/cancel/reschedule/participant/lifecycle commands reject an authorized
child with `CALENDAR_SERIES_ACTION_REQUIRED`, instead of silently choosing an
edit scope; hidden targets remain hidden. This refusal does not implement the
canonical recurrence edit actions.

Actual SQLite query-plan review also corrected directory ordering to match its
resource/view index and changed lazy pagination to compound tuple seeks, rather
than repeatedly scanning an already visited range prefix. Published-claim
reconciliation follows indexed version/current-view/child/resource point probes.
The022 migration pins the exact generated shared-selection SQL inside its
checksum-bearing body, before DDL; later helpers cannot silently change fresh
installation semantics while retaining that migration checksum. These source
and MEMORY plan checks do not establish cold-file latency or total VM work.

Native021 projection facts and022 head/resource facts close inside the same
transaction and original receipt. The022 worker/controller uses a153-row base
projection budget so combined variable writes remain within256; no actor payload
limit was increased. The old021 profile remains separately usable at its original
256-row budget. Populated021 upgrades do not fabricate a promotion, rewrite the
historical issuer binding or mark range reads ready while sources are omitted.
An explicit qualified promotion/adoption path is still required.

These are completed source/MEMORY checks, not a physical/browser release.
Canonical one/future/all edits, exception overlays, split lineage, sparse UTC
coverage, actual Jobs/Torrent continuation and public configuration/UI activation
remain open. The existing storage-integrity hold still prevents physical actor,
file/HOT/WAL, browser, Linux/bundle and archive/updater qualification.

The combined source/MEMORY regression checkpoint passed **287 tests across 31
files, zero failures, 7,154 assertions in 385.76 seconds** on pinned Bun 1.4.4,
with transpiler caching disabled and the existing read-only dependency mapping.
It covers the private native pipeline and selected composition plus ordinary
commands, overrides, retained migration source admission and the registered-query
bridge. It is not a full framework sweep. The final reader query-plan and 022
SQL-replay-pin corrections were then checked in their affected suites separately;
do not relabel that combined run as exact-archive or final physical acceptance.
Initial new-test failures included a missing monthly pattern, an omitted explicit
buffer/confirmation field and strict test type annotations; they remain failed
diagnostics, not hidden successes. No permission, rollback or completeness check
was relaxed to satisfy them.

The final focused eight-file check, after those runtime/query-plan corrections,
passed **41 tests, zero failures, 1,458 assertions in 133.89 seconds**. The frozen
source plus nine affected test roots passed **3,897 files, zero TypeScript
diagnostics**, with no emit/incremental/transpiler output. Earlier type passes
with test annotations failing remain recorded diagnostics; the final correction
uses typed canonical values rather than widening runtime admission. The static
cumulative-metadata change also passed its new pure tests and the existing
native source-admission set: **39 tests, 194 assertions, zero failures**. The
documentation graph remains **913 pages/IDs/reachable pages, zero problems**.

The terminal task entry now inspects durable native state before loading a
source/compiler. Published and aborted work can drain disposable claims,
builders and unselected working projections after deadline or policy/engine
retirement, retaining immutable proof and selected reservations. The projection
also independently budgets portable payload nodes/bytes: a reproduced legal
100-participant batch exceeded the actor node limit despite satisfying its SQL
row budget. Cached trusted-subtree measurements now shorten that step without
widening actor limits or globally throttling ordinary cell-only work.

New completed diagnostics are separate checkpoints, not additive final totals:

- The final coherent affected source set passed **191 tests across 20 files,
  zero failures, 5,466 assertions in 259.04 seconds** on pinned Bun 1.4.4 with
  transpiler caching disabled. It includes the native publication/controller,
  expired and aborted recovery, superseded working-row cleanup, maximum
  participant payloads, populated016 migration, ordinary/override compatibility
  and the actual in-transaction registered-query bridge. Runtime source stayed
  frozen for this pass. The source graph plus 17 affected test roots passed with
  **2,589 source files, zero TypeScript diagnostics**. The earlier test-root type
  run failed on 24 mock/expectation annotations; those annotations were corrected,
  not runtime authorization or assertions weakened. The documentation graph
  passed **913 pages, 913 unique IDs, 913 reachable pages, zero problems**.

- The tracked initial writer plus real-human signed initial native command set
  passed **18 tests, zero failures, 150 assertions in 24.58 seconds**. It uses
  actual Guardian and the native private realm in synthetic MEMORY. It proves
  receipt/effect uniqueness and detached source reading, not physical transport
  or Linux compliance deployment.
- The pure compiler/projection/transport, fixed owner and named-query bridge set
  passed **48 tests, zero failures, 3,452 assertions in 10.77 seconds**. Earlier
  runs remain failed: adding forward-window transition evidence initially shared
  object references prohibited by the portable-value contract; separate detached
  checkpoints corrected that defect. A later maximum-shape stress test exceeded
  Bun's default five-second test timeout. Its finite 20-second test timeout is now
  explicit; this is correctness/staging-budget evidence, not a latency benchmark.

No dependency installation, generated build tree, physical database, Docker
container, browser deployment or release archive was created by these checks.
All synthetic MEMORY fixtures close their handles in `finally`. The existing
filesystem integrity hold remains active; no storage guard has been bypassed.

Documentation routing now distinguishes released scheduling services from the
Calendar backend in README, agent entrances, first-app/upgrade guides and system
indexes. The facade summaries match existing all-day, atomic participant edits
and independently authorized overlap review. See
[normal-project availability](./configuration.md#availability-in-normal-projects).

This is source/MEMORY diagnostic work using the existing read-only dependency
mapping, not independent frozen-package qualification. No application, physical
calendar state, hosted preview, normal updater selection, global storage guard or
maintenance policy is changed. Physical/browser/Linux/update gates remain open.

Completed diagnostic checkpoints, not additive test totals:

- After merging released main into the feature branch, the frozen thirteen-file
  schema/recurrence/ordinary-command compatibility set passed **194 tests, zero
  failures, 3,513 assertions in 98.17 seconds** on pinned Bun 1.4.4 with transpiler
  caching disabled. The earlier combined attempt had one incorrect uncounted
  forward-window statistic expectation; that failed run remains failed. Its
  corrected four-file recurrence rerun passed **59 tests, 2,166 assertions**.
- The initial read-model run passed four tests and failed one because its
  deliberate owner-corruption fixture attempted a protected update without
  first dropping the synthetic immutable trigger. The test now explicitly marks
  that corruption step; native guards were not relaxed. The later nine-case
  read/status/native-snapshot set passed **nine tests, zero failures, 55 assertions
  in 24.37 seconds**. It covers source-to-compiler handoff after query closure,
  temporal-free bounded reads, late native-policy retirement, expiry, historical
  publication, privacy and corrupt timestamp/selector refusal.
- Imported main private-avatar evidence pages initially failed the metadata
  check. Their bodies/evidence were preserved and missing metadata/backlinks and
  parent navigation repaired. The resulting documentation graph passed
  **913 pages, 913 unique IDs, 913 reachable pages, zero problems**.
- The final combined runtime-source checkpoint passed **231 tests across sixteen
  files, zero failures, 4,026 assertions in 134.25 seconds**. It includes the
  fourteen-case tracked initial writer, actual SYSTEM participant changes,
  transaction-bound logging/backpressure, capacity and coherent accepted-source
  → readonly snapshot → detached compilation path. The runtime implementation
  stayed frozen for this run. Subsequent test-only typing corrections were
  rechecked in the affected two files: **23 tests, zero failures, 411 assertions
  in 27.93 seconds**. No historical API or migration was relaxed.
- The broad no-emit source graph passed with zero diagnostics. The first combined
  three-test-root type check found ten test-only diagnostics (nullable fixture
  expectations, intentional readonly-fixture mutation and widened expected
  literals). Corrections preserve production types and runtime behavior; the
  final combined check passed **three test roots, 2,559 source files, zero
  diagnostics**, without emitted output or a dependency installation.

These checkpoints are not a Calendar
release, real Chromium, Linux/amd64, physical actor or exact-package result.

## November 18 finish-line review: cold admission and retained evidence

### November 19 canonical019: independently reviewed appointment overlaps

The complete branch-source package now includes disabled-by-default independent
Guardian requirements, separate per-resource/user grants/history, readonly native
create/update review, exact final appointment-overlap admission, private atomic
evidence, HTTP/SDK/live grant hooks and the connected rich-editor flow. It is not
a generic force flag, completed Calendar product or updater-selected release.
Blocks, live holds, coverage, types, visits, participants, effective locations,
all ordinary authority and storage limits remain hard requirements.

Exact frozen source pins:

- Realm: `sha256:9b8f49551bae978b0e97e6e9607d82abda6b0a5ad9e46d626bc9adf724930959`.
- Schema: `6b8eada93b8803f11eed2345ae08fd8e4a18d0577b892d393e965e6ed499cf29`.
- 019 migration: `2df83ecf28f67762f16a20499be24704889996f644ea02f9e4c08ed069cbc17e`.
- Registry: 39 commands, 40 queries. Original 001–018 checksums, both genuine 016
  identities, genuine 017 and genuine 018 declarations/registries are checked.
  Fresh raw setup and every populated prefix use staged boundaries rather than
  latest-table predefinition. No historical receipt column family was changed.

The broad compatibility checkpoint ran **557 tests across 47 files: 554 passed,
3 failed**, with 7,898 assertions in 309.43 seconds. Two old provisioning fixtures
omitted the canonical creation identity/payload and expected a missing-resource
error rather than structural admission. They now submit a complete fictional
appointment while still proving zero source allocation. The historical registry
fixture stopped at 017 and inherited latest registry entries; it now includes
genuine 018 and derives older names from that frozen historical registry. Runtime
admission and old migration hashes were not weakened to make these tests pass.
The original failed broad run remains recorded, not relabelled as a full pass.

After final stored-corruption hardening and fixture corrections, the **final
focused 19-file set passed 202 tests, 0 failures, 3,255 assertions in 131.66 seconds**.
It covers config/Guardian authority, canonical admission/rollback, actual readonly
SQL, native HTTP/SDK/SSE, grant target final fences, unknown original-only
reconciliation, all migration boundaries/historical pins, core service/runtime,
semantic source evidence and the native editor/review controller.

Other overlapping checkpoints, not additive totals:

- Canonical final 14 tests/172 assertions: independent grants, exact proof/set/
  generation binding, no-op/grandfathering, scoped single-use allowances, private
  evidence, SQL/native seals, quotas, audit rollback and corrupted source refusal.
- Native readonly/HTTP final 17 tests/202 assertions across 3 files, 17.07 seconds:
  zero-write review/cancel, authority-first private probes, 64/65 total witnesses
  with maximum identities, all-day/buffers/hard conflicts, actual authenticated
  SDK create/update/replay, default-disabled/forged input and grant SSE withdrawal.
- Frontend final 166 tests/2,223 assertions across 12 files, 3.16 seconds: ordinary
  wire compatibility, readonly provisional keys, explicit unchecked confirmation
  and reason, one mutation owner, newer drafts, expiry and authority retirement.
- Grant-target fence/service boundary 26 tests/265 assertions; later focused
  runtime/historical fixture recheck 27 tests/288 assertions. Final 202-case set
  includes these affected behaviors rather than summing overlapping totals.
- The accepted-write/lost-publication scenario explicitly proves an unknown
  result, then original-key reconciliation after grant removal and config
  disablement, without another appointment, exception history or effect.

Review found and closed a real missing target boundary: adding an exception grant
now checks finalized active current-scope Guardian account eligibility in the
managed parent and again synchronously at the native final commit fence, after
ordinary resource/independent administration admission. Actual SYSTEM suspension
tests preserve accepted replay and permit departed-target revocation. This rule
is separate from attendee eligibility and exposes no new directory.

Independent refusal uses `CALENDAR_OVERRIDE_NOT_ALLOWED` (HTTP 409) so it removes only
the review action. Genuine `CALENDAR_FORBIDDEN`/authentication loss still retires
the whole native owner. Malformed stored revisions/identities map to state
corruption, not caller-input errors or automatic repair. Private reason/witness
data never enters the single semantic event's ordinary metadata.

The initial type passes found narrowed-row serialization, a missing watch union
member, duplicate fixture fields and literal/serialized-output fixture typings.
They were corrected through actual row validation, exact query registration and
typed synthetic fixtures, not widened public authority or writable read casts.
The final no-emit graph passed **549 roots, 4,139 source files, zero diagnostics**.
Documentation validation passed **911 pages, 911 unique IDs, 911 reachable,
zero problems**. Independent cross-lane source reviews found no remaining blocker
in this package; they are not substitutes for real browser/deployment acceptance.

All successful test evidence here is cache-off MEMORY/in-process. Read copies,
migrators, streams, clients, UI roots, runtime handles and subscriptions close in
teardown. One failed diagnostic output-filter invocation was terminated by its
exact owned PID; it created no physical state and is not counted as test evidence.
No generated dependency tree, file DB, preview, container, build or archive was
created. The existing storage hold and all physical/browser/Linux/updater gates
remain unchanged. See [the supported branch-source contract](./overrides.md).

### November 19 canonical018: effective resource/location policy

Actual realm 18 adds complete scope-owned effective assignment policy through
canonical source writes, immutable retained source/windows, sealed current
selectors and the original bounded directory union. Final appointment/hold
admission checks every selected resource over the whole buffered occupied
interval. Static compatibility, explicit downgrade, original receipt replay and
accepted-history grandfathering remain distinct. Server/client policy APIs,
private interval-aware live discovery and the connected editor are wired; this
does not enable conflict override, recurring series or a management redesign.

Exact source pins at that earlier checkpoint:

- Realm: `sha256:de6ee805fc2afc7c49e8095c2c2dec4932ba2dac6770b5bfc4b6c8998a7811cf`.
- Schema: `7c15ec94ad679f2dda2cb45304a63959d292befd56abfa1f7ffc94f199d09f45`.
- 018 migration: `0519c6365efc103656480ce106bc1f593e76461b976f467b85f41823d78f0bf0`.
- Registry: 38 commands, 37 queries. Original 001–017 hashes, genuine 017
  fingerprint and both genuine 016 pins remain explicitly checked. Raw fresh
  migration and every populated native prefix are exercised without latest
  table predefinition. 018 derives legacy selectors and one immutable version
  marker; it does not invent authored effective policy or alter old usage rows.

The broader combined checkpoint ran **455 tests across 36 files: 454 passed and
one failed**, with 6,451 assertions in 212.23 seconds. The failure was a test's
incorrect assumption that maximum legal policy JSON exceeded 24 KiB; its actual
size was 23,051 bytes. The corrected maximum-distribution case proves 23,063 bytes
are admitted without a hidden lower cap. The production byte guard remains
unchanged. This original failure is not relabelled as a clean full run.

After corrections, the final focused set passed **138 tests, 2,927 assertions,
10 files** in 76.49 seconds: canonical policy, native date/interval discovery,
HTTP/SDK/SSE, all native migration stages and historical identities, runtime,
service, dense directory, source-audit pressure/privacy and editor interval model.
Separate overlapping checkpoints, not additive totals, include:

- Native canonical/query/HTTP: 40 tests/293 assertions after typed SQL binding
  corrections; prior canonical/holds/update/source-audit set 83 tests/672 assertions.
- Query/HTTP plus earlier visit compatibility: 35 tests/372 assertions, four files.
- Frontend SDK/hooks/editor/workspace compatibility: 134 tests/1,518 assertions,
  12 files. Constructor-preserving Intl test-double correction then passed its
  three cases/17 assertions without a production change.

Early tests caught a real static-policy normalizer bug: passing `calendarKey`
directly to `Array.map` supplied its array index as the optional size limit. An
explicit one-argument callback fixes that; native/SDK parity tests remain. Old
directory fixtures also omitted the new legacy selector or assumed six reads
instead of the additional bounded per-resource integrity proofs. They now build
valid current state and assert those proofs separately; corruption fixtures
remove only the exact synthetic seal needed for injection. Historical registry
fixtures are derived from genuine retained registries, not polluted by new names.

The initial no-emit graph reported 13 SQL-binding/query-generic/literal/test-double
diagnostics. Bindings now narrow/validate their values and preserve native query
tuple types; contracts were not widened. Final no-emit checking passed **529
roots, 4,119 source files, zero diagnostics**. Documentation validation reports
**909 reachable pages/unique IDs, zero problems**.

Actual `LoggingActorSource` evidence verifies one private semantic event per real
policy change, none for replay/no-op/rejection, and complete rollback under source
queue backpressure. SQL seals structural identity/scope/cardinality/late writes;
the final native resource intent additionally proves exact source-to-epoch cell
agreement before receipt/effect. This is not independent SQL date compilation or
full managed compliance/deployment qualification. Native HTTP fixtures use actual
Guardian/service/transactions and explicitly simulated physical coordination.

All tests here are cache-off MEMORY/in-process checks with owned read copies,
streams, runtimes, migrators and UI roots closed in teardown. No physical fixture,
browser preview, Docker/build/dependency tree or archive was generated. Storage
status/check still return the existing integrity hold. Real file/WAL/HOT,
browser/layout, actor/restart, installed Linux and updater gates remain unexecuted.
No main merge or Calendar backend release selection is claimed. See
[Effective location policies](./location-policies.md).

### November 19 canonical017: all-day appointments, date queries and connected UI

Actual realm 17 now registers the complete appointment-only LocalDate path:
canonical nested create/update intent, retained time facts, sealed indexed current
dates, date-native reads/watches, service/runtime/HTTP/SDK and the connected rich
editor with day/week/month/agenda all-day presentation. Ordinary timed wire/digest
families remain unchanged. Blocks and holds remain timed-only. This completes the
LocalDate arm of F4, not independent override/effective eligibility, recurrence,
booking, real reminder channels or the full management/clinical product.

Current native pins:

- Realm: `sha256:d31941943b5362c8437134cf2d319a527e3717f1d111fca40e495a7604244da0`.
- Schema: `e864c6ca7e48e5f9df24b8094115b3f90b5c1e7982e4afae6392b22818901d63`.
- 017 migration: `4af3fc3652beaedc35df0398b60e006c04bf4451ba437cc52ad5584592a043e6`.
- Registry: 37 commands, 36 queries. Both genuine 016 realm fingerprints remain
  historically admitted; 001–016 handlers, hashes and old registry provenance
  remain unchanged. A dedicated genuine 016 test realm keeps historical upgrade
  targets honest instead of relabelling old tests as 17 coverage.

The combined checkpoint passed **347 tests, 4,285 assertions across 27 files** in
142.84 seconds. It includes actual authenticated native HTTP→SDK→service→MEMORY
round trips, date queries, canonical 17 writes/migration stages, historical realms,
capabilities, earlier update/hold/participant/lifecycle/working-hours service paths,
the integrated Calendar/Jobs coordinator and runtime, SDK codecs/retirement, hooks
and connected UI/model/controller checks. This is not a browser or physical actor
run. The test fixture explicitly simulates physical coordinator/transport/file
probes while using real Guardian/service/native transactions.

Separate focused evidence, overlapping rather than summed:

- Canonical writers: 130 tests/1,395 assertions across eight files; final compiler/
  writer/date set 55 tests/598 assertions. These include 31-date fall-back spans,
  accepted reads/replay/title/participant/lifecycle/cancel without Temporal/current
  Intl, explicit kind conversion/type clearing, required-type refusal, whole-span
  availability/conflicts, quota rollback and confirmed-hold history after conversion.
- Registration/provenance: 70 tests/1,347 assertions across five files. Retained
  historical upgrade suites: 57 tests/9,347 assertions across 15 files. The final
  native stage-only confirmation passed 20 tests/569 assertions.
- Actual registered 17 HTTP/date integration: 17 tests/176 assertions across two
  files. Its real SDK date SSE checks native commits, grant-loss withdrawal and
  physical subscription cleanup; no listener/file/provider was opened. The final
  test-only HTTP harness correction was rechecked: four tests/72 assertions.
- UI/model/controller baseline: 128 tests/1,660 assertions across 12 files; final
  resource-labelled agenda/render correction: three tests/49 assertions. Civil
  navigation/formatting preserves 0000–9999, cross-zone authored dates, inclusive
  human labels and exclusive API ends, with no fake midnight minute events.
- SDK compatibility: 48 tests/277 assertions across four files. New direct codec
  cases cover engine-independent captured views, zero-transport mixed/invalid
  inputs, exact request identity, year 0000 and late-authority retirement.

Initial SDK cases incorrectly expected Promise rejection for the existing SDK's
synchronous input refusal; tests now assert that actual contract. Early combined
typing exposed test literal/generic/constructor-double mistakes and one real
editor serialization typing issue: conditional optional `interval` could not
prove the exclusive public union. The editor now returns explicit interval versus
omitted-interval branches; contracts were not widened. A later graph caught a
stray unused HTTP fixture argument and a test helper incorrectly typed as the
latest rather than generic realm. Both are test-only corrections; initial failures
remain evidence, not relabelled passes. Final no-emit checking passed **517 roots,
4,107 source files, zero diagnostics**. Documentation validation reports **908
reachable pages/unique IDs, zero problems**. No full frozen-release sweep is claimed.

The final public component entrance also exports the civil-date field, all-day
cards and their props/occurrence types for application composition. After that
export-only follow-up, the editor/render set passed 18 tests/468 assertions and
the same 517-root no-emit graph again returned zero diagnostics.

The source guide is [All-day appointments](./all-day.md). All owned MEMORY/read
copies, native test runtimes, SDK streams, hook roots and overlays close through
`finally`/test cleanup. No generated dependency/build/cache, physical fixture,
browser preview, Docker resource or archive was created. Real browser/layout,
file/WAL/HOT, actor/restart and installed Linux/package/updater qualification
remain unexecuted; this branch is not a selected release or main merge.

### November 19 follow-up: bounded residency and original migration boundaries

The private managed composition now selects catalog-driven bounded residency and
binds native Jobs demand hydration before start/tick seals construction. The
combined native managed/coordinator/residency/controller/source-hydration set
passed **145 tests, 4,099 assertions, five files** in 80.56 seconds. These are
MEMORY SQL plus explicit native transport/scheduler doubles, not createApp/file,
real browser, actor or deployment qualification. They cover more than 64 retained
owners through a bounded resident set, permanent failed stages consuming no slots,
idle eviction/revisit, exact multi-source refusal, retained evidence, current pin
and policy drift, full schedule pools and held owner intake during original-key
read-only attachment. The broker-only quota test covers 1,025 sequential retained
registrations without increasing its 1,024 resident ceiling.

The first managed composition run had **13 passes and two failures**. One test
observed intake idle before the complete global wake had finalized; it now waits
for the explicit read-only `wakeActive` diagnostic as well. The other exposed a
real cancellation-propagation defect: catalog processing discarded a started
callback's original unknown result during quiesce, later reporting only not-ready.
It now preserves that original lifecycle error. The clean 145-test set includes
both corrections; the first failing run is not relabelled as passing.

Native source controls have their own bounded pool, independent of per-schedule
capacity. Final physical drainage joins both before persistence closes; early
drain retains evidence for Torrent. Unreadable Calendar private files no longer
block every owner at native catalog startup. Exact SYSTEM metadata is still
validated globally, and every individual owner retains existing-only physical
proof before use. The runtime suite passed **25 tests, 200 assertions** including
missing-owner isolation, healthy-owner proof and all metadata/refusal fences.

The optional native table-stage repair passed **79 tests, 1,062 assertions,
six files** before Calendar activation. Actual Calendar opt-in/provenance then
passed **44 tests, 904 assertions, five files**, plus a focused original-hash/
receipt set of **two tests, 165 assertions**. Tests now run actual raw fresh
Calendar 001–016, every populated prefix, and the 011/012/014/016 derived
backfills, without precreating the latest schema. Original functions, hashes,
successful ledgers, retained rows and receipt identities stay intact. Version16,
37 commands, 35 queries and schema checksum
`a9de3c82718367f9dfb5db628706f7a2b2fda542d12fc27be8d2d589a8d1f2a4`
are unchanged. The manifest-bearing fingerprint is
`sha256:fcfd500b5352a27f6bc43d9122c1af8cdafc85680994f4191ee75903485179f8`;
the genuine previous016 fingerprint remains an explicitly reconstructed
historical policy pin.017 is still unregistered.

Framework-source review found and fixed a valid native legacy logging ALTER
shape rejection and oversized TEXT materialization before codec checks. SQL now
applies native text/UTF-8 ceilings before returning those values to JavaScript,
without introducing a new Sync history limit. That focused set passed **71 tests,
437 assertions, four files**, including 27 helper cases. Current-file admission
must not repeatedly decode all permanent receipts and log payloads; the separate
current/preparation proof and its final tests are recorded with the completed
checkpoint, not inferred from these earlier results.

The first combined no-emit check exposed five test typing errors: a nullable
binding expectation and missing explicit generic protocol-double parameter
types. They were corrected without widening runtime contracts. An initial
broader realm-test load also lacked the existing Valibot ESM alias; the approved
external dependency overlay resolved it without installing dependencies.
Focused sets overlap and are not summed. Final combined checking and any later
corrections must be distinguished from these initial runs.

The complete combined native checkpoint subsequently passed **284 tests, 5,911
assertions across14 files** in131.42 seconds. It includes native managed wiring,
runtime isolation, coordinator/controller/residency, source hydration/service/
shutdown, actual Calendar table stages, genuine historical realms/bindings,
booking admission, private series authoring and the unregistered017 time facts.
Combined no-emit checking passed **505 roots, 4,094 sources, zero diagnostics**.
An independent20-test realm-composition pass exposed/guards the existing-realm
adapter seam: a native stage manifest cannot silently disappear when adapting a
realm into a contribution. Documentation validation reports **907 reachable
pages/unique IDs, zero problems**. These remain MEMORY/source results, not a
measured file-mode performance or physical deployment claim.

Final migration/source/current-admission checking passed **152 tests, 1,451
assertions across nine files** in19.57 seconds. The focused performance/refusal
set passed **89 tests, 527 assertions across four files**. SQL-observation tests
prove one retained Sync-format stream and no receipt/log-payload streams on
current/full-prefix no-op admission, while actual pending migrations still reject
malformed retained content before initialization and under the boundary lock.
This is structural current-source admission, not a claim to attest every retained
payload. Native staged rollback—including no-op targets—rejects before SQL,
backup or checkpoint; ordinary rollback remains supported.

A final source-dispatch review found a real classification defect: after native
durable dispatch proof succeeded, a stale local binding was reported permanently
retired. It now returns recoverable not-ready. The focused native Jobs set passed
**85 tests, 2,787 assertions across three files** in17.23 seconds. Actual MEMORY
writer/runner tests prove claim deferral without permanent blocking, zero-key
read-only reattachment, one original Torrent execution and continued definitive
rejection of the genuinely retired old generation.

No physical fixture, dependency install, emitted build/cache, Docker resource,
archive or production data was created. F3 public feature activation/adoption,
F4–F8 completion and real physical/browser/Linux/package/updater gates remain
open. There is no main merge or normal updater selection in this checkpoint.

### November 19 follow-up: durable wake admission and stable native residency

The new native SYSTEM wake catalog and original owner-schema tests passed
**31 tests, 320 assertions, two files**. These are actual MEMORY SQL/transaction
checks, not a physical file qualification. Coverage includes resumable bounded
seeding beyond 64 owners, insertion behind cursors, fixed-horizon fairness beyond
a permanently failing prefix, exact schema/owner admission, configuration/dirty
CAS, failed-proof fencing and atomic establishment rollback. Generation-zero
metadata cannot publish quiet. Retry/review publication advances the failure
generation and never fabricates successful observation.

Runtime/managed/coordinator wiring is now implemented: native-only opt-in,
dirty-before-private-lease commands, atomic establishment seed, whole-operation
tracked final-turn refresh and exact code-graph configuration invalidation.
The final three-file runtime/managed/coordinator set passed **85 tests, 796
assertions** in 52.41 seconds. The earlier five-file date/wake/runtime/managed/
native-pin integration set passed **94 tests, 954 assertions** in 28.83 seconds.
Those sets overlap and are not summed. A separate final shutdown/startup check
passed **three tests, 21 assertions**; the original runtime suite passed
**20 tests, 154 assertions** before those added checks.

Independent review found an actual self-hint idle loop: an empty claim changed
the pass's RAM revision even after canonical quiet publication. The integrated
path now compares only the final-refresh window, while standalone retains its
original pass baseline. A managed test repeatedly becomes quiet after empty
claims (**one test, 13 assertions**); a concurrent publication-window hint and
adjacent cases passed **four tests, 37 assertions**. These are explicit native
MEMORY composition/scheduler doubles, not real browser or process evidence.
Busy physical writes receive finite dirty retry metadata rather than spinning
an immediate global wake; only a later canonical observation can clear it.

The stable selected/prior capability inventory, historical-broker separation,
controller late-callback accounting and final-turn hook set passed **95 tests,
1,408 assertions, three files**. Native atomic source-set detach then passed
**171 tests, 3,445 assertions, nine files**, with the final unchanged-source
confirmation **20 tests, 2,230 assertions**. The broker recognizes only its
minted handles, validates every owner before final pin/membership checks, and
removes the complete set without callback/await interleaving. A later busy,
foreign or replaced handle cannot leave earlier sources partially detached.
Root review independently confirmed that boundary. This does not yet provide
an owner registry, eviction or demand hydration.

The private unregistered `017` date-storage/compiler/`016`-upgrade set passed
**38 tests, 1,060 assertions, three files**. Earlier duplicate trigger declarations
were fixed. One later run had 37 passes and one wall-clock timeout; that exact
case passed in 0.95 seconds, followed by the complete clean run above. Historical
001–016 hashes remain intact; no canonical all-day capability is enabled.
The native owner-independent registered-graph stamp/deferred-start set passed
**14 tests, 95 assertions**, including proof that a stamp cannot bypass a
tenant-shadowed scoped pin or outlive the workflow owner.

Final combined no-emit checking passed **497 roots, 4,086 source files, zero
diagnostics**. Initial passes caught new helper control-flow typing and test
constructor/union expectation errors; these were corrected without widening
production contracts. The first inventory test invocation used the wrong
dependency/timeout harness and failed; only the approved exact-overlay rerun
above is qualification evidence. No full frozen-release suite is claimed.

A separate raw fresh Migrator probe confirmed that Calendar `001` assumes tables
which native file startup has not created. The ordinary MEMORY service skips
migrations and cannot disprove that defect. The F3 repair plan now requires
per-original-boundary table preparation without editing historical migration
functions or predefining a latest schema over a retained file. This remains an
explicit implementation/release blocker.

All owned test/compiler processes and MEMORY handles closed. No physical
fixtures, temporary dependencies, emitted build/cache, Docker resources or
archives were created. The unchanged integrity hold is not bypassed. Global
resident owner leases/demand attach, the rest of F3–F8 and actual physical/
browser/Linux/package/updater gates remain open; there is no main merge or
normal updater selection in this checkpoint.

### November 19 follow-up: physical source lifetime and canonical time foundations

The idle source attachment/final shutdown set passed **159 tests, 3,365
assertions, nine files** in 50.99 seconds with pinned Bun, disabled transpiler
cache and synthetic MEMORY state. It covers read-only exact-key attachment,
busy/stale detach, sequential residency reuse, cancellation and late physical
callbacks, plus held pre-gate confirmations/reads and unused/running dispatch
permits. Independent review confirmed final-close-only ordering: Jobs must join
those bodies before SQL teardown without prematurely retiring Torrent evidence.

A private timed-source/series-authoring and LocalDate calculation set passed
**86 tests, 1,225 assertions, eight files**. The original 24 timed recurrence
conformance tests also remain unchanged. The private LocalDate compiler handles
exclusive dates, DST/midnight gaps and missing boundary dates without pretending
that a day is 24 elapsed hours. Typed immutable timed series input is separate
from query ranges. Neither foundation enables persisted all-day appointments,
series, coverage or recurrence configuration; their canonical storage/API/UI
integration remains required.

Review also found a real transferred-appointment authorization defect: lifecycle
projection read every historical reservation rather than the current resource
membership. It now uses the canonical current-target resolver. Native transfer,
large retained history, corrupted current metadata and live watch withdrawal
checks passed **35 tests, 1,013 assertions, five files**; the adjacent
live/corruption/workspace set passed **17 tests, 810 assertions, three files**.
Removed historical resource grants no longer block a current status read, while
revocation of a current resource still withdraws the view. These are overlapping
focused sets, not a sum or an exact installed browser/deployment qualification.

The combined no-emit graph then passed with **491 roots, 4,080 source files and
zero diagnostics**. Initial checking found three new test-only typing mistakes
(an error-code helper and a union-spread expected rule); those were corrected
without weakening production types. Subsequent wake/catalog and date-storage
implementation is not covered by this frozen checkpoint.

No physical fixture, build/dependency tree, Docker resource or archive was
created; all owned test processes and MEMORY handles closed. Source/docs remain
on the feature branch. Durable owner wake metadata, bounded Calendar residency,
the rest of F3–F8 and physical/release gates remain open. No main merge or normal
updater selection is implied.

### November 19 source checkpoint: final-writer capacity and rich connected editing

The next combined cache-off pinned-Bun MEMORY/ReactDOM/native-HTTP/SDK/Jobs/
Torrent set passed **1,285 tests, 26,522 assertions, 147 files** in 283.04 seconds.
The real physical Calendar/app fixtures were explicitly excluded; the IPC/file
seams that remain doubled are not deployment evidence. This run is not the full
frozen-release suite. Counts from overlapping focused checks are not added to it.
Final combined semantic checking passed with **485 roots, 4,074 imported source
files and zero diagnostics**, with emit/incremental output disabled. The final
three-file test-correction/adapter check passed **18 tests, 176 assertions**;
documentation validation again passed **907 reachable pages**, zero problems.

Additive Jobs `004` installs all-generation per-source/schedule/occurrence
settlement membership and fixed aggregate counters. A real populated managed
`003` → `004` MEMORY migration preserves every old row, counter, SQL object and
ledger; corrupt work/history accounting, incompatible declarations and late DDL
failure reject atomically. Actor pause/cancel obligations are counted separately
from source controls. Unknown/blocked generations remain occupied. The new
ledger/helpers alone passed **13 tests, 201 assertions** before integration.

The normalized finite Jobs policy is bound and fingerprinted inside the actor.
The final native writer conserves generic permanent keys plus outstanding
settlement units in the same transaction as domain changes, original receipts
and final authority. Source/actor recovery intents also retain logical headroom.
At pressure, fresh ordinary claims/defers/no-op retries cannot spend that reserve.
Original-key replay comes first. The native runner can reconcile an original
MAC-sealed accepted Torrent handoff after claim expiry without buying a new claim
or authorizing enqueue. A missing receipt is not absence proof. Hard-full legacy
files cannot mint another physical key merely by conserving a policy deficit.

Capacity v3 composes actual writer retention counts/current-policy proof with
working and retained domain measurements under the same existing owner lease.
It is read-only, aggregate-only and authority-fenced across awaits. Tests exercise
the real coordinator FIFO and native MEMORY writer with an explicit IPC double,
including queued cancellation, supported timeout options, malformed-producer
protocol retirement and failure accounting. Independent review confirmed replay,
binding, pressure and publication ordering. Hostile nested definition proxies are
rejected without evaluating their traps.

The default connected workspace now composes the approved rich modal content
with one native async owner. Full resource sets, title/time/buffers, type, visit
and changed native participants go through one canonical update. Exact initial
participant hydration stays pristine; omitted sets remain unchanged. The modal
permits newer editing while pending but blocks duplicate dispatch. Required
synchronous parent recovery registration precedes dispatch; failed registration
cannot start a write. Settlement observers cannot rewrite a proven acceptance.
Unknown outcomes retain the original identity and reconcile by reading, never
resending. The local synchronous modal contract/layout remains compatible.
Unsupported clinical/appearance/notes/recurrence/reminder/invitation controls are
explicitly unavailable, not fake persisted fields. This is not complete F8.

Private shared booking admission now factors scope-only policy/catalog checks
without granting authority or constructing background users. Human wrappers
retain resource rights, participant fences, replay/CAS, grandfathering, budgets,
audit and persistence. Native parity tests retain the exact `016` realm, schema
and migration pins; no series registry or schema is enabled by this factoring.

The first combined no-emit pass exposed an actual coordinator-inspection API
mismatch plus test typing errors; the native path was corrected and given real
FIFO/producer-failure regressions. A later pass exposed two test comparison-type
errors, corrected by comparing the proper raw-row projection and explicit
expected failures rather than casting production contracts. Earlier mixed UI
checks also caught the intermediate old workspace harness while the rich owner
was being integrated. Those initial failures are preserved, not relabelled as
passing initial runs.

The finish-line plan now specifies resident-owner hydration, managed activation/
adoption and complete series/coverage publication. These are remaining contracts,
not enabled production capabilities. F3/F5/F6/F7/F8 completion and all physical
qualification remain open. No selected archive, main merge, updater change or
application deployment is implied by this checkpoint.
All owned test/compiler processes finished and MEMORY handles closed. No physical
fixture, dependency tree, generated cache/build, Docker resource or archive was
created. Source and small documentation evidence are retained; the unchanged
external-volume integrity hold still prevents physical qualification/packaging.

### Prior combined source checkpoint after working capacity and atomic editing

The combined cache-off native MEMORY/ReactDOM/HTTP/SDK/Jobs/Torrent/worker set
passed **1,282 tests, 25,906 assertions, 147 files** in 281.88 seconds. Physical
transport/owner seams remain explicit doubles; no file-runtime scenario was
silently counted as executed. The expanded final no-emit graph passed with
**450 roots, 4,046 imported source files and zero diagnostics**. Documentation
validation passed for **907 reachable pages**, zero structural problems.

Additive Jobs `003` separates current working schedules/occurrences from immutable
history. Native tests close more than 1,000 one-shots on one unchanged source,
retain history/counters and original-key replay, exercise full live quota and
reacquisition, preserve old-generation unknown/blocked occupancy, and observe
actual JobsRunner/sealed Torrent terminal evidence. Populated managed-memory
upgrade validates retained rows, checksums, accounting and late-DDL rollback.
The private capacity projection is explicitly version 2; Calendar inspection
shows working and retained measurements separately. Configurable history limits,
transport settlement reservation and scalable resident hydration remain F2 work.

Additive Calendar `016` supports one atomic `appointments.update` through the
canonical writer, native service, HTTP PUT, SDK and connected editor. Current
resource membership is a bounded derived projection, never the union of all old
reservations. Immutable private update snapshots preserve before/after facts;
semantic evidence records only safe change flags. The real managed-memory
`015` → `016` test does **not** predefine new tables, and proves owned DDL,
shape rejection, cancelled-set preservation, retained old rows/ledgers/digests,
late rollback/retry and warm missing-projection rejection. Captured hold evidence
and original confirmation replay remain valid after later appointment changes.
Genuine complete `010`–`015` integration realm identities are pinned.

The connected native modal now makes title/time/type/visit and single-calendar
transfers one update. Multi-resource sets cannot be collapsed by its single-value
selector. The participant dialog remains an explicit independent command; the
native atomic API supports including participants in a single transaction for
app-owned richer editors. Fresh catalog admission after transfer, dirty/reverted
save guards, duplicate submit, newer typing, scope retirement, unknown outcomes
and original-key reconciliation are covered. This is not the complete recovered
rich editor/clinical/booking management surface.

Review found and fixed a transferred-type UI intent mismatch rather than relying
on final server rejection. Earlier checks also exposed test receipt inference,
generic assertion typing and a reconstructed historical fixture containing a
new registry name. They were corrected and rechecked; those initial failures are
not represented as passing. The shared final run above includes the corrections.

All owned processes and MEMORY handles finished and closed. The accidentally
invoked package runner's exact internal diagnostic path was absent on final
inspection, with **zero retained bytes**; no parent-directory sweep occurred.
No physical fixture, dependency install, build, Docker resource, preview or
archive was created. Source checkpoints are not a physical/adoption/release
certificate. The existing volume-integrity hold still blocks those gates, and
no Calendar backend archive has been selected for normal update.

### Focused evidence and reviewed limits

The authoritative [finish-line ledger](../../_work/calendar-integration-plan.md#finish-line-execution-ledger)
now includes the complete approved system, rather than treating a private
observation bridge as Calendar completion.

Native cold admission is implemented as an optional trusted Fabric contract.
Established current Calendar owners require read-only physical binding, exact
owner-row, native ledger/declared-schema and available framework-invariant proof
before writable actor preparation. Explicit older-schema setup must first prove
the existing owner. Only staged creation admits an absent owner, never a present
mismatch. Parent and replacement writer/reader generations refresh, detach and
acknowledge the same admission contract. Ordinary consumers omitting the option
keep their existing path. Same-lease owner and final current-authority fences
remain separate and required.

The native MEMORY/parent/protocol/codec/Calendar policy set passed **44 tests,
370 assertions, six files**. This verifies immutable snapshots, malformed/current/
old ledger rejection, absence of SQL mutation, frozen legacy sync allocator with
advanced managed history, exact bind proof, after-start resolver refresh,
strengthening-only admission and Calendar staged/established metadata policy.
Physical path/actor transport is simulated where used. The shared history codec
now validates iterables in one pass; cold proof streams retained rows and closes
its statements instead of buffering the full log. It still validates every row
and decodes each individual payload. This is not a constant-time or physical
performance claim, nor arbitrary trigger/view-equivalence proof.

Readiness and evidence recovery are distinct: retired configured rules no longer
block unrelated Calendar writes or implicitly revive, removed active rules remain
review-blocked for fresh capture, and original receipt/cancel/retirement evidence
can progress without configuration resurrection. Zero-rule evidence-only
composition is allowed. Fresh observation admission checks the exact configured
policy and native code pin after waits and at the source writer; accepted facts
retain their independent settlement lifetime. The focused lifecycle set passed
**103 tests, 1,402 assertions, four files**; a final fairness regression passed
separately (**one test, 11 assertions**). These counts are overlapping focused
runs, not a summed full-candidate result.

The new private timed recurrence calculator passed **24 tests, 370 assertions**;
its combined time/working-hours set passed **47 tests, 666 assertions**. It admits
only a closed daily/weekly/monthly/yearly dialect, explicit zone/fold and elapsed
duration, skips generated invalid dates/gaps without consuming count, and reports
bounded evaluated coverage/truncation. Boundary-year and exhausted-count cases
are covered. It is not a series store, exception/split engine, automatic horizon,
slot proof or reservation promise, and is not enabled by public configuration.

Review caught and corrected a frozen-legacy-sequence comparison and SQLite
boolean representation mismatch. The first expanded no-emit check reported two
new foundation/test typing diagnostics; those were fixed, not represented as an
initial passing run. The combined final no-emit result is recorded above.
All MEMORY resources close in `finally`; no physical fixtures, dependencies,
builds, Docker resources, previews or release archives were generated by these
checks. The existing filesystem-integrity hold remains unchanged. File/WAL/HOT,
real browser, Linux/amd64, installed archive and updater acceptance remain
unexecuted, and no Calendar backend archive is selected.

## November 18 source-atomic initiating-user acceptance checkpoint

The following private phase adds actor-bound operator acceptance in additive
`015`. Local retirement or next-epoch activation intent, the initiating receipt,
capacity charge and enabled semantic audit join one source transaction. Existing
local pointers and the original `012` control journal supply native recovery;
there is no second operator work queue. No public configuration, operator route,
SDK member, application deployment or archive is enabled by this checkpoint.

Source and combined native-memory checks cover:

- Exact initiating-user receipt replay before current pointer, desired-contract,
  graph/configuration or native running-state checks. Source replay remains
  currently manager-authorized and bound to the original scope/principal/user.
  Reused keys conflict across all six ordinary Calendar receipt families.
- Real `014` → `015` populated migration preserves old closures, complete table
  maps, metadata, accepted rows, ledgers and sequence. Conflicting identities and
  late migration failure refuse/roll back. Genuine committed `014` compatibility
  is pinned instead of rewriting source or downstream contracts.
- Audit pressure and late source refusal roll back local state, new policy
  history, actor receipt and usage together. Actual source outbox assertions
  verify human attribution and separate system-owned recovery; replay/no-op adds
  no false semantic change event. Logging disabled creates no logging schema.
- Ordinary receipt exhaustion cannot consume changed-retirement reserve; no-op
  and reactivation cannot spend that reserve. Reserve exhaustion still refuses
  atomically. Audit pressure, ownership failure and source capacity remain real
  admission blockers, never bypassed to force a successful response.
- The existing-only runtime lane never calls owner provisioning/binding or
  ordinary source readiness. A retired readiness hook cannot block its repair.
  Captured SYSTEM ownership is fenced across reads, final writer admission and
  acknowledgment. A simulated replacement before writer execution leaves the
  old physical source untouched. Wrong root/realm contracts are rejected.
- Real Guardian fixture admission rejects ordinary users, anonymous, native and
  previously admitted API-key callers. Strict field/callback/routing rejection,
  selection detachment, account/scope/policy replacement and cancellation remain
  live. Predispatch refusals prove no attempt started; post-acceptance loss stays
  unknown and is reconcilable only with fresh authorized original-key reads.
- The private managed facade uses the exact Logging owner installed on its
  Calendar provider and real expiring `LoggingAdmission`, including live trusted
  authority properties. It does not acknowledge/probe or mint a request grant.
  Human attribution retires after the acceptance callback, including retained
  children; background work explicitly drops it.
- The combined native MEMORY test accepts a human retirement, explicitly runs
  the existing absolute Scheduler wake, observes real original-key Jobs/control
  retirement, then accepts a new local reactivation epoch and observes actual
  native activation. After coordinator intake drain, both original human
  requests still replay without another compilation/control mutation.

The contract is documented under
[atomic initiating-user acceptance](./integrations.md#atomic-initiating-user-acceptance).

The expanded native-memory baseline passed **835 tests, 18,850 assertions,
97 files** in 204.92 seconds. Final review then added an outer-await authority
fence on accepted receipt replay and its deterministic microtask regression.
The final focused source/operator/audit/upgrade/Guardian/native coordinator/
managed composition set passed **123 tests, 2,300 assertions, 11 files** in
53.65 seconds. These are distinct runs, not additive totals; the 97-file run is
not represented as a run of that last guard delta.

Early failures included an invalid alias-containing transport hash, fixture
credential admission and predispatch-outcome expectations, a test privacy regex
matching the required `workflow` family, and fixture JSON typing. They were
corrected and rechecked, not relabelled as initial passes. Review additionally
closed a stale SYSTEM-owner window before the final baseline; the focused source
test proves that replacement cannot mutate the old physical file.

The final no-emit graph passed with **421 roots, 4,021 source files and zero
diagnostics**; emission and incremental output were disabled. Documentation
validation passed for **907 reachable pages** with zero structural problems, and
`git diff --check` passed. All owned MEMORY databases, read snapshots, workflow
owners, timers, clocks and pools were closed in `finally`; no dependency install,
file-backed fixture, actor process, build, Docker resource, preview or archive
was created by this phase. Source, docs and existing held artifacts are preserved.

These are source/MEMORY checks with explicit physical transport doubles, not a
managed `createApp`, browser, physical actor, bundled Linux or installed-archive
qualification. In particular, a cold `acquireExisting()` can still prepare native
schema before the domain owner check. Current metadata and MEMORY proof do not
qualify that as a no-migration production boundary. That gate remains explicit
before public activation, alongside sustainable capacity, larger owner catalogs,
the adoption/disable procedure and deployment/update qualification.

## November 18 private operator inspection and selected-control checkpoint

The next private source phase adds bounded rule/control/capacity inspection,
selected native retire/reactivate and a Guardian-managed **read-only** projection.
It does not enable public mutations, automatic configuration, reminders, sends,
recurrence, booking or any new application/hosted-demo behavior.

Reviewed boundaries and regression evidence include:

- Additive `014` preserves the original `001`–`013` closures, full historical
  declaration maps, ledgers, accepted rows and sequence. Its derived pending-
  effect presence backfill runs once during explicit migration. Admission and
  outcome triggers then maintain presence in the same source transaction.
  Late migration refusal rolls back, and conflicting pre-existing identities
  refuse rather than being silently replaced. Query plans use indexed bounded
  searches, not retained-history scans or temporary sorting.
- Selection is the actual policy ID, epoch and digest. Stale/forged/pre-aborted
  controls cannot poison a newer eligible cell. Source CAS fences cross-controller
  races; controller-specific selected-install keys cannot convert a rival
  installation into an apparent transport-replay success. Explicit retirement
  does not auto-resurrect, and same-policy reactivation creates a new epoch only
  after original retirement settles.
- Inspection allocates neither an intake cell nor absent owner/Jobs storage,
  pins no workflow and makes no Jobs mutation. Removed rules remain inspectable
  and retireable but not automatically reactivateable. A source-policy change
  across a Jobs wait refuses the combined read. Capacity is a separate Jobs
  observation, not a reservation or an atomic cross-database snapshot.
- An actually admitted observation held before factual settlement remains
  visible as unsettled during intake drainage. Retired/empty state returns no
  safe-disable or effect-completion certificate. Native evidence lifetime and
  shared physical shutdown order remain intact.
- Queued cancellation starts no control. Cancellation after accepted Jobs
  retirement reports unknown, then reconciles the original key without another
  Jobs retirement. No callback manufactures rollback or authorizes blind replay.
- Guardian inspection derives canonical scope, requires management permission,
  rejects caller routing/callback/mutation options, and withholds data after
  revocation, account/scope replacement, cancellation or failed final revalidation.
  Review also found that final withholding alone did not fence intermediate
  private reads. Transient trusted authority callbacks now guard/confirm every
  owner/source/Jobs wait; they are never retained by background controls.
- Historical policy contracts preserve their original schema identity. Genuine
  native `010`–`013` realm pins are reconstructed from committed registry names,
  immutable complete declarations and preserved migration closures. Retained
  binding admits those pins against fresh current physical ownership; new
  installation still rejects an old realm. Native Jobs receipt retirement
  regressions verify preservation rather than rewriting historical contracts.

The detailed contract and remaining public operator/audit boundary are in the
[integration guide](./integrations.md#selected-native-controls-and-inspection).
The final frozen-source native-memory run passed **790 tests, 17,695 assertions,
91 files** in 200.01 seconds across Calendar (excluding its physical-file test),
source-owned Jobs, Scheduler, WorkPool drainage and native managed composition.
The three final internal authority-wait regressions are included. An interim
run reported 785 passes and two failures in the new wrapper/managed-facade cases
while the callback handoff was being integrated; it is not represented as a
pass. The fresh isolated pair passed 20 tests, followed by the complete frozen
91-file run above. Intermediate no-emit fixture/contextual-type errors were
corrected separately, not relabelled as initial passes.

Final no-emit TypeScript passed with **408 roots, 4,008 source files and zero
diagnostics**, with incremental and emission output disabled. Documentation
validation passed for **907 reachable pages**, with zero structural problems.
`git diff --check` passed. No dependency tree, file-backed fixture, actor process,
build, Docker resource, archive or preview was created or retained by this phase.

All current tests use synthetic MEMORY state, explicit physical transport doubles
and `finally` cleanup. They are not physical actor, full managed `createApp`,
real-browser, bundled Linux, archive or updater acceptance. Those gates remain
unexecuted under the unchanged external filesystem integrity hold.

## November 18 private managed composition and recovery-capacity checkpoint

The subsequent source phase composes the actual native Calendar core/logging
source, bounded coordinator, dormant Jobs owner and exact unpublished Torrent
service through a private preparation factory. Public configuration does not
select it; ordinary Calendar remains independent of Jobs/Torrent. No provider
send, recurrence, reminder, public booking or hosted-demo change is enabled.

The reviewed boundaries include:

- Exact branded source-only Jobs catalog composition and a registered-code pin
  proof that rejects same-name scoped database graphs, even when fingerprints
  match. Generic authored-workflow pin precedence is unchanged.
- One construction-time dependent, explicitly sealed before recovery. Failed
  unsealed preparation may clean itself without recursively stopping its own
  Workflow initializer; dormant runner state alone never proves recovery absent.
- The exact published Workflow owner is checked before and after asynchronous
  startup. Missing/swapped/retired publication refuses new work; loss during
  startup quiesces eligibility and retains accepted Jobs evidence.
- Shared teardown retires Calendar/Jobs intake, joins actual intake and Jobs
  callbacks, stops/physically drains Torrent, and joins raw Calendar evidence
  bodies before final Jobs and Calendar providers. Bounded pool-close failure
  remains a failure, not physical completion or permission to bypass the join.
- Partial provider ownership is retained before fallible facade/route setup.
  A failed Calendar provider close can retry that exact retired provider without
  repeating completed physical shutdown or Workflow stop.
- The generic native WorkPool barrier requires retired intake and has no
  timeout, database operation or authority-restoration side effect. Earlier
  callback rejection is consumed; detached unawaited work remains out of scope.
- Ordinary source receipt pressure cannot consume the new separate 21,024
  cancellation/retirement allowance. Existing ordinary limits, original receipt
  namespace/digest/results and historical accounting remain intact. Exhausted
  recovery capacity still refuses new controls atomically; this is not an
  indefinite-history or archive solution.
- Private capacity inspection uses existing-only routing, exact owner/source
  proof and fixed usage primary-key reads, without seals, inputs or history
  scans. Missing storage remains absent; source presence is not eligibility.

The expanded domain memory run passed **876 tests, 17,128 assertions, 101 files**
in 165.28 seconds. This run deliberately excludes the app-composition files that
were still under review. After their final publication guard, the focused native
managed Calendar/Jobs, before-recovery and request-security set passed **49 tests,
390 assertions, six files** in 12.53 seconds. These are distinct runs, not additive
test totals. Earlier app fixture spelling/expectation failures and an assertion
about a void return value were corrected, not relabelled as original passes.

The final no-emit TypeScript graph passed with **398 roots, 3,999 source files
and zero diagnostics**, with emission and incremental output disabled.
Documentation validation passed for **907 pages**, all reachable, with zero
structural problems. `git diff --check` is clean.

Every new fixture releases and joins its synthetic work on setup failure and
normal/failing teardown. No dependency install, generated build, file-backed
fixture, Docker resource, preview server or archive was created. Only source
and small textual evidence in these guides are retained.

These are synthetic source/memory checks, not full managed `createApp`, physical
Fabric actors, installed-file upgrades, browser or bundled Linux qualification.
Those and exact-archive/updater selection remain unexecuted under the unchanged
filesystem-integrity hold. The private owner/capacity bounds and operator
adoption/retirement procedure remain public-activation gates.

## November 18 managed dependency and native coordinator checkpoint

The next source pass implements dormant managed Jobs preparation before Torrent
recovery/publication, phased Jobs physical drainage, a separate Torrent physical
invocation barrier, and a bounded private calendar coordinator. It does not enable
automatic calendar configuration or select a release archive.

The coordinator uses canonical SYSTEM scope lookup for recovered execution before
startup, bounded keyset owner pages and one absolute Scheduler wake. Its private
envelope is 64 retained owners, not the calendar domain's 10,000-file ceiling or
a reservation of Jobs' shared source capacity. Additive `013` durably rotates the
three source claim classes; canonical indexed next-wake reads do not write.
The separate established-owner SYSTEM index requires explicit installation and
rejects incompatible collisions before provisioning even an empty catalog.

Review and native-memory regressions closed these boundaries:

- The unpublished Torrent service can construct dormant evidence dependencies
  before actual recovery, without beginning ordinary workflow operations.
  Stop during asynchronous preparation aborts intake but waits the callback's
  physical settlement before provider disposal/publication.
- Jobs `quiesce()`/`drain()` keep original receipts, keyed barriers and execution
  evidence readable while joining physical gate callbacks—not only cancelled
  callers. A write accepted after quiescence remains unknown/reconcilable.
- Torrent disposal grace can expire while authored callbacks still run. Its new
  native `drainPhysical()` retains actual invocation promises independently of
  logical timeout, step replacement and grace cleanup. Managed Jobs now joins
  those bodies before final evidence/provider close. Public dispose/revocation
  semantics stay unchanged. Detached unawaited work is not inferred or covered.
- A live retirement keeps its policy ID, so hydration is state-aware and pending
  controls are checked on every pass. Removed/retired rules do not resurrect.
  Original A settles before desired B is prepared; lost acknowledgments retain
  their permanent keys and exact durable backoff.
- Initial activation failures and later backoff results process a bounded source
  batch so ready work does not create an immediate-wake loop. Unjournaled owner,
  read or pin failures use a bounded local retry instead of either spinning on
  due work or sleeping until an unrelated accepted appointment expires.
- Readiness has an independent bounded lane. It still verifies ownership and
  freshly compares full current policy hashes; an exact existing capture avoids
  a controller queue held by background Jobs. A real held registration-writer
  test proves a new appointment commits first with the same policy epoch and no
  source SQL lease over the Jobs wait. Changed policies remain serialized.
- Native absolute Scheduler wakes use the existing Croner owner, round upward
  to its second precision, remove exact entries before invocation, fence captured
  failed callbacks and preserve replacements. Coalesced commit hints converge;
  cancellation cleanup failure retains the exact handle and rejects clean drain.
- The internal Torrent physical barrier is classified as a native lifecycle
  member and rejected by the request facade, including runtime type-bypass
  attempts. It grants no request-user shutdown or evidence capability.

The expanded native-memory source run passed **829 tests, 16,825 assertions,
96 files** in 169.16 seconds. It covers Calendar except its physical file test,
related Jobs/Scheduler paths, native dependency construction, managed Jobs
composition and actual Torrent physical drainage. A subsequent request-boundary
and physical-lifecycle set passed **32 tests, 212 assertions, three files**.
These are distinct runs, not additive test totals.

Final review then found a runtime wake-registration recovery gap: replacing or
rearming an absolute wake could fail while the coordinator still reported
running. The final correction makes that state dormant and diagnostic, preserves
exact cancellation ownership and retained evidence, and permits explicit native
restart of original durable work. Old/failed callbacks remain inert; accepted
Jobs schedules are not created twice. The final focused coordinator, owner,
controller, Jobs, Scheduler, managed composition, Torrent and request-security
run passed **112 tests, 1,139 assertions, 11 files** in 29.87 seconds. The expanded
96-file run above is not represented as a run of that later runtime delta.

After the final wake correction, the no-emit TypeScript graph passed with
**387 roots, 3,989 source files and zero diagnostics**; both emission and
incremental output were disabled. Documentation validation passed for **907
pages**, all reachable, with zero structural problems. Intermediate fixture,
timer-precision and exhaustive service-inventory failures were corrected and
rechecked, not relabelled as original passes.

All new fixtures use synthetic in-memory state, disable output caching and close
owned databases, read sessions, pools, clocks and workflow owners in success and
failure paths. No dependency install, build tree, file-backed fixture, Docker
resource, preview server or archive was created. Source/history and existing
held artifacts remain preserved; no new disposable output is intentionally kept.

Actual Calendar/Guardian, Jobs and Torrent memory services exercise these paths.
The scheduler also has a real absolute-timer test, not only a manual-trigger
substitute. Physical actor/file transport, full managed authentication/logging,
browser, installed Linux bundle and updater qualification are still unexecuted
under the unchanged filesystem-integrity hold. The coordinator is private and
not mounted by `calendar:true`. No application, live state, hosted demo, main or
selected archive changed.

## November 18 durable policy lifecycle checkpoint

The next reviewed source phase adds a fixed native observation catalog,
owner-readiness seam, original-key Jobs settlement barriers, dormant Jobs
construction, and additive realm `012` registration journal/controller. Public
automation and managed recovery/startup are still disabled/unimplemented.

Review closed these concrete lifecycle gaps before further composition:

- Known previously registered Jobs state cannot disappear and be silently
  recreated as generation one. Exact original accepted receipt reconciliation
  remains permitted; missing retained current state otherwise fails closed.
- Restart after local retirement but before preparation of the downstream
  retirement control cannot bypass that unfinished retirement. Reactivation
  requires its accepted durable retirement, not a lost process-local flag.
- An unresolved activation blocks changed policy preparation. Evidence recovery
  of its original receipt does not silently restore a quiesced source.
- Retirement captures the actual owned Jobs registration, including old A when
  current local B never applied. Late acceptance records historical mapping
  without reviving a retired pointer. No-registration reports no invented result.
- Transient retirement bookkeeping is bounded and shared across queued same-rule
  controls, including queue refusal/missing rules. Different rules progress
  independently; source leases are released before Jobs/Torrent waits.
- Optional readiness is bounded, owner-lifetime single-flight and retried after
  settlement; an initiating user's logout does not retire another waiter's
  native work. Original authorized business receipts remain reconcilable even
  when readiness later fails. Logging-only sources keep their existing cost.
- Jobs registration/create hints do not dispatch before explicit successful
  scheduler startup. Captured failed-start callbacks stay inert after retry;
  exact-callback cleanup preserves replacements. Manual tick/refill still works.

Actual memory tests exercise the fixed catalog—not only a synthetic substitute—
through native Guardian/calendar, source Jobs and MAC-sealed Torrent, in single
and multi tenancy. They also cover controller replacement, lost activation and
retirement acknowledgments, retirement during an already committed activation
wait, and the local-retire/before-journal crash boundary. Separate native realm
tests cover direct-SQL forged outcomes, immutable evidence, late-ack guard proof,
indexed pending queries, rollback and genuine populated `011` → `012` migration.
All prior migration/checksum/declaration generations remain exact. The one
explicit registration-guard extension is checked and rollback-qualified, not
misrepresented as an unchanged guard.

The expanded native-memory calendar/related-Jobs run passed **673 tests,
15,093 assertions, 79 files**. Afterward, a test-only assertion typing correction
was rechecked with the affected controller set: **15 passed, 332 assertions**;
runtime code did not change after the expanded run. The final no-emit TypeScript
graph passed with **360 roots, 3,970 imported source files, zero diagnostics**;
emit and incremental output were disabled. Documentation validation passed for
**907 pages**, all reachable, with zero structural problems. Interim fixture and
typing failures were corrected and rechecked, not relabelled as original passes.

Every owned fixture uses native memory state and closes database/read sessions,
pools, workflow owners and clocks on success and failure. No dependencies,
builds, file-backed databases, Docker resources, preview servers or packaged
artifacts were generated; no disposable output or owned process is retained.

These checks are memory/source evidence. Physical callback settlement across
process death, actual managed recovery/worker shutdown, browser, Linux bundle and
archive/updater qualification remain pending under the storage-integrity hold.
No deployment, live data, hosted demo, main or updater selection changed.

## November 18 dispatch checkpoint review

Independent review of `11e9bbc` found and corrected two source-boundary defects
before starting managed lifecycle work:

- Native typed database/worker refusals that prove no write started/committed
  now preserve that evidence instead of becoming false unknown Jobs writes.
  Plain authored outcome fields, active timeouts and actual unknown writes
  remain uncertain. An accepted Jobs receipt followed by a refused source
  acknowledgment cannot be mistaken for rejection of the Jobs write.
- Additive realm `011` installs permanent bidirectional rule/source ownership.
  Shared sources could previously cause one rule's hydration/retirement to
  affect another rule; rotating a source could also evade retained capacity.
  Neither is now admitted. Consistent `010` history backfills only the derived
  binding; conflicting history blocks without rewriting or dropping evidence.
  `010`'s recorded migration checksum and complete declaration hash stay exact.

Controlled dispatcher exits now restore only tracked first-attempt claims for
which no Jobs mutation was invoked. This runs on graceful stop and other batch
failure paths; invoked/accepted/uncertain work is not reset. A real two-claim
calendar/Jobs test proves an untouched second claim can expire normally while
the first physical Jobs callback is still held. Cleanup failure retains bounded
diagnostic IDs, rejects close and fences further intake. `close()` intentionally
does not claim physical Jobs drainage; shared owners must outlive that drainage.

The final focused review set passed **81 tests, 2,922 assertions, 6 files** in
15.80 seconds. An earlier expanded migration/protocol/actual-service set passed
**103 tests, 6,290 assertions, 13 files**; these are distinct runs, not additive
coverage. The previous 557-test source baseline is retained below. Physical
actors, browser, bundled deployment and archive/updater remain unqualified under
the unchanged storage-integrity hold. No app, hosted demo, main or release
selection changed during this review.

## November 18 private calendar dispatch and effect protocol

The [private integration foundation](./integrations.md) now adds calendar realm
`010`, source-atomic appointment integration intents, separate mutable claims,
immutable Jobs receipt associations, exact source-registration mapping and a
unique source-local effect cutoff. The initial adapter records an observation
only; no managed activation, provider send, reminder or recurrence was enabled.

The actual memory integration uses the native Guardian/calendar facade and realm,
source Jobs service/realm/runner, real Torrent authority seals and permanent start
receipts, then re-enters the private owner-bound calendar writer. Physical actor,
filesystem and process transport are explicitly simulated, not qualified.

Reviewed and corrected boundaries include:

- Exact original Jobs reconciliation across both acknowledgment boundaries;
  stale nonce/generation cannot revive obsolete work, and a null receipt during
  an unknown writer never grants no-commit or rekey permission.
- Expected source-registration fencing after pool waits, including A → B → A;
  immutable historical mapping and receipts remain readable after retirement.
- Original occurrence/Torrent proof before Jobs' own dispatch acknowledgment;
  an unrelated SYSTEM start with the same principal/pin/input is rejected.
- Cancellation before versus after the cutoff; transport replay cannot grant a
  second effect. Lost admission acknowledgment remains admitted/unsettled, while
  lost outcome acknowledgment can reconcile an existing observed result.
- Final deadline checks use the actual source-writer clock after queue waits,
  not an activity's pre-await timestamp. Derived due dates must fit Jobs' actual
  four-digit-year contract before the appointment commits.
- Bounded indexed ready/expired/retirement probes, safe blocked backoff, first
  proven no-invocation/non-commit recovery and fresh-work timestamps that do not
  continually jump older same-class retries. Mixed-class fairness still gates
  managed activation.
- Exact private owner/root/database/realm/scope admission, existing-only access
  and same-lease physical owner proof; source logging composition retains all
  close/partial-start cleanup. The shared cold-actor schema-open caveat is
  documented rather than claimed read-only.
- Business audit facts remain exactly once and private; protocol bookkeeping
  creates no false human activity. Late integration failure rolls back business
  records, ordinary receipts/seals, source accounting and logging outbox/context
  evidence together.

The final scoped calendar plus related Jobs regression set passed **557 tests,
11,343 assertions, 67 files**, in 116.74 seconds on pinned Bun 1.4.4. It excludes
the physical calendar-file test deliberately. The true populated `009` → `010`
native-memory migration preserves all nine previously recorded checksums, the
complete `009` declaration hash, existing rows/guards/ledger/sequence, no-backfill
semantics and rollback after a late migration failure. Older upgrade tests that
seed current handlers explicitly identify their empty integration-policy support
scaffold; they are not substituted for that real historical-storage test.

An earlier broad run had 552 passes and one fixture failure: its new expiry
probe advanced time beyond Torrent's owner lease and therefore tested a different
authority retirement. The final probe uses a one-second effect deadline within
the still-valid runtime lease, proving refusal by calendar expiry itself. That
original failure is not relabelled as a pass; the final complete scoped rerun
above passed after the fixture correction.

The final no-emit TypeScript graph includes **348 roots and 3,958 source files**,
including calendar, Jobs, calendar components, SDK/hooks and regression fixtures;
zero diagnostics, no emit or incremental output. Documentation validation covers
**907 pages**, all reachable with zero structural problems.

Test sources: `integration-protocol.test.ts`, `integration-dispatcher.test.ts`,
`integration-runtime.test.ts`, `integrations-service.test.ts`,
`integrations-upgrade.test.ts` and the source Jobs regression family. Every
database, query session, pool, workflow owner and clock spy closes/restores in
`finally`, including setup failure. These runs allocated no disk fixtures,
dependencies, builds, Docker resources, previews or packaged artifacts.

Still pending before activation/release: fixed native workflow registration and
configuration, dormant hydration/start/stop composition, durable operator
retire-before-disable, startup/retry discovery and mixed-class fairness,
sustainable retained capacity, physical actor recovery/ownership qualification,
real browser, managed logging workers, Linux bundles, package/archive and updater
selection. Main, applications, live state and the hosted demo are unchanged.

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
domain-contact/guest participant adapters, type-catalog/resource-policy administration,
recurrence, clinical visit/lobby/attention transitions,
managed source-bound Jobs/Torrent delivery, reminders,
outbound channels, public self-booking and AI remain later stages of the approved
integration plan. The hosted local-state UI is not evidence that these backend
features are implemented. Keep the independent core useful without silently
enabling optional services or treating this checkpoint as full calendar completion.

The additive migrations and scheduling/block/authenticated-hold/location/type/lifecycle/visit paths also need physical
existing-file upgrade/recovery, actor restart/contention, managed compliance and
real-browser acceptance alongside the earlier core gates. Passing source/memory
checks is not evidence those scenarios have run or that a production domain may
be migrated.
