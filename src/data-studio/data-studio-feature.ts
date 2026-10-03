/** One declarative bundle for installing the optional Data Studio feature. */

import {
  DATA_STUDIO_PERMISSION_REGISTRY,
  DATA_STUDIO_ROLE_FRAGMENTS,
} from './data-studio-access';
import { DATA_STUDIO_APP_TABLES } from './data-studio-app-tables';
import { DATA_STUDIO_CLIENT_TABLES } from './data-studio-client-tables';
import { DATA_STUDIO_REALM_CONTRIBUTION } from './data-studio-realm-contribution';
import { DATA_STUDIO_RESOURCES } from './data-studio-resources';
import { createDataStudioRouter } from './data-studio-router';
import { DATA_STUDIO_TENANT_TABLES } from './data-studio-tenant-schema';

/** Immutable fragments consumed by Zero configuration and browser setup. */
export interface DataStudioFeature {
  readonly appTables: typeof DATA_STUDIO_APP_TABLES;
  readonly tables: typeof DATA_STUDIO_TENANT_TABLES;
  readonly clientTables: typeof DATA_STUDIO_CLIENT_TABLES;
  readonly resources: typeof DATA_STUDIO_RESOURCES;
  readonly realmContribution: typeof DATA_STUDIO_REALM_CONTRIBUTION;
  readonly permissions: typeof DATA_STUDIO_PERMISSION_REGISTRY;
  readonly roleFragments: typeof DATA_STUDIO_ROLE_FRAGMENTS;
  readonly router: ReturnType<typeof createDataStudioRouter>;
}

/**
 * Return every fragment needed for an explicit installation.
 *
 * `createApp()` mounts the built-in router after it sees the complete table
 * and Resource fragments, so applications normally do not mount `router`
 * themselves. It remains available for standalone Elysia composition and
 * focused tests.
 */
export function createDataStudioFeature(): DataStudioFeature {
  return Object.freeze({
    appTables: DATA_STUDIO_APP_TABLES,
    tables: DATA_STUDIO_TENANT_TABLES,
    clientTables: DATA_STUDIO_CLIENT_TABLES,
    resources: DATA_STUDIO_RESOURCES,
    realmContribution: DATA_STUDIO_REALM_CONTRIBUTION,
    permissions: DATA_STUDIO_PERMISSION_REGISTRY,
    roleFragments: DATA_STUDIO_ROLE_FRAGMENTS,
    router: createDataStudioRouter(),
  });
}
