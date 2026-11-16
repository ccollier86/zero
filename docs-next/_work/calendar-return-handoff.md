---
id: zero.work.calendar-return-handoff
type: reference
audience: [developer, agent]
owner: calendar
status: draft
implementation_state: paused
visibility: internal
system: calendar
feature: integration-return-notes
maturity: experimental
applies_to: ["2.11.0 released foundation and experimental calendar UI; calendar backend awaits design review"]
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

## Backend design still to do with the user

No authoritative calendar persistence, booking, availability or reminders are
implemented by the UI checkpoint. The editor's local synchronous save callback
is not an accepted-write receipt. Local booking previews are not real slots.

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

The shared 2.11.0 framework release gate is recorded complete. The next calendar
step is reviewing the eight backend prerequisites with the user before
implementation; calendar backend work remains unimplemented. Post-release worker,
workflow-dispatch, jobs query-plan and direct-dependency fixes are implemented on
`feature/core-foundation-polish`. Their source review, fresh frozen installs,
TypeScript check and 19 selected canonical test files passed; they are not in the
selected 2.11.0 archive. A new archive's release qualification/selection remains
separate in the
[review record](./durable-jobs-and-workers-plan.md#post-release-review-boundary).
Keep the scheduling docs' released versus planned matrix accurate. A rendering
calendar UI is not an authoritative calendar service or an application's
production acceptance test.
