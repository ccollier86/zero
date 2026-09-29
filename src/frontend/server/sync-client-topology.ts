/**
 * Build the browser's server-authoritative application-table Sync catalog.
 *
 * Framework-owned client tables are deliberately absent: the high-level SDK
 * owns those definitions and pins them to the default plane. Registered
 * resources without Sync exposure are also absent so AppProvider cannot
 * accidentally subscribe or mutate an HTTP-only/internal physical table.
 */

import type { RegisteredResourceDefinition, ResourceRegistry } from '../../resources';
import type { SyncDataPlaneName } from '../../sync/types';

export function resolveBrowserSyncTablePlanes(
  tableNames: Iterable<string>,
  registry: Pick<ResourceRegistry, 'getByTable'>,
): Readonly<Record<string, SyncDataPlaneName>> {
  const resolved: Record<string, SyncDataPlaneName> = Object.create(null);

  for (const table of [...tableNames].sort(compareText)) {
    const resource = registry.getByTable(table);
    if (resource && !resource.exposure.sync) continue;
    resolved[table] = isPhysicalTenantResource(resource) ? 'tenant' : 'default';
  }

  return Object.freeze(resolved);
}

function isPhysicalTenantResource(
  resource: RegisteredResourceDefinition | null,
): boolean {
  return resource?.storage.kind === 'tenant'
    && resource.storage.isolation === 'tenant-database';
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
