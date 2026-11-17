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

`src/calendar/file-runtime.integration.test.ts` now defines nine actual file/WAL and
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

Recurring working-hours/holiday expansion, offer/slot generation, public booking proofs,
participants, connected type-selection/management controls, effective-dated location eligibility and
appointment visit locations, recurrence, clinical transitions,
source-bound Jobs/Torrent effects, reminders,
outbound channels, public self-booking and AI remain later stages of the approved
integration plan. The hosted local-state UI is not evidence that these backend
features are implemented. Keep the independent core useful without silently
enabling optional services or treating this checkpoint as full calendar completion.

The additive migrations and scheduling/block/authenticated-hold/location/type paths also need physical
existing-file upgrade/recovery, actor restart/contention, managed compliance and
real-browser acceptance alongside the earlier core gates. Passing source/memory
checks is not evidence those scenarios have run or that a production domain may
be migrated.
