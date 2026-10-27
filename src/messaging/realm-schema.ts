/** Canonical private Fabric state. Message bodies stay here, not in SYSTEM, operational logs or typing payloads. */
import type { TableSchema } from '../sync/types';
export const MESSAGING_TABLES: Record<string, TableSchema> = {
  _messaging_owner: { id: 'TEXT PRIMARY KEY', owner_id: 'TEXT NOT NULL' },
  messaging_conversations: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', kind: 'TEXT NOT NULL', title: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL',
    created_at: 'INTEGER NOT NULL', updated_at: 'INTEGER NOT NULL', public_updated_at: 'INTEGER NOT NULL', archived: 'INTEGER NOT NULL',
    created_by: 'TEXT NOT NULL', owner: 'TEXT NOT NULL', owner_id: 'TEXT', owner_epoch: 'INTEGER NOT NULL', internal_sequence: 'INTEGER NOT NULL', public_sequence: 'INTEGER NOT NULL', channel_id: 'TEXT', members_json: 'TEXT NOT NULL' },
  messaging_members: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', conversation_id: 'TEXT NOT NULL', participant_id: 'TEXT NOT NULL', kind: 'TEXT NOT NULL',
    role: 'TEXT NOT NULL', active: 'INTEGER NOT NULL', joined_at: 'INTEGER NOT NULL', history_from: 'INTEGER NOT NULL', read_sequence: 'INTEGER NOT NULL' },
  messaging_messages: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', conversation_id: 'TEXT NOT NULL', sequence: 'INTEGER NOT NULL', public_sequence: 'INTEGER', revision: 'INTEGER NOT NULL',
    author_id: 'TEXT NOT NULL', author_kind: 'TEXT NOT NULL', visibility: 'TEXT NOT NULL', text: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL', edited_at: 'INTEGER', deleted: 'INTEGER NOT NULL', attachment_ids: 'TEXT NOT NULL' },
  messaging_reactions: { id: 'TEXT PRIMARY KEY', conversation_id: 'TEXT NOT NULL', message_id: 'TEXT NOT NULL', participant_id: 'TEXT NOT NULL', emoji: 'TEXT NOT NULL' },
  messaging_contacts: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', requester_id: 'TEXT NOT NULL', recipient_id: 'TEXT NOT NULL', state: 'TEXT NOT NULL', blocked_by: 'TEXT', revision: 'INTEGER NOT NULL', updated_at: 'INTEGER NOT NULL' },
  messaging_blocks: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', participant_id: 'TEXT NOT NULL', target_id: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL' },
  messaging_intents: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', participant_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', result_json: 'TEXT NOT NULL', receipt_json: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL' },
  messaging_attachments: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', conversation_id: 'TEXT NOT NULL', owner_id: 'TEXT NOT NULL', visibility: 'TEXT NOT NULL',
    state: 'TEXT NOT NULL', file_name: 'TEXT NOT NULL', mime_type: 'TEXT NOT NULL', size_bytes: 'INTEGER', checksum: 'TEXT', created_at: 'INTEGER NOT NULL', expires_at: 'INTEGER NOT NULL', message_id: 'TEXT' },
  messaging_jobs: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', conversation_id: 'TEXT NOT NULL', message_id: 'TEXT NOT NULL', kind: 'TEXT NOT NULL', owner_epoch: 'INTEGER NOT NULL',
    state: 'TEXT NOT NULL', lease_nonce: 'TEXT', lease_expires: 'INTEGER', attempts: 'INTEGER NOT NULL', provider_id: 'TEXT', error_code: 'TEXT', created_at: 'INTEGER NOT NULL', updated_at: 'INTEGER NOT NULL' },
  messaging_customers: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', connection_id: 'TEXT NOT NULL', external_id: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL' },
  messaging_sessions: { id: 'TEXT PRIMARY KEY', customer_id: 'TEXT NOT NULL', scope_id: 'TEXT NOT NULL', conversation_id: 'TEXT NOT NULL', token_hash: 'TEXT NOT NULL', expires_at: 'INTEGER NOT NULL', revoked: 'INTEGER NOT NULL' },
  messaging_ingress: { id: 'TEXT PRIMARY KEY', connection_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', message_id: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL' },
};
