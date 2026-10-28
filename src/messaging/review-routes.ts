/** Guardian-authenticated review transport. It never supplies caller-selected job policy, scope, actor or provider execution. */
import { Elysia } from 'elysia';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { MessagingPluginConfig } from './plugin';
import { currentMessagingRequest } from './http-authority';
import { projectMessagingHttpError } from './http-errors';
import { readMessagingBody, readMessagingQuery } from './http-input';
import { messagingId, messagingInteger, messagingRecord } from './validation';
import { messagingProjectionStream } from './stream';

export function createMessagingReviewRoutes(config: MessagingPluginConfig) {
  return new Elysia({ name: 'zero-messaging-review' })
    .use(createAuthMiddleware(config.getTokenService, config.authorization))
    .onBeforeHandle(({ set }) => { set.headers['Cache-Control'] = 'private, no-store'; })
    .onError(({ error, code, set }) => { if (code === 'NOT_FOUND') return; const result = projectMessagingHttpError(error, code); set.status = result.status; set.headers['Cache-Control'] = 'private, no-store'; return result.body; })
    .get('/conversations/:conversationId/review', ({ access, params, request }) => {
      const user = access.requireUser();
      return currentMessagingRequest(config, user, request).facade.review.list(params.conversationId, readMessagingQuery(request, ['after', 'limit']) as never, { signal: request.signal });
    })
    .get('/conversations/:conversationId/review/live', async ({ access, params, request }) => {
      const captured = currentMessagingRequest(config, access.requireUser(), request), id = messagingId(params.conversationId), query = readMessagingQuery(request, ['after', 'limit']) as never;
      await captured.facade.review.list(id, { ...query as object, limit: 1 }, { signal: request.signal });
      const projection = captured.service.projectionForAuthority(captured.authority);
      return new Response(messagingProjectionStream(captured.service.runtime, captured.authority.scope, () => projection.review.list(id, query, { signal: request.signal }), request.signal,
        { actorId: captured.authority.access.requireUser().userId, conversationId: id }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
    })
    .get('/conversations/:conversationId/review/:jobId', ({ access, params, request }) => {
      const user = access.requireUser(); readMessagingQuery(request, []);
      return currentMessagingRequest(config, user, request).facade.review.get(params.conversationId, params.jobId, { signal: request.signal });
    })
    .post('/conversations/:conversationId/review/:jobId/retry', async ({ access, params, request }) => {
      const user = access.requireUser(), options = { requestId: messagingId(request.headers.get('Idempotency-Key')), signal: request.signal }; readMessagingQuery(request, []);
      const r = messagingRecord(await readMessagingBody(request), ['expectedOwnerEpoch', 'acknowledgePossibleDuplicate']);
      return currentMessagingRequest(config, user, request).facade.review.retry(params.conversationId, params.jobId, messagingInteger(r.expectedOwnerEpoch), r.acknowledgePossibleDuplicate as true, options);
    }, { parse: 'none' })
    .post('/conversations/:conversationId/review/:jobId/dismiss', async ({ access, params, request }) => {
      const user = access.requireUser(), options = { requestId: messagingId(request.headers.get('Idempotency-Key')), signal: request.signal }; readMessagingQuery(request, []);
      const r = messagingRecord(await readMessagingBody(request), ['expectedOwnerEpoch']);
      return currentMessagingRequest(config, user, request).facade.review.dismiss(params.conversationId, params.jobId, messagingInteger(r.expectedOwnerEpoch), options);
    }, { parse: 'none' });
}
