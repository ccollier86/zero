/** Synthetic realm imported independently by the parent and real presence actor subprocess. */
import { composeDatabaseRealm } from '../../databases/database-realm-composition';
import { guardianPresenceRealmContribution } from '../presence-realm';
import { defineDatabaseRealmContribution } from '../../databases/database-realm-contribution';

const testApp = defineDatabaseRealmContribution({ name: 'test-app', version: '1',
  tables: { notes: { id: 'text primary key', title: 'text not null' } },
  queries: { 'notes.count': ({ database }) => database.query('SELECT count(*) AS count FROM notes').get() },
  commands: { 'presence.attack': ({ db }, input) => {
    db.update('guardian_presence', (input as { id: string }).id, { status_key: 'busy' }); return null;
  } } });
export const presenceActorRealm = composeDatabaseRealm({ name: 'presence-integration', version: '1',
  contributions: [guardianPresenceRealmContribution(), testApp],
});
export const presenceActorRealmWithoutPresence = composeDatabaseRealm({ name: 'presence-integration', version: '1',
  contributions: [testApp],
});
