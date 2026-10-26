/** Shared-entry blog actor admission. Invoked before app startup; imports one fixed side-effect-free realm. */
import { runDatabaseActorIfRequested, type RunDatabaseActorIfRequestedOptions } from '../databases/database-actor-bootstrap';
import { blogContentRealm } from './content-realm';
export const BLOG_ACTOR_FLAG = '--zero-blog-actor';
/** Returns false in an ordinary app process; never accepts arbitrary realms, paths or environment inheritance. */
export function runBlogActorIfRequested(options: Pick<RunDatabaseActorIfRequestedOptions, 'argv' | 'maxInFlight'> = {}): Promise<boolean> {
  return runDatabaseActorIfRequested({ ...options, realm: blogContentRealm, actorFlag: BLOG_ACTOR_FLAG });
}
