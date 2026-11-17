/** Dedicated private calendar actor: no app, configuration, dotenv or provider boot. */
import { runDatabaseActorIfRequested } from '../databases/database-actor-bootstrap';
import { calendarRealm } from './realm';

export const CALENDAR_ACTOR_FLAG = '--zero-calendar-actor';
if (import.meta.main) {
  try {
    if (!await runDatabaseActorIfRequested({ realm: calendarRealm, actorFlag: CALENDAR_ACTOR_FLAG })) process.exitCode = 64;
  } catch { process.exitCode = 70; }
}
