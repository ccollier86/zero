/** Native private transport over the same service facade; no caller-provided scope, actor or command name. */
import { t } from 'elysia';
import { createServerExtensionApp, defineEndpoint, defineRouter, type AnyZeroEndpointDefinition } from '../frontend/server/server-extensions';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { CalendarAppointmentInput, CalendarAvailabilityInput, CalendarBlockInput, CalendarBlockRescheduleInput,
  CalendarControlOptions, CalendarGrant, CalendarHoldInput, CalendarHoldConfirmationInput, CalendarRangeQuery, CalendarRequestOptions, CalendarRescheduleInput } from './contracts';
import { CalendarError } from './error';
import { calendarRecord } from './validation';
import { calendarAppointmentStream, calendarAvailabilityStream, calendarBlockStream, calendarHoldStream } from './stream';

const key = t.String({ minLength: 1, maxLength: 128 });
function attributed(endpoint: AnyZeroEndpointDefinition): AnyZeroEndpointDefinition {
  return { ...endpoint, handler(context) {
    const run = () => endpoint.handler(context);
    return context.zero.logging ? context.zero.logging.run(run) : run();
  } };
}
export async function createCalendarHttp(runtime: ZeroAppRuntime) {
  return createServerExtensionApp({ runtime, name: 'zero.calendar.http', extensions: [defineRouter({ name: 'zero.calendar', prefix: '/api/calendar',
    auth: { user: 'required', credentials: ['session'] }, endpoints: [
      defineEndpoint({ method: 'GET', path: '/resources', query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })), after: t.Optional(key),
      }, { additionalProperties: false }), async handler({ zero, query }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); return zero.calendar.resources.list(query);
      } }),
      defineEndpoint({ method: 'POST', path: '/resources', body: t.Unknown(), async handler({ zero, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['resource', 'options']);
        return zero.calendar.resources.create(r.resource as never, r.options as CalendarRequestOptions);
      } }),
      defineEndpoint({ method: 'POST', path: '/resources/:id/grants', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['userId', 'grants', 'options']);
        return zero.calendar.resources.setGrants(params.id, r.userId as string, r.grants as CalendarGrant[], r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'GET', path: '/availability/:id', params: t.Object({ id: key }), async handler({ zero, params }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); return zero.calendar.availability.get(params.id);
      } }),
      defineEndpoint({ method: 'GET', path: '/availability/:id/live', params: t.Object({ id: key }), async handler({ zero, params, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY');
        await zero.calendar.availability.get(params.id);
        return new Response(calendarAvailabilityStream(zero.calendar, params.id, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'POST', path: '/availability/:id', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['availability', 'options']);
        return zero.calendar.availability.replace(params.id, r.availability as CalendarAvailabilityInput, r.options as CalendarControlOptions);
      } }),
      ...(['appointments', 'busy', 'blocks', 'holds'] as const).map(kind => defineEndpoint({ method: 'POST', path: '/' + kind + '/query', body: t.Unknown(), async handler({ zero, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['query']);
        return zero.calendar[kind].query(r.query as CalendarRangeQuery);
      } })),
      ...(['appointments', 'blocks', 'holds'] as const).map(kind => defineEndpoint({ method: 'GET', path: '/' + kind + '/live', query: t.Object({
        resourceIds: t.String({ maxLength: 2063 }), startAt: t.String({ maxLength: 27 }), endAt: t.String({ maxLength: 27 }),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }, { additionalProperties: false }), async handler({ zero, query, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY');
        const range: CalendarRangeQuery = { ...query, resourceIds: query.resourceIds === '' ? [] : query.resourceIds.split(',') };
        await zero.calendar[kind].query(range);
        return new Response((kind === 'appointments' ? calendarAppointmentStream : kind === 'blocks' ? calendarBlockStream : calendarHoldStream)(zero.calendar, range, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } })),
      defineEndpoint({ method: 'GET', path: '/holds/:id', params: t.Object({ id: key }), async handler({ zero, params }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); return zero.calendar.holds.get(params.id);
      } }),
      defineEndpoint({ method: 'POST', path: '/holds', body: t.Unknown(), async handler({ zero, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['hold', 'options']);
        return zero.calendar.holds.acquire(r.hold as CalendarHoldInput, r.options as CalendarRequestOptions);
      } }),
      defineEndpoint({ method: 'POST', path: '/holds/:id/release', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['options']);
        return zero.calendar.holds.release(params.id, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'POST', path: '/holds/:id/confirm', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['appointment', 'options']);
        return zero.calendar.holds.confirm(params.id, r.appointment as CalendarHoldConfirmationInput, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'GET', path: '/appointments/:id', params: t.Object({ id: key }), async handler({ zero, params }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); return zero.calendar.appointments.get(params.id);
      } }),
      defineEndpoint({ method: 'POST', path: '/appointments', body: t.Unknown(), async handler({ zero, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['appointment', 'options']);
        return zero.calendar.appointments.create(r.appointment as CalendarAppointmentInput, r.options as CalendarRequestOptions);
      } }),
      defineEndpoint({ method: 'POST', path: '/appointments/:id/reschedule', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['appointment', 'options']);
        return zero.calendar.appointments.reschedule(params.id, r.appointment as CalendarRescheduleInput, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'POST', path: '/appointments/:id/cancel', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['options']);
        return zero.calendar.appointments.cancel(params.id, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'GET', path: '/blocks/:id', params: t.Object({ id: key }), async handler({ zero, params }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); return zero.calendar.blocks.get(params.id);
      } }),
      defineEndpoint({ method: 'POST', path: '/blocks', body: t.Unknown(), async handler({ zero, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['block', 'options']);
        return zero.calendar.blocks.create(r.block as CalendarBlockInput, r.options as CalendarRequestOptions);
      } }),
      defineEndpoint({ method: 'POST', path: '/blocks/:id/reschedule', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['block', 'options']);
        return zero.calendar.blocks.reschedule(params.id, r.block as CalendarBlockRescheduleInput, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'POST', path: '/blocks/:id/cancel', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['options']);
        return zero.calendar.blocks.cancel(params.id, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'GET', path: '/receipts/:key', params: t.Object({ key }), async handler({ zero, params }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); return { receipt: await zero.calendar.receipts.get(params.key) };
      } }),
    ].map(attributed),
  })] });
}
