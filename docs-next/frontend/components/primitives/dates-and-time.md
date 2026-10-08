---
id: zero.frontend.components.primitives.dates-time
type: reference
audience: [developer, agent]
owner: frontend-components
status: verified
visibility: internal
system: frontend-components
feature: date-time-inputs
maturity: supported
applies_to: ["2.6.0 source/local archive with shared picker modernization"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "b003d5b8f738a17d4f0d84bf2643eed615b2c543"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Dates, Ranges And Time

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

The UI modules `/date-picker`, `/date-range-picker`, `/time-picker` and
`/calendar` are exported below `@zero/framework/components/ui`.
UI values are Date/DateRange or HH:mm strings, not automatically SQLite codecs.
Use [schema codecs](../../../backend/schema/index.md) at the persistence boundary.

## DatePicker

DatePicker owns single-date selection. Its defaults retain the existing typed
input with a calendar button; `appearance="button"` instead offers a single
trigger with an animated formatted date. Both use the same shared Calendar.

| Prop | Contract/default |
| --- | --- |
| `value`, `onChange` | Controlled `Date \| undefined`; selection/clear notification, not a server save. |
| `placeholder` | `Pick a date`. |
| `disabled`, `readOnly` | `false`; prevent mutation and opening the calendar. Read-only text remains inspectable. |
| `appearance` | `input`; optional `button` presentation. |
| `open`, `onOpenChange` | Optional controlled popover state; the caller must reflect requested changes. |
| `clearable` | `true`; shows an explicit Clear action in the calendar footer. |
| `animateValue` | `true`; changed date parts roll in button mode, not in the typed text field. |
| `inputValue`, `onInputValueChange` | Optional parent-owned unfinished text buffer. |
| `inputProps`, `triggerClassName`, `className` | Native input/ARIA attributes and shared composition styling. |
| `calendarProps` | DayPicker policy/presentation, excluding picker-owned mode, selection, autofocus and drill-down view. |
| `transition` | Optional popover motion override. |

Typed numeric dates accept M/D/YYYY or M-D-YYYY, require matching separators,
a four-digit year at least 1000, and reject invalid calendar days. The long
selected display uses date-fns formatting. Dates are local-midnight calendar
values, not UTC instants.

Complete valid numeric input can commit during typing; blur/Enter also commit.
An empty value clears to undefined. Invalid or calendarProps.disabled-matching
input remains marked invalid without committing. Escape restores the formatted
parent value. Calendar selection emits a Date and closes the popover. Required,
range, timezone and business rules remain server/form validation duties.

Month/year captions open their corresponding grids. Escape returns from those
grids to days first; another Escape closes. Close, another trigger click or
outside dismissal closes without selecting or clearing a date. The Today action
navigates without changing the selected value. ArrowDown opens from a focused
button; Alt+ArrowDown opens from the typed input. Caller key handlers may prevent
picker handling, and composition input is not treated as a selection shortcut.

For a form/controller that owns an unfinished text buffer, supply `inputValue`
and `onInputValueChange(text)`. The text callback runs for user edits before valid
Date selection is notified, so incomplete/invalid input can remain visible; the
Date callback still admits only a valid date. This is additive: omitting these
props retains the ordinary Date-controlled behavior. `inputProps` forwards
native field ID, name, required, ARIA attributes and focus/blur/key handlers,
without replacing picker-owned value/change/type handling. `triggerClassName`
styles the calendar trigger; `readOnly` keeps the text inspectable but prevents
typing/calendar changes. `disabled` still disables both input and trigger.

Data Studio composes this picker with TimePicker and a separate precision field
for typed date/datetime drafts. See [logical values](../../data-studio/values.md)
for canonical date/UTC timestamp admission and precision; TimePicker itself
continues to represent `HH:mm` rather than silently expanding its public format.

## DateRangePicker And Calendar

DateRangePickerProps: value?:DateRange; onChange(DateRange|undefined);
placeholder='Pick a date range'; disabled=false; className/transition.
Its calendar uses range mode and two months; a partial from-only selection stays
open and a complete from/to selection closes. It is not a free-text range input.

CalendarProps follows react-day-picker DayPickerProps. Zero keeps DayPicker as
the selection, modifier, bounds, locale/timezone and range/multiple-mode engine;
the days/months/years surfaces are presentation, not a parallel date model.
Outside days and six fixed weeks default to true; `fixedWeeks={false}` retains
variable week counts. Caller `classNames` merge with defaults, and supplied
`components` can override the existing extension points.

| Additional Calendar prop | Contract/default |
| --- | --- |
| `enableViewPicker` | `true`; month/year heading buttons open drill-down grids. |
| `showToday` | `true`; navigate to Today without selecting it. |
| `yearRange` | Optional inclusive `[firstYear,lastYear]` presentation range; navigation bounds take precedence. |
| `view`, `onViewChange` | Optional controlled `days \| months \| years` presentation state. |

Month view uses a three-column grid; year view scrolls independently and
virtualizes long ranges. The selected period stays visible on opening. Arrow
keys move focus without selecting, Enter/Space chooses, and Home/End reach the
first/last offered period. Year PageUp/PageDown moves twelve years; month
PageUp/PageDown navigates the year. RTL reverses horizontal focus movement.
Header arrows navigate months in days view and years in month view. Years view
does not show month arrows. Navigation remains bounded by DayPicker policy.
For multi-month calendars, choosing a caption period makes that month the first
displayed month, matching DayPicker's native dropdown semantics.

By default the unbounded year list offers a window extending 100 years back and
30 forward from today, including an already displayed historical/future year.
This is a presentation window, not admission of an arbitrary date.

Explicit `captionLayout="dropdown"`/dropdown variants retain native DayPicker
caption controls. Custom Month/MonthGrid/MonthCaption/CaptionLabel components opt out of Zero's drill-down
presentation; custom navigation/components remain caller-owned. This permits
existing specialized consumers to retain their rendering policy.

Selection mode, required selection, disabled matchers, bounds and locale are
caller-supplied DayPicker policy. It is not the planned full scheduling plugin.

```tsx
import { useState } from 'react';
import { DatePicker } from '@zero/framework/components/ui/date-picker';

export function Birthday() {
  const [value, setValue] = useState<Date>();
  return <DatePicker value={value} onChange={setValue} />;
}
```

Use `calendarProps={{ startMonth: new Date(1900, 0), endMonth: new Date() }}`
to bound a birthday calendar, or `appearance="button"` for the compact animated
trigger. Those bounds affect calendar navigation; domain validation must still
admit any typed/persisted value independently.

## TimePicker

TimePicker presents one compact trigger and a scrollable keyboard-operated time
list. It still emits canonical 24-hour `HH:mm`, never a Date, timezone, seconds
or an implicit current-time selection.

| Prop | Contract/default |
| --- | --- |
| `value`, `onChange` | Controlled string; choosing emits `HH:mm`, Clear emits `''`. |
| `format` | `12h`; `24h` changes only visible labels. |
| `minuteStep` | `1`; integers 1–30 offer minutes within each hour; invalid steps fall back to 1. |
| `placeholder` | `Select a time`; empty remains empty until deliberately selected. |
| `disabled`, `readOnly` | `false`; prevent opening/changing values. |
| `clearable`, `animateValue` | `true`; explicit Clear and changed-label motion. |
| `open`, `onOpenChange` | Optional controlled popup state. |
| `id`, `name`, ARIA attributes | Named hidden form value and accessible trigger/list labels; `aria-label` defaults to `Time`. |
| `triggerClassName`, `className` | Shared trigger and outer composition styling. |

An existing valid off-step time remains visible and selectable exactly; changing
the interval/display format never rounds the parent value. Invalid nonempty
values remain visible with invalid feedback, rather than silently becoming the
current time. A named hidden input submits the supplied value and respects the
disabled state. The picker interval is not server-enforced schedule validation.

ArrowUp/ArrowDown opens the focused trigger. Within the list, arrows move one
option, PageUp/PageDown ten, Home/End reach its endpoints, and Enter/Space
chooses. Escape, Close, trigger toggle and outside dismissal do not mutate a
value. The selected/active option is kept within the list's own scroll region.
Long option lists use Zero's existing TanStack virtualizer, retaining the active
option in the DOM for `aria-activedescendant`. The list, not the popup footer or
surrounding page, owns vertical scrolling.

```tsx
import { useState } from 'react';
import { DatePicker } from '@zero/framework/components/ui/date-picker';
import { TimePicker } from '@zero/framework/components/ui/time-picker';

export function LocalScheduleFields() {
  const [date, setDate] = useState<Date>();
  const [time, setTime] = useState('09:07');
  return <div className="grid gap-3 sm:grid-cols-2">
    <DatePicker appearance="button" value={date} onChange={setDate}
      calendarProps={{ startMonth: new Date(2000, 0), endMonth: new Date(2100, 11) }} />
    <TimePicker name="meetingTime" value={time} onChange={setTime}
      format="24h" minuteStep={15} aria-label="Meeting time" />
  </div>;
}
```

This local example retains `09:07` even though newly offered times use fifteen
minute intervals. It does not persist anything, infer a timezone or combine a
date/time into an instant; the consuming form/domain controller owns that work.

## Theme-Controlled Picker Motion

The shared CSS loaded through Zero's normal frontend stylesheet provides these
overridable tokens. WAAPI view/value animations resolve them from the active
element at playback time, not once at module import.

| CSS variable | Default |
| --- | --- |
| `--zero-calendar-motion-fast` | `160ms` |
| `--zero-calendar-motion-spring` | `580ms` |
| `--zero-calendar-ease-standard` | `cubic-bezier(.22,1,.36,1)` |
| `--zero-calendar-ease-spring` | The supplied smooth spring `linear(...)` curve; older engines use `cubic-bezier(.22,1.2,.36,1)`. |

Reduced motion removes perceptible transitions without changing interaction or
value admission. Shared controls, semantic colors, typography, borders, spacing
and surfaces remain Zero-themed in light/dark mode; this is not a global theme
replacement or a transplant of a reference site's palette.

## Related Guides And Next Steps

- [Forms](../../forms/index.md) composes Date/Time fields.
- [Choice controls](./choices.md) explains selector interaction.
- [Schema](../../../backend/schema/index.md) owns logical/storage conversion.
