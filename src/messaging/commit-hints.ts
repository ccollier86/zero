/** Private canonical invalidation sideband. No transcript, metadata values, row event or browser-supplied recipient list crosses it. */
import type { DatabaseWriteCommandContext, DatabaseWriteCommandHandler, DatabaseWriteCommandRegistry } from '../databases/database-realm';
import { conversationMembers, memberKey, type ConversationRow, type MemberRow, type MessageRow } from './realm-model';
import { messagingArray, messagingFail, messagingId, messagingRecord } from './validation';

export interface MessagingCommitHint { readonly conversationId: string | null; readonly recipientIds: readonly string[]; readonly supportQueue?: true }
export interface MessagingSubscription { readonly actorId: string; readonly conversationId?: string; readonly supportQueue?: true }
type Before = { conversation: ConversationRow | null; recipients: string[]; staff: string[]; privateNote: boolean; actorId: string | null; peerId: string | null; queueKey: string };
const NO_PUBLIC_CHANGE = new Set(['messaging.owner.bind', 'messaging.attachment.allocate', 'messaging.attachment.accept', 'messaging.attachment.retire', 'messaging.job.dispatch', 'messaging.notification.complete', 'messaging.notification.redispatch']);

/** The parent strips this envelope before returning the ordinary public command result. Exact transport replay is not a new change. */
export function withMessagingCommitHints(commands: DatabaseWriteCommandRegistry): DatabaseWriteCommandRegistry {
  return Object.fromEntries(Object.entries(commands).map(([name, handler]) => [name, ((context, input) => {
    if (NO_PUBLIC_CHANGE.has(name)) return handler(context, input);
    const before = capture(context, input, name), result = handler(context, input);
    const after = capture(context, input, name);
    const privateNote = before.privateNote || after.privateNote;
    const recipientIds = [...new Set(privateNote ? [...before.staff, ...after.staff] : [...before.recipients, ...after.recipients])];
    if (!before.conversation && !after.conversation && name === 'messaging.contact') recipientIds.push(...[before.actorId, before.peerId].filter((id): id is string => id !== null));
    const conversationId = after.conversation?.id ?? before.conversation?.id ?? null;
    // Non-member staff observe only a content-free queue-change bit. Private
    // notes/read cursors/messages never disclose their activity to that queue.
    const supportQueue = !privateNote && before.queueKey !== after.queueKey;
    return { ...(result as object), hint: { conversationId, recipientIds: [...new Set(recipientIds)], ...(supportQueue ? { supportQueue: true } : {}) } } as never;
  }) satisfies DatabaseWriteCommandHandler]));
}

/** Defensive parsing also prevents an incompatible child image from turning a private hint into scope-wide fanout. */
export function readMessagingCommitHint(value: unknown): MessagingCommitHint {
  const r = messagingRecord(value, ['conversationId', 'recipientIds', 'supportQueue']);
  if (r.supportQueue !== undefined && r.supportQueue !== true) messagingFail('MESSAGING_INPUT_INVALID', 422);
  return { conversationId: r.conversationId === null ? null : messagingId(r.conversationId), recipientIds: [...new Set(messagingArray(r.recipientIds, 200).map(messagingId))], ...(r.supportQueue === true ? { supportQueue: true as const } : {}) };
}
export function messagingHintMatches(hint: MessagingCommitHint, filter: MessagingSubscription | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.supportQueue === true) return hint.supportQueue === true;
  return hint.recipientIds.includes(filter.actorId) && (filter.conversationId === undefined || filter.conversationId === hint.conversationId);
}

function capture({ db }: DatabaseWriteCommandContext, input: unknown, name: string): Before {
  const r = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const actor = r.actor && typeof r.actor === 'object' ? r.actor as Record<string, unknown> : {};
  const actorId = typeof actor.id === 'string' ? actor.id : null;
  let id = typeof r.conversationId === 'string' ? r.conversationId : typeof r.id === 'string' ? r.id : null;
  let privateNote = r.visibility === 'staff' || name === 'messaging.review.resolve' && r.action !== 'retry';
  if (name.startsWith('messaging.job.') && typeof r.id === 'string') {
    const job = db.get('messaging_jobs', r.id);
    if (typeof job?.conversation_id === 'string') id = job.conversation_id;
  }
  if (name.startsWith('messaging.message.') && typeof r.id === 'string') {
    const message = db.get('messaging_messages', r.id) as MessageRow | null;
    if (message) { id = message.conversation_id; privateNote = message.visibility === 'staff'; }
  }
  const conversation = id ? db.get('messaging_conversations', id) as ConversationRow | null : null;
  // Review evidence belongs to staff (or an internal bot's human owner), not
  // the customer stream. Ordinary current job activity is public and truthful.
  if (conversation?.kind === 'assistant' && name === 'messaging.review.resolve') privateNote = false;
  const recipients = conversation ? conversationMembers(conversation) : [], staff = conversation ? recipients.filter(id => {
    const member = db.get('messaging_members', memberKey(conversation.id, id)) as MemberRow | null;
    return member?.active === 1 && member.role === 'staff';
  }) : [];
  const queueKey = conversation?.kind === 'support' ? JSON.stringify([conversation.id, conversation.owner, conversation.owner_epoch, conversation.archived, conversation.created_at]) : '';
  return { conversation, recipients, staff, privateNote, actorId, peerId: typeof r.userId === 'string' ? r.userId : null, queueKey };
}
