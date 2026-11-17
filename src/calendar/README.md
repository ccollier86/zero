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
  Busy reads combine both kinds without titles, target IDs or a kind discriminator.
- Configuration is detached, bounded and connected to managed startup. A
  configured object is not proof of actor/storage or release readiness.
- Realm commands run in the native tracked transaction boundary. They are not
  routes: actor fields and creation IDs must come from a trusted broker, never
  browser input. The managed broker derives them from current Guardian authority.
- Safe receipts preserve identity and outcome, not historical access rights.
- Additive `002` preserves `001` migration/evidence identity. Block receipts and
  effect references have separate private tables with the same cross-family
  scope/principal/request-key namespace and current-target reauthorization.
- Private effect references are handoff groundwork, not another audit system or
  a working notification pipeline.

The runtime uses fixed empty-environment actors, existing-only acquisition for
established files, immutable scope ownership, bounded queues and commit-only
invalidation. Authorized appointment, block and availability watches use the same
coalescing, quiet revalidation, private SSE and SDK-retirement machinery. Busy
reads bound each resource/store partition before merging a redacted page; they
do not collect the whole matching date range for a global sort.
Semantic changes use the existing transaction-bound logging outbox;
idle watch renewal and raw reservation rows do not manufacture audit events.

`index.ts` exports setup/facade types and errors only; raw owner, actor, database
and command capabilities remain private. `@zero/framework/calendar` remains the
browser UI entry; `calendar/server` and `calendar/client` are separate entries.

Still required before release: actual file/actor, managed compliance, real-browser,
official JS bundle, Linux/amd64 installed archive and normal updater qualification.
Compiled executables fail closed with the default source actor launch. Recurrence,
recurring working-hours/holiday expansion, slot offers, holds, participants,
clinical states, invitations, reminders, AI and public self-booking are not
implemented; unsupported enablement rejects. Availability/block management is scoped
facade-only in this stage; the connected appointment workspace and hosted demo do
not acquire a richer management editor. Source/memory checks do not qualify the
new physical upgrade/recovery paths, clear the storage-integrity hold or select
a production/updater artifact.
