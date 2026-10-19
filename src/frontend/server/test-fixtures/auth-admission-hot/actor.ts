import { runDatabaseActorIfRequested } from '../../../../databases/database-actor-bootstrap';
import { realm } from './realm';
process.exitCode = await runDatabaseActorIfRequested({ realm }) ? 0 : 65;
