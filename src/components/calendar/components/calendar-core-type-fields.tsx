'use client';
/** Native bounded selector over current all-resource type choices. No client copy of resource policy. */
import type { CalendarAppointmentTypePage, CalendarAppointmentTypeSnapshot } from '../../../calendar/contracts';
import type { CalendarCoreDraft } from '../models/calendar-workspace-model';
import { calendarCoreTypeSelection, calendarCoreTypeSnapshot, calendarCoreTypeVersion } from '../models/calendar-core-type-model';
import { CalendarSelect } from './calendar-select';
import { Button, Group, Stack, Text } from './calendar-ui';

export interface CalendarCoreTypeFieldsProps {
  readonly value: Pick<CalendarCoreDraft, 'appointmentType'>;
  readonly types: CalendarAppointmentTypePage | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly acceptedType?: CalendarAppointmentTypeSnapshot;
  readonly disabled?: boolean;
  readonly canGoBack?: boolean;
  onChange(type: CalendarAppointmentTypeSnapshot | null): void;
  onRetry?(): void;
  onPrevious?(): void;
  onNext?(): void;
}
const UNTYPED = 'calendar-core:untyped';
export function CalendarCoreTypeFields(props: CalendarCoreTypeFieldsProps) {
  const selection = calendarCoreTypeSelection(props.value, props.types, props.acceptedType), ready = props.status === 'ready';
  const options = [{ value: UNTYPED, label: props.acceptedType ? 'No type · explicitly clear binding' : 'No type' },
    ...(ready ? props.types?.items ?? [] : []).filter(type => type.active).map(type => ({ value: calendarCoreTypeVersion(type), label: type.label }))];
  if (ready && selection.snapshot && selection.accepted && !options.some(item => item.value === calendarCoreTypeVersion(selection.snapshot!))) {
    options.push({ value: calendarCoreTypeVersion(selection.snapshot), label: `${selection.snapshot.label} · accepted version` });
  }
  const selected = selection.snapshot && selection.current ? calendarCoreTypeVersion(selection.snapshot) : selection.current ? UNTYPED : null;
  return <Stack gap="xs">
    {ready && <CalendarSelect aria-label="Appointment type" label="Appointment type" placeholder="Choose a current type" searchable
      value={selected} disabled={props.disabled} data={options} onChange={value => {
        if (value === UNTYPED) { props.onChange(null); return; }
        const type = props.types?.items.find(item => item.active && calendarCoreTypeVersion(item) === value);
        if (type) props.onChange(calendarCoreTypeSnapshot(type));
        else if (selection.accepted && selection.snapshot && calendarCoreTypeVersion(selection.snapshot) === value) props.onChange(calendarCoreTypeSnapshot(selection.snapshot));
      }} />}
    {ready && selection.snapshot && <Text size="xs" c="dimmed">{selection.snapshot.durationMinutes} minutes · {selection.snapshot.bufferBeforeMinutes} before / {selection.snapshot.bufferAfterMinutes} after{selection.accepted ? ' · accepted type version' : ''}</Text>}
    {ready && !props.types?.items.length && <Text size="xs" role="status">No active types on this authorized page match every reserved calendar. The server decides whether an untyped booking is permitted.</Text>}
    {ready && !selection.current && <Text size="xs" role="status">The draft type is not on this authorized page. Choose a current type or explicitly clear it before saving; the draft has not been silently changed.</Text>}
    {(props.status === 'idle' || props.status === 'loading') && <Text size="xs" role="status">Loading currently authorized appointment types…</Text>}
    {props.status === 'error' && <Group gap="xs"><Text size="xs" role="status">Type choices are unavailable or access changed.</Text>{props.onRetry && <Button variant="subtle" disabled={props.disabled} onClick={props.onRetry}>Retry types</Button>}</Group>}
    {ready && props.onRetry && <Button variant="subtle" disabled={props.disabled} onClick={props.onRetry}>Refresh types</Button>}
    {ready && (props.canGoBack || props.types?.truncated) && <Group justify="space-between">
      <Button variant="subtle" disabled={props.disabled || !props.canGoBack} onClick={props.onPrevious}>Previous types</Button>
      <Button variant="subtle" disabled={props.disabled || !props.types?.nextAfter} onClick={props.onNext}>Next types</Button>
    </Group>}
  </Stack>;
}
