import { expect, test } from 'bun:test';
import type { CalendarCommandReceipt } from '../../../calendar/contracts';
import { CalendarMutationError, CalendarReadError } from '../../../frontend/client/calendar-mutation';
import { CalendarDraftMutationController, type CalendarDraftMutationContext } from './calendar-draft-mutation-controller';
import type { CalendarPendingRequest } from './calendar-workspace-model';

const request: CalendarPendingRequest = { key: 'original', operation: 'appointment.updated', id: 'appointment', expectedRevision: 4 };
const receipt: CalendarCommandReceipt = { requestId: request.key, operation: request.operation, id: request.id!, revision: 5, changed: true };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const abort = new AbortController(), accepted: CalendarPendingRequest[] = [], rejected: CalendarPendingRequest[] = [], unknown: CalendarPendingRequest[] = [];
  const closes: CalendarCommandReceipt[] = [], keys: string[] = [], flags: boolean[] = [];
  let current = true, lost = 0, visible: CalendarCommandReceipt | null = null, readError: unknown;
  const context: CalendarDraftMutationContext = { signal: abort.signal, setBusy: value => flags.push(value), accept: value => closes.push(value) };
  const controller = new CalendarDraftMutationController({ isCurrent: () => current,
    readReceipt: async key => { keys.push(key); if (readError) throw readError; return visible; },
    onUnknown: value => unknown.push(value), onRejected: value => rejected.push(value), onAccepted: value => accepted.push(value), onAuthorityLost: () => { lost++; } });
  return { controller, context, abort, accepted, rejected, unknown, closes, keys, flags,
    setCurrent: (value: boolean) => { current = value; }, setReceipt: (value: CalendarCommandReceipt | null) => { visible = value; },
    setReadError: (value: unknown) => { readError = value; }, lost: () => lost };
}

test('one dispatch captures the request, records recovery before waiting and accepts only one matching revision', async () => {
  const f = fixture(), pending = deferred<CalendarCommandReceipt>(); let writes = 0;
  const submitted = f.controller.submit(f.context, request, () => { expect(f.unknown).toHaveLength(1); writes++; return pending.promise; });
  await f.controller.submit(f.context, { ...request, key: 'duplicate' }, async () => { writes++; return receipt; });
  expect(writes).toBe(1); expect(Object.isFrozen(f.unknown[0])).toBe(true); expect(f.flags).toEqual([true]);
  pending.resolve(receipt); await submitted;
  expect(f.accepted).toEqual([f.unknown[0]!]); expect(f.closes).toEqual([receipt]); expect(f.flags).toEqual([true, false]);
});

test('newer typing survives older accepted work and cannot be submitted under a replacement key', async () => {
  const f = fixture(), pending = deferred<CalendarCommandReceipt>();
  const submitted = f.controller.submit(f.context, request, () => pending.promise); f.controller.edit();
  pending.resolve(receipt); await submitted;
  expect(f.closes).toEqual([]); expect(f.controller.snapshot().phase).toBe('accepted');
  expect(f.controller.snapshot().error).toContain('newer');
  let writes = 0; await f.controller.submit(f.context, { ...request, key: 'new-key' }, async () => { writes++; return receipt; }); expect(writes).toBe(0);
});

test('mismatched proofs stay unknown and reconcile only the original identity without another write', async () => {
  const f = fixture(); let writes = 0;
  await f.controller.submit(f.context, request, async () => { writes++; return { ...receipt, revision: 6 }; });
  expect(f.controller.snapshot().phase).toBe('unknown'); expect(f.accepted).toEqual([]);
  await f.controller.reconcile(f.context); expect(f.keys).toEqual(['original']); expect(f.controller.snapshot().error).toContain('does not prove');
  f.setReceipt({ ...receipt, id: 'another' }); await f.controller.reconcile(f.context); expect(f.accepted).toEqual([]);
  f.setReceipt(receipt); await f.controller.reconcile(f.context);
  expect(f.accepted).toHaveLength(1); expect(f.closes).toEqual([receipt]); expect(writes).toBe(1);
});

test('creation requires a native accepted identity, not just a changed revision-one acknowledgment', async () => {
  const f = fixture();
  await f.controller.submit(f.context, { key: 'create', operation: 'appointment.created' }, async () => ({
    requestId: 'create', operation: 'appointment.created', id: '', revision: 1, changed: true }));
  expect(f.controller.snapshot().phase).toBe('unknown'); expect(f.accepted).toEqual([]); expect(f.closes).toEqual([]);
});

test('known noncommit releases only its own identity while a wrong-key failure remains unknown', async () => {
  const f = fixture();
  await f.controller.submit(f.context, request, async () => { throw new CalendarMutationError('original', 'not-committed', 'CALENDAR_BOOKING_CONFLICT', 409); });
  expect(f.rejected).toEqual([f.unknown[0]!]); expect(f.controller.snapshot().phase).toBe('editing'); expect(f.controller.snapshot().request).toBeNull();
  await f.controller.submit(f.context, { ...request, key: 'second' }, async () => { throw new CalendarMutationError('wrong-key', 'not-committed', 'CALENDAR_BOOKING_CONFLICT', 409); });
  expect(f.rejected).toHaveLength(1); expect(f.controller.snapshot().phase).toBe('unknown'); expect(f.controller.snapshot().request?.key).toBe('second');
});

test('CAS conflicts preserve the draft and block another operation until a new owner reviews current data', async () => {
  const f = fixture(); let writes = 0;
  await f.controller.submit(f.context, request, async () => { writes++; throw new CalendarMutationError('original', 'not-committed', 'CALENDAR_REVISION_CONFLICT', 409); });
  expect(f.controller.snapshot().phase).toBe('conflict');
  await f.controller.submit(f.context, { ...request, key: 'second' }, async () => { writes++; return receipt; }); expect(writes).toBe(1);
});

test('owner retirement and native abort fence retained callbacks and late acceptance', async () => {
  for (const retire of ['scope', 'abort', 'permanent'] as const) {
    const f = fixture(), pending = deferred<CalendarCommandReceipt>(); let writes = 0;
    const submitted = f.controller.submit(f.context, request, () => { writes++; return pending.promise; });
    if (retire === 'scope') f.setCurrent(false); else if (retire === 'abort') f.abort.abort(); else f.controller.retire();
    pending.resolve(receipt); await submitted;
    expect(f.accepted).toEqual([]); expect(f.closes).toEqual([]);
    await f.controller.submit(f.context, { ...request, key: 'retained' }, async () => { writes++; return receipt; }); expect(writes).toBe(1);
  }
});

test('observed mutation/read denial retires actions without turning unknown acceptance into a noncommit', async () => {
  for (const unknown of [false, true]) {
    const f = fixture();
    await f.controller.submit(f.context, request, async () => { throw new CalendarMutationError('original', unknown ? 'unknown' : 'not-committed', 'CALENDAR_FORBIDDEN', 403); });
    expect(f.lost()).toBe(1); expect(f.rejected).toHaveLength(unknown ? 0 : 1); expect(f.unknown).toHaveLength(1);
  }
  const f = fixture();
  await f.controller.submit(f.context, request, async () => { throw new Error('network'); });
  f.setReadError(new CalendarReadError('CALENDAR_NOT_FOUND', 404)); await f.controller.reconcile(f.context); expect(f.lost()).toBe(1);
});

test('failed recovery registration is known not-started; settlement notifications cannot relabel proven acceptance', async () => {
  const f = fixture(); let writes = 0;
  const unregistered = new CalendarDraftMutationController({ isCurrent: () => true, readReceipt: async () => null,
    onUnknown() { throw new Error('registration'); }, onAccepted() {}, onRejected() { throw new Error('cleanup'); }, onAuthorityLost() {} });
  await unregistered.submit(f.context, request, async () => { writes++; return receipt; });
  expect(writes).toBe(0); expect(unregistered.snapshot()).toMatchObject({ phase: 'editing', busy: false, request: null });
  expect(unregistered.snapshot().error).toContain('No mutation was dispatched');
  const controller = new CalendarDraftMutationController({ isCurrent: () => true, readReceipt: async () => receipt,
    onUnknown() {}, onAccepted() { throw new Error('observer'); },
    onRejected() { throw new Error('observer'); }, onAuthorityLost() { throw new Error('observer'); } });
  controller.subscribe(() => { throw new Error('subscriber'); });
  await controller.submit(f.context, request, async () => { writes++; return receipt; });
  expect(writes).toBe(1); expect(controller.snapshot()).toMatchObject({ phase: 'accepted', busy: false, error: null });
  expect(f.closes).toEqual([receipt]);
  const failed = new CalendarDraftMutationController({ isCurrent: () => true, readReceipt: async () => null,
    onUnknown() {}, onAccepted() {}, onRejected() { throw new Error('observer'); }, onAuthorityLost() {} });
  await failed.submit(f.context, request, async () => { throw new Error('actual transport failure'); });
  expect(failed.snapshot()).toMatchObject({ phase: 'unknown', busy: false }); expect(failed.snapshot().request?.key).toBe('original');
  const refused = new CalendarDraftMutationController({ isCurrent: () => true, readReceipt: async () => null,
    onUnknown() {}, onAccepted() {}, onRejected() { throw new Error('observer'); }, onAuthorityLost() {} });
  await refused.submit(f.context, request, async () => { throw new CalendarMutationError('original', 'not-committed', 'CALENDAR_BOOKING_CONFLICT', 409); });
  expect(refused.snapshot()).toMatchObject({ phase: 'editing', busy: false, request: null });
});

test('async registration is not synchronous proof; async settlement rejection cannot become a transport failure', async () => {
  const f = fixture(); let writes = 0;
  const registration = new CalendarDraftMutationController({ isCurrent: () => true, readReceipt: async () => null,
    async onUnknown() { throw new Error('async registration'); }, onAccepted() {}, onRejected() {}, onAuthorityLost() {} });
  await registration.submit(f.context, request, async () => { writes++; return receipt; });
  expect(writes).toBe(0); expect(registration.snapshot()).toMatchObject({ phase: 'editing', busy: false, request: null });
  const settlement = new CalendarDraftMutationController({ isCurrent: () => true, readReceipt: async () => null,
    onUnknown() {}, async onAccepted() { throw new Error('async settlement'); }, onRejected() {}, onAuthorityLost() {} });
  await settlement.submit(f.context, request, async () => { writes++; return receipt; }); await Promise.resolve();
  expect(writes).toBe(1); expect(settlement.snapshot()).toMatchObject({ phase: 'accepted', busy: false }); expect(f.closes).toEqual([receipt]);
});

test('notification-driven owner retirement gates dispatch and close; a native close failure does not erase accepted proof', async () => {
  const f = fixture(); let current = true, writes = 0;
  const before = new CalendarDraftMutationController({ isCurrent: () => current, readReceipt: async () => null,
    onUnknown() { current = false; }, onAccepted() {}, onRejected() {}, onAuthorityLost() {} });
  await before.submit(f.context, request, async () => { writes++; return receipt; }); expect(writes).toBe(0);
  current = true;
  const after = new CalendarDraftMutationController({ isCurrent: () => current, readReceipt: async () => null,
    onUnknown() {}, onAccepted() { current = false; }, onRejected() {}, onAuthorityLost() {} });
  await after.submit(f.context, request, async () => receipt); expect(f.closes).toEqual([]); expect(after.snapshot().phase).toBe('accepted');
  const closeFailure = fixture(); closeFailure.context.accept = () => { throw new Error('native close'); };
  await closeFailure.controller.submit(closeFailure.context, request, async () => receipt);
  expect(closeFailure.controller.snapshot()).toMatchObject({ phase: 'accepted', busy: false });
  expect(closeFailure.controller.snapshot().error).toContain('accepted'); expect(closeFailure.accepted).toHaveLength(1);
});
