/** Dedicated shared-entry/compiled actor bootstrap. Never starts the app or accepts a caller-selected realm. */
import { runDatabaseActorIfRequested, type RunDatabaseActorIfRequestedOptions } from '../databases/database-actor-bootstrap';
import { loggingRealm } from './logging-realm';
import { LOGGING_ACTOR_FLAG } from './logging-actor-contract';
import { runLoggingDeliveryIfRequested } from './logging-delivery-child';

/** Invoke before ordinary app startup when an explicit source/compiled launch shares the app executable. */
export async function runLoggingActorIfRequested(options: Pick<RunDatabaseActorIfRequestedOptions, 'argv' | 'maxInFlight'> = {}): Promise<boolean> {
  if (await runLoggingDeliveryIfRequested(options.argv)) return true;
  return runDatabaseActorIfRequested({ ...options, realm: loggingRealm, actorFlag: LOGGING_ACTOR_FLAG });
}
