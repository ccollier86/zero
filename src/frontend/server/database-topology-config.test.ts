import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineDatabaseRealm } from '../../databases/database-realm';
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
      maxBlockedDatabases: 99,
      readers: false,
      maxQueuedPerDatabase: 12,
      maxQueuedTotal: 40,
      queueTimeoutMs: 2_000,
      operationTimeoutMs: 9_000,
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
    expect(topology.placement).toBe('file');
    expect(topology.maxDatabases).toBe(8);
    expect(topology.maxBlockedDatabases).toBe(99);
    expect(topology.readers).toBe(false);
    expect(topology.maxQueuedPerDatabase).toBe(12);
    expect(topology.maxQueuedTotal).toBe(40);
    expect(topology.queueTimeoutMs).toBe(2_000);
    expect(topology.operationTimeoutMs).toBe(9_000);
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

  test('uses bounded coordinator defaults', () => {
    const config = resolveWithTopology(multiple());
    const topology = config.databaseTopology;
    if (topology.mode !== 'multiple') throw new Error('Expected multiple topology.');

    expect(topology.maxDatabases).toBe(16);
    expect(topology.maxBlockedDatabases).toBe(1_024);
    expect(topology.readers).toBe(true);
    expect(topology.maxQueuedPerDatabase).toBe(128);
    expect(topology.maxQueuedTotal).toBe(1_024);
    expect(topology.queueTimeoutMs).toBe(15_000);
    expect(topology.operationTimeoutMs).toBe(30_000);
    expect(topology.idleTimeoutMs).toBe(60_000);
    expect(topology.sweepIntervalMs).toBe(30_000);
    expect(topology.sqlite).toEqual({});
  });

  test('requires multi-tenant auth and matching app tables for tenant-database routing', () => {
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
    })).toThrow('tenant realm tables must match');
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
    expect(() => resolveWithTopology(multiple({ placement: 'hot' }))).toThrow(
      'placement currently supports only "file"',
    );
    expect(() => resolveWithTopology(multiple({
      actors: { launch: { kind: 'source', entrypoint: './relative.ts' } },
    }))).toThrow('invalid subprocess launch policy');
    expect(() => resolveWithTopology(multiple({
      actors: { launch: sourceLaunch, typo: true },
    }))).toThrow('invalid subprocess launch policy');
  });

  test('rejects unsafe roots, capacities, and SQLite settings before startup', () => {
    for (const rootDirectory of ['', '   ', ' padded ', '\0bad', '/']) {
      expect(() => resolveWithTopology(multiple({ rootDirectory }))).toThrow(
        'databaseTopology.rootDirectory',
      );
    }

    for (const field of [
      'maxDatabases',
      'maxBlockedDatabases',
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
});
