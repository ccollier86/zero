'use client';
/** A real reservation set, not a geography facet: empty always means none, never all. */
import { useId, useState } from 'react';
import type { CalendarResourceView } from '../../../calendar/contracts';
import { CalendarPopover } from './calendar-surfaces';
import { Button, Checkbox, Stack, Text, TextInput } from './calendar-ui';

export interface CalendarAppointmentResourceFieldsProps {
  readonly value: readonly string[];
  readonly resources: readonly CalendarResourceView[];
  readonly disabled?: boolean;
  readonly maxResources?: number;
  onChange(ids: readonly string[]): void;
}
export function CalendarAppointmentResourceFields(props: CalendarAppointmentResourceFieldsProps) {
  const id = useId(), [opened, setOpened] = useState(false), [query, setQuery] = useState('');
  const maximum = props.maxResources ?? 16, byId = new Map(props.resources.map(resource => [resource.id, resource]));
  const found = props.resources.filter(resource => (resource.active || props.value.includes(resource.id))
    && resource.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const missing = props.value.filter(value => !byId.has(value));
  function toggle(value: string, checked: boolean) {
    if (props.disabled || checked && (!byId.get(value)?.active || props.value.length >= maximum)) return;
    props.onChange(checked ? [...props.value.filter(id => id !== value), value].sort() : props.value.filter(id => id !== value));
  }
  return <div className="appointment-attendees" role="group" aria-label="Reserved calendars">
    <CalendarPopover opened={opened && !props.disabled} onChange={setOpened} position="bottom-start" width="var(--calendar-size-292)" trapFocus returnFocus>
      <CalendarPopover.Target><Button variant="subtle" size="compact-xs" disabled={props.disabled} aria-label="Appointment calendars"
        aria-expanded={opened && !props.disabled} aria-controls={opened ? id : undefined} onClick={() => setOpened(value => !value)}>
        {props.value.length === 1 ? byId.get(props.value[0]!)?.label ?? 'One reserved calendar' : `${props.value.length} reserved calendars`}
      </Button></CalendarPopover.Target>
      <CalendarPopover.Dropdown id={id} role="dialog" aria-label="Choose reserved calendars" className="practice-scope-popover">
        <Stack gap="xs" p="sm"><TextInput aria-label="Search current calendar page" placeholder="Search this authorized page…" value={query}
          maxLength={100} onChange={event => setQuery(event.currentTarget.value)} />
          <div className="practice-scroll-list appointment-attendee-results"><Stack gap="xs">
            {found.map(resource => <Checkbox key={resource.id} label={`${resource.label}${resource.active ? '' : ' · inactive accepted calendar'}`}
              checked={props.value.includes(resource.id)} disabled={props.disabled || !props.value.includes(resource.id) && (!resource.active || props.value.length >= maximum)}
              onChange={checked => toggle(resource.id, checked)} />)}
            {missing.map((value, index) => <Checkbox key={value} label={`Reserved calendar not on this catalog page ${index + 1}`} checked disabled={props.disabled}
              onChange={checked => toggle(value, checked)} />)}
            {!found.length && !missing.length && <Text size="xs">No authorized calendars on this page match.</Text>}
          </Stack></div>
          <Text size="xs" c="dimmed">Choose 1–{maximum} calendars. Every selected calendar is reserved together; no selection means none.</Text>
          <Button size="compact-xs" variant="subtle" onClick={() => setOpened(false)}>Done</Button>
        </Stack>
      </CalendarPopover.Dropdown>
    </CalendarPopover>
    <Text size="xs" c="dimmed">{props.value.length} of {maximum} reserved calendars</Text>
  </div>;
}
