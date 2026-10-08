/** Synthetic controlled picker values only; no APIs, sessions or persisted records. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DatePicker } from './date-picker';
import { TimePicker } from './time-picker';
import { formatDatePickerCalendarValue, formatDatePickerValue } from './date-picker-value';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../animate-ui/components/radix/dialog';

const changes: Array<{ field: string; value: string }> = [];
interface Configuration { disabled: boolean; readOnly: boolean; format: '12h' | '24h'; step: number; controlled: boolean }
let configure!: (next: Partial<Configuration>) => void;
let setControlledOpen!: (open: boolean) => void;
let replaceDate!: () => void;

function Fixture() {
  const [settings, setSettings] = React.useState<Configuration>({ disabled: false, readOnly: false, format: '12h', step: 15, controlled: false });
  const [date, setDate] = React.useState<Date | undefined>(new Date(2026, 1, 3));
  const [draft, setDraft] = React.useState(formatDatePickerValue(date));
  const [time, setTime] = React.useState('17:46');
  const [open, setOpen] = React.useState(false);
  const [buttonDate, setButtonDate] = React.useState<Date | undefined>(new Date(2026, 1, 3));
  const [modal, setModal] = React.useState(false);
  configure = next => setSettings(current => ({ ...current, ...next }));
  setControlledOpen = setOpen;
  replaceDate = () => setButtonDate(new Date(2027, 3, 16));
  return <main className="mx-auto grid max-w-md gap-5 p-4">
    <section data-testid="typed-date">
      <DatePicker value={date} inputValue={draft} disabled={settings.disabled} readOnly={settings.readOnly}
        open={settings.controlled ? open : undefined} onOpenChange={next => { if (!settings.controlled) setOpen(next); }}
        inputProps={{ id: 'due-date', name: 'dueDate', 'aria-label': 'Due date' }}
        calendarProps={{ today: new Date(2026, 1, 10), yearRange: [2020, 2030] }}
        onInputValueChange={setDraft} onChange={next => {
          changes.push({ field: 'date', value: next ? formatDatePickerCalendarValue(next) : '' });
          setDate(next); setDraft(formatDatePickerValue(next));
        }} />
    </section>
    <section data-testid="button-date"><DatePicker value={buttonDate} appearance="button"
      inputProps={{ 'aria-label': 'Launch date' }} onChange={setButtonDate} /></section>
    <form data-testid="time-form" onSubmit={event => event.preventDefault()}>
      <TimePicker value={time} name="meetingTime" aria-label="Meeting time" format={settings.format} minuteStep={settings.step}
        disabled={settings.disabled} readOnly={settings.readOnly}
        onChange={next => { changes.push({ field: 'time', value: next }); setTime(next); }} />
    </form>
    <Button data-testid="outside" type="button" variant="ghost">Outside picker</Button>
    <Dialog open={modal} onOpenChange={setModal}>
      <DialogTrigger asChild><Button type="button">Open parent dialog</Button></DialogTrigger>
      <DialogContent data-testid="parent-dialog">
        <DialogTitle>Record draft</DialogTitle><DialogDescription>Nested pickers must not close this draft.</DialogDescription>
        <DatePicker value={date} onChange={setDate} inputProps={{ 'aria-label': 'Nested date' }} calendarProps={{ yearRange: [2020, 2030] }} />
        <TimePicker value={time} aria-label="Nested time" minuteStep={15} onChange={setTime} />
        <Button type="button" variant="ghost">Inside parent outside picker</Button>
      </DialogContent>
    </Dialog>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
Object.assign(window, { __dateTimePickers: {
  configure: (next: Partial<Configuration>) => configure(next),
  changes: () => structuredClone(changes),
  controlledOpen: (open: boolean) => setControlledOpen(open),
  replaceDate: () => replaceDate(),
} });
