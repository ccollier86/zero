---
id: zero.backend.calendar
type: index
audience: [developer, agent, operator]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: managed-core
maturity: experimental
applies_to: ["feature/calendar-backend-foundation; source and memory checks only, not selected for zero-update"]
---

# Managed calendar core

[Backend index](../index.md) · [Frontend composition](../../frontend/calendar/index.md) ·
[Full integration plan](../../_work/calendar-integration-plan.md)

This branch implements one connected core: explicit configuration → Guardian
admission → private Fabric → atomic multi-resource reservations → native scoped
server/client APIs → authorized live snapshots → the existing tokenized calendar UI.
It is **not yet a qualified release**. Zero 2.11.0's selected archive still provides
only the experimental frontend components. Use the installed archive's docs when
working on an application; do not assume this branch is available through update.

## Start here

- [Configuration and adoption](./configuration.md): enable/disable, placement,
  permissions, actor lifecycle and the existing-project boundary.
- [Facade and booking semantics](./facade.md): resources, grants, appointments,
  authenticated holds, locations/resource facets, appointment types/policies,
  bounded queries, live projections and uncertain outcomes.
- [All-day appointments](./all-day.md): authored LocalDate intervals, explicit
  kind conversion, frozen history, date queries/live views and migration limits.
- [Lifecycle and required reasons](./lifecycle.md): optional richer outcomes,
  server-supplied transitions, private reasons and canonical cancellation.
- [Visit modes and retained locations](./visits.md): optional location/version
  bindings, current assignment compatibility, hold transfer and selector privacy.
- [Effective location policies](./location-policies.md): explicit all-time versus
  date-effective resource assignments, whole-occupancy checks and private live discovery.
- [Native account participants](./participants.md): explicit Guardian eligibility,
  private bindings, exact hold transfer, live names/tombstones and reusable picker.
- [Weekly working hours](./working-hours.md): finite local-date coverage, explicit
  exceptions, frozen UTC policy snapshots and compatible legacy format handling.
- [Private integration protocol](./integrations.md): source-atomic intents, bounded
  Jobs handoff, fixed observation catalog, owner readiness, durable registration
  controls, bounded native coordinator, fair source wakes, exact Torrent execution
  proof and observation-only cutoff; not yet activated or a public reminders API.
- [Qualification and remaining gates](./qualification.md): current source review,
  completed memory checks and explicitly unexecuted physical/deployment scenarios.
- [Frontend composition](../../frontend/calendar/index.md): connected core versus
  the preserved, richer local editor and self-booking previews.

## Implemented, and deliberately not implied

The core supports person/room/equipment calendars, private scoped resources,
separate busy/detail/book/manage rights, one-off confirmed appointments, exact
UTC instants with explicit IANA scheduling zones, before/after appointment buffers,
versioned explicit availability windows, private one-off blocks, authenticated
short-lived holds, capacity-one conflicts, revision-controlled reschedule/cancel
and safe receipts. Appointment, block and hold reservations share the private
scope database and conflict decision; all selected resources commit or roll back
together. A browser cannot select
the actor, tenant, database or creation ID.

Single-tenant applications retain an application-scoped calendar domain;
multi-tenant applications get a private domain per currently admitted tenant.
Enabling calendar does not convert the app's data topology or change its theme.

Availability now supports an explicit UTC policy or a separate versioned weekly-local
source with finite coverage and date overrides. The latter freezes UTC windows at
policy write; it is not an automatic horizon or slot-offer API. The legacy facade
cannot silently overwrite weekly policy. See the working-hours guide above.
Policy changes preserve existing appointments. New bookings and UTC-occupancy
changes must fit the current policy, including appointment buffers. Blocks need
current manage rights on every resource and reject existing live occupancy;
creating a block never cancels another record. Busy reads combine appointments,
blocks and unexpired holds without exposing private titles, target IDs or kinds.

Authenticated holds reserve fixed resources and buffered UTC occupancy with a
trusted server expiry: requested TTL defaults to 300 seconds, is limited to
1–900 seconds and is clipped to a strictly future start. Fixed live quotas are
16 per principal and 1,000 per scope; retained holds have a separate 100,000-row
budget and share the 200,000 global receipt budget. Reads/releases require the
exact principal/user with current all-resource book rights, or all-resource
manage. Only the exact original subject can confirm, with the hold revision and
all captured resource revisions still current. Confirmation atomically creates
an ordinary appointment and consumes the hold, returning `appointment.created`
for the new appointment ID. Expiry is evaluated without an idle mutation or
cleanup timer; expired history consumes neither occupancy nor live quota.
Unknown outcomes retain the original key; replay after expiry is not renewal.

Versioned locations and resource assignments now support authorized directory
facets. Location/region filters narrow current resource grants; they cannot grant
access or serve as clinical credentials. The separate effective-location policy
can constrain scheduling across the entire buffered occupied interval. Global scope managers edit
the catalog; resource managers replace only their own managed assignments using
currently visible locations. Historical labels/assignments remain retained.
Directory and location-detail hooks update reactively and retire revoked data.
Effective policies are explicit; existing static assignments stay all-time until
replaced. Legacy replacement cannot silently flatten effective policy. See the
effective location guide above; directory facets alone never establish eligibility.
The richer demo's filter/management controls are not yet wired to these APIs.

Appointments and holds can now explicitly bind an in-person location version or
a phone/video mode. New/relevant changed bookings check current all-resource
assignment compatibility; retained snapshots preserve historical labels/regions.
The connected one-off editor includes a native mode/location picker. This does not
create telehealth connections, check medical eligibility or enable lobby tracking.

Versioned appointment types now supply exact duration/buffer defaults and per-resource
unrestricted/optional/required policies. Typed appointments/holds retain their
historical catalog generation. New/time-changed bookings and hold confirmation
freshly check policy; older accepted records are not relabelled or cancelled.
Catalog and policy editing requires scope management, not provider ownership.
The connected editor now selects these types and applies exact duration/buffer
defaults; catalog/resource-policy administration UI remains a later stage.

The optional versioned lifecycle policy now supports unconfirmed, completed and
no-show outcomes in addition to normal confirmation/cancellation. Server-supplied
actions and required reasons are enforced through both new transitions and the
legacy cancel API. Completed/no-show are terminal and retain occupancy; only
cancellation releases reservations. The connected workspace uses native managed
review/reason dialogs and shows effective outcomes. This is not yet clinical visit
progress, lobby tracking, arbitrary state machines or automatic workflow delivery.

Untyped all-day appointments now have explicit authored LocalDate intervals,
atomic kind conversion, frozen accepted boundaries and indexed date queries/live
views; see the all-day guide. Holds and blocks remain timed-only.

Recurrence, floating timed dates, automatic working-hours coverage extension,
public booking proofs/offers, participant invitations,
effective-dated location eligibility,
clinical visit/lobby/attention state, delivery channels, public self-booking and AI
adapters remain future stages. Local UI fields/previews do not implement those
features. In this core, `recurrence`, `reminders` and `selfBooking` must remain false; attempting to
enable them fails with `CALENDAR_NOT_READY` instead of a partial working feature.
Native/mobile and API-key calendar admission are not supported yet.

## Reactive and audit boundaries

The scoped facade supports authorized live appointment, block and hold ranges,
resource/location/type catalogs and details, plus resource availability and type
policies. They share the native commit-invalidation,
bounded quiet authority checks, private SSE/backpressure and SDK-retirement
machinery. The connected workspace still exposes only its documented appointment
controls; adding live backend APIs does not silently enable the richer demo's
unimplemented editor fields.

The Fabric owner emits payload-free invalidations after actual commits. The
service re-queries under current authority before publishing. Idle authority
checks do not emit synthetic row changes, writes or semantic audit entries.
Slow SSE readers retain only dirty flags; a later publication requires a fresh
authorized query. Terminal read denial retires private presentation. A quiet
lease-expiry read can publish a changed hold page with `invalidated:false`,
without writing an expiry row or claiming a source event.

When core Logging is enabled, accepted resource/location/grant/availability/appointment/block/hold
transitions append semantic evidence in the source transaction and drain through the existing
supervised logging worker. Rollback or outbox pressure rolls back the source
operation. No-op and receipt replay do not emit false changes. Evidence contains
opaque target identity and bounded sequence/revision/resource-count/location-count/active/status facts,
not appointment/block titles, hold scheduling/subject data, times, labels, grantee
values or clinical content. Hold acquired/released/confirmed are distinct facts;
idle expiry is not an audited transition.
Logging disabled remains disabled; calendar does not install another logger.

Private effect-reference intents are retained foundations, **not a dispatch
pipeline**. No Jobs, Torrent, scheduler, provider or AI service is enabled by core
calendar. A separate private integration protocol now exercises source-owned
handoff and final observation admission; managed activation, retained-capacity
operations and real reminder/provider adapters remain gates in the full plan.

### Existing storage and retired integration rules

Calendar now supplies Fabric's native cold-open admission contract. Established
current ownership metadata requires a read-only physical owner, migration-ledger
and declared-schema proof before writable actor preparation. Explicit setup can
prepare an older realm only after proving its existing owner; only a staged new
owner can admit a missing owner row. The parent and each replacement actor bind
the same detached contract and proof. The default behavior of other Fabric
consumers is unchanged unless they opt into this contract.

This checks declared schema and available native invariants, not arbitrary
migration-created trigger/view equivalence. The same-lease owner and current
authority checks remain required for each operation. Physical file/WAL/HOT and
bundled-actor tests have not run under the current storage-integrity hold.

An explicitly retired integration rule no longer blocks unrelated appointments
or revives from stale configuration. Removing an active rule still requires
operator review before new capture; original accepted/unknown Jobs receipts,
retirement and cancellation evidence continue through their original identities.
An empty rule catalog can therefore support evidence-only recovery without
pretending removal is retirement. Fresh observation admission separately checks
the configured policy and native workflow pin; accepted facts keep an independent
settlement lifetime. These are private native lifecycle contracts, not a public
reminder capability or a safe-disable certificate.

## Qualification boundary

The branch has pure admission, real in-memory ReactiveDB/realm/native writer,
Guardian service, source-audit, transport, hook and SDK-retirement regression
checks. Physical coordinator/file seams are explicitly mocked where used.
These checks do not establish file recovery, actual worker death/restart,
bundled Linux deployment, managed compliance or real-browser acceptance.

The [November 17 qualification checkpoint](./qualification.md) records lifecycle,
reconciliation, bounded-index, explicit-window/block and authenticated-hold
improvements, plus the exact passing test sets and prepared physical fixtures. Those release checks
remain required. The existing development-volume integrity hold prevents fresh
heavy builds/actor/browser/package runs; it has not been
cleared or represented as repaired. No application, production data, public theme,
retained calendar domain or updater selection was changed for this implementation.
The additive `003` hold declaration/migration preserves both earlier source
checksums and declaration generations; memory upgrade checks are not evidence of
a physical retained-domain upgrade. There is no new native hold UI or public
self-booking surface, and the hosted demo remains unchanged.
