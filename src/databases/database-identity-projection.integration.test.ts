import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IdentityProjectionOutboxStore } from '../auth/identity-projection-outbox-store';
import { IdentityProjectionService } from '../auth/identity-projection-service';
import { createPlatformSQLiteService } from '../persistence';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import {
  createTenantDatabaseRef,
  deriveTenantDatabaseId,
} from './database-binding-ref';
import { DatabaseCoordinator } from './database-coordinator';
import { DatabaseError } from './database-error';
import { resolveDatabaseFile } from './database-file';
import {
  DatabaseManager,
  type DatabaseTenantEligibilityOptions,
  type DatabaseTenantIdentityProjectionOptions,
} from './database-manager';
import { DatabaseRuntime } from './database-runtime';
import { SubprocessDatabaseExecutor } from './subprocess-database-executor';
import { databaseGuardianActorFixtureRealm } from './test-fixtures/database-guardian-actor-realm';

const CHILD_PATH = fileURLToPath(new URL(
  './test-fixtures/database-guardian-actor-child.ts',
  import.meta.url,
));

describe('Guardian identity projection through Fabric', () => {
  const managers: DatabaseManager[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    for (const manager of managers.splice(0).reverse()) {
      await manager.close().catch(() => undefined);
    }
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reconciles ID-only anchors before tenant admission and replays idempotently', async () => {
    const system = runtime('system', 'system');
    const app = runtime('default', 'default');
    const outbox = new IdentityProjectionOutboxStore(system.db, {
      createInstallationId: () => 'installation-test',
      createEventId: sequenceIds('event'),
    });
    const projector = new IdentityProjectionService(outbox, {
      workerId: 'worker-test',
    });
    const tenantId = 'tenant-a';
    const targetId = `tenant:${createTenantDatabaseRef(tenantId)}`;
    outbox.registerTarget(targetId, 'tenant');
    outbox.enqueue(targetId, { kind: 'user', userId: 'user-a' });
    outbox.enqueue(targetId, {
      kind: 'membership',
      membershipId: 'membership-a',
      tenantId,
      userId: 'user-a',
    });

    let reconciliations = 0;
    const manager = createManager(system, app, roots, {
      installationId: outbox.getInstallationId(),
      targetIdForTenant: () => targetId,
      async reconcile(_tenantId, routedTargetId, target) {
        reconciliations += 1;
        await projector.reconcileTarget(routedTargetId, target);
      },
    });
    managers.push(manager);
    manager.start();

    const first = await manager.bindTenant({
      tenantId,
      assertCurrentAuthoritySync: () => undefined,
    });
    try {
      expect(outbox.getTargetState(targetId)).toMatchObject({
        status: 'ready',
        pendingDeliveries: 0,
        acknowledgedSequence: 2,
      });
      await expect(first.client.mutate({
        type: 'create',
        table: 'tasks',
        row: {
          task_id: 'task-a',
          assignee_membership_id: 'membership-a',
          title: 'Projected',
        },
      }, { idempotencyKey: 'task:create:a' })).resolves.toMatchObject({
        replayed: false,
      });
      await expect(databaseError(() => first.client.get('users', 'user-a')))
        .resolves.toMatchObject({ code: 'DATABASE_PAYLOAD_INVALID' });
    } finally {
      first.release();
    }

    const second = await manager.bindTenant({
      tenantId,
      assertCurrentAuthoritySync: () => undefined,
    });
    try {
      expect(await second.client.get('tasks', 'task-a')).toMatchObject({
        value: { assignee_membership_id: 'membership-a' },
      });
      expect(reconciliations).toBe(2);
      expect(outbox.getTargetState(targetId)?.acknowledgedSequence).toBe(2);
    } finally {
      second.release();
    }
  }, 20_000);

  test('projects retained anchors without contending with a Guardian authority commit', async () => {
    const system = runtime('system', 'system');
    const app = runtime('default', 'default');
    const outbox = new IdentityProjectionOutboxStore(system.db, {
      createInstallationId: () => 'installation-neutral',
      createEventId: sequenceIds('neutral-event'),
    });
    const projector = new IdentityProjectionService(outbox, {
      workerId: 'neutral-worker',
    });
    const tenantId = 'tenant-neutral';
    const targetId = `tenant:${createTenantDatabaseRef(tenantId)}`;
    outbox.registerTarget(targetId, 'tenant');
    outbox.enqueue(targetId, { kind: 'user', userId: 'user-neutral' });

    const harness = createManagerHarness(system, app, roots, {
      installationId: outbox.getInstallationId(),
      targetIdForTenant: () => targetId,
      async reconcile(_tenantId, routedTargetId, target) {
        await projector.reconcileTarget(routedTargetId, target);
      },
    });
    managers.push(harness.manager);
    harness.manager.start();

    const exclusive = await harness.authority.acquireExclusive();
    const projection = harness.manager.ensureTenantIdentityProjection(tenantId);
    let contended = false;
    const deadline = Date.now() + 5_000;
    try {
      while (true) {
        const state = await Promise.race([
          projection.then(() => 'complete' as const),
          Bun.sleep(5).then(() => 'pending' as const),
        ]);
        if (state === 'complete') break;
        if (harness.authority.diagnostics().pendingShared > 0) {
          contended = true;
          break;
        }
        if (Date.now() >= deadline) {
          throw new Error('Identity projection did not settle while authority was active.');
        }
      }
    } finally {
      exclusive.release();
      await projection;
    }

    expect(contended).toBe(false);
    expect(outbox.getTargetState(targetId)).toMatchObject({
      status: 'ready',
      acknowledgedSequence: 1,
      pendingDeliveries: 0,
    });
  }, 20_000);

  test('rechecks projection admission and releases a failed binding lease', async () => {
    const system = runtime('system', 'system');
    const app = runtime('default', 'default');
    const manager = createManager(system, app, roots, {
      installationId: 'installation-failure',
      targetIdForTenant: () => 'tenant:failure',
      async reconcile() {
        throw new Error('private reconciliation failure');
      },
    });
    managers.push(manager);
    manager.start();

    await expect(manager.bindTenant({
      tenantId: 'tenant-failure',
      assertCurrentAuthoritySync: () => undefined,
    })).rejects.toThrow('private reconciliation failure');
    const diagnostic = manager.diagnostics().coordinator?.databases[0];
    expect(diagnostic?.leases).toBe(0);

    await expect(manager.bindTenantSync({
      tenantId: 'tenant-sync-failure',
      assertCurrentAuthoritySync: () => undefined,
    })).rejects.toThrow('private reconciliation failure');
    expect(manager.diagnostics().coordinator).toMatchObject({
      tenantSyncBindings: 0,
    });
    expect(manager.diagnostics().coordinator?.databases
      .every((entry) => entry.leases === 0)).toBe(true);

    await expect(manager.ensureTenantIdentityProjection(
      'tenant-ensure-failure',
    )).rejects.toThrow('private reconciliation failure');
    expect(manager.diagnostics().coordinator?.databases
      .every((entry) => entry.leases === 0)).toBe(true);

    let current = true;
    await expect(manager.bindTenant({
      tenantId: 'tenant-revoked',
      assertCurrentAuthoritySync: () => {
        if (!current) throw new Error('revoked');
        return undefined;
      },
    })).rejects.toThrow('private reconciliation failure');
    current = false;
    await expect(databaseError(() => manager.bindTenant({
      tenantId: 'tenant-revoked',
      assertCurrentAuthoritySync: () => {
        if (!current) throw new Error('revoked');
        return undefined;
      },
    }))).resolves.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
  }, 20_000);

  test('checks Guardian tenant eligibility before bind, ensure, or inspect can create a file', async () => {
    const system = runtime('system', 'system');
    const app = runtime('default', 'default');
    const tenantId = 'tenant-ineligible';
    let eligibilityChecks = 0;
    const harness = createManagerHarness(system, app, roots, {
      installationId: 'installation-ineligible',
      targetIdForTenant: () => 'tenant:ineligible',
      async reconcile() {
        throw new Error('projection must not run');
      },
    }, {
      assertEligible() {
        eligibilityChecks += 1;
        throw new Error('/private/ineligible-tenant');
      },
    });
    managers.push(harness.manager);
    harness.manager.start();
    const filePath = resolveDatabaseFile(
      harness.root,
      deriveTenantDatabaseId(tenantId),
    ).path;

    for (const operation of [
      () => harness.manager.bindTenant({
        tenantId,
        assertCurrentAuthoritySync: () => undefined,
      }),
      () => harness.manager.ensureTenantIdentityProjection(tenantId),
      () => harness.manager.inspectTenantIdentityProjection(tenantId),
    ]) {
      await expect(databaseError(operation)).resolves.toMatchObject({
        code: 'DATABASE_AUTHORITY_CHANGED',
        retryable: false,
        outcome: 'not-started',
      });
      expect(existsSync(filePath)).toBe(false);
    }

    expect(eligibilityChecks).toBe(3);
    expect(harness.coordinator.diagnostics()).toMatchObject({
      databaseFiles: 0,
      openDatabases: 0,
      databases: [],
    });
  }, 20_000);

  test('inspects target-local readiness without creating a missing tenant file', async () => {
    const system = runtime('system', 'system');
    const app = runtime('default', 'default');
    const outbox = new IdentityProjectionOutboxStore(system.db, {
      createInstallationId: () => 'installation-inspection',
      createEventId: sequenceIds('inspection-event'),
    });
    const projector = new IdentityProjectionService(outbox, {
      workerId: 'inspection-worker',
    });
    let failTargetResolution = false;
    const tenantId = 'tenant-inspection';
    const physicalId = deriveTenantDatabaseId(tenantId);
    const targetId = `tenant:${createTenantDatabaseRef(tenantId)}`;
    outbox.registerTarget(targetId, 'tenant');
    outbox.enqueue(targetId, { kind: 'user', userId: 'user-inspection' });

    const harness = createManagerHarness(system, app, roots, {
      installationId: outbox.getInstallationId(),
      targetIdForTenant: () => {
        if (failTargetResolution) {
          throw new Error('private target-resolution failure');
        }
        return targetId;
      },
      async reconcile(_tenantId, routedTargetId, target) {
        await projector.reconcileTarget(routedTargetId, target);
      },
    });
    managers.push(harness.manager);
    harness.manager.start();
    const filePath = resolveDatabaseFile(harness.root, physicalId).path;

    expect(await harness.manager.inspectTenantIdentityProjection(tenantId))
      .toBeNull();
    expect(existsSync(filePath)).toBe(false);

    await harness.manager.ensureTenantIdentityProjection(tenantId);
    await expect(harness.manager.inspectTenantIdentityProjection(tenantId))
      .resolves.toMatchObject({
        installationId: outbox.getInstallationId(),
        targetId,
        status: 'ready',
        watermark: 1,
      });
    expect(harness.coordinator.diagnostics().databases
      .every((entry) => entry.leases === 0)).toBe(true);

    failTargetResolution = true;
    await expect(harness.manager.inspectTenantIdentityProjection(tenantId))
      .rejects.toThrow('private target-resolution failure');
    expect(harness.coordinator.diagnostics().databases
      .every((entry) => entry.leases === 0)).toBe(true);
    failTargetResolution = false;

    expect(await harness.coordinator.evict(physicalId)).toBe(true);
    rmSync(filePath, { force: true });
    expect(await harness.manager.inspectTenantIdentityProjection(tenantId))
      .toBeNull();
    expect(existsSync(filePath)).toBe(false);

    await harness.manager.close();
    await expect(databaseError(() =>
      harness.manager.inspectTenantIdentityProjection(tenantId)))
      .resolves.toMatchObject({ code: 'DATABASE_CLOSED' });
  }, 20_000);
});

function createManager(
  systemRuntime: DatabaseRuntime,
  appRuntime: DatabaseRuntime,
  roots: string[],
  projection: DatabaseTenantIdentityProjectionOptions,
): DatabaseManager {
  return createManagerHarness(
    systemRuntime,
    appRuntime,
    roots,
    projection,
  ).manager;
}

function createManagerHarness(
  systemRuntime: DatabaseRuntime,
  appRuntime: DatabaseRuntime,
  roots: string[],
  projection: DatabaseTenantIdentityProjectionOptions,
  eligibility?: DatabaseTenantEligibilityOptions,
): Readonly<{
  manager: DatabaseManager;
  coordinator: DatabaseCoordinator;
  authority: AuthorityCommitCoordinator;
  root: string;
}> {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'zero-guardian-fabric-')));
  roots.push(root);
  const authority = new AuthorityCommitCoordinator();
  const coordinator = new DatabaseCoordinator({
    rootDirectory: root,
    realm: databaseGuardianActorFixtureRealm,
    maxDatabases: 2,
    maxTenantSyncDatabases: 2,
    sweepIntervalMs: false,
    operationTimeoutMs: 5_000,
    authorityCommitCoordinator: authority,
    requireCommitAuthority: true,
    createExecutor: ({ role, slot }) => new SubprocessDatabaseExecutor({
      command: [process.execPath, CHILD_PATH, role, String(slot)],
      env: {},
      role,
      slot,
      maxInFlight: 1,
      startupTimeoutMs: 2_000,
      operationTimeoutMs: 5_000,
      shutdownAckTimeoutMs: 1_000,
      shutdownExitTimeoutMs: 1_000,
      sigtermTimeoutMs: 500,
      sigkillTimeoutMs: 500,
    }),
  });
  const manager = new DatabaseManager({
    systemRuntime,
    appRuntime,
    multiple: {
      coordinator,
      authorityCommitCoordinator: authority,
      tenantDatabases: true,
      tenantIdentityProjection: projection,
      ...(eligibility ? { tenantDatabaseEligibility: eligibility } : {}),
    },
  });
  return Object.freeze({ manager, coordinator, authority, root });
}

function runtime(id: string, role: 'system' | 'default'): DatabaseRuntime {
  return DatabaseRuntime.open({
    id,
    role,
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }),
    ownsSQLite: true,
  });
}

function sequenceIds(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

async function databaseError(operation: () => Promise<unknown>): Promise<DatabaseError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}
