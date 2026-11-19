/**
 * Actual ReactDOM/controller/native-modal ownership checks in memory. Field
 * callbacks are driven through the live native descriptor; this does not claim
 * browser layout, focus, animation, physical database or installed-package proof.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import type { CalendarAppointmentInput, CalendarAppointmentUpdateInput, CalendarRescheduleInput, CalendarAppointmentTransitions, CalendarAppointmentTypePage,
  CalendarAppointmentTypeView, CalendarAppointmentView, CalendarControlOptions, CalendarRequestOptions, CalendarCommandReceipt,
  CalendarParticipantDirectoryPage, CalendarParticipantDirectoryQuery, CalendarParticipantReference, CalendarParticipantsView, CalendarResourceView, CalendarWatchOptions } from '../../../calendar/contracts';
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
import { CalendarCoreEditor, type CalendarCoreEditorProps } from '../components/calendar-core-editor';
import { CalendarAppointmentParticipantsDialog } from '../components/calendar-appointment-participants-dialog';
import { CalendarParticipantFields } from '../components/calendar-participant-fields';
import { CalendarCoreTypeFields } from '../components/calendar-core-type-fields';
import type { CalendarCoreSession, CalendarPendingRequest } from './calendar-workspace-model';

const roots = new Set<Root>();
let restoreDom: () => void;
beforeEach(() => { restoreDom = installMinimalHookDom(); configureFrontendObservability({ http: false, console: false }); modals.discardAll(); });
afterEach(async () => {
  try { for (const root of roots) await act(async () => root.unmount()); }
  finally { roots.clear(); modals.discardAll(); restoreDom(); }
});

const resource: CalendarResourceView = { id: 'resource-a', label: 'Synthetic calendar', kind: 'person', ownerId: 'synthetic-user', timeZone: 'UTC', revision: 1, active: true };
const record: CalendarAppointmentView = { id: 'appointment-a', revision: 4, resourceIds: [resource.id], title: 'Synthetic appointment',
  startAt: '2026-11-16T10:07:00.000Z', endAt: '2026-11-16T11:07:00.000Z', timeZone: 'UTC',
  bufferBeforeMinutes: 3, bufferAfterMinutes: 7, status: 'confirmed', createdBy: 'synthetic-user' };
const type: CalendarAppointmentTypeView = { id: 'type-a', revision: 2, label: 'PRIVATE_CURRENT_TYPE', durationMinutes: 37,
  bufferBeforeMinutes: 4, bufferAfterMinutes: 6, colorKey: null, active: true };
const person = { ref: { kind: 'guardian-user' as const, userId: 'PRIVATE_ACCOUNT_ID' }, availability: 'available' as const, name: 'PRIVATE_CURRENT_NAME' };

test('a pristine editor is clean; a current unchanged edit neither dispatches nor creates an unsettled request', async () => {
  const f = fixture();
  await mountEditor(f, true);
  expect(opening().systemState?.dirty).toBe(false);
  expect(submitButton().props.disabled).toBe(true);
  await submitForm();
  expect(f.writes).toEqual([]); expect(f.unknown).toEqual([]);
  await changeField('Start time', 608);
  expect(opening().systemState?.dirty).toBe(true);
  await changeField('Start time', 607);
  expect(opening().systemState?.dirty).toBe(false);
  expect(submitButton().props.disabled).toBe(true);
  await act(async () => { expect(await modals.requestClose(opening().id, { reason: 'close-button' })).toBe(true); });
  expect(f.closed).toBe(1);
});

test('an existing title and interval are saved once through the atomic update, not chained reschedules', async () => {
  const f = fixture(); await mountEditor(f, true);
  expect(field('Appointment title').props.readOnly).not.toBe(true);
  await changeTitle('Changed synthetic title'); await changeField('Start time', 608);
  await submitForm(); await submitForm();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ operation: 'appointment.updated', control: { expectedRevision: record.revision },
    input: { title: 'Changed synthetic title', startAt: '2026-11-16T10:08:00.000Z', endAt: record.endAt,
      bufferBeforeMinutes: 3, bufferAfterMinutes: 7 } });
  expect(f.writes[0]!.input).not.toHaveProperty('resourceIds');
  expect(f.writes[0]!.input).not.toHaveProperty('participants');
  await acceptWrite(f); expect(f.accepted).toHaveLength(1); expect(f.closed).toBe(1);
});

test('title-only edits revert to clean and never dispatch when restored to accepted text', async () => {
  const f = fixture(); await mountEditor(f, true);
  await changeTitle('Different'); expect(opening().systemState?.dirty).toBe(true);
  await changeTitle(record.title); expect(opening().systemState?.dirty).toBe(false);
  expect(submitButton().props.disabled).toBe(true); await submitForm(); expect(f.writes).toEqual([]);
});

test('single-calendar transfer and newer typing use one update and preserve the unsent newer title', async () => {
  const f = fixture(), root = await mountEditor(f, true);
  await act(async () => { root.updateProps({ resources: [resource, { ...resource, id: 'resource-b', label: 'Second synthetic calendar' }] }); });
  expect(field('Appointment calendar').props.disabled).toBe(false);
  await act(async () => { field('Appointment calendar').props.onChange('resource-b'); });
  await changeTitle('Submitted transfer'); await submitForm();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ operation: 'appointment.updated', input: { resourceIds: ['resource-b'], title: 'Submitted transfer' } });
  await changeTitle('Newer unsent edit'); await acceptWrite(f);
  expect(f.accepted).toHaveLength(1); expect(f.closed).toBe(0);
  expect(field('Appointment title').props.value).toBe('Newer unsent edit');
});

test('a retained selector cannot submit an unavailable replacement calendar', async () => {
  const f = fixture(); await mountEditor(f, true);
  await act(async () => { field('Appointment calendar').props.onChange('not-currently-listed'); });
  expect(submitButton().props.disabled).toBe(true);
  await submitForm(); expect(f.writes).toEqual([]); expect(f.unknown).toEqual([]);
});

test('transfer keeps the old type visible but requires the new calendar page to admit it before one explicit update', async () => {
  const f = fixture(), root = await mountEditor(f, true);
  const acceptedType = { ...type, id: 'accepted-type', durationMinutes: 60, bufferBeforeMinutes: 3, bufferAfterMinutes: 7 };
  const typed = { ...record, appointmentType: acceptedType };
  f.currentRecord = typed;
  await act(async () => { root.updateProps({ session: { ...root.getProps().session, record: typed },
    resources: [resource, { ...resource, id: 'resource-b', label: 'Second calendar' }] }); });
  await act(async () => { field('Appointment calendar').props.onChange('resource-b'); });
  const selection = findElement(value => value.type === CalendarCoreTypeFields);
  expect(selection.props.value.appointmentType).toMatchObject({ id: acceptedType.id, revision: acceptedType.revision });
  expect(selection.props.acceptedType).toBeUndefined();
  expect(submitButton().props.disabled).toBe(true); await submitForm(); expect(f.writes).toEqual([]);
  await act(async () => { f.types.at(-1)!.resolve({ items: [acceptedType], nextAfter: null, truncated: false }); });
  expect(submitButton().props.disabled).toBe(false); await submitForm();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ operation: 'appointment.updated', input: { resourceIds: ['resource-b'],
    appointmentType: { id: acceptedType.id, revision: acceptedType.revision } } });
});

test('selected type defaults keep an arbitrary exact minute and dispatch exact duration, buffers and version once', async () => {
  const f = fixture();
  await mountEditor(f);
  expect(opening().systemState?.dirty).toBe(false);
  await changeTitle('Typed synthetic appointment');
  await act(async () => { findElement(value => value.type === CalendarCoreTypeFields).props.onChange(type); });
  expect(field('Start time').props.value).toBe(607);
  expect(field('End time').props.value).toBe(644);
  await submitForm(); await submitForm();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]!.input).toMatchObject({ resourceIds: [resource.id], title: 'Typed synthetic appointment',
    startAt: '2026-11-16T10:07:00.000Z', endAt: '2026-11-16T10:44:00.000Z',
    appointmentType: { id: type.id, revision: type.revision }, bufferBeforeMinutes: 4, bufferAfterMinutes: 6 });
  expect(f.unknown).toHaveLength(1);
  await acceptWrite(f);
  expect(f.accepted).toEqual([f.unknown[0]!]); expect(f.closed).toBe(1);
});

test('newer local edits survive a real accepted write without closing or being marked saved', async () => {
  const f = fixture(); await mountEditor(f);
  await changeTitle('Submitted title'); await submitForm();
  await changeTitle('Newer unsent title');
  await acceptWrite(f);
  expect(f.accepted).toHaveLength(1); expect(f.closed).toBe(0);
  expect(field('Appointment title').props.value).toBe('Newer unsent title');
  expect(opening().systemState?.dirty).toBe(true);
  expect(submitButton().props.disabled).toBe(true);
  expect(textContent(body())).toContain('newer');
});

test('a known noncommit clears only its identity; an unknown acknowledgment reconciles the same key and never resends', async () => {
  const f = fixture(); await mountEditor(f); await changeTitle('Synthetic request'); await submitForm();
  const first = f.writes[0]!;
  await act(async () => { first.pending.reject(new CalendarMutationError(first.control.idempotencyKey, 'not-committed', 'CALENDAR_BOOKING_CONFLICT', 409)); });
  expect(f.rejected).toEqual([f.unknown[0]!]); expect(submitButton().props.disabled).toBe(false);
  await submitForm(); const second = f.writes[1]!;
  expect(second.control.idempotencyKey).not.toBe(first.control.idempotencyKey);
  await act(async () => { second.pending.reject(new CalendarMutationError(second.control.idempotencyKey, 'unknown', 'CALENDAR_OUTCOME_UNKNOWN', 503)); });
  expect(f.rejected).toHaveLength(1);
  await submitForm(); expect(f.writes).toHaveLength(2);
  await clickButton('Reconcile original request');
  expect(f.receiptKeys).toEqual([second.control.idempotencyKey]);
  expect(textContent(body())).toContain('does not prove');
  f.receipt = receiptFor(second);
  await clickButton('Reconcile original request');
  expect(f.receiptKeys).toEqual([second.control.idempotencyKey, second.control.idempotencyKey]);
  expect(f.accepted).toEqual([f.unknown.at(-1)!]); expect(f.writes).toHaveLength(2);
});

test('a matching key with an impossible accepted revision remains unknown instead of closing', async () => {
  const f = fixture(); await mountEditor(f, true); await changeField('Start time', 608); await submitForm();
  const write = f.writes[0]!;
  await act(async () => { write.pending.resolve({ ...receiptFor(write), revision: record.revision + 2 }); });
  expect(f.accepted).toEqual([]); expect(f.closed).toBe(0);
  expect(textContent(body()).toLowerCase()).toContain('reconcile');
});

test('a newer management projection blocks a stale same-detail draft without silently rebasing it', async () => {
  const f = fixture(); await mountEditor(f, true); await changeField('Start time', 608);
  const retained = findElement(value => value.type === 'form').props.onSubmit;
  await act(async () => { f.transitions[0]!.resolve({ ...f.transition, revision: record.revision + 1 }); });
  expect(field('Start time').props.value).toBe(608);
  expect(submitButton().props.disabled).toBe(true);
  await act(async () => { retained(submitEvent()); });
  await submitForm(); expect(f.writes).toEqual([]);
});

test('type-read failure masks current choices and blocks a retained previously-ready submit callback', async () => {
  const f = fixture(); await mountEditor(f); await changeTitle('Synthetic type-read test');
  await act(async () => { findElement(value => value.type === CalendarCoreTypeFields).props.onChange(type); });
  const retained = findElement(value => value.type === 'form').props.onSubmit;
  await act(async () => { f.types[0]!.options.onError?.(new CalendarReadError('CALENDAR_NOT_READY', 503)); });
  const fields = findElement(value => value.type === CalendarCoreTypeFields);
  expect(fields.props.status).toBe('error'); expect(fields.props.types).toBeNull();
  expect(submitButton().props.disabled).toBe(true);
  await act(async () => { retained(submitEvent()); });
  await submitForm(); expect(f.writes).toEqual([]); expect(f.unknown).toEqual([]);
});

test('unsubmitted type metadata disappearing from the current authorized page blocks saving without rebasing the draft', async () => {
  const f = fixture(); await mountEditor(f); await changeTitle('Synthetic selected type');
  await act(async () => { findElement(value => value.type === CalendarCoreTypeFields).props.onChange(type); });
  await act(async () => { f.types[0]!.resolve({ items: [], truncated: false, nextAfter: null }); });
  const fields = findElement(value => value.type === CalendarCoreTypeFields);
  expect(fields.props.value.appointmentType).toMatchObject({ id: type.id, revision: type.revision });
  expect(fields.props.types.items).toEqual([]);
  expect(submitButton().props.disabled).toBe(true); await submitForm(); expect(f.writes).toEqual([]);
});

test('owner unmount aborts the native context and retained field/writer callbacks cannot accept or dispatch', async () => {
  const f = fixture(), root = await mountEditor(f); await changeTitle('Synthetic request');
  const form = findElement(value => value.type === 'form'), context = nativeContext(); await submitForm();
  await act(async () => root.unmount()); roots.delete(root);
  expect(context.signal.aborted).toBe(true); expect(modalStore.getSnapshot().context.modals).toEqual([]);
  await act(async () => { f.writes[0]!.pending.resolve(receiptFor(f.writes[0]!)); form.props.onSubmit(submitEvent()); });
  expect(f.writes).toHaveLength(1); expect(f.accepted).toEqual([]); expect(f.closed).toBe(0);
});

test('participant discovery is explicitly opted in for creation and the participant-bearing input does not claim access grants', async () => {
  const plain = fixture(), plainRoot = await mountEditor(plain);
  expect(plain.directories).toHaveLength(0);
  expect(elements(body()).some(value => value.type === CalendarParticipantFields)).toBe(false);
  await act(async () => plainRoot.unmount()); roots.delete(plainRoot);
  const f = fixture(); await mountEditor(f, false, true);
  expect(f.directories).toHaveLength(1);
  await changeTitle('Synthetic participant booking');
  await chooseParticipants([person.ref]); await submitForm();
  expect(f.writes).toHaveLength(1); expect(f.writes[0]!.operation).toBe('appointment.created');
  expect(f.writes[0]!.input).toMatchObject({ participants: [person.ref] });
  expect(f.bindings).toHaveLength(0);
});

for (const initial of [false, true]) {
  test(`a standalone creation owner retires instead of changing participant intent when its UI mode flips from ${initial}`, async () => {
    const f = fixture(), root = await mountEditor(f, false, initial); await changeTitle('Synthetic mode-owned booking');
    if (initial) await chooseParticipants([person.ref]);
    const retained = findElement(value => value.type === 'form').props.onSubmit, context = nativeContext();
    await act(async () => { root.updateProps({ participants: !initial }); });
    expect(context.signal.aborted).toBe(true); expect(modalStore.getSnapshot().context.modals).toEqual([]);
    expect(f.authorityLost).toBeGreaterThan(0);
    await act(async () => { retained(submitEvent()); root.updateProps({ participants: initial }); });
    expect(f.writes).toEqual([]); expect(modalStore.getSnapshot().context.modals).toEqual([]);
  });
}

test('participant replacement is a clean independent exact-revision command, not a second hidden reschedule', async () => {
  const f = fixture(); await mountParticipants(f);
  expect(opening().systemState?.dirty).toBe(false); expect(submitButton().props.disabled).toBe(true);
  await submitForm(); expect(f.writes).toEqual([]);
  await chooseParticipants([person.ref]);
  expect(opening().systemState?.dirty).toBe(true);
  await submitForm(); await submitForm();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({ operation: 'appointment.participants-changed', input: [person.ref], control: { expectedRevision: record.revision } });
  await acceptWrite(f);
  expect(f.accepted).toEqual([f.unknown[0]!]); expect(f.closed).toBe(1);
});

test('a participant binding revision change preserves the draft but blocks a false atomic replacement', async () => {
  const f = fixture(); await mountParticipants(f); await chooseParticipants([person.ref]);
  const retained = findElement(value => value.type === 'form').props.onSubmit;
  await act(async () => { f.bindings[0]!.resolve({ id: record.id, revision: record.revision + 1, participants: [] }); });
  await act(async () => { retained(submitEvent()); });
  expect(submitButton().props.disabled).toBe(true); await submitForm(); expect(f.writes).toEqual([]);
  const fields = findElement(value => value.type === CalendarParticipantFields);
  expect(fields.props.value).toEqual([person.ref]);
  expect(textContent(body()).toLowerCase()).toContain('changed');
});

test('participant pagination follows an opaque continuation through an empty eligible page and never submits the booking', async () => {
  const f = fixture(); await mountParticipants(f);
  await act(async () => { f.directories[0]!.resolve({ items: [], truncated: true, nextAfter: 'opaque-continuation' }); });
  const previous = findElement(value => value.type === CalendarParticipantFields);
  expect(previous.props.directory.items).toEqual([]);
  await act(async () => { previous.props.onNext(); });
  expect(f.directoryQueries.at(-1)).toEqual({ search: '', after: 'opaque-continuation' });
  const next = findElement(value => value.type === CalendarParticipantFields);
  expect(next.props.canGoBack).toBe(true); expect(next.props.directory.items).toEqual([]);
  await act(async () => { previous.props.onChange([person.ref]); });
  expect(findElement(value => value.type === CalendarParticipantFields).props.value).toEqual([]);
  expect(f.writes).toEqual([]); expect(f.unknown).toEqual([]);
});

test('participant unknown settlement retains its exact identity and never resends during receipt reconciliation', async () => {
  const f = fixture(); await mountParticipants(f); await chooseParticipants([person.ref]); await submitForm();
  const first = f.writes[0]!;
  await act(async () => { first.pending.reject(new CalendarMutationError(first.control.idempotencyKey, 'unknown', 'CALENDAR_OUTCOME_UNKNOWN', 503)); });
  await submitForm(); expect(f.writes).toHaveLength(1); expect(f.rejected).toEqual([]);
  f.receipt = receiptFor(first); await clickButton('Reconcile original request');
  expect(f.receiptKeys).toEqual([first.control.idempotencyKey]); expect(f.accepted).toHaveLength(1);
  expect(f.closed).toBe(1); expect(f.writes).toHaveLength(1);
});

test('an accepted participant request preserves newer unsent choices and leaves the native editor open', async () => {
  const f = fixture(); await mountParticipants(f); await chooseParticipants([person.ref]); await submitForm();
  await chooseParticipants([]); await acceptWrite(f);
  expect(f.accepted).toHaveLength(1); expect(f.closed).toBe(0);
  expect(findElement(value => value.type === CalendarParticipantFields).props.value).toEqual([]);
  expect(opening().systemState?.dirty).toBe(true);
  expect(textContent(body())).toContain('newer');
  expect(submitButton().props.disabled).toBe(true);
});

test('an unknown participant request remains natively dirty after the draft returns to its original reference set', async () => {
  const f = fixture(); f.participantRefs = [person.ref]; await mountParticipants(f);
  expect(opening().systemState?.dirty).toBe(false);
  await chooseParticipants([]); await submitForm(); await chooseParticipants([person.ref]);
  const write = f.writes[0]!;
  await act(async () => { write.pending.reject(new CalendarMutationError(write.control.idempotencyKey, 'unknown', 'CALENDAR_OUTCOME_UNKNOWN', 503)); });
  expect(findElement(value => value.type === CalendarParticipantFields).props.value).toEqual([person.ref]);
  expect(opening().systemState?.dirty).toBe(true); expect(f.accepted).toEqual([]); expect(f.rejected).toEqual([]);
  const owner = opening(); let closing!: Promise<boolean>;
  await act(async () => { closing = modals.requestClose(owner.id, { reason: 'close-button' }); });
  const prompt = modalStore.getSnapshot().context.modals.find(value => value.title === 'Discard unsaved changes?');
  expect(prompt).toBeDefined(); expect(prompt?.parentId).toBe(owner.id);
  await act(async () => { await modals.performAction(prompt!.id, 'keep'); expect(await closing).toBe(false); modals.completeExit(prompt!.id, prompt!.generation); });
  expect(f.closed).toBe(0); expect(f.writes).toHaveLength(1);
  f.receipt = receiptFor(write); await clickButton('Reconcile original request');
  expect(f.accepted).toHaveLength(1); expect(f.closed).toBe(0); expect(opening().systemState?.dirty).toBe(true);
});

test('a prop-client mismatch retires its native owner and restoring the matching provider creates a clean owner immune to old receipts', async () => {
  const f = fixture(), replacement = fixture(), root = await mountEditor(f); await changeTitle('PRIVATE_OLD_CLIENT_DRAFT');
  const context = nativeContext(), retained = findElement(value => value.type === 'form').props.onSubmit;
  await submitForm(); const write = f.writes[0]!;
  await act(async () => { root.updateProps({ client: replacement.client }); });
  expect(context.signal.aborted).toBe(true); expect(modalStore.getSnapshot().context.modals).toEqual([]);
  expect(f.authorityLost).toBeGreaterThan(0); expect(replacement.writes).toEqual([]);
  await act(async () => { root.updateProps({ client: f.client }); });
  expect(field('Appointment title').props.value).toBe(''); expect(opening().systemState?.dirty).toBe(false);
  await act(async () => { retained(submitEvent()); write.pending.resolve(receiptFor(write)); });
  expect(f.writes).toHaveLength(1); expect(f.accepted).toEqual([]); expect(f.closed).toBe(0);
  expect(field('Appointment title').props.value).toBe(''); expect(replacement.writes).toEqual([]);
});

test('a same-session accepted record revision replacement owns a new draft and ignores the older write settlement', async () => {
  const f = fixture(), root = await mountEditor(f, true); await changeField('Start time', 608);
  const context = nativeContext(), retained = findElement(value => value.type === 'form').props.onSubmit;
  await submitForm(); const write = f.writes[0]!, old = root.getProps().session;
  f.currentRecord = { ...record, revision: record.revision + 1 };
  f.transition = { ...f.transition, revision: f.currentRecord.revision };
  await act(async () => { root.updateProps({ session: { ...old, record: f.currentRecord, initial: { ...old.initial, start: 618, end: 678 } } }); });
  expect(context.signal.aborted).toBe(true); expect(field('Start time').props.value).toBe(618);
  expect(opening().systemState?.dirty).toBe(false);
  await act(async () => { retained(submitEvent()); write.pending.resolve(receiptFor(write)); });
  expect(f.writes).toHaveLength(1); expect(f.accepted).toEqual([]); expect(f.closed).toBe(0);
  expect(field('Start time').props.value).toBe(618);
});

test('same-owner initial-prop refresh neither rewrites the local draft nor moves its pristine baseline', async () => {
  const f = fixture(), root = await mountEditor(f); await changeTitle('LOCAL_UNSENT_DRAFT');
  const context = nativeContext(), initial = root.getProps().session;
  await act(async () => { root.updateProps({ session: { ...initial, initial: { ...initial.initial, title: 'UNRELATED_PROP_REFRESH', start: 700, end: 760 } } }); });
  expect(context.signal.aborted).toBe(false); expect(field('Appointment title').props.value).toBe('LOCAL_UNSENT_DRAFT');
  expect(field('Start time').props.value).toBe(607); expect(opening().systemState?.dirty).toBe(true);
  await changeTitle(''); expect(opening().systemState?.dirty).toBe(false); expect(f.writes).toEqual([]);
});

test('participant error/denial masks names immediately and native owner retirement aborts retained callbacks', async () => {
  const f = fixture(), root = await mountParticipants(f);
  const oldFields = findElement(value => value.type === CalendarParticipantFields), context = nativeContext();
  expect(oldFields.props.directory.items[0].name).toBe(person.name);
  await act(async () => { f.directories[0]!.options.onError?.(new CalendarReadError('CALENDAR_NOT_READY', 503)); });
  const masked = findElement(value => value.type === CalendarParticipantFields);
  expect(masked.props.status).toBe('error'); expect(masked.props.directory).toBeNull(); expect(masked.props.accepted).toBeUndefined();
  await act(async () => { oldFields.props.onChange([person.ref]); });
  expect(masked.props.value).toEqual([]); expect(f.writes).toEqual([]);
  await act(async () => { masked.props.onRetry(); });
  expect(f.directories).toHaveLength(2);
  await act(async () => { f.directories[1]!.options.onError?.(new CalendarReadError('CALENDAR_FORBIDDEN', 403, true)); });
  expect(f.authorityLost).toBeGreaterThan(0);
  expect(context.signal.aborted).toBe(true);
  expect(modalStore.getSnapshot().context.modals).toEqual([]);
  await act(async () => { oldFields.props.onChange([person.ref]); root.unmount(); }); roots.delete(root);
  expect(f.writes).toEqual([]); expect(f.accepted).toEqual([]);
});

for (const participant of [false, true]) for (const outcome of ['not-committed', 'unknown'] as const) {
  test(`${participant ? 'participant' : 'booking'} denial retires private ownership and preserves ${outcome === 'unknown' ? 'uncertain' : 'known noncommit'} classification`, async () => {
    const f = fixture();
    if (participant) { await mountParticipants(f); await chooseParticipants([person.ref]); }
    else { await mountEditor(f); await changeTitle('Synthetic denied booking'); }
    const context = nativeContext(); await submitForm(); const write = f.writes[0]!;
    await act(async () => { write.pending.reject(new CalendarMutationError(write.control.idempotencyKey, outcome, 'CALENDAR_FORBIDDEN', 403)); });
    expect(context.signal.aborted).toBe(true); expect(modalStore.getSnapshot().context.modals).toEqual([]);
    expect(f.authorityLost).toBeGreaterThan(0); expect(f.accepted).toEqual([]); expect(f.closed).toBe(0);
    expect(f.rejected).toHaveLength(outcome === 'unknown' ? 0 : 1);
    expect(f.unknown[0]!.key).toBe(write.control.idempotencyKey);
  });
}

for (const participant of [false, true]) {
  test(`${participant ? 'participant' : 'booking'} retained callback is fenced before a scope notification and the old native owner retires on publication`, async () => {
    const f = fixture();
    if (participant) { await mountParticipants(f); await chooseParticipants([person.ref]); }
    else { await mountEditor(f); await changeTitle('PRIVATE_OLD_SCOPE_DRAFT'); }
    const context = nativeContext(), retained = findElement(value => value.type === 'form').props.onSubmit;
    f.auth.authorizationScopeKey = 'replacement-scope';
    await act(async () => { retained(submitEvent()); });
    expect(f.writes).toEqual([]); expect(f.unknown).toEqual([]);
    await act(async () => { f.notify(); });
    expect(context.signal.aborted).toBe(true);
    await act(async () => { retained(submitEvent()); });
    expect(f.writes).toEqual([]); expect(f.unknown).toEqual([]);
    if (participant) expect(findElement(value => value.type === CalendarParticipantFields).props.value).toEqual([]);
    else expect(field('Appointment title').props.value).toBe('');
  });
}

type Write = { operation: CalendarCommandReceipt['operation']; input: unknown; control: CalendarRequestOptions | CalendarControlOptions; pending: ReturnType<typeof deferred<CalendarCommandReceipt>> };
function fixture() {
  const observers = new Set<() => void>(), subscribe = (observer: () => void) => { observers.add(observer); return () => { observers.delete(observer); }; };
  const auth = { authorizationScopeKey: 'synthetic-scope', user: { userId: 'synthetic-user' }, activeTenant: { tenantId: 'synthetic-tenant' },
    isLoading: false, isRestoring: false, isAuthenticated: true, authorizationState: { status: 'ready' },
    sessionTransition: { phase: 'idle', revision: 0 }, subscribe, subscribeAuthorization: subscribe };
  const writes: Write[] = [], receiptKeys: string[] = [], unknown: CalendarPendingRequest[] = [], accepted: CalendarPendingRequest[] = [], rejected: CalendarPendingRequest[] = [];
  const transitions: Subscription<CalendarAppointmentTransitions>[] = [], types: Subscription<CalendarAppointmentTypePage>[] = [];
  const directories: Subscription<CalendarParticipantDirectoryPage>[] = [], bindings: Subscription<CalendarParticipantsView>[] = [];
  const directoryQueries: CalendarParticipantDirectoryQuery[] = [];
  const transition: CalendarAppointmentTransitions = { id: record.id, revision: record.revision, policyRevision: 1, status: 'confirmed', allowed: [] };
  const f = { auth, writes, receiptKeys, unknown, accepted, rejected, transitions, transition, types, directories, directoryQueries, bindings, currentRecord: record,
    closed: 0, authorityLost: 0, receipt: null as CalendarCommandReceipt | null, participantRefs: [] as CalendarParticipantReference[],
    notify() { for (const observer of observers) observer(); } };
  function write(operation: Write['operation'], input: unknown, control: Write['control']) {
    const pending = deferred<CalendarCommandReceipt>(); writes.push({ operation, input, control, pending }); return pending.promise;
  }
  const client = { auth, calendar: {
    appointments: {
      get: async () => f.currentRecord,
      watchTransitions(_id: string, resolve: (value: CalendarAppointmentTransitions) => void, options: CalendarWatchOptions) { return watch(transitions, resolve, options, f.transition); },
      create(input: CalendarAppointmentInput, control: CalendarRequestOptions) { return write('appointment.created', input, control); },
      update(_id: string, input: CalendarAppointmentUpdateInput, control: CalendarControlOptions) { return write('appointment.updated', input, control); },
      reschedule(_id: string, input: CalendarRescheduleInput, control: CalendarControlOptions) { return write('appointment.rescheduled', input, control); },
    },
    types: {
      watch(_query: unknown, resolve: (value: CalendarAppointmentTypePage) => void, options: CalendarWatchOptions) { return watch(types, resolve, options, { items: [type], truncated: false, nextAfter: null }); },
      watchForResource(_id: string, resolve: (value: unknown) => void) { resolve({ resourceId: resource.id, resourceRevision: 1, mode: 'unrestricted', typeIds: [] }); return () => {}; },
    },
    locations: { watchForVisit(_query: unknown, resolve: (value: unknown) => void) { resolve({ items: [], truncated: false, nextAfter: null }); return () => {}; } },
    participants: {
      watchDirectory(query: CalendarParticipantDirectoryQuery, resolve: (value: CalendarParticipantDirectoryPage) => void, options: CalendarWatchOptions) {
        directoryQueries.push(query); return watch(directories, resolve, options, { items: query.after ? [] : [person], truncated: false, nextAfter: null }); },
      watchForAppointment(_id: string, resolve: (value: CalendarParticipantsView) => void, options: CalendarWatchOptions) { return watch(bindings, resolve, options, { id: f.currentRecord.id, revision: f.currentRecord.revision,
        participants: f.participantRefs.map(ref => ({ ...person, ref })) }); },
      replace(_id: string, input: readonly CalendarParticipantReference[], control: CalendarControlOptions) { return write('appointment.participants-changed', input, control); },
    },
    receipts: { async get(key: string) { receiptKeys.push(key); return f.receipt; } },
  } } as unknown as Client;
  return Object.assign(f, { client });
}
type Fixture = ReturnType<typeof fixture>;
interface Subscription<T> { options: CalendarWatchOptions; resolve(value: T): void; removals: number }
function watch<T>(list: Subscription<T>[], resolve: (value: T) => void, options: CalendarWatchOptions, initial: T) {
  const item = { resolve, options, removals: 0 }; list.push(item); resolve(initial); return () => { item.removals++; };
}
function callbacks(f: Fixture) {
  return { onClose() { f.closed++; }, onAuthorityLost() { f.authorityLost++; }, onUnknown(request: CalendarPendingRequest) { f.unknown.push(request); },
    onAccepted(request: CalendarPendingRequest) { f.accepted.push(request); }, onRejected(request: CalendarPendingRequest) { f.rejected.push(request); } };
}
async function mountEditor(f: Fixture, existing = false, participants = false) {
  const session: CalendarCoreSession = { key: 1, selection: 'synthetic-selection', ...(existing ? { record } : {}),
    initial: { resourceId: resource.id, title: existing ? record.title : '', date: '2026-11-16', start: 607, end: 667,
      ...(existing ? { bufferBeforeMinutes: record.bufferBeforeMinutes, bufferAfterMinutes: record.bufferAfterMinutes } : {}) } };
  let props: Omit<CalendarCoreEditorProps, 'scopeKey'> = { client: f.client, session, resources: [resource],
    readRevision: 'synthetic-revision', participants, ...callbacks(f) };
  function ScopedEditor() {
    const boundary = useAuthorizationScopeBoundary();
    return boundary.ready ? createElement(CalendarCoreEditor, { ...props, key: boundary.key, scopeKey: boundary.key }) : null;
  }
  const root = await mount(f.client, createElement(ScopedEditor));
  return Object.assign(root, { getProps: () => props, updateProps(partial: Partial<Omit<CalendarCoreEditorProps, 'scopeKey'>>) {
    props = { ...props, ...partial };
    root.render(createElement(ClientProvider, { client: f.client,
      children: createElement(ModalHostContext.Provider, { value: true, children: createElement(ScopedEditor) }) }));
  } });
}
async function mountParticipants(f: Fixture) {
  function ScopedParticipants() {
    const boundary = useAuthorizationScopeBoundary();
    return boundary.ready ? createElement(CalendarAppointmentParticipantsDialog, { key: boundary.key, record, client: f.client,
      scopeKey: boundary.key, ...callbacks(f) }) : null;
  }
  return mount(f.client, createElement(ScopedParticipants));
}
async function mount(client: Client, children: ReactNode) {
  const { createRoot } = await import('react-dom/client'), root = createRoot(createHookContainer()); roots.add(root);
  await act(async () => root.render(createElement(ClientProvider, { client, children: createElement(ModalHostContext.Provider, { value: true, children }) })));
  return root;
}
function opening() { const value = modalStore.getSnapshot().context.modals.find(value => !modalStore.getSnapshot().context.closingIds.includes(value.id)); expect(value).toBeDefined(); return value!; }
function nativeContext() { return modals.getContext(opening().id)! as ModalContext<CalendarCommandReceipt>; }
/** ControlledModal deliberately keeps this body bridge live without replacing native ownership. */
function body(): ReactNode {
  const context = nativeContext(), descriptor = opening().descriptor as ModalDescriptor<CalendarCommandReceipt>;
  const projected = typeof descriptor.body === 'function' ? descriptor.body(context) : descriptor.body;
  const bridge = (projected as ReactElement<{ bridge: { read(): ControlledModalProps<CalendarCommandReceipt> } }>).props.bridge;
  const current = bridge.read().descriptor;
  return typeof current.body === 'function' ? current.body(context) : current.body;
}
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function findElement(predicate: (value: ReactElement<Record<string, any>>) => boolean) {
  const value = elements(body()).find(predicate); expect(value).toBeDefined(); return value!;
}
function field(label: string) { return findElement(value => value.props['aria-label'] === label || value.props.label === label); }
function submitButton() { return findElement(value => value.props.type === 'submit'); }
function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(' ');
  return isValidElement<{ children?: ReactNode }>(node) ? textContent(node.props.children) : '';
}
function submitEvent() { return { preventDefault() {}, stopPropagation() {} }; }
async function submitForm() { await act(async () => { findElement(value => value.type === 'form').props.onSubmit(submitEvent()); }); }
async function changeTitle(value: string) { await act(async () => { field('Appointment title').props.onChange({ currentTarget: { value } }); }); }
async function changeField(label: string, value: number) { await act(async () => { field(label).props.onChange(value); }); }
async function chooseParticipants(value: readonly CalendarParticipantReference[]) { await act(async () => { findElement(element => element.type === CalendarParticipantFields).props.onChange(value); }); }
async function clickButton(text: string) { await act(async () => { findElement(value => typeof value.props.onClick === 'function' && textContent(value.props.children) === text).props.onClick(); }); }
function receiptFor(write: Write): CalendarCommandReceipt { return { requestId: write.control.idempotencyKey, operation: write.operation,
  id: write.operation === 'appointment.created' ? 'created-appointment' : record.id,
  revision: write.operation === 'appointment.created' ? 1 : record.revision + 1, changed: true }; }
async function acceptWrite(f: Fixture) { await act(async () => { const write = f.writes.at(-1)!; write.pending.resolve(receiptFor(write)); }); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
