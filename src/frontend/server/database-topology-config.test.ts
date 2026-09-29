import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineDatabaseRealm } from '../../databases/database-realm';
import {
  DATABASE_FILE_PLACEMENT_POLICY,
  DATABASE_HOT_DEFAULT_SNAPSHOT_INTERVAL_MS,
  DATABASE_HOT_MIN_SNAPSHOT_TIMEOUT_MS,
  DATABASE_HOT_SHORTHAND_MAX_BYTES,
  DATABASE_HOT_SHORTHAND_PLACEMENT_POLICY,
} from '../../databases/database-placement';
import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../../runtime/timer-limits';
import {
  DATABASE_COORDINATOR_MAX_DATABASES,
  DATABASE_OBSERVABILITY_COUNT_MAX,
} from '../../databases/database-capacity';
import { resolveConfig } from './types';

const appTables = {
  todos: {
    id: 'text primary key',
    title: 'text not null',
  },
};

const realm = defineDatabaseRealm({
  name: 'topology-test',
  version: '1',
  tables: appTables,
});

const sourceLaunch = Object.freeze({
  kind: 'source' as const,
  entrypoint: fileURLToPath(import.meta.url),
});

function multiple(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'multiple' as const,
    rootDirectory: './data/isolated-databases',
    realm,
    actors: { launch: sourceLaunch },
    ...overrides,
  };
}

function resolveWithTopology(databaseTopology?: unknown) {
  return resolveConfig({
    db: { mode: 'memory' },
    tables: appTables,
    ...(databaseTopology === undefined
      ? {}
      : { databaseTopology: databaseTopology as never }),
  });
}

describe('database topology config', () => {
  test('keeps omitted and explicit single topology equivalent without changing db', () => {
    const db = { mode: 'memory' as const };
    const omitted = resolveConfig({ db, tables: appTables });
    const explicit = resolveConfig({
      db,
      tables: appTables,
      databaseTopology: { mode: 'single' },
    });

    expect(omitted.db).toBe(db);
    expect(explicit.db).toBe(db);
    expect(omitted.databaseTopology).toEqual({ mode: 'single' });
    expect(explicit.databaseTopology).toBe(omitted.databaseTopology);
    expect(Object.isFrozen(omitted.databaseTopology)).toBe(true);
  });

  test('normalizes the actor-backed file topology without touching the filesystem', () => {
    const rootDirectory = join(
      tmpdir(),
      `zero-topology-config-${crypto.randomUUID()}`,
    );
    expect(existsSync(rootDirectory)).toBe(false);

    const config = resolveWithTopology(multiple({
      rootDirectory,
      sqlite: {
        cacheSize: -4_096,
        mmapSize: 0,
        busyTimeout: 10_000,
        synchronous: 'FULL',
        tempStore: 'MEMORY',
        ringBufferDepth: 250,
        bufferPool: { maxPoolSize: 20, preallocate: false },
      },
      maxDatabases: 8,
      maxDatabaseFiles: 777,
      maxBlockedDatabases: 99,
      maxTenantSyncDatabases: 6,
      maxTenantSyncBindingsPerDatabase: 12,
      readers: false,
      maxQueuedPerDatabase: 12,
      maxQueuedTotal: 40,
      queueTimeoutMs: 2_000,
      operationTimeoutMs: 9_000,
      restart: {
        initialDelayMs: 25,
        maxDelayMs: 400,
        circuitFailureThreshold: 4,
        circuitCooldownMs: 2_000,
      },
      idleTimeoutMs: 15_000,
      sweepIntervalMs: 2_500,
    }));

    const topology = config.databaseTopology;
    expect(topology.mode).toBe('multiple');
    if (topology.mode !== 'multiple') throw new Error('Expected multiple topology.');
    expect(topology.rootDirectory).toBe(resolvePath(rootDirectory));
    expect(topology.realm).toBe(realm);
    expect(typeof topology.createExecutor).toBe('function');
    expect(topology.tenantIsolation).toBe('shared-row');
    expect(topology.placement).toBe(DATABASE_FILE_PLACEMENT_POLICY);
    expect(topology.maxDatabases).toBe(8);
    expect(topology.maxDatabaseFiles).toBe(777);
    expect(topology.maxBlockedDatabases).toBe(99);
    expect(topology.maxTenantSyncDatabases).toBe(6);
    expect(topology.maxTenantSyncBindingsPerDatabase).toBe(12);
    expect(topology.readers).toBe(false);
    expect(topology.maxQueuedPerDatabase).toBe(12);
    expect(topology.maxQueuedTotal).toBe(40);
    expect(topology.queueTimeoutMs).toBe(2_000);
    expect(topology.operationTimeoutMs).toBe(9_000);
    expect(topology.restart).toEqual({
      initialDelayMs: 25,
      maxDelayMs: 400,
      circuitFailureThreshold: 4,
      circuitCooldownMs: 2_000,
    });
    expect(Object.isFrozen(topology.restart)).toBe(true);
    expect(topology.idleTimeoutMs).toBe(15_000);
    expect(topology.sweepIntervalMs).toBe(2_500);
    expect(topology.sqlite).toEqual({
      cacheSize: -4_096,
      mmapSize: 0,
      busyTimeout: 10_000,
      synchronous: 'FULL',
      tempStore: 'MEMORY',
      ringBufferDepth: 250,
      bufferPool: { maxPoolSize: 20, preallocate: false },
    });
    expect(Object.isFrozen(topology)).toBe(true);
    expect(Object.isFrozen(topology.sqlite)).toBe(true);
    expect(Object.isFrozen(topology.sqlite.bufferPool!)).toBe(true);
    expect(existsSync(rootDirectory)).toBe(false);
  });

  test('normalizes file and bounded hot shorthand to shared immutable policies', () => {
    const omitted = resolveWithTopology(multiple()).databaseTopology;
    const file = resolveWithTopology(multiple({ placement: 'file' })).databaseTopology;
    const hot = resolveWithTopology(multiple({ placement: 'hot' })).databaseTopology;
    if (omitted.mode !== 'multiple'
      || file.mode !== 'multiple'
      || hot.mode !== 'multiple') {
      throw new Error('Expected multiple topology.');
    }

    expect(omitted.placement).toBe(DATABASE_FILE_PLACEMENT_POLICY);
    expect(file.placement).toBe(DATABASE_FILE_PLACEMENT_POLICY);
    expect(hot.placement).toBe(DATABASE_HOT_SHORTHAND_PLACEMENT_POLICY);
    expect(hot.placement).toEqual({
      default: 'hot',
      hot: {
        durability: 'on-write',
        maxBytes: DATABASE_HOT_SHORTHAND_MAX_BYTES,
      },
    });
    expect(Object.isFrozen(hot.placement)).toBe(true);
    expect(Object.isFrozen(hot.placement.hot!)).toBe(true);
  });

  test('defaults and strictly validates the actor restart circuit policy', () => {
    const topology = resolveWithTopology(multiple()).databaseTopology;
    if (topology.mode !== 'multiple') throw new Error('Expected multiple topology.');
    expect(topology.restart).toEqual({
      initialDelayMs: 10,
      maxDelayMs: 1_000,
      circuitFailureThreshold: 5,
      circuitCooldownMs: 5_000,
    });

    expect(() => resolveWithTopology(multiple({
      restart: { typo: 1 },
    }))).toThrow(
      'databaseTopology.restart contains unsupported field "typo"',
    );
    for (const restart of [
      { initialDelayMs: 0 },
      { initialDelayMs: 20, maxDelayMs: 10 },
      { circuitFailureThreshold: 1 },
      { maxDelayMs: 100, circuitCooldownMs: 50 },
    ]) {
      expect(() => resolveWithTopology(multiple({ restart }))).toThrow(
        'databaseTopology.restart requires positive bounded delays',
      );
    }
  });

  test('normalizes a hybrid selector without executing or widening its authority', () => {
    let selectorCalls = 0;
    const select = ({ databaseRef }: { databaseRef: string }) => {
      selectorCalls += 1;
      return databaseRef.length === 64 ? 'hot' as const : 'file' as const;
    };
    const resolved = resolveWithTopology(multiple({
      placement: {
        default: 'file',
        select,
        hot: {
          durability: 'periodic',
          maxBytes: 128 * 1024 * 1024,
        },
      },
    })).databaseTopology;
    if (resolved.mode !== 'multiple') throw new Error('Expected multiple topology.');

    expect(selectorCalls).toBe(0);
    expect(resolved.placement.default).toBe('file');
    expect(resolved.placement.select).toBe(select);
    expect(resolved.placement.hot).toEqual({
      durability: 'periodic',
      maxBytes: 128 * 1024 * 1024,
      snapshotIntervalMs: DATABASE_HOT_DEFAULT_SNAPSHOT_INTERVAL_MS,
      snapshotTimeoutMs: DATABASE_HOT_MIN_SNAPSHOT_TIMEOUT_MS,
    });
    expect(Object.isFrozen(resolved.placement)).toBe(true);
    expect(Object.isFrozen(resolved.placement.hot!)).toBe(true);
  });

  test('defaults explicit hot durability safely and preserves a bounded periodic cadence', () => {
    const onWrite = resolveWithTopology(multiple({
      placement: {
        default: 'hot',
        hot: { maxBytes: 8 * 1024 * 1024 },
      },
    })).databaseTopology;
    const periodic = resolveWithTopology(multiple({
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 8 * 1024 * 1024,
          snapshotIntervalMs: 5_000,
        },
      },
    })).databaseTopology;
    if (onWrite.mode !== 'multiple' || periodic.mode !== 'multiple') {
      throw new Error('Expected multiple topology.');
    }

    expect(onWrite.placement.hot).toEqual({
      durability: 'on-write',
      maxBytes: 8 * 1024 * 1024,
    });
    expect(periodic.placement.hot).toEqual({
      durability: 'periodic',
      maxBytes: 8 * 1024 * 1024,
      snapshotIntervalMs: 5_000,
      snapshotTimeoutMs: DATABASE_HOT_MIN_SNAPSHOT_TIMEOUT_MS,
    });
  });

  test('uses bounded coordinator defaults', () => {
    const config = resolveWithTopology(multiple());
    const topology = config.databaseTopology;
    if (topology.mode !== 'multiple') throw new Error('Expected multiple topology.');

    expect(topology.maxDatabases).toBe(16);
    expect(topology.maxDatabaseFiles).toBe(10_000);
    expect(topology.maxBlockedDatabases).toBe(1_024);
    expect(topology.maxTenantSyncDatabases).toBe(15);
    expect(topology.maxTenantSyncBindingsPerDatabase).toBe(64);
    expect(topology.readers).toBe(true);
    expect(topology.maxQueuedPerDatabase).toBe(128);
    expect(topology.maxQueuedTotal).toBe(1_024);
    expect(topology.queueTimeoutMs).toBe(15_000);
    expect(topology.operationTimeoutMs).toBe(30_000);
    expect(topology.idleTimeoutMs).toBe(60_000);
    expect(topology.sweepIntervalMs).toBe(30_000);
    expect(topology.sqlite).toEqual({});
  });

  test('accepts the portable JavaScript timer ceiling for topology timers', () => {
    const topology = resolveWithTopology(multiple({
      queueTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
      operationTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
      sweepIntervalMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
    })).databaseTopology;
    if (topology.mode !== 'multiple') throw new Error('Expected multiple topology.');

    expect(topology.queueTimeoutMs).toBe(MAX_RUNTIME_TIMER_INTERVAL_MS);
    expect(topology.operationTimeoutMs).toBe(MAX_RUNTIME_TIMER_INTERVAL_MS);
    expect(topology.sweepIntervalMs).toBe(MAX_RUNTIME_TIMER_INTERVAL_MS);
  });

  test('accepts the observable count ceiling and rejects values above it', () => {
    const countFields = [
      'maxDatabaseFiles',
      'maxBlockedDatabases',
      'maxTenantSyncBindingsPerDatabase',
      'maxQueuedPerDatabase',
      'maxQueuedTotal',
    ] as const;

    for (const field of countFields) {
      const topology = resolveWithTopology(multiple({
        [field]: DATABASE_OBSERVABILITY_COUNT_MAX,
      })).databaseTopology;
      if (topology.mode !== 'multiple') {
        throw new Error('Expected multiple topology.');
      }
      expect(topology[field]).toBe(DATABASE_OBSERVABILITY_COUNT_MAX);

      expect(() => resolveWithTopology(multiple({
        [field]: DATABASE_OBSERVABILITY_COUNT_MAX + 1,
      }))).toThrow(
        `databaseTopology.${field} must not exceed ${DATABASE_OBSERVABILITY_COUNT_MAX}`,
      );
    }
  });

  test('requires multi-tenant auth and a schema-compatible app-table subset', () => {
    expect(() => resolveWithTopology(multiple({
      tenantIsolation: 'tenant-database',
    }))).toThrow('requires auth.tenancy: "multi"');

    const configured = resolveConfig({
      db: { mode: 'memory' },
      tables: appTables,
      auth: { tenancy: 'multi' },
      databaseTopology: multiple({ tenantIsolation: 'tenant-database' }),
    });
    expect(configured.databaseTopology).toMatchObject({
      mode: 'multiple',
      tenantIsolation: 'tenant-database',
    });

    const differentRealm = defineDatabaseRealm({
      name: 'different',
      version: '1',
      tables: { notes: { id: 'text primary key' } },
    });
    expect(() => resolveConfig({
      db: { mode: 'memory' },
      tables: appTables,
      auth: { tenancy: 'multi' },
      databaseTopology: multiple({
        tenantIsolation: 'tenant-database',
        realm: differentRealm,
      }),
    })).toThrow('contains tables not declared');

    const appTablesWithGlobal = {
      ...appTables,
      plans: { id: 'text primary key', name: 'text not null' },
    };
    const subset = resolveConfig({
      db: { mode: 'memory' },
      tables: appTablesWithGlobal,
      auth: { tenancy: 'multi' },
      databaseTopology: multiple({ tenantIsolation: 'tenant-database' }),
    });
    expect(subset.databaseTopology).toMatchObject({
      mode: 'multiple',
      tenantIsolation: 'tenant-database',
    });
  });

  test('rejects unsupported modes, branch mixing, placement, and actor policy', () => {
    expect(() => resolveWithTopology({ mode: 'named' })).toThrow(
      'databaseTopology.mode must be "single" or "multiple"',
    );
    expect(() => resolveWithTopology({
      mode: 'single',
      rootDirectory: './data/extra',
    })).toThrow('single mode contains unsupported field "rootDirectory"');
    expect(() => resolveWithTopology(multiple({ typo: true }))).toThrow(
      'multiple mode contains unsupported field "typo"',
    );
    expect(() => resolveWithTopology(multiple({ placement: 'warm' }))).toThrow(
      'databaseTopology.placement must be an object',
    );
    expect(() => resolveWithTopology(multiple({
      actors: { launch: { kind: 'source', entrypoint: './relative.ts' } },
    }))).toThrow('invalid subprocess launch policy');
    expect(() => resolveWithTopology(multiple({
      actors: { launch: sourceLaunch, typo: true },
    }))).toThrow('invalid subprocess launch policy');
  });

  test('rejects ambiguous, unbounded, invalid, and misspelled placement policy', () => {
    expect(() => resolveWithTopology(multiple({
      placement: { default: 'file', typo: true },
    }))).toThrow('databaseTopology.placement contains unsupported field "typo"');
    expect(() => resolveWithTopology(multiple({
      placement: { default: 'warm' },
    }))).toThrow('placement.default must be "file" or "hot"');
    expect(() => resolveWithTopology(multiple({
      placement: { default: 'file', select: 'hot' },
    }))).toThrow('placement.select must be a synchronous function');
    expect(() => resolveWithTopology(multiple({
      placement: { default: 'hot' },
    }))).toThrow('placement.hot is required when hot placement can be selected');
    expect(() => resolveWithTopology(multiple({
      placement: { default: 'file', select: () => 'file' },
    }))).toThrow('placement.hot is required when hot placement can be selected');
    expect(() => resolveWithTopology(multiple({
      placement: {
        default: 'hot',
        hot: { maxBytes: 1024, typo: true },
      },
    }))).toThrow('databaseTopology.placement.hot contains unsupported field "typo"');
    expect(() => resolveWithTopology(multiple({
      placement: {
        default: 'hot',
        hot: { durability: 'sometimes', maxBytes: 1024 },
      },
    }))).toThrow('placement.hot.durability must be "on-write", "periodic", or "final"');

    for (const maxBytes of [undefined, 0, -1, 1.5, Number.NaN]) {
      expect(() => resolveWithTopology(multiple({
        placement: {
          default: 'hot',
          hot: { maxBytes },
        },
      }))).toThrow('placement.hot.maxBytes must be a positive safe integer');
    }
    for (const snapshotIntervalMs of [0, -1, 1.5, Number.NaN]) {
      expect(() => resolveWithTopology(multiple({
        placement: {
          default: 'hot',
          hot: {
            durability: 'periodic',
            maxBytes: 1024,
            snapshotIntervalMs,
          },
        },
      }))).toThrow('placement.hot.snapshotIntervalMs must be a positive safe integer');
    }
    expect(() => resolveWithTopology(multiple({
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 1024,
          snapshotIntervalMs: 2_147_483_648,
        },
      },
    }))).toThrow('placement.hot.snapshotIntervalMs must not exceed 2147483647');
    for (const snapshotTimeoutMs of [0, -1, 1.5, Number.NaN]) {
      expect(() => resolveWithTopology(multiple({
        placement: {
          default: 'hot',
          hot: {
            durability: 'periodic',
            maxBytes: 1024,
            snapshotIntervalMs: 1_000,
            snapshotTimeoutMs,
          },
        },
      }))).toThrow('placement.hot.snapshotTimeoutMs must be a positive safe integer');
    }
    expect(() => resolveWithTopology(multiple({
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 1024,
          snapshotIntervalMs: 1_000,
          snapshotTimeoutMs: 999,
        },
      },
    }))).toThrow('placement.hot.snapshotTimeoutMs must be at least snapshotIntervalMs');
    expect(() => resolveWithTopology(multiple({
      placement: {
        default: 'hot',
        hot: {
          durability: 'periodic',
          maxBytes: 1024,
          snapshotTimeoutMs: 2_147_483_648,
        },
      },
    }))).toThrow('placement.hot.snapshotTimeoutMs must not exceed 2147483647');
    expect(() => resolveWithTopology(multiple({
      placement: {
        default: 'hot',
        hot: {
          durability: 'final',
          maxBytes: 1024,
          snapshotIntervalMs: 1000,
        },
      },
    }))).toThrow('snapshotIntervalMs is only valid with periodic durability');
    expect(() => resolveWithTopology(multiple({
      placement: {
        default: 'hot',
        hot: {
          durability: 'final',
          maxBytes: 1024,
          snapshotTimeoutMs: 1_000,
        },
      },
    }))).toThrow('snapshotTimeoutMs is only valid with periodic durability');
  });

  test('rejects unsafe roots, capacities, and SQLite settings before startup', () => {
    for (const rootDirectory of ['', '   ', ' padded ', '\0bad', '/']) {
      expect(() => resolveWithTopology(multiple({ rootDirectory }))).toThrow(
        'databaseTopology.rootDirectory',
      );
    }

    for (const field of [
      'maxDatabases',
      'maxDatabaseFiles',
      'maxBlockedDatabases',
      'maxTenantSyncBindingsPerDatabase',
      'maxQueuedPerDatabase',
      'maxQueuedTotal',
      'queueTimeoutMs',
      'operationTimeoutMs',
    ]) {
      for (const value of [0, -1, 1.5, Number.NaN]) {
        expect(() => resolveWithTopology(multiple({ [field]: value }))).toThrow(
          `databaseTopology.${field} must be a positive safe integer`,
        );
      }
    }
    for (const value of [-1, 1.5, Number.NaN]) {
      expect(() => resolveWithTopology(multiple({
        maxTenantSyncDatabases: value,
      }))).toThrow(
        'databaseTopology.maxTenantSyncDatabases must be a non-negative safe integer',
      );
    }
    expect(resolveWithTopology(multiple({
      maxDatabases: 1,
      maxTenantSyncDatabases: 0,
    })).databaseTopology).toMatchObject({
      maxDatabases: 1,
      maxTenantSyncDatabases: 0,
    });
    expect(resolveWithTopology(multiple({
      maxDatabases: 1,
    })).databaseTopology).toMatchObject({
      maxDatabases: 1,
      maxTenantSyncDatabases: 1,
    });
    expect(() => resolveWithTopology(multiple({
      maxDatabases: 1,
      maxTenantSyncDatabases: 2,
    }))).toThrow(
      'databaseTopology.maxTenantSyncDatabases must not exceed databaseTopology.maxDatabases',
    );
    expect(() => resolveWithTopology(multiple({
      maxDatabases: DATABASE_COORDINATOR_MAX_DATABASES + 1,
    }))).toThrow(
      `databaseTopology.maxDatabases must not exceed ${DATABASE_COORDINATOR_MAX_DATABASES}`,
    );
    for (const field of [
      'queueTimeoutMs',
      'operationTimeoutMs',
      'sweepIntervalMs',
    ]) {
      expect(() => resolveWithTopology(multiple({
        [field]: MAX_RUNTIME_TIMER_INTERVAL_MS + 1,
      }))).toThrow(
        `databaseTopology.${field} must not exceed ${MAX_RUNTIME_TIMER_INTERVAL_MS}`,
      );
    }
    for (const value of [-1, 1.5, Number.NaN]) {
      expect(() => resolveWithTopology(multiple({ idleTimeoutMs: value }))).toThrow(
        'databaseTopology.idleTimeoutMs must be a non-negative safe integer',
      );
    }
    expect(() => resolveWithTopology(multiple({ readers: 'yes' }))).toThrow(
      'databaseTopology.readers must be a boolean',
    );
    expect(() => resolveWithTopology(multiple({
      sqlite: { ringBufferDepth: 0 },
    }))).toThrow('Invalid numeric database actor setting');
    expect(() => resolveWithTopology(multiple({
      sqlite: { path: '/unsafe' },
    }))).toThrow('Invalid database actor payload fields');
  });

  test('fails configuration before Fabric can share build or storage ownership', () => {
    const base = join(tmpdir(), `zero-topology-ownership-${crypto.randomUUID()}`);
    const storageDir = join(base, 'storage');
    const outDir = join(base, 'build');
    const resolveOwned = (
      rootDirectory: string,
      overrides: Partial<Parameters<typeof resolveConfig>[0]> = {},
    ) => resolveConfig({
      db: { mode: 'memory' },
      tables: appTables,
      storageDir,
      outDir,
      databaseTopology: multiple({ rootDirectory }),
      ...overrides,
    });

    for (const [rootDirectory, conflictingOutDir] of [
      [outDir, outDir],
      [outDir, join(outDir, 'client')],
      [join(outDir, 'fabric'), outDir],
    ]) {
      expect(() => resolveOwned(rootDirectory, { outDir: conflictingOutDir })).toThrow(
        'databaseTopology.rootDirectory must not overlap outDir',
      );
    }

    expect(() => resolveOwned(storageDir)).toThrow(
      'must not reuse or contain storageDir',
    );
    expect(() => resolveOwned(base, {
      outDir: join(tmpdir(), `zero-build-${crypto.randomUUID()}`),
    })).toThrow('must not reuse or contain storageDir');
    expect(() => resolveOwned(join(storageDir, 'tmp'))).toThrow(
      'must not overlap the object-storage temporary directory',
    );
    expect(() => resolveOwned(join(storageDir, 'tmp', 'fabric'))).toThrow(
      'must not overlap the object-storage temporary directory',
    );
    expect(() => resolveOwned(join(storageDir, 'blobs', 'fabric'))).toThrow(
      'must not overlap the object-storage blob directory',
    );

    expect(resolveOwned(join(storageDir, 'databases')).databaseTopology).toMatchObject({
      mode: 'multiple',
      rootDirectory: resolvePath(storageDir, 'databases'),
    });
  });

  test('keeps Fabric separate from effective default and hot snapshot files', () => {
    const base = join(tmpdir(), `zero-topology-control-${crypto.randomUUID()}`);
    const rootDirectory = join(base, 'fabric');
    const common = {
      tables: appTables,
      storageDir: join(base, 'storage'),
      outDir: join(base, 'build'),
      databaseTopology: multiple({ rootDirectory }),
    };

    expect(() => resolveConfig({
      ...common,
      db: { mode: 'file', path: join(rootDirectory, 'control.db') },
    })).toThrow('must not overlap a default/control database path');
    expect(() => resolveConfig({
      ...common,
      db: { mode: 'file', path: join(base, 'control.db') },
      databaseTopology: multiple({
        rootDirectory: join(base, 'control.db-wal'),
      }),
    })).toThrow('must not overlap a default/control database path');
    expect(() => resolveConfig({
      ...common,
      db: {
        mode: 'hot',
        path: join(base, 'control.db'),
        snapshotPath: join(rootDirectory, 'control.snapshot.db'),
        snapshotEnabled: false,
      },
    })).toThrow('must not overlap a default/control database path');
    expect(() => resolveConfig({
      ...common,
      db: {
        mode: 'hot',
        path: join(rootDirectory, 'control.db'),
        snapshotPath: join(base, 'control.snapshot.db'),
      },
    })).toThrow('must not overlap a default/control database path');

    expect(resolveConfig({
      ...common,
      db: {
        mode: 'hot',
        path: join(base, 'control.db'),
        snapshotPath: join(base, 'control.snapshot.db'),
      },
    }).databaseTopology).toMatchObject({
      mode: 'multiple',
      rootDirectory: resolvePath(rootDirectory),
    });
    expect(resolveConfig({
      ...common,
      db: { mode: 'memory' },
    }).databaseTopology).toMatchObject({ mode: 'multiple' });
  });
});
