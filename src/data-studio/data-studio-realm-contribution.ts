/** Reusable Fabric realm contribution for the fixed Data Studio data plane. */

import { defineDatabaseRealmContribution } from '../databases/database-realm-contribution';
import { DATA_STUDIO_REALM_COMMANDS } from './data-studio-realm-commands';
import { DATA_STUDIO_REALM_QUERIES } from './data-studio-realm-queries';
import { DATA_STUDIO_TENANT_TABLES } from './data-studio-tenant-schema';

/**
 * Version must change whenever schema, validation, query, or command behavior
 * changes so Fabric actor fingerprints cannot silently mix implementations.
 */
export const DATA_STUDIO_REALM_CONTRIBUTION = defineDatabaseRealmContribution({
  name: 'zero-data-studio',
  version: '2',
  tables: DATA_STUDIO_TENANT_TABLES,
  queries: DATA_STUDIO_REALM_QUERIES,
  commands: DATA_STUDIO_REALM_COMMANDS,
});
