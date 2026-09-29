/**
 * Composition-time validation and database resolution for the Sync plugin.
 *
 * These helpers validate static configuration before Elysia handlers are
 * installed. They do not own sockets, lifecycle cleanup, or runtime fanout.
 */

import {
  createReactiveDB,
  type ReactiveDB,
} from './reactive-db';
import type {
  SyncAuthConfig,
  SyncAuthContext,
  SyncPluginConfig,
} from './types';
import type { SyncTenantDataPlane } from './sync-tenant-data-plane';

export function resolveSyncDatabase(config: SyncPluginConfig): {
  db: ReactiveDB;
  owned: boolean;
} {
  if (!config.reactiveDB) {
    if (config.ownsReactiveDB !== undefined) {
      throw new Error(
        '[sync] ownsReactiveDB is valid only when reactiveDB is provided',
      );
    }
    return {
      db: createReactiveDB(config.db),
      owned: true,
    };
  }

  return {
    db: config.reactiveDB,
    owned: config.ownsReactiveDB ?? false,
  };
}

export function resolveReplicaChangePolling(
  config: SyncPluginConfig,
  db: ReactiveDB,
): { intervalMs: number } | null {
  if (config.replicaChangePolling === false) return null;
  if (config.replicaChangePolling) {
    const requestedInterval = config.replicaChangePolling.intervalMs ?? 250;
    if (!Number.isSafeInteger(requestedInterval) || requestedInterval < 1) {
      throw new Error(
        'ReactiveDB replica polling intervalMs must be a positive safe integer',
      );
    }
    return { intervalMs: Math.max(10, requestedInterval) };
  }
  return db.getSQLiteService()?.mode === 'file'
    ? { intervalMs: 250 }
    : null;
}

export function validateSyncCommitAuthority(
  auth: SyncAuthConfig | undefined,
  context: SyncAuthContext | null,
  tenancyMode: 'single' | 'multi',
): boolean {
  const verifier = auth?.getTokenVerifier() ?? null;
  try {
    // This runs after ReactiveDB has acquired its immediate transaction lock.
    // Fence anonymous/public mutations too: they still rely on this runtime's
    // installed tenancy and authorization profile.
    verifier?.assertCurrentProfile?.();
  } catch {
    return false;
  }
  if (!context) return tenancyMode === 'single';
  // Pre-boundary single-tenant JWTs intentionally finish their original short
  // TTL without a durable session handle. Preserve that narrow compatibility
  // path; multi-tenant authority is always session-bound and reaches this gate.
  if (!context.sessionKind) return tenancyMode === 'single';
  if (!verifier
    || typeof verifier.captureAuthContextAuthority !== 'function'
    || typeof verifier.resolveAuthContextAuthority !== 'function') {
    // Standalone/legacy verifier compatibility is single-tenant only. A
    // multi-tenant scope without a synchronous durable resolver cannot safely
    // cross a transaction boundary.
    return tenancyMode === 'single';
  }

  try {
    const reference = verifier.captureAuthContextAuthority(context);
    return Boolean(reference && verifier.resolveAuthContextAuthority(reference));
  } catch {
    return false;
  }
}

export function assertMultiTenantResourceClassification(
  config: SyncPluginConfig,
): void {
  if (config.tenancyMode !== 'multi') return;

  for (const table of Object.keys(config.tables)) {
    if (table.startsWith('_')) continue;
    const realm = config.resourcePolicy?.classifyManagedTableRealm?.(table) ?? null;
    if (realm === 'global' || realm === 'tenant') continue;
    throw new Error(
      `[sync] Multi-tenant table "${table}" must have an explicit global or tenant resource realm before Sync starts. ` +
      'Use defineResource({ realm: globalRealm() | tenantRealm(), ... }) and the resource Sync policy adapter.',
    );
  }

  for (const table of Object.keys(config.tables)) {
    if (table.startsWith('_')) continue;
    const exposure = config.resourcePolicy
      ?.classifyManagedTableExposure?.(table) ?? null;
    if (exposure === 'internal'
      || exposure === 'http'
      || exposure === 'sync'
      || exposure === 'all') continue;
    throw new Error(
      `[sync] Multi-tenant table "${table}" must have an explicit resource exposure before Sync starts. `
      + 'Use defineResource({ exposure: "internal" | "http" | "sync" | "all", ... }).',
    );
  }
}

export function assertTenantDataPlaneConfiguration(
  config: SyncPluginConfig,
): void {
  const actorTables = new Set(Object.keys(config.tenantDataPlane?.tables ?? {}));
  const classifier = config.resourcePolicy?.classifyManagedTableDataPlane;
  const expected = new Set<string>();
  if (classifier) {
    for (const table of Object.keys(config.tables)) {
      if (table.startsWith('_')) continue;
      const exposure = config.resourcePolicy
        ?.classifyManagedTableExposure?.(table) ?? null;
      if (classifier.call(config.resourcePolicy, table) === 'tenant'
        && (exposure === 'sync' || exposure === 'all')) expected.add(table);
    }
  }

  if (!config.tenantDataPlane) {
    if (expected.size > 0) {
      throw new Error(
        '[sync] Sync-exposed physical tenant resources require a tenant data plane.',
      );
    }
    return;
  }
  if (config.tenancyMode !== 'multi' || !config.auth?.required) {
    throw new Error(
      '[sync] Actor-backed tenant Sync requires multi-tenant, required authentication.',
    );
  }
  if (!classifier) {
    throw new Error(
      '[sync] Actor-backed tenant Sync requires trusted per-table data-plane classification.',
    );
  }
  if (typeof config.resourcePolicy?.validateReadAuthorityAtDelivery !== 'function') {
    throw new Error(
      '[sync] Actor-backed tenant Sync requires a synchronous comparable read-authority policy.',
    );
  }
  for (const table of expected) {
    if (!actorTables.has(table)) {
      throw new Error(
        `[sync] Physical tenant Sync table "${table}" is missing from the actor catalog.`,
      );
    }
  }
  for (const table of actorTables) {
    if (!expected.has(table)) {
      throw new Error(
        `[sync] Actor Sync table "${table}" is not a Sync-exposed physical tenant resource.`,
      );
    }
  }
}

export function wireUsesTenantDataPlane(
  raw: string | Record<string, unknown>,
  plane: SyncTenantDataPlane,
): boolean {
  let message: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      message = parsed;
    } catch {
      return false;
    }
  } else {
    message = raw;
  }
  if (message.type === 'sync.mutate') {
    return typeof message.table === 'string'
      && Object.hasOwn(plane.tables, message.table);
  }
  return message.type === 'sync.subscribe'
    && Array.isArray(message.tables)
    && message.tables.some((table) => (
      typeof table === 'string' && Object.hasOwn(plane.tables, table)
    ));
}

export function assertMutationValidatorMatchesTable(
  table: string,
  validator: NonNullable<SyncPluginConfig['mutationValidators']>[string],
  db: ReactiveDB,
): void {
  const primaryKey = db.getPrimaryKey(table);
  if (validator.primaryKey !== primaryKey) {
    throw new Error(
      `[sync] Mutation validator for table "${table}" declares primary key `
      + `"${validator.primaryKey}", but the SQL table uses "${primaryKey}".`,
    );
  }

  const columns = new Set(db.getColumns(table));
  for (const field of validator.fieldNames) {
    if (!columns.has(field)) {
      throw new Error(
        `[sync] Mutation validator for table "${table}" declares unknown field "${field}".`,
      );
    }
  }
}

export function assertActorMutationValidatorMatchesTable(
  table: string,
  validator: NonNullable<SyncPluginConfig['mutationValidators']>[string],
  actorTable: SyncTenantDataPlane['tables'][string],
): void {
  if (validator.primaryKey !== actorTable.primaryKey) {
    throw new Error(
      `[sync] Mutation validator for actor table "${table}" declares primary key `
      + `"${validator.primaryKey}", but the tenant realm uses "${actorTable.primaryKey}".`,
    );
  }
  const columns = new Set(actorTable.columns);
  for (const field of validator.fieldNames) {
    if (!columns.has(field)) {
      throw new Error(
        `[sync] Mutation validator for actor table "${table}" declares unknown field "${field}".`,
      );
    }
  }
}

export function tenantSyncAuthorityChanged(): Error & { code: string } {
  return Object.assign(new Error('Tenant Sync authority changed'), {
    code: 'DATABASE_AUTHORITY_CHANGED',
  });
}

export function describeSyncDatabaseMode(
  config: SyncPluginConfig['db'],
  db: ReactiveDB,
): 'ephemeral' | 'file' | 'hot' | 'injected' | 'platform' {
  const sqlite = db.getSQLiteService();
  if (sqlite) return sqlite.mode;

  if (config.database) return 'injected';
  if (config.mode === 'memory' || config.mode === ':memory:') return 'ephemeral';
  if (config.mode === 'ephemeral') return 'ephemeral';
  if (config.mode === 'file') return 'file';
  if (config.mode === 'hot') return 'hot';
  if (config.path || typeof config.mode === 'string') return 'file';
  return 'platform';
}
