/** Startup compatibility fences between resource exposure and Sync loading. */

import type { ResourceRegistry } from '../../resources';
import type { ResolvedConfig } from './types';

/**
 * Lazy Sync hydration uses `/api/data`. A sync-only resource deliberately
 * denies that HTTP surface, so it must be guaranteed to remain full-sync.
 */
export function assertResourceExposureLoadingCompatibility(
  registry: ResourceRegistry,
  config: ResolvedConfig,
  tenantDatabaseTables?: ReadonlySet<string>,
): void {
  for (const resource of registry.list()) {
    if (resource.exposure.kind !== 'sync') continue;
    const mode = config.declaredSyncModes.get(resource.table)
      ?? config.syncDefaults.defaultMode;
    const tableDefault = config.syncDefaults.tables.get(resource.table);
    // Physical tenant tables have no authoritative default-database row count,
    // so their `auto` mode is always resolved to lazy. Keep this startup fence
    // aligned with resolveTenantDatabaseTableMode(): autoLazy.action only
    // controls shared/default tables and cannot make physical auto full-sync.
    const autoCanResolveLazy = tenantDatabaseTables?.has(resource.table)
      || (tableDefault?.action ?? config.syncDefaults.action) === 'lazy';
    if (mode !== 'lazy' && !(mode === 'auto' && autoCanResolveLazy)) continue;

    throw new Error(
      `[resources] Sync-only resource "${resource.name}" cannot use ${mode} loading because lazy Sync hydration requires /api/data, which exposure: "sync" denies. `
      + 'Use exposure: "all" or configure this table for guaranteed full Sync.',
    );
  }
}
