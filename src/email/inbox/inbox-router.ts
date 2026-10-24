/** Managed, authenticated browser bridge. All account resolution stays on the server. */
import { t } from 'elysia';
import { defineEndpoint, defineRouter, type ZeroLifecycleContext } from '../../frontend/server/server-extensions';
import { AuthError } from '../../auth/types';
import { EmailError } from '../email-error';
import { EMAIL_INBOX_API } from './contracts';
import type { EmailInboxService } from './inbox-service';
import { emailInboxEvents } from './inbox-stream';

const account = t.String({ minLength: 1, maxLength: 160 });
const ref = t.Object({ folder: t.String({ minLength: 1, maxLength: 512 }), uidValidity: t.String({ pattern: '^[1-9][0-9]{0,9}$' }), uid: t.Integer({ minimum: 1, maximum: 4294967295 }) }, { additionalProperties: false });
const id = t.String({ pattern: '^[A-Za-z0-9_-]{8,128}$' });
const revision = t.Integer({ minimum: 0 });
const compose = t.Object({ from: t.String({ maxLength: 160 }), to: t.Array(t.String({ maxLength: 320 }), { maxItems: 100 }),
  cc: t.Array(t.String({ maxLength: 320 }), { maxItems: 100 }), bcc: t.Array(t.String({ maxLength: 320 }), { maxItems: 100 }),
  subject: t.String({ maxLength: 998 }), text: t.String({ maxLength: 1000000 }), html: t.Optional(t.String({ maxLength: 1000000 })),
  recipientDrafts: t.Optional(t.Object({ to: t.Optional(t.String({ maxLength: 32000 })), cc: t.Optional(t.String({ maxLength: 32000 })), bcc: t.Optional(t.String({ maxLength: 32000 })) }, { additionalProperties: false })),
  inReplyTo: t.Optional(t.String({ maxLength: 998 })), references: t.Optional(t.String({ maxLength: 20000 })),
  attachments: t.Array(t.Object({ id: t.String({ maxLength: 160 }), filename: t.String({ minLength: 1, maxLength: 255 }),
    contentType: t.String({ maxLength: 160 }), size: t.Integer({ minimum: 0, maximum: 10 * 1024 * 1024 }),
    base64: t.String({ maxLength: 14 * 1024 * 1024 }), contentId: t.Optional(t.String({ maxLength: 998 })) }, { additionalProperties: false }), { maxItems: 20 }),
}, { additionalProperties: false });

export function createEmailInboxRouter(service: EmailInboxService) {
  const run = async (context: ZeroLifecycleContext, action: () => Promise<unknown>) => {
    try { const result = await service.perform(action); return result instanceof Response ? result : Response.json(result ?? { ok: true }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } }); }
    catch (error) {
      const known = error instanceof EmailError || error instanceof AuthError;
      return Response.json({ error: known ? error.message : 'The email operation could not be completed.', code: known ? error.code : 'EMAIL_INBOX_FAILED' },
        { status: known ? error.status : 500, headers: { 'Cache-Control': 'private, no-store' } });
    }
  };
  return defineRouter({ name: 'zero-email-inbox', prefix: EMAIL_INBOX_API, auth: { user: 'required', credentials: ['session'] }, routes: [
    defineEndpoint({ method: 'GET', path: '/accounts', handler: context => run(context, () => service.accounts(context)) }),
    defineEndpoint({ method: 'GET', path: '/folders', query: t.Object({ account }), handler: context => run(context, () => service.folders(context, context.query.account)) }),
    defineEndpoint({ method: 'POST', path: '/messages', body: t.Object({ account, query: t.Object({ folder: t.String({ maxLength: 512 }), cursor: t.Optional(t.String({ maxLength: 512 })), search: t.Optional(t.String({ maxLength: 1000 })), filter: t.Optional(t.Union([t.Literal('all'), t.Literal('unread'), t.Literal('starred')])), limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })) }) }),
      handler: context => run(context, () => service.list(context, context.body.account, context.body.query)) }),
    defineEndpoint({ method: 'POST', path: '/message', body: t.Object({ account, ref }), handler: context => run(context, () => service.read(context, context.body.account, context.body.ref)) }),
    defineEndpoint({ method: 'POST', path: '/attachment', body: t.Object({ account, ref, id: t.String({ maxLength: 4 }) }), handler: context => run(context, () => service.attachment(context, context.body.account, context.body.ref, context.body.id)) }),
    defineEndpoint({ method: 'POST', path: '/flags', body: t.Object({ account, ref, flags: t.Object({ seen: t.Optional(t.Boolean()), flagged: t.Optional(t.Boolean()) }, { additionalProperties: false }) }),
      handler: context => run(context, () => service.flags(context, context.body.account, context.body.ref, context.body.flags)) }),
    defineEndpoint({ method: 'POST', path: '/move', body: t.Object({ account, ref, destination: t.String({ minLength: 1, maxLength: 512 }) }), handler: context => run(context, () => service.move(context, context.body.account, context.body.ref, context.body.destination)) }),
    defineEndpoint({ method: 'POST', path: '/draft/read', body: t.Object({ account, id }), handler: context => run(context, () => service.getDraft(context, context.body.account, context.body.id)) }),
    defineEndpoint({ method: 'POST', path: '/draft/save', body: t.Object({ account, id, revision, value: compose }), handler: context => run(context, () => service.saveDraft(context, context.body.account, context.body)) }),
    defineEndpoint({ method: 'POST', path: '/draft/delete', body: t.Object({ account, id, revision }), handler: context => run(context, () => service.deleteDraft(context, context.body.account, context.body)) }),
    defineEndpoint({ method: 'POST', path: '/send', body: t.Object({ account, operationId: id, value: compose, draft: t.Optional(t.Object({ id, revision })) }), handler: context => run(context, () => service.send(context, context.body.account, context.body)) }),
    defineEndpoint({ method: 'GET', path: '/live', query: t.Object({ account, folder: t.String({ minLength: 1, maxLength: 512 }) }), handler: context => run(context, () => emailInboxEvents(service, context, context.query.account, context.query.folder)) }),
  ] });
}
