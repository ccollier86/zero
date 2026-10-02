/**
 * Shared parent/actor entrypoint.
 *
 * The actor branch must run before importing application configuration: actor
 * children load only their side-effect-free realm and never start HTTP.
 */

import { runDatabaseActorIfRequested } from '@zero/framework/server';
import { tenantDatabaseRealm } from '../db/tenant-realm';

const actorStarted = await runDatabaseActorIfRequested({
  realm: tenantDatabaseRealm,
});

if (!actorStarted) {
  const [{ createApp }, { default: config }] = await Promise.all([
    import('@zero/framework/server'),
    import('../zero.config'),
  ]);
  const app = await createApp(config);
  app.listen(config.port);
}
