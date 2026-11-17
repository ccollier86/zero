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

## November 17 explicit-window and block stage

This source stage adds bounded, versioned explicit UTC availability policies and
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

Mixed busy queries bound each authorized resource/store partition before merging
the global page. At the fixed 16-resource/100-result ceiling this materializes at
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

`src/calendar/file-runtime.integration.test.ts` defines eight actual file/WAL and
dedicated-actor scenarios: inert empty reads, independent scope progress, full
SYSTEM/actor restart, multi-resource contention and rollback, replay/current grant
checks, missing/changed placement recovery, exact-owned writer death/replacement,
and empty child-environment proof. The factory observer forwards to the production
subprocess executor; it does not substitute a mock coordinator or actor result.

`src/frontend/server/app-calendar.integration.test.ts` adds two real managed
`createApp` scenarios, with logging disabled and with the compliance preset. They
cover normal authentication/admission, native resources and booking HTTP, replay,
conflict/no-op truth, semantic source evidence reaching the native investigator,
privacy, and admission retirement/recovery. No live provider or clinical data is
needed. These are test definitions and type-check evidence, not successful runs.

Those same eight file-runtime and two managed definitions now also exercise
availability/history and block receipt persistence across full restart, a real
appointment-versus-block race, complete block control/replay/no-op handling and
the new semantic evidence categories reaching the investigator. Their allocator
and exact-owned shutdown/cleanup requirements are unchanged. They have not been
executed under the current storage-integrity hold.

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

Recurring working-hours/holiday expansion, offer/slot generation, holds,
participants/catalogs/locations, recurrence, clinical transitions,
source-bound Jobs/Torrent effects, reminders,
outbound channels, public self-booking and AI remain later stages of the approved
integration plan. The hosted local-state UI is not evidence that these backend
features are implemented. Keep the independent core useful without silently
enabling optional services or treating this checkpoint as full calendar completion.

The new additive migration and scheduling/block paths also need physical
existing-file upgrade/recovery, actor restart/contention, managed compliance and
real-browser acceptance alongside the earlier core gates. Passing source/memory
checks is not evidence those scenarios have run or that a production domain may
be migrated.
