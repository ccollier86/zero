import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseCoordinator } from './database-coordinator';
import { observeDatabaseCoordinatorCommits } from './database-coordinator-commit-notifications';
import { createSubprocessDatabaseExecutorFactory } from './subprocess-database-executor-factory';
import { createCoordinatorDatabaseAutomationDeliverySource } from './database-coordinator-automation-delivery-source';
import { createNamedDatabaseRef, deriveNamedDatabaseId } from './database-binding-ref';
import { DatabaseRuntime } from './database-runtime';
import { createPlatformSQLiteService } from '../persistence';
import { DatabaseAutomationSourceCatalog } from '../database-automations/automation-source-catalog-store';
import { DatabaseAutomationDispatcher } from '../database-automations/database-automation-dispatcher';
import { realm } from '../frontend/server/test-fixtures/auth-admission-hot/realm';

test('idle recovery avoids repeated cold opens when sources exceed actor slots', async () => {
  const root = await mkdtemp(join(Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-idle-source-churn-'));
  const system = DatabaseRuntime.open({ id: 'audit-system', role: 'system',
    sqlite: createPlatformSQLiteService({ mode: 'file', path: join(root, 'system.db'), emitTelemetry: false }), ownsSQLite: true });
  const catalog = new DatabaseAutomationSourceCatalog({ runtime: system });
  const actual = createSubprocessDatabaseExecutorFactory({ launch: { kind: 'source',
    entrypoint: fileURLToPath(new URL('../frontend/server/test-fixtures/auth-admission-hot/actor.ts', import.meta.url)) } });
  let launches = 0, completed = 0;
  const coordinator = new DatabaseCoordinator({ rootDirectory: join(root, 'actors'), realm, maxDatabases: 1,
    readers: false, sweepIntervalMs: false,
    placement: { default: 'hot', hot: { maxBytes: 4 * 1024 * 1024, durability: 'on-write' } },
    createExecutor(context) { launches++; return actual(context); },
  });
  coordinator.start();
  const dispatcher = new DatabaseAutomationDispatcher({ catalog, leaseOwner: 'audit-idle', sourceConcurrency: 1, now: () => 0,
    subscribe: notify => observeDatabaseCoordinatorCommits(coordinator, notify),
    emit: (_source, event) => { if (event.type === 'completed') completed++; },
    async acquire(source) {
      const lease = await coordinator.acquireExisting(deriveNamedDatabaseId(source.logicalSourceId));
      if (!lease) throw new Error('Expected a previously created synthetic source');
      return { delivery: createCoordinatorDatabaseAutomationDeliverySource(lease), registry: realm.automations!,
        services: { async create() { return { zero: {}, assertCurrentAuthority() {}, close() {} }; } },
        release: () => lease.release(),
      };
    },
  });
  try {
    for (const name of ['one', 'two', 'three']) {
      const lease = await coordinator.acquire(deriveNamedDatabaseId(name));
      lease.release();
      catalog.register({ sourceRef: createNamedDatabaseRef(name), sourceKind: 'named', logicalSourceId: name,
        authority: { scopeKind: 'application', scopeId: 'application', tenantId: null } });
    }
    const baseline = launches;
    await dispatcher.drainNow();
    const firstPass = launches - baseline;
    await dispatcher.drainNow();
    const secondPass = launches - baseline - firstPass;
    console.log(JSON.stringify({ audit: 'idle-source-churn', knownEmptySources: 3, actorSlots: 1,
      firstPassActorLaunches: firstPass, secondPassActorLaunches: secondPass }));
    expect(firstPass).toBe(3);
    expect(secondPass).toBe(0);
    expect(completed).toBe(0);
    const source = await coordinator.acquireExisting(deriveNamedDatabaseId('one'));
    expect(source).not.toBeNull();
    try {
      await source!.execute({ type: 'mutate', idempotencyKey: 'wake-idle-source',
        mutation: { type: 'create', table: 'functions', row: { id: 'wake', title: 'Wake source', source: 'test' } } });
    } finally { source!.release(); }
    // Frozen time means only the real commit hint can bypass idle backoff.
    await dispatcher.drainNow();
    expect(completed).toBe(1);
  } finally {
    await dispatcher.close(); await coordinator.close(); catalog.close(); system.close();
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);
