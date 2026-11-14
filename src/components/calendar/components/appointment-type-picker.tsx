import { CalendarPopover as Popover } from './calendar-surfaces';
import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { IconArrowLeft, IconCheck, IconChevronDown, IconPlus, IconSearch } from './calendar-icons';
import { appointmentTypes, type AppointmentTypeOption } from '../models/appointment-types';
import { useListChrome } from '../hooks/use-list-chrome';
import '../styles/appointment-type-picker.css';

const nested = { 'data-mantine-stop-propagation': true };
interface Props { value: string | null; customLabel: string; options?: readonly AppointmentTypeOption[]; onChange(id: string, customLabel: string): void }
export function AppointmentTypePicker({ value, customLabel, options = appointmentTypes, onChange }: Props) {
  const [opened, setOpened] = useState(false), [query, setQuery] = useState(''), [other, setOther] = useState(false), [label, setLabel] = useState('');
  const id = useId(), chrome = useListChrome(`${opened}/${other}/${query}/${options.map(type => type.id).join(',')}`, opened);
  const found = options.filter(type => `${type.label} ${type.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = options.find(type => type.id === value);
  function open(next: boolean) { if (next) { setQuery(''); setOther(false); setLabel(customLabel); } setOpened(next); }
  function applyOther() { if (label.trim()) { onChange('other', label.trim()); setOpened(false); } }
  function keyboard(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpened(false); return; }
    if ((event.target as HTMLElement).tagName === 'INPUT' && event.key === 'Enter') { event.preventDefault(); if (other) applyOther(); return; }
    if (other || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if ((event.target as HTMLElement).tagName === 'INPUT' && ['Home', 'End'].includes(event.key)) return;
    const rows = Array.from(chrome.ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!rows.length) return;
    event.preventDefault(); const index = rows.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index < 0 ? event.key === 'ArrowUp' ? rows.length - 1 : 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[next]!.focus(); rows[next]!.scrollIntoView({ block: 'nearest' });
  }
  return <Popover opened={opened} onChange={open} width="var(--calendar-size-286)" position="bottom-start" offset={5} withinPortal withRoles={false} trapFocus returnFocus closeOnEscape={false}>
    <Popover.Target><button type="button" aria-label="Appointment type" aria-haspopup="dialog" aria-controls={opened ? id : undefined} aria-expanded={opened} onClick={() => open(!opened)} className="appointment-type-trigger"><span>{value === 'other' ? customLabel || 'Other appointment' : selected?.label ?? 'Choose appointment type'}</span>{value === 'other' && <small>Other</small>}<IconChevronDown size="var(--calendar-size-11)" aria-hidden="true" /></button></Popover.Target>
    <Popover.Dropdown {...nested} id={id} role="dialog" aria-label="Choose appointment type" tabIndex={-1} className="practice-scope-popover appointment-type-popup" onKeyDownCapture={keyboard}>
      {other ? <>
        <div className="appointment-type-head"><button {...nested} type="button" aria-label="Back to appointment types" onClick={() => setOther(false)}><IconArrowLeft size="var(--calendar-size-14)" /></button><b>Other appointment type</b></div>
        <div className="appointment-type-other"><label>What kind of appointment?<input {...nested} aria-label="Custom appointment type" autoFocus value={label} maxLength={80} placeholder="e.g. Family care meeting" onChange={event => setLabel(event.currentTarget.value)} /></label><p>This label also helps create the automatic title.</p></div>
        <div className="appointment-type-foot"><button {...nested} type="button" className="is-quiet" onClick={() => setOpened(false)}>Cancel</button><button {...nested} type="button" disabled={!label.trim()} onClick={applyOther}>Use type</button></div>
      </> : <>
        <div className="appointment-type-head"><b>Appointment type</b><small>Choose one</small></div>
        <div className="appointment-type-search"><IconSearch size="var(--calendar-size-12)" /><input {...nested} aria-label="Search appointment types" placeholder="Find a type…" data-autofocus value={query} onChange={event => setQuery(event.currentTarget.value)} /></div>
        <div ref={chrome.ref} role="listbox" aria-label="Appointment types" className="practice-scroll-list appointment-type-results" {...chrome.handlers} style={{ '--fade-top': chrome.edges.top ? 'var(--calendar-size-8)' : '0px', '--fade-bottom': chrome.edges.bottom ? 'var(--calendar-size-8)' : '0px' } as CSSProperties}>
          {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
          {found.map(type => <button {...nested} key={type.id} type="button" role="option" aria-label={type.label} aria-selected={value === type.id} data-list-item className="appointment-type-option" onClick={() => { onChange(type.id, ''); setOpened(false); }}><i style={{ '--type-color': `var(--calendar-color-${type.color ?? 'blue'}-5)` } as CSSProperties} /><span><b>{type.label}</b>{type.description && <small>{type.description}</small>}</span>{value === type.id && <IconCheck size="var(--calendar-size-12)" />}</button>)}
          {!found.length && <div className="appointment-type-empty">No matching types.<small>You can describe something different below.</small></div>}
        </div>
        <button {...nested} type="button" className="appointment-type-add-other" onClick={() => { setLabel(value === 'other' ? customLabel : query); setOther(true); }}><IconPlus size="var(--calendar-size-13)" />Other…{value === 'other' && <IconCheck size="var(--calendar-size-12)" />}</button>
      </>}
    </Popover.Dropdown>
  </Popover>;
}
