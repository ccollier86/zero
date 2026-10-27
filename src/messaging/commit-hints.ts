/** Private canonical invalidation sideband. No transcript, metadata values, row event or browser-supplied recipient list crosses it. */
import type { DatabaseWriteCommandContext, DatabaseWriteCommandHandler, DatabaseWriteCommandRegistry } from '../databases/database-realm';
import { conversationMembers, memberKey, type ConversationRow, type MemberRow, type MessageRow } from './realm-model';
import { messagingArray, messagingId, messagingRecord } from './validation';

export interface MessagingCommitHint { readonly conversationId: string | null; readonly recipientIds: readonly string[] }
export interface MessagingSubscription { readonly actorId: string; readonly conversationId?: string }
type Before = { conversation: ConversationRow | null; recipients: string[]; staff: string[]; privateNote: boolean; actorId: string | null; peerId: string | null };
const NO_PUBLIC_CHANGE = new Set(['messaging.owner.bind', 'messaging.attachment.allocate', 'messaging.attachment.accept', 'messaging.attachment.retire', 'messaging.job.dispatch', 'messaging.job.call']);

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
    return { ...(result as object), hint: { conversationId, recipientIds: [...new Set(recipientIds)] } } as never;
  }) satisfies DatabaseWriteCommandHandler]));
}

/** Defensive parsing also prevents an incompatible child image from turning a private hint into scope-wide fanout. */
export function readMessagingCommitHint(value: unknown): MessagingCommitHint {
  const r = messagingRecord(value, ['conversationId', 'recipientIds']);
  return { conversationId: r.conversationId === null ? null : messagingId(r.conversationId), recipientIds: [...new Set(messagingArray(r.recipientIds, 200).map(messagingId))] };
}
export function messagingHintMatches(hint: MessagingCommitHint, filter: MessagingSubscription | undefined): boolean {
  return filter === undefined || hint.recipientIds.includes(filter.actorId) && (filter.conversationId === undefined || filter.conversationId === hint.conversationId);
}

function capture({ db }: DatabaseWriteCommandContext, input: unknown, name: string): Before {
  const r = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const actor = r.actor && typeof r.actor === 'object' ? r.actor as Record<string, unknown> : {};
  const actorId = typeof actor.id === 'string' ? actor.id : null;
  let id = typeof r.conversationId === 'string' ? r.conversationId : typeof r.id === 'string' ? r.id : null;
  let privateNote = r.visibility === 'staff';
  if (name.startsWith('messaging.job.') && typeof r.id === 'string') {
    const job = db.get('messaging_jobs', r.id);
    if (typeof job?.conversation_id === 'string') id = job.conversation_id;
  }
  if (name.startsWith('messaging.message.') && typeof r.id === 'string') {
    const message = db.get('messaging_messages', r.id) as MessageRow | null;
    if (message) { id = message.conversation_id; privateNote = message.visibility === 'staff'; }
  }
  const conversation = id ? db.get('messaging_conversations', id) as ConversationRow | null : null;
  const recipients = conversation ? conversationMembers(conversation) : [], staff = conversation ? recipients.filter(id => {
    const member = db.get('messaging_members', memberKey(conversation.id, id)) as MemberRow | null;
    return member?.active === 1 && member.role === 'staff';
  }) : [];
  return { conversation, recipients, staff, privateNote, actorId, peerId: typeof r.userId === 'string' ? r.userId : null };
}
