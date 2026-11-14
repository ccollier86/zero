import { CalendarSelect as Select } from './calendar-select';
import { CalendarDateField } from './calendar-date-field';
import { CalendarPopover as Popover } from './calendar-surfaces';
import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { IconArrowLeft, IconCalendarRepeat, IconCheck, IconChevronDown, IconRepeat, IconSettings } from './calendar-icons';
import { dateKey, isDay, parseDay } from '../models/calendar-date';
import { cloneRepeat, defaultRepeat, ordinals, repeatError, repeatPresets, repeatPreview, repeatSummary, sameRepeat, weekdays, type RepeatFrequency, type RepeatRule } from '../models/recurrence-model';
import { useListChrome } from '../hooks/use-list-chrome';
import '../styles/repeat-picker.css';

const nested = { 'data-mantine-stop-propagation': true };
const units = [{ value: 'daily', label: 'days' }, { value: 'weekly', label: 'weeks' }, { value: 'monthly', label: 'months' }, { value: 'yearly', label: 'years' }];
const inputNumber = (value: number) => Number.isFinite(value) ? value : '';
const numeric = (value: string) => value === '' ? NaN : Number(value);
const selectStyle = { input: { minHeight: 'var(--calendar-size-27)', height: 'var(--calendar-size-27)', fontSize: 'var(--calendar-size-11)', borderColor: 'var(--calendar-color-gray-3)' }, option: { fontSize: 'var(--calendar-size-11)', minHeight: 'var(--calendar-size-27)', padding: 'var(--calendar-size-4) var(--calendar-size-7)' } };

interface Props { value: RepeatRule | null; start: string; onChange(rule: RepeatRule | null): void; onOpenChange?(opened: boolean): void }
export function RepeatPicker({ value, start, onChange, onOpenChange }: Props) {
  const [opened, setOpened] = useState(false), [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<RepeatRule>(() => cloneRepeat(value) ?? defaultRepeat('weekly', isDay(start) ? start : dateKey(new Date())));
  const id = useId(), invalid = repeatError(draft, start);
  const startCaption = isDay(start) ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(parseDay(start)) : 'Choose an appointment date';
  const chrome = useListChrome(`${opened}/${custom}/${draft.frequency}/${draft.end.kind}`, opened);
  const presets = repeatPresets(start);
  const summary = repeatSummary(value, start), activePreset = presets.find(item => sameRepeat(item.rule, value));
  const dates = repeatPreview(draft, start);
  function open(next: boolean) { if (next) { setCustom(false); setDraft(cloneRepeat(value) ?? defaultRepeat('weekly', start)); } setOpened(next); onOpenChange?.(next); }
  function close() { setOpened(false); onOpenChange?.(false); }
  function apply() { if (!invalid) { onChange(cloneRepeat(draft)); close(); } }
  function keyboard(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    // Let an expanded inner Select consume Escape before dismissing this popup.
    if (event.key === 'Escape' && target.hasAttribute('data-expanded') && target.getAttribute('aria-haspopup') === 'listbox') return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (custom && event.key === 'Enter' && target instanceof HTMLInputElement && !target.readOnly) { event.preventDefault(); event.stopPropagation(); if (['number', 'date'].includes(target.type)) apply(); return; }
    if (custom || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = Array.from(chrome.ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!rows.length) return;
    event.preventDefault(); const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[next]!.focus(); rows[next]!.scrollIntoView({ block: 'nearest' });
  }
  const endDefault = () => { const date = parseDay(start); date.setDate(date.getDate() + 90); return dateKey(date); };
  return <Popover opened={opened} onChange={open} position="bottom-start" width={custom ? 'var(--calendar-size-310)' : 'var(--calendar-size-286)'} offset={5} radius="md" withinPortal withRoles={false} trapFocus returnFocus closeOnEscape={false}>
    <Popover.Target><button type="button" aria-label="Recurrence" className={`appointment-repeat-trigger ${value ? 'has-repeat' : ''}`} aria-haspopup="dialog" aria-controls={opened ? id : undefined} aria-expanded={opened} disabled={!isDay(start)} title={summary} onClick={() => open(!opened)}><span>{summary}</span><IconChevronDown size="var(--calendar-size-11)" aria-hidden="true" /></button></Popover.Target>
    <Popover.Dropdown {...nested} id={id} role="dialog" aria-label="Repeat appointment" tabIndex={-1} className="practice-scope-popover appointment-repeat-popup" onKeyDownCapture={keyboard}>
      <div className="appointment-repeat-head">{custom ? <button {...nested} type="button" aria-label="Back to repeat presets" onClick={() => setCustom(false)}><IconArrowLeft size="var(--calendar-size-14)" /></button> : <span className="appointment-repeat-head-icon"><IconRepeat size="var(--calendar-size-14)" /></span>}<div><b>{custom ? 'Custom repeat' : 'Repeat appointment'}</b><small>Starts {startCaption}</small></div></div>
      <div ref={chrome.ref} className={`practice-scroll-list appointment-repeat-body ${custom ? 'is-custom' : ''}`} {...chrome.handlers} style={{ '--fade-top': chrome.edges.top ? 'var(--calendar-size-8)' : '0px', '--fade-bottom': chrome.edges.bottom ? 'var(--calendar-size-8)' : '0px' } as CSSProperties}>
        {!custom ? <div role="listbox" aria-label="Repeat presets">
          {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
          {presets.map(item => <button {...nested} key={item.id} type="button" role="option" aria-label={item.label} aria-selected={item.id === activePreset?.id} data-list-item className="appointment-repeat-option" onClick={() => { onChange(cloneRepeat(item.rule)); close(); }}><span>{item.label}</span>{item.id === activePreset?.id && <IconCheck size="var(--calendar-size-12)" />}</button>)}
          <button {...nested} type="button" role="option" aria-label="Custom repeat" aria-selected={!activePreset} data-list-item className="appointment-repeat-option is-custom-choice" onClick={() => setCustom(true)}><IconSettings size="var(--calendar-size-13)" /><span>Custom repeat…</span>{!activePreset && <IconCheck size="var(--calendar-size-12)" />}</button>
        </div> : <div className="appointment-repeat-custom">
          <div className="appointment-repeat-every"><label htmlFor={`${id}-interval`}>Every</label><input {...nested} id={`${id}-interval`} aria-label="Repeat interval" type="number" min={1} max={99} step={1} value={inputNumber(draft.interval)} onChange={event => { const interval = numeric(event.currentTarget.value); setDraft(current => ({ ...current, interval })); }} /><Select {...nested} aria-label="Repeat frequency" allowDeselect={false} value={draft.frequency} onChange={frequency => { if (frequency) setDraft(current => defaultRepeat(frequency as RepeatFrequency, start, current.interval, current.end)); }} data={units} w="var(--calendar-size-104)" size="xs" styles={selectStyle} comboboxProps={{ withinPortal: false, offset: 3 }} /></div>
          {draft.frequency === 'weekly' && <div className="appointment-repeat-week"><div className="appointment-repeat-label">Repeat on<button {...nested} type="button" onClick={() => setDraft(current => current.frequency === 'weekly' ? { ...current, weekdays: [1, 2, 3, 4, 5] } : current)}>Weekdays</button></div><div role="group" aria-label="Repeat days" className="appointment-repeat-days">{weekdays.map(day => <button {...nested} key={day.day} type="button" aria-label={day.name} aria-pressed={draft.weekdays.includes(day.day)} onClick={() => setDraft(current => current.frequency === 'weekly' ? { ...current, weekdays: current.weekdays.includes(day.day) ? current.weekdays.filter(value => value !== day.day) : [...current.weekdays, day.day] } : current)}>{day.short}</button>)}</div></div>}
          {draft.frequency === 'monthly' && <fieldset className="appointment-repeat-month"><legend>Repeat on</legend>
            <div className="appointment-repeat-choice"><label><input {...nested} type="radio" name={`${id}-month`} checked={draft.pattern.kind === 'day'} onChange={() => setDraft(current => current.frequency === 'monthly' ? { ...current, pattern: { kind: 'day', day: parseDay(start).getDate() } } : current)} />Day</label>{draft.pattern.kind === 'day' && <input {...nested} aria-label="Day of month" type="number" min={1} max={31} step={1} value={inputNumber(draft.pattern.day)} onChange={event => { const day = numeric(event.currentTarget.value); setDraft(current => current.frequency === 'monthly' ? { ...current, pattern: { kind: 'day', day } } : current); }} />}</div>
            <div className="appointment-repeat-choice"><label><input {...nested} type="radio" name={`${id}-month`} checked={draft.pattern.kind === 'weekday'} onChange={() => setDraft(current => current.frequency === 'monthly' ? { ...current, pattern: { kind: 'weekday', ordinal: Math.ceil(parseDay(start).getDate() / 7), weekday: parseDay(start).getDay() } } : current)} />The</label>{draft.pattern.kind === 'weekday' && <><Select {...nested} aria-label="Monthly week" value={String(draft.pattern.ordinal)} onChange={value => { if (value) setDraft(current => current.frequency === 'monthly' && current.pattern.kind === 'weekday' ? { ...current, pattern: { ...current.pattern, ordinal: Number(value) } } : current); }} data={ordinals.map(item => ({ value: String(item.value), label: item.label }))} allowDeselect={false} w="var(--calendar-size-78)" size="xs" styles={selectStyle} comboboxProps={{ withinPortal: false }} /><Select {...nested} aria-label="Monthly weekday" value={String(draft.pattern.weekday)} onChange={value => { if (value) setDraft(current => current.frequency === 'monthly' && current.pattern.kind === 'weekday' ? { ...current, pattern: { ...current.pattern, weekday: Number(value) } } : current); }} data={weekdays.map(day => ({ value: String(day.day), label: day.name }))} allowDeselect={false} w="var(--calendar-size-107)" size="xs" styles={selectStyle} comboboxProps={{ withinPortal: false }} /></>}</div>
          </fieldset>}
          {draft.frequency === 'yearly' && <p className="appointment-repeat-help">On {isDay(start) ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(parseDay(start)) : 'the appointment date'} each {draft.interval === 1 ? 'year' : `${draft.interval} years`}. February 29 repeats only in leap years.</p>}
          <fieldset className="appointment-repeat-end"><legend>Ends</legend>
            <div className="appointment-repeat-choice"><label><input {...nested} type="radio" name={`${id}-end`} checked={draft.end.kind === 'never'} onChange={() => setDraft(current => ({ ...current, end: { kind: 'never' } }))} />Never</label></div>
            <div className="appointment-repeat-choice"><label><input {...nested} type="radio" name={`${id}-end`} checked={draft.end.kind === 'on'} onChange={() => setDraft(current => ({ ...current, end: { kind: 'on', date: endDefault() } }))} />On date</label>{draft.end.kind === 'on' && <CalendarDateField label="Repeat until" min={start} value={draft.end.date} onChange={date => setDraft(current => ({ ...current, end: { kind: 'on', date } }))} />}</div>
            <div className="appointment-repeat-choice"><label><input {...nested} type="radio" name={`${id}-end`} checked={draft.end.kind === 'after'} onChange={() => setDraft(current => ({ ...current, end: { kind: 'after', count: 10 } }))} />After</label>{draft.end.kind === 'after' && <><input {...nested} aria-label="Repeat count" type="number" min={1} max={999} step={1} value={inputNumber(draft.end.count)} onChange={event => { const count = numeric(event.currentTarget.value); setDraft(current => ({ ...current, end: { kind: 'after', count } })); }} /><span>occurrences</span></>}</div>
          </fieldset>
          {invalid ? <p className="appointment-repeat-error" role="alert">{invalid}</p> : <div className="appointment-repeat-preview" aria-live="polite"><div><IconCalendarRepeat size="var(--calendar-size-13)" /><b>{repeatSummary(draft, start)}</b></div><small>First + next dates</small><div className="appointment-repeat-date-chips">{dates.map((date, index) => <span key={date} title={date}>{index === 0 && <i />}{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parseDay(date))}</span>)}</div></div>}
          <p className="appointment-repeat-help">The first appointment stays on its selected date. Counts include it. Missing month days are skipped, not moved.</p>
        </div>}
      </div>
      {custom && <div className="appointment-repeat-foot"><button {...nested} type="button" className="is-quiet" onClick={close}>Cancel</button><button {...nested} type="button" disabled={!!invalid} onClick={apply}>Apply repeat</button></div>}
    </Popover.Dropdown>
  </Popover>;
}
