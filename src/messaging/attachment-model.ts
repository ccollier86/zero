/** Shared canonical attachment projection/reservations. A bounded per-actor stage index avoids tracked whole-table scans. */
import type { Row, TableSchema } from '../sync/types';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { MessagingAttachment } from './attachment-contracts';
import type { MessagingActor } from './realm-model';
import { messagingArray, messagingHash, messagingId } from './validation';
export const MESSAGING_ATTACHMENT_TABLES: Record<string, TableSchema> = {
  messaging_attachment_reservations: { id: 'TEXT PRIMARY KEY', ids_json: 'TEXT NOT NULL' },
};
export type AttachmentRow = Row & { id: string; scope_id: string; conversation_id: string; owner_id: string; owner_kind: 'user' | 'external'; visibility: MessagingAttachment['visibility'];
  state: MessagingAttachment['state']; file_name: string; mime_type: string; size_bytes: number; checksum: string; created_at: number; expires_at: number; message_id: string | null };
export function projectMessagingAttachment(row: AttachmentRow): MessagingAttachment {
  return { id: row.id, conversationId: row.conversation_id, fileName: row.file_name, mimeType: row.mime_type, sizeBytes: row.size_bytes, checksum: row.checksum,
    visibility: row.visibility, state: row.state, createdAt: row.created_at, expiresAt: row.expires_at, messageId: row.message_id };
}
export function attachmentReservationKey(actor: Pick<MessagingActor, 'scopeId' | 'kind' | 'id'>): string { return messagingHash([actor.scopeId, actor.kind, actor.id]); }
export function attachmentReservations(context: DatabaseWriteCommandContext, key: string): string[] {
  const row = context.db.get('messaging_attachment_reservations', key);
  return row ? messagingArray(JSON.parse(String(row.ids_json)), 10).map(messagingId) : [];
}
/** Release only after message association or completed private-byte cleanup commits. */
export function releaseAttachmentReservation(context: DatabaseWriteCommandContext, row: AttachmentRow): void {
  const key = attachmentReservationKey({ scopeId: row.scope_id, kind: row.owner_kind, id: row.owner_id }), current = attachmentReservations(context, key), next = current.filter(id => id !== row.id);
  if (!next.length && current.length) context.db.delete('messaging_attachment_reservations', key);
  else if (next.length !== current.length) context.db.update('messaging_attachment_reservations', key, { ids_json: JSON.stringify(next) });
}
