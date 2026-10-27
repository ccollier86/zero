/** Fixed private messaging realm. Importing it starts no server, workers, providers or app code. */
import { AuthError } from '../auth/types';
import { defineDatabaseRealm, type DatabaseReadQueryHandler } from '../databases/database-realm';
import { quoteSqlIdentifier } from '../sync/identity';
import { MESSAGING_TABLES } from './realm-schema';
import { messagingCommand } from './realm-errors';
import { messagingFail, messagingId, messagingRecord } from './validation';
import { createMessagingConversation, changeMessagingConversation, markMessagingRead, ownMessagingConversation } from './conversation-commands';
import { changeMessagingContact } from './contact-commands';
import { changeMessagingMessage, reactMessagingMessage, sendMessagingMessage } from './message-commands';
import { listMessagingContacts, listMessagingConversations, listMessagingMessages, listMessagingSupportQueue, readMessagingConversation, readMessagingMessage, readMessagingReceipt, readMessagingTypingMembership } from './realm-queries';
import { openMessagingSupport, claimMessagingSupport } from './support-commands';
import { MESSAGING_ATTACHMENT_TABLES } from './attachment-model';
import { allocateMessagingAttachment, acceptMessagingAttachment, retireMessagingAttachment } from './attachment-commands';
import { readMessagingAttachment, pendingMessagingAttachments } from './attachment-queries';
import { withMessagingCommitHints } from './commit-hints';

function query(handler: (context: Parameters<DatabaseReadQueryHandler>[0], input: unknown) => unknown): DatabaseReadQueryHandler {
  return (context, input) => {
    try { return { ok: true, value: handler(context, input) } as never; }
    catch (error) { if (error instanceof AuthError && error.code.startsWith('MESSAGING_')) return { ok: false, code: error.code, status: error.status }; throw error; }
  };
}
export const messagingRealm = defineDatabaseRealm({
  name: 'zero-messaging', version: '3', tables: { ...MESSAGING_TABLES, ...MESSAGING_ATTACHMENT_TABLES,
    messaging_attachments: { ...MESSAGING_TABLES.messaging_attachments!, owner_kind: "TEXT NOT NULL DEFAULT 'user'" } },
  migrations: [{ version: '001', description: 'Canonical scoped conversations, messages, contacts, private attachments and durable delivery', safety: 'safe', up(database) {
    for (const [table, columns] of Object.entries(MESSAGING_TABLES)) database.run('CREATE TABLE IF NOT EXISTS ' + quoteSqlIdentifier(table) + ' (' + Object.entries(columns).map(([name, definition]) => quoteSqlIdentifier(name) + ' ' + definition).join(',') + ')');
    for (const sql of [
      'CREATE INDEX messaging_conversation_page ON messaging_conversations(scope_id,archived,public_updated_at DESC,id)',
      'CREATE INDEX messaging_member_directory ON messaging_members(scope_id,participant_id,active,conversation_id)',
      'CREATE INDEX messaging_member_conversation ON messaging_members(conversation_id,scope_id,active,joined_at,participant_id)',
      'CREATE UNIQUE INDEX messaging_internal_sequence ON messaging_messages(conversation_id,sequence)',
      'CREATE UNIQUE INDEX messaging_public_sequence ON messaging_messages(conversation_id,public_sequence)',
      'CREATE INDEX messaging_unread_public ON messaging_messages(conversation_id,visibility,public_sequence,deleted,author_id)',
      'CREATE INDEX messaging_unread_staff ON messaging_messages(conversation_id,sequence,deleted,author_id)',
      'CREATE UNIQUE INDEX messaging_reaction_member ON messaging_reactions(message_id,participant_id,emoji)',
      'CREATE INDEX messaging_reaction_count ON messaging_reactions(message_id,emoji,participant_id)',
      'CREATE INDEX messaging_contact_requester ON messaging_contacts(scope_id,requester_id,recipient_id)',
      'CREATE INDEX messaging_contact_recipient ON messaging_contacts(scope_id,recipient_id,requester_id)',
      'CREATE INDEX messaging_block_directory ON messaging_blocks(scope_id,participant_id,target_id)',
      'CREATE INDEX messaging_attachment_expiry ON messaging_attachments(state,expires_at,id)',
      'CREATE INDEX messaging_job_queue ON messaging_jobs(state,created_at,id)',
      'CREATE INDEX messaging_job_conversation ON messaging_jobs(conversation_id,kind,state)',
      'CREATE UNIQUE INDEX messaging_external_customer ON messaging_customers(scope_id,connection_id,external_id)',
      'CREATE INDEX messaging_session_expiry ON messaging_sessions(expires_at,id)',
    ]) database.run(sql);
    for (const [index, clause] of [['messaging_public_search', " AND visibility='conversation'"], ['messaging_staff_search', '']]) {
      database.run(`CREATE VIRTUAL TABLE ${index} USING fts5(text,content='messaging_messages',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2',prefix='2 3')`);
      const eligible = (prefix: string) => ` ${prefix}.deleted=0${clause.replace('visibility', prefix + '.visibility')}`;
      database.run(`CREATE TRIGGER ${index}_insert AFTER INSERT ON messaging_messages WHEN ${eligible('NEW')} BEGIN INSERT INTO ${index}(rowid,text) VALUES(NEW.rowid,NEW.text); END`);
      database.run(`CREATE TRIGGER ${index}_delete AFTER DELETE ON messaging_messages WHEN ${eligible('OLD')} BEGIN INSERT INTO ${index}(${index},rowid,text) VALUES('delete',OLD.rowid,OLD.text); END`);
      database.run(`CREATE TRIGGER ${index}_update_old AFTER UPDATE OF text,deleted,visibility ON messaging_messages WHEN ${eligible('OLD')} BEGIN INSERT INTO ${index}(${index},rowid,text) VALUES('delete',OLD.rowid,OLD.text); END`);
      database.run(`CREATE TRIGGER ${index}_update_new AFTER UPDATE OF text,deleted,visibility ON messaging_messages WHEN ${eligible('NEW')} BEGIN INSERT INTO ${index}(rowid,text) VALUES(NEW.rowid,NEW.text); END`);
    }
  } }, { version: '002', description: 'Bounded typed attachment reservations and expiry recovery', safety: 'safe', up(database) {
    database.run("ALTER TABLE messaging_attachments ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'user'");
    database.run('CREATE TABLE messaging_attachment_reservations (id TEXT PRIMARY KEY,ids_json TEXT NOT NULL)');
    database.run('CREATE INDEX messaging_attachment_scope_expiry ON messaging_attachments(scope_id,state,expires_at,id)');
  } }],
  commands: withMessagingCommitHints({
    'messaging.owner.bind': (context, input) => messagingCommand(context, () => {
      const ownerId = messagingId(messagingRecord(input, ['ownerId']).ownerId), prior = context.db.get('_messaging_owner', 'application');
      if (prior && prior.owner_id !== ownerId) messagingFail('MESSAGING_OWNER_INVALID');
      if (!prior) context.db.createStrict('_messaging_owner', { id: 'application', owner_id: ownerId }); return { bound: true };
    }),
    'messaging.conversation.create': createMessagingConversation, 'messaging.conversation.change': changeMessagingConversation,
    'messaging.conversation.read': markMessagingRead, 'messaging.conversation.owner': ownMessagingConversation,
    'messaging.contact': changeMessagingContact, 'messaging.message.send': sendMessagingMessage,
    'messaging.support.open': openMessagingSupport, 'messaging.support.claim': claimMessagingSupport,
    'messaging.message.change': changeMessagingMessage, 'messaging.message.react': reactMessagingMessage,
    'messaging.attachment.allocate': allocateMessagingAttachment, 'messaging.attachment.accept': acceptMessagingAttachment, 'messaging.attachment.retire': retireMessagingAttachment,
  }),
  queries: { 'messaging.conversation': query(readMessagingConversation), 'messaging.conversations': query(listMessagingConversations), 'messaging.message': query(readMessagingMessage), 'messaging.messages': query(listMessagingMessages), 'messaging.contacts': query(listMessagingContacts), 'messaging.support.queue': query(listMessagingSupportQueue), 'messaging.receipt': query(readMessagingReceipt), 'messaging.typing': query(readMessagingTypingMembership),
    'messaging.attachment': query(readMessagingAttachment), 'messaging.attachments.pending': query(pendingMessagingAttachments) },
});
