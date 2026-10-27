/** Worker-only fixed-audience lookup. Retained source candidates are not transcript or a public directory. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { memberKey, type ConversationRow, type MemberRow, type MessageRow } from './realm-model';
import type { MessagingJobRow } from './job-model';
import { jobScope } from './job-model';
import type { MessagingNotificationAudience, MessagingNotificationRecipient } from './notification-model';
import { messagingArray, messagingFail, messagingId, messagingRecord } from './validation';
import { messagingNotificationPath } from './notification-link';
export interface MessagingNotificationContext { readonly job: MessagingJobRow; readonly audiencePresent: boolean; readonly available: boolean; readonly path: string | null; readonly recipients: readonly MessagingNotificationRecipient[]; readonly currentRecipientIds: readonly string[]; readonly managedGroupId?: string | null; readonly internalAssistantId?: string | null }
export function readMessagingNotification({ database }: DatabaseReadQueryContext, input: unknown): MessagingNotificationContext {
  const r = messagingRecord(input, ['scopeId', 'id']), scopeId = jobScope(r.scopeId);
  const job = database.query<MessagingJobRow>('SELECT * FROM messaging_jobs WHERE id=? AND scope_id=?').get(messagingId(r.id), scopeId);
  if (!job || job.kind !== 'notification') messagingFail('MESSAGING_NOT_FOUND', 404);
  const audience = database.query<MessagingNotificationAudience>('SELECT * FROM messaging_notification_audiences WHERE id=? AND scope_id=?').get(job.id, scopeId);
  const conversation = database.query<Pick<ConversationRow, 'id' | 'archived' | 'kind' | 'managed_group_id' | 'assistant_id'>>('SELECT id,archived,kind,managed_group_id,assistant_id FROM messaging_conversations WHERE id=? AND scope_id=?').get(job.conversation_id, scopeId);
  const message = database.query<Pick<MessageRow, 'deleted' | 'visibility' | 'sequence' | 'public_sequence'>>('SELECT deleted,visibility,sequence,public_sequence FROM messaging_messages WHERE id=? AND conversation_id=? AND scope_id=?').get(job.message_id, job.conversation_id, scopeId);
  const recipients = audience ? messagingArray(JSON.parse(audience.recipients_json), 100).map(value => {
    const r = messagingRecord(value, ['id', 'staff']); if (typeof r.staff !== 'boolean') messagingFail('MESSAGING_JOB_CONFLICT');
    return { id: messagingId(r.id), staff: r.staff };
  }) : [];
  const available = !!audience && !!conversation && !conversation.archived && !!message && !message.deleted && message.visibility === 'conversation';
  const internalSequence = message?.sequence ?? 0, publicSequence = message?.public_sequence ?? 0;
  const currentRecipientIds = available ? recipients.filter(recipient => {
    const member = database.query<MemberRow>('SELECT * FROM messaging_members WHERE id=? AND scope_id=?').get(memberKey(job.conversation_id, recipient.id), scopeId);
    const sequence = recipient.staff ? internalSequence : publicSequence;
    return !!member && member.kind === 'user' && member.active === 1 && (!recipient.staff || member.role === 'staff') && member.history_from <= sequence && member.read_sequence < sequence;
  }).map(recipient => recipient.id) : [];
  return { job, audiencePresent: !!audience, available, path: audience ? messagingNotificationPath(audience.path) : null, recipients, currentRecipientIds,
    managedGroupId: conversation?.managed_group_id ?? null, internalAssistantId: conversation?.kind === 'assistant' ? conversation.assistant_id ?? null : null };
}
