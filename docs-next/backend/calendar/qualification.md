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
participants/catalogs/locations, recurrence, clinical transitions,
source-bound Jobs/Torrent effects, reminders,
outbound channels, public self-booking and AI remain later stages of the approved
integration plan. The hosted local-state UI is not evidence that these backend
features are implemented. Keep the independent core useful without silently
enabling optional services or treating this checkpoint as full calendar completion.

The additive migrations and scheduling/block/authenticated-hold paths also need physical
existing-file upgrade/recovery, actor restart/contention, managed compliance and
real-browser acceptance alongside the earlier core gates. Passing source/memory
checks is not evidence those scenarios have run or that a production domain may
be migrated.
