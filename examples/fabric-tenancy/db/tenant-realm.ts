/**
 * Side-effect-free realm imported independently by every database actor.
 * Keep environment reads and application startup outside this module.
 */

import { defineDatabaseRealm } from '@zero/framework/server';
import { tenantServerTables } from './schema';

export const tenantDatabaseRealm = defineDatabaseRealm({
  name: 'fabric-tenancy-example',
  version: '1',
  tables: tenantServerTables,
});
