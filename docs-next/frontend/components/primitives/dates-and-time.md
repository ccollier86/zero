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
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
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
disabled=false; className/transition/calendarProps. calendarProps omits mode,
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
