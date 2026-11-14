import { CalendarPopover as Popover } from './calendar-surfaces';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { IconArrowLeft, IconCheck, IconChevronDown, IconMail, IconPhone, IconPlus, IconSearch, IconX } from './calendar-icons';
import { attendeeKey, attendeeTypeLabel, attendeeTypes, filterAttendees, manualAttendee, type AppointmentAttendee, type AttendeeType, type ContactMethod } from '../models/attendee-model';
import { useListChrome } from '../hooks/use-list-chrome';
import '../styles/attendee-picker.css';

export interface AttendeePickerProps { value: readonly AppointmentAttendee[]; directory?: readonly AppointmentAttendee[]; onChange(value: AppointmentAttendee[]): void }
const nestedControl = { 'data-mantine-stop-propagation': true };
const fadeStyle = (edges: { top: boolean; bottom: boolean }) => ({ '--fade-top': edges.top ? 'var(--calendar-size-8)' : '0px', '--fade-bottom': edges.bottom ? 'var(--calendar-size-8)' : '0px' } as CSSProperties);
function initials(name: string) { return name.trim().split(/\s+/).filter(word => !/^dr\.?$/i.test(word)).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }

export function AttendeePicker({ value, directory = [], onChange }: AttendeePickerProps) {
  const [opened, setOpened] = useState(false), [query, setQuery] = useState('');
  const [types, setTypes] = useState<AttendeeType[]>(['patient']);
  const [manual, setManual] = useState(false), [method, setMethod] = useState<ContactMethod>('email');
  const [name, setName] = useState(''), [address, setAddress] = useState(''), [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null), manualRef = useRef<HTMLInputElement>(null), triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId(), listId = `${id}-options`, errorId = `${id}-error`;
  const found = filterAttendees(directory, types, query);
  const chrome = useListChrome(`${opened}/${manual}/${query}/${types.join(',')}/${found.map(attendeeKey).join(',')}`, opened && !manual);
  const chips = useListChrome(value.map(attendeeKey).join(','));
  useEffect(() => {
    if (!opened) return;
    const frame = requestAnimationFrame(() => (manual ? manualRef : searchRef).current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [opened, manual, method]);
  function open(next: boolean) { if (next) { setQuery(''); setManual(false); setError(''); } setOpened(next); }
  function toggle(person: AppointmentAttendee) {
    const key = attendeeKey(person);
    onChange(value.some(item => attendeeKey(item) === key) ? value.filter(item => attendeeKey(item) !== key) : [...value, { ...person }]);
  }
  function addManual() {
    const result = manualAttendee(method, address, name);
    if (result.error) { setError(result.error); manualRef.current?.focus(); return; }
    if (!result.attendee) return;
    if (value.some(person => attendeeKey(person) === attendeeKey(result.attendee))) { setError('This guest is already added.'); return; }
    onChange([...value, result.attendee]); setName(''); setAddress(''); setError(''); setManual(false);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation(); setOpened(false); return;
    }
    if (event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const inSearch = target === searchRef.current, inRow = target.getAttribute('role') === 'option';
    if (manual) {
      if (event.key === 'Enter' && target.tagName === 'INPUT') { event.preventDefault(); addManual(); }
      return;
    }
    if (inSearch && event.key === 'Enter') { event.preventDefault(); return; }
    if (!(inSearch || inRow) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    // Home/End in the text field still move its caret; arrows enter the result list.
    if (inSearch && ['Home', 'End'].includes(event.key)) return;
    const rows = Array.from(chrome.ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!rows.length) { event.preventDefault(); return; }
    event.preventDefault();
    const index = rows.indexOf(target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index < 0 ? event.key === 'ArrowUp' ? rows.length - 1 : 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[next]!.focus(); rows[next]!.scrollIntoView({ block: 'nearest' });
  }
  return <div className="appointment-attendees" role="group" aria-label="Appointment invitees">
    {value.length > 0 && <div ref={chips.ref} role="list" aria-label="Selected invitees" className="practice-scroll-list appointment-attendee-chips" onScroll={chips.handlers.onScroll} style={fadeStyle(chips.edges)}>
      {value.map(person => <span role="listitem" key={attendeeKey(person)} className={`appointment-attendee-chip is-${person.type}`} title={`${person.name} · ${attendeeTypeLabel(person.type)}${person.type === 'other' ? ` · ${person.address}` : ''}`}>
        <span aria-hidden="true" className="appointment-chip-type">{person.type === 'other' ? person.method === 'email' ? <IconMail size="var(--calendar-size-10)" /> : <IconPhone size="var(--calendar-size-10)" /> : attendeeTypeLabel(person.type)[0]}</span>
        <span className="appointment-chip-name">{person.name}</span>
        <button type="button" aria-label={`Remove ${person.name}`} onClick={() => { onChange(value.filter(item => attendeeKey(item) !== attendeeKey(person))); triggerRef.current?.focus(); }}><IconX size="var(--calendar-size-11)" aria-hidden="true" /></button>
      </span>)}
    </div>}
    <Popover opened={opened} onChange={open} position="bottom-start" width="var(--calendar-size-292)" offset={5} radius="md" withinPortal withRoles={false} trapFocus returnFocus closeOnEscape={false}>
      <Popover.Target><button ref={triggerRef} type="button" className="appointment-attendee-trigger" aria-haspopup="dialog" aria-expanded={opened} aria-controls={opened ? `${id}-popup` : undefined} onClick={() => open(!opened)}>
        {value.length > 0 && <IconPlus size="var(--calendar-size-12)" aria-hidden="true" />}<span>{value.length ? 'Add another invitee' : 'Add attendees…'}</span><IconChevronDown size="var(--calendar-size-12)" aria-hidden="true" />
      </button></Popover.Target>
      <Popover.Dropdown {...nestedControl} id={`${id}-popup`} role="dialog" aria-label="Choose invitees" tabIndex={-1} className="practice-scope-popover appointment-attendee-popup" onKeyDownCapture={keyboard}>
        {!manual ? <>
          <div className="appointment-attendee-search"><IconSearch size="var(--calendar-size-13)" aria-hidden="true" /><input {...nestedControl} ref={searchRef} aria-label="Search invitees" placeholder="Search people…" value={query} onChange={event => setQuery(event.currentTarget.value)} data-autofocus maxLength={120} /><span>{value.length} added</span></div>
          <div className="appointment-attendee-types" role="group" aria-label="Search attendee types">
            {attendeeTypes.map(type => <label key={type.id}><input {...nestedControl} type="checkbox" checked={types.includes(type.id)} onChange={() => setTypes(current => current.includes(type.id) ? current.filter(item => item !== type.id) : [...current, type.id])} /><span>{type.label}</span></label>)}
          </div>
          <div ref={chrome.ref} id={listId} role="listbox" aria-label="Invitee results" aria-multiselectable="true" className="practice-scroll-list appointment-attendee-results" {...chrome.handlers} style={fadeStyle(chrome.edges)}>
            {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
            {found.map(person => { const selected = value.some(item => attendeeKey(item) === attendeeKey(person)); return <button {...nestedControl} type="button" key={attendeeKey(person)} role="option" aria-label={`${person.name}, ${attendeeTypeLabel(person.type)}`} aria-selected={selected} data-list-item className="appointment-attendee-option" onClick={() => toggle(person)}>
              <span className={`appointment-attendee-avatar is-${person.type}`} aria-hidden="true">{initials(person.name)}</span><span className="appointment-attendee-copy"><b>{person.name}</b><small>{attendeeTypeLabel(person.type)}{'hint' in person && person.hint && person.hint !== 'Patient directory' ? ` · ${person.hint}` : ''}</small></span><span className={`practice-option-check ${selected ? 'is-checked' : ''}`} aria-hidden="true">{selected && <IconCheck size="var(--calendar-size-10)" />}</span>
            </button>; })}
            {!found.length && <div className="appointment-attendee-empty">{!types.length ? 'Choose a type above to search.' : types.every(type => type === 'other') ? 'Add a guest by email or phone below.' : query.trim() ? 'No matches in the selected types.' : 'No people in the selected types.'}</div>}
          </div>
          {types.includes('other') && <button {...nestedControl} type="button" className="appointment-attendee-manual-link" onClick={() => { setManual(true); setError(''); }}><IconPlus size="var(--calendar-size-12)" aria-hidden="true" /> Add by email or phone <span>Other</span></button>}
          <div className="appointment-attendee-footer"><span>Choose one or more people</span><button {...nestedControl} type="button" onClick={() => setOpened(false)}>Done</button></div>
        </> : <>
          <div className="appointment-manual-head"><button {...nestedControl} type="button" aria-label="Back to invitee search" onClick={() => { setManual(false); setError(''); }}><IconArrowLeft size="var(--calendar-size-14)" /></button><b>Add a guest</b><span>Other</span></div>
          <div className="appointment-manual-body">
            <div className="appointment-contact-method" role="group" aria-label="Guest contact method">{(['email', 'phone'] as const).map(item => <button {...nestedControl} type="button" key={item} aria-pressed={method === item} onClick={() => { if (method !== item) { setMethod(item); setAddress(''); setError(''); } }}>{item === 'email' ? <IconMail size="var(--calendar-size-12)" /> : <IconPhone size="var(--calendar-size-12)" />}{item === 'email' ? 'Email' : 'Phone'}</button>)}</div>
            <label>Name <span>(optional)</span><input {...nestedControl} aria-label="Guest name" value={name} maxLength={80} placeholder="Guest name" onChange={event => setName(event.currentTarget.value)} /></label>
            <label>{method === 'email' ? 'Email address' : 'Phone number'}<input {...nestedControl} ref={manualRef} aria-label={method === 'email' ? 'Guest email' : 'Guest phone'} type={method === 'email' ? 'email' : 'tel'} autoComplete="off" placeholder={method === 'email' ? 'name@example.com' : '+1 (555) 010-0123'} value={address} maxLength={254} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} onChange={event => { setAddress(event.currentTarget.value); setError(''); }} /></label>
            {error && <p id={errorId} role="alert" className="appointment-attendee-error">{error}</p>}
            <p className="appointment-attendee-note">Added to this preview only. No invitation is sent.{method === 'phone' ? ' US numbers default to +1.' : ''}</p>
          </div>
          <div className="appointment-attendee-footer"><button {...nestedControl} type="button" className="is-quiet" onClick={() => { setManual(false); setError(''); }}>Back</button><button {...nestedControl} type="button" onClick={addManual}>Add invitee</button></div>
        </>}
      </Popover.Dropdown>
    </Popover>
  </div>;
}
