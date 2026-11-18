/** Real Guardian/service/runtime/realm with memory SQLite. The target policy is explicitly simulated here;
 * participants-directory.test.ts separately qualifies canonical SYSTEM rows. No physical fence claim or disk fixture.
 */
import { expect, test } from 'bun:test';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { CalendarConfig } from './config';
import type { CalendarParticipantDirectoryQuery, CalendarParticipantReference, CalendarParticipantView, CalendarParticipantsView } from './contracts';
import { CalendarError } from './error';
import type { CalendarParticipantDirectory } from './participants-directory';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
const later = { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC' };
const reference = (userId: string): CalendarParticipantReference => ({ kind: 'guardian-user', userId });
const targetA = reference('target-a'), targetB = reference('target-b');
const enabled: CalendarConfig = { participants: { userEligibility: 'user' } };
const scopeKey = (scope: ServiceDataScope) => scope.scopeKind + ':' + scope.scopeId;

function simulatedDirectory() {
  const subjects = new Map<string, { name: string; available: boolean }>();
  const listeners = new Map<string, Set<() => void>>();
  const checks: { scope: string; references: readonly CalendarParticipantReference[] }[] = [];
  let onResolve: (() => void) | undefined, onList: (() => void) | undefined, guardMode: 'void' | 'async' | 'value' = 'void';
  const projection = (scope: ServiceDataScope, refs: readonly CalendarParticipantReference[]): CalendarParticipantView[] => refs.map(ref => {
    const subject = subjects.get(scopeKey(scope) + '/' + ref.userId);
    return subject?.available ? { ref: { ...ref }, availability: 'available', name: subject.name } : { ref: { ...ref }, availability: 'unavailable' };
  });
  const directory: CalendarParticipantDirectory = {
    list(scope, query: CalendarParticipantDirectoryQuery) {
      const refs = [...subjects.keys()].filter(key => key.startsWith(scopeKey(scope) + '/')).map(key => reference(key.slice(key.lastIndexOf('/') + 1))).sort((a, b) => a.userId.localeCompare(b.userId));
      const items = projection(scope, refs).filter(item => item.availability === 'available' && (!query.search || item.name.toLowerCase().includes(query.search.toLowerCase())));
      onList?.(); return { items: items.slice(0, query.limit ?? 25), truncated: false, nextAfter: null };
    },
    resolve(scope, refs) { const result = projection(scope, refs); onResolve?.(); return result; },
    assertBindable(scope, refs) {
      checks.push({ scope: scopeKey(scope), references: refs.map(ref => ({ ...ref })) });
      if (guardMode === 'async') return Promise.resolve(undefined) as never;
      if (guardMode === 'value') return true as never;
      for (const ref of refs) if (!subjects.get(scopeKey(scope) + '/' + ref.userId)?.available) throw new CalendarError('CALENDAR_NOT_FOUND');
    },
    subscribe(scope, listener) {
      const key = scopeKey(scope); let set = listeners.get(key); if (!set) listeners.set(key, set = new Set()); set.add(listener);
      return () => { set!.delete(listener); if (!set!.size) listeners.delete(key); };
    },
  };
  return { directory, checks,
    set(scope: ServiceDataScope, ref: CalendarParticipantReference, name = 'PRIVATE_TARGET_NAME', available = true, notify = false) {
      subjects.set(scopeKey(scope) + '/' + ref.userId, { name, available });
      if (notify) for (const listener of [...(listeners.get(scopeKey(scope)) ?? [])]) listener();
    },
    hint(scope: ServiceDataScope) { for (const listener of [...(listeners.get(scopeKey(scope)) ?? [])]) listener(); },
    onResolve(callback?: () => void) { onResolve = callback; }, onList(callback?: () => void) { onList = callback; },
    setGuardMode(value: 'void' | 'async' | 'value') { guardMode = value; },
    get subscriptions() { return [...listeners.values()].reduce((count, entries) => count + entries.size, 0); },
  };
}

test('native participants create and private projections share real source bindings but never ordinary details/busy', async () => {
  for (const tenancy of ['single', 'multi'] as const) {
    const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ tenancy, config: enabled, participantDirectory: directory.directory });
    const manager = f.session('manager', { manager: true });
    try {
      directory.set(manager.scope, targetA); directory.set(manager.scope, targetB, 'Second account');
      const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
      const made = await manager.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'PRIVATE_TITLE', participants: [targetB, targetA] }, { idempotencyKey: 'create' });
      expect(await manager.api.participants.forAppointment(made.id)).toEqual({ id: made.id, revision: 1, participants: [
        { ref: targetA, availability: 'available', name: 'PRIVATE_TARGET_NAME' }, { ref: targetB, availability: 'available', name: 'Second account' }] });
      expect((await manager.api.participants.directory({ search: 'PRIVATE' })).items).toEqual([{ ref: targetA, availability: 'available', name: 'PRIVATE_TARGET_NAME' }]);
      const range = { resourceIds: [resource.id], startAt: timed.startAt, endAt: timed.endAt };
      for (const page of [await manager.api.appointments.get(made.id), await manager.api.appointments.query(range),
        await manager.api.busy.query(range)]) {
        expect(JSON.stringify(page)).not.toContain('target-a'); expect(JSON.stringify(page)).not.toContain('PRIVATE_TARGET_NAME'); expect(page).not.toHaveProperty('participants');
      }
      const rows = f.sourceRows(manager.scope, '_calendar_appointment_participant_bindings');
      expect(rows).toHaveLength(1); expect(JSON.parse(String(rows[0]!.references_json))).toEqual([targetA, targetB]);
      expect(JSON.stringify(rows)).not.toContain('PRIVATE_TARGET_NAME'); expect(f.stats().activeLeases).toBe(0);
    } finally { await f.close(); expect(directory.subscriptions).toBe(0); }
  }
}, 30_000);

test('accepted create replay after target revocation compares full original intent without revalidating targets or duplicating effects', async () => {
  const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ config: enabled, participantDirectory: directory.directory }), manager = f.session('manager', { manager: true });
  try {
    directory.set(manager.scope, targetA);
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const input = { ...timed, resourceIds: [resource.id], title: 'PRIVATE_TITLE', participants: [targetA] };
    const accepted = await manager.api.appointments.create(input, { idempotencyKey: 'create' });
    directory.set(manager.scope, targetA, 'PRIVATE_TARGET_NAME', false);
    const checks = directory.checks.length, seq = f.sourceSequence(manager.scope), effects = f.sourceRows(manager.scope, '_calendar_effect_intents');
    expect(await manager.api.appointments.create(input, { idempotencyKey: 'create' })).toEqual(accepted);
    expect(await manager.api.receipts.get('create')).toEqual(accepted);
    await expect(manager.api.appointments.create({ ...input, participants: [] }, { idempotencyKey: 'create' })).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    await expect(manager.api.appointments.create({ ...input, title: 'changed' }, { idempotencyKey: 'create' })).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    expect(directory.checks).toHaveLength(checks); expect(f.sourceSequence(manager.scope)).toBe(seq); expect(f.sourceRows(manager.scope, '_calendar_effect_intents')).toEqual(effects);
    expect((await manager.api.participants.forAppointment(accepted.id)).participants).toEqual([{ ref: targetA, availability: 'unavailable' }]);
  } finally { await f.close(); }
}, 30_000);

test('replace validates newly added refs only, preserves unavailable historical refs, permits removal and binds guard diff to CAS', async () => {
  const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ config: enabled, participantDirectory: directory.directory }), manager = f.session('manager', { manager: true });
  try {
    directory.set(manager.scope, targetA); directory.set(manager.scope, targetB);
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const made = await manager.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Title', participants: [targetA] }, { idempotencyKey: 'create' });
    directory.set(manager.scope, targetA, 'PRIVATE_TARGET_NAME', false);
    const start = directory.checks.length;
    const changed = await manager.api.participants.replace(made.id, [targetB, targetA], { idempotencyKey: 'add', expectedRevision: 1 });
    expect(changed).toMatchObject({ revision: 2, operation: 'appointment.participants-changed' });
    expect(directory.checks.length).toBeGreaterThan(start);
    expect(directory.checks.slice(start).every(check => JSON.stringify(check.references) === JSON.stringify([targetB]))).toBe(true);
    directory.set(manager.scope, targetB, 'PRIVATE_TARGET_NAME', false);
    const checked = directory.checks.length;
    expect(await manager.api.participants.replace(made.id, [targetA, targetB], { idempotencyKey: 'add', expectedRevision: 1 })).toEqual(changed);
    expect(directory.checks).toHaveLength(checked);
    await expect(manager.api.participants.replace(made.id, [], { idempotencyKey: 'stale', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    await manager.api.participants.replace(made.id, [targetA], { idempotencyKey: 'preserve', expectedRevision: 2 });
    await manager.api.participants.replace(made.id, [], { idempotencyKey: 'remove', expectedRevision: 3 });
    expect((await manager.api.participants.forAppointment(made.id)).participants).toEqual([]);
    await expect(manager.api.participants.replace(made.id, [targetA], { idempotencyKey: 're-add-unavailable', expectedRevision: 4 })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect((await manager.api.participants.forAppointment(made.id)).revision).toBe(4);
  } finally { await f.close(); }
}, 30_000);

test('hold confirmation freshly admits captured refs, transfers exact set, and accepted replay survives later revocation', async () => {
  const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ config: enabled, participantDirectory: directory.directory }), manager = f.session('manager', { manager: true });
  try {
    directory.set(manager.scope, targetA); directory.set(manager.scope, targetB);
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const held = await manager.api.holds.acquire({ ...timed, resourceIds: [resource.id], participants: [targetB, targetA] }, { idempotencyKey: 'acquire' });
    expect(await manager.api.holds.get(held.id)).not.toHaveProperty('participants');
    expect((await manager.api.participants.forHold(held.id)).participants.map(item => item.ref)).toEqual([targetA, targetB]);
    directory.set(manager.scope, targetB, 'PRIVATE_TARGET_NAME', false);
    const seq = f.sourceSequence(manager.scope);
    await expect(manager.api.holds.confirm(held.id, { title: 'Confirmed' }, { idempotencyKey: 'confirm', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(f.sourceSequence(manager.scope)).toBe(seq); expect(f.sourceRows(manager.scope, 'calendar_appointments')).toEqual([]);
    expect((await manager.api.holds.get(held.id)).status).toBe('held'); expect(await manager.api.receipts.get('confirm')).toBeNull();
    directory.set(manager.scope, targetB);
    const accepted = await manager.api.holds.confirm(held.id, { title: 'Confirmed' }, { idempotencyKey: 'confirm', expectedRevision: 1 });
    expect((await manager.api.participants.forAppointment(accepted.id)).participants.map(item => item.ref)).toEqual([targetA, targetB]);
    const holdBinding = f.sourceRows(manager.scope, '_calendar_hold_participant_bindings')[0]!, appointmentBinding = f.sourceRows(manager.scope, '_calendar_appointment_participant_bindings')[0]!;
    expect(appointmentBinding.references_json).toBe(holdBinding.references_json);
    directory.set(manager.scope, targetA, 'PRIVATE_TARGET_NAME', false); const checks = directory.checks.length;
    expect(await manager.api.holds.confirm(held.id, { title: 'Confirmed' }, { idempotencyKey: 'confirm', expectedRevision: 1 })).toEqual(accepted);
    expect(directory.checks).toHaveLength(checks);
  } finally { await f.close(); }
}, 30_000);

test('closed configuration and nonmanager details/book/manage grants never imply participant discovery or binding', async () => {
  for (const feature of ['disabled', 'missing-directory', 'enabled'] as const) {
    const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ config: feature === 'disabled' ? {} : enabled,
      ...(feature === 'missing-directory' ? {} : { participantDirectory: directory.directory }) });
    const manager = f.session('manager', { manager: true }), owner = f.session('owner'), reader = f.session('reader');
    try {
      const resource = await owner.api.resources.create({ label: 'Person', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
      await owner.api.resources.setGrants(resource.id, reader.userId, ['manage'], { idempotencyKey: 'grant', expectedRevision: 1 });
      const made = await owner.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Title' }, { idempotencyKey: 'legacy' });
      expect((await reader.api.appointments.get(made.id)).id).toBe(made.id);
      for (const session of [owner, reader]) {
        await expect(session.api.participants.directory()).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
        await expect(session.api.participants.forAppointment(made.id)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
        await expect(session.api.participants.replace(made.id, [], { idempotencyKey: 'replace', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
        await expect(session.api.appointments.create({ ...later, resourceIds: [resource.id], title: 'Title', participants: [] }, { idempotencyKey: 'bind' })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
      }
      if (feature !== 'enabled') await expect(manager.api.participants.directory()).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
      const held = await owner.api.holds.acquire({ ...later, resourceIds: [resource.id] }, { idempotencyKey: 'legacy-hold' });
      expect((await owner.api.holds.confirm(held.id, { title: 'Legacy confirm' }, { idempotencyKey: 'legacy-confirm', expectedRevision: 1 })).operation).toBe('appointment.created');
      expect(f.sourceRows(owner.scope, '_calendar_appointment_participant_bindings')).toEqual([]); expect(directory.checks).toEqual([]);
    } finally { await f.close(); }
  }
}, 30_000);

test('a configured Guardian scope-role manager need not have the platform admin label', async () => {
  const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ config: { ...enabled, manage: { scopeRole: 'owner' } }, participantDirectory: directory.directory });
  const scheduler = f.session('scheduler', { context: { role: 'user', tenantRole: 'owner' } });
  try {
    directory.set(scheduler.scope, targetA);
    const resource = await scheduler.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'room' });
    const made = await scheduler.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Scheduled', participants: [targetA] }, { idempotencyKey: 'appointment' });
    expect((await scheduler.api.participants.forAppointment(made.id)).participants[0]!.ref).toEqual(targetA);
  } finally { await f.close(); }
}, 30_000);

test('participant selection, co-resource routing and request identity detach before the first awaited authority check', async () => {
  const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ config: enabled, participantDirectory: directory.directory }), manager = f.session('manager', { manager: true });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  try {
    directory.set(manager.scope, targetA); directory.set(manager.scope, targetB);
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    let first = true;
    const api = f.service.forAuthority({ ...manager.authority, async assertCurrentAuthority() {
      if (first) { first = false; entered(); await gate; }
      await manager.authority.assertCurrentAuthority();
    } });
    const input = { ...timed, resourceIds: [resource.id], title: 'Title', participants: [{ kind: 'guardian-user' as const, userId: targetA.userId }] };
    const options = { idempotencyKey: 'detached' }, pending = api.appointments.create(input, options);
    await ready; input.participants[0]!.userId = targetB.userId; input.resourceIds[0] = 'retargeted'; options.idempotencyKey = 'retargeted'; release();
    const accepted = await pending;
    expect(accepted.requestId).toBe('detached'); expect(directory.checks.length).toBeGreaterThan(0);
    expect(directory.checks.every(check => JSON.stringify(check.references) === JSON.stringify([targetA]))).toBe(true);
    expect((await manager.api.participants.forAppointment(accepted.id)).participants.map(item => item.ref)).toEqual([targetA]);
    expect((await manager.api.appointments.get(accepted.id)).resourceIds).toEqual([resource.id]);
  } finally { release(); await f.close(); }
}, 30_000);

test('participant target change immediately before the opaque dispatch guard rejects with no source receipt/effect or partial binding', async () => {
  const directory = simulatedDirectory(); let revoke = false;
  const f = memoryCalendarServiceFixture({ config: enabled, participantDirectory: directory.directory, beforeDispatch(operation) {
    if (revoke && operation.type === 'command' && operation.name === 'calendar.appointment.create') {
      revoke = false; directory.set(manager.scope, targetA, 'PRIVATE_TARGET_NAME', false);
    }
  } }), manager = f.session('manager', { manager: true });
  try {
    directory.set(manager.scope, targetA);
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const seq = f.sourceSequence(manager.scope), receipts = f.sourceRows(manager.scope, '_calendar_receipts'), effects = f.sourceRows(manager.scope, '_calendar_effect_intents');
    revoke = true;
    await expect(manager.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Race', participants: [targetA] }, { idempotencyKey: 'race' }))
      .rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN', outcome: 'not-started' });
    expect(directory.checks.length).toBeGreaterThan(1); expect(f.sourceSequence(manager.scope)).toBe(seq);
    expect(f.sourceRows(manager.scope, '_calendar_receipts')).toEqual(receipts); expect(f.sourceRows(manager.scope, '_calendar_effect_intents')).toEqual(effects);
    expect(f.sourceRows(manager.scope, 'calendar_appointments')).toEqual([]); expect(f.sourceRows(manager.scope, '_calendar_appointment_participant_bindings')).toEqual([]);
    expect(await manager.api.receipts.get('race')).toBeNull();
  } finally { await f.close(); }
}, 30_000);

test('Promise-returning and nonvoid participant target checks fail the synchronous boundary before source mutation', async () => {
  const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ config: enabled, participantDirectory: directory.directory }), manager = f.session('manager', { manager: true });
  try {
    directory.set(manager.scope, targetA);
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const seq = f.sourceSequence(manager.scope);
    for (const mode of ['async', 'value'] as const) {
      directory.setGuardMode(mode);
      await expect(manager.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Invalid target guard', participants: [targetA] }, { idempotencyKey: mode }))
        .rejects.toMatchObject({ code: mode === 'async' ? 'AUTH_STATE_INVARIANT_FAILED' : 'CALENDAR_CONFIG_INVALID' });
      expect(f.sourceSequence(manager.scope)).toBe(seq); expect(f.sourceRows(manager.scope, 'calendar_appointments')).toEqual([]);
    }
  } finally { await f.close(); }
}, 30_000);

test('target revocation ordered after the real source command accepts preserves its known accepted receipt instead of unknown outcome', async () => {
  const directory = simulatedDirectory(); let revoke = false;
  const f = memoryCalendarServiceFixture({ config: enabled, participantDirectory: directory.directory, afterCommand(operation) {
    if (revoke && operation.type === 'command' && operation.name === 'calendar.appointment.create') {
      revoke = false; directory.set(manager.scope, targetA, 'PRIVATE_TARGET_NAME', false);
    }
  } }), manager = f.session('manager', { manager: true });
  try {
    directory.set(manager.scope, targetA);
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const input = { ...timed, resourceIds: [resource.id], title: 'Accepted before revocation', participants: [targetA] };
    revoke = true;
    const accepted = await manager.api.appointments.create(input, { idempotencyKey: 'accepted-before-revocation' });
    expect(accepted).toMatchObject({ changed: true, operation: 'appointment.created', revision: 1 });
    expect(await manager.api.receipts.get('accepted-before-revocation')).toEqual(accepted);
    const seq = f.sourceSequence(manager.scope), effects = f.sourceRows(manager.scope, '_calendar_effect_intents');
    expect(await manager.api.appointments.create(input, { idempotencyKey: 'accepted-before-revocation' })).toEqual(accepted);
    expect(f.sourceSequence(manager.scope)).toBe(seq); expect(f.sourceRows(manager.scope, '_calendar_effect_intents')).toEqual(effects);
    expect((await manager.api.participants.forAppointment(accepted.id)).participants).toEqual([{ ref: targetA, availability: 'unavailable' }]);
  } finally { await f.close(); }
}, 30_000);

test('private publication synchronously re-resolves target name and tombstone after the final asynchronous Guardian check', async () => {
  const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ config: enabled, participantDirectory: directory.directory }), manager = f.session('manager', { manager: true });
  try {
    directory.set(manager.scope, targetA, 'OLD_PRIVATE_NAME');
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const made = await manager.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Title', participants: [targetA] }, { idempotencyKey: 'create' });
    let resolved = false, available = true;
    directory.onResolve(() => { resolved = true; }); directory.onList(() => { resolved = true; });
    const api = f.service.forAuthority({ ...manager.authority, async assertCurrentAuthority() {
      await manager.authority.assertCurrentAuthority();
      if (resolved) { resolved = false; directory.set(manager.scope, targetA, 'CURRENT_PRIVATE_NAME', available); }
    } });
    const current = await api.participants.forAppointment(made.id);
    expect(current.participants).toEqual([{ ref: targetA, availability: 'available', name: 'CURRENT_PRIVATE_NAME' }]);
    available = false;
    expect((await api.participants.forAppointment(made.id)).participants).toEqual([{ ref: targetA, availability: 'unavailable' }]);
    directory.set(manager.scope, targetA, 'WITHDRAW_AFTER_LIST', true); resolved = false;
    expect((await api.participants.directory()).items).toEqual([]);
  } finally { await f.close(); }
}, 30_000);

test('participant watches resolve fresh directory hints, publish tombstones, and retire subscriptions on viewer revocation', async () => {
  const directory = simulatedDirectory(), f = memoryCalendarServiceFixture({ config: enabled, participantDirectory: directory.directory }), manager = f.session('manager', { manager: true });
  const pages: CalendarParticipantsView[] = [], errors: unknown[] = []; let stop = () => {};
  try {
    directory.set(manager.scope, targetA, 'ORIGINAL_PRIVATE_NAME');
    const resource = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const made = await manager.api.appointments.create({ ...timed, resourceIds: [resource.id], title: 'Title', participants: [targetA] }, { idempotencyKey: 'create' });
    stop = manager.api.participants.watchForAppointment(made.id, page => pages.push(page), { onError: error => errors.push(error) });
    await eventuallyCalendar(() => pages.length === 1);
    directory.set(manager.scope, targetA, 'RENAMED_PRIVATE_NAME', true, true);
    await eventuallyCalendar(() => pages.some(page => page.participants.some(item => item.availability === 'available' && item.name === 'RENAMED_PRIVATE_NAME')));
    directory.set(manager.scope, targetA, 'DO_NOT_PUBLISH_UNAVAILABLE_NAME', false, true);
    await eventuallyCalendar(() => pages.at(-1)?.participants[0]?.availability === 'unavailable');
    expect(JSON.stringify(pages.at(-1))).not.toContain('DO_NOT_PUBLISH_UNAVAILABLE_NAME');
    const count = pages.length; manager.revoke(); directory.hint(manager.scope);
    await eventuallyCalendar(() => errors.length === 1 && f.stats().subscriptions === 0 && directory.subscriptions === 0);
    directory.set(manager.scope, targetA, 'LATE_PRIVATE_NAME', true, true); await Promise.resolve();
    expect(pages).toHaveLength(count); expect(errors[0]).toMatchObject({ code: 'AUTH_STATE_CHANGED' });
  } finally { stop(); await f.close(); expect(directory.subscriptions).toBe(0); }
}, 30_000);
