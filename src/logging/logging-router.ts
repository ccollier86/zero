/** Thin authenticated logging transport. Scoped facade owns policy, attribution and final authority checks. */
import { t } from 'elysia';
import { defineEndpoint, defineRouter } from '../frontend/server/server-extensions';
import { AuthError } from '../auth/types';
import { LoggingError } from './logging-error';
import { LOGGING_API } from './logging-api-contracts';
import type { ScopedLogging } from './logging-api-contracts';
import { projectLoggingHttpFailure } from './logging-http-error';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';

const stream = t.Union([t.Literal('audit'), t.Literal('operational')]);
const query = t.Object({ eventIds: t.Optional(t.Array(t.String({ maxLength: 1024 }), { maxItems: 100 })), limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })), since: t.Optional(t.Number()), until: t.Optional(t.Number()),
  beforeOrdinal: t.Optional(t.Number()), highWaterOrdinal: t.Optional(t.Number()), family: t.Optional(t.String({ maxLength: 32 })), action: t.Optional(t.String({ maxLength: 120 })),
  actorId: t.Optional(t.String({ maxLength: 200 })), sessionId: t.Optional(t.String({ maxLength: 200 })), targetType: t.Optional(t.String({ maxLength: 120 })), targetId: t.Optional(t.String({ maxLength: 200 })),
  outcome: t.Optional(t.String({ maxLength: 32 })), level: t.Optional(t.String({ maxLength: 16 })),
}, { additionalProperties: false });
const observation = t.Object({ id: t.String({ maxLength: 200 }), collectorId: t.String({ maxLength: 200 }), action: t.String({ maxLength: 120 }), occurredAt: t.Number(),
  target: t.Optional(t.Object({ type: t.String({ maxLength: 120 }), id: t.String({ maxLength: 200 }) }, { additionalProperties: false })),
  interval: t.Optional(t.Object({ viewId: t.String({ maxLength: 200 }), sequence: t.Number(), elapsedMs: t.Number(), visibleMs: t.Number(), activeMs: t.Number(), incomplete: t.Boolean() }, { additionalProperties: false })),
}, { additionalProperties: false });
const evidencePoint = t.Union([t.Null(), t.Object({ at: t.Number(), id: t.String({ maxLength: 200 }) }, { additionalProperties: false })]);
const evidenceCursor = t.Object({ version: t.Literal(1), holds: evidencePoint, reviews: evidencePoint }, { additionalProperties: false });

/** Log reads use POST so sensitive actor/resource filters never enter URLs, referrers or proxy query logs. */
export function createLoggingRouter(options: { pageRecovery?: (request: Request) => Promise<ScopedLogging | null> } = {}) {
  const run = async (action: () => Promise<unknown>) => {
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' };
    try { const value = await action(); return value instanceof Response ? value : Response.json(value, { headers }); }
    catch (error) {
      if (error instanceof LoggingError) {
        const failure = projectLoggingHttpFailure(error);
        return Response.json(failure.body, { status: failure.status, headers });
      }
      if (error instanceof AuthError) return Response.json({ code: error.code, error: getPublicAuthErrorMessage(error) }, { status: error.status, headers });
      return Response.json({ code: 'LOGGING_FAILED', error: 'Logging operation failed.' }, { status: 500, headers });
    }
  };
  const routes = [
    defineEndpoint({ method: 'POST', path: '/people', body: t.Object({ search: t.Optional(t.String({ maxLength: 100 })), after: t.Optional(t.String({ maxLength: 200 })), limit: t.Optional(t.Integer({ minimum: 1, maximum: 50 })) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.people(body);
    }) }),
    defineEndpoint({ method: 'GET', path: '/tables', handler: ({ zero }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.tables();
    }) }),
    defineEndpoint({ method: 'POST', path: '/stream', body: t.Object({ stream, query, platform: t.Optional(t.Boolean()), afterOrdinal: t.Optional(t.Integer({ minimum: 0 })) }, { additionalProperties: false }), handler: ({ zero, body, request }) => run(async () => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.');
      const data = await zero.logging.stream(body.stream, body.query as NonNullable<Parameters<NonNullable<typeof zero.logging>['page']>[1]>, request.signal, body.platform, body.afterOrdinal);
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
    defineEndpoint({ method: 'POST', path: '/observations', body: t.Object({ observations: t.Array(observation, { maxItems: 32 }), policyVersion: t.Optional(t.String({ maxLength: 100 })) }, { additionalProperties: false }), handler: ({ zero, body, request }) => run(async () => {
      // A narrowly scoped, same-origin cookie recovery may only acknowledge an
      // empty batch. It is not general cookie authentication for API routes.
      const logging = zero.access.context ? zero.logging : body.observations.length === 0 ? await options.pageRecovery?.(request) : null;
      if (!logging) throw new AuthError('An interactive session is required.', 'UNAUTHORIZED', 401);
      return logging.observe(body.observations as Parameters<ScopedLogging['observe']>[0], body.policyVersion);
    }) }),
    defineEndpoint({ method: 'GET', path: '/policy', handler: ({ zero }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.collectionPolicy();
    }) }),
    defineEndpoint({ method: 'GET', path: '/health', handler: ({ zero }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.health();
    }) }),
    defineEndpoint({ method: 'POST', path: '/evidence', body: t.Object({ before: t.Optional(t.Union([t.Number(), evidenceCursor])) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
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
    defineEndpoint({ method: 'POST', path: '/exports/create', body: t.Object({ id: t.String({ maxLength: 200 }), stream, query: t.Optional(query) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.');
      return zero.logging.createExport(body as Parameters<ScopedLogging['createExport']>[0]);
    }) }),
    defineEndpoint({ method: 'POST', path: '/exports/status', body: t.Object({ id: t.String({ maxLength: 200 }) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.exportJob(body.id);
    }) }),
    defineEndpoint({ method: 'POST', path: '/exports/download', body: t.Object({ id: t.String({ maxLength: 200 }) }, { additionalProperties: false }), handler: ({ zero, body }) => run(async () => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.');
      const opened = await zero.logging.openExport(body.id);
      return new Response(opened.stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': 'attachment; filename="zero-logging-export.ndjson"',
        'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie', 'X-Content-Type-Options': 'nosniff', 'X-Zero-Logging-Sha256': opened.job.sha256! } });
    }) }),
    defineEndpoint({ method: 'POST', path: '/verify', body: t.Object({ stream, afterOrdinal: t.Optional(t.Number()), checkpoint: t.Optional(t.Object({ version: t.Literal(1), stream, ordinal: t.Number(), hash: t.String({ maxLength: 64 }) }, { additionalProperties: false })) }, { additionalProperties: false }), handler: ({ zero, body }) => run(() => {
      if (!zero.logging) throw new LoggingError('LOGGING_NOT_READY', 'Logging is unavailable.'); return zero.logging.verify(body.stream, body.afterOrdinal, body.checkpoint);
    }) }),
  ];
  return defineRouter({ name: 'zero-logging', prefix: LOGGING_API, auth: { user: 'optional', credentials: ['session'] },
    routes: routes.map(route => defineEndpoint({ ...route,
      auth: { user: route.path === '/observations' ? 'optional' : 'required', credentials: ['session'] },
    })) });
}
