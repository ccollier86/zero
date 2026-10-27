/** Fixed shared-entry admission for isolated messaging actors; never loads application configuration. */
import { runDatabaseActorIfRequested, type RunDatabaseActorIfRequestedOptions } from '../databases/database-actor-bootstrap';
import { messagingRealm } from './realm';
export const MESSAGING_ACTOR_FLAG = '--zero-messaging-actor';
export function runMessagingActorIfRequested(options: Pick<RunDatabaseActorIfRequestedOptions, 'argv' | 'maxInFlight'> = {}): Promise<boolean> {
  return runDatabaseActorIfRequested({ ...options, realm: messagingRealm, actorFlag: MESSAGING_ACTOR_FLAG });
}
