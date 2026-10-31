/** Synthetic retained v9 schema using the frozen published migration functions. No runtime ledger edits or production imports. */
import { defineDatabaseRealm } from '../../databases/database-realm';
import { messagingRealm } from '../realm';
export const prePortalMessagingRealm = defineDatabaseRealm({
  name: messagingRealm.name, version: '9', tables: messagingRealm.tables,
  migrations: messagingRealm.migrations.filter(value => value.version <= '009'),
  commands: messagingRealm.commands, queries: messagingRealm.queries,
});
