import type {
  ClientTableDef,
  SyncDataPlaneName,
} from '../types';

export const DEFAULT_SYNC_DATA_PLANE: SyncDataPlaneName = 'default';
export const SYNC_DATA_PLANES = [
  'default',
  'system',
  'tenant',
] as const satisfies readonly SyncDataPlaneName[];

/**
 * Client-side routing information generated from the server's trusted Sync
 * table catalog. The server remains authoritative and independently validates
 * every subscription and mutation.
 */
export interface SyncPlaneCursorState {
  lastSeq: number;
  epoch: string | null;
  scope: string | null;
}

export interface SyncClientDataPlaneTopology {
  /** Exact, validated routing entry for every configured client table. */
  readonly tablePlanes: Readonly<Record<string, SyncDataPlaneName>>;
  /** Non-empty planes from which this client must receive a baseline. */
  readonly expectedPlanes: ReadonlySet<SyncDataPlaneName>;
  /** Whether outgoing mutations should assert the generated table route. */
  readonly assertMutationPlanes: boolean;
}

/** Resolve and validate the generated browser table-routing catalog. */
export function resolveSyncClientDataPlaneTopology(
  tables: Readonly<Record<string, ClientTableDef>>,
  configured?: Readonly<Record<string, SyncDataPlaneName>>,
): SyncClientDataPlaneTopology {
  const tableNames = Object.keys(tables);
  if (configured === undefined) {
    const tablePlanes = Object.fromEntries(
      tableNames.map((table) => [table, DEFAULT_SYNC_DATA_PLANE]),
    ) as Record<string, SyncDataPlaneName>;
    return {
      tablePlanes: Object.freeze(tablePlanes),
      expectedPlanes: new Set(
        tableNames.length === 0 ? [] : [DEFAULT_SYNC_DATA_PLANE],
      ),
      assertMutationPlanes: false,
    };
  }

  const configuredNames = Object.keys(configured);
  const unknown = configuredNames.filter((table) => !Object.hasOwn(tables, table));
  if (unknown.length > 0) {
    throw new Error(
      `[sync] tableSyncPlanes contains unknown table${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
    );
  }

  const missing = tableNames.filter((table) => !Object.hasOwn(configured, table));
  if (missing.length > 0) {
    throw new Error(
      `[sync] tableSyncPlanes is missing table${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
    );
  }

  const tablePlanes = Object.create(null) as Record<string, SyncDataPlaneName>;
  const expectedPlanes = new Set<SyncDataPlaneName>();
  for (const table of tableNames) {
    const plane = configured[table];
    if (!isSyncDataPlaneName(plane)) {
      throw new Error(
        `[sync] tableSyncPlanes.${table} must be "default", "system", or "tenant".`,
      );
    }
    tablePlanes[table] = plane;
    expectedPlanes.add(plane);
  }

  return {
    tablePlanes: Object.freeze(tablePlanes),
    expectedPlanes,
    assertMutationPlanes: true,
  };
}

export function syncDataPlaneForTable(
  tablePlanes: Readonly<Record<string, SyncDataPlaneName>>,
  table: string,
): SyncDataPlaneName | undefined {
  return Object.hasOwn(tablePlanes, table) ? tablePlanes[table] : undefined;
}

export function tablesInSyncDataPlane(
  tablePlanes: Readonly<Record<string, SyncDataPlaneName>>,
  plane: SyncDataPlaneName,
): Set<string> {
  return new Set(
    Object.keys(tablePlanes).filter((table) => tablePlanes[table] === plane),
  );
}

export function isSyncDataPlaneName(value: unknown): value is SyncDataPlaneName {
  return value === 'default' || value === 'system' || value === 'tenant';
}

export function messageSyncDataPlane(
  message: { plane?: SyncDataPlaneName },
): SyncDataPlaneName | null {
  if (message.plane === undefined) return DEFAULT_SYNC_DATA_PLANE;
  return isSyncDataPlaneName(message.plane) ? message.plane : null;
}
