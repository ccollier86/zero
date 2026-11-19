'use client';
/** Connected supported-field adapter over the approved recovered compact modal content. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ControlledModal, type ModalContext } from '@zero/framework/modals';
import type { CalendarAppointmentTypeSnapshot, CalendarCommandReceipt, CalendarParticipantReference, CalendarResourceView } from '../../../calendar/contracts';
import { useClientMaybe } from '../../../frontend/client/client-context';
import { calendarScopeReadable, useCalendarAppointment, useCalendarAppointmentParticipants, useCalendarAppointmentTransitions,
  useCalendarAppointmentTypes, useCalendarVisitLocations } from '../../../frontend/client/calendar-hooks';
import type { Client } from '../../../frontend/client/sdk';
import { AppointmentModalContent } from '../recovered/appointment-modal/components/appointment-modal/AppointmentModal';
import { calendarCoreTypeDefaults, calendarCoreTypeSelection } from '../models/calendar-core-type-model';
import { calendarAppointmentDraftChanged, calendarAppointmentDraftInput, calendarAppointmentDraftResourcesChanged,
  type CalendarAppointmentDraft, type CalendarAppointmentEditorSession } from '../models/calendar-appointment-editor-model';
import type { CalendarDraftMutationContext } from '../models/calendar-draft-mutation-controller';
import { calendarParticipantBindingCurrent, calendarParticipantDraft } from '../models/calendar-participant-model';
import { calendarVisitSelectionCurrent } from '../models/calendar-visit-model';
import { calendarTransitionAuthorityDenied } from '../models/calendar-transition-model';
import { calendarZonedParts, type CalendarPendingRequest } from '../models/calendar-workspace-model';
import { isEnded } from '../models/appointment-presentation';
import { CalendarAppointmentResourceFields } from './calendar-appointment-resource-fields';
import { CalendarCoreTypeFields } from './calendar-core-type-fields';
import { CalendarVisitFields } from './calendar-visit-fields';
import { useCalendarParticipantSelection } from './calendar-connected-participant-fields';
import { useCalendarDraftMutation } from './use-calendar-draft-mutation';
import { TimePicker } from './time-picker';
import { Button, Group, Stack, Switch, Text, TextInput, Textarea } from './calendar-ui';

export interface CalendarAppointmentEditorProps {
  readonly session: CalendarAppointmentEditorSession;
  readonly resources: readonly CalendarResourceView[];
  readonly client: Client;
  readonly scopeKey: string;
  readonly readRevision?: string | number;
  readonly participants?: boolean;
  readonly maxResources?: number;
  readonly maxParticipants?: number;
  onAuthorityLost(): void;
  onClose(): void;
  onUnknown(request: CalendarPendingRequest): void;
  onRejected(request: CalendarPendingRequest): void;
  onAccepted(request: CalendarPendingRequest): void;
}
function copyDraft(value: CalendarAppointmentDraft): CalendarAppointmentDraft {
  return { ...value, resourceIds: [...value.resourceIds],
    ...(value.participants === undefined ? {} : { participants: value.participants.map(ref => ({ ...ref })) }),
    ...(value.appointmentType ? { appointmentType: { ...value.appointmentType } } : {}),
    ...(value.visitLocation ? { visitLocation: { ...value.visitLocation } } : {}) };
}
/** A→B→A client replacement is a new owner even when the old client object returns. */
export function CalendarAppointmentEditor(props: CalendarAppointmentEditorProps) {
  const contextClient = useClientMaybe(), owner = useRef({ client: props.client, contextClient, generation: 0 });
  if (owner.current.client !== props.client || owner.current.contextClient !== contextClient) owner.current = {
    client: props.client, contextClient, generation: owner.current.generation + 1 };
  const selectedOwner = owner.current, key = JSON.stringify([selectedOwner.generation, props.scopeKey, props.session.key,
    props.session.record?.id ?? null, props.session.record?.revision ?? null]);
  const currentKey = useRef(key); currentKey.current = key;
  const admitted = contextClient === props.client && calendarScopeReadable(props.client, props.scopeKey);
  useEffect(() => { if (!admitted) props.onAuthorityLost(); }, [admitted, props.onAuthorityLost]);
  if (!admitted) return null;
  return <CurrentCalendarAppointmentEditor key={key} {...props} isOwnerCurrent={() => owner.current === selectedOwner && currentKey.current === key} />;
}
function CurrentCalendarAppointmentEditor(props: CalendarAppointmentEditorProps & { readonly isOwnerCurrent: () => boolean }) {
  const { client, scopeKey, session, readRevision, resources, isOwnerCurrent } = props;
  const record = useRef(session.record ? { ...session.record, resourceIds: [...session.record.resourceIds],
    ...(session.record.appointmentType ? { appointmentType: { ...session.record.appointmentType } } : {}),
    ...(session.record.lifecycle ? { lifecycle: { ...session.record.lifecycle } } : {}),
    ...(session.record.visit ? { visit: session.record.visit.mode === 'in-person'
      ? { ...session.record.visit, location: { ...session.record.visit.location } } : { ...session.record.visit } } : {}) } : undefined).current;
  const timeZone = useRef(session.timeZone).current;
  const contextClient = useClientMaybe(), owner = useRef({ client, contextClient, scopeKey }); owner.current = { client, contextClient, scopeKey };
  const initial = useRef(copyDraft(session.initial)).current;
  const [draft, setDraft] = useState(initial), draftRef = useRef(draft); draftRef.current = draft;
  const alive = useRef(true); useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const participantMode = useRef({ enabled: props.participants === true, retired: false }).current;
  if (participantMode.enabled !== (props.participants === true)) participantMode.retired = true;
  const authority = useCalendarAppointment(record?.id ?? null, readRevision);
  const management = useCalendarAppointmentTransitions(record?.id ?? null, readRevision);
  const binding = useCalendarAppointmentParticipants(participantMode.enabled && !participantMode.retired ? record?.id ?? null : null, readRevision);
  const bindingCurrent = !!record && calendarParticipantBindingCurrent(record.id, record.revision, binding.value);
  const [participantBase, setParticipantBase] = useState<readonly CalendarParticipantReference[] | null>(record && participantMode.enabled ? null : []);
  useEffect(() => {
    if (!participantMode.enabled || participantMode.retired || !record || participantBase !== null || binding.status !== 'ready' || !bindingCurrent) return;
    const refs = calendarParticipantDraft(binding.value!.participants.map(person => person.ref));
    if (refs !== null) { setParticipantBase(refs); setDraft(value => {
      const next = value.participants === undefined ? { ...value, participants: refs } : value; draftRef.current = next; return next;
    }); }
  }, [participantMode, record, participantBase, binding.status, binding.value, bindingCurrent]);
  const [typeCursor, setTypeCursor] = useState<string | null>(null), [typeHistory, setTypeHistory] = useState<(string | null)[]>([]);
  const [locationCursor, setLocationCursor] = useState<string | null>(null), [locationHistory, setLocationHistory] = useState<(string | null)[]>([]);
  const typeQuery = { resourceIds: [...draft.resourceIds].sort(), ...(typeCursor === null ? {} : { after: typeCursor }) };
  const types = useCalendarAppointmentTypes(typeQuery);
  const locations = useCalendarVisitLocations(draft.visitMode === 'in-person'
    ? { resourceIds: typeQuery.resourceIds, ...(locationCursor === null ? {} : { after: locationCursor }) } : null);
  const assignmentChanged = calendarAppointmentDraftResourcesChanged(draft, record);
  const acceptedType = assignmentChanged ? undefined : record?.appointmentType;
  const acceptedLocation = !assignmentChanged && record?.visit?.mode === 'in-person' ? record.visit.location : undefined;
  const typeSelection = calendarCoreTypeSelection(draft, types.value, acceptedType);
  const locationSelectable = calendarVisitSelectionCurrent(draft, locations.value, acceptedLocation);
  const [retired, setRetired] = useState(false);
  const currentAdmission = useRef({ authorityLost: true });
  const current = (context: CalendarDraftMutationContext) => alive.current && !context.signal.aborted && isOwnerCurrent()
    && owner.current.client === client && owner.current.contextClient === client && owner.current.scopeKey === scopeKey
    && !currentAdmission.current.authorityLost && calendarScopeReadable(client, scopeKey);
  const { controller, state } = useCalendarDraftMutation({ isCurrent: current,
    readReceipt: (key, signal) => client.calendar.receipts.get(key, { signal }),
    onUnknown: props.onUnknown, onRejected: props.onRejected, onAccepted: props.onAccepted,
    onAuthorityLost: () => { setRetired(true); props.onAuthorityLost(); } });
  const phaseRef = useRef(state.phase); phaseRef.current = state.phase;
  const editable = state.phase === 'editing' || state.phase === 'submitting';
  const readDenied = [authority, management, types, ...(draft.visitMode === 'in-person' ? [locations] : []),
    ...(participantMode.enabled ? [binding] : [])].some(read => read.status === 'error' && calendarTransitionAuthorityDenied({ code: read.code, status: null }));
  const selection = useCalendarParticipantSelection({ enabled: participantMode.enabled && !participantMode.retired,
    value: draft.participants, onChange: refs => change({ participants: refs }), maxParticipants: props.maxParticipants,
    disabled: !editable,
    accepted: bindingCurrent ? binding.value?.participants : undefined,
    acceptedStatus: record ? binding.status === 'ready' && !bindingCurrent ? 'loading' : binding.status : undefined,
    acceptedCode: binding.code, onRetryAccepted: binding.refresh });
  const authorityLost = retired || readDenied || selection.denied || participantMode.retired || contextClient !== client
    || !calendarScopeReadable(client, scopeKey) || !isOwnerCurrent();
  currentAdmission.current = { authorityLost };
  const detailPending = !!record && (authority.status !== 'ready' || management.status !== 'ready' || !authority.value || !management.value);
  const stale = !!record && (authority.value !== null && (authority.value.id !== record.id || authority.value.revision !== record.revision)
    || management.value !== null && (management.value.id !== record.id || management.value.revision !== record.revision
      || management.value.status !== (record.lifecycle?.status ?? record.status))
    || participantMode.enabled && binding.status === 'ready' && !bindingCurrent);
  const ended = !!record && isEnded(record.lifecycle?.status ?? record.status);
  const initialComparison = { ...initial, ...(participantMode.enabled && record && participantBase !== null ? { participants: participantBase } : {}) };
  const changed = calendarAppointmentDraftChanged(draft, initialComparison, record);
  const catalogCurrent = types.status === 'ready' && typeSelection.current
    && (draft.visitMode !== 'in-person' || locations.status === 'ready' && locationSelectable);
  const newResourcesCurrent = draft.resourceIds.every(id => record?.resourceIds.includes(id) || resources.some(resource => resource.id === id && resource.active));
  const participantReady = !participantMode.enabled || selection.ready && (!record || participantBase !== null && bindingCurrent);
  let exactInterval = true;
  try { if (record) {
    const from = calendarZonedParts(record.startAt, timeZone), to = calendarZonedParts(record.endAt, timeZone);
    exactInterval = from.date === to.date && from.offset === to.offset && from.second === 0 && to.second === 0
      && Date.parse(record.startAt) % 60000 === 0 && Date.parse(record.endAt) % 60000 === 0;
  } } catch { exactInterval = false; }
  const latest = useRef({ authorityLost, draft, catalogCurrent, detailPending, stale, ended, changed, newResourcesCurrent, participantReady, exactInterval });
  latest.current = { authorityLost, draft, catalogCurrent, detailPending, stale, ended, changed, newResourcesCurrent, participantReady, exactInterval };
  useEffect(() => { if (authorityLost) props.onAuthorityLost(); }, [authorityLost, props.onAuthorityLost]);
  function change(partial: Partial<CalendarAppointmentDraft>) {
    if (!alive.current || !isOwnerCurrent() || owner.current.contextClient !== client || latest.current.authorityLost
      || !calendarScopeReadable(client, scopeKey) || !['editing', 'submitting'].includes(phaseRef.current)) return;
    const value = draftRef.current;
    if (partial.participants !== undefined && !participantMode.enabled) return;
    if (partial.resourceIds !== undefined) {
      const nextIds = [...partial.resourceIds];
      if (nextIds.some(id => !value.resourceIds.includes(id) && !resources.some(resource => resource.id === id && resource.active))) return;
      partial = { ...partial, resourceIds: nextIds.sort() };
      if (JSON.stringify([...value.resourceIds].sort()) !== JSON.stringify(partial.resourceIds)) {
        partial = { ...partial, visitLocation: undefined,
          ...(record ? { appointmentType: value.appointmentType === undefined ? record.appointmentType : value.appointmentType } : {}) };
        setTypeCursor(null); setTypeHistory([]); setLocationCursor(null); setLocationHistory([]);
      }
    }
    const next = { ...value, ...partial };
    if (calendarAppointmentDraftChanged(next, value, record)) controller.edit();
    draftRef.current = next; setDraft(next);
    if (phaseRef.current === 'editing') setValidationError(null);
  }
  function selectType(type: CalendarAppointmentTypeSnapshot | null) {
    if (types.status !== 'ready' || latest.current.authorityLost) return;
    const result = calendarCoreTypeDefaults({ ...draftRef.current, resourceId: draftRef.current.resourceIds[0] ?? '' }, type, timeZone);
    change(result.change);
    setValidationError(result.error ?? null);
  }
  function typePage(next: boolean) {
    if (types.status !== 'ready' || latest.current.authorityLost || !['editing', 'submitting'].includes(phaseRef.current)) return;
    if (next && types.value?.nextAfter) { setTypeHistory([...typeHistory, typeCursor]); setTypeCursor(types.value.nextAfter); }
    else if (!next && typeHistory.length) { setTypeCursor(typeHistory.at(-1)!); setTypeHistory(typeHistory.slice(0, -1)); }
  }
  function locationPage(next: boolean) {
    if (locations.status !== 'ready' || latest.current.authorityLost || !['editing', 'submitting'].includes(phaseRef.current)) return;
    if (next && locations.value?.nextAfter) { setLocationHistory([...locationHistory, locationCursor]); setLocationCursor(locations.value.nextAfter); }
    else if (!next && locationHistory.length) { setLocationCursor(locationHistory.at(-1)!); setLocationHistory(locationHistory.slice(0, -1)); }
  }
  function submit(context: ModalContext<CalendarCommandReceipt>) {
    const now = latest.current;
    if (!current(context) || now.draft !== draftRef.current || now.detailPending || now.stale || now.ended || !now.catalogCurrent
      || !now.newResourcesCurrent || !now.participantReady || !now.exactInterval || record && !now.changed) return;
    const shaped = calendarAppointmentDraftInput({ draft: copyDraft(draftRef.current), timeZone, types: types.value,
      record, participantsEnabled: participantMode.enabled, initialParticipants: participantBase,
      maxResources: props.maxResources, maxParticipants: props.maxParticipants });
    if ('error' in shaped) { setValidationError(shaped.error); return; }
    const request: CalendarPendingRequest = { key: 'calendar-ui:' + crypto.randomUUID(),
      operation: shaped.kind === 'update' ? 'appointment.updated' : 'appointment.created',
      ...(record ? { id: record.id, expectedRevision: record.revision } : {}) };
    setValidationError(null);
    void controller.submit(context, request, () => shaped.kind === 'update'
      ? client.calendar.appointments.update(record!.id, shaped.input, { idempotencyKey: request.key, expectedRevision: record!.revision, signal: context.signal })
      : client.calendar.appointments.create(shaped.input, { idempotencyKey: request.key, signal: context.signal }));
  }
  const [validationError, setValidationError] = useState<string | null>(null);
  const shaped = calendarAppointmentDraftInput({ draft, timeZone, types: types.value, record,
    participantsEnabled: participantMode.enabled, initialParticipants: participantBase, maxResources: props.maxResources, maxParticipants: props.maxParticipants });
  const disabled = state.phase !== 'editing' || detailPending || stale || ended || !catalogCurrent || !newResourcesCurrent
    || !participantReady || !exactInterval || 'error' in shaped || !!record && !changed;
  const buffers = { before: draft.bufferBeforeMinutes ?? record?.bufferBeforeMinutes ?? typeSelection.snapshot?.bufferBeforeMinutes ?? 0,
    after: draft.bufferAfterMinutes ?? record?.bufferAfterMinutes ?? typeSelection.snapshot?.bufferAfterMinutes ?? 0 };
  const times = Array.from({ length: 96 }, (_, index) => index * 15);
  const error = state.error ?? validationError;
  if (authorityLost) return null;
  return <ControlledModal<CalendarCommandReceipt> open identityKey={session.key} busy={state.busy}
    dirty={changed || state.phase === 'unknown' || state.phase === 'accepted'} error={error}
    onOpenChange={open => { if (!open) props.onClose(); }} descriptor={{ title: record ? 'Edit appointment' : 'New appointment', trigger: session.trigger,
      allowEditingWhilePending: true,
      size: 'sm', customSize: { width: 'var(--calendar-size-420)' }, className: 'calendar-managed-dialog calendar-managed-radius-md',
      body: context => detailPending ? <Stack p="md" gap="sm"><Text>Reauthorizing current appointment details and management…</Text>
        {(authority.status === 'error' || management.status === 'error') && <Button variant="default" onClick={() => { authority.refresh(); management.refresh(); }}>Retry current access</Button>}</Stack>
        : <form noValidate onSubmit={event => { event.preventDefault(); submit(context); }}>
          <AppointmentModalContent event={{ id: record?.id ?? 'draft', title: draft.title, start: draft.start / 60, end: draft.end / 60,
            meta: '', color: '', background: '' }} isAddMode={!record} selectedStartTime={null} selectedEndTime={null}
            startTimeOptions={[]} endTimeOptions={[]} onStartTimeChange={() => {}} onEndTimeChange={() => {}}
            patientOptions={[]} providerOptions={[]} visitTypeOptions={[]} titleMaxLength={512}
            form={{ kind: 'appointment', value: { title: draft.title, date: draft.date, providerId: '', patientId: null, visitType: null,
              recurrence: 'none', location: 'unspecified', notes: '', reminder: null, sendReminder: false, status: record?.lifecycle?.status ?? record?.status ?? 'confirmed' },
              onChange: value => change({ ...(typeof value.title === 'string' ? { title: value.title } : {}), ...(typeof value.date === 'string' ? { date: value.date } : {}) }),
              submitDisabled: disabled, error,
              timeControls: <><TimePicker label="Start time" value={draft.start} options={times} onChange={start => change({ start })} /><Text size="xs">→</Text>
                <TimePicker label="End time" value={draft.end} options={times.filter(minute => minute > draft.start)} onChange={end => change({ end })} /></>,
              resourceControl: <CalendarAppointmentResourceFields value={draft.resourceIds} resources={resources} disabled={!editable} maxResources={props.maxResources}
                onChange={resourceIds => change({ resourceIds })} />,
              attendeeControl: participantMode.enabled ? selection.fields : <Text size="xs" c="dimmed">Native account participants unavailable for this opening. Contact and guest invitations are unavailable.</Text>,
              appointmentTypeControl: <Stack gap="xs"><CalendarCoreTypeFields value={draft} types={types.value} status={types.status} acceptedType={acceptedType}
                disabled={!editable} canGoBack={typeHistory.length > 0} onChange={selectType} onRetry={() => { setTypeCursor(null); setTypeHistory([]); types.refresh(); }}
                onPrevious={() => typePage(false)} onNext={() => typePage(true)} />
                <Group gap="xs"><TextInput aria-label="Buffer before in minutes" label="Before · minutes" type="number" min={0} max={1440} step={1}
                  value={Number.isFinite(buffers.before) ? buffers.before : ''} readOnly={!!typeSelection.snapshot} disabled={!editable || types.status !== 'ready'}
                  onChange={event => change({ bufferBeforeMinutes: event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value) })} />
                  <TextInput aria-label="Buffer after in minutes" label="After · minutes" type="number" min={0} max={1440} step={1}
                    value={Number.isFinite(buffers.after) ? buffers.after : ''} readOnly={!!typeSelection.snapshot} disabled={!editable || types.status !== 'ready'}
                    onChange={event => change({ bufferAfterMinutes: event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value) })} /></Group></Stack>,
              locationControl: <CalendarVisitFields value={draft} locations={locations.value} status={locations.status} acceptedLocation={acceptedLocation}
                disabled={!editable} canGoBack={locationHistory.length > 0} onChange={change} onRetry={locations.refresh}
                onPrevious={() => locationPage(false)} onNext={() => locationPage(true)} />,
              repeatControl: <Text size="xs" c="dimmed">One-off appointment · recurrence unavailable</Text>,
              appearanceControl: <Text size="xs" c="dimmed">Per-appointment appearance and attention unavailable</Text>,
              notesControl: <Textarea aria-label="Notes unavailable" disabled value="" placeholder="Notes unavailable · not saved" size="xs" variant="unstyled" />,
              reminderControl: <Text size="xs" c="dimmed">Automatic reminders unavailable</Text>,
              sendReminderControl: <Switch label="Send reminder · unavailable" checked={false} disabled />,
              telehealthControl: draft.visitMode === 'video' ? <Text size="xs" c="dimmed">Video visit mode only · no provider call link is configured</Text> : null,
              workflowControl: <Text size="xs" c="dimmed">Clinical progress, lobby and attention unavailable. Status changes use current authorized transition actions, separately from this scheduling save.</Text>,
              notice: `Scheduling timezone · ${timeZone}. One atomic save reserves the complete resource set and supported fields. No invitation is sent.`,
              warning: stale ? 'The appointment changed. Your draft is preserved without rebasing; close and review current details.'
                : !exactInterval ? 'This exact-instant appointment cannot be represented by the minute-precision editor. Use the native API; no time will be clipped.' : undefined,
            }} footer={<><Button variant="default" size="xs" onClick={() => { void context.requestClose('cancel'); }}>Close</Button>
              <Group gap="xs">{state.phase === 'unknown' && state.request && <Text size="xs">Original request · {state.request.key}</Text>}
                {state.phase === 'unknown' ? <Button size="xs" disabled={state.busy} onClick={() => { void controller.reconcile(context); }}>Reconcile original request</Button>
                  : <Button size="xs" type="submit" disabled={disabled}>{state.phase === 'submitting' ? 'Submitting…' : state.phase === 'accepted' ? 'Submitted revision accepted' : record ? 'Save appointment' : 'Create appointment'}</Button>}</Group></>} />
        </form>,
    }} />;
}
