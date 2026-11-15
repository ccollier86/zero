---
id: zero.frontend.calendar
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: calendar
feature: frontend-components
maturity: experimental
applies_to: ["feature/calendar-ui-components; frontend only; not in the current release"]
modes: [browser]
---

# Calendar UI Components

[Frontend index](../index.md) · [Reusable components](../components/index.md)

This feature branch preserves the reviewed calendar UI as one fully tokenized,
native Zero component family. **No calendar backend is enabled.** Do not infer a
scheduling service, Fabric store, permission policy or production booking API
from these component exports. The current released archive is unchanged.

Calendar backend work is paused for the shared scheduling/worker expansion.
The [return handoff](../../_work/calendar-return-handoff.md) preserves the full
reviewed UI and integration requirements; resume from that document after the
[foundation plan](../../_work/durable-jobs-and-workers-plan.md) is qualified.

Sources and the full composition guide are in
[`src/components/calendar/README.md`](../../../src/components/calendar/README.md).
The family has its own `components`, `models`, `hooks`, `recovered`, `styles`
and synthetic `test-support` subdirectories. Original recovered source and the
standalone interactive preview remain preserved separately.

## Imports and composition

On this branch, `@zero/framework/calendar` and
`@zero/framework/components/calendar` resolve to the same focused entry. They
are not added to the broad frontend barrel. Existing releases do not gain these
exports until an independently qualified release includes this work.

- `CalendarSchedule` composes multi-resource day, focused-provider week/month,
  and chronological multi-resource day-list views. Data and state are controlled.
- `CalendarToolbar`, `CalendarGrid`, `CalendarMonthGrid`, `CalendarAgenda`,
  `CalendarEventCard`, `MiniCalendar`, `CalendarSidebar`, `ScopePicker` and
  `ProviderSwitcher` are available independently.
- `AppointmentEditor`, `AppointmentDetails`, `CancelEventDialog`, invitee/type/
  repeat/time/date pickers and appearance/workflow/status parts retain the
  compact reviewed anatomy. Apps may compose those pieces into their own editors.
- `BookingSettingsPanel` and `BookingPreview` retain the reviewed self-scheduling
  UI and explicitly local example availability. They are not authoritative bookings.

The caller supplies admitted people, calendars, locations, scope state and
callbacks. Empty arrays never silently load demo identities. The current editor
still uses the reviewed clinical type preset and a local 7 AM–7 PM display model;
backend-configured catalogs/ranges are later integration work.

## Shared modal, drawer and floating-surface behavior

Use the existing app-level [ModalManager](../modals/index.md) and TooltipProvider.
Do not mount another manager for the calendar. `CalendarModal` uses
`ControlledModal`; the filter drawer uses `ControlledDrawer` on the same owner.
Supply a real initiating element when available. Zero owns origin-aware default
entrance/exit, stacking, focus, backdrop, nested overlays and reduced motion.

Menus use native Zero DropdownMenu, selects use Morph Select, and popovers/date
pickers/tooltips use their corresponding native components. Their animation
timelines are not copied into this family. Calendar bodies keep their particular
layout and options. Close callbacks retire conditional owners after native exit,
not before it or after a hand-written delay.

`AppointmentWorkflowFields.onStatusChangeRequested` lets an app intercept a
transition before applying it, such as asking for a cancellation reason. The
reason dialog requires a reason by default and can be explicitly configured
otherwise. UI acceptance is not evidence that a server write or notification
completed. The current `AppointmentEditor.onSave` remains synchronous local UI
composition; an async persistence contract is not yet implemented.

## Design tokens and future theme candidate

The family entry imports namespaced defaults. Component anatomy references
stored tokens for color, type, density, spacing, borders, radii, shadow and shared
motion roles. Density changes resize slots and event geometry together. Headers
and the time gutter stay pinned inside the bounded calendar viewport.

The optional `@zero/framework/calendar/theme.css` preserves the reviewed light
palette separately. `data-calendar-theme="studio"` opts a calendar scope in;
`data-zero-theme="calendar-studio"` explicitly applies its candidate mapping to
Zero app-wide semantic tokens. Importing the CSS alone does not switch an app.
**Do not change an existing public or authenticated app theme without approval.**

The candidate is light-only. Dark-theme candidate and site-wide adoption need
their own visual qualification. Available glyphs use Zero's icon pack; a small
attributed local fallback retains only shapes absent from its registry.

## Qualification and remaining work

The isolated Chromium preview exercises native manager opening/closing, nested
Escape, draft preservation, invitees, exact typed times, reason-before-cancel,
multi-provider list, empty selection, token-driven geometry, booking entry states,
and reduced-motion mobile drawer/dialog behavior. Focused model/contract tests
and TypeScript checks supplement—not replace—those browser checks.

No full-framework release, SSR calendar contract, DST/recurrence engine,
cross-worker slot holds, Fabric persistence, Guardian permissions, invitations,
reminders, notifications, external calendar synchronization or telehealth backend
is qualified here. The resource timeline/Gantt view remains future UI work.
Plan those integrations with the user after reviewing this frontend collection.
