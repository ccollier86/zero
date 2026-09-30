/**
 * sync.plugin.ts
 *
 * Owns the Elysia lifecycle and WebSocket transport for ReactiveDB sync. This
 * file initializes sync-owned runtime state and routes wire-protocol messages;
 * persistence details live in ReactiveDB, and token verification is delegated
 * through the sync auth contract.
 */

import { Elysia, t } from 'elysia';
import type { ReactiveDB } from './reactive-db';
import type { EphemeralStateManager } from './ephemeral-manager';
import { createSyncSocketAuthRuntime } from './sync-socket-auth';
import { allowAllSyncPolicy } from './sync-policy';
import { SyncMutationReceiptStore } from './sync-mutation-receipt-store';
import {
  emitPlatformCode,
  emitPlatformCodeTo,
} from '../observability/sink';
import { OBS_CODES } from '../observability/codes';
import {
  clearPlatformSQLiteService,
  setPlatformSQLiteService,
} from '../persistence';
import type {
  ReactiveDBPlatformCodeEmitter,
  SyncPluginConfig,
} from './types';
import { SYNC_TABLE_MUTATION_VALIDATOR } from './types';
import { SYNC_OUTGOING_BACKPRESSURE_LIMIT } from './types';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import {
  ZERO_OBSERVABILITY_RUNTIME,
  ZERO_SQLITE_SERVICE,
  ZERO_SYNC_DB,
} from '../runtime/service-keys';
import {
  assertActorMutationValidatorMatchesTable,
  assertMultiTenantResourceClassification,
  assertMutationValidatorMatchesTable,
  assertTenantDataPlaneConfiguration,
  describeSyncDatabaseMode,
  resolveReplicaChangePolling,
  resolveReplicaChangePollingOption,
  resolveSyncDatabase,
  invalidSyncConfiguration,
} from './sync-plugin-config';
import {
  createSyncCodeReporter,
  createSyncPluginLifecycle,
  isSyncPromiseLike,
  raiseSyncLifecycleCleanupFailures,
} from './sync-plugin-lifecycle';
import {
  createSyncPluginRuntimeState,
  type SyncPluginRuntimeState,
} from './sync-plugin-runtime-state';
import {
  createSyncSocketCollections,
  createSyncSocketController,
} from './sync-socket-controller';

/**
 * Compatibility registry for the legacy no-argument getters. Runtime code
 * never reads this registry; every plugin handler closes over its own runtime.
 */
const compatibilityRuntimes = new CompatibilityProviderRegistry<SyncPluginRuntimeState>(
  'Sync runtime',
);

/**
 * Get the ReactiveDB instance. Returns null if the sync plugin hasn't been
 * created. createSyncPlugin initializes it during plugin composition so later
 * plugins can define tables against the shared DB before listen().
 */
export function getSyncDB(): ReactiveDB | null {
  return compatibilityRuntimes.get()?.db ?? null;
}

/**
 * Get the EphemeralStateManager instance. Returns null if the sync plugin hasn't started.
 */
export function getEphemeralManager(): EphemeralStateManager | null {
  return compatibilityRuntimes.get()?.ephemeralManager ?? null;
}

/**
 * Create the sync engine Elysia plugin.
 *
 * - Uses an injected ReactiveDB or creates one during plugin composition
 * - Defines app tables from config before dependent plugins compose
 * - Registers the ordered onChange listener used for direct socket delivery
 * - Exposes WS endpoint at /sync
 * - Derives `syncDB` into global Elysia context for all routes
 */
export function createSyncPlugin(config: SyncPluginConfig) {
  assertMultiTenantResourceClassification(config);
  assertTenantDataPlaneConfiguration(config);
  const observability = config.runtime?.require(ZERO_OBSERVABILITY_RUNTIME)
    ?? config.db.observability
    ?? null;
  const emitCode: ReactiveDBPlatformCodeEmitter = observability
    ? (definition, options) => emitPlatformCodeTo(
      observability,
      definition,
      options,
    )
    : config.db.emitCode ?? emitPlatformCode;
  const reportSyncCode = createSyncCodeReporter(emitCode);
  const policy = config.policy ?? allowAllSyncPolicy;
  const databaseRuntime = resolveSyncDatabase({
    ...config,
    db: {
      ...config.db,
      observability,
      emitCode,
    },
  });
  const db = databaseRuntime.db;
  const stateDB = config.stateDB ?? db;
  const systemDB = config.systemDataPlane?.db ?? null;
  const systemTables = new Set(
    systemDataPlaneTableNames(config.systemDataPlane?.tables),
  );
  if (systemDB === db) {
    throw invalidSyncConfiguration(
      '[sync] The system and application Sync planes require distinct ReactiveDB runtimes.',
      'system-application-runtime-alias',
    );
  }
  if (stateDB !== db && systemDB && stateDB !== systemDB) {
    throw invalidSyncConfiguration(
      '[sync] A separate State Sync database must use the configured system data-plane runtime.',
      'state-system-runtime-mismatch',
    );
  }
  for (const table of systemTables) {
    if (Object.hasOwn(config.tables, table)
      || Object.hasOwn(config.tenantDataPlane?.tables ?? {}, table)) {
      throw invalidSyncConfiguration(
        `[sync] Table "${table}" is assigned to more than one durable data plane.`,
        'duplicate-table-plane',
      );
    }
  }
  const cleanupOnCompositionFailure: Array<() => void> = [];
  if (databaseRuntime.owned) {
    cleanupOnCompositionFailure.push(() => db.dispose());
  }

  try {
  const databaseCreated = config.onDatabaseCreated?.(db);
  if (isSyncPromiseLike(databaseCreated)) {
    void Promise.resolve(databaseCreated).catch(() => {});
    throw invalidSyncConfiguration(
      '[sync] onDatabaseCreated must be synchronous.',
      'async-database-created-hook',
    );
  }
  const sqlite = db.getSQLiteService();
  const databaseMode = describeSyncDatabaseMode(config.db, db);
  const replicaPolling = resolveReplicaChangePolling(config, db);
  const secondaryDB = systemDB
    ?? (config.stateSync && stateDB !== db ? stateDB : null);
  const secondaryReplicaPolling = secondaryDB
    ? resolveReplicaChangePollingOption(
        config.systemDataPlane?.replicaChangePolling
          ?? config.replicaChangePolling,
        secondaryDB,
      )
    : null;
  const runtime = createSyncPluginRuntimeState(db);
  const sockets = createSyncSocketCollections();
  const compatibilityOwner = {};
  const compatibilityRegistration = compatibilityRuntimes.register(
    compatibilityOwner,
    () => runtime,
  );
  cleanupOnCompositionFailure.push(() => compatibilityRegistration.unregister());
  let socketController!: ReturnType<typeof createSyncSocketController>;
  const socketAuth = createSyncSocketAuthRuntime({
    auth: config.auth,
    db,
    policy,
    resourcePolicy: config.resourcePolicy,
    additionalTables: [
      ...Object.keys(config.tenantDataPlane?.tables ?? {}),
      ...systemDataPlaneTableNames(config.systemDataPlane?.tables),
    ],
    observability,
    activeSockets: sockets.activeSockets,
    requireDurableAuthority: config.tenancyMode === 'multi' && Boolean(config.auth),
    requireComparableReadAuthority: Boolean(config.tenantDataPlane),
    onAuthorityInvalidated: () => {
      runtime.ephemeralChannel?.requestRevalidation('authority-revision');
    },
    onRevalidationFailure(error, trigger) {
      reportSyncCode(OBS_CODES.SYNC_AUTH_REVALIDATION_FAILED, {
        error,
        metadata: { channel: 'socket', trigger },
      });
    },
    onSocketInvalidated(socket) {
      socketController.release(socket);
    },
  });
  cleanupOnCompositionFailure.push(() => socketAuth.dispose());

  const mutationValidators = { ...config.mutationValidators };
  for (const [name, schema] of Object.entries(config.tables)) {
    const validator = config.mutationValidators?.[name]
      ?? schema[SYNC_TABLE_MUTATION_VALIDATOR];
    const actorTable = config.tenantDataPlane?.tables[name];
    const tenantOwned = config.resourcePolicy
      ?.classifyManagedTableDataPlane?.(name) === 'tenant';
    if (tenantOwned) {
      if (actorTable && validator) {
        assertActorMutationValidatorMatchesTable(name, validator, actorTable);
        mutationValidators[name] = validator;
      }
      // Every physical tenant table belongs exclusively to the actor realm.
      // HTTP/internal tables are intentionally absent from the Sync wire
      // catalog, but must still never acquire a default-database shadow.
      continue;
    }

    db.defineTable(name, schema);
    if (!validator) continue;

    assertMutationValidatorMatchesTable(name, validator, db);
    mutationValidators[name] = validator;
  }
  const mutationReceipts = new SyncMutationReceiptStore(db);
  socketController = createSyncSocketController({
    config,
    db,
    stateDB,
    systemTables,
    observability,
    runtime,
    policy,
    mutationReceipts,
    mutationValidators,
    socketAuth,
    sockets,
    reportSyncCode,
  });
  const lifecycle = createSyncPluginLifecycle({
    config,
    runtime,
    db,
    stateDB,
    systemDB,
    secondaryDB,
    systemTables,
    replicaPolling,
    secondaryReplicaPolling,
    socketAuth,
    sockets,
    socketController,
    sqlite,
    ownsDatabase: databaseRuntime.owned,
    databaseMode,
    unregisterCompatibilityRuntime: () => compatibilityRegistration.unregister(),
    reportSyncCode,
  });

  if (config.runtime) {
    config.runtime.set(ZERO_SYNC_DB, db);
    cleanupOnCompositionFailure.push(() => config.runtime?.clear(ZERO_SYNC_DB, db));
    if (sqlite) {
      config.runtime.set(ZERO_SQLITE_SERVICE, sqlite);
      cleanupOnCompositionFailure.push(
        () => config.runtime?.clear(ZERO_SQLITE_SERVICE, sqlite),
      );
    }
    const removeRuntimeCleanup = config.runtime.addCleanup(() => {
      raiseSyncLifecycleCleanupFailures(
        lifecycle.teardown(),
        '[sync] Runtime cleanup failed.',
      );
    });
    lifecycle.setRuntimeCleanupRemoval(removeRuntimeCleanup);
    cleanupOnCompositionFailure.push(removeRuntimeCleanup);
  }
  if (sqlite) {
    setPlatformSQLiteService(sqlite);
    cleanupOnCompositionFailure.push(() => clearPlatformSQLiteService(sqlite));
  }

  const plugin = new Elysia({ name: 'sync' })

    // ─── Lifecycle ──────────────────────────────────────
    .onStart((context) => lifecycle.start(context))

    .onStop(() => lifecycle.stop())

    // ─── Derive: expose syncDB globally ─────────────────
    .derive({ as: 'global' }, () => ({
      syncDB: db,
    }))

    // ─── WebSocket handler at /sync ─────────────────────
    .ws('/sync', {
      // Kept in the schema only for the explicit, temporary compatibility flag.
      query: t.Object({
        token: t.Optional(t.String()),
      }),

      // Bun WebSocket config
      idleTimeout: 120,
      sendPings: true,
      maxPayloadLength: 1_048_576, // 1MB
      backpressureLimit: SYNC_OUTGOING_BACKPRESSURE_LIMIT,
      closeOnBackpressureLimit: true,
      publishToSelf: true,
      perMessageDeflate: false,

      open: (socket) => socketController.open(socket),
      message: (socket, message) => socketController.message(socket, message),
      close: (socket) => socketController.close(socket),
      drain: (socket) => socketController.drain(socket),
    });

  cleanupOnCompositionFailure.length = 0;
  return plugin;
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    for (const cleanup of cleanupOnCompositionFailure.reverse()) {
      try {
        cleanup();
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        error instanceof Error
          ? error.message
          : '[sync] Plugin composition failed and cleanup also failed.',
      );
    }
    throw error;
  }
}

function systemDataPlaneTableNames(
  tables: readonly string[] | Readonly<Record<string, unknown>> | undefined,
): string[] {
  if (!tables) return [];
  return Array.isArray(tables)
    ? tables.filter((table): table is string => typeof table === 'string')
    : Object.keys(tables);
}
