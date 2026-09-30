/** Isolated actor entrypoint for the real Guardian + Fabric proof realm. */

import { guardianFabricTenantRealm } from '../../../examples/guardian-fabric-proof/db/tenant-realm';
import { runDatabaseActorIfRequested } from '../database-actor-bootstrap';
import { DatabaseError } from '../database-error';

try {
  const acted = await runDatabaseActorIfRequested({
    realm: guardianFabricTenantRealm,
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
