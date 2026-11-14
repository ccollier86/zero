import { CalendarPopover as Popover } from './calendar-surfaces';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { IconCheck, IconChevronDown } from './calendar-icons';
import { formatMinute } from '../models/calendar-model';
import { parseTimeEntry } from '../models/time-model';
import { useListChrome } from '../hooks/use-list-chrome';
import '../styles/time-picker.css';

interface Props { label: 'Start time' | 'End time'; value: number; options: readonly number[]; onChange(minute: number): void; onCommit?(minute: number): void }
export function TimePicker({ label, value, options, onChange, onCommit }: Props) {
  const [text, setText] = useState(() => Number.isFinite(value) ? formatMinute(value) : '');
  const [opened, setOpened] = useState(false), [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null), root = useRef<HTMLDivElement>(null), lastSent = useRef(value);
  const id = useId(), chrome = useListChrome(`${opened}/${options.join(',')}`, opened);
  const valid = Number.isFinite(parseTimeEntry(text));
  useEffect(() => {
    if (!Object.is(lastSent.current, value)) setText(Number.isFinite(value) ? formatMinute(value) : '');
    lastSent.current = value;
  }, [value]);
  useEffect(() => {
    if (!opened) return;
    const blur = (event: FocusEvent) => { const target = event.target as Node; if (!root.current?.contains(target) && !chrome.ref.current?.closest('.appointment-time-popup')?.contains(target)) setOpened(false); };
    document.addEventListener('focusin', blur);
    const frame = requestAnimationFrame(() => {
      const rows = Array.from(chrome.ref.current?.querySelectorAll<HTMLButtonElement>('[data-minute]') ?? []);
      const row = rows.find(item => Number(item.dataset.minute) >= value) ?? rows.at(-1);
      row?.scrollIntoView({ block: 'nearest' });
    });
    return () => { document.removeEventListener('focusin', blur); cancelAnimationFrame(frame); };
  }, [opened]);
  function commit() {
    setTouched(true); const parsed = parseTimeEntry(text);
    if (Number.isFinite(parsed)) { setText(formatMinute(parsed)); onCommit?.(parsed); }
  }
  function choose(minute: number) {
    lastSent.current = minute; setText(formatMinute(minute)); onChange(minute); onCommit?.(minute); setTouched(false); setOpened(false); input.current?.focus();
  }
  function keyboard(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); setOpened(false); input.current?.focus(); return; }
    if (event.target === input.current && event.key === 'Enter') { event.preventDefault(); commit(); setOpened(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const inInput = event.target === input.current;
    if (inInput && ['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!opened) { setOpened(true); return; }
    const rows = Array.from(chrome.ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!rows.length) return;
    const index = rows.indexOf(event.target as HTMLButtonElement);
    const selected = rows.findIndex(row => Number(row.dataset.minute) >= value);
    const next = inInput ? selected < 0 ? rows.length - 1 : selected : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[next]!.focus(); rows[next]!.scrollIntoView({ block: 'nearest' });
  }
  return <Popover opened={opened} onChange={setOpened} position="bottom-start" width="var(--calendar-size-174)" offset={4} withinPortal withRoles={false} closeOnEscape={false}>
    <Popover.Anchor><div ref={root} className={`appointment-time-field ${touched && !valid ? 'is-invalid' : ''}`} onKeyDown={keyboard}>
      <input ref={input} type="text" role="combobox" aria-label={label} aria-autocomplete="none" aria-haspopup="listbox" aria-controls={opened ? id : undefined} aria-expanded={opened} aria-invalid={touched && !valid} data-mantine-stop-propagation={opened ? 'true' : undefined} value={text} maxLength={12} autoComplete="off" spellCheck={false}
        onClick={() => setOpened(true)} onBlur={commit} onChange={event => { const raw = event.currentTarget.value, parsed = parseTimeEntry(raw); setText(raw); lastSent.current = parsed; onChange(parsed); }} />
      <button type="button" aria-label={`Show ${label.toLowerCase()} options`} data-mantine-stop-propagation={opened ? 'true' : undefined} aria-expanded={opened} onClick={() => { setOpened(current => !current); input.current?.focus(); }}><IconChevronDown size="var(--calendar-size-11)" /></button>
    </div></Popover.Anchor>
    <Popover.Dropdown className="practice-scope-popover appointment-time-popup" onOpenAutoFocus={event => event.preventDefault()} onKeyDownCapture={keyboard}>
      <div className="appointment-time-hint">Quick times<span>Or type any minute</span></div>
      <div ref={chrome.ref} id={id} role="listbox" aria-label={`${label} quick picks`} className="practice-scroll-list appointment-time-options" {...chrome.handlers} style={{ '--fade-top': chrome.edges.top ? 'var(--calendar-size-8)' : '0px', '--fade-bottom': chrome.edges.bottom ? 'var(--calendar-size-8)' : '0px' } as CSSProperties}>
        {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
        {options.map(minute => <button key={minute} type="button" role="option" aria-label={formatMinute(minute)} aria-selected={minute === value} data-minute={minute} data-list-item data-mantine-stop-propagation="true" className="appointment-time-option" onClick={() => choose(minute)}>{formatMinute(minute)}{minute === value && <IconCheck size="var(--calendar-size-12)" />}</button>)}
        {!options.length && <p className="appointment-time-empty">No later quick picks.<br />You can type an exact time.</p>}
      </div>
    </Popover.Dropdown>
  </Popover>;
}
