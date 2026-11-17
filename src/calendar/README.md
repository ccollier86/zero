# Managed calendar core

Feature-branch implementation, not a qualified release. `calendar` configuration,
private Fabric lifecycle, current-Guardian service, native HTTP/client facades and
connected UI are now composed. The selected 2.11.0 updater archive still has only
the experimental frontend; do not tell an application to adopt unreleased APIs.

The [integration plan](../../docs-next/_work/calendar-integration-plan.md) remains
the contract for the remaining work.

The [backend guide](../../docs-next/backend/calendar/index.md) documents the
implemented core and its explicit limitations. This is not the complete plan:

- Time helpers accept explicit canonical UTC instants and a scheduling zone.
  They do not convert wall time, expand recurrence or implement all-day records.
- Availability is an explicit unrestricted policy or at most 100 positive UTC
  windows normalized by merging overlap/adjacency. Full buffered appointment
  occupancy must fit current policy on each resource; restrictive changes
  preserve existing appointments. This is not recurring working hours or slots.
- Private one-off blocks share appointment conflicts, require current all-resource
  manage for writes and details for private reads, and retain cancelled history.
  They have no buffers and cannot overlap or silently cancel other reservations.
- Versioned locations and resource assignments support permission-filtered
  catalogs and same-location region/ID facets, never geographic authority. Scope
  managers own catalog edits; current resource managers replace bounded location
  sets with live, transaction-checked visibility witnesses. Current projections
  keep queries off retained history. Resource revisions fence older holds.
- Authenticated holds expose acquire/get/query/watch/release/confirm. Acquisition
  reserves fixed resources and buffered occupancy with current all-resource book,
  active state, availability and conflict checks. Requested TTL is an integer
  1–900 seconds, defaults to 300 and is clipped at a strictly future start.
  Expiry uses the server clock on reads/commands, never an input clock or idle
  expiry write. Expired retained history consumes neither occupancy nor live quota.
- Hold private reads/releases require the original principal **and** user with
  current all-resource book, or current all-resource manage. Only the exact
  original subject can confirm, even when another actor is a manager. The hold
  revision and all captured resource revisions fence confirmation; grant changes
  can stale it. Instants, zone, buffers and membership are fixed and sealed by the
  acquisition receipt. Title arrives only on confirmation, not on the hold.
- Confirmation invokes the canonical appointment writer and atomically creates
  an ordinary appointment, consumes the hold and releases its reservations. It
  returns `appointment.created` with the new appointment ID, not a hold receipt.
  Expiry, contention, capacity and late source-audit failure roll everything back.
  Release is deliberate and revision-controlled; a confirmed hold cannot be
  released to claim cancellation of its ordinary appointment.
- Fixed live hold quotas are 16 per principal and 1,000 per scope, alongside a
  100,000 retained-hold budget and the global 200,000-receipt budget. Replaying
  acquisition after expiry returns the old receipt, not renewal. Unknown outcomes
  keep their original key for reconciliation, never automatic resend/reacquire.
- Configuration is detached, bounded and connected to managed startup. A
  configured object is not proof of actor/storage or release readiness.
- Realm commands run in the native tracked transaction boundary. They are not
  routes: actor fields and creation IDs must come from a trusted broker, never
  browser input. The managed broker derives them from current Guardian authority.
- Safe receipts preserve identity and outcome, not historical access rights.
- Additive `002` preserves `001` migration/evidence identity. Block receipts and
  effect references have separate private tables with the same cross-family
  scope/principal/request-key namespace and current-target reauthorization.
- Additive `003` similarly preserves both preceding source checksums and declared
  schema generations. Hold receipts/effect references join that same namespace
  without rebuilding earlier evidence. Source/memory upgrade checks are not a
  passed physical existing-file upgrade.
- Additive `004` preserves all three older migration/schema generations and
  adds immutable location/assignment history, bounded current projections and
  true location receipts in the existing global command-key namespace.
- Private effect references are handoff groundwork, not another audit system or
  a working notification pipeline.

The runtime uses fixed empty-environment actors, existing-only acquisition for
established files, immutable scope ownership, bounded queues and commit-only
invalidation. Authorized appointment, block, hold, location/resource catalog/detail and availability watches use the same
coalescing, quiet revalidation, private SSE and SDK-retirement machinery. Busy
reads combine three stores with no titles, target IDs or kind discriminator. They
bound each resource/store partition before merging a redacted page: at most
`48 * (limit + 1)` candidates, or 4,848 at the fixed range/page ceilings. Hold
indexes first exclude expired history; remaining hold candidates may sort, but
the live scope set is bounded at 1,000. This is not a wall-clock benchmark.
Semantic changes use the existing transaction-bound logging outbox;
hold acquired/released/confirmed are distinct opaque source facts. Idle expiry,
watch renewal, no-op, replay and raw reservation rows do not manufacture audit
events or copy titles/times/subjects. Quiet expiry can publish an authorized hold
page with `invalidated:false`; scope/account replacement and denial still retire
private snapshots and callbacks.

`index.ts` exports setup/facade types and errors only; raw owner, actor, database
and command capabilities remain private. `@zero/framework/calendar` remains the
browser UI entry; `calendar/server` and `calendar/client` are separate entries.

Still required before release: actual file/actor, managed compliance, real-browser,
official JS bundle, Linux/amd64 installed archive and normal updater qualification.
Compiled executables fail closed with the default source actor launch. Recurrence,
recurring working-hours/holiday expansion, slot offers/public booking proofs, participants,
clinical states, invitations, reminders, AI and public self-booking are not
implemented; unsupported enablement rejects. Authenticated holds do not enable
`selfBooking`; public booking remains off. Availability/block/hold management is
scoped facade-only in this stage; the connected appointment workspace and hosted demo do
not acquire a richer management editor. Source/memory checks do not qualify the
new physical upgrade/recovery paths, clear the storage-integrity hold or select
a production/updater artifact.
