/** Thin authenticated logging transport. Scoped facade owns policy, attribution and final authority checks. */
import { t } from 'elysia';
import { defineEndpoint, defineRouter } from '../frontend/server/server-extensions';
import { AuthError } from '../auth/types';
import { LoggingError } from './logging-error';
import { LOGGING_API } from './logging-api-contracts';

const stream = t.Union([t.Literal('audit'), t.Literal('operational')]);
const query = t.Object({ limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })), since: t.Optional(t.Number()), until: t.Optional(t.Number()),
  beforeOrdinal: t.Optional(t.Number()), highWaterOrdinal: t.Optional(t.Number()), family: t.Optional(t.String({ maxLength: 32 })), action: t.Optional(t.String({ maxLength: 120 })),
  actorId: t.Optional(t.String({ maxLength: 200 })), sessionId: t.Optional(t.String({ maxLength: 200 })), targetType: t.Optional(t.String({ maxLength: 120 })), targetId: t.Optional(t.String({ maxLength: 200 })),
  outcome: t.Optional(t.String({ maxLength: 32 })), level: t.Optional(t.String({ maxLength: 16 })),
}, { additionalProperties: false });
const observation = t.Object({ id: t.String({ maxLength: 200 }), collectorId: t.String({ maxLength: 200 }), action: t.String({ maxLength: 120 }), occurredAt: t.Number(),
  target: t.Optional(t.Object({ type: t.String({ maxLength: 120 }), id: t.String({ maxLength: 200 }) }, { additionalProperties: false })),
  interval: t.Optional(t.Object({ viewId: t.String({ maxLength: 200 }), sequence: t.Number(), elapsedMs: t.Number(), visibleMs: t.Number(), activeMs: t.Number(), incomplete: t.Boolean() }, { additionalProperties: false })),
}, { additionalProperties: false });

/** Log reads use POST so sensitive actor/resource filters never enter URLs, referrers or proxy query logs. */
export function createLoggingRouter() {
  const run = async (action: () => Promise<unknown>) => {
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' };
    try { const value = await action(); return value instanceof Response ? value : Response.json(value, { headers }); }
    catch (error) {
      const known = error instanceof LoggingError || error instanceof AuthError;
      const status = error instanceof AuthError ? error.status : error instanceof LoggingError ? error.code === 'LOGGING_FORBIDDEN' ? 403 : error.code === 'LOGGING_BACKPRESSURE' ? 429 : error.code.includes('INVALID') ? 422 : 503 : 500;
      return Response.json({ code: known ? error.code : 'LOGGING_FAILED', error: known ? error.message : 'Logging operation failed.' }, { status, headers });
    }
  };
  return defineRouter({ name: 'zero-logging', prefix: LOGGING_API, auth: { user: 'required', credentials: ['session'] }, routes: [
    defineEndpoint({ method: 'POST', path: '/stream', body: t.Object({ stream, query, platform: t.Optional(t.Boolean()) }, { additionalProperties: false }), handler: ({ zero, body, request }) => run(async () => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.');
      const data = await zero.logging.stream(body.stream, body.query as NonNullable<Parameters<NonNullable<typeof zero.logging>['page']>[1]>, request.signal, body.platform);
      return new Response(data, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store, no-transform', 'X-Accel-Buffering': 'no', Vary: 'Authorization, Cookie' } });
    }) }),
    defineEndpoint({ method: 'POST', path: '/platform/events', body: t.Object({ stream, query }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.');
      return zero.logging.platformPage(body.stream, body.query as Parameters<NonNullable<typeof zero.logging>['page']>[1]);
    }) }),
    defineEndpoint({ method: 'POST', path: '/events', body: t.Object({ stream, query }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.');
      return zero.logging.page(body.stream, body.query as Parameters<NonNullable<typeof zero.logging>['page']>[1]);
    }) }),
    defineEndpoint({ method: 'POST', path: '/observations', body: t.Object({ observations: t.Array(observation, { maxItems: 32 }) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.');
      return zero.logging.observe(body.observations as Parameters<NonNullable<typeof zero.logging>['observe']>[0]);
    }) }),
    defineEndpoint({ method: 'GET', path: '/policy', handler: ({ zero }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.collectionPolicy();
    }) }),
    defineEndpoint({ method: 'GET', path: '/health', handler: ({ zero }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.health();
    }) }),
    defineEndpoint({ method: 'POST', path: '/evidence', body: t.Object({ before: t.Optional(t.Number()) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.evidence(body.before);
    }) }),
    defineEndpoint({ method: 'POST', path: '/holds', body: t.Object({ id: t.String({ maxLength: 200 }), since: t.Number(), until: t.Number(), reasonRef: t.String({ maxLength: 200 }) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.hold(body);
    }) }),
    defineEndpoint({ method: 'POST', path: '/holds/release', body: t.Object({ id: t.String({ maxLength: 200 }) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.releaseHold(body.id);
    }) }),
    defineEndpoint({ method: 'POST', path: '/reviews', body: t.Object({ id: t.String({ maxLength: 200 }), query, highWaterOrdinal: t.Number(), result: t.Union([t.Literal('reviewed'), t.Literal('follow-up')]), reference: t.String({ maxLength: 200 }) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.review(body as Parameters<NonNullable<typeof zero.logging>['review']>[0]);
    }) }),
    defineEndpoint({ method: 'POST', path: '/export', body: t.Object({ stream, query }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.export(body.stream, body.query as Parameters<NonNullable<typeof zero.logging>['page']>[1]);
    }) }),
    defineEndpoint({ method: 'POST', path: '/verify', body: t.Object({ stream, afterOrdinal: t.Optional(t.Number()), checkpoint: t.Optional(t.Object({ version: t.Literal(1), stream, ordinal: t.Number(), hash: t.String({ maxLength: 64 }) }, { additionalProperties: false })) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.verify(body.stream, body.afterOrdinal, body.checkpoint);
    }) }),
  ] });
}
