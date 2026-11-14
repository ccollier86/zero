# Calendar component collection

Status: frontend-only, experimental. The recovered compact calendar is being
stored as a native Zero component family before we design its backend. This is
not yet a scheduling service, a production booking engine or a released update.

## Organization

- `index.ts` is the composition entrance; it deliberately excludes the demo controller.
- `components/` contains the schedule, day/week/month/list views, appointment
  cards, context actions, editor, details, workflow/appearance controls, fields,
  repeat/type/invitee pickers and mobile filter drawer.
- `recovered/` retains the compact toolbar, mini-calendar, provider rows and
  editor anatomy. The original archive and standalone `demos-v2` project remain the reference.
- `models/` contains pure date, time, overlap, draft, recurrence, presentation,
  agenda and UI-scope calculations. These calculations do not authorize work.
- `styles/` contains token declarations, anatomy styles and the separate theme candidate.
- `test-support/` contains fictional fixture data for the focused model tests.
  The interactive preview/controller remains in its separate retained project,
  not in the reusable component entry.

## Compose a schedule

The host supplies a bounded flex layout, already-authorized resources/events,
controlled date/view state and callbacks. Give week/month one focused resource;
give day/list the selected resources. An empty resource array stays empty.

```tsx
import { CalendarSchedule, CalendarToolbar } from '@zero/framework/calendar';

<div className="zero-calendar" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
  <CalendarToolbar
    date={date} viewMode={view}
    onPrevious={previous} onToday={today} onNext={next}
    onViewChange={setView}
  />
  <CalendarSchedule
    date={date} view={view} resources={visibleResources} events={visibleEvents}
    onDateSelect={setDate} onMenu={openContextActions} onEdit={openEditor}
    onUpdate={requestChange} onDetails={openDetails}
    eventPresentation={event => ({ siteLabel: describeLocation(event.siteId), clinical: true })}
  />
</div>
```

`CalendarGrid`, `CalendarMonthGrid`, `CalendarAgenda`, `CalendarEventCard`,
`CalendarToolbar`, `MiniCalendar`, `CalendarSidebar`, `ScopePicker` and
`ProviderSwitcher` are independent pieces. The list is chronological across all
supplied calendars for the selected day, not an implicitly single-provider feed.

`calendarScopeModel(resources, filters, suppliedLocationIds, geography)` builds
sidebar facets from caller-supplied regions, locations and resource assignments.
The caller owns filter state/actions. Filtering, `busyOnly` presentation and
hidden controls are not authorization. Never send private records to a browser
and rely on this projection to secure them.

## Editors and fields

`AppointmentEditor` preserves the original compact icon-led form. Pass a fresh
keyed `EditorSession`, resources, current events, admitted locations,
`locationsForResource` and an `attendeeDirectory`. It clones the draft, blocks
unchanged/invalid saves and retains typed minute-precise times independently of
quarter-hour quick picks. Optional catalogs default empty rather than importing
the preview's fictional people or locations.

Its current `onSave` is a **synchronous UI contract** returning an error string or
`null`; do not pretend it awaits a server commit. Durable/async saving and source
retirement will be designed with the calendar backend. Personal/clinical records,
notifications, reminders and telehealth launches are not performed by the form.

The lower-level pieces remain available for app-specific editor composition:

| Pieces | Responsibility |
| --- | --- |
| `TimePicker`, `CalendarDateField`, `RepeatPicker` | Exact typed times; native Zero calendar picker; bounded recurrence preferences/preview |
| `AttendeePicker`, `AppointmentTypePicker` | Supplied people/type choices, compact search, multiple invitees, manual email/phone guest formatting |
| `AppointmentAppearancePicker` | Automatic/explicit category hue and independent attention reason |
| `AppointmentWorkflowFields`, `VisitIcon`, `AppointmentStatusPopover` | Confirmation/outcome, optional clinical progress and explicit lobby/arrival state |
| `AppointmentDetails`, `CancelEventDialog` | Readable details and reason-before-cancellation composition |
| `BookingSettingsPanel`, `BookingPreview` | Self-scheduling settings and a deliberately local example visitor flow |

The current editor/model includes the reviewed clinical appointment-type preset
and local 7 AM–7 PM range. The standalone type picker accepts custom options;
that alone does not extend the editor validator or establish a backend catalog.
Provider locations, people, role policy, appointment catalogs and real availability
remain explicit integration work rather than inferred permissions.

## Status changes can request another interaction

Confirmation/outcome, visit progress, arrival and attention are independent.
Unconfirmed does not imply a problem. A waiting visit can still be confirmed.
Office/virtual lobby is explicit; online presence never counts as check-in.
Terminal outcomes clear an occupied lobby, while rescheduling/duplication starts
a fresh visit rather than carrying the previous arrival into another appointment.

`AppointmentWorkflowFields.onStatusChangeRequested` receives an immutable intent
(`previous`, `next`, `event`, `change`). When provided, it owns applying the
change; the component does not mutate first. A consuming app can open a reason
dialog, seek approval, or reject the transition. An unchanged selection emits no intent.

```tsx
<AppointmentWorkflowFields
  event={draft} clinical
  onChange={applyDraftChange}
  onStatusChangeRequested={request => {
    if (request.next === 'cancelled') setCancellationRequested(true);
    else applyDraftChange(request.change);
  }}
/>
```

`CancelEventDialog` requires a nonblank reason by default for appointments;
`requireReason={false}` deliberately opts out. Time blocks do not require one.
Its confirm callback updates the caller's local state, and **its native manager
closes it**. Clear the conditional dialog owner in `onClose`, not prematurely in
`onConfirm`, so exit/focus handling can finish. The preview demonstrates declining
without mutation and applying a reason before cancellation. This is not a durable
cancellation event or proof that anyone was notified.

## Native Zero overlay ownership

Use the existing app-level ModalManager/AppProvider host and TooltipProvider;
do not mount managers per calendar, picker or appointment. The standalone
playground has one manager because it is not a full Zero app.

- `CalendarModal` delegates to `ControlledModal`. Editor, details, reason and
  booking dialogs retain their custom body anatomy, but Zero owns origin-aware
  entrance/exit, focus, stacking, backdrop and reduced-motion behavior.
- Pass the real connected `trigger` when available. Programmatic opens use Zero's
  normal fallback; never invent an origin rectangle.
- `CalendarSidebarDrawer` uses `ControlledDrawer` on the same owner, not a second
  overlay system. It retains the left filter-panel layout.
- Calendar menus use Zero DropdownMenu; popovers, selects, styled date pickers,
  tooltips, buttons, inputs and avatars use their native Zero implementations.
- There are no copied modal/select/popover animation timelines. Close completion
  comes from the native presence lifecycle, not an extra delay. Nested Escape
  closes the innermost picker, preserving the parent and its draft.
- The private `calendar-ui` vocabulary preserves compact presentation; it does not
  require another theme provider or a second component-library runtime.

## Tokens and separate theme candidate

`styles/calendar-tokens.css` contains the family defaults. Shared semantic aliases
derive from Zero's current surface/text/border/font tokens. Scoped theme roots
rebind these aliases; density values inherit normally. The anatomy has no independent
hex palette or Mantine variables. Colors, borders, radii, typography, spacing,
shadows and motion references live in the token files. CSS media-query breakpoints,
SVG paths and data-driven percentages/minute arithmetic remain structural values.

Important knobs include `--calendar-hour-height`, `--calendar-time-gutter`,
`--calendar-column-header-height`, `--calendar-day-column-min`,
`--calendar-week-column-min`, `--calendar-agenda-provider-width` and
`--calendar-attention-mix`. Changing hour density resizes slots, events and the
current-time marker together. Time gutter/header stay pinned while the calendar
viewport scrolls, including when 10–15 provider columns require horizontal overflow.

The second shade uses the **same hue** with a stronger attention mix (27% default),
plus an icon/reason; it is not color-only. Day, month, list and the comparison
samples share that token.

`styles/calendar-theme.css` independently preserves the reviewed light palette.
Importing it alone does not replace Zero's theme:

- `data-calendar-theme="studio"` opts a calendar scope into its family palette.
- `data-zero-theme="calendar-studio"` explicitly maps the candidate to app-wide
  Zero semantic tokens. This is for later review; do not set it on existing apps
  without approval.

The standalone preview opts in. No current Zero theme or consuming application's
public styling was replaced. The candidate is light-only; a matching dark
candidate and a whole-site theme rollout are not qualified by this UI pass.

Available icons come from `@zero/framework/icons`. Only exact glyphs missing from
its registry use small retained Tabler SVG fallbacks; attribution is in
`LICENSE.tabler`. They do not require the Tabler runtime in a Zero application.

## What is deliberately not implemented

No calendar Fabric database, Guardian policy, booking transaction/hold,
cross-worker conflict arbitration, durable recurrence, timezone/DST engine,
invitations, reminders, workflow triggers, external calendar sync or telehealth
provider is wired here. Booking results are local synthetic appointments only.
A resource timeline/Gantt view is still a separate future view. UI scope choices
do not grant access. Those backend contracts will be planned together after UI review.
