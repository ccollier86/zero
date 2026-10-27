/** Authenticated binary attachment routes. No drive/object grants, arbitrary inline HTML or reflected error messages. */
import { Elysia } from 'elysia';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { MessagingPluginConfig } from './plugin';
import { currentMessagingRequest } from './http-authority';
import { projectMessagingHttpError } from './http-errors';
import { readMessagingBody, readMessagingQuery } from './http-input';
import { messagingFail, messagingId } from './validation';
/** The parent router supplies /api/messaging. All dynamic conversation parameter names match the other native routes. */
export function createMessagingAttachmentRoutes(config: MessagingPluginConfig) {
  const noQuery = (request: Request) => readMessagingQuery(request, []);
  return new Elysia({ name: 'zero-messaging-attachments' })
    .use(createAuthMiddleware(config.getTokenService, config.authorization))
    .onError(({ error, code, set }) => { if (code === 'NOT_FOUND') return; const failure = projectMessagingHttpError(error, code); set.status = failure.status; set.headers['Cache-Control'] = 'private, no-store'; return failure.body; })
    .post('/conversations/:conversationId/attachments', async ({ access, params, request }) => {
      const user = access.requireUser(); noQuery(request);
      const opts = { requestId: messagingId(request.headers.get('Idempotency-Key')), signal: request.signal };
      return currentMessagingRequest(config, user, request).facade.attachments.allocate(params.conversationId, await readMessagingBody(request) as never, opts);
    }, { parse: 'none' })
    .get('/conversations/:conversationId/attachments/:attachmentId', ({ access, params, request }) => {
      const user = access.requireUser(); noQuery(request); return currentMessagingRequest(config, user, request).facade.attachments.get(params.conversationId, params.attachmentId, { signal: request.signal });
    })
    .put('/conversations/:conversationId/attachments/:attachmentId/content', async ({ access, params, request }) => {
      const user = access.requireUser(); noQuery(request); const opts = { requestId: messagingId(request.headers.get('Idempotency-Key')), signal: request.signal };
      if (!request.body || request.headers.get('Content-Type')?.split(';')[0] !== 'application/octet-stream') messagingFail('MESSAGING_INPUT_INVALID', 422);
      return currentMessagingRequest(config, user, request).facade.attachments.upload(params.conversationId, params.attachmentId, request.body, opts);
    }, { parse: 'none' })
    .delete('/conversations/:conversationId/attachments/:attachmentId', ({ access, params, request }) => {
      const user = access.requireUser(); noQuery(request); return currentMessagingRequest(config, user, request).facade.attachments.remove(params.conversationId, params.attachmentId, { requestId: messagingId(request.headers.get('Idempotency-Key')), signal: request.signal });
    }, { parse: 'none' })
    .get('/conversations/:conversationId/attachments/:attachmentId/content', async ({ access, params, request }) => {
      const user = access.requireUser(); noQuery(request);
      const { attachment, stream } = await currentMessagingRequest(config, user, request).facade.attachments.open(params.conversationId, params.attachmentId, { signal: request.signal });
      const encoded = encodeURIComponent(attachment.fileName).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      return new Response(stream, { headers: { 'Content-Type': attachment.mimeType, 'Content-Length': String(attachment.sizeBytes),
        'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encoded}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'", 'Cross-Origin-Resource-Policy': 'same-origin' } });
    });
}
