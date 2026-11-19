'use client';
/** Connected one-off core scheduling. Existing full local editors remain independently usable; unsupported fields are never dropped into writes. */
import { useEffect, useRef, useState } from 'react';
import { ControlledModal } from '@zero/framework/modals';
import type { CalendarAppointmentView, CalendarCommandReceipt, CalendarResourceView } from '../../../calendar/contracts';
import { useClientMaybe } from '../../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../../frontend/client/authorization-scope-hooks';
import { calendarScopeReadable, useCalendarAppointment, useCalendarAppointments, useCalendarAppointmentDates, useCalendarResources, useCalendarAppointmentTransitions,
  useCalendarCapabilities, useCalendarAppointmentParticipants } from '../../../frontend/client/calendar-hooks';
import type { Client } from '../../../frontend/client/sdk';
import { CalendarSchedule } from './calendar-schedule';
import { CalendarHeader } from '../recovered/calendar/components/calendar-header';
import { CalendarSelect } from './calendar-select';
import { CalendarAppointmentEditor } from './calendar-appointment-editor';
import type { CalendarAppointmentEditorSession } from '../models/calendar-appointment-editor-model';
import { CalendarAppointmentParticipantsDialog } from './calendar-appointment-participants-dialog';
import { calendarVisitDraft, calendarVisitLabel } from '../models/calendar-visit-model';
import { CalendarAppointmentTransitionDialog } from './calendar-transition-dialog';
import { calendarTransitionAuthorityDenied, calendarTransitionProposal, type CalendarTransitionProposal } from '../models/calendar-transition-model';
import { isEnded, statusLabel } from '../models/appointment-presentation';
import { Button, Checkbox, Group, Stack, Text, Title } from './calendar-ui';
import { IconPlus, IconRotateClockwise } from './calendar-icons';
import { CalendarPendingRequestLedger, calendarPendingReceiptMatches, calendarUiResource, calendarWallTimeCandidates,
  calendarWorkspaceQueries, calendarZonedParts, projectCalendarAppointments, type CalendarPendingRequest as PendingIdentity } from '../models/calendar-workspace-model';
import type { CalendarViewMode } from '../recovered/calendar/types/calendar-view-mode';
import type { MenuTarget, SlotTarget } from '../types';
import { calendarAddDates, calendarCivilDays, calendarCivilDisplayDate, calendarCivilTitle, calendarFormatAllDayDates, calendarLocalDate, calendarShiftCivilDate } from '../models/calendar-local-date';
import { calendarWorkspaceDateQueries, mergeCalendarAppointmentPages, projectCalendarAllDayAppointments } from '../models/calendar-all-day-model';
import '../styles/calendar-workspace.css';

interface WorkspaceEditorSession extends CalendarAppointmentEditorSession {
  readonly selection: string;
  readonly participantAccess: boolean;
  readonly allDayAccess: boolean;
}

export interface ConnectedCalendarWorkspaceProps {
  /** Explicit display policy, never a guessed scheduling timezone. Resource scheduling zones remain authoritative. */
  readonly displayTimeZone: string;
  readonly initialDate?: Date;
  /** Authored civil selection, useful for all four-digit Gregorian years; exclusive with initialDate. */
  readonly initialDateKey?: string;
  readonly initialView?: CalendarViewMode;
  /** Defaults to native capability discovery; false hides participant UI without changing server permissions. */
  readonly participants?: boolean;
  /** App-owned setup/navigation. This component never installs providers or changes server configuration. */
  readonly onSetupRequested?: () => void;
  readonly className?: string;
}
export function ConnectedCalendarWorkspace(props: ConnectedCalendarWorkspaceProps) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  const owner = useRef({ client, revision: 0 });
  if (owner.current.client !== client) owner.current = { client, revision: owner.current.revision + 1 };
  let validZone = true; try { new Intl.DateTimeFormat('en', { timeZone: props.displayTimeZone }); } catch { validZone = false; }
  if (!validZone) return <WorkspaceState title="Choose a valid display timezone." />;
  if (props.initialDate !== undefined && (!(props.initialDate instanceof Date) || !Number.isFinite(props.initialDate.getTime()))) return <WorkspaceState title="Choose a valid calendar date." />;
  if (props.initialDateKey !== undefined && (!calendarLocalDate(props.initialDateKey) || props.initialDate !== undefined)) return <WorkspaceState title="Choose one valid Gregorian calendar date." />;
  if (!client || !boundary.ready) return <WorkspaceState title="Sign in and select an authorized workspace to use the calendar." />;
  return <CurrentCalendarWorkspace key={JSON.stringify([boundary.key, owner.current.revision])} {...props} client={client} scopeKey={boundary.key} />;
}
function CurrentCalendarWorkspace({ client, scopeKey, ...props }: ConnectedCalendarWorkspaceProps & { client: Client; scopeKey: string }) {
  const capabilities = useCalendarCapabilities();
  const [catalogCursor, setCatalogCursor] = useState<string | null>(null), [catalogHistory, setCatalogHistory] = useState<(string | null)[]>([]);
  const catalog = useCalendarResources(catalogCursor === null ? {} : { after: catalogCursor });
  const [day, setDay] = useState(() => props.initialDateKey ?? (props.initialDate
    ? `${String(props.initialDate.getFullYear()).padStart(4, '0')}-${String(props.initialDate.getMonth() + 1).padStart(2, '0')}-${String(props.initialDate.getDate()).padStart(2, '0')}`
    : calendarZonedParts(Date.now(), props.displayTimeZone).date));
  const date = calendarCivilDisplayDate(day);
  const [view, setView] = useState<CalendarViewMode>(props.initialView ?? 'week'), [selected, setSelected] = useState<string[]>([]), [focus, setFocus] = useState<string | null>(null);
  const [session, setSession] = useState<WorkspaceEditorSession | null>(null), [details, setDetails] = useState<{ id: string; selection: string; trigger?: HTMLElement } | null>(null);
  const [participantSession, setParticipantSession] = useState<{ record: CalendarAppointmentView; selection: string; trigger?: HTMLElement } | null>(null);
  const [transition, setTransition] = useState<{ record: CalendarAppointmentView; proposal: CalendarTransitionProposal; selection: string; trigger?: HTMLElement } | null>(null);
  const [pending, setPending] = useState<PendingIdentity | null>(null), [notice, setNotice] = useState(''), sessionKey = useRef(0);
  const requestLedger = useRef(new CalendarPendingRequestLedger()).current;
  function trackPending(request: PendingIdentity) { requestLedger.track(request); setPending(request); }
  function settlePending(request: PendingIdentity): boolean { if (!requestLedger.settle(request)) return false; setPending(null); return true; }
  const resources = catalog.value?.items.filter(resource => resource.active) ?? [], selectedResources = resources.filter(resource => selected.includes(resource.id));
  const focused = selectedResources.find(resource => resource.id === focus), displayed = view === 'week' || view === 'month' ? focused ? [focused] : [] : selectedResources;
  const resourceLimit = capabilities.value?.limits.maxResources ?? 16;
  const allDayAllowed = capabilities.status === 'ready' && capabilities.value?.allDayAppointments === true;
  let days: readonly string[] = [], proposedQueries: ReturnType<typeof calendarWorkspaceQueries> = [], proposedDateQueries: ReturnType<typeof calendarWorkspaceDateQueries> = [], invalidRange = false;
  try {
    days = calendarCivilDays(day, view);
    proposedQueries = calendarWorkspaceQueries(days, displayed.map(resource => resource.id), capabilities.value?.limits.maxRangeDays ?? 31, props.displayTimeZone);
    if (allDayAllowed) proposedDateQueries = calendarWorkspaceDateQueries(days, displayed.map(resource => resource.id), capabilities.value?.limits.maxRangeDays ?? 31);
  } catch { invalidRange = true; }
  const rangeUnsupported = invalidRange || proposedQueries.length > 2 || proposedDateQueries.length > 2 || displayed.length > resourceLimit;
  const queries = capabilities.status === 'ready' && !rangeUnsupported ? proposedQueries : [];
  const dateQueries = allDayAllowed && !rangeUnsupported ? proposedDateQueries : [];
  const first = useCalendarAppointments(queries[0] ?? null), second = useCalendarAppointments(queries[1] ?? null);
  const dateFirst = useCalendarAppointmentDates(dateQueries[0] ?? null), dateSecond = useCalendarAppointmentDates(dateQueries[1] ?? null);
  const readFailed = capabilities.status === 'error' || catalog.status === 'error' || first.status === 'error' || second.status === 'error'
    || dateFirst.status === 'error' || dateSecond.status === 'error';
  const ready = (!queries.length || first.status === 'ready' && (queries.length < 2 || second.status === 'ready'))
    && (!dateQueries.length || dateFirst.status === 'ready' && (dateQueries.length < 2 || dateSecond.status === 'ready'));
  const merged = mergeCalendarAppointmentPages(!readFailed && ready ? [first.value?.items ?? [], second.value?.items ?? [], dateFirst.value?.items ?? [], dateSecond.value?.items ?? []] : []);
  const failed = readFailed || merged.inconsistent;
  const byId = new Map((failed ? [] : merged.records).map(record => [record.id, record]));
  const projection = projectCalendarAppointments([...byId.values()], displayed.map(resource => resource.id), days, props.displayTimeZone, view);
  const allDayProjection = projectCalendarAllDayAppointments([...byId.values()], displayed.map(resource => resource.id), days);
  const truncated = first.value?.truncated || second.value?.truncated || dateFirst.value?.truncated || dateSecond.value?.truncated;
  // Denial/loading retires private overlays immediately. Ordinary admitted live snapshots do not replace a dirty draft.
  const overlayAllowed = !failed && !rangeUnsupported && capabilities.status === 'ready' && catalog.status === 'ready' && ready;
  const participantsAllowed = props.participants !== false && capabilities.status === 'ready' && capabilities.value?.participants === true;
  const editorModeCurrent = !session || session.participantAccess === participantsAllowed && session.allDayAccess === allDayAllowed;
  const selectionKey = JSON.stringify([displayed.map(resource => resource.id), days, props.displayTimeZone]);
  useEffect(() => { setDetails(null); setSession(null); setTransition(null); setParticipantSession(null); }, [selectionKey]);
  useEffect(() => { if (!overlayAllowed) { setDetails(null); setSession(null); setTransition(null); setParticipantSession(null); } }, [overlayAllowed]);
  // A restored capability may allow a new opening, never resurrect a retired
  // private draft with an old accepted base.
  useEffect(() => { if (!participantsAllowed) setParticipantSession(null); }, [participantsAllowed]);
  useEffect(() => { if (!editorModeCurrent) { setSession(null); setNotice('The available creation controls changed. The editor was withdrawn without submitting or silently omitting participants.'); } }, [editorModeCurrent]);
  function catalogPage(next: boolean) {
    if (pending || !calendarScopeReadable(client, scopeKey)) return;
    const after = next ? catalog.value?.nextAfter : catalogHistory.at(-1);
    if (after === undefined || next && after === null) return;
    setSelected([]); setFocus(null); setDetails(null); setSession(null);
    if (next) setCatalogHistory(history => [...history, catalogCursor]); else setCatalogHistory(history => history.slice(0, -1));
    setCatalogCursor(after);
  }
  function choose(id: string, checked: boolean) {
    const activeIds = new Set(resources.map(resource => resource.id));
    if (!activeIds.has(id) || !calendarScopeReadable(client, scopeKey)) return;
    // Explicit choice retires hidden catalog selections so a removed/revoked
    // resource cannot consume the ceiling while its checkbox no longer exists.
    setSelected(current => {
      const active = current.filter(value => activeIds.has(value));
      return checked ? active.includes(id) || active.length >= resourceLimit ? active : [...active, id] : active.filter(value => value !== id);
    });
    if (checked && !selectedResources.length) setFocus(id); else if (!checked && focus === id) setFocus(null);
  }
  function create(slot?: SlotTarget, trigger?: HTMLElement, allDay = false) {
    if (pending || allDay && !allDayAllowed || !calendarScopeReadable(client, scopeKey)) return;
    const resourceId = slot?.resourceId ?? focused?.id ?? displayed[0]?.id;
    if (!resourceId) return;
    const resource = resources.find(item => item.id === resourceId); if (!resource) return;
    // Keep a clicked instant when display and scheduling zones differ; never reinterpret the same clock label as another booking.
    const sameZone = allDay || new Intl.DateTimeFormat('en', { timeZone: resource.timeZone }).resolvedOptions().timeZone === new Intl.DateTimeFormat('en', { timeZone: props.displayTimeZone }).resolvedOptions().timeZone;
    let selectedDay = slot?.date ?? day, start = slot?.minute ?? 540, end = Math.min(start + 60, 1439);
    if (slot && !sameZone) {
      const candidates = calendarWallTimeCandidates(slot.date, slot.minute, props.displayTimeZone);
      if (candidates.length !== 1) { setNotice('The displayed slot is ambiguous or nonexistent. Use New appointment and choose an unambiguous time in the calendar scheduling timezone.'); return; }
      const from = calendarZonedParts(candidates[0]!, resource.timeZone), to = calendarZonedParts(Date.parse(candidates[0]!) + 3600_000, resource.timeZone);
      if (from.date !== to.date || from.minute >= to.minute || from.offset !== to.offset) { setNotice('This slot needs an exact-instant booking through the calendar API. The core editor will not change its date or guess a timezone offset.'); return; }
      selectedDay = from.date; start = from.minute; end = to.minute;
    }
    let endDate: string | undefined;
    if (allDay) { try { endDate = calendarAddDates(selectedDay, 1); } catch { setNotice('The exclusive end date must remain within four-digit Gregorian bounds.'); return; } }
    setSession({ key: ++sessionKey.current, selection: selectionKey, trigger, participantAccess: participantsAllowed, allDayAccess: allDayAllowed, timeZone: resource.timeZone,
      initial: { resourceIds: [resourceId], title: '', date: selectedDay, start, end, ...(allDay ? { intervalKind: 'all-day-local-v1', endDate } : {}) } });
  }
  function menu(target: MenuTarget, trigger: HTMLElement) {
    if (target.kind === 'slot') create(target.slot, trigger);
    else { const source = projection.sourceByEventId.get(target.eventId) ?? allDayProjection.sourceByOccurrenceId.get(target.eventId); if (source) setDetails({ id: source.id, selection: selectionKey, trigger }); }
  }
  function edit(record: CalendarAppointmentView, trigger?: HTMLElement) {
    if (pending || !calendarScopeReadable(client, scopeKey)) return;
    if (record.interval) {
      if (!allDayAllowed) { setNotice('All-day appointment editing is unavailable for this server capability.'); return; }
      setSession({ key: ++sessionKey.current, selection: selectionKey, record, trigger, participantAccess: participantsAllowed, allDayAccess: allDayAllowed, timeZone: record.interval.timeZone,
        initial: { resourceIds: [...record.resourceIds], title: record.title, date: record.interval.startDate, endDate: record.interval.endDate,
          intervalKind: 'all-day-local-v1', start: 540, end: 600, ...calendarVisitDraft(record.visit) } });
      return;
    }
    const start = calendarZonedParts(record.startAt, record.timeZone), end = calendarZonedParts(record.endAt, record.timeZone);
    if (start.date !== end.date || start.second || end.second || start.offset !== end.offset
      || Date.parse(record.startAt) % 60000 !== 0 || Date.parse(record.endAt) % 60000 !== 0) {
      setNotice('This appointment needs an exact-instant reschedule through the calendar API; the minute-precision core editor will not alter it.'); return;
    }
    setSession({ key: ++sessionKey.current, selection: selectionKey, record, trigger, participantAccess: participantsAllowed, allDayAccess: allDayAllowed, timeZone: record.timeZone,
      initial: { resourceIds: [...record.resourceIds], title: record.title, date: start.date, start: start.minute, end: end.minute, ...calendarVisitDraft(record.visit) } });
  }
  function refreshAppointments() { first.refresh(); second.refresh(); dateFirst.refresh(); dateSecond.refresh(); }
  function navigate(direction: number) { try { setDay(calendarShiftCivilDate(day, view, direction)); } catch { setNotice('This calendar step exceeds four-digit Gregorian bounds. No date was clipped.'); } }
  async function reconcile() {
    if (!pending || !calendarScopeReadable(client, scopeKey)) return;
    const captured = requestLedger.beginReconciliation(); if (!captured) return;
    try {
      const receipt = await client.calendar.receipts.get(captured.key);
      if (!calendarScopeReadable(client, scopeKey)) return;
      if (!receipt || !calendarPendingReceiptMatches(captured, receipt)) { setNotice('No matching receipt is visible yet. This does not prove rollback; keep the original request identity.'); return; }
      if (settlePending(captured)) { setNotice('The original calendar request was accepted. Current authorized data will be loaded separately.'); refreshAppointments(); }
    } catch { if (calendarScopeReadable(client, scopeKey)) setNotice('The original request could not be reconciled. Do not repeat the write with a new identity.'); }
    finally { requestLedger.finishReconciliation(captured); }
  }
  if (capabilities.status === 'idle' || capabilities.status === 'loading' || catalog.status === 'idle' || catalog.status === 'loading') return <WorkspaceState title="Loading authorized calendars…" />;
  if (failed) return <WorkspaceState title={catalog.code === 'CALENDAR_NOT_READY' || capabilities.code === 'CALENDAR_NOT_READY' ? 'Calendar setup is required.' : 'Calendar data is unavailable or access has changed.'}
    description="Private events and open editors have been withdrawn. Retrying only reloads authorized reads." onRetry={() => { capabilities.refresh(); catalog.refresh(); refreshAppointments(); }}
    onClearSelection={selected.length ? () => { setSelected([]); setFocus(null); catalog.refresh(); } : undefined} onSetup={props.onSetupRequested} />;
  if (!catalog.value?.items.length && !catalogCursor && !catalog.value?.truncated) return <WorkspaceState title="No authorized active calendars yet." description="A delegated calendar manager can create a calendar with an explicit scheduling timezone. No sample people or appointments are added."
    onRetry={catalog.refresh} onSetup={props.onSetupRequested} />;
  return <section className={`zero-calendar calendar-workspace ${props.className ?? ''}`} aria-label="Calendar workspace">
    <Group justify="space-between" mb="sm"><Text size="xs" c="dimmed">Display timezone · {props.displayTimeZone}</Text><Group gap="xs">
      <Button variant="subtle" aria-label="Reload authorized calendar data" onClick={() => { capabilities.refresh(); catalog.refresh(); refreshAppointments(); }}><IconRotateClockwise />Refresh</Button>
      <Button disabled={!displayed.length || !!pending || rangeUnsupported} onClick={event => create(undefined, event.currentTarget)}><IconPlus />New appointment</Button>
    </Group></Group>
    <Group gap="sm" mb="sm" aria-label="Choose calendars">{resources.map(resource => <Checkbox key={resource.id} label={resource.label} checked={selected.includes(resource.id)} disabled={!selected.includes(resource.id) && selectedResources.length >= resourceLimit} onChange={checked => choose(resource.id, checked)} />)}</Group>
    {(!resources.length || catalog.value?.truncated || catalogHistory.length > 0) && <Group justify="space-between" mb="sm"><Text size="xs" c="dimmed" role="status">{!resources.length ? 'No active calendars on this catalog page. ' : ''}Catalog page {catalogHistory.length + 1} · changing pages clears the selected calendars.</Text><Group gap="xs">
      <Button variant="subtle" disabled={!catalogHistory.length || !!pending} onClick={() => catalogPage(false)}>Previous calendars</Button>
      <Button variant="default" disabled={!catalog.value?.nextAfter || !!pending} onClick={() => catalogPage(true)}>Next calendars</Button>
    </Group></Group>}
    <CalendarHeader date={date} title={<Title order={4}>{invalidRange ? day : calendarCivilTitle(day, view)}</Title>} viewMode={view} onPrevious={() => navigate(-1)} onNext={() => navigate(1)}
      onToday={() => setDay(calendarZonedParts(Date.now(), props.displayTimeZone).date)} onViewChange={setView}
      providerSwitcher={(view === 'week' || view === 'month') && <CalendarSelect aria-label="Focused calendar" placeholder="Choose a focused calendar" value={focused?.id ?? null} data={selectedResources.map(resource => ({ value: resource.id, label: resource.label }))} onChange={id => setFocus(id)} />} />
    {rangeUnsupported ? <WorkspaceState title="This view exceeds the calendar's configured read limits." description="Choose Day view or fewer calendars. The workspace does not silently show a partial schedule or open dozens of parallel streams." />
      : !displayed.length ? <WorkspaceState title={selectedResources.length ? 'Choose a focused calendar for week or month.' : 'Choose calendars to see the schedule.'} />
      : !ready ? <WorkspaceState title="Loading authorized appointments…" />
      : <CalendarSchedule date={date} civilDate={day} days={days} onDaySelect={setDay} view={view} today={calendarZonedParts(Date.now(), props.displayTimeZone).date} resources={displayed.map(calendarUiResource)} events={projection.events}
        allDayOccurrences={allDayAllowed ? allDayProjection.occurrences : undefined} onCreateAllDay={allDayAllowed ? (resourceId, selectedDay, trigger) => create({ resourceId, date: selectedDay, minute: 540 }, trigger, true) : undefined}
        onDateSelect={value => setDay(`${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`)} onMenu={menu} onEdit={event => { const source = projection.sourceByEventId.get(event.id); if (source) setDetails({ id: source.id, selection: selectionKey }); }}
        onDetails={event => { const source = projection.sourceByEventId.get(event.id); if (source) setDetails({ id: source.id, selection: selectionKey }); }} eventPresentation={() => ({ clinical: false, coreOnly: true })} />}
    {!!projection.supplemental.length && <details><summary>Outside grid hours or exact-instant appointments ({projection.supplemental.length})</summary><Stack gap="xs">{projection.supplemental.map(record => <Button key={record.id} variant="subtle" onClick={event => setDetails({ id: record.id, selection: selectionKey, trigger: event.currentTarget })}>{record.title} · {formatInstant(record.startAt, props.displayTimeZone)}</Button>)}</Stack></details>}
    <div className="calendar-workspace-foot"><Text size="xs" role="status">{truncated ? 'Results are truncated. Narrow the range or selected calendars; this is not a complete availability view.' : notice || 'One-off appointments · grid 7 AM–7 PM · no recurrence, invitations or automatic reminders.'}</Text>
      {pending && <Group gap="xs"><Text size="xs">Unsettled request · {pending.key}</Text><Button variant="default" disabled={!!session} onClick={() => { void reconcile(); }}>Reconcile original request</Button></Group>}
    </div>
    {overlayAllowed && details?.selection === selectionKey && <CoreDetails key={details.id} id={details.id} trigger={details.trigger} scopeKey={scopeKey} client={client} displayTimeZone={props.displayTimeZone}
      participants={participantsAllowed} onParticipants={record => { if (!pending && calendarScopeReadable(client, scopeKey)) setParticipantSession({ record, selection: selectionKey, trigger: details.trigger }); }}
      revision={`${first.invalidationRevision}/${first.reconnectRevision}/${second.invalidationRevision}/${second.reconnectRevision}/${byId.get(details.id)?.revision ?? 'unlisted'}`}
      onClose={() => setDetails(null)} onEdit={record => edit(record, details.trigger)}
      onTransition={(record, proposal) => { if (!pending && calendarScopeReadable(client, scopeKey)) setTransition({ record, proposal, selection: selectionKey, trigger: details.trigger }); }} />}
    {overlayAllowed && transition?.selection === selectionKey && <CalendarAppointmentTransitionDialog key={`${transition.record.id}:${transition.record.revision}:${transition.proposal.status}`}
      record={transition.record} proposal={transition.proposal} trigger={transition.trigger} client={client} scopeKey={scopeKey}
      onClose={() => setTransition(null)} onAuthorityLost={() => { setTransition(null); setNotice('Status controls were withdrawn because current appointment management is no longer authorized.'); }}
      onUnknown={trackPending} onRejected={settlePending} onAccepted={request => { if (settlePending(request)) setNotice('The submitted status change was accepted.'); }} />}
    {overlayAllowed && participantsAllowed && participantSession?.selection === selectionKey && <CalendarAppointmentParticipantsDialog
      key={`${participantSession.record.id}:${participantSession.record.revision}`} record={participantSession.record} client={client} scopeKey={scopeKey} trigger={participantSession.trigger}
      maxParticipants={capabilities.value?.limits.maxParticipants}
      onClose={() => setParticipantSession(null)} onAuthorityLost={() => { setParticipantSession(null); setNotice('Participant controls were withdrawn because current access changed.'); }}
      onUnknown={trackPending} onRejected={settlePending} onAccepted={request => { if (settlePending(request)) setNotice('The submitted participant set was accepted.'); }} />}
    {overlayAllowed && editorModeCurrent && session?.selection === selectionKey && <CalendarAppointmentEditor key={session.key} session={session} resources={resources} client={client} scopeKey={scopeKey}
      participants={participantsAllowed} allDayAppointments={allDayAllowed} locationPolicies={capabilities.value?.locationPolicies === true} maxParticipants={capabilities.value?.limits.maxParticipants} maxResources={resourceLimit}
      readRevision={`${first.invalidationRevision}/${first.reconnectRevision}/${second.invalidationRevision}/${second.reconnectRevision}/${dateFirst.invalidationRevision}/${dateFirst.reconnectRevision}/${dateSecond.invalidationRevision}/${dateSecond.reconnectRevision}/${session.record ? byId.get(session.record.id)?.revision ?? 'unlisted' : 'new'}`}
      onAuthorityLost={() => { setSession(null); setNotice('The appointment editor was withdrawn because current details are no longer authorized. Any unsettled request still requires reconciliation.'); }}
      onClose={() => setSession(null)} onUnknown={trackPending} onRejected={settlePending} onAccepted={request => { if (settlePending(request)) setNotice('The submitted calendar request was accepted.'); }} />}
  </section>;
}
function WorkspaceState({ title, description, onRetry, onSetup, onClearSelection }: { title: string; description?: string; onRetry?(): void; onSetup?(): void; onClearSelection?(): void }) {
  return <div className="calendar-empty"><Text fw="var(--calendar-weight-heading)">{title}</Text>{description && <Text size="xs" c="dimmed">{description}</Text>}<Group gap="xs">{onRetry && <Button variant="default" onClick={onRetry}>Retry read</Button>}{onClearSelection && <Button variant="subtle" onClick={onClearSelection}>Clear calendar selection</Button>}{onSetup && <Button onClick={onSetup}>Calendar setup</Button>}</Group></div>;
}
function CoreDetails({ id, trigger, scopeKey, client, displayTimeZone, revision, participants, onClose, onEdit, onTransition, onParticipants }: {
  id: string; trigger?: HTMLElement; scopeKey: string; client: Client; displayTimeZone: string; revision: string; participants: boolean;
  onClose(): void; onEdit(record: CalendarAppointmentView): void; onParticipants(record: CalendarAppointmentView): void;
  onTransition(record: CalendarAppointmentView, proposal: CalendarTransitionProposal): void;
}) {
  const detail = useCalendarAppointment(id, revision);
  const transitions = useCalendarAppointmentTransitions(id);
  const people = useCalendarAppointmentParticipants(participants ? id : null, revision);
  const [nextStatus, setNextStatus] = useState<string | null>(null);
  const record = detail.value;
  const currentPeople = record && people.status === 'ready' && people.value?.id === record.id && people.value.revision === record.revision ? people.value : null;
  const available = record && transitions.status === 'ready' && transitions.value?.id === record.id
    && transitions.value.revision === record.revision && transitions.value.status === (record.lifecycle?.status ?? record.status) ? transitions.value : null;
  const proposal = record && available && nextStatus ? calendarTransitionProposal(record, available, nextStatus as CalendarTransitionProposal['status']) : null;
  const live = useRef({ record, available, people: currentPeople, participants, proposal });
  live.current = { record, available, people: currentPeople, participants, proposal };
  if (detail.status === 'error') return <WorkspaceState title="Appointment details are no longer available." onRetry={detail.refresh} />;
  type DetailAction = { kind: 'reschedule'; record: CalendarAppointmentView }
    | { kind: 'participants'; record: CalendarAppointmentView }
    | { kind: 'transition'; record: CalendarAppointmentView; proposal: CalendarTransitionProposal };
  const current = () => record !== null && live.current.record === record && calendarScopeReadable(client, scopeKey);
  return <ControlledModal<DetailAction> open identityKey={id} onOpenChange={open => { if (!open) onClose(); }}
    onResult={result => {
      if (result.kind !== 'accepted' || !current() || result.value.record.id !== record!.id || result.value.record.revision !== record!.revision) return;
      if (result.value.kind === 'participants') { if (live.current.participants && live.current.people === currentPeople && currentPeople) onParticipants(record!); }
      else if (result.value.kind === 'reschedule') { if (live.current.available === available && available) onEdit(record!); }
      else if (live.current.proposal === proposal && proposal) onTransition(record!, result.value.proposal);
    }}
    descriptor={{ title: 'Appointment details', trigger, size: 'sm', customSize: { width: 'var(--calendar-size-440)' }, className: 'calendar-managed-dialog calendar-managed-radius-md', body: context => <Stack gap="md" p="md">
      {!record ? <Text>Loading current authorized details…</Text> : <><Text fw="var(--calendar-weight-heading)">{record.title}</Text><Text size="xs">{statusLabel(record.lifecycle?.status ?? record.status)} · revision {record.revision}</Text>
        {record.interval ? <><Text size="sm">All-day · {calendarFormatAllDayDates(record.interval.startDate, record.interval.endDate)}</Text>
          <Text size="xs" c="dimmed">Authored dates · {record.interval.timeZone}. These labels do not move with the display timezone.</Text></> : <Text size="sm">{formatInstant(record.startAt, displayTimeZone)} → {formatInstant(record.endAt, displayTimeZone)}</Text>}
        <Text size="sm">{calendarVisitLabel(record.visit)}</Text>
        <Text size="xs" c="dimmed">Display · {displayTimeZone}<br />Scheduling · {record.timeZone}<br />Buffers · {record.bufferBeforeMinutes} minutes before / {record.bufferAfterMinutes} minutes after</Text>
        {record.lifecycle?.reason && <Text size="sm">Reason · {record.lifecycle.reason}</Text>}
        {participants && <Stack gap="xs"><Text fw="var(--calendar-weight-medium)">Participants</Text>
          {currentPeople ? currentPeople.participants.length ? currentPeople.participants.map((person, index) => <Text key={person.ref.userId} size="sm">
            {person.availability === 'available' ? person.name : `Unavailable participant ${index + 1}`}</Text>) : <Text size="xs" c="dimmed">No account participants selected.</Text>
            : <Text size="xs" role="status">{people.status === 'error' ? 'Participant details are unavailable or access changed.' : 'Loading current authorized participants…'}</Text>}
          {people.status === 'error' && <Button variant="subtle" onClick={people.refresh}>Retry participant read</Button>}
          {currentPeople && !isEnded(record.lifecycle?.status ?? record.status) && <Button variant="default" onClick={() => {
            if (current() && live.current.participants && live.current.people === currentPeople && !context.signal.aborted) context.accept({ kind: 'participants', record });
          }}>Manage participants…</Button>}
        </Stack>}
        <Text size="xs" c="dimmed">Clinical progress, lobby, recurrence and automatic notifications are not enabled by these controls. Participant selection does not send invitations or grant access.</Text>
        {available && !isEnded(record.lifecycle?.status ?? record.status) && <Button variant="default" onClick={() => {
          if (current() && live.current.available === available && !context.signal.aborted) context.accept({ kind: 'reschedule', record });
        }}>Edit appointment</Button>}
        {available && available.allowed.length > 0 && <Stack gap="xs"><CalendarSelect aria-label="Change appointment status" placeholder="Choose a status change" value={nextStatus}
          data={available.allowed.map(item => ({ value: item.status, label: `${statusLabel(item.status)}${item.requiresReason ? ' · reason required' : ''}` }))} onChange={setNextStatus} />
          <Button variant="default" disabled={!proposal} onClick={() => {
            if (current() && proposal && live.current.proposal === proposal && !context.signal.aborted) context.accept({ kind: 'transition', record, proposal });
          }}>Review status change…</Button></Stack>}
        {transitions.status === 'error' && <Text size="xs" c="dimmed">Status management is unavailable for your current access.</Text>}</>}
    </Stack> }} />;
}
function formatInstant(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'long' }).format(new Date(instant));
}
