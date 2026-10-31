/** Worker-local versioned support-open identity. Display defaults are not user intent; exact legacy digests stay intact. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { ConversationRow, MemberRow, MessagingActor } from './realm-model';
import { assertMessagingMember, memberKey } from './realm-model';
import { messagingChoice, messagingFail, messagingHash, messagingId, messagingRecord, messagingText } from './validation';

/** Normalize only a server-minted named-inbox request. A retained receipt never bypasses current destination/membership admission. */
export function messagingSupportOpenIntent(context: DatabaseWriteCommandContext, actor: MessagingActor, input: {
  id: string; inbox: string; requestId: unknown; title: string; owner: 'triage' | 'assistant'; channelId: string | null; intent: unknown;
}): readonly unknown[] {
  const r = messagingRecord(input.intent, ['title', 'mode']);
  const title = r.title === null ? null : messagingText(r.title, 200, true), mode = r.mode === null ? null : messagingChoice(r.mode, ['human', 'assistant']);
  if (actor.kind !== 'user' || input.channelId !== null || title !== null && title !== input.title
    || mode === 'human' && input.owner !== 'triage' || mode === 'assistant' && input.owner !== 'assistant') messagingFail('MESSAGING_INPUT_INVALID', 422);
  // Keep the public operation name used by receipt reconciliation. Only the
  // private digest framing is versioned.
  const intent = ['support.open', 'inbox.v2', input.inbox, title, mode];
  const prior = context.db.get('messaging_intents', messagingHash([actor.scopeId, actor.kind, actor.id, messagingId(input.requestId)]));
  if (!prior || prior.digest === messagingHash(intent)) return intent;

  // Pre-v2 named-inbox receipts hashed the resolved title, initial owner and
  // bot. Recover only those exact old normalized intents from this actor's
  // original immutable support identity/title; never rewrite or broadly accept
  // another digest. Ownership may since have changed, so test the initial
  // owner choices compatible with the caller's mode against the stored digest.
  const original = context.db.get('messaging_conversations', input.id) as ConversationRow | null;
  if (!original || original.scope_id !== actor.scopeId || original.kind !== 'support' || original.created_by !== actor.id
    || original.support_entry_id !== input.inbox || original.visitor_session_id || original.channel_id !== null) return intent;
  const member = context.db.get('messaging_members', memberKey(original.id, actor.id)) as MemberRow | null;
  assertMessagingMember(actor, original, member);
  if (member!.role !== 'customer') return intent;
  const owners = mode === null ? ['triage', 'assistant'] : [mode === 'human' ? 'triage' : 'assistant'];
  for (const owner of owners) for (const assistant of new Set([original.assistant_id ?? null, null])) {
    const legacy = ['support.open', title ?? original.title, owner, null, 'inbox', input.inbox, assistant];
    if (prior.digest === messagingHash(legacy)) return legacy;
  }
  return intent;
}
