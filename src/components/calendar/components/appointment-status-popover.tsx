import { CalendarTooltip as Tooltip } from './calendar-tooltip';
/** Composable calendar AppointmentStatusPopover; presentation only. */
import { useId, useState } from 'react';
import { Badge, Button, Group } from './calendar-ui';
import { CalendarPopover as Popover } from './calendar-surfaces';
import { IconAlertTriangle } from './calendar-icons';
import { attentionLabel, isEnded, progressLabel, statusLabel, visitOf } from '../models/appointment-presentation';
import { AppointmentWorkflowFields } from './appointment-workflow-fields';
import { VisitIcon } from './appointment-visit-icon';
import type { EventDraft } from '../types';
import '../styles/appointment-presentation.css';
const nested = { 'data-mantine-stop-propagation': true };
export function AppointmentStatusPopover({ event, clinical, onChange, onDetails }: { event: EventDraft; clinical: boolean; onChange?(change: Partial<EventDraft>): void; onDetails?(): void }) {
  const [opened, setOpened] = useState(false), id = useId();
  const attention = attentionLabel(event), label = `${progressLabel(event, clinical)}${attention ? ` · ${attention}` : ''}`;
  return <Popover opened={opened} onChange={setOpened} width="var(--calendar-size-298)" position="bottom-end" withinPortal trapFocus returnFocus withRoles={false} closeOnEscape={false}>
    <Popover.Target><Tooltip label={label} events={{ hover: true, focus: true, touch: false }} withArrow><button type="button" className={`appointment-status-trigger ${attention ? 'has-attention' : ''}`} aria-label={`Appointment status: ${label}`} aria-haspopup="dialog" aria-controls={opened ? id : undefined} aria-expanded={opened} onClick={e => { e.stopPropagation(); setOpened(value => !value); }} onDoubleClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape' && opened) { e.preventDefault(); e.stopPropagation(); setOpened(false); } }}>{attention ? <IconAlertTriangle size="var(--calendar-size-13)" aria-hidden="true" /> : <VisitIcon event={event} clinical={clinical} />}</button></Tooltip></Popover.Target>
    <Popover.Dropdown {...nested} id={id} role="dialog" aria-label="Appointment status details" className="appointment-signal-popup" onClick={event => event.stopPropagation()} onKeyDownCapture={e => { const target = e.target as HTMLElement; if (e.key === 'Escape' && target.hasAttribute('data-expanded') && target.getAttribute('aria-haspopup') === 'listbox') return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpened(false); } }}>
      <div className="appointment-signal-head"><small>Visit at a glance</small><b>{event.title}</b><Group gap="var(--calendar-size-5)" mt="var(--calendar-size-5)"><Badge size="xs" variant="light">{statusLabel(event.status)}</Badge>{clinical && visitOf(event).stage !== 'scheduled' && !isEnded(event.status) && <Badge size="xs" color="gray" variant="light">{progressLabel(event)}</Badge>}</Group></div>
      {attention && <div className="appointment-attention-note"><IconAlertTriangle size="var(--calendar-size-13)" aria-hidden="true" /><span>{attention}</span></div>}
      {onChange && <div className="appointment-signal-body"><AppointmentWorkflowFields event={event} clinical={clinical} onChange={change => { if (change.status === 'cancelled') setOpened(false); onChange(change); }} /></div>}
      <div className="appointment-signal-foot"><span>Local preview · no notifications sent</span>{onDetails && <Button size="compact-xs" variant="subtle" onClick={() => { setOpened(false); onDetails(); }}>Details</Button>}</div>
    </Popover.Dropdown>
  </Popover>;
}
