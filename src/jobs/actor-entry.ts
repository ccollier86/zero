/** Dedicated private jobs actor entry. Must not load configuration, dotenv or the main application. */
import { runDatabaseActorIfRequested } from '../databases/database-actor-bootstrap';
import { jobsRealm } from './realm';

export const JOBS_ACTOR_FLAG = '--zero-jobs-actor';
if (import.meta.main) {
  try {
    const started = await runDatabaseActorIfRequested({ realm: jobsRealm, actorFlag: JOBS_ACTOR_FLAG });
    if (!started) process.exitCode = 64;
  } catch { process.exitCode = 70; }
}
