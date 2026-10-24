/** Dedicated logging child entry. Never starts an app, inherits credentials, or accepts another realm. */
import { runDatabaseActorIfRequested } from '../databases/database-actor-bootstrap';
import { loggingRealm } from './logging-realm';

try {
  if (!await runDatabaseActorIfRequested({ realm: loggingRealm })) process.exitCode = 64;
} catch {
  // The parent receives a safe protocol/startup failure; do not print paths or event bodies.
  process.exitCode = 70;
}
