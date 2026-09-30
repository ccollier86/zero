/** Same-entry parent server and isolated Fabric actor bootstrap. */

import {
  OBS_CODES,
  createApp,
  emitPlatformCode,
  runDatabaseActorIfRequested,
} from '@zero/framework/server';

import { guardianFabricTenantRealm } from '../db/tenant-realm';
import config from '../zero.config';

if (!await runDatabaseActorIfRequested({ realm: guardianFabricTenantRealm })) {
  const app = await createApp(config);
  app.listen(config.port);
  emitPlatformCode(OBS_CODES.APP_LISTENING, {
    metadata: {
      url: config.app.publicUrl,
      port: config.port,
      dbMode: config.db.mode,
    },
  });
}
