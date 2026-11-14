import { CalendarTooltip as Tooltip } from './calendar-tooltip';
/** Composable calendar AppointmentAppearancePicker; presentation only. */
import { useId, useState, type CSSProperties } from 'react';
import { CalendarPopover as Popover } from './calendar-surfaces';
import { IconAlertTriangle } from './calendar-icons';
import { CheckIcon } from './prototype-icons';
import { appearanceOf, appointmentColors, attentionLabel, attentionReasons } from '../models/appointment-presentation';
import { useListChrome } from '../hooks/use-list-chrome';
import type { EventDraft } from '../types';
import '../styles/appointment-presentation.css';
const nested = { 'data-mantine-stop-propagation': true };
export function AppointmentAppearancePicker({ event, onChange, colorBy, effectiveColor = 'blue', onOpenChange }: { event: EventDraft; colorBy: string; effectiveColor?: string; onChange(change: Partial<EventDraft>): void; onOpenChange?(opened: boolean): void }) {
  const [opened, setOpened] = useState(false), id = useId();
  const current = appearanceOf(event), chrome = useListChrome(`appearance/${opened}`, opened);
  function open(value: boolean) { setOpened(value); onOpenChange?.(value); }
  return <Popover opened={opened} onChange={open} width="var(--calendar-size-280)" position="bottom-start" withinPortal withRoles={false} returnFocus trapFocus closeOnEscape={false}>
    <Popover.Target><button type="button" className="appointment-appearance-trigger" aria-label="Appointment appearance" aria-expanded={opened} aria-haspopup="dialog" aria-controls={opened ? id : undefined} onClick={() => open(!opened)}><i style={{ background: `var(--calendar-color-${current.color === 'automatic' ? effectiveColor : current.color}-5)` }} /><span>{current.color === 'automatic' ? `Color by ${colorBy}` : `${current.color[0]!.toUpperCase()}${current.color.slice(1)} appointment`}</span>{attentionLabel(event) ? <><IconAlertTriangle size="var(--calendar-size-12)" />{attentionLabel(event)}</> : <small>Appearance</small>}</button></Popover.Target>
    <Popover.Dropdown {...nested} id={id} role="dialog" aria-label="Appointment appearance options" className="appointment-signal-popup" onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); open(false); } }}>
      <div className="appointment-signal-head"><b>Appointment appearance</b><small>Same color, clearer meaning</small></div>
      <div className="appointment-color-swatches" role="group" aria-label="Appointment color">{appointmentColors.map(color => <Tooltip key={color} label={color === 'automatic' ? `Automatic · by ${colorBy}` : color}><button {...nested} type="button" aria-label={`Color ${color}`} aria-pressed={current.color === color} className={color === 'automatic' ? 'is-automatic' : ''} style={{ '--swatch-color': `var(--calendar-color-${color === 'automatic' ? 'blue' : color}-5)` } as CSSProperties} onClick={() => onChange({ appearance: { ...current, color } })}>{current.color === color && <CheckIcon size="var(--calendar-size-12)" />}</button></Tooltip>)}</div>
      <div className="appointment-signal-caption">Attention level</div>
      <div ref={chrome.ref} className="practice-scroll-list appointment-attention-list" {...chrome.handlers} role="group" aria-label="Attention level" style={{ '--fade-top': chrome.edges.top ? 'var(--calendar-size-8)' : '0px', '--fade-bottom': chrome.edges.bottom ? 'var(--calendar-size-8)' : '0px' } as CSSProperties}>
        {chrome.highlight && <span className="practice-list-highlight" aria-hidden="true" style={{ height: chrome.highlight.height, transform: `translateY(${chrome.highlight.top}px)` }} />}
        {attentionReasons.map(reason => <button {...nested} type="button" key={reason.value} data-list-item aria-pressed={current.attention === reason.value} onClick={() => onChange({ appearance: { ...current, attention: reason.value } })}><span>{reason.value === 'none' ? <CheckIcon size="var(--calendar-size-13)" /> : <IconAlertTriangle size="var(--calendar-size-13)" aria-hidden="true" />}</span><span><b>{reason.label}</b><small>{reason.hint}</small></span>{current.attention === reason.value && <CheckIcon size="var(--calendar-size-12)" />}</button>)}
      </div>
      <div className="appointment-signal-foot">Attention adds a stronger tint and an icon, not a different category color.</div>
    </Popover.Dropdown>
  </Popover>;
}
