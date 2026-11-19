/**
 * Actual parent hooks + normally mounted native overlay controllers in memory.
 * The test adapter captures the workspace's pre-host presentation tree and mounts
 * its real overlays; it does not render calendar widgets or certify a browser.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { CalendarAppointmentPage, CalendarAppointmentTransitions, CalendarAppointmentView, CalendarCapabilities, CalendarCommandReceipt,
  CalendarControlOptions, CalendarParticipantDirectoryPage, CalendarParticipantsView, CalendarResourcePage, CalendarResourceView, CalendarWatchOptions } from '../../../calendar/contracts';
import { ClientProvider } from '../../../frontend/client/client-context';
import type { Client } from '../../../frontend/client/sdk';
import { CalendarMutationError, CalendarReadError } from '../../../frontend/client/calendar-mutation';
import { configureFrontendObservability } from '../../../frontend/client/observability';
import { createHookContainer, installMinimalHookDom } from '../../../frontend/client/test-fixtures/react-hook-dom';
import { ModalHostContext } from '../../../modals/modal-host-context';
import { modals } from '../../../modals/modal-events';
import { modalStore } from '../../../modals/modal-store';
import type { ModalContext, ModalDescriptor } from '../../../modals/modal-system.types';
import type { ControlledModalProps } from '../../../modals/modal-controlled';
import { ConnectedCalendarWorkspace, type ConnectedCalendarWorkspaceProps } from '../components/calendar-workspace';
import { CalendarSchedule } from '../components/calendar-schedule';
import { CalendarAppointmentEditor } from '../components/calendar-appointment-editor';
import { CalendarAppointmentResourceFields } from '../components/calendar-appointment-resource-fields';
import { AppointmentModalContent, type AppointmentModalContentProps } from '../recovered/appointment-modal/components/appointment-modal/AppointmentModal';
import { CalendarAppointmentParticipantsDialog } from '../components/calendar-appointment-participants-dialog';
import { CalendarAppointmentTransitionDialog } from '../components/calendar-transition-dialog';
import { CalendarParticipantFields } from '../components/calendar-participant-fields';
import { Checkbox } from '../components/calendar-ui';

const roots = new Set<Root>(); let restore: () => void;
beforeEach(() => { restore = installMinimalHookDom(); configureFrontendObservability({ http: false, console: false }); modals.discardAll(); });
afterEach(async () => { try { for (const root of roots) await act(async () => root.unmount()); } finally { roots.clear(); modals.discardAll(); restore(); } });
const resource: CalendarResourceView = { id: 'resource-a', label: 'Synthetic calendar', kind: 'person', ownerId: 'synthetic-user', revision: 1, timeZone: 'UTC', active: true };
const record: CalendarAppointmentView = { id: 'appointment-a', revision: 4, resourceIds: [resource.id], title: 'Synthetic booking', startAt: '2026-11-16T10:00:00.000Z',
  endAt: '2026-11-16T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'synthetic-user' };
const person = { ref: { kind: 'guardian-user' as const, userId: 'PRIVATE_ACCOUNT_ID' }, availability: 'available' as const, name: 'PRIVATE_AUTHORIZED_NAME' };
const capabilities: CalendarCapabilities = { timeZone: 'UTC', createOwn: true, manage: true, participants: true,
  limits: { maxResources: 16, maxRangeDays: 31, maxPageSize: 100, maxParticipants: 100 } };

test('the parent respects native participant capability and an explicit true UI hint grants nothing', async () => {
  const f = fixture({ ...capabilities, participants: false }), view = await mountWorkspace(f, { participants: true });
  await chooseCalendar(view); await clickView(view, 'New appointment');
  expect(f.directories).toHaveLength(0);
  expect(elements(body()).some(value => value.type === CalendarParticipantFields)).toBe(false);
  expect(view.find(value => value.type === CalendarAppointmentEditor).props.participants).toBe(false);
});

test('an explicit false participant UI option avoids both directory and private binding reads despite native capability', async () => {
  const f = fixture(), view = await mountWorkspace(f, { participants: false }); await chooseCalendar(view); await openDetails(view);
  expect(f.bindings).toHaveLength(0); expect(f.directories).toHaveLength(0);
  expect(textContent(body())).not.toContain(person.name); expect(textContent(body())).not.toContain('Manage participants…');
});

test('workspace opens the approved rich editor with native limits and saves changed resources, title and participants in one command', async () => {
  const f = fixture(), view = await mountWorkspace(f), replacement = { ...resource, id: 'resource-b', label: 'Second authorized calendar', timeZone: 'America/New_York' };
  await act(async () => f.catalogs[0]!.resolve({ items: [resource, replacement], truncated: false, nextAfter: null }));
  await chooseCalendar(view); await openDetails(view); await clickBody('Edit appointment');
  const editor = view.find(value => value.type === CalendarAppointmentEditor);
  expect(editor.props.maxResources).toBe(capabilities.limits.maxResources);
  expect(editor.props.maxParticipants).toBe(capabilities.limits.maxParticipants);
  expect(editor.props.session.timeZone).toBe('UTC');
  expect(editor.props.session.initial.resourceIds).toEqual([resource.id]);
  expect(elements(body()).filter(value => value.type === AppointmentModalContent)).toHaveLength(1);
  expect(activeOpening()?.descriptor?.allowEditingWhilePending).toBe(true);
  await act(async () => {
    bodyFind(value => value.props['aria-label'] === 'Appointment title').props.onChange({ currentTarget: { value: 'One combined change' } });
    bodyFind(value => value.type === CalendarAppointmentResourceFields).props.onChange([replacement.id]);
    bodyFind(value => value.type === CalendarParticipantFields).props.onChange([]);
  });
  await act(async () => bodyFind(value => value.type === 'form').props.onSubmit({ preventDefault() {} }));
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ operation: 'appointment.updated', control: { expectedRevision: record.revision },
    input: { title: 'One combined change', resourceIds: [replacement.id], participants: [] } });
  expect(view.find(value => value.type === CalendarAppointmentEditor).props.session.timeZone).toBe('UTC');
  await act(async () => bodyFind(value => value.props['aria-label'] === 'Appointment title').props.onChange({ currentTarget: { value: 'Newer unsent title' } }));
  await act(async () => f.writes[0]!.pending.resolve({ requestId: f.writes[0]!.control.idempotencyKey, operation: 'appointment.updated',
    id: record.id, revision: record.revision + 1, changed: true }));
  expect(activeOpening()?.title).toBe('Edit appointment');
  expect(bodyFind(value => value.props['aria-label'] === 'Appointment title').props.value).toBe('Newer unsent title');
  expect(bodyFind(value => value.props.type === 'submit').props.disabled).toBe(true);
  expect(f.writes).toHaveLength(1);
});

test('participant capability retirement cannot silently create a booking after removing chosen references', async () => {
  const f = fixture(), view = await mountWorkspace(f); await chooseCalendar(view); await clickView(view, 'New appointment');
  await act(async () => { bodyFind(value => value.props['aria-label'] === 'Appointment title').props.onChange({ currentTarget: { value: 'Synthetic selected participant' } }); });
  await act(async () => { bodyFind(value => value.type === CalendarParticipantFields).props.onChange([person.ref]); });
  const retained = bodyFind(value => value.type === 'form').props.onSubmit;
  await act(async () => { f.caps[0]!.resolve({ ...capabilities, participants: false }); });
  await act(async () => { retained({ preventDefault() {} }); });
  const active = activeOpening();
  if (active?.title === 'New appointment') {
    const submit = elements(body()).find(value => value.props.type === 'submit');
    expect(submit?.props.disabled).toBe(true);
    await act(async () => { bodyFind(value => value.type === 'form').props.onSubmit({ preventDefault() {} }); });
  }
  expect(f.writes).toEqual([]);
});

test('parent details route to a separate participant CAS and recovery survives overlay retirement with its exact revision', async () => {
  const f = fixture(), view = await mountWorkspace(f); await chooseCalendar(view); await openDetails(view);
  expect(textContent(body())).toContain(person.name);
  expect(textContent(body())).not.toContain(person.ref.userId);
  await clickBody('Manage participants…');
  expect(activeOpening()?.title).toBe('Edit appointment participants');
  expect(view.find(value => value.type === CalendarAppointmentParticipantsDialog).props.record.revision).toBe(record.revision);
  await act(async () => { bodyFind(value => value.type === CalendarParticipantFields).props.onChange([]); });
  await act(async () => { bodyFind(value => value.type === 'form').props.onSubmit({ preventDefault() {} }); });
  expect(f.writes).toHaveLength(1);
  const write = f.writes[0]!;
  expect(write.control.expectedRevision).toBe(record.revision); expect(write.operation).toBe('appointment.participants-changed');
  await act(async () => { write.pending.reject(new CalendarMutationError(write.control.idempotencyKey, 'unknown', 'CALENDAR_OUTCOME_UNKNOWN', 503)); });
  const schedule = view.find(value => value.type === CalendarSchedule);
  await act(async () => { schedule.props.onDateSelect(new Date(2026, 10, 17, 12)); });
  expect(activeOpening()).toBeUndefined();
  expect(textContent(view.tree)).toContain(write.control.idempotencyKey);
  f.receipt = { requestId: write.control.idempotencyKey, operation: write.operation, id: record.id, revision: record.revision + 2, changed: true };
  await clickView(view, 'Reconcile original request');
  expect(textContent(view.tree)).toContain('does not prove rollback');
  expect(textContent(view.tree)).toContain(write.control.idempotencyKey);
  f.receipt = { ...f.receipt, revision: record.revision + 1 };
  await clickView(view, 'Reconcile original request');
  expect(textContent(view.tree)).not.toContain(write.control.idempotencyKey);
  expect(f.receiptKeys).toEqual([write.control.idempotencyKey, write.control.idempotencyKey]); expect(f.writes).toHaveLength(1);
});

test('a retained details participant action cannot reopen private management after its live binding is denied', async () => {
  const f = fixture(), view = await mountWorkspace(f); await chooseCalendar(view); await openDetails(view);
  const retained = bodyFind(value => textContent(value.props.children) === 'Manage participants…').props.onClick;
  await act(async () => { f.bindings[0]!.options.onError?.(new CalendarReadError('CALENDAR_FORBIDDEN', 403, true)); });
  expect(textContent(body())).not.toContain(person.name);
  expect(textContent(body())).not.toContain('Manage participants…');
  await act(async () => { retained(); });
  expect(view.all().some(value => value.type === CalendarAppointmentParticipantsDialog)).toBe(false);
  expect(f.bindings).toHaveLength(1); expect(f.directories).toHaveLength(0);
});

test('a retained details reschedule action cannot open an editor after current management is denied', async () => {
  const f = fixture(), view = await mountWorkspace(f); await chooseCalendar(view); await openDetails(view);
  const retained = bodyFind(value => textContent(value.props.children) === 'Edit appointment').props.onClick;
  await act(async () => { f.transitions[0]!.options.onError?.(new CalendarReadError('CALENDAR_FORBIDDEN', 403, true)); });
  expect(textContent(body())).not.toContain('Edit appointment');
  await act(async () => { retained(); });
  expect(view.all().some(value => value.type === CalendarAppointmentEditor)).toBe(false);
});

test('retired participant management never resurrects its stored opening when capability returns', async () => {
  const f = fixture(), view = await mountWorkspace(f); await chooseCalendar(view); await openDetails(view); await clickBody('Manage participants…');
  await act(async () => { bodyFind(value => value.type === CalendarParticipantFields).props.onChange([]); });
  const opening = activeOpening()!, context = modals.getContext(opening.id)!, retained = bodyFind(value => value.type === 'form').props.onSubmit;
  expect(opening.systemState?.dirty).toBe(true);
  await act(async () => { f.caps[0]!.resolve({ ...capabilities, participants: false }); });
  expect(context.signal.aborted).toBe(true); expect(activeOpening()).toBeUndefined();
  await act(async () => { retained({ preventDefault() {} }); f.caps[0]!.resolve(capabilities); });
  expect(activeOpening()).toBeUndefined();
  expect(view.all().some(value => value.type === CalendarAppointmentParticipantsDialog)).toBe(false);
  expect(f.writes).toEqual([]);
});

test('a withdrawn calendar does not consume the configured selection limit when the user explicitly chooses its replacement', async () => {
  const f = fixture({ ...capabilities, limits: { ...capabilities.limits, maxResources: 1 } }), view = await mountWorkspace(f);
  await chooseCalendar(view);
  const replacement: CalendarResourceView = { ...resource, id: 'resource-b', label: 'Replacement calendar' };
  await act(async () => { f.catalogs[0]!.resolve({ items: [replacement], truncated: false, nextAfter: null }); });
  const offered = view.find(value => value.type === Checkbox && value.props.label === replacement.label);
  expect(offered.props.disabled).toBe(false);
  await act(async () => { offered.props.onChange(true); });
  const schedule = view.find(value => value.type === CalendarSchedule);
  expect(schedule.props.resources.map((value: { id: string }) => value.id)).toEqual([replacement.id]);
  expect(view.all().filter(value => value.type === Checkbox && value.props.checked).map(value => value.props.label)).toEqual([replacement.label]);
});

interface Subscription<T> { resolve(value: T, update?: { invalidated?: boolean; reconnected?: boolean }): void; options: CalendarWatchOptions; removals: number }
function watch<T>(entries: Subscription<T>[], resolve: Subscription<T>['resolve'], options: CalendarWatchOptions, initial: T) {
  const item = { resolve, options, removals: 0 }; entries.push(item); resolve(initial); return () => { item.removals++; };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(initialCapabilities = capabilities) {
  const caps: Subscription<CalendarCapabilities>[] = [], catalogs: Subscription<CalendarResourcePage>[] = [], ranges: Subscription<CalendarAppointmentPage>[] = [];
  const bindings: Subscription<CalendarParticipantsView>[] = [], directories: Subscription<CalendarParticipantDirectoryPage>[] = [], transitions: Subscription<CalendarAppointmentTransitions>[] = [];
  const writes: { operation: 'appointment.participants-changed' | 'appointment.created' | 'appointment.updated'; input: unknown; control: CalendarControlOptions; pending: ReturnType<typeof deferred<CalendarCommandReceipt>> }[] = [];
  const f = { caps, catalogs, ranges, bindings, directories, transitions, writes, receipt: null as CalendarCommandReceipt | null, receiptKeys: [] as string[] };
  const client = { calendar: {
    capabilities: { watch(resolve: Subscription<CalendarCapabilities>['resolve'], options: CalendarWatchOptions) { return watch(caps, resolve, options, initialCapabilities); } },
    resources: { watch(_query: unknown, resolve: Subscription<CalendarResourcePage>['resolve'], options: CalendarWatchOptions) { return watch(catalogs, resolve, options, { items: [resource], truncated: false, nextAfter: null }); } },
    appointments: {
      get: async () => record,
      update(_id: string, input: unknown, control: CalendarControlOptions) { const pending = deferred<CalendarCommandReceipt>(); writes.push({ operation: 'appointment.updated', input, control, pending }); return pending.promise; },
      watch(_query: unknown, resolve: Subscription<CalendarAppointmentPage>['resolve'], options: CalendarWatchOptions) { return watch(ranges, resolve, options, { items: [record], truncated: false }); },
      watchTransitions(_id: string, resolve: Subscription<CalendarAppointmentTransitions>['resolve'], options: CalendarWatchOptions) { return watch(transitions, resolve, options, {
        id: record.id, revision: record.revision, policyRevision: 1, status: 'confirmed', allowed: [],
      }); },
      create(input: unknown, control: CalendarControlOptions) { const pending = deferred<CalendarCommandReceipt>(); writes.push({ operation: 'appointment.created', input, control, pending }); return pending.promise; },
    },
    participants: {
      watchForAppointment(_id: string, resolve: Subscription<CalendarParticipantsView>['resolve'], options: CalendarWatchOptions) { return watch(bindings, resolve, options, { id: record.id, revision: record.revision, participants: [person] }); },
      watchDirectory(_query: unknown, resolve: Subscription<CalendarParticipantDirectoryPage>['resolve'], options: CalendarWatchOptions) { return watch(directories, resolve, options, { items: [person], truncated: false, nextAfter: null }); },
      replace(_id: string, input: unknown, control: CalendarControlOptions) { const pending = deferred<CalendarCommandReceipt>(); writes.push({ operation: 'appointment.participants-changed', input, control, pending }); return pending.promise; },
    },
    types: { watch(_query: unknown, resolve: (value: unknown) => void) { resolve({ items: [], truncated: false, nextAfter: null }); return () => {}; } },
    receipts: { async get(key: string) { f.receiptKeys.push(key); return f.receipt; } },
  } } as unknown as Client;
  return Object.assign(f, { client });
}
async function mountWorkspace(f: ReturnType<typeof fixture>, options: Partial<ConnectedCalendarWorkspaceProps> = {}) {
  let tree: ReactNode = null;
  function CurrentCapture({ element }: { element: ReactElement<Record<string, unknown>> }) {
    // The returned component executes under this stable React hook owner. Its actual
    // overlay elements are mounted normally; host layout/widgets remain unrendered.
    tree = (element.type as (props: Record<string, unknown>) => ReactNode)(element.props);
    const overlays = elements(tree).filter(value => value.type === CalendarAppointmentEditor || value.type === CalendarAppointmentParticipantsDialog
      || value.type === CalendarAppointmentTransitionDialog || typeof value.type === 'function' && value.type.name === 'CoreDetails');
    return createElement(Fragment, null, ...overlays);
  }
  function OuterCapture() {
    const element = ConnectedCalendarWorkspace({ displayTimeZone: 'UTC', initialDate: new Date(2026, 10, 16, 12), initialView: 'day', ...options });
    return createElement(CurrentCapture, { key: element.key, element: element as ReactElement<Record<string, unknown>> });
  }
  const { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  await act(async () => root.render(createElement(ClientProvider, { client: f.client,
    children: createElement(ModalHostContext.Provider, { value: true, children: createElement(OuterCapture) }) })));
  return { get tree() { return tree; }, all: () => elements(tree), find(predicate: (value: ReactElement<Record<string, any>>) => boolean) {
    const value = elements(tree).find(predicate); expect(value).toBeDefined(); return value!;
  } };
}
type WorkspaceView = Awaited<ReturnType<typeof mountWorkspace>>;
async function chooseCalendar(view: WorkspaceView) { await act(async () => { view.find(value => value.type === Checkbox && value.props.label === resource.label).props.onChange(true); }); }
async function openDetails(view: WorkspaceView) { await act(async () => { const schedule = view.find(value => value.type === CalendarSchedule); schedule.props.onDetails(schedule.props.events[0]); }); }
async function clickView(view: WorkspaceView, label: string) { await act(async () => { view.find(value => typeof value.props.onClick === 'function' && textContent(value.props.children).trim() === label).props.onClick({ currentTarget: undefined }); }); }
function activeOpening() { const state = modalStore.getSnapshot().context; return state.modals.find(value => !state.closingIds.includes(value.id)); }
function body(): ReactNode {
  const opening = activeOpening(); expect(opening).toBeDefined();
  const context = modals.getContext(opening!.id)! as ModalContext<CalendarCommandReceipt>, descriptor = opening!.descriptor as ModalDescriptor<CalendarCommandReceipt>;
  const projected = typeof descriptor.body === 'function' ? descriptor.body(context) : descriptor.body;
  const bridge = (projected as ReactElement<{ bridge: { read(): ControlledModalProps<CalendarCommandReceipt> } }>).props.bridge;
  const current = bridge.read().descriptor; return typeof current.body === 'function' ? current.body(context) : current.body;
}
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, any>>(node) ? [node, ...elements(node.type === AppointmentModalContent
    ? AppointmentModalContent(node.props as unknown as AppointmentModalContentProps) : node.props.children)] : [];
}
function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(' ');
  return isValidElement<{ children?: ReactNode }>(node) ? textContent(node.props.children) : '';
}
function bodyFind(predicate: (value: ReactElement<Record<string, any>>) => boolean) { const value = elements(body()).find(predicate); expect(value).toBeDefined(); return value!; }
async function clickBody(label: string) { await act(async () => { bodyFind(value => typeof value.props.onClick === 'function' && textContent(value.props.children).trim() === label).props.onClick(); }); }
