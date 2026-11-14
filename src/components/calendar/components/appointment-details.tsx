import { CalendarModal as Modal } from './calendar-surfaces';
/** Readable local event details, kept distinct from editing and context-menu actions. */
import { Badge, Button, Group, Stack, Text } from './calendar-ui';
import { formatDay, formatMinute } from '../models/calendar-model';
import type { CalendarResource, EventDraft, ScheduleEvent } from '../types';
import { attendeeKey, attendeeTypeLabel } from '../models/attendee-model';
import { repeatSummary } from '../models/recurrence-model';
import { appointmentTypes } from '../models/appointment-types';
import { AppointmentAppearancePicker, AppointmentWorkflowFields } from './appointment-controls';
import { eventColor, progressLabel, statusLabel } from '../models/appointment-presentation';
import { useState } from 'react';
export function AppointmentDetails({ event, resource, onClose, onEdit, clinical = true, colorBy = 'calendar', onChange, siteLabel, trigger, notice }: { siteLabel?: string; trigger?: HTMLElement | null; notice?: string; event: ScheduleEvent; resource?: CalendarResource; onClose(): void; onEdit(): void; clinical?: boolean; colorBy?: string; onChange?(change: Partial<EventDraft>): void }) {
  const [appearanceOpened, setAppearanceOpened] = useState(false);
  return <Modal opened trigger={trigger} onClose={onClose} closeOnEscape={!appearanceOpened} title={event.kind === 'block' ? 'Time block details' : 'Appointment details'} size="var(--calendar-size-440)" radius="lg" padding="lg">
    <Stack gap="md">
      <div><Group gap="var(--calendar-size-5)" mb="xs"><Badge variant="light" color={event.status === 'cancelled' ? 'gray' : 'blue'}>{statusLabel(event.status)}</Badge>{clinical && progressLabel(event) !== statusLabel(event.status) && <Badge variant="light" color="gray">{progressLabel(event)}</Badge>}</Group><Text fw="var(--calendar-weight-heading)" size="lg">{event.title}</Text></div>
      {event.kind === 'appointment' && onChange && <><AppointmentAppearancePicker event={event} colorBy={colorBy} effectiveColor={eventColor(event, resource, colorBy === 'type' ? 'type' : 'calendar')} onChange={onChange} onOpenChange={setAppearanceOpened} /><div className="appointment-editor-workflow"><AppointmentWorkflowFields event={event} clinical={clinical} onChange={onChange} /></div></>}
      <div><Text size="xs" c="dimmed">Calendar / provider</Text><Text size="sm">{resource?.name ?? 'Unknown calendar'}</Text></div>
      <div><Text size="xs" c="dimmed">When</Text><Text size="sm">{formatDay(event.date)}</Text><Text size="sm">{formatMinute(event.start)} – {formatMinute(event.end)}</Text></div>
      {event.recurrence && <div><Text size="xs" c="dimmed">Repeats</Text><Text size="sm">{repeatSummary(event.recurrence, event.date)}</Text><Text size="xs" c="dimmed">Preference only · recurring bookings are not generated in this preview</Text></div>}
      {event.kind === 'appointment' && <div><Text size="xs" c="dimmed">Appointment type</Text><Text size="sm">{event.visitType === 'other' ? event.customVisitType : appointmentTypes.find(type => type.id === event.visitType)?.label ?? 'Unassigned'}</Text></div>}
      {event.kind === 'appointment' && <><div><Text size="xs" c="dimmed">Office / location</Text><Text size="sm">{siteLabel ?? event.siteId ?? 'Unassigned'}</Text></div><div><Text size="xs" c="dimmed">Visit mode</Text><Text size="sm">{event.location}</Text></div></>}
      {event.kind === 'appointment' && <div><Text size="xs" c="dimmed">Invitees</Text>{event.attendees.length ? <Stack gap="var(--calendar-size-4)" mt="var(--calendar-size-4)">{event.attendees.map(person => <Group key={attendeeKey(person)} gap="var(--calendar-size-6)"><Text size="sm">{person.name}</Text><Badge size="xs" variant="light" color="gray">{attendeeTypeLabel(person.type)}</Badge>{person.type === 'other' && person.name !== person.address && <Text size="xs" c="dimmed">{person.address}</Text>}</Group>)}</Stack> : <Text size="sm" c="dimmed">No invitees added</Text>}</div>}
      {event.notes && <div><Text size="xs" c="dimmed">Notes</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{event.notes}</Text></div>}
      {event.status === 'cancelled' && event.cancellationReason && <div><Text size="xs" c="dimmed">Cancellation reason</Text><Text size="sm">{event.cancellationReason}</Text></div>}
      <Group justify="space-between"><Text size="xs" c="dimmed">{notice}</Text><Button onClick={onEdit}>Edit {event.kind === 'block' ? 'time block' : 'appointment'}</Button></Group>
    </Stack>
  </Modal>;
}
