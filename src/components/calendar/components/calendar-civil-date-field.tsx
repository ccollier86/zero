/** Native Zero input + calendar popover with explicit UTC presentation, never host-Date authority. */
import { useEffect, useRef, useState } from 'react';
import { Calendar } from '@zero/framework/components/ui/calendar';
import { calendarCivilDisplayDate, calendarFormatCivilDate, calendarLocalDate, calendarParseCivilInput } from '../models/calendar-local-date';
import { Button, Group, TextInput } from './calendar-ui';
import { CalendarPopover } from './calendar-surfaces';
import { IconChevronDown } from './calendar-icons';
import '../styles/calendar-date-field.css';
export interface CalendarCivilDateFieldProps {
  readonly value: string; readonly onChange: (value: string) => void; readonly label?: string; readonly disabled?: boolean;
}
export function CalendarCivilDateField({ value, onChange, label = 'Date', disabled = false }: CalendarCivilDateFieldProps) {
  const [buffer, setBuffer] = useState(value), [opened, setOpened] = useState(false), accepted = useRef(value);
  useEffect(() => { if (accepted.current !== value) { accepted.current = value; setBuffer(value); } }, [value]);
  function commit(next: string) { accepted.current = next; onChange(next); }
  const selected = calendarLocalDate(value) ? calendarCivilDisplayDate(value) : undefined;
  return <Group gap="var(--calendar-size-4)" className="calendar-civil-date-field">
    <TextInput aria-label={label} value={buffer} disabled={disabled} size="xs" placeholder="YYYY-MM-DD" maxLength={10}
      onChange={event => { const text = event.currentTarget.value; setBuffer(text); commit(calendarParseCivilInput(text) ?? ''); }} />
    <CalendarPopover opened={opened && !disabled} onChange={setOpened} position="bottom-end" returnFocus>
      <CalendarPopover.Target><Button variant="subtle" size="xs" disabled={disabled} aria-label={`Choose ${label.toLowerCase()}${value ? `, ${value}` : ''}`}><IconChevronDown /></Button></CalendarPopover.Target>
      <CalendarPopover.Dropdown><Calendar mode="single" timeZone="UTC" selected={selected} defaultMonth={selected} yearRange={[0, 9999]} enableViewPicker={false}
        startMonth={calendarCivilDisplayDate('0000-01-01')} endMonth={calendarCivilDisplayDate('9999-12-01')}
        formatters={{ formatCaption: date => calendarFormatCivilDate(`${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`, { month: 'long', year: 'numeric' }), formatYearDropdown: date => String(date.getUTCFullYear()).padStart(4, '0') }}
        onSelect={date => {
        if (!date) return;
        const next = `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
        if (calendarLocalDate(next)) { setBuffer(next); commit(next); setOpened(false); }
      }} /></CalendarPopover.Dropdown>
    </CalendarPopover>
  </Group>;
}
