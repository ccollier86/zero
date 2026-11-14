import { CalendarModal as Modal } from './calendar-surfaces';
/** Explicit, reversible demo cancellation; never contacts users or removes backend records. */
import { Button, Group, Stack, Text, Textarea } from './calendar-ui';
import { useState } from 'react';
import { CalendarManagedForm, CalendarDismiss } from './calendar-surfaces';
import type { ScheduleEvent } from '../types';
export function CancelEventDialog({ event, onClose, onConfirm, requireReason = true }: { event: ScheduleEvent; onClose(): void; onConfirm(reason: string): void; requireReason?: boolean }) {
  const block = event.kind === 'block';
  const [reason, setReason] = useState('');
  const disabled = !block && requireReason && !reason.trim();
  return <Modal opened onClose={onClose} title={block ? 'Remove this time block?' : 'Cancel this appointment?'} size="var(--calendar-size-420)" radius="lg">
    <CalendarManagedForm className="calendar-cancel-form" onAccept={() => { if (disabled) return false; onConfirm(reason.trim()); return true; }}><Stack><Text size="sm">{event.title}</Text><Text size="sm" c="dimmed">This only changes the local demo. No notifications will be sent. You can restore the event from its menu.</Text>{!block && <Textarea label="Reason for cancellation" required={requireReason} maxLength={500} value={reason} onChange={e => setReason(e.currentTarget.value)} placeholder="Why is this appointment being cancelled?" minRows={2} data-autofocus />}<Group justify="flex-end"><CalendarDismiss><Button variant="default">Keep {block ? 'time block' : 'appointment'}</Button></CalendarDismiss><Button color="red" type="submit" disabled={disabled}>{block ? 'Remove time block' : 'Cancel appointment'}</Button></Group></Stack></CalendarManagedForm>
  </Modal>;
}
