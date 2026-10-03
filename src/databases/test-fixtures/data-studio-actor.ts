/** Real source-launched Fabric actor for the Data Studio full-app proof. */

import { runDatabaseActorIfRequested } from '../database-actor-bootstrap';
import { DatabaseError } from '../database-error';
import { dataStudioActorFixtureRealm } from './data-studio-actor-realm';

try {
  const acted = await runDatabaseActorIfRequested({
    realm: dataStudioActorFixtureRealm,
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
