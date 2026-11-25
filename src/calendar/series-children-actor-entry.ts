/** Matching fixed private22 actor only. No app, dotenv or provider bootstrap. */
import { runDatabaseActorIfRequested } from '../databases/database-actor-bootstrap';
import { calendarSeriesChildrenRealm } from './series-children-realm';

export const CALENDAR_SERIES_CHILDREN_ACTOR_FLAG = '--zero-calendar-series-children-actor';
if (import.meta.main) {
  try {
    if (!await runDatabaseActorIfRequested({ realm: calendarSeriesChildrenRealm, actorFlag: CALENDAR_SERIES_CHILDREN_ACTOR_FLAG })) process.exitCode = 64;
  } catch { process.exitCode = 70; }
}
