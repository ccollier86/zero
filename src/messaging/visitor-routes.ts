/** Narrow same-origin public transport. Never installs Guardian credentials, private table subscriptions, staff routes or directory access. */
import { Elysia } from 'elysia';
import type { MessagingService } from './service';
import type { MessageHistoryQuery, MessagingCapabilities, MessagingPage, ConversationRecord } from './contracts';
import type { MessagingVisitors, MessagingVisitorSession } from './visitor-service';
import { readMessagingBody, readMessagingQuery } from './http-input';
import { projectMessagingHttpError } from './http-errors';
import { messagingFail, messagingId, messagingInteger, messagingRecord } from './validation';
import { messagingProjectionStream } from './stream';
import { AuthError } from '../auth/types';
type Context = Awaited<ReturnType<ReturnType<typeof createContext>>>;
function createContext(getService: () => MessagingService | null) {
  return async (entryId: string, request: Request, write = false) => {
    const service = getService(); if (!service) messagingFail('MESSAGING_NOT_READY', 503);
    const visitors = service.visitors, entry = visitors.requestEntry(entryId, request, write), capability = visitors.capability(entry, request);
    if (!capability) messagingFail('MESSAGING_FORBIDDEN', 403);
    if (write) visitors.assertCsrf(capability, request);
    const session = await visitors.resolve(entry, capability, request.signal);
    if (!new URL(request.url).pathname.endsWith('/session') && request.headers.get('X-Zero-Support-Session') !== session.actor.visitor!.sessionId) messagingFail('MESSAGING_FORBIDDEN', 403);
    return { service, visitors, entry, capability, session, facade: visitors.forSession(entry, session), projection: visitors.forSession(entry, session, false) };
  };
}
export function createMessagingVisitorRoutes(getService: () => MessagingService | null) {
  const context = createContext(getService), noQuery = (request: Request) => readMessagingQuery(request, []);
  const mutation = (request: Request) => ({ requestId: messagingId(request.headers.get('Idempotency-Key')), signal: request.signal });
  const bind = (captured: Context, id: string) => { if (id !== captured.facade.id) messagingFail('MESSAGING_NOT_FOUND', 404); };
  const page = async (captured: Context, request: Request, projection = false): Promise<MessagingPage<ConversationRecord>> => {
    const query = readMessagingQuery(request, ['after', 'limit', 'archived']);
    if (query.limit !== undefined) messagingInteger(query.limit, 1, 25);
    const conversation = await (projection ? captured.projection : captured.facade).conversation(request.signal);
    return { items: !query.after && conversation.archived === (query.archived === true) ? [conversation] : [], hasMore: false, nextCursor: null };
  };
  const metadata = (visitors: MessagingVisitors, session: MessagingVisitorSession, capability: string) => ({ sessionId: session.actor.visitor!.sessionId, userId: session.actor.id, conversationId: session.actor.visitor!.conversationId,
    expiresAt: session.expiresAt, csrf: visitors.csrf(capability) });
  const live = (captured: Context, request: Request, read: () => Promise<unknown>, subscribeAdditional?: (changed: () => void) => () => void) => {
    const release = captured.visitors.reserveStream(captured.session);
    try { return new Response(messagingProjectionStream(captured.service.runtime, captured.facade.scope, read, request.signal,
      { actorId: captured.facade.actor.id, conversationId: captured.facade.id }, release, subscribeAdditional), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } }); }
    catch (failure) { release(); throw failure; }
  };
  return new Elysia({ name: 'zero-messaging-public-support', prefix: '/api/messaging/public/:entry' })
    .onBeforeHandle(({ set }) => { Object.assign(set.headers, { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer' }); })
    .onError(({ error, code, set }) => { if (code === 'NOT_FOUND') return; const failure = projectMessagingHttpError(error, code); set.status = failure.status; set.headers['Cache-Control'] = 'private, no-store'; return failure.body; })
    .get('/session', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request); return metadata(captured.visitors, captured.session, captured.capability); })
    .post('/session', async ({ params, request, set }) => {
      noQuery(request); const service = getService(); if (!service) messagingFail('MESSAGING_NOT_READY', 503);
      const visitors = service.visitors, entry = visitors.requestEntry(params.entry, request, true), started = await visitors.start(entry, await readMessagingBody(request), request);
      set.headers['Set-Cookie'] = visitors.cookie(entry, started.capability); return metadata(visitors, started.session, started.capability);
    }, { parse: 'none' })
    .delete('/session', async ({ params, request, set }) => {
      noQuery(request); const service = getService(); if (!service) messagingFail('MESSAGING_NOT_READY', 503);
      const visitors = service.visitors, entry = visitors.requestEntry(params.entry, request, true), capability = visitors.capability(entry, request);
      if (capability) {
        let session: MessagingVisitorSession | null = null;
        try { session = await visitors.resolve(entry, capability, request.signal); }
        catch (failure) { if (!(failure instanceof AuthError) || failure.code !== 'MESSAGING_FORBIDDEN') throw failure; }
        if (session) { visitors.assertCsrf(capability, request); await visitors.forSession(entry, session).revoke(mutation(request)); }
      }
      // An expired/revoked cookie can be forgotten. This does not claim that a
      // missing/expired server session was newly revoked by this request.
      set.headers['Set-Cookie'] = visitors.cookie(entry, '', true); return { ended: true };
    }, { parse: 'none' })
    .get('/config', async ({ params, request }): Promise<MessagingCapabilities> => {
      noQuery(request); const { facade, entry } = await context(params.entry, request);
      // Session admission above is not a general messaging/directory capability.
      await facade.conversation(request.signal);
      return getService()!.visitors.capabilities(entry);
    })
    .get('/receipts/:id', async ({ params, request }) => { noQuery(request); return (await context(params.entry, request)).facade.receipt(params.id, request.signal); })
    .get('/typing/live', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request); await captured.projection.typing(request.signal); return live(captured, request, () => captured.projection.typing(request.signal), changed => captured.projection.observeTyping(changed)); })
    .post('/typing', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); return captured.facade.setTyping(await readMessagingBody(request)); }, { parse: 'none' })
    .get('/conversations', async ({ params, request }) => page(await context(params.entry, request), request))
    .get('/conversations/live', async ({ params, request }) => { const captured = await context(params.entry, request); await page(captured, request); return live(captured, request, () => page(captured, request, true)); })
    .get('/conversations/:conversationId', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request); bind(captured, params.conversationId); return captured.facade.conversation(request.signal); })
    .get('/conversations/:conversationId/people', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request); bind(captured, params.conversationId); return captured.facade.people(request.signal); })
    .post('/conversations/:conversationId/read', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); bind(captured, params.conversationId); const r = messagingRecord(await readMessagingBody(request), ['throughSequence']); return captured.facade.markRead(messagingInteger(r.throughSequence, 0), mutation(request)); }, { parse: 'none' })
    .get('/conversations/:conversationId/messages', async ({ params, request }) => { const captured = await context(params.entry, request); bind(captured, params.conversationId); return captured.facade.history(readMessagingQuery(request, ['before', 'after', 'limit', 'search']) as MessageHistoryQuery, request.signal); })
    .get('/conversations/:conversationId/messages/live', async ({ params, request }) => { const captured = await context(params.entry, request); bind(captured, params.conversationId); const query = readMessagingQuery(request, ['before', 'after', 'limit', 'search']) as MessageHistoryQuery; await captured.facade.history({ ...query, limit: 1 }, request.signal); return live(captured, request, () => captured.projection.history(query, request.signal)); })
    .post('/conversations/:conversationId/messages', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); bind(captured, params.conversationId); return captured.facade.send(await readMessagingBody(request), mutation(request)); }, { parse: 'none' })
    .get('/conversations/:conversationId/messages/:messageId', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request); bind(captured, params.conversationId); return captured.facade.message(params.messageId, request.signal); })
    .put('/conversations/:conversationId/messages/:messageId', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); bind(captured, params.conversationId); const r = messagingRecord(await readMessagingBody(request), ['text', 'expectedRevision']); return captured.facade.change(params.messageId, messagingInteger(r.expectedRevision), 'edit', r.text as string, mutation(request)); }, { parse: 'none' })
    .delete('/conversations/:conversationId/messages/:messageId', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); bind(captured, params.conversationId); const r = messagingRecord(await readMessagingBody(request), ['expectedRevision']); return captured.facade.change(params.messageId, messagingInteger(r.expectedRevision), 'remove', '', mutation(request)); }, { parse: 'none' })
    .post('/conversations/:conversationId/messages/:messageId/reactions', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); bind(captured, params.conversationId); const r = messagingRecord(await readMessagingBody(request), ['emoji', 'selected']); return captured.facade.react(params.messageId, r.emoji as string, r.selected as boolean, mutation(request)); }, { parse: 'none' })
    .post('/support/:conversationId/request-human', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); bind(captured, params.conversationId); const r = messagingRecord(await readMessagingBody(request), ['expectedEpoch']); return captured.facade.requestHuman(messagingInteger(r.expectedEpoch), mutation(request)); }, { parse: 'none' })
    .post('/conversations/:conversationId/attachments', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); bind(captured, params.conversationId); return captured.facade.attachments.allocate(params.conversationId, await readMessagingBody(request) as never, mutation(request)); }, { parse: 'none' })
    .get('/conversations/:conversationId/attachments/:attachmentId', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request); bind(captured, params.conversationId); return captured.facade.attachments.get(params.conversationId, params.attachmentId, { signal: request.signal }); })
    .put('/conversations/:conversationId/attachments/:attachmentId/content', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); bind(captured, params.conversationId); if (!request.body || request.headers.get('Content-Type') !== 'application/octet-stream') messagingFail('MESSAGING_INPUT_INVALID', 422); return captured.facade.attachments.upload(params.conversationId, params.attachmentId, request.body, mutation(request)); }, { parse: 'none' })
    .delete('/conversations/:conversationId/attachments/:attachmentId', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request, true); bind(captured, params.conversationId); return captured.facade.attachments.remove(params.conversationId, params.attachmentId, mutation(request)); }, { parse: 'none' })
    .get('/conversations/:conversationId/attachments/:attachmentId/content', async ({ params, request }) => { noQuery(request); const captured = await context(params.entry, request); bind(captured, params.conversationId); const { attachment, stream } = await captured.facade.attachments.open(params.conversationId, params.attachmentId, { signal: request.signal });
      const encoded = encodeURIComponent(attachment.fileName).replace(/['()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase());
      return new Response(stream, { headers: { 'Content-Type': attachment.mimeType, 'Content-Length': String(attachment.sizeBytes), 'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cross-Origin-Resource-Policy': 'same-origin' } });
    });
}
