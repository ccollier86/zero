/**
 * platform-doctor-database.ts
 *
 * Pure diagnostics for Fabric directory ownership, actor capacity, physical
 * tenant isolation, placement, durability, and receipt lifecycle choices.
 */

import {
  findDatabaseDirectoryConflict,
  resolveControlDatabasePaths,
  type DatabaseDirectoryConflict,
} from '../databases/database-directory-isolation';
import type { AppConfig, ResolvedConfig } from '../frontend/server/types';
import {
  resolveSystemDatabaseConfig,
  resolveSystemDatabaseOwnedPaths,
} from '../frontend/server/system-database-config';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

/** Report Fabric path-ownership errors even when runtime resolution fails closed. */
export function checkPreResolutionDatabaseDirectoryIsolation(
  config: AppConfig,
  findings: PlatformDoctorFindingSink,
): void {
  const topology = config.databaseTopology;
  if (!topology || topology.mode !== 'multiple'
    || typeof topology.rootDirectory !== 'string'
    || typeof config.outDir !== 'string' && config.outDir !== undefined
    || typeof config.storageDir !== 'string' && config.storageDir !== undefined) {
    return;
  }

  let conflict: DatabaseDirectoryConflict | null;
  try {
    conflict = findDatabaseDirectoryConflict({
      rootDirectory: topology.rootDirectory,
      outDir: config.outDir ?? './.build',
      storageDir: config.storageDir ?? '.storage',
      controlDatabasePaths: [
        ...resolveControlDatabasePaths(config.db),
        ...resolveSystemDatabaseOwnedPaths(resolveSystemDatabaseConfig(
          config.db,
          config.systemDb,
        )),
      ],
    });
  } catch {
    return;
  }

  if (!conflict) return;
  const common = {
    severity: 'error' as const,
    path: 'databaseTopology.rootDirectory',
    docs: './docs/framework/multi-database-architecture.md#file-and-ownership-safety',
  };
  switch (conflict) {
    case 'build-output':
      addFinding(findings, {
        ...common,
        code: 'database.root.overlaps_build_output',
        message: 'The multi-database root overlaps the client build output directory.',
        hint: 'Move databaseTopology.rootDirectory to a dedicated persistent directory that build/deploy cleanup never replaces.',
      });
      return;
    case 'control-database':
      addFinding(findings, {
        ...common,
        code: 'database.root.overlaps_control_database',
        message: 'The multi-database root overlaps an application/system database or hot snapshot path.',
        hint: 'Keep both pinned database planes and every hot snapshot outside the Fabric-managed root.',
      });
      return;
    case 'storage-root':
      addFinding(findings, {
        ...common,
        code: 'database.root.reuses_storage_directory',
        message: 'The multi-database root reuses or contains the object-storage directory.',
        hint: 'Use a dedicated sibling or an unowned child such as storageDir/databases.',
      });
      return;
    case 'storage-temp':
      addFinding(findings, {
        ...common,
        code: 'database.root.overlaps_storage_temp',
        message: 'The multi-database root overlaps the object-storage temporary-file namespace.',
        hint: 'Move the root outside storageDir/tmp; that directory is owned exclusively by transient uploads.',
      });
      return;
    case 'storage-blobs':
      addFinding(findings, {
        ...common,
        code: 'database.root.overlaps_storage_blobs',
        message: 'The multi-database root overlaps the object-storage blob namespace.',
        hint: 'Move the root outside storageDir/blobs; use a dedicated sibling or storageDir/databases.',
      });
      return;
  }
}

/** Explain operational consequences of the resolved actor-backed topology. */
export function checkDatabaseTopology(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
): void {
  const topology = resolved.databaseTopology;
  if (topology.mode !== 'multiple') return;

  addFinding(findings, {
    severity: 'info',
    code: 'database.topology.multiple_enabled',
    path: 'databaseTopology',
    message: `Actor-backed multi-database mode is enabled with capacity for ${topology.maxDatabases} active database${topology.maxDatabases === 1 ? '' : 's'}.`,
    hint: 'Size actor capacity, queue limits, and operation timeouts from measured workload and file-descriptor/process limits.',
    docs: './docs/framework/multi-database-architecture.md',
  });
  addFinding(findings, {
    severity: 'info',
    code: 'database.files.capacity_limit',
    path: 'databaseTopology.maxDatabaseFiles',
    message: `Fabric admits at most ${topology.maxDatabaseFiles.toLocaleString('en-US')} Zero-managed physical database files; existing files remain openable after the limit is reached.`,
    hint: 'Size the limit from tenant/database lifecycle policy and storage/inode budgets; new files fail non-retryably until capacity is deliberately raised.',
    docs: './docs/framework/multi-database-architecture.md#bounded-capacity-and-backpressure',
  });

  const placement = topology.placement;
  const hotCanBeSelected = placement.default === 'hot'
    || placement.select !== undefined;
  if (hotCanBeSelected && placement.hot) {
    const isHybrid = placement.select !== undefined;
    addFinding(findings, {
      severity: 'info',
      code: isHybrid
        ? 'database.placement.hybrid_enabled'
        : 'database.placement.hot_enabled',
      path: 'databaseTopology.placement',
      message: isHybrid
        ? `Hybrid placement is enabled with a ${placement.default} default and an opaque database-ref selector.`
        : `Hot placement is enabled for every actor database with ${placement.hot.durability} durability.`,
      hint: isHybrid
        ? 'Build intentional allowlists with createTenantDatabaseRef() or createNamedDatabaseRef(); the coordinator validates the synchronous result and pins it to the entry across replacement generations.'
        : 'Use hybrid placement when only a measured subset of databases should consume the hot-memory budget.',
      docs: './docs/framework/multi-database-architecture.md#hybrid-placement-acceptance',
    });

    const configuredCapacityBytes = BigInt(topology.maxDatabases)
      * BigInt(placement.hot.maxBytes);
    addFinding(findings, {
      severity: 'info',
      code: 'database.hot.capacity_upper_bound',
      path: 'databaseTopology.placement.hot.maxBytes',
      message: `At ${topology.maxDatabases} active databases and ${formatDoctorBytes(placement.hot.maxBytes)} per hot database, the configured hot image budget can reach ${formatDoctorBytes(configuredCapacityBytes)}.`,
      hint: 'Leave headroom for SQLite, actor processes, snapshot buffers, application memory, and file-backed entries; the image budget is not a total RSS limit.',
      docs: './docs/framework/multi-database-architecture.md#hybrid-placement-acceptance',
    });

    addFinding(findings, {
      severity: 'warning',
      code: 'database.hot.readers_unavailable',
      path: 'databaseTopology.readers',
      message: 'Hot databases run reads and writes through one writer FIFO; separate WAL reader actors apply only to file-placed databases.',
      hint: 'Use file placement for workloads that need same-database read/write overlap, and size hot actor queues from measured contention.',
      docs: './docs/framework/multi-database-architecture.md#runtime-topology',
    });

    if (placement.hot.durability === 'periodic') {
      addFinding(findings, {
        severity: 'warning',
        code: 'database.hot.periodic.accepted_loss_window',
        path: 'databaseTopology.placement.hot.durability',
        message: `Periodic hot durability explicitly accepts losing acknowledged writes since the last successful snapshot (configured cadence: ${placement.hot.snapshotIntervalMs}ms).`,
        hint: 'Use on-write durability when every acknowledged commit must first cross a crash-durable snapshot boundary.',
        docs: './docs/framework/multi-database-architecture.md#hybrid-placement-acceptance',
      });
    } else if (placement.hot.durability === 'final') {
      addFinding(findings, {
        severity: 'warning',
        code: 'database.hot.final.accepted_loss_window',
        path: 'databaseTopology.placement.hot.durability',
        message: 'Final-only hot durability persists on graceful actor close and explicitly permits acknowledged writes from the active generation to be lost after a crash or forced termination.',
        hint: 'Use on-write durability for production data unless losing the full active-generation window is an intentional, tested choice.',
        docs: './docs/framework/multi-database-architecture.md#hybrid-placement-acceptance',
      });
    } else {
      addFinding(findings, {
        severity: 'info',
        code: 'database.hot.on_write_durability',
        path: 'databaseTopology.placement.hot.durability',
        message: 'On-write hot durability requires a crash-durable snapshot before a logical write is acknowledged.',
        hint: 'Monitor snapshot latency and failures; an uncertain post-commit snapshot outcome must be reconciled with the same idempotency key.',
        docs: './docs/framework/multi-database-architecture.md#hybrid-placement-acceptance',
      });
    }
  } else if (placement.hot) {
    addFinding(findings, {
      severity: 'info',
      code: 'database.hot.config_inactive',
      path: 'databaseTopology.placement.hot',
      message: 'Hot placement limits are configured, but the file default has no selector that can choose hot placement.',
      hint: 'Remove the unused hot block or add a synchronous database-ref selector when hot placement is intended.',
      docs: './docs/framework/multi-database-architecture.md#hybrid-placement-acceptance',
    });
  }

  if (!topology.readers) {
    addFinding(findings, {
      severity: 'info',
      code: 'database.readers.disabled',
      path: 'databaseTopology.readers',
      message: 'Separate WAL reader actors are disabled, so reads for each file-placed database share its writer lane.',
      hint: 'Enable readers when same-file reads should overlap an active writer; keep them disabled only when the lower process/file-descriptor footprint is deliberate.',
      docs: './docs/framework/multi-database-architecture.md#runtime-topology',
    });
  }

  if (topology.tenantIsolation === 'tenant-database') {
    addFinding(findings, {
      severity: 'info',
      code: 'database.tenant_isolation.physical',
      path: 'databaseTopology.tenantIsolation',
      message: 'Tenant application data is isolated by a framework-bound physical database capability.',
      hint: 'Tenant resources normally omit tenant_id; retain tenant references only in the shared Zero control plane or when they are meaningful application data.',
      docs: './docs/framework/multi-database-architecture.md#where-tenant-scope-lives',
    });
    const reservedActorSlots = topology.maxDatabases
      - topology.maxTenantSyncDatabases;
    addFinding(findings, {
      severity: reservedActorSlots > 0 ? 'info' : 'warning',
      code: reservedActorSlots > 0
        ? 'database.sync.actor_capacity_reserved'
        : 'database.sync.actor_capacity_unreserved',
      path: 'databaseTopology.maxTenantSyncDatabases',
      message: reservedActorSlots > 0
        ? `Persistent tenant Sync may pin ${topology.maxTenantSyncDatabases} distinct databases, reserving ${reservedActorSlots} of ${topology.maxDatabases} actor slots for ordinary work.`
        : topology.maxDatabases === 1
          ? 'This one-slot topology cannot reserve separate actor capacity from its persistent tenant Sync binding.'
          : `Persistent tenant Sync may pin all ${topology.maxDatabases} actor slots, leaving no actor capacity reserved for ordinary work.`,
      hint: reservedActorSlots > 0
        ? `Each database also admits at most ${topology.maxTenantSyncBindingsPerDatabase} persistent Sync bindings.`
        : topology.maxDatabases === 1
          ? 'Increase maxDatabases to at least 2 to reserve one slot for ordinary request/background work.'
          : 'Set maxTenantSyncDatabases below maxDatabases unless total Sync saturation is an intentional, load-tested policy.',
      docs: './docs/framework/multi-database-architecture.md#bounded-capacity-and-backpressure',
    });
    addFinding(findings, {
      severity: 'info',
      code: 'database.sync.snapshot_transport_bounded',
      path: 'syncDefaults',
      message: 'Physical-tenant Sync snapshots use atomic bounded frames and adaptive actor pages.',
      hint: 'Keep every projected Sync row below the transport frame limit; Zero closes terminally instead of reconnect-looping when one row cannot cross actor IPC or WebSocket transport.',
      docs: './docs/framework/multi-database-architecture.md#reactivedb-and-realtime',
    });
    addFinding(findings, {
      severity: 'info',
      code: 'database.receipts.full_result_budget',
      path: 'databaseTopology',
      message: 'Each physical database retains 10,000 full logical-write receipt results before compacting older results to permanent key tombstones.',
      hint: 'Size client retry/recovery windows so uncertain mutations are reconciled promptly; compacted receipts fail closed and are never re-executed.',
      docs: './docs/framework/multi-database-architecture.md#idempotency-failure-and-restart',
    });
    addFinding(findings, {
      severity: 'warning',
      code: 'database.receipts.permanent_key_capacity',
      path: 'databaseTopology',
      message: 'Each physical database admits at most 1,000,000 permanent logical-write receipt identities; tombstones are retained to prevent replayed work from executing again.',
      hint: 'Alert on receipt-compaction totalKeys/keyLimit telemetry and define the database archive, replacement, or decommission lifecycle well before the permanent-key ceiling.',
      docs: './docs/framework/multi-database-architecture.md#idempotency-failure-and-restart',
    });
  }
}

/** Format a doctor-only byte budget without losing values above MAX_SAFE_INTEGER. */
function formatDoctorBytes(value: number | bigint): string {
  const bytes = typeof value === 'bigint' ? value : BigInt(value);
  return `${bytes.toLocaleString('en-US')} bytes`;
}
