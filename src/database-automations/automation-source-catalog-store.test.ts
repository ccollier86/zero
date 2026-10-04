import { afterEach, describe, expect, test } from 'bun:test';

import { DatabaseError } from '../databases/database-error';
import { DatabaseRuntime } from '../databases/database-runtime';
import { createPlatformSQLiteService } from '../persistence';
import type {
  DatabaseAutomationSourceRegistration,
} from './automation-source-catalog-contract';
import {
  DatabaseAutomationSourceCatalog,
} from './automation-source-catalog-store';
import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD,
  DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD_SQL,
  DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE_SQL,
} from './automation-source-catalog-schema-sql';

interface CatalogHarness {
  readonly runtime: DatabaseRuntime;
  readonly catalog: DatabaseAutomationSourceCatalog;
  close(): void;
}

const openHarnesses = new Set<CatalogHarness>();

afterEach(() => {
  for (const harness of openHarnesses) harness.close();
  openHarnesses.clear();
});

describe('DatabaseAutomationSourceCatalog', () => {
  test('registers exact application, named, and tenant authority idempotently', () => {
    const harness = createHarness();
    const application = applicationSource(1);
    const named = namedSource(2, 'analytics');
    const tenant = tenantSource(3, 'tenant-a');

    expect(harness.catalog.register(application)).toMatchObject({
      disposition: 'created',
      source: {
        sourceKind: 'application',
        logicalSourceId: 'application',
        authority: { scopeKind: 'application', tenantId: null },
        status: 'active',
        revision: 1,
        ordinal: 1,
      },
    });
    expect(harness.catalog.register(named).source).toMatchObject({
      sourceKind: 'named',
      logicalSourceId: 'analytics',
      authority: { scopeKind: 'application', tenantId: null },
      ordinal: 2,
    });
    expect(harness.catalog.register(tenant).source).toMatchObject({
      sourceKind: 'tenant',
      logicalSourceId: 'tenant-a',
      authority: {
        scopeKind: 'tenant',
        scopeId: 'tenant-a',
        tenantId: 'tenant-a',
      },
      ordinal: 3,
    });
    const replay = harness.catalog.register(tenant);
    expect(replay.disposition).toBe('existing');
    expect(replay.source.ordinal).toBe(3);
    expect(harness.catalog.scan({ status: 'all' }).sources).toHaveLength(3);
  });

  test('fails closed when a physical or logical identity is reused differently', () => {
    const harness = createHarness();
    harness.catalog.register(namedSource(1, 'reports'));

    const physicalMismatch = captureDatabaseError(() => harness.catalog.register({
      ...namedSource(1, 'other'),
    }));
    expect(physicalMismatch).toMatchObject({
      code: 'DATABASE_CONFLICT',
      retryable: false,
      outcome: 'not-committed',
      details: { conflictType: 'automation-source-registration' },
    });

    const logicalMismatch = captureDatabaseError(() => harness.catalog.register(
      namedSource(2, 'reports'),
    ));
    expect(logicalMismatch.code).toBe('DATABASE_CONFLICT');
    expect(logicalMismatch.message).not.toContain('reports');
    expect(logicalMismatch.details).not.toHaveProperty('sourceRef');

    const invalidAuthority = captureDatabaseError(() => harness.catalog.register({
      sourceRef: sourceRef(3),
      sourceKind: 'tenant',
      logicalSourceId: 'tenant-a',
      authority: {
        scopeKind: 'tenant',
        scopeId: 'tenant-b',
        tenantId: 'tenant-b',
      },
    }));
    expect(invalidAuthority.code).toBe('DATABASE_PAYLOAD_INVALID');
  });

  test('retains identity while applying optimistic active/disabled transitions', () => {
    const harness = createHarness();
    const registered = harness.catalog.register(tenantSource(1, 'tenant-a')).source;
    const disabled = harness.catalog.setStatus({
      sourceRef: registered.sourceRef,
      expectedRevision: registered.revision,
      status: 'disabled',
    });
    expect(disabled).toMatchObject({
      status: 'disabled',
      revision: 2,
      logicalSourceId: 'tenant-a',
      ordinal: 1,
    });
    expect(harness.catalog.scan().sources).toEqual([]);
    expect(harness.catalog.scan({ status: 'disabled' }).sources).toHaveLength(1);

    expect(captureDatabaseError(() => harness.catalog.setStatus({
      sourceRef: registered.sourceRef,
      expectedRevision: 1,
      status: 'active',
    }))).toMatchObject({ code: 'DATABASE_CONFLICT', retryable: false });

    const noChange = harness.catalog.setStatus({
      sourceRef: registered.sourceRef,
      expectedRevision: disabled.revision,
      status: 'disabled',
    });
    expect(noChange).toEqual(disabled);
    expect(() => harness.runtime.db.prepare(`
      DELETE FROM _zero_database_automation_sources_v1 WHERE source_ref = ?
    `).run(registered.sourceRef)).toThrow(/identities are permanent/u);
  });

  test('scans deterministic bounded pages and rejects a changed scan revision', () => {
    const harness = createHarness();
    for (let index = 1; index <= 5; index += 1) {
      harness.catalog.register(namedSource(index, `named-${index}`));
    }

    const first = harness.catalog.scan({ status: 'all', limit: 2 });
    expect(first.sources.map((source) => source.ordinal)).toEqual([1, 2]);
    expect(first.page).toMatchObject({ count: 2, hasMore: true, limit: 2 });
    const second = harness.catalog.scan({
      status: 'all',
      limit: 2,
      cursor: first.page.nextCursor,
    });
    expect(second.sources.map((source) => source.ordinal)).toEqual([3, 4]);
    const third = harness.catalog.scan({
      status: 'all',
      limit: 2,
      cursor: second.page.nextCursor,
    });
    expect(third.sources.map((source) => source.ordinal)).toEqual([5]);
    expect(third.page.nextCursor).toBeNull();

    harness.catalog.register(namedSource(6, 'named-6'));
    const changed = captureDatabaseError(() => harness.catalog.scan({
      status: 'all',
      limit: 2,
      cursor: first.page.nextCursor,
    }));
    expect(changed).toMatchObject({
      code: 'DATABASE_CONFLICT',
      retryable: true,
      outcome: 'not-started',
      details: { conflictType: 'automation-source-scan-revision' },
    });
  });

  test('enforces a lowered capacity without leaking source identity', () => {
    const harness = createHarness({ maxSources: 2 });
    harness.catalog.register(namedSource(1, 'one'));
    harness.catalog.register(namedSource(2, 'two'));
    const error = captureDatabaseError(() => harness.catalog.register(
      namedSource(3, 'three'),
    ));
    expect(error).toMatchObject({
      code: 'DATABASE_CAPACITY_EXHAUSTED',
      retryable: false,
      outcome: 'not-started',
      details: { limit: 2 },
    });
    expect(error.message).not.toContain('three');
  });

  test('participates in a surrounding rollback without consuming an ordinal', () => {
    const harness = createHarness();
    expect(() => harness.runtime.db.transaction(() => {
      harness.catalog.register(namedSource(1, 'rolled-back'));
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(harness.catalog.get(sourceRef(1))).toBeNull();
    expect(harness.catalog.register(namedSource(2, 'committed')).source.ordinal).toBe(1);
    harness.catalog.validate();
  });

  test('survives a durable system-runtime restart', async () => {
    const path = `/tmp/zero-automation-source-catalog-${crypto.randomUUID()}.sqlite`;
    let second: CatalogHarness | null = null;
    try {
      const first = createHarness(undefined, path);
      const expected = first.catalog.register(tenantSource(1, 'tenant-restart')).source;
      first.close();
      openHarnesses.delete(first);

      second = createHarness(undefined, path);
      expect(second.catalog.get(expected.sourceRef)).toEqual(expected);
      expect(second.catalog.scan().sources).toEqual([expected]);
      second.catalog.validate();
    } finally {
      second?.close();
      if (second) openHarnesses.delete(second);
      await deleteIfPresent(path);
      await deleteIfPresent(`${path}-wal`);
      await deleteIfPresent(`${path}-shm`);
    }
  });

  test('publishes each committed hot-system registration before returning', async () => {
    const snapshotPath = `/tmp/zero-automation-source-hot-${crypto.randomUUID()}.sqlite`;
    let first: CatalogHarness | null = null;
    let restored: CatalogHarness | null = null;
    try {
      first = createHotHarness(snapshotPath);
      const source = first.catalog.register(namedSource(1, 'hot-source')).source;

      // Open directly from the published image while the first runtime is
      // still live, so graceful-close snapshotting cannot satisfy the proof.
      restored = createHotHarness(snapshotPath);
      expect(restored.catalog.get(source.sourceRef)).toEqual(source);
    } finally {
      restored?.close();
      first?.close();
      if (restored) openHarnesses.delete(restored);
      if (first) openHarnesses.delete(first);
      await deleteIfPresent(snapshotPath);
    }
  });

  test('discards a hot catalog fence on surrounding rollback', async () => {
    const snapshotPath = `/tmp/zero-automation-source-rollback-${crypto.randomUUID()}.sqlite`;
    const harness = createHotHarness(snapshotPath);
    const snapshot = harness.runtime.sqlite.snapshot!;
    const original = snapshot.snapshotSyncDetailed.bind(snapshot);
    let writes = 0;
    snapshot.snapshotSyncDetailed = () => {
      writes += 1;
      return original();
    };
    try {
      expect(() => harness.runtime.db.transaction(() => {
        harness.catalog.register(namedSource(1, 'rolled-back-hot'));
        throw new Error('rollback hot catalog');
      })).toThrow('rollback hot catalog');
      expect(writes).toBe(0);
      expect(harness.catalog.get(sourceRef(1))).toBeNull();
    } finally {
      snapshot.snapshotSyncDetailed = original;
      harness.close();
      openHarnesses.delete(harness);
      await deleteIfPresent(snapshotPath);
    }
  });

  test('fails closed when a committed hot catalog image cannot publish', async () => {
    const snapshotPath = `/tmp/zero-automation-source-failure-${crypto.randomUUID()}.sqlite`;
    const harness = createHotHarness(snapshotPath);
    const snapshot = harness.runtime.sqlite.snapshot!;
    const original = snapshot.snapshotSyncDetailed.bind(snapshot);
    snapshot.snapshotSyncDetailed = () => ({
      status: 'failed',
      durable: false,
      error: new Error(`private snapshot path ${snapshotPath}`),
    });
    try {
      const error = captureDatabaseError(() => harness.catalog.register(
        namedSource(1, 'uncertain-hot'),
      ));
      expect(error).toMatchObject({
        code: 'DATABASE_OUTCOME_UNKNOWN',
        retryable: false,
        outcome: 'unknown',
        details: { component: 'database-automation-source-catalog' },
      });
      expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(snapshotPath);
      expect(captureDatabaseError(
        () => harness.catalog.scan(),
      ).code).toBe('DATABASE_OUTCOME_UNKNOWN');
    } finally {
      snapshot.snapshotSyncDetailed = original;
      harness.close();
      openHarnesses.delete(harness);
      await deleteIfPresent(snapshotPath);
    }
  });

  test('propagates a nested hot publication failure to the root transaction caller', async () => {
    const snapshotPath = `/tmp/zero-automation-source-nested-failure-${crypto.randomUUID()}.sqlite`;
    const harness = createHotHarness(snapshotPath);
    const snapshot = harness.runtime.sqlite.snapshot!;
    const original = snapshot.snapshotSyncDetailed.bind(snapshot);
    snapshot.snapshotSyncDetailed = () => ({
      status: 'failed',
      durable: false,
      error: new Error('private nested publication failure'),
    });
    try {
      const error = captureDatabaseError(() => harness.runtime.db.transaction(() => {
        harness.catalog.register(namedSource(1, 'nested-uncertain-hot'));
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_OUTCOME_UNKNOWN',
        retryable: false,
        outcome: 'unknown',
      });
      expect(captureDatabaseError(
        () => harness.catalog.scan(),
      ).code).toBe('DATABASE_OUTCOME_UNKNOWN');
    } finally {
      snapshot.snapshotSyncDetailed = original;
      harness.close();
      openHarnesses.delete(harness);
      await deleteIfPresent(snapshotPath);
    }
  });

  test('rejects hot source discovery when snapshots are disabled', async () => {
    const snapshotPath = `/tmp/zero-automation-source-disabled-${crypto.randomUUID()}.sqlite`;
    const runtime = DatabaseRuntime.open({
      id: 'system',
      role: 'system',
      sqlite: createPlatformSQLiteService({
        mode: 'hot',
        path: snapshotPath,
        snapshotPath,
        snapshotEnabled: false,
        emitTelemetry: false,
      }),
      ownsSQLite: true,
    });
    try {
      expect(captureDatabaseError(() => new DatabaseAutomationSourceCatalog({
        runtime,
      }))).toMatchObject({
        code: 'DATABASE_CONFIG_INVALID',
        outcome: 'not-started',
      });
    } finally {
      runtime.close();
      await deleteIfPresent(snapshotPath);
    }
  });

  test('rejects schema drift, state tampering, and restored-schema row tampering', () => {
    const schemaHarness = createHarness();
    const schemaSource = schemaHarness.catalog.register(namedSource(1, 'schema')).source;
    schemaHarness.runtime.db.exec(`
      DROP TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD}
    `);
    expect(captureDatabaseError(
      () => schemaHarness.catalog.get(schemaSource.sourceRef),
    ).code).toBe('DATABASE_SCHEMA_MISMATCH');

    const stateHarness = createHarness();
    stateHarness.catalog.register(namedSource(2, 'state'));
    expect(() => stateHarness.runtime.db.exec(`
      UPDATE _zero_database_automation_source_catalog_state_v1
      SET total_sources = 0
      WHERE singleton = 1
    `)).toThrow(/catalog state is invalid/u);
    stateHarness.catalog.validate();

    const rowHarness = createHarness();
    const rowSource = rowHarness.catalog.register(namedSource(3, 'row')).source;
    rowHarness.runtime.db.exec(`
      DROP TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD};
      DROP TRIGGER ${DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE};
    `);
    rowHarness.runtime.db.prepare(`
      UPDATE _zero_database_automation_sources_v1
      SET logical_source_id = ?
      WHERE source_ref = ?
    `).run('row ', rowSource.sourceRef);
    rowHarness.runtime.db.exec(DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_GUARD_SQL);
    rowHarness.runtime.db.exec(DATABASE_AUTOMATION_SOURCE_CATALOG_UPDATE_STATE_SQL);
    expect(captureDatabaseError(
      () => rowHarness.catalog.get(rowSource.sourceRef),
    ).code).toBe('DATABASE_SCHEMA_MISMATCH');
  });

  test('rejects malformed pagination, source references, and non-system planes', () => {
    const harness = createHarness();
    expect(captureDatabaseError(() => harness.catalog.scan({ limit: 501 })).code)
      .toBe('DATABASE_PAYLOAD_INVALID');
    expect(captureDatabaseError(() => harness.catalog.get('tenant-a')).code)
      .toBe('DATABASE_PAYLOAD_INVALID');

    const runtime = DatabaseRuntime.open({
      id: 'application',
      role: 'default',
      sqlite: createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false }),
      ownsSQLite: true,
    });
    try {
      expect(captureDatabaseError(() => new DatabaseAutomationSourceCatalog({
        runtime,
      })).code).toBe('DATABASE_CONFIG_INVALID');
    } finally {
      runtime.close();
    }
  });
});

function createHarness(
  limits?: { maxSources: number },
  path?: string,
): CatalogHarness {
  let now = 10_000;
  const runtime = DatabaseRuntime.open({
    id: 'system',
    role: 'system',
    sqlite: createPlatformSQLiteService(path
      ? { mode: 'file', path, emitTelemetry: false }
      : { mode: 'ephemeral', emitTelemetry: false }),
    ownsSQLite: true,
  });
  const catalog = new DatabaseAutomationSourceCatalog({
    runtime,
    ...(limits ? { limits } : {}),
    now: () => now++,
  });
  let closed = false;
  const harness: CatalogHarness = {
    runtime,
    catalog,
    close() {
      if (closed) return;
      closed = true;
      catalog.close();
      runtime.close();
    },
  };
  openHarnesses.add(harness);
  return harness;
}

function createHotHarness(snapshotPath: string): CatalogHarness {
  let now = 10_000;
  const runtime = DatabaseRuntime.open({
    id: 'system',
    role: 'system',
    sqlite: createPlatformSQLiteService({
      mode: 'hot',
      path: snapshotPath,
      snapshotPath,
      snapshotIntervalMs: 60_000,
      emitTelemetry: false,
    }),
    ownsSQLite: true,
  });
  const catalog = new DatabaseAutomationSourceCatalog({
    runtime,
    now: () => now++,
  });
  let closed = false;
  const harness: CatalogHarness = {
    runtime,
    catalog,
    close() {
      if (closed) return;
      closed = true;
      catalog.close();
      runtime.close();
    },
  };
  openHarnesses.add(harness);
  return harness;
}

function applicationSource(index: number): DatabaseAutomationSourceRegistration {
  return Object.freeze({
    sourceRef: sourceRef(index),
    sourceKind: 'application',
    logicalSourceId: 'application',
    authority: Object.freeze({
      scopeKind: 'application',
      scopeId: 'application',
      tenantId: null,
    }),
  });
}

function namedSource(
  index: number,
  logicalSourceId: string,
): DatabaseAutomationSourceRegistration {
  return Object.freeze({
    sourceRef: sourceRef(index),
    sourceKind: 'named',
    logicalSourceId,
    authority: Object.freeze({
      scopeKind: 'application',
      scopeId: 'application',
      tenantId: null,
    }),
  });
}

function tenantSource(
  index: number,
  tenantId: string,
): DatabaseAutomationSourceRegistration {
  return Object.freeze({
    sourceRef: sourceRef(index),
    sourceKind: 'tenant',
    logicalSourceId: tenantId,
    authority: Object.freeze({
      scopeKind: 'tenant',
      scopeId: tenantId,
      tenantId,
    }),
  });
}

function sourceRef(index: number): string {
  return index.toString(16).padStart(64, '0');
}

function captureDatabaseError(operation: () => unknown): DatabaseError {
  try {
    operation();
    throw new Error('Expected a DatabaseError.');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
}

async function deleteIfPresent(path: string): Promise<void> {
  try {
    await Bun.file(path).delete();
  } catch {
    // Test cleanup is idempotent and paths are unique per run.
  }
}
