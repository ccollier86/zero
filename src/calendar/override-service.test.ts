/** Accepted native write + lost acknowledgment, MEMORY only. Never automatic resend. */
import { expect, test } from 'bun:test';
import type { MemoryCalendarSession } from './test-support/memory-service-fixture';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';
import { CalendarService } from './service';

test('accepted override with retired publication stays unknown, then reconciles its original key after grant removal and config disablement', async () => {
  let retire = false, original: MemoryCalendarSession | undefined;
  const f = memoryCalendarServiceFixture({ config: { overrides: {
    kind: 'appointment-overlap-v1', use: 'user', manageGrants: 'admin',
  } }, afterCommand(operation) {
    if (retire && operation.type === 'command' && operation.name === 'calendar.appointment.create') { retire = false; original!.revoke(); }
  } });
  const closing = new AbortController(); let disabled: CalendarService | undefined;
  try {
    original = f.session('manager', { manager: true });
    const r = await original.api.resources.create({ label: 'Synthetic calendar', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await original.api.overrides.grants.replace(r.id, original.userId, { categories: ['appointment-overlap'] }, { idempotencyKey: 'grant', expectedRevision: 1 });
    const input = { title: 'PRIVATE_REVIEWED_APPOINTMENT', resourceIds: [r.id], startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
    await original.api.appointments.create(input, { idempotencyKey: 'existing' });
    const key = 'original-reviewed-save', review = await original.api.appointments.reviewCreate(input, { idempotencyKey: key });
    if (review.status !== 'reviewable') throw new Error('Expected synthetic review');
    const options = { idempotencyKey: key, override: { policyVersion: review.policyVersion,
      decisionToken: review.decisionToken, reason: 'PRIVATE_REVIEW_REASON' } };
    retire = true;
    await expect(original.api.appointments.create(input, options)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(f.sourceRows(original.scope, 'calendar_appointments')).toHaveLength(2);
    expect(f.sourceRows(original.scope, '_calendar_override_admissions')).toHaveLength(1);
    expect(f.sourceRows(original.scope, '_calendar_appointment_override_history')).toHaveLength(1);
    const current = f.session(original.userId, { manager: true });
    const accepted = await current.api.receipts.get(key);
    expect(accepted).toMatchObject({ operation: 'appointment.created', requestId: key, revision: 1 });
    if (!accepted) throw new Error('Expected accepted synthetic original receipt');
    await current.api.overrides.grants.replace(r.id, current.userId, { categories: [] }, { idempotencyKey: 'revoke', expectedRevision: 2 });
    // Reconciliation after an explicit policy disablement is not fresh exception
    // admission. It still re-enters native intent and current object rights.
    disabled = new CalendarService(f.runtime, { ...f.config, overrides: false }, closing.signal);
    const api = disabled.forAuthority(current.authority), before = f.sourceSequence(current.scope);
    expect(await api.appointments.create(input, options)).toEqual(accepted);
    expect(await api.receipts.get(key)).toEqual(accepted);
    expect(f.sourceSequence(current.scope)).toBe(before);
    expect(f.sourceRows(current.scope, '_calendar_override_admissions')).toHaveLength(1);
    expect(f.sourceRows(current.scope, '_calendar_effect_intents').filter(row => row.target_id === accepted.id)).toHaveLength(1);
    expect(f.stats().activeLeases).toBe(0);
  } finally {
    closing.abort();
    try { await disabled?.close(); } finally { await f.close(); }
  }
});
