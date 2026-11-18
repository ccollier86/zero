'use client';
/** Independent participant replacement. It never combines a reschedule with a second write or calls the pair atomic. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ControlledModal, type ModalContext } from '@zero/framework/modals';
import type { CalendarAppointmentView, CalendarCommandReceipt, CalendarParticipantReference } from '../../../calendar/contracts';
import { useClientMaybe } from '../../../frontend/client/client-context';
import { calendarScopeReadable, useCalendarAppointmentParticipants } from '../../../frontend/client/calendar-hooks';
import { CalendarMutationError, CalendarReadError } from '../../../frontend/client/calendar-mutation';
import type { Client } from '../../../frontend/client/sdk';
import { CalendarDraftReceiptFence, type CalendarPendingRequest } from '../models/calendar-workspace-model';
import { calendarTransitionAuthorityDenied } from '../models/calendar-transition-model';
import { calendarParticipantBindingCurrent, calendarParticipantDraft, calendarParticipantDraftEqual, calendarParticipantReceiptAccepted } from '../models/calendar-participant-model';
import { useCalendarParticipantSelection } from './calendar-connected-participant-fields';
import { Button, Group, Stack, Text } from './calendar-ui';

export interface CalendarAppointmentParticipantsDialogProps {
  readonly record: CalendarAppointmentView;
  readonly client: Client;
  readonly scopeKey: string;
  readonly maxParticipants?: number;
  readonly trigger?: HTMLElement;
  onClose(): void;
  onAuthorityLost(): void;
  onUnknown(request: CalendarPendingRequest): void;
  onRejected(request: CalendarPendingRequest): void;
  onAccepted(request: CalendarPendingRequest): void;
}
/** Replacing the account/client, scope, target or base revision creates a new draft owner. */
export function CalendarAppointmentParticipantsDialog(props: CalendarAppointmentParticipantsDialogProps) {
  const owner = useRef({ client: props.client, generation: 0 });
  if (owner.current.client !== props.client) owner.current = { client: props.client, generation: owner.current.generation + 1 };
  return <ParticipantsDialog key={`${owner.current.generation}:${props.scopeKey}:${props.record.id}:${props.record.revision}`} {...props} />;
}
function ParticipantsDialog(props: CalendarAppointmentParticipantsDialogProps) {
  const { record, client, scopeKey } = props, contextClient = useClientMaybe();
  const binding = useCalendarAppointmentParticipants(record.id);
  const [initial, setInitial] = useState<readonly CalendarParticipantReference[] | null>(null);
  const [draft, setDraft] = useState<readonly CalendarParticipantReference[] | undefined>(undefined), draftRef = useRef(draft); draftRef.current = draft;
  const [phase, setPhase] = useState<'editing' | 'submitting' | 'unknown' | 'accepted' | 'conflict'>('editing');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [retired, setRetired] = useState(false);
  const alive = useRef(true), submitting = useRef(false), identity = useRef<CalendarPendingRequest | null>(null);
  const submittedRefs = useRef<readonly CalendarParticipantReference[] | null>(null);
  const fence = useRef(new CalendarDraftReceiptFence()).current;
  const owner = useRef({ client, contextClient, scopeKey }); owner.current = { client, contextClient, scopeKey };
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const baseCurrent = calendarParticipantBindingCurrent(record.id, record.revision, binding.value);
  useEffect(() => {
    if (initial !== null || binding.status !== 'ready' || !baseCurrent) return;
    const refs = calendarParticipantDraft(binding.value!.participants.map(person => person.ref));
    if (refs) { setInitial(refs); setDraft(refs); }
  }, [binding.status, binding.value, baseCurrent, initial]);
  function change(refs: readonly CalendarParticipantReference[]) {
    fence.edit(); setDraft(refs); if (phase === 'editing') setError(null);
  }
  const selection = useCalendarParticipantSelection({ enabled: true, value: draft, onChange: change,
    // A newer edit during dispatch is allowed and cannot be erased/closed by the older accepted receipt.
    disabled: initial === null || phase !== 'editing' && phase !== 'submitting', accepted: binding.value?.participants,
    acceptedStatus: binding.status, acceptedCode: binding.code, onRetryAccepted: binding.refresh, maxParticipants: props.maxParticipants });
  const denied = retired || contextClient !== client || !calendarScopeReadable(client, scopeKey) || selection.denied;
  const ready = initial !== null && binding.status === 'ready' && selection.ready;
  const stale = binding.status === 'ready' && !baseCurrent;
  const terminal = ['cancelled', 'completed', 'no-show'].includes(record.lifecycle?.status ?? record.status);
  const dirty = initial !== null && draft !== undefined && !calendarParticipantDraftEqual(initial, draft);
  const admission = useRef({ phase, ready, stale, terminal, dirty, denied }); admission.current = { phase, ready, stale, terminal, dirty, denied };
  useEffect(() => { if (denied) props.onAuthorityLost(); }, [denied, props.onAuthorityLost]);
  const current = (context: ModalContext<CalendarCommandReceipt>) => alive.current && !context.signal.aborted
    && owner.current.client === client && owner.current.contextClient === client && owner.current.scopeKey === scopeKey
    && !admission.current.denied && calendarScopeReadable(client, scopeKey);
  function accepted(receipt: CalendarCommandReceipt, context: ModalContext<CalendarCommandReceipt>) {
    if (!current(context)) return;
    const admission = fence.accepted(receipt), request = identity.current;
    if (!admission.matches || !request || !calendarParticipantReceiptAccepted(record.id, record.revision, request.key, receipt)) {
      setPhase('unknown'); setError('The acknowledgment did not match this participant request. Reconcile its original identity.'); return;
    }
    props.onAccepted(request);
    if (admission.canClose) context.accept(receipt);
    else {
      // The submitted reference set, not the pre-save base, is now the accepted comparison baseline.
      if (submittedRefs.current) setInitial(submittedRefs.current);
      setPhase('accepted'); setError('The submitted participant set was accepted. Your newer selection is preserved but has not been submitted. Close to review current details.');
    }
  }
  async function submit(context: ModalContext<CalendarCommandReceipt>) {
    const latest = admission.current;
    if (submitting.current || latest.phase !== 'editing' || !current(context) || !latest.ready || latest.stale || latest.terminal || !latest.dirty) return;
    const captured = draftRef.current === undefined ? null : calendarParticipantDraft(draftRef.current);
    if (captured === null || initial === null || calendarParticipantDraftEqual(initial, captured)) return;
    const request: CalendarPendingRequest = { key: 'calendar-ui:' + crypto.randomUUID(), operation: 'appointment.participants-changed', id: record.id, expectedRevision: record.revision };
    identity.current = request; fence.submit(request.key, request.operation, record.id);
    submittedRefs.current = captured;
    props.onUnknown(request); submitting.current = true; setBusy(true); setPhase('submitting'); setError(null); context.setBusy(true);
    try {
      const receipt = await client.calendar.participants.replace(record.id, captured,
        { idempotencyKey: request.key, expectedRevision: record.revision, signal: context.signal });
      accepted(receipt, context);
    } catch (cause) {
      if (!current(context)) return;
      if (cause instanceof CalendarMutationError && calendarTransitionAuthorityDenied(cause)) {
        if (!cause.requiresReconciliation) { fence.rejected(); identity.current = null; props.onRejected(request); }
        setRetired(true); return;
      }
      if (!(cause instanceof CalendarMutationError) || cause.requiresReconciliation) {
        setPhase('unknown'); setError('The participant change may have been accepted. Reconcile this original request; do not submit it again.');
      } else {
        fence.rejected(); identity.current = null; props.onRejected(request);
        const conflict = cause.code === 'CALENDAR_REVISION_CONFLICT' || cause.code === 'CALENDAR_TRANSITION_INVALID';
        setPhase(conflict ? 'conflict' : 'editing');
        setError(conflict ? 'The appointment changed. Your selection is preserved. Close and review current details before another participant change.'
          : 'The participant change was not accepted. Your selection is preserved; review current eligible accounts before retrying.');
      }
    } finally { submitting.current = false; if (current(context)) { setBusy(false); context.setBusy(false); } }
  }
  async function reconcile(context: ModalContext<CalendarCommandReceipt>) {
    const request = identity.current;
    if (!request || submitting.current || !current(context)) return;
    submitting.current = true; setBusy(true); context.setBusy(true);
    try {
      const receipt = await client.calendar.receipts.get(request.key, { signal: context.signal });
      if (!current(context)) return;
      if (receipt) accepted(receipt, context);
      else setError('No matching receipt is visible yet. That does not prove rollback. Keep the original request identity.');
    } catch (cause) {
      if (!current(context)) return;
      if (cause instanceof CalendarReadError && calendarTransitionAuthorityDenied(cause)) setRetired(true);
      else setError('Reconciliation is unavailable. Do not repeat this change under a new request identity.');
    } finally { submitting.current = false; if (current(context)) { setBusy(false); context.setBusy(false); } }
  }
  // Native close admission also owns unsettled/review state, even if newer edits restore the original reference set.
  return <ControlledModal<CalendarCommandReceipt> open={!denied} identityKey={`${record.id}:${record.revision}:participants`}
    busy={!denied && busy} dirty={!denied && (dirty || phase === 'unknown' || phase === 'accepted')}
    error={denied ? null : error} onOpenChange={open => { if (!open) props.onClose(); }}
    descriptor={{ title: 'Edit appointment participants', trigger: props.trigger, size: 'sm', customSize: { width: 'var(--calendar-size-420)' },
      className: 'calendar-managed-dialog calendar-managed-radius-md', body: context => denied ? null : <form onSubmit={event => { event.preventDefault(); void submit(context); }}>
        <Stack gap="sm" p="md"><Text fw="var(--calendar-weight-heading)">{record.title}</Text>
          {selection.fields}
          {!ready && <><Text size="xs" role="status">Checking current participant access. Your reference draft is preserved; names and actions stay hidden until authorized.</Text>
            {binding.status === 'error' && <Button variant="default" onClick={selection.refresh}>Retry current participant access</Button>}</>}
          {stale && <Text size="xs" role="status">The appointment changed. This selection will not be silently rebased. Close and review current details before another change.</Text>}
          {terminal && <Text size="xs" role="status">Participants cannot be changed on a terminal appointment.</Text>}
          <Text size="xs" c="dimmed">This saves only participant references, separately from scheduling or status changes. No invitation is sent and no calendar access is granted.</Text>
          {error && <Text size="xs" role="status">{error}</Text>}
          {phase === 'unknown' && identity.current && <Text size="xs">Original request · {identity.current.key}</Text>}
          <Group justify="space-between"><Button variant="subtle" onClick={() => { void context.requestClose('cancel'); }}>Close</Button>
            {phase === 'unknown' ? <Button disabled={busy} onClick={() => { void reconcile(context); }}>Reconcile original request</Button>
              : <Button type="submit" disabled={phase !== 'editing' || !ready || stale || terminal || !dirty}>
                {phase === 'submitting' ? 'Submitting…' : phase === 'accepted' ? 'Participant change accepted' : 'Save participants'}</Button>}
          </Group>
        </Stack>
      </form> }} />;
}
