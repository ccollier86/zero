/** Private session admission. A visitor capability is scoped to one configured entry and one canonical support conversation. */
import type { Row } from '../sync/types';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext, DatabaseWriteCommandRegistry } from '../databases/database-realm';
import { captureMessagingActor, messagingIntent, type MessagingActor } from './realm-model';
import { messagingCommand } from './realm-errors';
import { openMessagingSupport } from './support-commands';
import { messagingFail, messagingHash, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';
import { jobScope } from './job-model';
export type VisitorSessionRow = Row & { id: string; customer_id: string; scope_id: string; conversation_id: string; token_hash: string; expires_at: number; revoked: number;
  entry_id: string | null; policy_hash: string | null; write_window: number; write_count: number; message_count: number };
export function assertMessagingVisitorSession(get: (id: string) => VisitorSessionRow | null, actor: MessagingActor): VisitorSessionRow | null {
  if (!actor.visitor) return null;
  const key = actor.visitor, row = get(key.sessionId);
  if (!row || row.revoked || row.expires_at <= Date.now() || row.scope_id !== actor.scopeId || row.customer_id !== actor.id || row.conversation_id !== key.conversationId
    || row.token_hash !== key.tokenHash || row.entry_id !== key.entryId || row.policy_hash !== key.policyHash || actor.kind !== 'external' || actor.staff) messagingFail('MESSAGING_FORBIDDEN', 403);
  return row;
}
export function guardMessagingVisitorRead({ database }: DatabaseReadQueryContext, input: unknown): void {
  if (!input || typeof input !== 'object' || !('actor' in input) || !input.actor || typeof input.actor !== 'object' || !('visitor' in input.actor)) return;
  const actor = captureMessagingActor(input.actor);
  assertMessagingVisitorSession(id => database.query<VisitorSessionRow>('SELECT * FROM messaging_sessions WHERE id=?').get(id), actor);
}
/** Rate accounting and intent replay are part of the same serialized source commit; a failed command rolls both back. */
export function withMessagingVisitorGuards(commands: DatabaseWriteCommandRegistry): DatabaseWriteCommandRegistry {
  return Object.fromEntries(Object.entries(commands).map(([name, handler]) => [name, (context: DatabaseWriteCommandContext, input: unknown) => {
    const raw = input && typeof input === 'object' ? input as { actor?: unknown; requestId?: unknown } : {};
    if (!raw.actor || typeof raw.actor !== 'object' || !('visitor' in raw.actor)) return handler(context, input as never);
    return messagingCommand(context, () => {
      const actor = captureMessagingActor(raw.actor), row = assertMessagingVisitorSession(id => context.db.get('messaging_sessions', id) as VisitorSessionRow | null, actor)!;
      // This is a second closed boundary even if a future HTTP route is miswired.
      if (!['messaging.visitor.revoke', 'messaging.message.send', 'messaging.message.change', 'messaging.message.react', 'messaging.conversation.read', 'messaging.support.request-human', 'messaging.attachment.allocate', 'messaging.attachment.accept', 'messaging.attachment.retire'].includes(name)) messagingFail('MESSAGING_FORBIDDEN', 403);
      const prior = context.db.get('messaging_intents', messagingHash([actor.scopeId, actor.kind, actor.id, messagingId(raw.requestId)]));
      const window = Math.floor(Date.now() / 60000), count = row.write_window === window ? row.write_count : 0;
      if (!prior && (count >= 120 || name === 'messaging.message.send' && row.message_count >= 1000)) messagingFail('MESSAGING_CAPACITY', 429);
      const result = handler(context, input as never) as { ok: true; value: unknown };
      if (!prior) context.db.update('messaging_sessions', row.id, { write_window: window, write_count: count + 1, message_count: row.message_count + (name === 'messaging.message.send' ? 1 : 0) });
      return result.value;
    });
  }]));
}
export function createMessagingVisitor(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'entryId', 'policyHash', 'id', 'customerId', 'conversationId', 'tokenHash', 'ttlSeconds', 'maxVisitors', 'title', 'owner', 'assistantId']);
    const scopeId = jobScope(r.scopeId), entryId = messagingId(r.entryId), id = messagingId(r.id), customerId = messagingId(r.customerId), conversationId = messagingId(r.conversationId);
    const tokenHash = messagingText(r.tokenHash, 64), policyHash = messagingText(r.policyHash, 64);
    if (!/^[a-f0-9]{64}$/.test(tokenHash) || !/^[a-f0-9]{64}$/.test(policyHash)) messagingFail('MESSAGING_INPUT_INVALID', 422);
    // A hard lifetime budget bounds retained guest history, not merely active
    // cookies. Expiry is not permission to erase evidence or recycle identities.
    const maximum = messagingInteger(r.maxVisitors, 1, 100000);
    const budgetId = messagingHash([scopeId, entryId]), budget = context.db.get('messaging_visitor_budgets', budgetId), count = Number(budget?.visitor_count ?? 0);
    if (count >= maximum) messagingFail('MESSAGING_CAPACITY', 429);
    if (budget) context.db.update('messaging_visitor_budgets', budgetId, { visitor_count: count + 1 });
    else context.db.createStrict('messaging_visitor_budgets', { id: budgetId, scope_id: scopeId, entry_id: entryId, visitor_count: 1 });
    const now = Date.now(), expires = now + messagingInteger(r.ttlSeconds, 60, 7 * 86400) * 1000;
    context.db.createStrict('messaging_customers', { id: customerId, scope_id: scopeId, connection_id: entryId, external_id: id, created_at: now });
    context.db.createStrict('messaging_sessions', { id, customer_id: customerId, scope_id: scopeId, conversation_id: conversationId, token_hash: tokenHash, expires_at: expires, revoked: 0,
      entry_id: entryId, policy_hash: policyHash, write_window: 0, write_count: 0, message_count: 0 });
    openMessagingSupport(context, { actor: { scopeId, id: customerId, kind: 'external', staff: false }, id: conversationId, requestId: 'visitor-open:' + id,
      title: r.title, owner: r.owner, channelId: null, entryId, visitorSessionId: id, assistantId: r.assistantId });
    return { id, customerId, conversationId, expiresAt: expires };
  });
}
/** The transport supplies only a hashed random cookie and its fixed entry; no client actor/scope/role is accepted. */
export function readMessagingVisitor({ database }: DatabaseReadQueryContext, input: unknown): unknown {
  const r = messagingRecord(input, ['scopeId', 'entryId', 'policyHash', 'id', 'tokenHash']), scopeId = jobScope(r.scopeId), id = messagingId(r.id);
  const row = database.query<VisitorSessionRow>('SELECT * FROM messaging_sessions WHERE id=? AND scope_id=?').get(id, scopeId);
  if (!row) messagingFail('MESSAGING_FORBIDDEN', 403);
  const actor: MessagingActor = { scopeId, id: row.customer_id, kind: 'external', staff: false,
    visitor: { sessionId: id, tokenHash: messagingText(r.tokenHash, 64), entryId: messagingId(r.entryId), policyHash: messagingText(r.policyHash, 64), conversationId: row.conversation_id } };
  assertMessagingVisitorSession(() => row, actor);
  return { actor, expiresAt: row.expires_at };
}
export function revokeMessagingVisitor(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['actor', 'requestId']), actor = captureMessagingActor(r.actor);
    if (!actor.visitor) messagingFail('MESSAGING_FORBIDDEN', 403);
    return messagingIntent(context, actor, r.requestId, ['visitor.revoke', actor.visitor.sessionId], () => {
      context.db.update('messaging_sessions', actor.visitor!.sessionId, { revoked: 1 }); return { revoked: true };
    });
  });
}
