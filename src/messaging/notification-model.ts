/** Private source-transaction notification audience. Candidate identities are fixed at accepted send; no text crosses to SYSTEM. */
import type { Row, TableSchema } from '../sync/types';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { conversationMembers, memberKey, type ConversationRow, type MemberRow, type MessageRow } from './realm-model';
import { messagingFail } from './validation';
import { messagingNotificationPath } from './notification-link';
export interface MessagingNotificationRecipient { readonly id: string; readonly staff: boolean }
export type MessagingNotificationAudience = Row & { id: string; scope_id: string; path: string; recipients_json: string; created_at: number };
export const MESSAGING_NOTIFICATION_TABLES: Record<string, TableSchema> = {
  messaging_notification_audiences: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', path: 'TEXT NOT NULL', recipients_json: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL' },
};
/** Called only inside the accepted public message/job commit, never for a staff note or HTTP-selected recipient list. */
export function captureMessagingNotificationAudience({ db }: DatabaseWriteCommandContext, conversation: ConversationRow, messageId: string, jobId: string, now: number, path: unknown): void {
  const message = db.get('messaging_messages', messageId) as MessageRow | null;
  if (!message || message.scope_id !== conversation.scope_id || message.conversation_id !== conversation.id || message.visibility !== 'conversation' || message.deleted) messagingFail('MESSAGING_JOB_CONFLICT');
  const recipients: MessagingNotificationRecipient[] = [];
  for (const id of conversationMembers(conversation)) {
    const member = db.get('messaging_members', memberKey(conversation.id, id)) as MemberRow | null;
    if (!member || member.scope_id !== conversation.scope_id || member.kind !== 'user' || member.active !== 1 || message.author_kind === 'user' && id === message.author_id) continue;
    const staff = conversation.kind === 'support' && member.role === 'staff', sequence = staff ? message.sequence : message.public_sequence!;
    if (sequence >= member.history_from && member.read_sequence < sequence) recipients.push({ id, staff });
  }
  db.createStrict('messaging_notification_audiences', { id: jobId, scope_id: conversation.scope_id, path: messagingNotificationPath(path ?? '/messages'), recipients_json: JSON.stringify(recipients), created_at: now });
}
