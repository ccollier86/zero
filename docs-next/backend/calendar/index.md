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
- [Facade and booking semantics](./facade.md): resources, grants, appointment
  commands, bounded queries, live projections and uncertain-outcome reconciliation.
- [Qualification and remaining gates](./qualification.md): current source review,
  completed memory checks and explicitly unexecuted physical/deployment scenarios.
- [Frontend composition](../../frontend/calendar/index.md): connected core versus
  the preserved, richer local editor and self-booking previews.

## Implemented, and deliberately not implied

The core supports person/room/equipment calendars, private scoped resources,
separate busy/detail/book/manage rights, one-off confirmed appointments, exact
UTC instants with explicit IANA scheduling zones, before/after buffers,
capacity-one conflicts, revision-controlled reschedule/cancel and safe receipts.
Provider+room reservations live in the same private scope database and commit or
roll back together. A browser cannot select the actor, tenant, database or creation ID.

Single-tenant applications retain an application-scoped calendar domain;
multi-tenant applications get a private domain per currently admitted tenant.
Enabling calendar does not convert the app's data topology or change its theme.

Recurrence, all-day and floating dates, working-hours/availability rules, temporary
holds, appointment-type catalogs, participant invitations, locations, configurable
clinical statuses, delivery channels, public self-booking and AI adapters remain
future stages. Local UI fields/previews do not implement those features. In this
core, `recurrence`, `reminders` and `selfBooking` must remain false; attempting to
enable them fails with `CALENDAR_NOT_READY` instead of a partial working feature.
Native/mobile and API-key calendar admission are not supported yet.

## Reactive and audit boundaries

The Fabric owner emits payload-free invalidations after actual commits. The
service re-queries under current authority before publishing. Idle authority
checks do not emit synthetic row changes, writes or semantic audit entries.
Slow SSE readers retain only dirty flags; a later publication requires a fresh
authorized query. Terminal read denial retires private presentation.

When core Logging is enabled, accepted resource/grant/appointment transitions
append semantic evidence in the source transaction and drain through the existing
supervised logging worker. Rollback or outbox pressure rolls back the source
operation. No-op and receipt replay do not emit false changes. Evidence contains
opaque target identity and bounded sequence/revision/resource-count/status facts,
not appointment titles, times, labels, grantee values or clinical content. Logging
disabled remains disabled; calendar does not install another logger.

Private effect-reference intents are retained foundations, **not a dispatch
pipeline**. No Jobs, Torrent, scheduler, provider or AI service is enabled by core
calendar. The full plan records the additional source-bound Jobs admission,
eligibility and retained-capacity work needed for real reminders and future effects.

## Qualification boundary

The branch has pure admission, real in-memory ReactiveDB/realm/native writer,
Guardian service, source-audit, transport, hook and SDK-retirement regression
checks. Physical coordinator/file seams are explicitly mocked where used.
These checks do not establish file recovery, actual worker death/restart,
bundled Linux deployment, managed compliance or real-browser acceptance.

The [November 17 qualification checkpoint](./qualification.md) records lifecycle,
reconciliation and bounded-index improvements, plus the exact passing test sets
and prepared physical fixtures. Those release checks remain required. The existing development-volume integrity
hold prevents fresh heavy builds/actor/browser/package runs; it has not been
cleared or represented as repaired. No application, production data, public theme,
retained calendar domain or updater selection was changed for this implementation.
