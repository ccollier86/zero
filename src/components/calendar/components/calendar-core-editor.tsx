'use client';
/** Connected one-off editor. The native server owns final resource, type, visit and participant admission. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ControlledModal, type ModalContext } from '@zero/framework/modals';
import type { CalendarAppointmentTypeSnapshot, CalendarCommandReceipt, CalendarResourceView } from '../../../calendar/contracts';
import { useClientMaybe } from '../../../frontend/client/client-context';
import { calendarScopeReadable, useCalendarAppointment, useCalendarAppointmentTransitions, useCalendarAppointmentTypes, useCalendarVisitLocations } from '../../../frontend/client/calendar-hooks';
import { CalendarMutationError, CalendarReadError } from '../../../frontend/client/calendar-mutation';
import type { Client } from '../../../frontend/client/sdk';
import { CalendarDraftReceiptFence, type CalendarCoreDraft, type CalendarCoreSession, type CalendarPendingRequest } from '../models/calendar-workspace-model';
import { calendarCoreDraftChanged, calendarCoreDraftInput, calendarCoreReceiptRevisionCurrent, calendarCoreTypeDefaults, calendarCoreTypeSelection } from '../models/calendar-core-type-model';
import { calendarVisitSelectionCurrent } from '../models/calendar-visit-model';
import { calendarTransitionAuthorityDenied } from '../models/calendar-transition-model';
import { isEnded } from '../models/appointment-presentation';
import { CalendarCoreTypeFields } from './calendar-core-type-fields';
import { useCalendarParticipantSelection } from './calendar-connected-participant-fields';
import { CalendarVisitFields } from './calendar-visit-fields';
import { CalendarSelect } from './calendar-select';
import { CalendarDateField } from './calendar-date-field';
import { TimePicker } from './time-picker';
import { Button, Group, Stack, Text, TextInput } from './calendar-ui';
import { IconClock, IconUser } from './calendar-icons';

export interface CalendarCoreEditorProps {
  readonly session: CalendarCoreSession;
  readonly resources: readonly CalendarResourceView[];
  readonly client: Client;
  readonly scopeKey: string;
  readonly readRevision: string;
  /** Parent-admitted presentation hint, never a grant. Omission leaves participant-bearing input absent. */
  readonly participants?: boolean;
  readonly maxParticipants?: number;
  onAuthorityLost(): void;
  onClose(): void;
  onUnknown(identity: CalendarPendingRequest): void;
  onRejected(identity: CalendarPendingRequest): void;
  onAccepted(identity: CalendarPendingRequest): void;
}
/** A replacement account/client, scope, session or accepted record generation owns a new draft and modal context. */
export function CalendarCoreEditor(props: CalendarCoreEditorProps) {
  const contextClient = useClientMaybe(), owner = useRef({ client: props.client, contextClient, generation: 0 });
  if (owner.current.client !== props.client || owner.current.contextClient !== contextClient) {
    owner.current = { client: props.client, contextClient, generation: owner.current.generation + 1 };
  }
  const admitted = contextClient === props.client && calendarScopeReadable(props.client, props.scopeKey);
  useEffect(() => { if (!admitted) props.onAuthorityLost(); }, [admitted, props.onAuthorityLost]);
  const selectedOwner = owner.current, key = JSON.stringify([selectedOwner.generation, props.scopeKey, props.session.key,
    props.session.record?.id ?? null, props.session.record?.revision ?? null]);
  const currentKey = useRef(key); currentKey.current = key;
  if (!admitted) return null;
  return <CurrentCalendarCoreEditor key={key} {...props} isOwnerCurrent={() => owner.current === selectedOwner && currentKey.current === key} />;
}
function CurrentCalendarCoreEditor({ session, resources, client, scopeKey, readRevision, participants, maxParticipants, onAuthorityLost, onClose, onUnknown, onRejected, onAccepted,
  isOwnerCurrent }: CalendarCoreEditorProps & { readonly isOwnerCurrent: () => boolean }) {
  const contextClient = useClientMaybe(), currentOwner = useRef({ client, contextClient, scopeKey }); currentOwner.current = { client, contextClient, scopeKey };
  const authority = useCalendarAppointment(session.record?.id ?? null, readRevision);
  const management = useCalendarAppointmentTransitions(session.record?.id ?? null, readRevision);
  const initial = useRef(session.initial).current;
  const [draft, setDraft] = useState(initial), draftRef = useRef(draft); draftRef.current = draft;
  const [phase, setPhase] = useState<'editing' | 'submitting' | 'unknown' | 'accepted' | 'conflict'>('editing'), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [retired, setRetired] = useState(false);
  const [locationCursor, setLocationCursor] = useState<string | null>(null), [locationHistory, setLocationHistory] = useState<(string | null)[]>([]);
  const [typeCursor, setTypeCursor] = useState<string | null>(null), [typeHistory, setTypeHistory] = useState<(string | null)[]>([]);
  // An explicit empty selection is intentional. Omission would request a manager catalog rather than selected-resource choices.
  const resourceIds = session.record?.resourceIds ?? (draft.resourceId ? [draft.resourceId] : []);
  const types = useCalendarAppointmentTypes({ resourceIds, ...(typeCursor === null ? {} : { after: typeCursor }) });
  const visitLocations = useCalendarVisitLocations(draft.visitMode === 'in-person'
    ? { resourceIds, ...(locationCursor === null ? {} : { after: locationCursor }) } : null);
  const fence = useRef(new CalendarDraftReceiptFence()).current, submitting = useRef(false), identity = useRef<CalendarPendingRequest | null>(null);
  const resource = resources.find(item => item.id === draft.resourceId), timeZone = session.record?.timeZone ?? resource?.timeZone;
  const alive = useRef(true); useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const detailDenied = retired || !!session.record && [authority, management].some(read => read.status === 'error'
    && calendarTransitionAuthorityDenied({ code: read.code, status: null }));
  const typeDenied = types.status === 'error' && calendarTransitionAuthorityDenied({ code: types.code, status: null });
  const detailPending = !!session.record && (authority.status !== 'ready' || management.status !== 'ready' || !authority.value || !management.value);
  const locationPending = draft.visitMode === 'in-person' && visitLocations.status !== 'ready';
  const acceptedLocation = session.record?.visit?.mode === 'in-person' ? session.record.visit.location : undefined;
  const locationSelectable = calendarVisitSelectionCurrent(draft, visitLocations.value, acceptedLocation);
  const typeSelection = calendarCoreTypeSelection(draft, types.value, session.record?.appointmentType), typePending = types.status !== 'ready';
  const staleBase = !!session.record && (authority.value !== null && (authority.value.id !== session.record.id || authority.value.revision !== session.record.revision)
    || management.value !== null && (management.value.id !== session.record.id || management.value.revision !== session.record.revision
      || management.value.status !== (session.record.lifecycle?.status ?? session.record.status)));
  const ended = !!session.record && isEnded(session.record.lifecycle?.status ?? session.record.status);
  // One creation opening owns one admitted presentation mode. A live capability flip retires that opening;
  // it must never turn an explicit participant-bearing intent into an ordinary booking by omission.
  const participantMode = useRef({ enabled: participants === true, retired: false }).current;
  if (!session.record && participantMode.enabled !== (participants === true)) participantMode.retired = true;
  const participantModeRetired = !session.record && participantMode.retired;
  const participantSelection = useCalendarParticipantSelection({ enabled: participants === true && !session.record && !participantModeRetired, value: draft.participants,
    onChange: refs => change({ participants: refs }), disabled: busy || phase !== 'editing', maxParticipants });
  const locationDenied = draft.visitMode === 'in-person' && visitLocations.status === 'error' && calendarTransitionAuthorityDenied({ code: visitLocations.code, status: null });
  const authorityLost = detailDenied || typeDenied || locationDenied || participantSelection.denied || participantModeRetired
    || contextClient !== client || !calendarScopeReadable(client, scopeKey) || !isOwnerCurrent();
  useEffect(() => { if (authorityLost) onAuthorityLost(); }, [authorityLost, onAuthorityLost]);
  const changed = calendarCoreDraftChanged(draft, initial, session.record), dirty = changed || phase === 'accepted' || phase === 'unknown';
  const latest = useRef({ session, draft, phase, busy, timeZone, detailPending, authorityLost, locationPending, locationSelectable,
    typePending, typeSelection, participantReady: participantSelection.ready, staleBase, ended, changed, resource, types: types.value, participantsEnabled: participants === true });
  latest.current = { session, draft, phase, busy, timeZone, detailPending, authorityLost, locationPending, locationSelectable,
    typePending, typeSelection, participantReady: participantSelection.ready, staleBase, ended, changed, resource, types: types.value, participantsEnabled: participants === true };
  const current = (context: ModalContext<CalendarCommandReceipt>) => alive.current && !context.signal.aborted
    && isOwnerCurrent() && currentOwner.current.client === client && currentOwner.current.contextClient === client && currentOwner.current.scopeKey === scopeKey
    && latest.current.session.key === session.key && !latest.current.authorityLost && calendarScopeReadable(client, scopeKey);
  const renderIdentity = {}; const rendered = useRef(renderIdentity); rendered.current = renderIdentity;
  function change(partial: Partial<CalendarCoreDraft>) {
    if (!alive.current || !isOwnerCurrent() || currentOwner.current.contextClient !== client || latest.current.authorityLost || latest.current.session.key !== session.key || !calendarScopeReadable(client, scopeKey)) return;
    const value = draftRef.current;
    // These are not rescheduling fields, even if a stale/programmatic callback attempts to change them.
    if (session.record) { const { title: _title, resourceId: _resource, participants: _participants, ...supported } = partial; partial = supported; }
    if (partial.resourceId !== undefined || partial.visitMode !== undefined && partial.visitMode !== value.visitMode) {
      setLocationCursor(null); setLocationHistory([]);
      if (partial.resourceId !== undefined) { partial = { ...partial, visitLocation: undefined }; setTypeCursor(null); setTypeHistory([]); }
    }
    const next = { ...value, ...partial };
    if (calendarCoreDraftChanged(next, value, session.record)) fence.edit();
    draftRef.current = next; setDraft(next); if (phase === 'editing') setError(null);
  }
  function selectType(selected: CalendarAppointmentTypeSnapshot | null) {
    const now = latest.current;
    if (now.busy || now.phase !== 'editing' || now.typePending || now.authorityLost || !alive.current || !isOwnerCurrent() || !calendarScopeReadable(client, scopeKey)) return;
    const choice = calendarCoreTypeSelection({ appointmentType: selected }, now.types, session.record?.appointmentType);
    if (!choice.current) return;
    const result = calendarCoreTypeDefaults(draftRef.current, choice.snapshot ?? null, now.timeZone); change(result.change); if (result.error) setError(result.error);
  }
  function locationPage(next: boolean) {
    if (rendered.current !== renderIdentity || busy || visitLocations.status !== 'ready' || !alive.current || !isOwnerCurrent() || !calendarScopeReadable(client, scopeKey)) return;
    const after = next ? visitLocations.value?.nextAfter : locationHistory.at(-1);
    if (after === undefined || next && after === null) return;
    if (next) setLocationHistory(history => [...history, locationCursor]); else setLocationHistory(history => history.slice(0, -1));
    setLocationCursor(after);
  }
  function typePage(next: boolean) {
    if (rendered.current !== renderIdentity || busy || types.status !== 'ready' || !alive.current || !isOwnerCurrent() || !calendarScopeReadable(client, scopeKey)) return;
    const after = next ? types.value?.nextAfter : typeHistory.at(-1);
    if (after === undefined || next && after === null) return;
    if (next) setTypeHistory(history => [...history, typeCursor]); else setTypeHistory(history => history.slice(0, -1));
    setTypeCursor(after);
  }
  function refreshTypes() {
    if (rendered.current !== renderIdentity || busy || phase !== 'editing' || !alive.current || !isOwnerCurrent() || !calendarScopeReadable(client, scopeKey)) return;
    // Page cursors can expire or belong to a retired process. Explicit retry restarts selected-resource discovery.
    if (typeCursor !== null || typeHistory.length) { setTypeCursor(null); setTypeHistory([]); } else types.refresh();
  }
  function accepted(receipt: CalendarCommandReceipt, context: ModalContext<CalendarCommandReceipt>) {
    if (!current(context)) return;
    const admission = fence.accepted(receipt);
    if (!admission.matches || !calendarCoreReceiptRevisionCurrent(receipt, session.record)) {
      setPhase('unknown'); setError('The acknowledgment did not match the submitted request and revision. Reconcile the original identity.');
      if (identity.current) onUnknown(identity.current); return;
    }
    if (identity.current) onAccepted(identity.current);
    if (admission.canClose) context.accept(receipt);
    else { setPhase('accepted'); setError('The submitted revision was accepted. Your newer edits are preserved and have not been submitted. Close this editor to review current data before another operation.'); }
  }
  async function submit(context: ModalContext<CalendarCommandReceipt>) {
    const now = latest.current;
    if (submitting.current || now.phase !== 'editing' || now.draft !== draftRef.current || !current(context) || !now.timeZone || now.detailPending || now.authorityLost || now.locationPending || !now.locationSelectable
      || now.typePending || !now.typeSelection.current || !now.participantReady || now.staleBase || now.ended || session.record && !now.changed || !session.record && !now.resource) return;
    const captured = { ...draftRef.current }, shaped = calendarCoreDraftInput({ draft: captured, timeZone: now.timeZone, types: now.types,
      record: session.record, participantsEnabled: now.participantsEnabled });
    if ('error' in shaped) { setError(shaped.error); return; }
    const key = 'calendar-ui:' + crypto.randomUUID(), operation = shaped.kind === 'reschedule' ? 'appointment.rescheduled' : 'appointment.created';
    const request: CalendarPendingRequest = { key, operation, ...(session.record ? { id: session.record.id, expectedRevision: session.record.revision } : {}) };
    identity.current = request; fence.submit(key, operation, request.id);
    // The owner records exact recovery identity before dispatch; retiring an overlay cannot lose a pending request.
    onUnknown(request); submitting.current = true; setBusy(true); setPhase('submitting'); setError(null); context.setBusy(true);
    try {
      const options = { idempotencyKey: key, signal: context.signal };
      const receipt = shaped.kind === 'reschedule' && session.record
        ? await client.calendar.appointments.reschedule(session.record.id, shaped.input, { ...options, expectedRevision: session.record.revision })
        : shaped.kind === 'create' ? await client.calendar.appointments.create(shaped.input, options) : null;
      if (receipt) accepted(receipt, context);
    } catch (cause) {
      if (!current(context)) return;
      if (cause instanceof CalendarMutationError && calendarTransitionAuthorityDenied(cause)) {
        if (!cause.requiresReconciliation) { fence.rejected(); identity.current = null; onRejected(request); }
        setRetired(true); return;
      }
      if (!(cause instanceof CalendarMutationError) || cause.requiresReconciliation) {
        setPhase('unknown'); onUnknown(request); setError('The operation may have been accepted. Do not submit it again. Reconcile using the original request identity.');
      } else {
        fence.rejected(); identity.current = null; onRejected(request); setPhase(cause.code === 'CALENDAR_REVISION_CONFLICT' ? 'conflict' : 'editing');
        setError(cause.code === 'CALENDAR_BOOKING_CONFLICT' ? 'The server rejected this time because it conflicts with a reservation. Choose another time.'
          : cause.code === 'CALENDAR_REVISION_CONFLICT' ? 'This appointment changed. Your draft is preserved; close and reload current details before rescheduling or cancelling.'
          : cause.code === 'CALENDAR_TYPE_STALE' || cause.code === 'CALENDAR_TYPE_CONFLICT' ? 'The type version or current calendar policy changed. Your draft is preserved; retry the current type read, then deliberately choose a current type or review the exact duration and buffers.'
          : cause.code === 'CALENDAR_VISIT_STALE' || cause.code === 'CALENDAR_VISIT_CONFLICT' ? 'The location version or current calendar assignments changed. Your draft is preserved; choose a current authorized location or review the visit mode.'
          : 'The calendar operation was not accepted. Your draft is preserved.');
      }
    } finally { submitting.current = false; if (current(context)) { setBusy(false); context.setBusy(false); } }
  }
  async function reconcile(context: ModalContext<CalendarCommandReceipt>) {
    const request = identity.current; if (!request || submitting.current || !current(context)) return;
    submitting.current = true; setBusy(true); context.setBusy(true);
    try {
      const receipt = await client.calendar.receipts.get(request.key, { signal: context.signal });
      if (!current(context)) return;
      if (!receipt) setError('No receipt is currently visible. This does not prove the write was rolled back. Keep the original request identity.'); else accepted(receipt, context);
    } catch (cause) { if (current(context)) {
      if (cause instanceof CalendarReadError && calendarTransitionAuthorityDenied(cause)) setRetired(true);
      else setError('Reconciliation is unavailable. Keep the original request identity; do not repeat the mutation.');
    } } finally { submitting.current = false; if (current(context)) { setBusy(false); context.setBusy(false); } }
  }
  const times = Array.from({ length: 96 }, (_, index) => index * 15);
  const buffers = { before: draft.bufferBeforeMinutes ?? session.record?.bufferBeforeMinutes ?? typeSelection.snapshot?.bufferBeforeMinutes ?? 0,
    after: draft.bufferAfterMinutes ?? session.record?.bufferAfterMinutes ?? typeSelection.snapshot?.bufferAfterMinutes ?? 0 };
  const disabled = phase !== 'editing' || staleBase || ended || locationPending || !locationSelectable || typePending || !typeSelection.current
    || !participantSelection.ready || !!session.record && !changed || !session.record && !resource;
  if (authorityLost) return null;
  return <ControlledModal<CalendarCommandReceipt> open identityKey={session.key} busy={busy} dirty={dirty} error={error} onOpenChange={open => { if (!open) onClose(); }} descriptor={{
    title: session.record ? 'Reschedule appointment' : 'New appointment', trigger: session.trigger,
    size: 'sm', customSize: { width: 'var(--calendar-size-420)' }, className: 'calendar-managed-dialog calendar-managed-radius-md',
    body: context => detailPending ? <Stack p="md" gap="sm"><Text>Reauthorizing current appointment details and management…</Text>
      {(authority.status === 'error' || management.status === 'error') && <><Text size="xs">The read is unavailable. Your draft is preserved but cannot be submitted until current access is verified.</Text>
        <Button variant="default" onClick={() => { authority.refresh(); management.refresh(); }}>Retry current access</Button></>}</Stack>
      : <form onSubmit={event => { event.preventDefault(); void submit(context); }}><Stack gap="xs" px="md" py="sm">
        <TextInput variant="unstyled" aria-label="Appointment title" placeholder="Add an appointment title" value={draft.title} readOnly={!!session.record} maxLength={160} onChange={event => change({ title: event.currentTarget.value })}
          styles={{ input: { padding: 0, fontWeight: 'var(--calendar-weight-medium)', fontSize: 'var(--calendar-font-size-md)' } }} />
        <Group gap="xs" className="calendar-editor-time-row"><IconClock size="var(--calendar-size-14)" /><TimePicker label="Start time" value={draft.start} options={times} onChange={start => change({ start })} /><Text size="xs">→</Text><TimePicker label="End time" value={draft.end} options={times.filter(minute => minute > draft.start)} onChange={end => change({ end })} /><CalendarDateField value={draft.date} onChange={date => change({ date })} /></Group>
        <Group gap="xs"><IconUser size="var(--calendar-size-14)" /><CalendarSelect aria-label="Appointment calendar" value={draft.resourceId} disabled={!!session.record} data={resources.map(item => ({ value: item.id, label: item.label }))} onChange={id => { if (id) change({ resourceId: id }); }} /></Group>
        <CalendarCoreTypeFields value={draft} types={types.value} status={types.status} acceptedType={session.record?.appointmentType} disabled={busy || phase !== 'editing'}
          canGoBack={typeHistory.length > 0} onChange={selectType} onRetry={refreshTypes} onPrevious={() => typePage(false)} onNext={() => typePage(true)} />
        <Group gap="xs"><TextInput aria-label="Buffer before in minutes" label="Before · minutes" type="number" min={0} max={1440} step={1} value={Number.isFinite(buffers.before) ? buffers.before : ''}
          readOnly={!!typeSelection.snapshot} disabled={busy || phase !== 'editing' || typePending || !typeSelection.current} onChange={event => change({ bufferBeforeMinutes: event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value) })} />
          <TextInput aria-label="Buffer after in minutes" label="After · minutes" type="number" min={0} max={1440} step={1} value={Number.isFinite(buffers.after) ? buffers.after : ''}
            readOnly={!!typeSelection.snapshot} disabled={busy || phase !== 'editing' || typePending || !typeSelection.current} onChange={event => change({ bufferAfterMinutes: event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value) })} /></Group>
        <CalendarVisitFields value={draft} locations={visitLocations.value} status={visitLocations.status} disabled={busy || phase !== 'editing'} canGoBack={locationHistory.length > 0}
          acceptedLocation={acceptedLocation} onChange={change} onRetry={visitLocations.refresh} onPrevious={() => locationPage(false)} onNext={() => locationPage(true)} />
        {participantSelection.fields}
        <Text size="xs" c="dimmed">Scheduling timezone · {timeZone ?? 'Choose a calendar'}{session.record && session.record.resourceIds.length > 1 ? ' · all reserved resources are preserved' : ''}</Text>
        <Text size="xs" c="dimmed">One-off core scheduling. Recurrence, invitations, notes, clinical visit progress and automatic reminders are unavailable, not silently saved.</Text>
        {staleBase && <Text role="status" size="xs">This appointment changed. Your draft is preserved without rebasing. Close and reload current details before another reschedule or cancellation.</Text>}
        {error && <Text role="status" size="xs" c="dimmed">{error}</Text>}
        {identity.current && phase === 'unknown' && <Text size="xs">Original request · {identity.current.key}</Text>}
        <Group justify="space-between" py="sm"><Button variant="subtle" onClick={() => { void context.requestClose('cancel'); }}>Close</Button>
          {phase === 'unknown' ? <Button disabled={busy} onClick={() => { void reconcile(context); }}>Reconcile original request</Button>
            : <Button type="submit" color="blue" disabled={disabled}>{phase === 'submitting' ? 'Submitting…' : phase === 'accepted' ? 'Submitted revision accepted' : phase === 'conflict' || staleBase ? 'Reload current appointment' : session.record ? 'Reschedule' : 'Create appointment'}</Button>}
        </Group>
      </Stack></form>,
  }} />;
}
