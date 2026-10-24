/** Same-entry real Fabric actor for synthetic logging integration tests. Never boots an app. */
import { runDatabaseActorIfRequested } from '../../databases/database-actor-bootstrap';
import { loggingRealm } from '../logging-realm';

try { if (!await runDatabaseActorIfRequested({ realm: loggingRealm })) process.exitCode = 64; }
catch { process.exitCode = 70; }
