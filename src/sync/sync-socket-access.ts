/** Resolves one current, comparable Sync read-authorization snapshot. */

import type { ReactiveDB } from './reactive-db';
import { getReadableSyncTables, type SyncPolicy } from './sync-policy';
import type {
  SyncAuthContext,
  SyncResourcePolicyAdapter,
  SyncRowFilter,
  SyncRowProjector,
} from './types';

export interface SyncSocketAccess {
  allowedTables: Set<string>;
  rowFilters: Map<string, SyncRowFilter>;
  rowProjectors: Map<string, SyncRowProjector>;
  fingerprint: string | null;
}

interface SyncSocketAccessOptions {
  db: ReactiveDB;
  policy: SyncPolicy;
  resourcePolicy?: SyncResourcePolicyAdapter;
}

/** Re-evaluate table policy and resource policy against a live auth context. */
export async function resolveSyncSocketAccess(
  options: SyncSocketAccessOptions,
  authContext: SyncAuthContext | null,
): Promise<SyncSocketAccess> {
  const tables = getReadableSyncTables(
    options.db.getTableNames().filter((table) => !table.startsWith('_')),
    authContext,
    options.policy,
  );
  if (!options.resourcePolicy) {
    return {
      allowedTables: tables,
      rowFilters: new Map(),
      rowProjectors: new Map(),
      fingerprint: tableFingerprint(tables),
    };
  }

  const access = await options.resourcePolicy.resolveTableAccess({
    tableNames: tables,
    authContext,
  });
  const policy = access.policyFingerprint;
  return {
    allowedTables: access.readableTables,
    rowFilters: access.rowFilters,
    rowProjectors: access.rowProjectors ?? new Map(),
    fingerprint: policy === undefined && (
      access.rowFilters.size > 0
      || (access.rowProjectors?.size ?? 0) > 0
    )
      ? null
      : JSON.stringify([
        [...access.readableTables].sort(),
        [...access.rowFilters.keys()].sort(),
        [...(access.rowProjectors?.keys() ?? [])].sort(),
        policy ?? null,
      ]),
  };
}

function tableFingerprint(tables: Iterable<string>): string {
  return JSON.stringify([[...tables].sort(), [], [], null]);
}
