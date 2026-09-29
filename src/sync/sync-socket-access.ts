/** Resolves one current, comparable Sync read-authorization snapshot. */

import type { ReactiveDB } from './reactive-db';
import { getReadableSyncTables, type SyncPolicy } from './sync-policy';
import type { PlatformObservabilityRuntime } from '../observability/types';
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
  readAuthorityFingerprint: string | null;
}

interface SyncSocketAccessOptions {
  db: ReactiveDB;
  policy: SyncPolicy;
  resourcePolicy?: SyncResourcePolicyAdapter;
  /** Trusted actor-backed app tables which are not gated by default-db shadow tables. */
  additionalTables?: Iterable<string>;
  observability?: PlatformObservabilityRuntime | null;
}

/** Re-evaluate table policy and resource policy against a live auth context. */
export async function resolveSyncSocketAccess(
  options: SyncSocketAccessOptions,
  authContext: SyncAuthContext | null,
): Promise<SyncSocketAccess> {
  const tableNames = new Set(
    options.db.getTableNames().filter((table) => !table.startsWith('_')),
  );
  for (const table of options.additionalTables ?? []) {
    if (!table.startsWith('_')) tableNames.add(table);
  }
  const tables = getReadableSyncTables(
    tableNames,
    authContext,
    options.policy,
    options.observability,
  );
  if (!options.resourcePolicy) {
    return {
      allowedTables: tables,
      rowFilters: new Map(),
      rowProjectors: new Map(),
      fingerprint: tableFingerprint(tables),
      readAuthorityFingerprint: null,
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
    readAuthorityFingerprint: access.readAuthorityFingerprint ?? null,
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
