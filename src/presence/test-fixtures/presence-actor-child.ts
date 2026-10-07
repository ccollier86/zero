/** Real Bun IPC fixture; production actor and authority implementation, no live application. */
import { runDatabaseActorIfRequested, runDatabaseActorSubprocess } from '../../databases/database-actor-bootstrap';
import { presenceActorRealm, presenceActorRealmWithoutPresence } from './presence-actor-realm';
const realm = process.env.ZERO_TEST_PRESENCE_REALM_WITHOUT_CONTRIBUTION === 'true'
  ? presenceActorRealmWithoutPresence : presenceActorRealm;
if (!await runDatabaseActorIfRequested({ realm })) {
  const role = process.argv[2], slot = Number(process.argv[3]);
  if ((role !== 'writer' && role !== 'reader') || !Number.isSafeInteger(slot) || slot < 0) process.exitCode = 64;
  else await runDatabaseActorSubprocess({ role, slot, loadRealm: () => realm });
}
