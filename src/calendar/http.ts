/** Native private transport over the same service facade; no caller-provided scope, actor or command name. */
import { t } from 'elysia';
import { createServerExtensionApp, defineEndpoint, defineRouter, type AnyZeroEndpointDefinition } from '../frontend/server/server-extensions';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { CalendarAppointmentInput, CalendarAvailabilityInput, CalendarBlockInput, CalendarBlockRescheduleInput,
  CalendarAppointmentTypeInput, CalendarAppointmentTypeReplacement, CalendarAppointmentTypePageQuery, CalendarResourceTypesInput,
  CalendarLifecyclePolicyInput, CalendarAppointmentTransitionInput, CalendarCancellationOptions,
  CalendarControlOptions, CalendarGrant, CalendarHoldInput, CalendarHoldConfirmationInput, CalendarLocationInput, CalendarLocationPageQuery, CalendarLocationReplacement,
  CalendarRangeQuery, CalendarRequestOptions, CalendarRescheduleInput, CalendarResourcePageQuery } from './contracts';
import { CalendarError } from './error';
import { calendarRecord } from './validation';
import { calendarAppointmentStream, calendarAvailabilityStream, calendarBlockStream, calendarHoldStream, calendarLocationStream, calendarResourceStream,
  calendarLocationDetailStream, calendarResourceLocationsStream, calendarTypeStream, calendarTypeDetailStream, calendarResourceTypesStream,
  calendarLifecycleStream, calendarAppointmentTransitionsStream } from './stream';

const key = t.String({ minLength: 1, maxLength: 128 });
// Query strings stay wire strings through composed native validators; convert
// only after admission instead of relying on a repeated numeric transform.
const pageQuery = { limit: t.Optional(t.String({ pattern: '^(?:[1-9][0-9]?|100)$', maxLength: 3 })), after: t.Optional(key) };
const resourceQuery = { ...pageQuery, locationIds: t.Optional(t.String({ maxLength: 2063 })), regions: t.Optional(t.String({ maxLength: 1039 })) };
const typeQuery = { ...pageQuery, resourceIds: t.Optional(t.String({ maxLength: 2063 })) };
function typeFilters(query: { limit?: string; after?: string; resourceIds?: string }): CalendarAppointmentTypePageQuery {
  const { resourceIds, ...page } = query;
  return { ...pageFilters(page), ...(resourceIds === undefined ? {} : { resourceIds: resourceIds === '' ? [] : resourceIds.split(',') }) };
}
function pageFilters(query: { limit?: string; after?: string }): CalendarLocationPageQuery {
  return { ...(query.limit === undefined ? {} : { limit: Number(query.limit) }), ...(query.after === undefined ? {} : { after: query.after }) };
}
function resourceFilters(query: { limit?: string; after?: string; locationIds?: string; regions?: string }): CalendarResourcePageQuery {
  const { locationIds, regions, ...page } = query;
  return { ...pageFilters(page), ...(locationIds === undefined ? {} : { locationIds: locationIds === '' ? [] : locationIds.split(',') }),
    ...(regions === undefined ? {} : { regions: regions === '' ? [] : regions.split(',') }) };
}
function admitPageQuery(request: Request, resource = false): void {
  admitQueryKeys(request, resource ? ['limit', 'after', 'locationIds', 'regions'] : ['limit', 'after']);
}
function admitQueryKeys(request: Request, allowed: readonly string[]): void {
  const seen = new Set<string>();
  // Elysia may normalize away unknown query fields before our handler. Inspect
  // the original key set too, never accepting authored authority or duplicates.
  for (const [name] of new URL(request.url).searchParams) {
    if (!allowed.includes(name) || seen.has(name)) throw new CalendarError('CALENDAR_INPUT_INVALID'); seen.add(name);
  }
}
function attributed(endpoint: AnyZeroEndpointDefinition): AnyZeroEndpointDefinition {
  return { ...endpoint, handler(context) {
    const run = () => endpoint.handler(context);
    return context.zero.logging ? context.zero.logging.run(run) : run();
  } };
}
export async function createCalendarHttp(runtime: ZeroAppRuntime) {
  return createServerExtensionApp({ runtime, name: 'zero.calendar.http', extensions: [defineRouter({ name: 'zero.calendar', prefix: '/api/calendar',
    auth: { user: 'required', credentials: ['session'] }, endpoints: [
      defineEndpoint({ method: 'GET', path: '/lifecycle', async handler({ zero, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []);
        return zero.calendar.lifecycle.get();
      } }),
      defineEndpoint({ method: 'PUT', path: '/lifecycle', body: t.Unknown(), async handler({ zero, body, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []);
        const r = calendarRecord(body, ['policy', 'options']);
        return zero.calendar.lifecycle.replace(r.policy as CalendarLifecyclePolicyInput, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'GET', path: '/lifecycle/live', async handler({ zero, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []); await zero.calendar.lifecycle.get();
        return new Response(calendarLifecycleStream(zero.calendar, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'GET', path: '/types', query: t.Object(typeQuery, { additionalProperties: false }), async handler({ zero, query, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, ['limit', 'after', 'resourceIds']);
        return zero.calendar.types.list(typeFilters(query));
      } }),
      defineEndpoint({ method: 'GET', path: '/types/live', query: t.Object(typeQuery, { additionalProperties: false }), async handler({ zero, query, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, ['limit', 'after', 'resourceIds']);
        const filters = typeFilters(query); await zero.calendar.types.list(filters);
        return new Response(calendarTypeStream(zero.calendar, filters, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'GET', path: '/types/:id', params: t.Object({ id: key }), async handler({ zero, params, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []); return zero.calendar.types.get(params.id);
      } }),
      defineEndpoint({ method: 'GET', path: '/types/:id/live', params: t.Object({ id: key }), async handler({ zero, params, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []); await zero.calendar.types.get(params.id);
        return new Response(calendarTypeDetailStream(zero.calendar, params.id, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'POST', path: '/types', body: t.Unknown(), async handler({ zero, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['type', 'options']);
        return zero.calendar.types.create(r.type as CalendarAppointmentTypeInput, r.options as CalendarRequestOptions);
      } }),
      defineEndpoint({ method: 'PUT', path: '/types/:id', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['type', 'options']);
        return zero.calendar.types.replace(params.id, r.type as CalendarAppointmentTypeReplacement, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'GET', path: '/resources/:id/types', params: t.Object({ id: key }), async handler({ zero, params, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []); return zero.calendar.types.forResource(params.id);
      } }),
      defineEndpoint({ method: 'GET', path: '/resources/:id/types/live', params: t.Object({ id: key }), async handler({ zero, params, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []); await zero.calendar.types.forResource(params.id);
        return new Response(calendarResourceTypesStream(zero.calendar, params.id, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'PUT', path: '/resources/:id/types', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['mode', 'typeIds', 'options']);
        return zero.calendar.resources.setAppointmentTypes(params.id, { mode: r.mode, typeIds: r.typeIds } as CalendarResourceTypesInput, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'GET', path: '/locations', query: t.Object(pageQuery, { additionalProperties: false }), async handler({ zero, query, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitPageQuery(request); return zero.calendar.locations.list(pageFilters(query));
      } }),
      defineEndpoint({ method: 'GET', path: '/locations/live', query: t.Object(pageQuery, { additionalProperties: false }), async handler({ zero, query, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitPageQuery(request); const filters = pageFilters(query); await zero.calendar.locations.list(filters);
        return new Response(calendarLocationStream(zero.calendar, filters, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'GET', path: '/locations/:id', params: t.Object({ id: key }), async handler({ zero, params }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); return zero.calendar.locations.get(params.id);
      } }),
      defineEndpoint({ method: 'GET', path: '/locations/:id/live', params: t.Object({ id: key }), async handler({ zero, params, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); await zero.calendar.locations.get(params.id);
        return new Response(calendarLocationDetailStream(zero.calendar, params.id, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'POST', path: '/locations', body: t.Unknown(), async handler({ zero, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['location', 'options']);
        return zero.calendar.locations.create(r.location as CalendarLocationInput, r.options as CalendarRequestOptions);
      } }),
      defineEndpoint({ method: 'PUT', path: '/locations/:id', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['location', 'options']);
        return zero.calendar.locations.replace(params.id, r.location as CalendarLocationReplacement, r.options as CalendarControlOptions);
      } }),
      defineEndpoint({ method: 'GET', path: '/resources', query: t.Object(resourceQuery, { additionalProperties: false }), async handler({ zero, query, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitPageQuery(request, true); return zero.calendar.resources.list(resourceFilters(query));
      } }),
      defineEndpoint({ method: 'GET', path: '/resources/live', query: t.Object(resourceQuery, { additionalProperties: false }), async handler({ zero, query, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitPageQuery(request, true); const filters = resourceFilters(query); await zero.calendar.resources.list(filters);
        return new Response(calendarResourceStream(zero.calendar, filters, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'GET', path: '/resources/:id/locations', params: t.Object({ id: key }), async handler({ zero, params }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); return zero.calendar.locations.forResource(params.id);
      } }),
      defineEndpoint({ method: 'GET', path: '/resources/:id/locations/live', params: t.Object({ id: key }), async handler({ zero, params, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); await zero.calendar.locations.forResource(params.id);
        return new Response(calendarResourceLocationsStream(zero.calendar, params.id, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'PUT', path: '/resources/:id/locations', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['locationIds', 'options']);
        return zero.calendar.resources.setLocations(params.id, r.locationIds as string[], r.options as CalendarControlOptions);
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
        limit: pageQuery.limit,
      }, { additionalProperties: false }), async handler({ zero, query, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY');
        admitQueryKeys(request, ['resourceIds', 'startAt', 'endAt', 'limit']);
        const range: CalendarRangeQuery = { resourceIds: query.resourceIds === '' ? [] : query.resourceIds.split(','),
          startAt: query.startAt, endAt: query.endAt, ...(query.limit === undefined ? {} : { limit: Number(query.limit) }) };
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
      defineEndpoint({ method: 'GET', path: '/appointments/:id/transitions', params: t.Object({ id: key }), async handler({ zero, params, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []);
        return zero.calendar.appointments.transitions(params.id);
      } }),
      defineEndpoint({ method: 'GET', path: '/appointments/:id/transitions/live', params: t.Object({ id: key }), async handler({ zero, params, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []); await zero.calendar.appointments.transitions(params.id);
        return new Response(calendarAppointmentTransitionsStream(zero.calendar, params.id, request.signal), {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
        });
      } }),
      defineEndpoint({ method: 'POST', path: '/appointments/:id/transition', params: t.Object({ id: key }), body: t.Unknown(), async handler({ zero, params, body, request }) {
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); admitQueryKeys(request, []);
        const r = calendarRecord(body, ['transition', 'options']);
        return zero.calendar.appointments.transition(params.id, r.transition as CalendarAppointmentTransitionInput, r.options as CalendarControlOptions);
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
        if (!zero.calendar) throw new CalendarError('CALENDAR_NOT_READY'); const r = calendarRecord(body, ['options', 'reason']);
        const options = calendarRecord(r.options, ['idempotencyKey', 'expectedRevision', 'signal']);
        return zero.calendar.appointments.cancel(params.id, { ...options, ...(Object.hasOwn(r, 'reason') ? { reason: r.reason } : {}) } as unknown as CalendarCancellationOptions);
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
