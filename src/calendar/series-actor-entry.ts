/** Fixed isolated series actor. Never import an application's entry or dotenv. */
import { runDatabaseActorIfRequested } from '../databases/database-actor-bootstrap';
import { calendarSeriesMaterializationRealm } from './series-materialization-realm';

export const CALENDAR_SERIES_ACTOR_FLAG = '--zero-calendar-series-actor';
if (import.meta.main) {
  try {
    if (!await runDatabaseActorIfRequested({ realm: calendarSeriesMaterializationRealm, actorFlag: CALENDAR_SERIES_ACTOR_FLAG })) process.exitCode = 64;
  } catch { process.exitCode = 70; }
}
