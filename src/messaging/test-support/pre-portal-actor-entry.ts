/** Disposable retained v9 actor. It never starts the main app or imports application configuration. */
import { runDatabaseActorIfRequested } from '../../databases/database-actor-bootstrap';
import { prePortalMessagingRealm } from './pre-portal-realm';
import { MESSAGING_ACTOR_FLAG } from '../actor-bootstrap';
if (!await runDatabaseActorIfRequested({ realm: prePortalMessagingRealm, actorFlag: MESSAGING_ACTOR_FLAG })) process.exit(64);
