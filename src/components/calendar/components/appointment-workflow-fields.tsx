import { CalendarTooltip as Tooltip } from './calendar-tooltip';
/** Composable calendar AppointmentWorkflowFields; presentation only. */
import { useState } from 'react';
import { Text } from './calendar-ui';
import { CalendarSelect as Select } from './calendar-select';
import { changeVisit, isEnded, progressLabel, statusOptions, visitOf, visitStages } from '../models/appointment-presentation';
import { appointmentStatusRequest, type AppointmentStatusChangeRequest } from '../models/appointment-status-change';
import type { EventDraft } from '../types';
import '../styles/appointment-presentation.css';
const nested = { 'data-mantine-stop-propagation': true };
export function AppointmentWorkflowFields({ event, clinical, onChange, onStatusChangeRequested }: { event: EventDraft; clinical: boolean; onChange(change: Partial<EventDraft>): void; onStatusChangeRequested?(request: AppointmentStatusChangeRequest): void }) {
  const visit = visitOf(event), ended = isEnded(event.status);
  const [expanded, setExpanded] = useState<string | null>(null);
  const dropdown = (key: string) => ({ onDropdownOpen: () => setExpanded(key), onDropdownClose: () => setExpanded(current => current === key ? null : current), 'data-mantine-stop-propagation': expanded === key ? 'true' : undefined });
  return <div className="appointment-workflow-fields">
    {clinical && <div className="appointment-progress-steps" aria-label={`Visit progress: ${progressLabel(event)}`}>{visitStages.map((stage, index) => <Tooltip key={stage.value} label={stage.label}><span className={!ended && index <= visitStages.findIndex(item => item.value === visit.stage) ? 'is-reached' : ''}><i /><small>{stage.short}</small></span></Tooltip>)}</div>}
    <div className="appointment-workflow-inputs">
      <Select {...dropdown('status')} size="xs" label="Confirmation / outcome" aria-label="Status" value={event.status} data={[...statusOptions]} allowDeselect={false} comboboxProps={{ withinPortal: false }} onChange={value => { if (!value) return; const request = appointmentStatusRequest(event, value as EventDraft['status']); if (request) { if (onStatusChangeRequested) onStatusChangeRequested(request); else onChange(request.change); } }} />
      {clinical && <Select {...dropdown('progress')} size="xs" label="Visit progress" aria-label="Visit progress" value={visit.stage} data={visitStages.map(({ value, label }) => ({ value, label }))} allowDeselect={false} disabled={ended} comboboxProps={{ withinPortal: false }} onChange={value => { if (value) onChange({ visit: changeVisit(event, value as typeof visit.stage) }); }} />}
    </div>
    {clinical && visit.stage === 'waiting' && !ended && <Select {...dropdown('room')} size="xs" label="Waiting room" value={visit.waitingRoom} allowDeselect={false} comboboxProps={{ withinPortal: false }} data={[{ value: 'none', label: 'No specific lobby' }, ...(event.location === 'In-person' ? [{ value: 'office', label: 'Office lobby' }] : event.location === 'Telehealth' ? [{ value: 'virtual', label: 'Virtual lobby' }] : [])]} onChange={value => { if (value) onChange({ visit: { ...visit, waitingRoom: value as typeof visit.waitingRoom } }); }} />}
    {clinical && visit.arrivedAt !== null && <Text size="xs" c="dimmed">Checked in at {new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(visit.arrivedAt)} · explicitly set in this preview</Text>}
  </div>;
}
