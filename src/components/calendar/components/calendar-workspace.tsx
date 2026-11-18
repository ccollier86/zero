'use client';
/** Connected one-off core scheduling. Existing full local editors remain independently usable; unsupported fields are never dropped into writes. */
import { useEffect, useRef, useState } from 'react';
import { ControlledModal, type ModalContext } from '@zero/framework/modals';
import type { CalendarAppointmentView, CalendarCommandReceipt, CalendarResourceView } from '../../../calendar/contracts';
import { useClientMaybe } from '../../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../../frontend/client/authorization-scope-hooks';
import { calendarScopeReadable, useCalendarAppointment, useCalendarAppointments, useCalendarResources, useCalendarAppointmentTransitions, useCalendarVisitLocations } from '../../../frontend/client/calendar-hooks';
import { CalendarMutationError, CalendarReadError } from '../../../frontend/client/calendar-mutation';
import type { Client } from '../../../frontend/client/sdk';
import { CalendarSchedule } from './calendar-schedule';
import { CalendarHeader } from '../recovered/calendar/components/calendar-header';
import { CalendarSelect } from './calendar-select';
import { CalendarDateField } from './calendar-date-field';
import { TimePicker } from './time-picker';
import { CalendarVisitFields } from './calendar-visit-fields';
import { calendarVisitDraft, calendarVisitDraftInput, calendarVisitLabel, calendarVisitSelectionCurrent } from '../models/calendar-visit-model';
import { CalendarAppointmentTransitionDialog } from './calendar-transition-dialog';
import { calendarTransitionAuthorityDenied, calendarTransitionProposal, type CalendarTransitionProposal } from '../models/calendar-transition-model';
import { isEnded, statusLabel } from '../models/appointment-presentation';
import { Button, Checkbox, Group, Stack, Text, TextInput } from './calendar-ui';
import { IconClock, IconPlus, IconRotateClockwise, IconUser } from './calendar-icons';
import { dateKey, parseDay, shiftCalendarDate } from '../models/calendar-model';
import { calendarCoreDraftInterval, CalendarDraftReceiptFence, CalendarPendingRequestLedger, calendarDisplayDays, calendarUiResource, calendarWallTimeCandidates,
  calendarWorkspaceQueries, calendarZonedParts, projectCalendarAppointments, type CalendarCoreDraft, type CalendarPendingRequest as PendingIdentity } from '../models/calendar-workspace-model';
import type { CalendarViewMode } from '../recovered/calendar/types/calendar-view-mode';
import type { MenuTarget, SlotTarget } from '../types';
import '../styles/calendar-workspace.css';

export interface ConnectedCalendarWorkspaceProps {
  /** Explicit display policy, never a guessed scheduling timezone. Resource scheduling zones remain authoritative. */
  readonly displayTimeZone: string;
  readonly initialDate?: Date;
  readonly initialView?: CalendarViewMode;
  /** App-owned setup/navigation. This component never installs providers or changes server configuration. */
  readonly onSetupRequested?: () => void;
  readonly className?: string;
}
interface CoreSession { key: number; selection: string; initial: CalendarCoreDraft; trigger?: HTMLElement; record?: CalendarAppointmentView }
export function ConnectedCalendarWorkspace(props: ConnectedCalendarWorkspaceProps) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  const owner = useRef({ client, revision: 0 });
  if (owner.current.client !== client) owner.current = { client, revision: owner.current.revision + 1 };
  let validZone = true; try { new Intl.DateTimeFormat('en', { timeZone: props.displayTimeZone }); } catch { validZone = false; }
  if (!validZone) return <WorkspaceState title="Choose a valid display timezone." />;
  if (props.initialDate !== undefined && (!(props.initialDate instanceof Date) || !Number.isFinite(props.initialDate.getTime()))) return <WorkspaceState title="Choose a valid calendar date." />;
  if (!client || !boundary.ready) return <WorkspaceState title="Sign in and select an authorized workspace to use the calendar." />;
  return <CurrentCalendarWorkspace key={JSON.stringify([boundary.key, owner.current.revision])} {...props} client={client} scopeKey={boundary.key} />;
}
function CurrentCalendarWorkspace({ client, scopeKey, ...props }: ConnectedCalendarWorkspaceProps & { client: Client; scopeKey: string }) {
  const [catalogCursor, setCatalogCursor] = useState<string | null>(null), [catalogHistory, setCatalogHistory] = useState<(string | null)[]>([]);
  const catalog = useCalendarResources(catalogCursor === null ? {} : { after: catalogCursor });
  const [date, setDate] = useState(() => props.initialDate ?? parseDay(calendarZonedParts(Date.now(), props.displayTimeZone).date));
  const [view, setView] = useState<CalendarViewMode>(props.initialView ?? 'week'), [selected, setSelected] = useState<string[]>([]), [focus, setFocus] = useState<string | null>(null);
  const [session, setSession] = useState<CoreSession | null>(null), [details, setDetails] = useState<{ id: string; selection: string; trigger?: HTMLElement } | null>(null);
  const [transition, setTransition] = useState<{ record: CalendarAppointmentView; proposal: CalendarTransitionProposal; selection: string; trigger?: HTMLElement } | null>(null);
  const [pending, setPending] = useState<PendingIdentity | null>(null), [notice, setNotice] = useState(''), sessionKey = useRef(0);
  const requestLedger = useRef(new CalendarPendingRequestLedger()).current;
  function trackPending(request: PendingIdentity) { requestLedger.track(request); setPending(request); }
  function settlePending(request: PendingIdentity): boolean { if (!requestLedger.settle(request)) return false; setPending(null); return true; }
  const resources = catalog.value?.items.filter(resource => resource.active) ?? [], selectedResources = resources.filter(resource => selected.includes(resource.id));
  const focused = selectedResources.find(resource => resource.id === focus), displayed = view === 'week' || view === 'month' ? focused ? [focused] : [] : selectedResources;
  const days = calendarDisplayDays(date, view), queries = calendarWorkspaceQueries(days, displayed.map(resource => resource.id));
  const first = useCalendarAppointments(queries[0] ?? null), second = useCalendarAppointments(queries[1] ?? null);
  const failed = catalog.status === 'error' || first.status === 'error' || second.status === 'error';
  const ready = first.status === 'ready' && (queries.length < 2 || second.status === 'ready');
  const byId = new Map<string, CalendarAppointmentView>();
  if (!failed && ready) for (const item of [...first.value!.items, ...(second.value?.items ?? [])]) {
    const old = byId.get(item.id); if (!old || item.revision > old.revision) byId.set(item.id, item);
  }
  const projection = projectCalendarAppointments([...byId.values()], displayed.map(resource => resource.id), days, props.displayTimeZone, view);
  const truncated = first.value?.truncated || second.value?.truncated;
  // Denial/loading retires private overlays immediately. Ordinary admitted live snapshots do not replace a dirty draft.
  const overlayAllowed = !failed && catalog.status === 'ready' && (ready || !queries.length);
  const selectionKey = JSON.stringify([displayed.map(resource => resource.id), days, props.displayTimeZone]);
  useEffect(() => { setDetails(null); setSession(null); setTransition(null); }, [selectionKey]);
  useEffect(() => { if (!overlayAllowed) { setDetails(null); setSession(null); setTransition(null); } }, [overlayAllowed]);
  function catalogPage(next: boolean) {
    if (pending || !calendarScopeReadable(client, scopeKey)) return;
    const after = next ? catalog.value?.nextAfter : catalogHistory.at(-1);
    if (after === undefined || next && after === null) return;
    setSelected([]); setFocus(null); setDetails(null); setSession(null);
    if (next) setCatalogHistory(history => [...history, catalogCursor]); else setCatalogHistory(history => history.slice(0, -1));
    setCatalogCursor(after);
  }
  function choose(id: string, checked: boolean) {
    setSelected(current => checked ? current.includes(id) ? current : [...current, id].slice(0, 16) : current.filter(value => value !== id));
    if (checked && !selectedResources.length) setFocus(id); else if (!checked && focus === id) setFocus(null);
  }
  function create(slot?: SlotTarget, trigger?: HTMLElement) {
    if (pending || !calendarScopeReadable(client, scopeKey)) return;
    const resourceId = slot?.resourceId ?? focused?.id ?? displayed[0]?.id;
    if (!resourceId) return;
    const resource = resources.find(item => item.id === resourceId); if (!resource) return;
    // Keep a clicked instant when display and scheduling zones differ; never reinterpret the same clock label as another booking.
    const sameZone = new Intl.DateTimeFormat('en', { timeZone: resource.timeZone }).resolvedOptions().timeZone === new Intl.DateTimeFormat('en', { timeZone: props.displayTimeZone }).resolvedOptions().timeZone;
    let day = slot?.date ?? dateKey(date), start = slot?.minute ?? 540, end = Math.min(start + 60, 1439);
    if (slot && !sameZone) {
      const candidates = calendarWallTimeCandidates(slot.date, slot.minute, props.displayTimeZone);
      if (candidates.length !== 1) { setNotice('The displayed slot is ambiguous or nonexistent. Use New appointment and choose an unambiguous time in the calendar scheduling timezone.'); return; }
      const from = calendarZonedParts(candidates[0]!, resource.timeZone), to = calendarZonedParts(Date.parse(candidates[0]!) + 3600_000, resource.timeZone);
      if (from.date !== to.date || from.minute >= to.minute || from.offset !== to.offset) { setNotice('This slot needs an exact-instant booking through the calendar API. The core editor will not change its date or guess a timezone offset.'); return; }
      day = from.date; start = from.minute; end = to.minute;
    }
    setSession({ key: ++sessionKey.current, selection: selectionKey, trigger, initial: { resourceId, title: '', date: day, start, end } });
  }
  function menu(target: MenuTarget, trigger: HTMLElement) {
    if (target.kind === 'slot') create(target.slot, trigger);
    else { const source = projection.sourceByEventId.get(target.eventId); if (source) setDetails({ id: source.id, selection: selectionKey, trigger }); }
  }
  function edit(record: CalendarAppointmentView, trigger?: HTMLElement) {
    if (pending || !calendarScopeReadable(client, scopeKey)) return;
    const start = calendarZonedParts(record.startAt, record.timeZone), end = calendarZonedParts(record.endAt, record.timeZone);
    if (start.date !== end.date || start.second || end.second || start.offset !== end.offset
      || Date.parse(record.startAt) % 60000 !== 0 || Date.parse(record.endAt) % 60000 !== 0) {
      setNotice('This appointment needs an exact-instant reschedule through the calendar API; the minute-precision core editor will not alter it.'); return;
    }
    setSession({ key: ++sessionKey.current, selection: selectionKey, record, trigger, initial: { resourceId: record.resourceIds[0]!, title: record.title, date: start.date, start: start.minute, end: end.minute, ...calendarVisitDraft(record.visit) } });
  }
  async function reconcile() {
    if (!pending || !calendarScopeReadable(client, scopeKey)) return;
    const captured = requestLedger.beginReconciliation(); if (!captured) return;
    try {
      const receipt = await client.calendar.receipts.get(captured.key);
      if (!calendarScopeReadable(client, scopeKey)) return;
      if (!receipt || !matchesReceipt(captured, receipt)) { setNotice('No matching receipt is visible yet. This does not prove rollback; keep the original request identity.'); return; }
      if (settlePending(captured)) { setNotice('The original calendar request was accepted. Current authorized data will be loaded separately.'); first.refresh(); second.refresh(); }
    } catch { if (calendarScopeReadable(client, scopeKey)) setNotice('The original request could not be reconciled. Do not repeat the write with a new identity.'); }
    finally { requestLedger.finishReconciliation(captured); }
  }
  if (catalog.status === 'idle' || catalog.status === 'loading') return <WorkspaceState title="Loading authorized calendars…" />;
  if (failed) return <WorkspaceState title={catalog.code === 'CALENDAR_NOT_READY' ? 'Calendar setup is required.' : 'Calendar data is unavailable or access has changed.'}
    description="Private events and open editors have been withdrawn. Retrying only reloads authorized reads." onRetry={() => { catalog.refresh(); first.refresh(); second.refresh(); }}
    onClearSelection={selected.length ? () => { setSelected([]); setFocus(null); catalog.refresh(); } : undefined} onSetup={props.onSetupRequested} />;
  if (!catalog.value?.items.length && !catalogCursor && !catalog.value?.truncated) return <WorkspaceState title="No authorized active calendars yet." description="A delegated calendar manager can create a calendar with an explicit scheduling timezone. No sample people or appointments are added."
    onRetry={catalog.refresh} onSetup={props.onSetupRequested} />;
  return <section className={`zero-calendar calendar-workspace ${props.className ?? ''}`} aria-label="Calendar workspace">
    <Group justify="space-between" mb="sm"><Text size="xs" c="dimmed">Display timezone · {props.displayTimeZone}</Text><Group gap="xs">
      <Button variant="subtle" aria-label="Reload authorized calendar data" onClick={() => { catalog.refresh(); first.refresh(); second.refresh(); }}><IconRotateClockwise />Refresh</Button>
      <Button disabled={!displayed.length || !!pending} onClick={event => create(undefined, event.currentTarget)}><IconPlus />New appointment</Button>
    </Group></Group>
    <Group gap="sm" mb="sm" aria-label="Choose calendars">{resources.map(resource => <Checkbox key={resource.id} label={resource.label} checked={selected.includes(resource.id)} disabled={!selected.includes(resource.id) && selectedResources.length >= 16} onChange={checked => choose(resource.id, checked)} />)}</Group>
    {(!resources.length || catalog.value?.truncated || catalogHistory.length > 0) && <Group justify="space-between" mb="sm"><Text size="xs" c="dimmed" role="status">{!resources.length ? 'No active calendars on this catalog page. ' : ''}Catalog page {catalogHistory.length + 1} · changing pages clears the selected calendars.</Text><Group gap="xs">
      <Button variant="subtle" disabled={!catalogHistory.length || !!pending} onClick={() => catalogPage(false)}>Previous calendars</Button>
      <Button variant="default" disabled={!catalog.value?.nextAfter || !!pending} onClick={() => catalogPage(true)}>Next calendars</Button>
    </Group></Group>}
    <CalendarHeader date={date} viewMode={view} onPrevious={() => setDate(value => shiftCalendarDate(value, view, -1))} onNext={() => setDate(value => shiftCalendarDate(value, view, 1))}
      onToday={() => setDate(parseDay(calendarZonedParts(Date.now(), props.displayTimeZone).date))} onViewChange={setView}
      providerSwitcher={(view === 'week' || view === 'month') && <CalendarSelect aria-label="Focused calendar" placeholder="Choose a focused calendar" value={focused?.id ?? null} data={selectedResources.map(resource => ({ value: resource.id, label: resource.label }))} onChange={id => setFocus(id)} />} />
    {!displayed.length ? <WorkspaceState title={selectedResources.length ? 'Choose a focused calendar for week or month.' : 'Choose calendars to see the schedule.'} />
      : !ready ? <WorkspaceState title="Loading authorized appointments…" />
      : <CalendarSchedule date={date} view={view} today={calendarZonedParts(Date.now(), props.displayTimeZone).date} resources={displayed.map(calendarUiResource)} events={projection.events}
        onDateSelect={setDate} onMenu={menu} onEdit={event => { const source = projection.sourceByEventId.get(event.id); if (source) setDetails({ id: source.id, selection: selectionKey }); }}
        onDetails={event => { const source = projection.sourceByEventId.get(event.id); if (source) setDetails({ id: source.id, selection: selectionKey }); }} eventPresentation={() => ({ clinical: false, coreOnly: true })} />}
    {!!projection.supplemental.length && <details><summary>Outside grid hours or exact-instant appointments ({projection.supplemental.length})</summary><Stack gap="xs">{projection.supplemental.map(record => <Button key={record.id} variant="subtle" onClick={event => setDetails({ id: record.id, selection: selectionKey, trigger: event.currentTarget })}>{record.title} · {formatInstant(record.startAt, props.displayTimeZone)}</Button>)}</Stack></details>}
    <div className="calendar-workspace-foot"><Text size="xs" role="status">{truncated ? 'Results are truncated. Narrow the range or selected calendars; this is not a complete availability view.' : notice || 'One-off appointments · grid 7 AM–7 PM · no recurrence, invitations or automatic reminders.'}</Text>
      {pending && <Group gap="xs"><Text size="xs">Unsettled request · {pending.key}</Text><Button variant="default" disabled={!!session} onClick={() => { void reconcile(); }}>Reconcile original request</Button></Group>}
    </div>
    {overlayAllowed && details?.selection === selectionKey && <CoreDetails key={details.id} id={details.id} trigger={details.trigger} scopeKey={scopeKey} client={client} displayTimeZone={props.displayTimeZone}
      revision={`${first.invalidationRevision}/${first.reconnectRevision}/${second.invalidationRevision}/${second.reconnectRevision}/${byId.get(details.id)?.revision ?? 'unlisted'}`}
      onClose={() => setDetails(null)} onEdit={record => edit(record, details.trigger)}
      onTransition={(record, proposal) => { if (!pending && calendarScopeReadable(client, scopeKey)) setTransition({ record, proposal, selection: selectionKey, trigger: details.trigger }); }} />}
    {overlayAllowed && transition?.selection === selectionKey && <CalendarAppointmentTransitionDialog key={`${transition.record.id}:${transition.record.revision}:${transition.proposal.status}`}
      record={transition.record} proposal={transition.proposal} trigger={transition.trigger} client={client} scopeKey={scopeKey}
      onClose={() => setTransition(null)} onAuthorityLost={() => { setTransition(null); setNotice('Status controls were withdrawn because current appointment management is no longer authorized.'); }}
      onUnknown={trackPending} onRejected={settlePending} onAccepted={request => { if (settlePending(request)) setNotice('The submitted status change was accepted.'); }} />}
    {overlayAllowed && session?.selection === selectionKey && <CoreEditor key={session.key} session={session} resources={resources} client={client} scopeKey={scopeKey}
      readRevision={`${first.invalidationRevision}/${first.reconnectRevision}/${second.invalidationRevision}/${second.reconnectRevision}/${session.record ? byId.get(session.record.id)?.revision ?? 'unlisted' : 'new'}`}
      onAuthorityLost={() => { setSession(null); setNotice('The appointment editor was withdrawn because current details are no longer authorized. Any unsettled request still requires reconciliation.'); }}
      onClose={() => setSession(null)} onUnknown={trackPending} onRejected={settlePending} onAccepted={request => { if (settlePending(request)) setNotice('The submitted calendar request was accepted.'); }} />}
  </section>;
}
function WorkspaceState({ title, description, onRetry, onSetup, onClearSelection }: { title: string; description?: string; onRetry?(): void; onSetup?(): void; onClearSelection?(): void }) {
  return <div className="calendar-empty"><Text fw="var(--calendar-weight-heading)">{title}</Text>{description && <Text size="xs" c="dimmed">{description}</Text>}<Group gap="xs">{onRetry && <Button variant="default" onClick={onRetry}>Retry read</Button>}{onClearSelection && <Button variant="subtle" onClick={onClearSelection}>Clear calendar selection</Button>}{onSetup && <Button onClick={onSetup}>Calendar setup</Button>}</Group></div>;
}
function CoreDetails({ id, trigger, scopeKey, client, displayTimeZone, revision, onClose, onEdit, onTransition }: { id: string; trigger?: HTMLElement; scopeKey: string; client: Client; displayTimeZone: string; revision: string; onClose(): void; onEdit(record: CalendarAppointmentView): void; onTransition(record: CalendarAppointmentView, proposal: CalendarTransitionProposal): void }) {
  const detail = useCalendarAppointment(id, revision);
  const transitions = useCalendarAppointmentTransitions(id);
  const [nextStatus, setNextStatus] = useState<string | null>(null);
  if (detail.status === 'error') return <WorkspaceState title="Appointment details are no longer available." onRetry={detail.refresh} />;
  const record = detail.value;
  const available = record && transitions.status === 'ready' && transitions.value?.revision === record.revision ? transitions.value : null;
  const proposal = record && available && nextStatus ? calendarTransitionProposal(record, available, nextStatus as CalendarTransitionProposal['status']) : null;
  return <ControlledModal<'reschedule' | CalendarTransitionProposal> open identityKey={id} onOpenChange={open => { if (!open) onClose(); }}
    onResult={result => { if (result.kind === 'accepted' && record && calendarScopeReadable(client, scopeKey)) {
      if (result.value === 'reschedule') onEdit(record); else onTransition(record, result.value);
    } }}
    descriptor={{ title: 'Appointment details', trigger, size: 'sm', customSize: { width: 'var(--calendar-size-440)' }, className: 'calendar-managed-dialog calendar-managed-radius-md', body: context => <Stack gap="md" p="md">
      {!record ? <Text>Loading current authorized details…</Text> : <><Text fw="var(--calendar-weight-heading)">{record.title}</Text><Text size="xs">{statusLabel(record.lifecycle?.status ?? record.status)} · revision {record.revision}</Text>
        <Text size="sm">{formatInstant(record.startAt, displayTimeZone)} → {formatInstant(record.endAt, displayTimeZone)}</Text>
        <Text size="sm">{calendarVisitLabel(record.visit)}</Text>
        <Text size="xs" c="dimmed">Display · {displayTimeZone}<br />Scheduling · {record.timeZone}<br />Buffers · {record.bufferBeforeMinutes} minutes before / {record.bufferAfterMinutes} minutes after</Text>
        {record.lifecycle?.reason && <Text size="sm">Reason · {record.lifecycle.reason}</Text>}
        <Text size="xs" c="dimmed">Clinical progress, lobby, attendees, recurrence and automatic notifications are not enabled by these status controls.</Text>
        {available && !isEnded(record.lifecycle?.status ?? record.status) && <Button variant="default" onClick={() => context.accept('reschedule')}>Reschedule</Button>}
        {available && available.allowed.length > 0 && <Stack gap="xs"><CalendarSelect aria-label="Change appointment status" placeholder="Choose a status change" value={nextStatus}
          data={available.allowed.map(item => ({ value: item.status, label: `${statusLabel(item.status)}${item.requiresReason ? ' · reason required' : ''}` }))} onChange={setNextStatus} />
          <Button variant="default" disabled={!proposal} onClick={() => { if (proposal) context.accept(proposal); }}>Review status change…</Button></Stack>}
        {transitions.status === 'error' && <Text size="xs" c="dimmed">Status management is unavailable for your current access.</Text>}</>}
    </Stack> }} />;
}
function CoreEditor({ session, resources, client, scopeKey, readRevision, onAuthorityLost, onClose, onUnknown, onRejected, onAccepted }: { session: CoreSession; resources: readonly CalendarResourceView[]; client: Client; scopeKey: string; readRevision: string; onAuthorityLost(): void; onClose(): void; onUnknown(identity: PendingIdentity): void; onRejected(identity: PendingIdentity): void; onAccepted(identity: PendingIdentity): void }) {
  const authority = useCalendarAppointment(session.record?.id ?? null, readRevision);
  const management = useCalendarAppointmentTransitions(session.record?.id ?? null, readRevision);
  const [draft, setDraft] = useState(session.initial), draftRef = useRef(draft); draftRef.current = draft;
  const [phase, setPhase] = useState<'editing' | 'submitting' | 'unknown' | 'accepted' | 'conflict'>('editing'), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retired, setRetired] = useState(false), [locationCursor, setLocationCursor] = useState<string | null>(null), [locationHistory, setLocationHistory] = useState<(string | null)[]>([]);
  const visitLocations = useCalendarVisitLocations(draft.visitMode === 'in-person'
    ? { resourceIds: session.record?.resourceIds ?? [draft.resourceId], ...(locationCursor === null ? {} : { after: locationCursor }) } : null);
  const fence = useRef(new CalendarDraftReceiptFence()).current, submitting = useRef(false), identity = useRef<PendingIdentity | null>(null);
  const resource = resources.find(item => item.id === draft.resourceId), timeZone = session.record?.timeZone ?? resource?.timeZone;
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const detailDenied = retired || !!session.record && [authority, management].some(read => read.status === 'error'
    && calendarTransitionAuthorityDenied({ code: read.code, status: null }));
  const detailPending = !!session.record && (authority.status !== 'ready' || management.status !== 'ready');
  const locationPending = draft.visitMode === 'in-person' && visitLocations.status !== 'ready';
  const acceptedLocation = session.record?.visit?.mode === 'in-person' ? session.record.visit.location : undefined;
  const locationSelectable = calendarVisitSelectionCurrent(draft, visitLocations.value, acceptedLocation);
  const staleBase = !!session.record && authority.value !== null && authority.value.revision !== session.record.revision;
  useEffect(() => { if (detailDenied) onAuthorityLost(); }, [detailDenied, onAuthorityLost]);
  const current = (context: ModalContext<CalendarCommandReceipt>) => alive.current && !context.signal.aborted && calendarScopeReadable(client, scopeKey);
  function change(partial: Partial<CalendarCoreDraft>) {
    if (partial.resourceId !== undefined || partial.visitMode !== undefined && partial.visitMode !== draft.visitMode) {
      setLocationCursor(null); setLocationHistory([]);
      if (partial.resourceId !== undefined) partial = { ...partial, visitLocation: undefined };
    }
    fence.edit(); setDraft(value => ({ ...value, ...partial })); if (phase === 'editing') setError(null);
  }
  function locationPage(next: boolean) {
    if (busy || visitLocations.status !== 'ready') return;
    const after = next ? visitLocations.value?.nextAfter : locationHistory.at(-1);
    if (after === undefined || next && after === null) return;
    if (next) setLocationHistory(history => [...history, locationCursor]); else setLocationHistory(history => history.slice(0, -1));
    setLocationCursor(after);
  }
  function accepted(receipt: CalendarCommandReceipt, context: ModalContext<CalendarCommandReceipt>) {
    if (!current(context)) return;
    const admission = fence.accepted(receipt);
    if (!admission.matches) { setPhase('unknown'); setError('The acknowledgment did not match the submitted request. Reconcile the original identity.'); if (identity.current) onUnknown(identity.current); return; }
    if (identity.current) onAccepted(identity.current);
    if (admission.canClose) context.accept(receipt);
    else { setPhase('accepted'); setError('The submitted revision was accepted. Your newer edits are preserved and have not been submitted. Close this editor to review current data before another operation.'); }
  }
  async function submit(context: ModalContext<CalendarCommandReceipt>) {
    if (submitting.current || phase !== 'editing' || !current(context) || !timeZone || detailPending || locationPending || !locationSelectable || staleBase) return;
    const captured = { ...draftRef.current }, parsed = calendarCoreDraftInterval(captured, timeZone);
    if ('error' in parsed) { setError(parsed.error); return; }
    const visit = calendarVisitDraftInput(captured, session.record?.visit);
    if ('error' in visit) { setError(visit.error); return; }
    const interval = 'error' in parsed ? null : parsed;
    const key = 'calendar-ui:' + crypto.randomUUID(), operation = session.record ? 'appointment.rescheduled' : 'appointment.created';
    const request: PendingIdentity = { key, operation, ...(session.record ? { id: session.record.id } : {}) }; identity.current = request; fence.submit(key, operation, request.id);
    // Record the exact identity before dispatch, so owner-driven overlay retirement cannot lose an in-flight request.
    onUnknown(request); submitting.current = true; setBusy(true); setPhase('submitting'); setError(null); context.setBusy(true);
    try {
      const options = { idempotencyKey: key, signal: context.signal }, record = session.record;
      const receipt = record ? await client.calendar.appointments.reschedule(record.id, { ...interval!, timeZone, bufferBeforeMinutes: record.bufferBeforeMinutes, bufferAfterMinutes: record.bufferAfterMinutes, ...visit }, { ...options, expectedRevision: record.revision })
        : await client.calendar.appointments.create({ resourceIds: [captured.resourceId], title: captured.title.trim(), ...interval!, timeZone, ...(visit.visit ? { visit: visit.visit } : {}) }, options);
      accepted(receipt, context);
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
          : cause.code === 'CALENDAR_VISIT_STALE' || cause.code === 'CALENDAR_VISIT_CONFLICT' ? 'The location version or current calendar assignments changed. Your draft is preserved; choose a current authorized location or review the visit mode.'
          : 'The calendar operation was not accepted. Your draft is preserved.');
      }
    } finally { submitting.current = false; if (current(context)) { setBusy(false); context.setBusy(false); } }
  }
  async function reconcile(context: ModalContext<CalendarCommandReceipt>) {
    const request = identity.current; if (!request || submitting.current || !current(context)) return;
    submitting.current = true; setBusy(true); context.setBusy(true);
    try { const receipt = await client.calendar.receipts.get(request.key, { signal: context.signal });
      if (!current(context)) return;
      if (!receipt) setError('No receipt is currently visible. This does not prove the write was rolled back. Keep the original request identity.'); else accepted(receipt, context);
    } catch (cause) { if (current(context)) {
      if (cause instanceof CalendarReadError && calendarTransitionAuthorityDenied(cause)) setRetired(true);
      else setError('Reconciliation is unavailable. Keep the original request identity; do not repeat the mutation.');
    } }
    finally { submitting.current = false; if (current(context)) { setBusy(false); context.setBusy(false); } }
  }
  const times = Array.from({ length: 96 }, (_, index) => index * 15);
  if (detailDenied) return null;
  return <ControlledModal<CalendarCommandReceipt> open identityKey={session.key} busy={busy} dirty error={error} onOpenChange={open => { if (!open) onClose(); }} descriptor={{
    title: session.record ? 'Reschedule appointment' : 'New appointment', trigger: session.trigger,
    size: 'sm', customSize: { width: 'var(--calendar-size-420)' }, className: 'calendar-managed-dialog calendar-managed-radius-md',
    body: context => detailPending ? <Stack p="md" gap="sm"><Text>Reauthorizing current appointment details and management…</Text>
      {(authority.status === 'error' || management.status === 'error') && <><Text size="xs">The read is unavailable. Your draft is preserved but cannot be submitted until current access is verified.</Text>
        <Button variant="default" onClick={() => { authority.refresh(); management.refresh(); }}>Retry current access</Button></>}</Stack> : <form onSubmit={event => { event.preventDefault(); void submit(context); }}><Stack gap="xs" px="md" py="sm">
      <TextInput variant="unstyled" aria-label="Appointment title" placeholder="Add an appointment title" value={draft.title} readOnly={!!session.record} maxLength={160} onChange={event => change({ title: event.currentTarget.value })}
        styles={{ input: { padding: 0, fontWeight: 'var(--calendar-weight-medium)', fontSize: 'var(--calendar-font-size-md)' } }} />
      <>
        <Group gap="xs" className="calendar-editor-time-row"><IconClock size="var(--calendar-size-14)" /><TimePicker label="Start time" value={draft.start} options={times} onChange={start => change({ start })} /><Text size="xs">→</Text><TimePicker label="End time" value={draft.end} options={times.filter(minute => minute > draft.start)} onChange={end => change({ end })} /><CalendarDateField value={draft.date} onChange={date => change({ date })} /></Group>
        <Group gap="xs"><IconUser size="var(--calendar-size-14)" /><CalendarSelect aria-label="Appointment calendar" value={draft.resourceId} disabled={!!session.record} data={resources.map(resource => ({ value: resource.id, label: resource.label }))} onChange={id => { if (id) change({ resourceId: id }); }} /></Group>
      </>
      <CalendarVisitFields value={draft} locations={visitLocations.value} status={visitLocations.status} disabled={busy || phase !== 'editing'} canGoBack={locationHistory.length > 0}
        acceptedLocation={acceptedLocation} onChange={change} onRetry={visitLocations.refresh} onPrevious={() => locationPage(false)} onNext={() => locationPage(true)} />
      <Text size="xs" c="dimmed">Scheduling timezone · {timeZone ?? 'Choose a calendar'}{session.record && session.record.resourceIds.length > 1 ? ' · all reserved resources are preserved' : ''}</Text>
      <Text size="xs" c="dimmed">One-off core scheduling. Recurrence, invitees, notes, clinical visit progress and automatic reminders are unavailable, not silently saved.</Text>
      {staleBase && <Text role="status" size="xs">This appointment changed. Your draft is preserved without rebasing. Close and reload current details before another reschedule or cancellation.</Text>}
      {error && <Text role="status" size="xs" c="dimmed">{error}</Text>}
      {identity.current && phase === 'unknown' && <Text size="xs">Original request · {identity.current.key}</Text>}
      <Group justify="space-between" py="sm"><Button variant="subtle" onClick={() => { void context.requestClose('cancel'); }}>Close</Button>
        {phase === 'unknown' ? <Button disabled={busy} onClick={() => { void reconcile(context); }}>Reconcile original request</Button>
          : <Button type="submit" color="blue" disabled={phase !== 'editing' || staleBase || locationPending || !locationSelectable || !session.record && !resource}>{phase === 'submitting' ? 'Submitting…' : phase === 'accepted' ? 'Submitted revision accepted' : phase === 'conflict' || staleBase ? 'Reload current appointment' : session.record ? 'Reschedule' : 'Create appointment'}</Button>}
      </Group>
    </Stack></form>,
  }} />;
}
function matchesReceipt(identity: PendingIdentity, receipt: CalendarCommandReceipt): boolean {
  return receipt.requestId === identity.key && receipt.operation === identity.operation && (identity.id === undefined || receipt.id === identity.id);
}
function formatInstant(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'long' }).format(new Date(instant));
}
