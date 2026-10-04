/** Same-entry subprocess launcher for the automation-enabled Fabric fixture. */

import { runDatabaseActorIfRequested } from '../database-actor-bootstrap';
import { DatabaseError } from '../database-error';
import { databaseAutomationActorFixtureRealm } from './database-automation-actor-realm';

try {
  const acted = await runDatabaseActorIfRequested({
    realm: databaseAutomationActorFixtureRealm,
  });
  process.exitCode = acted ? 0 : 65;
} catch (error) {
  process.exitCode = error instanceof DatabaseError
    ? error.code === 'DATABASE_CONFIG_INVALID'
      ? 64
      : error.code === 'DATABASE_EXECUTOR_START_FAILED'
        ? 70
        : 71
    : 71;
}
