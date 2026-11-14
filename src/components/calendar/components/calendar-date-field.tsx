/** Local ISO-day contract over Zero's styled typed/calendar date picker. No native OS date dialog. */
import { useEffect, useRef, useState } from 'react';
import { DatePicker } from '@zero/framework/components/ui/date-picker';
import { formatDatePickerValue, parseDatePickerInput } from '@zero/framework/components/ui/date-picker-value';
import { dateKey, isDay, parseDay } from '../models/calendar-date';
import '../styles/calendar-date-field.css';
export function CalendarDateField({ value, onChange, label = 'Date', min }: { value: string; onChange(value: string): void; label?: string; min?: string }) {
  const [buffer, setBuffer] = useState(() => formatDatePickerValue(isDay(value) ? parseDay(value) : undefined));
  const accepted = useRef(value);
  useEffect(() => { if (value !== accepted.current) { accepted.current = value; setBuffer(formatDatePickerValue(isDay(value) ? parseDay(value) : undefined)); } }, [value]);
  function commit(next: string) { if (next !== accepted.current) { accepted.current = next; onChange(next); } }
  return <DatePicker className="calendar-date-field" value={isDay(value) ? parseDay(value) : undefined} inputValue={buffer}
    onInputValueChange={text => { setBuffer(text); const parsed = parseDatePickerInput(text); commit(parsed ? dateKey(parsed) : ''); }}
    onChange={date => commit(date ? dateKey(date) : '')} inputProps={{ 'aria-label': label }}
    calendarProps={{ ...(min && isDay(min) ? { disabled: { before: parseDay(min) } } : {}) }} />;
}
