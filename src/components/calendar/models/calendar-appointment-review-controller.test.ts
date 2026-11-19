import { expect, test } from 'bun:test';
import type { CalendarOverrideReview } from '../../../calendar/contracts';
import { CalendarReadError } from '../../../frontend/client/calendar-mutation';
import { CalendarAppointmentReviewController } from './calendar-appointment-review-controller';
const result: CalendarOverrideReview = { status: 'reviewable', categories: ['appointment-overlap'], policyVersion: 'appointment-overlap-v1',
  decisionToken: 'co1.1.9999999999999.' + 'a'.repeat(32) + '.' + 'b'.repeat(64), expiresAt: '2099-01-01T00:00:00.000Z' };
function fixture() { let basis = 'one', alive = true, edits = 0, lost = 0, keys = 0;
  const context = { signal: new AbortController().signal }, controller = new CalendarAppointmentReviewController({
    isCurrent: (_, captured) => alive && captured === basis, createKey: () => 'proposed-' + ++keys, onEdit() { edits++; }, onAuthorityLost() { lost++; },
  }); return { context, controller, basis(value: string) { basis = value; }, retire() { alive = false; }, edits: () => edits, lost: () => lost }; }
test('read-only review allocates a proposed key but choice+private reason are required before any submission is offered', async () => {
  const f = fixture(), { controller, context } = f;
  try {
    await controller.review(context, 'one', async key => { expect(key).toBe('proposed-1'); return result; });
    expect(controller.snapshot().selected).toBe(false); expect(controller.submission(context, 'one')).toBeNull();
    controller.choose(context, 'one', true); controller.reason(context, 'one', '  PRIVATE_REASON  ');
    expect(controller.submission(context, 'one')).toEqual({ key: 'proposed-1', override: { policyVersion: 'appointment-overlap-v1', decisionToken: result.status === 'reviewable' ? result.decisionToken : '', reason: 'PRIVATE_REASON' } });
    expect(f.edits()).toBe(2);
    controller.cancel(); expect(controller.snapshot()).toMatchObject({ phase: 'idle', reason: '', key: null });
  } finally { controller.cancel(); }
});
test('cancel, replaced candidate and retired owner cannot publish late proof or authorize a stale choice', async () => {
  const f = fixture(), { controller, context } = f; let resolve!: (value: CalendarOverrideReview) => void;
  try {
    const task = controller.review(context, 'one', () => new Promise(done => { resolve = done; }));
    controller.cancel(); resolve(result); await task; expect(controller.snapshot().phase).toBe('idle');
    await controller.review(context, 'one', async () => result); controller.reason(context, 'one', 'Newer private draft');
    f.basis('two'); controller.invalidate(); controller.choose(context, 'one', true);
    expect(controller.snapshot()).toMatchObject({ phase: 'stale', selected: false, result: null, reason: 'Newer private draft' });
    expect(controller.submission(context, 'two')).toBeNull();
    await controller.review(context, 'two', async () => result); f.retire(); expect(controller.submission(context, 'two')).toBeNull();
  } finally { controller.cancel(); }
});
test('clear/non-reviewable are not automatic saves and review-only refusal does not retire ordinary authority', async () => {
  const f = fixture(), { controller, context } = f;
  try {
    await controller.review(context, 'one', async () => ({ status: 'clear' })); expect(controller.submission(context, 'one')).toEqual({ key: 'proposed-1' });
    await controller.review(context, 'one', async () => ({ status: 'non-reviewable' })); expect(controller.submission(context, 'one')).toBeNull();
    await controller.review(context, 'one', async () => { throw new CalendarReadError('CALENDAR_NOT_FOUND', 404); });
    expect(controller.snapshot().phase).toBe('unavailable'); expect(f.lost()).toBe(0);
    await controller.review(context, 'one', async () => { throw new CalendarReadError('CALENDAR_OVERRIDE_NOT_ALLOWED', 409); });
    expect(controller.snapshot().phase).toBe('unavailable'); expect(f.lost()).toBe(0);
    await controller.review(context, 'one', async () => { throw new CalendarReadError('CALENDAR_FORBIDDEN', 403); }); expect(f.lost()).toBe(1);
    await controller.review(context, 'one', async () => { throw new CalendarReadError('AUTH_UNAUTHORIZED', 401); }); expect(f.lost()).toBe(2);
  } finally { controller.cancel(); }
});
test('expired proofs and invalid private reasons never become a submission; read observation failures do not invent mutation uncertainty', async () => {
  const f = fixture(), { context, controller } = f;
  try {
    await controller.review(context, 'one', async () => ({ ...result, expiresAt: '2000-01-01T00:00:00.000Z' }));
    controller.choose(context, 'one', true); controller.reason(context, 'one', 'private'); expect(controller.submission(context, 'one')).toBeNull();
    await controller.review(context, 'one', async () => result); controller.choose(context, 'one', true);
    for (const reason of [' ', 'x\nprivate', 'x'.repeat(1025)]) { controller.reason(context, 'one', reason); expect(controller.submission(context, 'one')).toBeNull(); }
    const notified = new CalendarAppointmentReviewController({ isCurrent: () => true, createKey: () => 'proposed', onEdit() {}, async onAuthorityLost() { throw new Error('observer only'); } });
    try { await notified.review(context, 'one', async () => { throw new CalendarReadError('AUTH_UNAUTHORIZED', 401); }); await Promise.resolve(); expect(notified.snapshot().phase).toBe('unavailable'); }
    finally { notified.cancel(); }
  } finally { controller.cancel(); }
});
test('duplicate review clicks do not race proposed keys and synchronous owner retirement prevents even read dispatch', async () => {
  const f = fixture(), { controller, context } = f; let resolve!: (value: CalendarOverrideReview) => void, reads = 0;
  try {
    const pending = controller.review(context, 'one', () => { reads++; return new Promise(done => { resolve = done; }); });
    await controller.review(context, 'one', async () => { reads++; return result; }); expect(reads).toBe(1);
    resolve(result); await pending;
    controller.cancel(); const remove = controller.subscribe(() => f.retire());
    try { await controller.review(context, 'one', async () => { reads++; return result; }); expect(reads).toBe(1); }
    finally { remove(); }
  } finally { controller.cancel(); }
});
