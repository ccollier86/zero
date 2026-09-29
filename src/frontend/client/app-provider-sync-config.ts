/** Pure browser-config projection used by AppProvider. */

import type {
  ClientTableDef,
  SyncDataPlaneName,
  SyncMode,
} from '../../sync/types';

export type ProviderTableInput = ClientTableDef | { clientTable: ClientTableDef };

export interface ResolvedProviderSyncConfig {
  tables: Record<string, ClientTableDef>;
  tableSyncPlanes?: Readonly<Record<string, SyncDataPlaneName>>;
}

/**
 * Project the app's local table definitions through the server catalog.
 * Known HTTP-only/internal resources are excluded; undeclared local tables
 * fail fast instead of opening a client with a divergent schema.
 */
export function resolveProviderSyncConfig(
  tables: Record<string, ProviderTableInput>,
  tableSyncModes: Record<string, SyncMode> | undefined,
  tableSyncPlanes: Record<string, SyncDataPlaneName> | undefined,
  managedTableNames: readonly string[] | undefined,
): Readonly<ResolvedProviderSyncConfig> {
  const resolved: Record<string, ClientTableDef> = {};
  const projectedPlanes: Record<string, SyncDataPlaneName> = {};
  const managed = new Set(managedTableNames ?? []);

  for (const [name, def] of Object.entries(tables)) {
    const plane = tableSyncPlanes?.[name];
    if (tableSyncPlanes !== undefined && plane === undefined) {
      if (managed.has(name)) continue;
      throw new Error(
        `[app] AppProvider table "${name}" is not declared by the running Zero server.`,
      );
    }
    const clientTable = hasClientTable(def) ? def.clientTable : def;
    const syncMode = tableSyncModes?.[name];
    resolved[name] = syncMode ? { ...clientTable, _sync: syncMode } : clientTable;
    if (plane) projectedPlanes[name] = plane;
  }

  return {
    tables: resolved,
    ...(tableSyncPlanes !== undefined
      ? { tableSyncPlanes: Object.freeze(projectedPlanes) }
      : {}),
  };
}

function hasClientTable(
  def: ProviderTableInput,
): def is { clientTable: ClientTableDef } {
  return typeof (def as { clientTable?: unknown }).clientTable === 'object'
    && (def as { clientTable?: unknown }).clientTable !== null;
}
