'use client';
/** Compact visit anatomy over native selects. The caller supplies the authorized, bounded location page. */
import type { CalendarLocationPage, CalendarLocationSnapshot, CalendarVisitMode } from '../../../calendar/contracts';
import type { CalendarCoreDraft } from '../models/calendar-workspace-model';
import { calendarLocationVersion, calendarVisitSelectionCurrent } from '../models/calendar-visit-model';
import { CalendarSelect } from './calendar-select';
import { Button, Group, Stack, Text } from './calendar-ui';

export interface CalendarVisitFieldsProps {
  readonly value: Pick<CalendarCoreDraft, 'visitMode' | 'visitLocation'>;
  readonly locations: CalendarLocationPage | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  /** Source-accepted history only, not the history of unsubmitted picker choices. */
  readonly acceptedLocation?: CalendarLocationSnapshot;
  /** Truthful caller-owned discovery context, never a booking authorization claim. */
  readonly coverageHint?: string;
  readonly disabled?: boolean;
  readonly canGoBack?: boolean;
  onChange(change: Pick<CalendarCoreDraft, 'visitMode' | 'visitLocation'>): void;
  onRetry?(): void;
  onPrevious?(): void;
  onNext?(): void;
}
export function CalendarVisitFields(props: CalendarVisitFieldsProps) {
  const mode = props.value.visitMode ?? 'unspecified', selected = props.value.visitLocation;
  const options = (props.locations?.items ?? []).map(location => ({ value: calendarLocationVersion(location), label: location.label }));
  const selectionCurrent = calendarVisitSelectionCurrent(props.value, props.locations, props.acceptedLocation);
  if (props.status === 'ready' && selected && props.acceptedLocation && selectionCurrent && !options.some(item => item.value === calendarLocationVersion(selected))) {
    options.push({ value: calendarLocationVersion(selected), label: `${props.acceptedLocation.label} · accepted version` });
  }
  return <Stack gap="xs">
    <CalendarSelect aria-label="Visit mode" label="Visit mode" value={mode} disabled={props.disabled}
      data={[{ value: 'unspecified', label: 'Unspecified' }, { value: 'in-person', label: 'In-person' }, { value: 'video', label: 'Video' }, { value: 'phone', label: 'Phone' }]}
      onChange={value => { if (value && value !== mode) props.onChange({ visitMode: value as CalendarVisitMode | 'unspecified', visitLocation: undefined }); }} />
    {mode === 'in-person' && <>
      {props.status === 'ready' && <CalendarSelect aria-label="Visit location" label="Location" placeholder="Choose a location" searchable
        value={selected && selectionCurrent ? calendarLocationVersion(selected) : null} disabled={props.disabled} data={options}
        onChange={value => {
          const location = props.locations?.items.find(item => calendarLocationVersion(item) === value);
          if (location) props.onChange({ visitMode: 'in-person', visitLocation: { id: location.id, revision: location.revision, label: location.label, region: location.region } });
        }} />}
      {props.status === 'ready' && !props.locations?.items.length && <Text size="xs" role="status">No active locations on this page match every reserved calendar. Accepted history is not silently replaced.</Text>}
      {props.status === 'ready' && selected && !selectionCurrent && <Text size="xs" role="status">The draft location is not on this authorized page. Choose a current location before saving; the draft has not been silently changed.</Text>}
      {(props.status === 'idle' || props.status === 'loading') && <Text size="xs" role="status">Loading currently authorized visit locations…</Text>}
      {props.status === 'error' && <Group gap="xs"><Text size="xs" role="status">Location choices are unavailable or access changed.</Text>{props.onRetry && <Button variant="subtle" onClick={props.onRetry}>Retry locations</Button>}</Group>}
      {props.status === 'ready' && (props.canGoBack || props.locations?.truncated) && <Group justify="space-between">
        <Button variant="subtle" disabled={props.disabled || !props.canGoBack} onClick={props.onPrevious}>Previous locations</Button>
        <Button variant="subtle" disabled={props.disabled || !props.locations?.nextAfter} onClick={props.onNext}>Next locations</Button>
      </Group>}
    </>}
    {mode !== 'unspecified' && <Text size="xs" c="dimmed">{mode === 'in-person' ? 'The server verifies current location assignments when the booking changes.' : 'Visit mode only. No call link, provider connection or notification is created.'}</Text>}
    {mode === 'in-person' && props.coverageHint && <Text size="xs" c="dimmed" role="status">{props.coverageHint}</Text>}
  </Stack>;
}
