---
id: zero.frontend.components.primitives.dates-time
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: date-time-inputs
maturity: supported
applies_to: ["2.2.1 development source with controlled-date-buffer additions; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "95ba0578f6625fc4597a9ec6786ee1d3353f29cd"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Dates, Ranges And Time

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

The UI modules `/date-picker`, `/date-range-picker`, `/time-picker` and
`/calendar` are exported below `@zero/framework/components/ui`.
UI values are Date/DateRange or HH:mm strings, not automatically SQLite codecs.
Use [schema codecs](../../../backend/schema/index.md) at the persistence boundary.

## DatePicker

DatePickerProps: value?:Date; onChange(Date|undefined); placeholder='Pick a date';
disabled=false; readOnly=false; className/transition/calendarProps. calendarProps omits mode,
selected,onSelect,autoFocus because this component owns single selection.
Typed numeric dates accept M/D/YYYY or M-D-YYYY, require matching separators,
a four-digit year at least 1000, and reject invalid calendar days. The long
selected display uses date-fns formatting. Dates are local-midnight calendar
values, not UTC instants.

Complete valid numeric input can commit during typing; blur/Enter also commit.
An empty value clears to undefined. Invalid or calendarProps.disabled-matching
input remains marked invalid without committing. Escape restores the formatted
parent value. Calendar selection emits a Date and closes the popover. Required,
range, timezone and business rules remain server/form validation duties.

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

CalendarProps follows react-day-picker DayPickerProps with className. Zero applies
shared classes, outside days default true, and default chevrons; caller classNames
merge with those defaults, and supplied components can override default components.
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

## TimePicker

TimePickerProps: value?:string, onChange(string), disabled=false, minuteStep=1,
className,id,name,aria-label (Time default),aria-describedby,aria-invalid.
The visible hour/minute/AM-PM selectors emit valid 24-hour HH:mm strings. Optional
name adds a hidden input containing the supplied parent value. Invalid/absent
values display placeholders; first change fills untouched parts from local current
time. minuteStep is normalized to an integer 1–30 for offered minutes (otherwise
1); it is not a server-enforced schedule interval or timezone.

## Related Guides And Next Steps

- [Forms](../../forms/index.md) composes Date/Time fields.
- [Choice controls](./choices.md) explains selector interaction.
- [Schema](../../../backend/schema/index.md) owns logical/storage conversion.
