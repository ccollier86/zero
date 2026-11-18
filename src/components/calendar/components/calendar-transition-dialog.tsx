'use client';
/** One native managed transition surface, with current server rules and explicit unknown-outcome recovery. */
import { useEffect, useRef, useState } from 'react';
import { ControlledModal, type ModalContext } from '@zero/framework/modals';
import type { CalendarAppointmentView, CalendarCommandReceipt } from '../../../calendar/contracts';
import { calendarScopeReadable, useCalendarAppointmentTransitions } from '../../../frontend/client/calendar-hooks';
import { CalendarMutationError, CalendarReadError } from '../../../frontend/client/calendar-mutation';
import type { Client } from '../../../frontend/client/sdk';
import { CalendarDraftReceiptFence, type CalendarPendingRequest } from '../models/calendar-workspace-model';
import { calendarTransitionAuthorityDenied, calendarTransitionCurrent, calendarTransitionInput, calendarTransitionReceiptAccepted, type CalendarTransitionProposal } from '../models/calendar-transition-model';
import { statusLabel } from '../models/appointment-presentation';
import { Button, Group, Stack, Text, TextInput } from './calendar-ui';

export interface CalendarAppointmentTransitionDialogProps {
  readonly record: CalendarAppointmentView;
  readonly proposal: CalendarTransitionProposal;
  readonly client: Client;
  readonly scopeKey: string;
  readonly trigger?: HTMLElement;
  onClose(): void;
  onAuthorityLost(): void;
  onUnknown(request: CalendarPendingRequest): void;
  onRejected(request: CalendarPendingRequest): void;
  onAccepted(request: CalendarPendingRequest): void;
}
export function CalendarAppointmentTransitionDialog(props: CalendarAppointmentTransitionDialogProps) {
  const { record, proposal, client, scopeKey } = props;
  const projection = useCalendarAppointmentTransitions(record.id);
  const [reason, setReason] = useState(''), reasonRef = useRef(reason); reasonRef.current = reason;
  const [phase, setPhase] = useState<'editing' | 'submitting' | 'unknown' | 'accepted' | 'conflict'>('editing');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [retired, setRetired] = useState(false);
  const alive = useRef(true), submitting = useRef(false), identity = useRef<CalendarPendingRequest | null>(null);
  const fence = useRef(new CalendarDraftReceiptFence()).current;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const denied = retired || projection.status === 'error' && calendarTransitionAuthorityDenied({ code: projection.code, status: null });
  useEffect(() => { if (denied) props.onAuthorityLost(); }, [denied, props.onAuthorityLost]);
  const ready = projection.status === 'ready' && projection.value !== null;
  const stale = ready && !calendarTransitionCurrent(proposal, projection.value!);
  const acceptsReason = proposal.status === 'cancelled' || proposal.status === 'no-show';
  const current = (context: ModalContext<CalendarCommandReceipt>) => alive.current && !context.signal.aborted && calendarScopeReadable(client, scopeKey);
  function accepted(receipt: CalendarCommandReceipt, context: ModalContext<CalendarCommandReceipt>) {
    if (!current(context)) return;
    const result = fence.accepted(receipt);
    if (!result.matches || !identity.current || !calendarTransitionReceiptAccepted(proposal, identity.current.key, receipt)) {
      setPhase('unknown'); setError('The acknowledgment did not match this request. Reconcile the original identity.'); return;
    }
    if (identity.current) props.onAccepted(identity.current);
    if (result.canClose) context.accept(receipt);
    else { setPhase('accepted'); setError('The submitted status change was accepted. Your newer reason text is preserved but has not been submitted. Close to review current details.'); }
  }
  async function submit(context: ModalContext<CalendarCommandReceipt>) {
    if (submitting.current || phase !== 'editing' || !current(context) || !ready || stale) return;
    const input = calendarTransitionInput(proposal, reasonRef.current);
    if (!input) { setError('Enter the required reason, using no more than 1,024 characters.'); return; }
    const request: CalendarPendingRequest = { key: 'calendar-ui:' + crypto.randomUUID(), operation: 'appointment.transitioned', id: record.id, expectedRevision: proposal.revision };
    identity.current = request; fence.submit(request.key, request.operation, record.id);
    props.onUnknown(request); submitting.current = true; setBusy(true); setPhase('submitting'); setError(null); context.setBusy(true);
    try {
      const receipt = await client.calendar.appointments.transition(record.id, input,
        { idempotencyKey: request.key, expectedRevision: proposal.revision, signal: context.signal });
      accepted(receipt, context);
    } catch (cause) {
      if (!current(context)) return;
      if (cause instanceof CalendarMutationError && calendarTransitionAuthorityDenied(cause)) {
        if (!cause.requiresReconciliation) { fence.rejected(); identity.current = null; props.onRejected(request); }
        setRetired(true); return;
      }
      if (!(cause instanceof CalendarMutationError) || cause.requiresReconciliation) {
        setPhase('unknown'); setError('The status change may have been accepted. Reconcile this original request; do not submit it again.');
      } else {
        fence.rejected(); identity.current = null; props.onRejected(request);
        const changed = cause.code === 'CALENDAR_REVISION_CONFLICT' || cause.code === 'CALENDAR_POLICY_STALE' || cause.code === 'CALENDAR_TRANSITION_INVALID';
        setPhase(changed ? 'conflict' : 'editing');
        setError(changed ? 'The appointment or its transition rules changed. Your reason is preserved. Close and review current details before another change.'
          : cause.code === 'CALENDAR_REASON_REQUIRED' ? 'A reason is required by the current server policy.' : 'The status change was not accepted. Your reason is preserved.');
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
    }
    finally { submitting.current = false; if (current(context)) { setBusy(false); context.setBusy(false); } }
  }
  return <ControlledModal<CalendarCommandReceipt> open={!denied} identityKey={`${record.id}:${proposal.revision}:${proposal.policyRevision}:${proposal.status}`}
    busy={!denied && busy} dirty={!denied && reason.length > 0} error={denied ? null : error} onOpenChange={open => { if (!open) props.onClose(); }}
    descriptor={{ title: `${statusLabel(proposal.status)} appointment`, trigger: props.trigger, size: 'sm', customSize: { width: 'var(--calendar-size-420)' },
      className: 'calendar-managed-dialog calendar-managed-radius-md', body: context => denied ? null : projection.status === 'error'
        ? <Stack gap="sm" p="md"><Text>Current status rules are unavailable. Your reason is preserved; no new change can be submitted.</Text>
          <Button variant="default" onClick={projection.refresh}>Retry current access</Button></Stack>
        : <form onSubmit={event => { event.preventDefault(); void submit(context); }}>
        <Stack gap="sm" p="md"><Text fw="var(--calendar-weight-heading)">{record.title}</Text>
          <Text size="sm">{statusLabel(record.lifecycle?.status ?? record.status)} → {statusLabel(proposal.status)}</Text>
          {acceptsReason && <TextInput label={proposal.requiresReason ? 'Reason (required)' : 'Reason (optional)'} aria-label="Status change reason" value={reason} maxLength={1024}
            onChange={event => { fence.edit(); setReason(event.currentTarget.value); if (phase === 'editing') setError(null); }} />}
          <Text size="xs" c="dimmed">{acceptsReason ? 'The reason stays private in this calendar. ' : ''}This change does not automatically send a message or notification.</Text>
          {!ready && <Text size="xs" role="status">Checking current permissions and transition rules…</Text>}
          {stale && phase === 'editing' && <Text size="xs" role="status">The appointment or its rules changed. Close and review current details; this dialog will not silently rebase your change.</Text>}
          {error && <Text size="xs" role="status">{error}</Text>}
          {phase === 'unknown' && identity.current && <Text size="xs">Original request · {identity.current.key}</Text>}
          <Group justify="space-between"><Button variant="subtle" onClick={() => { void context.requestClose('cancel'); }}>Close</Button>
            {phase === 'unknown' ? <Button disabled={busy} onClick={() => { void reconcile(context); }}>Reconcile original request</Button>
              : <Button type="submit" color={proposal.status === 'cancelled' ? 'red' : 'blue'}
                disabled={phase !== 'editing' || !ready || stale || !calendarTransitionInput(proposal, reason)}>
                {phase === 'submitting' ? 'Submitting…' : phase === 'accepted' ? 'Change accepted' : 'Confirm change'}</Button>}
          </Group>
        </Stack>
      </form> }} />;
}
