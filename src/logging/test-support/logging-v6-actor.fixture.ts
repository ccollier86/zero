/** Actual subprocess writer/reader using the admitted former realm; synthetic retained files only. */
import { runDatabaseActorIfRequested } from '../../databases/database-actor-bootstrap';
import { loggingV6Realm } from './logging-v6-realm.fixture';

try { if (!await runDatabaseActorIfRequested({ realm: loggingV6Realm })) process.exitCode = 64; }
catch { process.exitCode = 70; }
