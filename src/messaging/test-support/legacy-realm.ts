/** Synthetic retained-v7 shape. Existing migration functions are reused verbatim, never rewritten or bypassed. Test-only, not a migration API. */
import { defineDatabaseRealm } from '../../databases/database-realm';
import { messagingRealm } from '../realm';
const tables = Object.fromEntries(Object.entries(messagingRealm.tables).filter(([name]) => name !== 'messaging_visitor_budgets').map(([name, columns]) => [name, { ...columns }]));
for (const key of ['entry_id', 'policy_hash', 'write_window', 'write_count', 'message_count']) delete tables.messaging_sessions![key];
for (const key of ['support_entry_id', 'visitor_session_id']) delete tables.messaging_conversations![key];
export const legacyMessagingRealm = defineDatabaseRealm({ name: messagingRealm.name, version: '7', tables,
  migrations: messagingRealm.migrations.filter(value => value.version <= '007'),
  commands: Object.fromEntries(Object.entries(messagingRealm.commands).filter(([name]) => !name.startsWith('messaging.visitor.') && name !== 'messaging.job.handoff')),
  queries: Object.fromEntries(Object.entries(messagingRealm.queries).filter(([name]) => name !== 'messaging.visitor.session')),
});
