/** Native extension serialization through Elysia.handle; no listener, app boot, files, accounts or providers. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { applyServerExtensionErrorHandler } from '../frontend/server/server-extension-error-handler';
import { CalendarError, type CalendarErrorCode } from './error';

test('calendar HTTP failures preserve stable domain codes and truthful operation outcomes', async () => {
  for (const [code, status, outcome] of [
    ['CALENDAR_BOOKING_CONFLICT', 409, 'not-committed'],
    ['CALENDAR_REVISION_CONFLICT', 409, 'not-committed'],
    ['CALENDAR_TYPE_STALE', 409, 'not-committed'],
    ['CALENDAR_TYPE_CONFLICT', 409, 'not-committed'],
    ['CALENDAR_TRANSITION_INVALID', 409, 'not-committed'],
    ['CALENDAR_REASON_REQUIRED', 409, 'not-committed'],
    ['CALENDAR_POLICY_STALE', 409, 'not-committed'],
    ['CALENDAR_NOT_FOUND', 404, 'not-started'],
    ['CALENDAR_INPUT_INVALID', 400, 'not-started'],
    ['CALENDAR_OUTCOME_UNKNOWN', 503, 'unknown'],
  ] as const) {
    const app = applyServerExtensionErrorHandler(new Elysia()).post('/api/calendar/synthetic', () => {
      throw new CalendarError(code as CalendarErrorCode, outcome);
    }).compile();
    try {
      const response = await app.handle(new Request('http://localhost/api/calendar/synthetic', { method: 'POST' }));
      expect(response.status).toBe(status);
      const body = await response.json(); expect(body).toMatchObject({ code, outcome });
      expect(Object.keys(body).sort()).toEqual(['code', 'error', 'outcome']);
    } finally { if (app.server) await app.stop(); }
  }
});
