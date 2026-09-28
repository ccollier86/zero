/** Same-entry database actor fixture used by launch-boundary tests. */

import { runDatabaseActorIfRequested } from '../database-actor-bootstrap';
import { DatabaseError } from '../database-error';
import { databaseActorFixtureRealm } from './database-actor-realm';

if (process.env.ZERO_DATABASE_ACTOR_VERIFY_ENV === '1'
  && (process.env.ZERO_DATABASE_ACTOR_TEST_ALLOWED !== 'allowed'
    || process.env.ZERO_DATABASE_ACTOR_TEST_INHERITED_SECRET !== undefined)) {
  process.exitCode = 72;
} else {
  try {
    const acted = await runDatabaseActorIfRequested({
      realm: databaseActorFixtureRealm,
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
}
