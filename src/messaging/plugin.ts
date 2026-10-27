/** Native authenticated messaging transport. Guardian owns identity; services own behavior; no provider work or SQL runs in handlers. */
import { Elysia } from 'elysia';
import { createAuthMiddleware, type AuthMiddlewareAuthorizationOptions } from '../auth/auth.middleware';
import type { TokenService } from '../auth/token-service';
import type { LoggingRuntime } from '../logging/logging-runtime';
import type { MessagingService } from './service';
import { MESSAGING_API, type ConversationQuery, type MessageHistoryQuery } from './contracts';
import { currentMessagingRequest } from './http-authority';
import { projectMessagingHttpError } from './http-errors';
import { readMessagingBody, readMessagingQuery } from './http-input';
import { messagingChoice, messagingId, messagingInteger, messagingRecord } from './validation';
import { messagingProjectionStream } from './stream';
import { createMessagingAttachmentRoutes } from './attachment-routes';
import { createMessagingReviewRoutes } from './review-routes';

export interface MessagingPluginConfig { getService(): MessagingService | null; getTokenService(): TokenService | null; readonly authorization: AuthMiddlewareAuthorizationOptions; getLoggingRuntime?(): LoggingRuntime | null }
/** The caller, not the HTTP layer, retains a mutation identity after an interrupted response. */
export function createMessagingPlugin(config: MessagingPluginConfig) {
  const mutation = (request: Request) => ({ requestId: messagingId(request.headers.get('Idempotency-Key')), signal: request.signal });
  const context = (auth: Parameters<typeof currentMessagingRequest>[1], request: Request) => currentMessagingRequest(config, auth, request);
  const read = (auth: Parameters<typeof currentMessagingRequest>[1], request: Request) => context(auth, request).facade;
  const noQuery = (request: Request) => { readMessagingQuery(request, []); };
  return new Elysia({ name: 'zero-messaging', prefix: MESSAGING_API })
    .use(createAuthMiddleware(config.getTokenService, config.authorization))
    .onBeforeHandle(({ set }) => { set.headers['Cache-Control'] = 'private, no-store'; })
    .onError(({ error, code, set }) => { if (code === 'NOT_FOUND') return; const failure = projectMessagingHttpError(error, code); set.status = failure.status; set.headers['Cache-Control'] = 'private, no-store'; return failure.body; })
    .get('/config', ({ access, request }) => { noQuery(request); return read(access.requireUser(), request).capabilities(); })
    .get('/directory', ({ access, request }) => read(access.requireUser(), request).directory(readMessagingQuery(request, ['after', 'limit', 'search']) as never, { signal: request.signal }))
    .get('/assistants', ({ access, request }) => { noQuery(request); return read(access.requireUser(), request).assistants.list({ signal: request.signal }); })
    .post('/assistants/:id/conversations', async ({ access, params, request }) => { const user = access.requireUser(), options = mutation(request); noQuery(request); return read(user, request).assistants.open(params.id, await readMessagingBody(request) as never, options); }, { parse: 'none' })
    .get('/receipts/:id', ({ access, params, request }) => { noQuery(request); return read(access.requireUser(), request).receipt(params.id, { signal: request.signal }); })
    .get('/conversations', ({ access, request }) => read(access.requireUser(), request).conversations.list(readMessagingQuery(request, ['after', 'limit', 'archived']) as ConversationQuery, { signal: request.signal }))
    .get('/conversations/live', async ({ access, request }) => {
      const captured = context(access.requireUser(), request), query = readMessagingQuery(request, ['after', 'limit', 'archived']) as ConversationQuery;
      await captured.facade.conversations.list({ ...query, limit: 1 }, { signal: request.signal });
      const projection = captured.service.projectionForAuthority(captured.authority);
      return new Response(messagingProjectionStream(captured.service.runtime, captured.authority.scope, () => projection.conversations.list(query, { signal: request.signal }), request.signal, { actorId: captured.authority.access.requireUser().userId }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
    })
    .get('/conversations/:conversationId', ({ access, params, request }) => { noQuery(request); return read(access.requireUser(), request).conversations.get(params.conversationId, { signal: request.signal }); })
    .post('/conversations', async ({ access, request }) => { const user = access.requireUser(), options = mutation(request); noQuery(request); return read(user, request).conversations.create(await readMessagingBody(request) as never, options); }, { parse: 'none' })
    .post('/conversations/:conversationId/:action', async ({ access, params, request }) => {
      const user = access.requireUser(), options = mutation(request); noQuery(request); const action = messagingChoice(params.action, ['rename', 'archive', 'add', 'remove', 'transfer', 'read', 'takeover', 'hand-back']);
      const allowed = action === 'rename' ? ['expectedRevision', 'title'] : action === 'archive' ? ['expectedRevision', 'archived'] : action === 'add' || action === 'remove' || action === 'transfer' ? ['expectedRevision', 'userId'] : action === 'read' ? ['throughSequence'] : action === 'takeover' ? ['expectedEpoch'] : ['expectedEpoch', 'owner'];
      const r = messagingRecord(await readMessagingBody(request), allowed), api = read(user, request).conversations;
      if (action === 'read') return api.markRead(params.conversationId, messagingInteger(r.throughSequence, 0), options);
      if (action === 'takeover') return api.takeover(params.conversationId, messagingInteger(r.expectedEpoch), options);
      if (action === 'hand-back') return api.handBack(params.conversationId, messagingInteger(r.expectedEpoch), messagingChoice(r.owner, ['assistant', 'triage']), options);
      const revision = messagingInteger(r.expectedRevision);
      if (action === 'rename') return api.rename(params.conversationId, revision, r.title as string, options);
      if (action === 'archive') return api.archive(params.conversationId, revision, r.archived as boolean, options);
      if (action === 'transfer') return api.transferOwnership(params.conversationId, revision, messagingId(r.userId), options);
      return action === 'add' ? api.addParticipant(params.conversationId, revision, messagingId(r.userId), options) : api.removeParticipant(params.conversationId, revision, messagingId(r.userId), options);
    }, { parse: 'none' })
    .get('/conversations/:conversationId/messages', ({ access, params, request }) => read(access.requireUser(), request).messages.list(params.conversationId, readMessagingQuery(request, ['before', 'after', 'limit', 'search']) as MessageHistoryQuery, { signal: request.signal }))
    .get('/conversations/:conversationId/messages/live', async ({ access, params, request }) => {
      const captured = context(access.requireUser(), request), query = readMessagingQuery(request, ['before', 'after', 'limit', 'search']) as MessageHistoryQuery, id = messagingId(params.conversationId);
      await captured.facade.messages.list(id, { ...query, limit: 1 }, { signal: request.signal });
      const projection = captured.service.projectionForAuthority(captured.authority);
      return new Response(messagingProjectionStream(captured.service.runtime, captured.authority.scope, () => projection.messages.list(id, query, { signal: request.signal }), request.signal, { actorId: captured.authority.access.requireUser().userId, conversationId: id }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
    })
    .post('/conversations/:conversationId/messages', async ({ access, params, request }) => { const user = access.requireUser(), options = mutation(request); noQuery(request); return read(user, request).messages.send(params.conversationId, await readMessagingBody(request) as never, options); }, { parse: 'none' })
    .put('/conversations/:conversationId/messages/:messageId', async ({ access, params, request }) => { const user = access.requireUser(), options = mutation(request); noQuery(request); const r = messagingRecord(await readMessagingBody(request), ['expectedRevision', 'text']); return read(user, request).messages.edit(params.conversationId, params.messageId, messagingInteger(r.expectedRevision), r.text as string, options); }, { parse: 'none' })
    .delete('/conversations/:conversationId/messages/:messageId', async ({ access, params, request }) => { const user = access.requireUser(), options = mutation(request); noQuery(request); const r = messagingRecord(await readMessagingBody(request), ['expectedRevision']); return read(user, request).messages.remove(params.conversationId, params.messageId, messagingInteger(r.expectedRevision), options); }, { parse: 'none' })
    .post('/conversations/:conversationId/messages/:messageId/reactions', async ({ access, params, request }) => { const user = access.requireUser(), options = mutation(request); noQuery(request); const r = messagingRecord(await readMessagingBody(request), ['emoji', 'selected']); return read(user, request).messages.react(params.conversationId, params.messageId, r.emoji as string, r.selected as boolean, options); }, { parse: 'none' })
    .get('/contacts', ({ access, request }) => read(access.requireUser(), request).contacts.list(readMessagingQuery(request, ['after', 'limit']) as never, { signal: request.signal }))
    .post('/contacts/:id/:action', async ({ access, params, request }) => { const user = access.requireUser(), options = mutation(request); noQuery(request); const action = messagingChoice(params.action, ['request', 'respond', 'block', 'unblock']); const r = messagingRecord(await readMessagingBody(request), action === 'respond' ? ['expectedRevision', 'accept'] : []), api = read(user, request).contacts;
      return action === 'respond' ? api.respond(params.id, messagingInteger(r.expectedRevision), r.accept as boolean, options) : api[action](params.id, options);
    }, { parse: 'none' })
    .post('/support', async ({ access, request }) => { const user = access.requireUser(), options = mutation(request); noQuery(request); return read(user, request).support.open(await readMessagingBody(request) as never, options); }, { parse: 'none' })
    .get('/support/queue', ({ access, request }) => read(access.requireUser(), request).support.queue(readMessagingQuery(request, ['after', 'limit']) as never, { signal: request.signal }))
    .post('/support/:id/claim', async ({ access, params, request }) => { const user = access.requireUser(), options = mutation(request); noQuery(request); const r = messagingRecord(await readMessagingBody(request), ['expectedEpoch']); return read(user, request).support.claim(params.id, messagingInteger(r.expectedEpoch), options); }, { parse: 'none' })
    .use(createMessagingAttachmentRoutes(config))
    .use(createMessagingReviewRoutes(config));
}
