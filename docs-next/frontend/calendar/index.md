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
applies_to: ["2.11.0 released experimental frontend components; no calendar backend"]
modes: [browser]
---

# Calendar UI Components

[Frontend index](../index.md) · [Reusable components](../components/index.md)

Zero 2.11.0 includes the reviewed calendar UI as one fully tokenized, native
experimental component family. **No calendar backend is implemented or enabled.**
Do not infer a scheduling service, Fabric store, permission policy or production
booking API from these component exports. The foundation's
[release closure](../../_work/durable-jobs-and-workers-plan.md#release-closure--november-16)
records exact artifact identity and qualification boundaries.

The shared scheduling/worker framework release gate is satisfied. The user has
approved the calendar backend plan and implementation is now in progress on the
feature branch; it has not been released with the experimental frontend archive.
The [return handoff](../../_work/calendar-return-handoff.md) preserves the reviewed
UI and explicit backend prerequisites.
The [managed integration plan](../../_work/calendar-integration-plan.md) now
expands those requirements into proposed configuration, domain/service, async UI
and qualification contracts. It does not add backend APIs to the released UI.

## Unreleased connected core

The current feature branch now adds `ConnectedCalendarWorkspace`, `client.calendar`
and the native calendar hooks backed by the [managed core](../../backend/calendar/index.md).
It has **not** been added to the selected updater archive. The released-version
statements above still apply to 2.11.0; source and memory checks are not installed
browser/Linux/package qualification.

The connected workspace accepts an explicit `displayTimeZone`, uses current
Guardian-scoped resources, and composes real core create/reschedule/cancel,
receipt reconciliation and authorized live pages. It preserves existing native
modal ownership, token anatomy and shared animations. It never loads demo users
or silently saves unavailable recurrence/clinical/invitee fields. The original
rich local `AppointmentEditor` stays synchronous; do not wire a Promise into it.
See the [facade and exact UI limits](../../backend/calendar/facade.md#browser-composition).

The new feature barrel exports browser-safe hooks/contracts/errors only; private
actors and Fabric ownership remain in the server implementation. The focused
calendar UI entry still owns `ConnectedCalendarWorkspace` and calendar CSS. The
optional site-wide theme candidate is not applied automatically.

Unreleased directory integration adds live `useCalendarResources` with location/region
facets, `useCalendarLocations`, `useCalendarLocation` and
`useCalendarResourceLocations`. The same current-scope watch/retirement machinery
backs catalogs and details; unchanged Guardian identity does not bypass domain
grant revocation. Filter replacement withdraws the old page before effect cleanup.
This does not yet wire the rich demo's geographic controls or expose a catalog
management editor. See [directory semantics](../../backend/calendar/facade.md#locations-regions-and-authorized-resource-filters).

The next unreleased backend stage adds live `useCalendarAppointmentTypes`,
manager-only `useCalendarAppointmentType`, and `useCalendarResourceTypes` hooks.
Selected-resource type catalogs intersect current authorized policy, and old
pages retire on selection, client, scope or domain denial. Typed record DTOs
retain historical labels/defaults; untyped DTOs omit the optional binding. The
connected editor and rich demo's local type picker are not yet wired to those
catalogs/policies; see [type semantics](../../backend/calendar/facade.md#appointment-types-and-booking-policy).

Sources and the full composition guide are in
[`src/components/calendar/README.md`](../../../src/components/calendar/README.md).
The family has its own `components`, `models`, `hooks`, `recovered`, `styles`
and synthetic `test-support` subdirectories. Original recovered source and the
standalone interactive preview remain preserved separately.

## Imports and composition

In the 2.11.0 archive, `@zero/framework/calendar` and
`@zero/framework/components/calendar` resolve to the same focused entry. They
are not added to the broad frontend barrel. Older archives do not gain these
exports without an explicitly authorized application dependency update.

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

Inclusion in the released framework does not qualify a calendar SSR contract,
DST/recurrence engine, cross-worker slot holds, Fabric persistence, Guardian
permissions, invitations, reminders, notifications, external calendar
synchronization or telehealth backend. The resource timeline/Gantt view remains
future UI work. Plan the calendar backend with the user; do not treat UI/package
qualification as domain acceptance or authorization to deploy an application.
