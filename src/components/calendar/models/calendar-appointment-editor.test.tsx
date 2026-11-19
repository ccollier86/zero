/** Native modal/controller checks in MEMORY; not browser layout/focus or installed-package proof. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { CalendarAppointmentTransitions, CalendarAppointmentTypePage, CalendarAppointmentView, CalendarCommandReceipt,
  CalendarControlOptions, CalendarLocationPage, CalendarParticipantDirectoryPage, CalendarParticipantReference, CalendarParticipantsView,
  CalendarRequestOptions, CalendarResourceView, CalendarWatchOptions } from '../../../calendar/contracts';
import type { CalendarVisitLocationQuery } from '../../../calendar/contracts';
import { ClientProvider } from '../../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../../frontend/client/authorization-scope-hooks';
import { CalendarMutationError, CalendarReadError } from '../../../frontend/client/calendar-mutation';
import type { Client } from '../../../frontend/client/sdk';
import { configureFrontendObservability } from '../../../frontend/client/observability';
import { createHookContainer, installMinimalHookDom } from '../../../frontend/client/test-fixtures/react-hook-dom';
import { ModalHostContext } from '../../../modals/modal-host-context';
import { modals } from '../../../modals/modal-events';
import { modalStore } from '../../../modals/modal-store';
import type { ControlledModalProps } from '../../../modals/modal-controlled';
import type { ModalContext, ModalDescriptor } from '../../../modals/modal-system.types';
import { CalendarAppointmentEditor, type CalendarAppointmentEditorProps } from '../components/calendar-appointment-editor';
import { CalendarAppointmentResourceFields } from '../components/calendar-appointment-resource-fields';
import { CalendarParticipantFields } from '../components/calendar-participant-fields';
import { CalendarCoreTypeFields } from '../components/calendar-core-type-fields';
import { CalendarVisitFields } from '../components/calendar-visit-fields';
import { CalendarCivilDateField } from '../components/calendar-civil-date-field';
import { CalendarManagedForm } from '../components/calendar-surfaces';
import { AppointmentModal, AppointmentModalContent, type AppointmentModalContentProps } from '../recovered/appointment-modal/components/appointment-modal/AppointmentModal';
import type { CalendarPendingRequest } from './calendar-workspace-model';
import { calendarVisitDraft } from './calendar-visit-model';

const roots = new Set<Root>(); let restoreDom: () => void;
beforeEach(() => { restoreDom = installMinimalHookDom(); configureFrontendObservability({ http: false, console: false }); modals.discardAll(); });
afterEach(async () => { try { for (const root of roots) await act(async () => root.unmount()); }
  finally { roots.clear(); modals.discardAll(); restoreDom(); } });
const resource: CalendarResourceView = { id: 'a', label: 'Synthetic A', kind: 'person', ownerId: 'synthetic-user', timeZone: 'UTC', revision: 1, active: true };
const resources = [resource, { ...resource, id: 'b', label: 'Synthetic B' }, { ...resource, id: 'c', label: 'Synthetic C' }];
const record: CalendarAppointmentView = { id: 'appointment', revision: 4, resourceIds: ['a', 'b'], title: 'Accepted title',
  startAt: '2026-11-18T10:07:00.000Z', endAt: '2026-11-18T11:07:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 3, bufferAfterMinutes: 7,
  status: 'confirmed', createdBy: 'synthetic-user', visit: { mode: 'phone' } };
const type = { id: 'type', revision: 2, label: 'Current native type', durationMinutes: 60, bufferBeforeMinutes: 3, bufferAfterMinutes: 7, colorKey: null, active: true };
const oldRef = { kind: 'guardian-user' as const, userId: 'retained' }, newRef = { kind: 'guardian-user' as const, userId: 'new' };
const person = { ref: newRef, availability: 'available' as const, name: 'PRIVATE_CURRENT_NAME' };

test('approved content owns one native async update containing the full resource set and every supported changed field', async () => {
  const f = fixture(); await mountEditor(f);
  expect(opening().systemState?.dirty).toBe(false); expect(submitButton().props.disabled).toBe(true);
  await act(async () => { content().props.form.onChange({ title: 'Rich atomic change' });
    find(value => value.type === CalendarAppointmentResourceFields).props.onChange(['c', 'b', 'a']); });
  await act(async () => { find(value => value.type === CalendarCoreTypeFields).props.onChange(type); });
  await act(async () => { field('Start time').props.onChange(608); field('End time').props.onChange(668);
    find(value => value.type === CalendarVisitFields).props.onChange({ visitMode: 'video', visitLocation: undefined });
    find(value => value.type === CalendarParticipantFields).props.onChange([newRef]); });
  await submit(); await submit();
  expect(f.writes).toHaveLength(1); expect(f.writes[0]).toMatchObject({ operation: 'appointment.updated', control: { expectedRevision: 4 }, input: {
    title: 'Rich atomic change', resourceIds: ['a', 'b', 'c'], startAt: '2026-11-18T10:08:00.000Z', endAt: '2026-11-18T11:08:00.000Z',
    timeZone: 'UTC', bufferBeforeMinutes: 3, bufferAfterMinutes: 7, appointmentType: { id: type.id, revision: type.revision },
    visit: { mode: 'video' }, participants: [newRef] } });
  expect(f.unknown).toHaveLength(1); await accept(f); expect(f.accepted).toEqual([f.unknown[0]!]); expect(f.closed).toBe(1);
});

test('participant hydration is pristine, unavailable accepted refs can be kept or explicitly cleared, and optional omission needs no participant API', async () => {
  const f = fixture(), root = await mountEditor(f);
  const selected = find(value => value.type === CalendarParticipantFields);
  expect(selected.props.value).toEqual([oldRef]); expect(selected.props.accepted).toEqual([{ ref: oldRef, availability: 'unavailable' }]);
  expect(opening().systemState?.dirty).toBe(false);
  await title('Only title'); await submit(); expect(f.writes[0]!.input).not.toHaveProperty('participants');
  await act(async () => root.unmount()); roots.delete(root);
  const clear = fixture(); await mountEditor(clear); await act(async () => { find(value => value.type === CalendarParticipantFields).props.onChange([]); });
  await submit(); expect(clear.writes[0]!.input).toHaveProperty('participants', []);
  const none = fixture(); await act(async () => { for (const root of roots) root.unmount(); }); roots.clear();
  await mountEditor(none, false); expect(none.directories).toHaveLength(0); expect(none.bindings).toHaveLength(0);
  await title('No participant API'); await submit(); expect(none.writes[0]!.input).not.toHaveProperty('participants');
});

test('newer supported edits survive an older accepted update without closing, saving or silently rebasing them', async () => {
  const f = fixture(); await mountEditor(f); await title('Submitted title'); await submit();
  await title('Newer unsent title');
  expect(opening().descriptor?.allowEditingWhilePending).toBe(true);
  await act(async () => { find(value => value.type === CalendarAppointmentResourceFields).props.onChange(['a', 'c']);
    find(value => value.type === CalendarParticipantFields).props.onChange([]); });
  await accept(f); expect(f.closed).toBe(0); expect(f.accepted).toHaveLength(1);
  expect(content().props.form.value.title).toBe('Newer unsent title');
  expect(find(value => value.type === CalendarAppointmentResourceFields).props.value).toEqual(['a', 'c']);
  expect(find(value => value.type === CalendarParticipantFields).props.value).toEqual([]);
  expect(submitButton().props.disabled).toBe(true); expect(opening().systemState?.dirty).toBe(true);
  await submit(); expect(f.writes).toHaveLength(1);
});

test('unsupported recovered controls are explicitly unavailable and retained legacy field callbacks cannot leak their values', async () => {
  const f = fixture(); await mountEditor(f);
  const form = content().props.form;
  expect(form.repeatControl.props.children).toContain('unavailable'); expect(form.appearanceControl.props.children).toContain('unavailable');
  expect(field('Notes unavailable').props.disabled).toBe(true); expect(field('Send reminder · unavailable').props.disabled).toBe(true);
  expect(form.workflowControl.props.children).toContain('unavailable'); expect(form.telehealthControl).toBeNull();
  expect(find(value => value.type === CalendarVisitFields)).toBeDefined();
  for (const label of ['Location', 'Recurrence', 'Patient', 'Calendar / provider', 'Preview Telehealth link']) {
    expect(elements(body()).some(value => value.props['aria-label'] === label)).toBe(false);
  }
  await act(async () => { form.onChange({ notes: 'NEVER_WIRE', recurrence: 'weekly', sendReminder: true, status: 'completed', patientId: 'guest' }); });
  expect(opening().systemState?.dirty).toBe(false); await title('Supported title'); await submit();
  for (const key of ['notes', 'recurrence', 'reminder', 'sendReminder', 'status', 'patientId', 'appearance']) expect(f.writes[0]!.input).not.toHaveProperty(key);
});

test('an unrepresentable type end keeps exact manual times and explains the disabled save instead of clipping', async () => {
  const f = fixture(); await mountEditor(f);
  const tooLong = { ...type, id: 'long-type', durationMinutes: 1440 };
  await act(async () => { f.types.at(-1)!.resolve({ items: [tooLong], nextAfter: null, truncated: false }); });
  await act(async () => { find(value => value.type === CalendarCoreTypeFields).props.onChange(tooLong); });
  expect(field('Start time').props.value).toBe(607); expect(field('End time').props.value).toBe(667);
  expect(content().props.form.error).toContain('outside the editor’s same-day interval');
  expect(submitButton().props.disabled).toBe(true); await submit(); expect(f.writes).toEqual([]);
});

test('creation keeps the full set/type/participant fields and honors native configured resource ceilings', async () => {
  const f = fixture(), root = await mountEditor(f, true, false);
  expect(f.bindings).toHaveLength(0); expect(opening().systemState?.dirty).toBe(false);
  await act(async () => root.updateProps({ maxResources: 2 })); await title('New native appointment');
  await act(async () => find(value => value.type === CalendarAppointmentResourceFields).props.onChange(['a', 'b', 'c']));
  expect(submitButton().props.disabled).toBe(true); await submit(); expect(f.writes).toEqual([]);
  await act(async () => { find(value => value.type === CalendarAppointmentResourceFields).props.onChange(['b', 'a']);
    find(value => value.type === CalendarCoreTypeFields).props.onChange(type);
    find(value => value.type === CalendarParticipantFields).props.onChange([newRef]); });
  await submit(); expect(f.writes).toHaveLength(1); expect(f.writes[0]).toMatchObject({ operation: 'appointment.created', input: {
    resourceIds: ['a', 'b'], participants: [newRef], appointmentType: { id: type.id, revision: type.revision }, title: 'New native appointment' } });
  await accept(f); expect(f.closed).toBe(1);
});

test('quiet scope retirement fences retained callbacks before notification and withdraws the native owner on publication', async () => {
  const f = fixture(); await mountEditor(f); await title('No ghost dispatch'); const context = nativeContext(), oldId = opening().id;
  const retained = find(value => value.type === 'form').props.onSubmit;
  f.auth.authorizationScopeKey = 'replacement';
  await act(async () => retained({ preventDefault() {} })); expect(f.writes).toEqual([]); expect(f.unknown).toEqual([]);
  await act(async () => f.notify()); expect(context.signal.aborted).toBe(true);
  // A deliberately supplied session can be newly reauthorized in the new scope by this mock broker.
  // The old native identity and its retained callbacks must nevertheless be gone.
  expect(modalStore.getSnapshot().context.modals.some(value => value.id === oldId)).toBe(false);
  await act(async () => retained({ preventDefault() {} })); expect(f.writes).toEqual([]);
});

test('unknown outcome retains the original identity, reconciles without resending and rejects an impossible receipt revision', async () => {
  const f = fixture(); await mountEditor(f); await title('Uncertain update'); await submit();
  const first = f.writes[0]!;
  await act(async () => { first.pending.reject(new CalendarMutationError(first.control.idempotencyKey, 'unknown', 'CALENDAR_OUTCOME_UNKNOWN', 503)); });
  await submit(); expect(f.writes).toHaveLength(1); await click('Reconcile original request'); expect(f.receiptKeys).toEqual([first.control.idempotencyKey]);
  f.receipt = { ...receiptFor(first), revision: 6 }; await click('Reconcile original request'); expect(f.accepted).toEqual([]); expect(f.closed).toBe(0);
  f.receipt = receiptFor(first); await click('Reconcile original request'); expect(f.accepted).toHaveLength(1); expect(f.closed).toBe(1); expect(f.writes).toHaveLength(1);
});

test('current participant revision and read denial fence retained callbacks and withdraw private native ownership', async () => {
  const f = fixture(); await mountEditor(f); await title('Preserved draft'); const retained = find(value => value.type === 'form').props.onSubmit;
  await act(async () => { f.bindings[0]!.resolve({ id: record.id, revision: 5, participants: [person] }); });
  expect(submitButton().props.disabled).toBe(true); expect(find(value => value.type === CalendarParticipantFields).props.accepted).toBeUndefined();
  await act(async () => retained({ preventDefault() {} })); expect(f.writes).toEqual([]);
  const context = nativeContext();
  await act(async () => { f.bindings[0]!.options.onError?.(new CalendarReadError('CALENDAR_NOT_FOUND', 404)); });
  expect(f.lost).toBeGreaterThan(0); expect(context.signal.aborted).toBe(true); expect(modalStore.getSnapshot().context.modals).toEqual([]);
  await act(async () => retained({ preventDefault() {} })); expect(f.writes).toEqual([]);
});

test('same-owner prop refresh does not rebase typing; participant-mode retirement and A→B→A cannot revive old ownership', async () => {
  const f = fixture(), root = await mountEditor(f); await title('Local newer text');
  await act(async () => root.updateProps({ session: { ...root.props().session, timeZone: 'America/New_York', initial: { ...root.props().session.initial, title: 'Remote replacement' } } }));
  expect(content().props.form.value.title).toBe('Local newer text');
  expect(content().props.form.notice).toContain('Scheduling timezone · UTC.');
  await submit(); const context = nativeContext(), oldForm = find(value => value.type === 'form').props.onSubmit;
  expect(f.writes[0]!.input).toMatchObject({ timeZone: 'UTC', startAt: record.startAt });
  await act(async () => root.updateProps({ participants: false })); expect(context.signal.aborted).toBe(true);
  await act(async () => root.updateProps({ participants: true })); expect(modalStore.getSnapshot().context.modals).toEqual([]);
  await act(async () => { oldForm({ preventDefault() {} }); f.writes[0]!.pending.resolve(receiptFor(f.writes[0]!)); });
  expect(f.accepted).toEqual([]); expect(f.closed).toBe(0); expect(f.writes).toHaveLength(1);
  await act(async () => root.updateProps({ session: { ...root.props().session, key: 2 } }));
  const fresh = nativeContext(); await act(async () => root.updateProps({ client: fixture().client })); expect(fresh.signal.aborted).toBe(true);
  await act(async () => root.updateProps({ client: f.client })); expect(nativeContext()).not.toBe(fresh);
});

test('content extraction keeps the local synchronous API/default control anatomy and never awaits its callback', () => {
  const props: Parameters<typeof AppointmentModal>[0] = { opened: true, onClose() {}, event: { id: 'local', title: 'Local', start: 10, end: 11, meta: '', color: '', background: '' },
    isAddMode: true, selectedStartTime: null, selectedEndTime: null, startTimeOptions: [], endTimeOptions: [], onStartTimeChange() {}, onEndTimeChange() {},
    form: { kind: 'appointment', value: { title: '', date: '2026-11-18', providerId: '', patientId: null, visitType: null, recurrence: 'none', location: 'phone', notes: '', reminder: null, sendReminder: false, status: 'confirmed' },
      onChange() {}, onSubmit: () => false } };
  const modal = AppointmentModal(props), managed = elements(modal).find(value => value.type === CalendarManagedForm)!;
  expect(managed.props.onAccept()).toBe(false);
  const localContent = elements(modal).find(value => value.type === AppointmentModalContent)!;
  const nodes = elements(AppointmentModalContent(localContent.props as unknown as AppointmentModalContentProps));
  expect(nodes.find(value => value.props['aria-label'] === 'Appointment title')?.props.maxLength).toBe(160);
  for (const name of ['Calendar / provider', 'Recurrence', 'Notes', 'Reminder', 'Location']) expect(nodes.some(value => value.props['aria-label'] === name)).toBe(true);
});

test('all-day is capability gated and a selected type must be explicitly cleared before the toggle can convert', async () => {
  const f = fixture(), root = await mountEditor(f, false, false, true);
  await title('Explicit all-day creation');
  await act(async () => find(value => value.type === CalendarCoreTypeFields).props.onChange(type));
  const blocked = field('All-day appointment'); expect(blocked.props.disabled).toBe(true);
  await act(async () => blocked.props.onChange(true)); expect(field('All-day appointment').props.checked).toBe(false);
  expect(content().props.form.timeControls).toBeDefined();
  await act(async () => find(value => value.type === CalendarCoreTypeFields).props.onChange(null));
  await act(async () => field('All-day appointment').props.onChange(true));
  expect(field('All-day appointment').props.checked).toBe(true);
  expect(elements(body()).filter(value => value.type === CalendarCivilDateField).map(value => value.props.label)).toEqual(['All-day start date', 'All-day exclusive end date']);
  await submit(); expect(f.writes).toHaveLength(1); expect(f.writes[0]!.input).toEqual({ resourceIds: ['a', 'b'], title: 'Explicit all-day creation',
    interval: { kind: 'all-day-local-v1', startDate: '2026-11-18', endDate: '2026-11-19', timeZone: 'UTC' } });
  expect(f.writes[0]!.input).not.toHaveProperty('appointmentType'); expect(f.writes[0]!.input).not.toHaveProperty('startAt');
  await act(async () => root.unmount()); roots.delete(root);
  const older = fixture(); await mountEditor(older, false, false);
  expect(elements(body()).some(value => value.props.label === 'All-day appointment')).toBe(false);
});

test('accepted all-day metadata uses one atomic update, and newer authored dates survive its older receipt', async () => {
  const accepted: CalendarAppointmentView = { ...record, interval: { kind: 'all-day-local-v1', startDate: '2026-11-01', endDate: '2026-12-02', timeZone: 'UTC' },
    startAt: '2026-11-01T00:00:00.000Z', endAt: '2026-12-02T00:00:00.000Z', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
  const f = fixture(accepted); await mountEditor(f, true, true, true);
  expect(opening().systemState?.dirty).toBe(false); expect(submitButton().props.disabled).toBe(true);
  await title('All-day metadata');
  await act(async () => { find(value => value.type === CalendarAppointmentResourceFields).props.onChange(['a', 'c']); find(value => value.type === CalendarParticipantFields).props.onChange([]); });
  await submit(); expect(f.writes[0]!.input).toEqual({ title: 'All-day metadata', resourceIds: ['a', 'c'], participants: [] });
  await act(async () => find(value => value.type === CalendarCivilDateField && value.props.label === 'All-day exclusive end date').props.onChange('2026-12-01'));
  await accept(f); expect(f.closed).toBe(0); expect(f.accepted).toHaveLength(1);
  expect(find(value => value.type === CalendarCivilDateField && value.props.label === 'All-day exclusive end date').props.value).toBe('2026-12-01');
  expect(submitButton().props.disabled).toBe(true); expect(f.writes).toHaveLength(1);
});

test('all-day capability retirement withdraws the draft and fences retained callbacks without converting or resending', async () => {
  const f = fixture(), root = await mountEditor(f, false, false, true); await title('Retired all-day draft');
  await act(async () => field('All-day appointment').props.onChange(true));
  const retained = find(value => value.type === 'form').props.onSubmit, context = nativeContext();
  await act(async () => root.updateProps({ allDayAppointments: false }));
  expect(context.signal.aborted).toBe(true); expect(f.lost).toBeGreaterThan(0);
  await act(async () => { retained({ preventDefault() {} }); root.updateProps({ allDayAppointments: true }); });
  expect(modalStore.getSnapshot().context.modals).toEqual([]); expect(f.writes).toEqual([]);
});

test('an unknown all-day write reconciles only its original identity and never converts or resends the authored dates', async () => {
  const f = fixture(); await mountEditor(f, false, false, true); await title('Uncertain LocalDates');
  await act(async () => field('All-day appointment').props.onChange(true));
  await submit(); const write = f.writes[0]!;
  expect(write.input.interval).toEqual({ kind: 'all-day-local-v1', startDate: '2026-11-18', endDate: '2026-11-19', timeZone: 'UTC' });
  await act(async () => write.pending.reject(new CalendarMutationError(write.control.idempotencyKey, 'unknown', 'CALENDAR_OUTCOME_UNKNOWN', 503)));
  await submit(); expect(f.writes).toHaveLength(1);
  await click('Reconcile original request'); expect(f.receiptKeys).toEqual([write.control.idempotencyKey]); expect(f.accepted).toEqual([]);
  f.receipt = receiptFor(write); await click('Reconcile original request'); expect(f.accepted).toHaveLength(1); expect(f.writes).toHaveLength(1); expect(f.closed).toBe(1);
});

test('effective location discovery includes exact timed buffers, retires changed-basis pagination and leaves older wire unchanged', async () => {
  const f = fixture(), location = { id: 'location', revision: 2, label: 'Synthetic location', region: null, active: true };
  f.visitPage = { items: [location], nextAfter: 'location', truncated: true };
  const root = await mountEditor(f, false, true, false, true);
  await act(async () => find(value => value.type === CalendarVisitFields).props.onChange({ visitMode: 'in-person', visitLocation: location }));
  expect(f.visits[0]!.query.interval).toEqual({ startAt: '2026-11-18T10:04:00.000Z', endAt: '2026-11-18T11:14:00.000Z' });
  const retainedNext = find(value => value.type === CalendarVisitFields).props.onNext;
  await act(async () => retainedNext()); expect(f.visits.at(-1)!.query.after).toBe('location');
  await act(async () => { field('Start time').props.onChange(608); field('End time').props.onChange(668); });
  expect(f.visits.at(-1)!.query).not.toHaveProperty('after');
  expect(f.visits.at(-1)!.query.interval).toEqual({ startAt: '2026-11-18T10:05:00.000Z', endAt: '2026-11-18T11:15:00.000Z' });
  const count = f.visits.length; await act(async () => retainedNext()); expect(f.visits).toHaveLength(count);
  await act(async () => root.unmount()); roots.delete(root);
  const old = fixture(); old.visitPage = { items: [location], nextAfter: null, truncated: false }; await mountEditor(old, false);
  await act(async () => find(value => value.type === CalendarVisitFields).props.onChange({ visitMode: 'in-person', visitLocation: location }));
  expect(old.visits[0]!.query).not.toHaveProperty('interval');
});

test('accepted all-day discovery retains frozen coverage but new authored dates cannot inherit old UTC eligibility', async () => {
  const location = { id: 'location', revision: 2, label: 'Retained location', region: null };
  const source: CalendarAppointmentView = { ...record, interval: { kind: 'all-day-local-v1', startDate: '2026-10-15', endDate: '2026-11-15', timeZone: 'UTC' },
    startAt: '2026-10-15T00:00:00.000Z', endAt: '2026-11-15T01:00:00.000Z', bufferBeforeMinutes: 0, bufferAfterMinutes: 0, visit: { mode: 'in-person', location } };
  const f = fixture(source); await mountEditor(f, false, true, true, true);
  expect(f.visits[0]!.query.interval).toEqual({ startAt: source.startAt, endAt: source.endAt });
  expect(find(value => value.type === CalendarVisitFields).props.acceptedLocation).toEqual(location);
  await title('Historical location metadata'); expect(submitButton().props.disabled).toBe(false);
  await act(async () => find(value => value.type === CalendarCivilDateField && value.props.label === 'All-day exclusive end date').props.onChange('2026-11-14'));
  expect(f.visits.at(-1)!.query).not.toHaveProperty('interval');
  expect(find(value => value.type === CalendarVisitFields).props.acceptedLocation).toBeUndefined();
  expect(find(value => value.type === CalendarVisitFields).props.coverageHint).toContain('no UTC boundaries are guessed');
  expect(submitButton().props.disabled).toBe(true); expect(f.writes).toEqual([]);
});

test('location-policy capability retirement withdraws the native owner instead of silently downgrading its selection query', async () => {
  const f = fixture(), root = await mountEditor(f, false, true, false, true); await title('Preserved policy-aware draft');
  const retained = find(value => value.type === 'form').props.onSubmit, context = nativeContext();
  await act(async () => root.updateProps({ locationPolicies: false })); expect(context.signal.aborted).toBe(true);
  await act(async () => retained({ preventDefault() {} })); expect(f.writes).toEqual([]);
});

interface Subscription<T> { resolve(value: T): void; options: CalendarWatchOptions }
interface Write { operation: CalendarCommandReceipt['operation']; input: any; control: CalendarControlOptions | CalendarRequestOptions; pending: ReturnType<typeof deferred<CalendarCommandReceipt>> }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(acceptedRecord = record) {
  const observers = new Set<() => void>(), subscribe = (listener: () => void) => { observers.add(listener); return () => { observers.delete(listener); }; };
  const auth = { authorizationScopeKey: 'synthetic', user: { userId: 'synthetic-user' }, activeTenant: { tenantId: 'synthetic-tenant' }, isLoading: false,
    isRestoring: false, isAuthenticated: true, authorizationState: { status: 'ready' }, sessionTransition: { phase: 'idle', revision: 0 }, subscribe, subscribeAuthorization: subscribe };
  const f = { auth, writes: [] as Write[], unknown: [] as CalendarPendingRequest[], accepted: [] as CalendarPendingRequest[], rejected: [] as CalendarPendingRequest[],
    directories: [] as Subscription<CalendarParticipantDirectoryPage>[], bindings: [] as Subscription<CalendarParticipantsView>[], types: [] as Subscription<CalendarAppointmentTypePage>[],
    visits: [] as (Subscription<CalendarLocationPage> & { query: CalendarVisitLocationQuery })[], visitPage: { items: [], truncated: false, nextAfter: null } as CalendarLocationPage,
    receiptKeys: [] as string[], receipt: null as CalendarCommandReceipt | null, closed: 0, lost: 0, notify() { for (const listener of observers) listener(); } };
  function watch<T>(list: Subscription<T>[], resolve: (value: T) => void, options: CalendarWatchOptions, initial: T) { list.push({ resolve, options }); resolve(initial); return () => {}; }
  function write(operation: Write['operation'], input: unknown, control: Write['control']) { const pending = deferred<CalendarCommandReceipt>(); f.writes.push({ operation, input, control, pending }); return pending.promise; }
  const client = { auth, calendar: { appointments: { get: async () => acceptedRecord,
    watchTransitions(_id: string, resolve: (value: CalendarAppointmentTransitions) => void, options: CalendarWatchOptions) {
      return watch([], resolve, options, { id: acceptedRecord.id, revision: acceptedRecord.revision, policyRevision: 1, status: 'confirmed', allowed: [] }); },
    update(_id: string, input: unknown, control: CalendarControlOptions) { return write('appointment.updated', input, control); },
    create(input: unknown, control: CalendarRequestOptions) { return write('appointment.created', input, control); },
    reschedule() { throw new Error('No chained reschedule'); } },
    types: { watch(_query: unknown, resolve: (value: CalendarAppointmentTypePage) => void, options: CalendarWatchOptions) { return watch(f.types, resolve, options, { items: [type], nextAfter: null, truncated: false }); } },
    locations: { watchForVisit(query: CalendarVisitLocationQuery, resolve: (value: CalendarLocationPage) => void, options: CalendarWatchOptions) { f.visits.push({ query, resolve, options }); resolve(f.visitPage); return () => {}; } },
    participants: { watchDirectory(_query: unknown, resolve: (value: CalendarParticipantDirectoryPage) => void, options: CalendarWatchOptions) { return watch(f.directories, resolve, options, { items: [person], nextAfter: null, truncated: false }); },
      watchForAppointment(_id: string, resolve: (value: CalendarParticipantsView) => void, options: CalendarWatchOptions) { return watch(f.bindings, resolve, options, { id: acceptedRecord.id, revision: acceptedRecord.revision, participants: [{ ref: oldRef, availability: 'unavailable' }] }); },
      replace() { throw new Error('No chained participant save'); } }, receipts: { async get(key: string) { f.receiptKeys.push(key); return f.receipt; } } } } as unknown as Client;
  return Object.assign(f, { client, acceptedRecord });
}
type Fixture = ReturnType<typeof fixture>;
async function mountEditor(f: Fixture, participants = true, existing = true, allDayAppointments = false, locationPolicies = false) {
  const record = f.acceptedRecord;
  let props: Omit<CalendarAppointmentEditorProps, 'scopeKey'> = { client: f.client, resources, participants, allDayAppointments, locationPolicies,
    session: { key: 1, ...(existing ? { record } : {}), timeZone: 'UTC', initial: { resourceIds: ['a', 'b'], title: existing ? record.title : '', date: existing && record.interval ? record.interval.startDate : '2026-11-18', start: 607, end: 667,
      ...(existing && record.interval ? { intervalKind: 'all-day-local-v1', endDate: record.interval.endDate } : {}),
      ...(existing ? calendarVisitDraft(record.visit) : { visitMode: 'unspecified' }), bufferBeforeMinutes: existing ? record.bufferBeforeMinutes : 3, bufferAfterMinutes: existing ? record.bufferAfterMinutes : 7 } },
    onUnknown: value => f.unknown.push(value), onAccepted: value => f.accepted.push(value), onRejected: value => f.rejected.push(value), onClose: () => { f.closed++; }, onAuthorityLost: () => { f.lost++; } };
  function Scoped() { const boundary = useAuthorizationScopeBoundary(); return boundary.ready ? createElement(CalendarAppointmentEditor, { ...props, scopeKey: boundary.key }) : null; }
  const { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  function render() { root.render(createElement(ClientProvider, { client: f.client, children: createElement(ModalHostContext.Provider, { value: true, children: createElement(Scoped) }) })); }
  await act(async () => render());
  return Object.assign(root, { props: () => props, updateProps: (partial: Partial<typeof props>) => { props = { ...props, ...partial }; render(); } });
}
function opening() { const value = modalStore.getSnapshot().context.modals.find(value => !modalStore.getSnapshot().context.closingIds.includes(value.id)); expect(value).toBeDefined(); return value!; }
function nativeContext() { return modals.getContext(opening().id)! as ModalContext<CalendarCommandReceipt>; }
function body(): ReactNode {
  const context = nativeContext(), descriptor = opening().descriptor as ModalDescriptor<CalendarCommandReceipt>;
  const projected = typeof descriptor.body === 'function' ? descriptor.body(context) : descriptor.body;
  const bridge = (projected as ReactElement<{ bridge: { read(): ControlledModalProps<CalendarCommandReceipt> } }>).props.bridge;
  const current = bridge.read().descriptor; return typeof current.body === 'function' ? current.body(context) : current.body;
}
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.type === AppointmentModalContent ? AppointmentModalContent(node.props as unknown as AppointmentModalContentProps) : node.props.children)];
}
function find(predicate: (value: ReactElement<Record<string, any>>) => boolean) { const value = elements(body()).find(predicate); expect(value).toBeDefined(); return value!; }
function content() { return find(value => value.type === AppointmentModalContent); }
function field(label: string) { return find(value => value.props['aria-label'] === label || value.props.label === label); }
function submitButton() { return find(value => value.props.type === 'submit'); }
async function submit() { await act(async () => find(value => value.type === 'form').props.onSubmit({ preventDefault() {} })); }
async function title(value: string) { await act(async () => content().props.form.onChange({ title: value })); }
async function click(label: string) { await act(async () => find(value => value.props.children === label && typeof value.props.onClick === 'function').props.onClick()); }
function receiptFor(write: Write): CalendarCommandReceipt { return { requestId: write.control.idempotencyKey, operation: write.operation,
  id: write.operation === 'appointment.created' ? 'created' : record.id, revision: write.operation === 'appointment.created' ? 1 : record.revision + 1, changed: true }; }
async function accept(f: Fixture) { await act(async () => { const write = f.writes.at(-1)!; write.pending.resolve(receiptFor(write)); }); }
