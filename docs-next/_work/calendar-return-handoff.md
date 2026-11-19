---
id: zero.work.calendar-return-handoff
type: reference
audience: [developer, agent]
owner: calendar
status: draft
implementation_state: in-progress
visibility: internal
system: calendar
feature: integration-return-notes
maturity: experimental
applies_to: ["2.11.0 released foundation and experimental calendar UI; approved calendar backend implementation in progress on its feature branch"]
---

# Return to calendar after the shared scheduling foundation

[Working evidence](./index.md)

Recorded 2026-11-14 at the user's request. Preserve this handoff until the
calendar backend integration is finished. It is source documentation, not a
disposable generated fixture. The user explicitly paused calendar backend work
to strengthen shared scheduling, job execution, workers and Zero's API first.
The foundation and experimental frontend exports shipped in Zero 2.11.0 on
2026-11-16. This satisfies that framework release gate, not calendar backend
acceptance or permission to begin implementation without the user's plan review.

The 2026-11-16 review expanded this handoff into the
[end-to-end managed integration plan](./calendar-integration-plan.md). Use that
plan for contracts, dependency order and acceptance; this document remains the
preserved visual/requirement handoff. The plan explicitly identifies the still-new
source/service Jobs bridge, synchronous eligibility boundary and retained-capacity
design needed for production reminders. Its API/configuration names are proposals.

The user subsequently approved implementation. The active branch now connects
the one-off core, managed lifecycle, scoped APIs, source audit and native workspace.
Use the [managed core guide](../backend/calendar/index.md) for implemented source
contracts and the [current checkpoint](./calendar-integration-plan.md#implementation-checkpoint)
for remaining work. This is not yet selected by normal update; the historical
UI requirements below remain preserved, not all implemented by that core.

The latest source stage adds optional generic lifecycle/reason policy and native
managed transition review, with old cancel/reschedule bypasses closed. See
[Lifecycle and reasons](../backend/calendar/lifecycle.md) and the
[qualification record](../backend/calendar/qualification.md). Clinical progress,
lobby/attention, recurrence and Jobs/Torrent effect dispatch remain
separate pending stages. The approved hosted demo was not changed by this work.

The subsequent source stage adds [visit/location bindings](../backend/calendar/visits.md)
and a native connected mode/location field family, including historical generation
preservation and exact hold transfer. The native participant stage now follows
the preserved [admission notes](./calendar-participant-admission-notes.md), not
the demo's fictional directory. See the [implemented boundaries](../backend/calendar/participants.md)
for opt-in Guardian discovery, private bindings and separately composable picker.
The next connected UI pass now composes native type defaults and optional account
selection, plus separate participant replacement and current scoped capability
discovery. See the [connected workspace guide](../frontend/calendar/connected-workspace.md).
Domain contacts/guests and invitations remain later work. None of these stages
implies a newly selected archive.

The subsequent source increment adds versioned
[weekly working hours and date exceptions](../backend/calendar/working-hours.md).
It freezes finite UTC policy coverage at a meaningful policy write and enforces
it through ordinary booking/hold admission, preserving the legacy whole-policy
format explicitly. It does not enable automatic recurrence or reminders; the
source-owned Jobs bridge remains a separate prerequisite. No new management UI
or hosted-demo change accompanies that backend increment.

The subsequent larger source stage implements the shared
[native source-owned Jobs foundation](../backend/scheduler/source-owned-jobs.md):
real source ownership, permanent policy epochs and receipts, source-only admission,
shared runner/Torrent recovery and existing-only storage reconciliation. It does
not yet wire calendar effect references to runnable work. Resume with bounded
calendar dispatch/acknowledgment and authoritative effect admission, plus lifecycle
composition and explicit durable retirement before disable. Automatic reminders,
calendar recurrence, provider sends and archive selection remain off.

The next private source stage now implements that bounded dispatch/acknowledgment
protocol and a unique final observation cutoff, with actual Jobs/Torrent evidence
and memory regressions across both files. See the
[private integration guide](../backend/calendar/integrations.md) and latest
[qualification](../backend/calendar/qualification.md). The original historical
effect references remain seals; a separate additive realm `010` captures explicit
installed policy epochs and new appointment revisions without backfill. This is
not a managed or public automation feature yet.

The following reviewed phase now adds the fixed source-only observation catalog,
optional owner readiness, durable registration controls (`012`) and native
controller, original-key Jobs settlement barriers and inert Jobs construction.
The readiness hook preserves original business receipt recovery, and the control
journal captures exact key/CAS before Jobs mutation. Retirement is local-first,
keeps late factual evidence and distinguishes never-registered from missing
previously registered state. Controller/dispatcher close does not claim shared
Jobs/Torrent drainage. `calendar:true` does not enable this private automation.

The next source pass now implements the shared managed before-recovery Jobs seam,
its phased physical drain/evidence lifetime, and a bounded private calendar
coordinator. Additive `013` rotates source work classes durably. Canonical source
wake queries and indexed SYSTEM owner pages drive one absolute Scheduler wake,
not a per-appointment timer or idle owner poll. The coordinator recovers pending
original controls, handles live retirement, keeps historical execution available
before startup/after intake drainage, and refuses stale config resurrection.
Its current 64-owner envelope/shared retained Jobs limits remain explicit.

Resume with actual managed calendar/config composition and operator
retire/reactivate-before-disable controls, larger catalog hydration and sustainable
retained-capacity management. See stage 14 of the [integration plan](./calendar-integration-plan.md#14-delivery-stages-and-acceptance-gates).
Physical/package qualification still requires storage recovery. No main/updater,
application, live state or hosted-demo change accompanies these source phases.

## Checkpoints and places to resume

- Historical starting baseline: `05344d46a5d0178cdb5df3ab02bbe763ef6aa3cd`, Zero 2.10.5.
- Released foundation/UI baseline: Zero 2.11.0,
  `4d2eb26034783cb77622a249c0cc57f48760331e`, archive SHA-256
  `5d3e7edfc063f18d00f406bddb62f74e3c99b7d878b5f43698940ca07e720290`.
  See the [release closure](./durable-jobs-and-workers-plan.md#release-closure--november-16)
  for the exact evidence and topology limits; later polish is not part of that
  already qualified archive.
- Calendar UI checkpoints: `0262755` and `03ac2ca`, originally on
  `feature/calendar-ui-components`. The scheduling feature branched from those
  preserved commits. Their experimental frontend family is included in 2.11.0;
  authoritative calendar persistence and booking were not added by that release.
- Native family: `src/components/calendar/`; public experimental entries
  `@zero/framework/calendar` and `@zero/framework/components/calendar`.
- [Native composition and limitations](../frontend/calendar/index.md) and
  [component anatomy](../../src/components/calendar/README.md).
- Preserved interactive preview:
  `/Volumes/code-bank/tmp/scratch/zero-platform/calendar-demos-v2-preview`,
  `http://127.0.0.1:4318`. Its `.storage-keep` describes ownership and retention.
  Check the owned process before restarting; do not create duplicate previews.
- The same approved standalone UI is published at https://cal.collabmd.net in an
  isolated Coolify demo application. It uses fictional browser-local state and
  resets on reload; no unfinished calendar backend, application database or
  production scheduling service is connected. Publishing it did not select a
  Zero framework update. Its local deployment notes are in the retained preview
  README; leave that independently hosted demo unchanged during backend work.
- [Shared jobs/scheduling record](./durable-jobs-and-workers-plan.md) preserves
  the released foundation's evidence. Calendar reminders and background adapters
  still need their own domain design and qualification.

## Preserve the reviewed design

Keep the compact calendar anatomy and options, not a replacement generic form.
Every visual property is token-driven. Retain the separate optional calendar
theme candidate so an app can deliberately adopt it in its authenticated shell
or site-wide later; never overwrite an app's public theme automatically.

Day view is columnar per provider/calendar, with a fixed time gutter and header.
Only the bounded calendar viewport scrolls. Columns shrink to a useful minimum,
then scroll horizontally. Week/month focus on one provider with quick provider
switching. The multi-provider day list/agenda supports scheduling staff. The
stacked resource timeline/Gantt view remains future work, not recovered code.

Keep collapsible scope/calendar sections, rightmost expansion carets and compact
state/location menus. An app may admit all states/locations/calendars or a narrow
subset; filtering cannot create permission to see an unauthorized calendar.

Keep appointment category colors plus two-tone attention/problem shading,
status icons with tooltips and optional popovers, and configurable lifecycle
states. Clinical examples include unconfirmed, confirmed, arrived, in-office or
telehealth lobby, triage, in-session, completed, no-show and cancelled. Generic
apps must not be forced into clinical states. A status transition can request a
reason/dialog before commit; cancellation must not silently apply first.

Keep context menus for empty slots and appointments. Appointment editor parts
must remain separately composable: attendee search/type filters (patient, staff,
contact, optional manual invite), additional attendees, appointment type catalog
plus permitted Other, typed exact times alongside interval suggestions, dates,
repeat controls, appearance and status/workflow fields. Automatic titles derive
from type/attendees until manually overridden. Settle name/type ordering with
the user rather than encoding a medical-only assumption.

Use native Zero ModalManager/ControlledModal, DrawerManager, Morph Select,
menus, popovers, date picker, tooltip and ScrollArea behavior. Preserve standard
origin-aware/reduced-motion animations, focus, touch and magnetic highlights.
Do not mount a separate modal manager or use native HTML date dialogs in the
final Zero integration. Use Zero icons first; any missing-icon fallback must be
explicitly documented. Keep empty/loading/error states and responsive layouts.

<a id="backend-design-still-to-do-with-the-user"></a>

## Original backend integration requirements, preserved

The following requirements were recorded before backend implementation. The UI
checkpoint alone does not implement authoritative persistence, booking,
availability or reminders. The editor's local synchronous save callback is not
an accepted-write receipt, and local booking previews are not real slots. Follow
the linked managed-core guide for the current implementation and remaining gates.

Plan a generic opt-in calendar service, not a PracticeIQ-specific system:

1. **Data ownership and authority.** Specify private Fabric placement,
   single/multi-tenant ownership, stable identities, revisions, migrations,
   retention and restoration without replacing existing data. Define Guardian
   calendar/resource capabilities, trusted provider/location properties,
   delegated scheduler roles, private attendee data and live revocation fences.
2. **Reminder lifetime.** Deliberately choose actor-owned versus code-admitted
   service-owned jobs, with current scope/eligibility and final effect checks.
   Expired actor authority never becomes SYSTEM fallback. Existing worker
   SYSTEM/API-key restrictions remain intact; a reminder is not permission to
   manufacture a user/admin context or expose raw service capabilities.
3. **Appointment-to-job consistency.** Appointment state and private jobs state
   are separate files, not one cross-file atomic transaction. Design stable
   intent identities, a short durable outbox/handoff and reconciliation when one
   side commits or an acknowledgment is lost. Retain original request identities
   for accepted/unknown controls; do not hold SQL/Guardian leases over queue or
   provider waits.
4. **Stale-reminder and downtime policy.** Reschedule/cancel must fence obsolete
   work by appointment revision, including a final check in already handed-off
   Torrent activities before sending. Pausing/cancelling a schedule does not
   undo an accepted workflow or provider effect. Specify lateness, expiry and
   recovery so downtime never blindly catches up expired reminders.
5. **Calendar time semantics.** Define timezones, DST folds/gaps, all-day and
   interval boundaries, recurrence and instance/series exceptions. Cron timings
   are not appointment recurrence/RFC 5545 series. Keep domain occurrence
   identity distinct from the jobs service's nominal execution identity.
6. **Authoritative availability and booking.** Specify buffers, blocking,
   resources, locations, conflicts, durable slot holds/expiry and idempotent
   booking under concurrent writes. Lock short database decisions, not network
   work. Define appointment types, participants, configurable state transitions,
   cancellation reasons and notification eligibility. Optional self-scheduling
   remains off unless configured, with eligibility enforced by the server.
7. **Async editing and authorized live state.** The current
   `AppointmentEditor.onSave` is synchronous local UI, not a backend contract.
   Design accepted/unknown write receipts, draft preservation, scope retirement,
   reactive snapshots, authorized updates and application hooks before wiring
   persistence. Reuse the reviewed native editor and overlay anatomy.
8. **Configured adapters and calendar qualification.** Use Zero notifications,
   email, Storage and messaging only when configured. Keep accepted,
   provider-confirmed, delivered and read evidence distinct; unknown SMTP sends
   require reconciliation, not blind retry. Define semantic audits without
   clinical payloads or timer/poll spam. Qualify concurrent booking, DST/series
   edits, reminder/reschedule/cancel races, lost acknowledgments/restart, tenant
   isolation, live revocation and the actual source/bundle/browser lifecycle.

Optional AI assistance remains advisory and bounded; it never supplies authority
or confirms an external effect. External calendar synchronization, telehealth
providers, timeline/Gantt UI, site-wide theme adoption and application deployments
remain separate scope, not implied by returning to this backend plan.

## Return gate

The shared 2.11.0 framework release gate is recorded complete. The user subsequently
approved the backend plan and implementation; that review gate is no longer a
request to pause. The managed core is in progress, with the current source and
qualification boundary recorded in the [backend guide](../backend/calendar/index.md)
and [review checkpoint](../backend/calendar/qualification.md). It is not a released
calendar backend or completion of the later booking/reminder stages. Post-release worker,
workflow-dispatch, jobs query-plan and direct-dependency fixes are implemented on
`feature/core-foundation-polish`. Their source review, fresh frozen installs,
TypeScript check and 19 selected canonical test files passed; they are not in the
selected 2.11.0 archive. A new archive's release qualification/selection remains
separate in the
[review record](./durable-jobs-and-workers-plan.md#post-release-review-boundary).
Keep the scheduling docs' released versus planned matrix accurate. A rendering
calendar UI is not an authoritative calendar service or an application's
production acceptance test.
