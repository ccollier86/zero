/** Browser codec/transport only: synthetic responses, no files/server/provider. */
import { expect, spyOn, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import type { CalendarAppointmentCreateInput, CalendarAppointmentView, CalendarCommandReceipt } from '../../calendar/contracts';

const intent = { kind: 'all-day-local-v1', startDate: '2026-10-15', endDate: '2026-11-15', timeZone: 'America/New_York' } as const;
const record: CalendarAppointmentView = { id: 'appointment', revision: 1, resourceIds: ['resource'], title: 'SYNTHETIC_APPOINTMENT',
  startAt: '2026-10-15T04:00:00.000Z', endAt: '2026-11-15T05:00:00.000Z', timeZone: 'America/New_York',
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'synthetic-user', interval: intent };
const page = { items: [record], truncated: false };
const query = { resourceIds: ['resource'], startDate: '2026-10-15', endDate: '2026-11-15' };
const receipt = { requestId: 'create-all-day', operation: 'appointment.created', id: 'appointment', revision: 1, changed: true } satisfies CalendarCommandReceipt;
function blockTimezoneEngine() {
  const unavailable = new Proxy(Intl.DateTimeFormat, {
    apply() { throw new Error('Synthetic timezone engine unavailable.'); },
    construct() { throw new Error('Synthetic timezone engine unavailable.'); },
  });
  return spyOn(Intl, 'DateTimeFormat').mockImplementation(unavailable);
}

test('explicit all-day create/update preserve authored intent without consulting a current timezone engine', async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: { body?: unknown }) => {
    calls.push({ path, body: init?.body });
    return (path.endsWith('/appointments') ? receipt : { ...receipt, requestId: 'update-all-day', operation: 'appointment.updated', revision: 2 }) as T;
  });
  const format = blockTimezoneEngine();
  try {
    await expect(client.appointments.create({ resourceIds: ['resource'], title: 'SYNTHETIC_APPOINTMENT', interval: intent },
      { idempotencyKey: 'create-all-day' })).resolves.toEqual(receipt);
    await client.appointments.update('appointment', { interval: intent }, { idempotencyKey: 'update-all-day', expectedRevision: 1 });
    expect(calls).toEqual([
      { path: '/api/calendar/appointments', body: { appointment: { resourceIds: ['resource'], title: 'SYNTHETIC_APPOINTMENT', interval: intent }, options: { idempotencyKey: 'create-all-day' } } },
      { path: '/api/calendar/appointments/appointment', body: { appointment: { interval: intent }, options: { idempotencyKey: 'update-all-day', expectedRevision: 1 } } },
    ]);
    expect(format).not.toHaveBeenCalled();
  } finally { format.mockRestore(); client.clear(); }
});

test('date query preserves a31-nominal-day fall-back appointment and its captured view when Intl is unavailable', async () => {
  const calls: unknown[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: { body?: unknown }) => { calls.push({ path, body: init?.body }); return page as T; });
  const format = blockTimezoneEngine();
  try {
    expect(await client.appointments.queryDates(query)).toEqual(page);
    expect(calls).toEqual([{ path: '/api/calendar/appointments/query-dates', body: { query } }]);
    expect(format).not.toHaveBeenCalled();
  } finally { format.mockRestore(); client.clear(); }
});

test('mixed/date-invalid/typed all-day creation fails locally with zero transport', async () => {
  let calls = 0;
  const client = createCalendarClient(async <T>() => { calls++; return receipt as T; });
  try {
    const base = { resourceIds: ['resource'], title: 'SYNTHETIC_APPOINTMENT', interval: intent };
    for (const value of [
      { ...base, startAt: record.startAt }, { ...base, bufferBeforeMinutes: 0 },
      { ...base, interval: { ...intent, endDate: '2026-11-16' } },
      { ...base, interval: { ...intent, startDate: '2026-02-29' } },
      { ...base, interval: { ...intent, kind: 'all-day-local-v1', engine: 'authored-provider' } },
      { ...base, appointmentType: { id: 'minute-type', revision: 1 } },
    ]) expect(() => client.appointments.create(value as CalendarAppointmentCreateInput, { idempotencyKey: 'create-all-day' })).toThrow();
    expect(() => client.appointments.update('appointment', { interval: intent, startAt: record.startAt } as never,
      { idempotencyKey: 'mixed-update', expectedRevision: 1 })).toThrow();
    expect(calls).toBe(0);
  } finally { client.clear(); }
});

test('date-labelled requests support year0000 and reject malformed, reversed, oversized or authority-bearing queries before transport', async () => {
  let calls = 0;
  const client = createCalendarClient(async <T>() => { calls++; return { items: [], truncated: false } as T; });
  try {
    await expect(client.appointments.queryDates({ resourceIds: [], startDate: '0000-02-28', endDate: '0000-03-01' })).resolves.toEqual({ items: [], truncated: false });
    for (const value of [
      { ...query, startDate: '2026-02-29' }, { ...query, endDate: query.startDate },
      { ...query, endDate: '2026-11-16' }, { ...query, actor: 'forged' }, { ...query, timeZone: 'UTC' },
      { ...query, resourceIds: ['resource', 'resource'] },
    ]) expect(() => client.appointments.queryDates(value as never)).toThrow();
    expect(calls).toBe(1);
  } finally { client.clear(); }
});

test('date-query responses cannot substitute timed, out-of-range, malformed, buffered or minute-typed records', async () => {
  const timed = { ...record }; delete (timed as { interval?: unknown }).interval;
  for (const item of [timed,
    { ...record, interval: { ...intent, kind: 'timed-v1' } },
    { ...record, interval: { ...intent, startDate: '2026-12-01', endDate: '2026-12-02' } },
    { ...record, interval: { ...intent, endDate: '2026-02-29' } }, { ...record, bufferAfterMinutes: 1 },
    { ...record, resourceIds: ['unrequested'] }, { ...record, status: 'cancelled' },
    { ...record, appointmentType: { id: 'type', revision: 1, label: 'SYNTHETIC_TYPE', durationMinutes: 44640, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null } },
  ]) {
    const client = createCalendarClient(async <T>() => ({ items: [item], truncated: false }) as T);
    try { await expect(client.appointments.queryDates(query)).rejects.toBeDefined(); }
    finally { client.clear(); }
  }
});

test('authority replacement retires a pending date query before its late result can be delivered', async () => {
  let finish!: (value: unknown) => void;
  const response = new Promise<unknown>(resolve => { finish = resolve; });
  const client = createCalendarClient(async <T>() => await response as T);
  const task = client.appointments.queryDates(query); void task.catch(() => {});
  try { client.clear(); finish(page); await expect(task).rejects.toMatchObject({ name: 'AbortError' }); }
  finally { finish(page); await task.catch(() => {}); client.clear(); }
});
