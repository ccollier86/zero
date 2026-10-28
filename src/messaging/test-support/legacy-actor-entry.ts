/** Test-only old declared shape in a real isolated Fabric actor. Never imports app configuration. */
import { runDatabaseActorIfRequested } from '../../databases/database-actor-bootstrap';
import { legacyMessagingRealm } from './legacy-realm';
import { MESSAGING_ACTOR_FLAG } from '../actor-bootstrap';
if (!await runDatabaseActorIfRequested({ realm: legacyMessagingRealm, actorFlag: MESSAGING_ACTOR_FLAG })) process.exit(64);
