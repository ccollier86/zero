/** Contact requests and independently owned block records. Unblocking never clears the other party's block. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingCommand } from './realm-errors';
import { assertMessagingContact, assertRevision, blockKey, captureMessagingActor, contactKey, messagingIntent } from './realm-model';
import { messagingChoice, messagingFail, messagingId, messagingRecord } from './validation';

export function changeMessagingContact(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'requestId', 'userId', 'action', 'expectedRevision']), actor = captureMessagingActor(r.actor), other = messagingId(r.userId);
    const action = messagingChoice(r.action, ['request', 'accept', 'decline', 'block', 'unblock']);
    if (actor.kind !== 'user' || other === actor.id) messagingFail('MESSAGING_INPUT_INVALID', 422);
    const id = contactKey(actor.scopeId, actor.id, other), prior = context.db.get('messaging_contacts', id);
    if (!['block', 'unblock'].includes(action)) assertMessagingContact(context, actor, other, false);
    return messagingIntent(context, actor, r.requestId, ['contact', other, action, r.expectedRevision ?? null], () => {
      const now = Date.now();
      if (action === 'unblock') { context.db.delete('messaging_blocks', blockKey(actor.scopeId, actor.id, other)); return { unblocked: true }; }
      if (action === 'block') {
        const key = blockKey(actor.scopeId, actor.id, other);
        if (!context.db.get('messaging_blocks', key)) context.db.createStrict('messaging_blocks', { id: key, scope_id: actor.scopeId, participant_id: actor.id, target_id: other, created_at: now });
        return { id, userId: other, direction: 'outgoing', state: 'blocked', revision: prior?.revision ?? 0, updatedAt: now };
      }
      if (action !== 'request') {
        if (!prior || prior.recipient_id !== actor.id || prior.state !== 'pending') messagingFail('MESSAGING_FORBIDDEN', 403);
        assertRevision({ revision: Number(prior.revision) }, r.expectedRevision);
      }
      const row = action === 'request' && prior && ['accepted', 'pending'].includes(String(prior.state)) ? prior : {
        id, scope_id: actor.scopeId, requester_id: action === 'request' ? actor.id : prior!.requester_id, recipient_id: action === 'request' ? other : actor.id,
        state: action === 'request' ? 'pending' : action === 'accept' ? 'accepted' : 'declined', blocked_by: null, revision: Number(prior?.revision ?? 0) + 1, updated_at: now,
      };
      if (prior) context.db.update('messaging_contacts', id, row); else context.db.createStrict('messaging_contacts', row);
      return { id, userId: other, direction: row.requester_id === actor.id ? 'outgoing' : 'incoming', state: row.state, revision: row.revision, updatedAt: row.updated_at };
    });
  });
}
