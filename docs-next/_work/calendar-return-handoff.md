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
applies_to: ["feature/core-worker-runtime-upgrades; calendar backend paused, source notes only"]
---

# Return to calendar after the shared scheduling foundation

[Working evidence](./index.md)

Recorded 2026-11-14 at the user's request. Preserve this handoff until the
calendar backend integration is finished. It is source documentation, not a
disposable generated fixture. The user explicitly paused calendar backend work
to strengthen shared scheduling, job execution, workers and Zero's API first.

## Checkpoints and places to resume

- Released baseline: `05344d46a5d0178cdb5df3ab02bbe763ef6aa3cd`, Zero 2.10.5.
- Calendar UI checkpoints: `0262755` and `03ac2ca`, originally on
  `feature/calendar-ui-components`. The scheduling feature branches from those
  preserved commits; neither feature is implicitly released or merged.
- Native family: `src/components/calendar/`; public experimental entries
  `@zero/framework/calendar` and `@zero/framework/components/calendar`.
- [Native composition and limitations](../frontend/calendar/index.md) and
  [component anatomy](../../src/components/calendar/README.md).
- Preserved interactive preview:
  `/Volumes/code-bank/tmp/scratch/zero-platform/calendar-demos-v2-preview`,
  `http://127.0.0.1:4318`. Its `.storage-keep` describes ownership and retention.
  Check the owned process before restarting; do not create duplicate previews.
- [Shared jobs/scheduling expansion](./durable-jobs-and-workers-plan.md) must
  explicitly qualify the capabilities needed by reminders and background work.

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

- Private Fabric placement, single/multi-tenant ownership, stable identities,
  migrations, retention and restoration without replacing existing data.
- Guardian calendar/resource capabilities, trusted provider/location properties,
  delegated scheduler roles, private attendee data and live revocation fences.
- Timezones, DST, all-day and interval semantics; a real recurrence engine and
  instance/series exceptions. Cron expressions are not calendar recurrence rules.
- Availability, buffers, blocking, conflicts, durable slot holds and idempotent
  booking under concurrent writes; lock short database decisions, not network work.
- Appointment types, participants, resources, locations, configurable state
  transitions, cancellation reasons and notification eligibility.
- Optional self-scheduling/Calendly-style UI and server policy, off by default
  unless configured. Conditional permission/eligibility must be server enforced.
- Native scheduling/jobs for one-off reminders, rescheduling, reconciliation,
  provider calls and workflows. Changes fence stale jobs by appointment revision;
  expired reminders must not be sent through naive catch-up after downtime.
- Zero notifications/email/Storage/messaging integrations only when configured;
  accepted, provider-confirmed, delivered and read remain distinct evidence.
- Reactive snapshots, authorized updates, application hooks and reusable UI
  pieces; preserve drafts and accepted/unknown outcomes across asynchronous work.
- Semantic audit actions and explicit application extension hooks, without
  exposing clinical text or generating audit spam for timer/poll activity.
- Optional AI assistance is advisory and bounded; it never supplies authority or
  confirms an external effect. External calendar synchronization is separate scope.

## Return gate

Finish and qualify the shared foundation, then review the calendar backend plan
with the user before implementation. Keep the scheduling docs' supported versus
planned matrix accurate. Do not claim a calendar backend exists because its UI
renders, or claim the foundation is released before normal archive qualification.
