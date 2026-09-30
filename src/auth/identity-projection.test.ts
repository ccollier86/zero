import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { DatabaseError } from '../databases/database-error';
import { OBS_CODES } from '../observability/codes';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { IdentityAnchorStore } from './identity-anchor-store';
import { IdentityProjectionError } from './identity-projection-error';
import { createIdentityProjectionLifecycleHook } from './identity-projection-lifecycle';
import { IdentityProjectionOutboxStore } from './identity-projection-outbox-store';
import {
  assertExactIdentityProjectionStateSQLiteTable,
  assertExactIdentityProjectionSystemSQLiteTables,
  defineIdentityAnchorTables,
  defineIdentityProjectionSystemTables,
  IDENTITY_PROJECTION_STATE_TABLE,
} from './identity-projection-schema';
import { IdentityProjectionService } from './identity-projection-service';
import { TenantStore } from './tenancy';
import { UserStore } from './user-store';

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('Guardian ID-only identity projection', () => {
  test('installs only ID anchors with retained membership referential integrity', () => {
    const db = memoryDb();
    defineIdentityAnchorTables(db);

    expect(columnNames(db, 'users')).toEqual(['user_id']);
    expect(columnNames(db, 'tenant_memberships')).toEqual([
      'membership_id',
      'tenant_id',
      'user_id',
    ]);
    expect(() => db.prepare(`
      INSERT INTO tenant_memberships (membership_id, tenant_id, user_id)
      VALUES ('m_missing', 't_one', 'u_missing')
    `).run()).toThrow();

    db.prepare('INSERT INTO users (user_id) VALUES (?)').run('u_one');
    db.prepare(`
      INSERT INTO tenant_memberships (membership_id, tenant_id, user_id)
      VALUES (?, ?, ?)
    `).run('m_one', 't_one', 'u_one');
    expect(() => db.prepare('DELETE FROM users WHERE user_id = ?').run('u_one'))
      .toThrow();
  });

  test('rejects a legacy profile-bearing users table instead of copying PII', () => {
    const db = memoryDb();
    db.exec(`CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL
    )`);
    expect(() => defineIdentityAnchorTables(db)).toThrow(expect.objectContaining({
      code: 'IDENTITY_PROJECTION_SCHEMA_INVALID',
    }));
  });

  test('rejects a managed projection table with a weakened CHECK contract', () => {
    const db = memoryDb();
    defineIdentityAnchorTables(db);
    db.exec(`
      DROP TABLE ${IDENTITY_PROJECTION_STATE_TABLE};
      CREATE TABLE ${IDENTITY_PROJECTION_STATE_TABLE} (
        singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
        installation_id TEXT NOT NULL,
        target_id       TEXT NOT NULL,
        status          TEXT NOT NULL,
        watermark       INTEGER NOT NULL DEFAULT 0 CHECK (watermark >= 0),
        quarantine_code TEXT,
        updated_at      INTEGER NOT NULL
      );
    `);

    expect(() => assertExactIdentityProjectionStateSQLiteTable(db)).toThrow(
      expect.objectContaining({ code: 'IDENTITY_PROJECTION_SCHEMA_INVALID' }),
    );
  });

  test('rejects a managed projection table with the wrong durable default', () => {
    const db = memoryDb();
    defineIdentityAnchorTables(db);
    db.exec(`
      DROP TABLE ${IDENTITY_PROJECTION_STATE_TABLE};
      CREATE TABLE ${IDENTITY_PROJECTION_STATE_TABLE} (
        singleton       INTEGER PRIMARY KEY CHECK (singleton = 1),
        installation_id TEXT NOT NULL,
        target_id       TEXT NOT NULL,
        status          TEXT NOT NULL CHECK (
          status IN ('provisioning', 'ready', 'quarantined')
        ),
        watermark       INTEGER NOT NULL DEFAULT 1 CHECK (watermark >= 0),
        quarantine_code TEXT,
        updated_at      INTEGER NOT NULL
      );
    `);

    expect(() => assertExactIdentityProjectionStateSQLiteTable(db)).toThrow(
      expect.objectContaining({ code: 'IDENTITY_PROJECTION_SCHEMA_INVALID' }),
    );
  });

  test('rejects a managed source journal with a missing delivery index', () => {
    const db = memoryDb();
    defineIdentityProjectionSystemTables(db);
    db.exec('DROP INDEX idx_auth_identity_projection_due');

    expect(() => assertExactIdentityProjectionSystemSQLiteTables(db)).toThrow(
      expect.objectContaining({ code: 'IDENTITY_PROJECTION_SCHEMA_INVALID' }),
    );
  });

  test('applies ordered anchors, records receipts, and converges target readiness', async () => {
    const clock = mutableClock(100);
    const system = memoryDb();
    const targetDb = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('app-main', 'application');
    const target = new IdentityAnchorStore(targetDb, {
      installationId: 'install-one',
      targetId: 'app-main',
    }, { now: clock.now });
    const service = new IdentityProjectionService(outbox, {
      workerId: 'worker-one',
      now: clock.now,
      emitCode: silentEmitter,
    });

    await service.ensureAnchor('app-main', {
      kind: 'membership',
      membershipId: 'm_one',
      tenantId: 't_one',
      userId: 'u_one',
    }, target);

    expect(targetDb.prepare('SELECT * FROM users').all()).toEqual([
      { user_id: 'u_one' },
    ]);
    expect(targetDb.prepare('SELECT * FROM tenant_memberships').all()).toEqual([
      { membership_id: 'm_one', tenant_id: 't_one', user_id: 'u_one' },
    ]);
    expect(target.inspect()).toMatchObject({
      status: 'ready',
      watermark: 1,
      targetId: 'app-main',
    });
    expect(outbox.getTargetState('app-main')).toMatchObject({
      status: 'ready',
      acknowledgedSequence: 1,
      pendingDeliveries: 0,
    });

    const duplicate = await service.ensureAnchor('app-main', {
      kind: 'membership',
      membershipId: 'm_one',
      tenantId: 't_one',
      userId: 'u_one',
    }, target);
    expect(duplicate.receipt.duplicate).toBe(true);
    expect(outbox.getTargetState('app-main')?.acknowledgedSequence).toBe(1);
  });

  test('recovers a crash after target commit without duplicating the anchor', () => {
    const clock = mutableClock(500);
    const system = memoryDb();
    const targetDb = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-a', 'tenant');
    const target = new IdentityAnchorStore(targetDb, {
      installationId: 'install-one',
      targetId: 'tenant-a',
    }, { now: clock.now });
    outbox.enqueue('tenant-a', { kind: 'user', userId: 'u_one' });

    const first = outbox.claimNext('tenant-a', 'worker-one', 10)!;
    const firstReceipt = target.apply(first);
    expect(firstReceipt.duplicate).toBe(false);
    // Simulate process death before source acknowledgement.
    clock.advance(10);
    expect(outbox.recoverExpired()).toBe(1);
    const replay = outbox.claimNext('tenant-a', 'worker-two', 10)!;
    const replayReceipt = target.apply(replay);
    expect(replayReceipt).toMatchObject({
      eventId: first.eventId,
      sequence: first.sequence,
      duplicate: true,
    });
    outbox.acknowledge(replay, replayReceipt);
    expect(targetDb.prepare('SELECT COUNT(*) AS count FROM users').get())
      .toEqual({ count: 1 });
    expect(outbox.getTargetState('tenant-a')?.pendingDeliveries).toBe(0);
  });

  test('fences stale delivery transitions after the same worker reclaims a lease', () => {
    const clock = mutableClock(600);
    const system = memoryDb();
    const targetDb = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-lease-generation', 'tenant');
    const target = new IdentityAnchorStore(targetDb, {
      installationId: outbox.getInstallationId(),
      targetId: 'tenant-lease-generation',
    }, { now: clock.now });
    outbox.enqueue('tenant-lease-generation', {
      kind: 'user',
      userId: 'user-lease-generation',
    });

    const stale = outbox.claimNext(
      'tenant-lease-generation',
      'worker-reused',
      10,
    )!;
    const staleReceipt = target.apply(stale);
    clock.advance(10);
    expect(outbox.recoverExpired()).toBe(1);
    const current = outbox.claimNext(
      'tenant-lease-generation',
      'worker-reused',
      10,
    )!;
    expect(current).toMatchObject({ attempts: 2, leaseOwner: 'worker-reused' });

    expect(() => outbox.acknowledge(stale, staleReceipt)).toThrow(
      expect.objectContaining({ code: 'IDENTITY_PROJECTION_LEASE_LOST' }),
    );
    expect(() => outbox.release(
      stale,
      clock.now(),
      'IDENTITY_PROJECTION_NOT_READY',
    )).toThrow(expect.objectContaining({ code: 'IDENTITY_PROJECTION_LEASE_LOST' }));
    expect(() => outbox.quarantine(
      stale,
      'IDENTITY_PROJECTION_CONFLICT',
    )).toThrow(expect.objectContaining({ code: 'IDENTITY_PROJECTION_LEASE_LOST' }));
    expect(system.prepare(`
      SELECT status, attempts, lease_owner
      FROM _auth_identity_projection_outbox
      WHERE target_id = 'tenant-lease-generation' AND sequence = 1
    `).get()).toEqual({
      status: 'processing',
      attempts: 2,
      lease_owner: 'worker-reused',
    });

    const currentReceipt = target.apply(current);
    expect(currentReceipt.duplicate).toBe(true);
    outbox.acknowledge(current, currentReceipt);
    expect(() => outbox.acknowledge(stale, staleReceipt)).toThrow(
      expect.objectContaining({ code: 'IDENTITY_PROJECTION_LEASE_LOST' }),
    );
    expect(outbox.getTargetState('tenant-lease-generation')).toMatchObject({
      acknowledgedSequence: 1,
      pendingDeliveries: 0,
      status: 'provisioning',
    });
  });

  test('enforces durable lease and target-watermark invariants in SQLite', () => {
    const system = memoryDb();
    const outbox = deterministicOutbox(system, mutableClock(700));
    outbox.registerTarget('tenant-schema-fence', 'tenant');
    outbox.enqueue('tenant-schema-fence', {
      kind: 'user',
      userId: 'user-schema-fence',
    });

    expect(() => system.prepare(`
      UPDATE _auth_identity_projection_outbox
      SET status = 'processing', attempts = 1
      WHERE target_id = 'tenant-schema-fence' AND sequence = 1
    `).run()).toThrow();
    expect(() => system.prepare(`
      UPDATE _auth_identity_projection_targets
      SET acknowledged_sequence = next_sequence
      WHERE target_id = 'tenant-schema-fence'
    `).run()).toThrow();
  });

  test('persists source leases and target receipts across a file restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-identity-projection-'));
    const systemPath = join(directory, 'system.db');
    const targetPath = join(directory, 'tenant.db');
    const clock = mutableClock(800);
    let system: ReactiveDB | null = null;
    let targetDb: ReactiveDB | null = null;
    try {
      system = createReactiveDB({ mode: 'file', path: systemPath });
      targetDb = createReactiveDB({ mode: 'file', path: targetPath });
      const firstOutbox = deterministicOutbox(system, clock);
      firstOutbox.registerTarget('tenant-file', 'tenant');
      const firstTarget = new IdentityAnchorStore(targetDb, {
        installationId: 'install-one',
        targetId: 'tenant-file',
      }, { now: clock.now });
      firstOutbox.enqueue('tenant-file', { kind: 'user', userId: 'u_file' });
      const claimed = firstOutbox.claimNext('tenant-file', 'worker-one', 10)!;
      expect(firstTarget.apply(claimed).duplicate).toBe(false);
      targetDb.dispose();
      targetDb = null;
      system.dispose();
      system = null;

      clock.advance(10);
      system = createReactiveDB({ mode: 'file', path: systemPath });
      targetDb = createReactiveDB({ mode: 'file', path: targetPath });
      const recoveredOutbox = deterministicOutbox(system, clock);
      const recoveredTarget = new IdentityAnchorStore(targetDb, {
        installationId: 'install-one',
        targetId: 'tenant-file',
      }, { now: clock.now });
      expect(recoveredOutbox.recoverExpired()).toBe(1);
      const replay = recoveredOutbox.claimNext('tenant-file', 'worker-two', 10)!;
      const receipt = recoveredTarget.apply(replay);
      expect(receipt.duplicate).toBe(true);
      recoveredOutbox.acknowledge(replay, receipt);
      expect(recoveredOutbox.getTargetState('tenant-file')).toMatchObject({
        acknowledgedSequence: 1,
        pendingDeliveries: 0,
      });
    } finally {
      targetDb?.dispose();
      system?.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('replays completed history into a rebuilt target behind the source watermark', async () => {
    const clock = mutableClock(900);
    const system = memoryDb();
    const originalDb = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-rebuilt', 'tenant');
    const original = new IdentityAnchorStore(originalDb, {
      installationId: 'install-one',
      targetId: 'tenant-rebuilt',
    }, { now: clock.now });
    const service = new IdentityProjectionService(outbox, {
      workerId: 'worker-one',
      now: clock.now,
      emitCode: silentEmitter,
    });
    await service.ensureAnchor('tenant-rebuilt', {
      kind: 'user',
      userId: 'u_rebuilt',
    }, original);
    await service.ensureAnchor('tenant-rebuilt', {
      kind: 'membership',
      membershipId: 'm_rebuilt',
      tenantId: 't_rebuilt',
      userId: 'u_rebuilt',
    }, original);
    expect(outbox.getTargetState('tenant-rebuilt')?.acknowledgedSequence).toBe(2);

    const rebuiltDb = memoryDb();
    const rebuilt = new IdentityAnchorStore(rebuiltDb, {
      installationId: 'install-one',
      targetId: 'tenant-rebuilt',
    }, { now: clock.now });
    const result = await service.reconcileTarget('tenant-rebuilt', rebuilt);
    expect(result).toMatchObject({
      processed: 2,
      state: { status: 'ready', pendingDeliveries: 0 },
    });
    expect(rebuilt.inspect().watermark).toBe(2);
    expect(rebuiltDb.prepare('SELECT * FROM tenant_memberships').all()).toEqual([
      {
        membership_id: 'm_rebuilt',
        tenant_id: 't_rebuilt',
        user_id: 'u_rebuilt',
      },
    ]);
  });

  test('retries rebuilt-target replay without reopening completed source history', async () => {
    const clock = mutableClock(925);
    const system = memoryDb();
    const originalDb = memoryDb();
    const rebuiltDb = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-replay-retry', 'tenant');
    const original = new IdentityAnchorStore(originalDb, {
      installationId: outbox.getInstallationId(),
      targetId: 'tenant-replay-retry',
    }, { now: clock.now });
    const service = new IdentityProjectionService(outbox, {
      workerId: 'worker-replay-retry',
      now: clock.now,
      emitCode: silentEmitter,
    });
    await service.ensureAnchor('tenant-replay-retry', {
      kind: 'user',
      userId: 'user-replay-retry',
    }, original);

    const rebuilt = new IdentityAnchorStore(rebuiltDb, {
      installationId: outbox.getInstallationId(),
      targetId: 'tenant-replay-retry',
    }, { now: clock.now });
    let fail = true;
    const flakyRebuilt = {
      inspect: () => rebuilt.inspect(),
      apply(delivery: Parameters<IdentityAnchorStore['apply']>[0]) {
        if (fail) {
          throw new DatabaseError(
            'DATABASE_NOT_READY',
            'private rebuilt target path',
            { retryable: true, outcome: 'not-started' },
          );
        }
        return rebuilt.apply(delivery);
      },
      markReady: () => rebuilt.markReady(),
    };

    await expect(service.reconcileTarget('tenant-replay-retry', flakyRebuilt))
      .rejects.toMatchObject({ code: 'DATABASE_NOT_READY' });
    expect(system.prepare(`
      SELECT status, attempts, lease_owner, completed_at
      FROM _auth_identity_projection_outbox
      WHERE target_id = 'tenant-replay-retry' AND sequence = 1
    `).get()).toEqual({
      status: 'completed',
      attempts: 1,
      lease_owner: null,
      completed_at: 925,
    });
    expect(outbox.getTargetState('tenant-replay-retry')).toMatchObject({
      status: 'ready',
      acknowledgedSequence: 1,
      pendingDeliveries: 0,
    });

    fail = false;
    await expect(service.reconcileTarget('tenant-replay-retry', flakyRebuilt))
      .resolves.toMatchObject({
        processed: 1,
        state: { status: 'ready', acknowledgedSequence: 1 },
      });
    expect(rebuilt.inspect()).toMatchObject({ status: 'ready', watermark: 1 });
  });

  test('keeps a verified-ready reconcile read-only on both projection planes', async () => {
    const clock = mutableClock(950);
    const system = memoryDb();
    const targetDb = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-ready', 'tenant');
    const target = new IdentityAnchorStore(targetDb, {
      installationId: outbox.getInstallationId(),
      targetId: 'tenant-ready',
    }, { now: clock.now });
    const emitted: string[] = [];
    const service = new IdentityProjectionService(outbox, {
      workerId: 'worker-ready',
      now: clock.now,
      emitCode: (definition) => {
        emitted.push(definition.code);
        return {} as never;
      },
    });
    await service.ensureAnchor('tenant-ready', {
      kind: 'user',
      userId: 'u_ready',
    }, target);
    emitted.length = 0;
    await service.ensureAnchor('tenant-ready', {
      kind: 'user',
      userId: 'u_ready',
    }, target);
    expect(emitted).toEqual([]);

    let inspectCalls = 0;
    let applyCalls = 0;
    let markReadyCalls = 0;
    const observedTarget = {
      inspect() {
        inspectCalls += 1;
        return target.inspect();
      },
      apply(delivery: Parameters<IdentityAnchorStore['apply']>[0]) {
        applyCalls += 1;
        return target.apply(delivery);
      },
      markReady() {
        markReadyCalls += 1;
        target.markReady();
      },
    };
    const before = outbox.getTargetState('tenant-ready')!;
    clock.advance(100);
    const reconciled = await service.reconcileTarget('tenant-ready', observedTarget);

    expect(reconciled).toEqual({ processed: 0, state: before });
    expect(inspectCalls).toBe(1);
    expect(applyCalls).toBe(0);
    expect(markReadyCalls).toBe(0);
    expect(outbox.getTargetState('tenant-ready')).toEqual(before);
  });

  test('reports retrying source state after a transient target failure then converges', async () => {
    const clock = mutableClock(975);
    const system = memoryDb();
    const targetDb = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-retry', 'tenant');
    const target = new IdentityAnchorStore(targetDb, {
      installationId: outbox.getInstallationId(),
      targetId: 'tenant-retry',
    }, { now: clock.now });
    let fail = true;
    const flakyTarget = {
      inspect: () => target.inspect(),
      apply(delivery: Parameters<IdentityAnchorStore['apply']>[0]) {
        if (fail) {
          throw new DatabaseError(
            'DATABASE_NOT_READY',
            'private transient failure',
            { retryable: true, outcome: 'not-started' },
          );
        }
        return target.apply(delivery);
      },
      markReady: () => target.markReady(),
    };
    const service = new IdentityProjectionService(outbox, {
      workerId: 'worker-retry',
      now: clock.now,
      retryDelayMs: 10,
      emitCode: silentEmitter,
    });

    await expect(service.ensureAnchor('tenant-retry', {
      kind: 'user',
      userId: 'u_retry',
    }, flakyTarget)).rejects.toMatchObject({
      code: 'DATABASE_NOT_READY',
      retryable: true,
      outcome: 'not-started',
    });
    expect(outbox.getTargetState('tenant-retry')).toMatchObject({
      status: 'provisioning',
      pendingDeliveries: 1,
      lastErrorCode: 'DATABASE_NOT_READY',
    });

    fail = false;
    clock.advance(10);
    await expect(service.reconcileTarget('tenant-retry', flakyTarget))
      .resolves.toMatchObject({
        processed: 1,
        state: { status: 'ready', pendingDeliveries: 0 },
      });
    expect(targetDb.prepare('SELECT user_id FROM users WHERE user_id = ?')
      .get('u_retry')).toEqual({ user_id: 'u_retry' });
  });

  test('quarantines terminal and unknown-outcome database failures on both runners', async () => {
    const failures = [
      {
        targetId: 'tenant-config-failure',
        code: 'DATABASE_CONFIG_INVALID' as const,
        outcome: 'not-started' as const,
        synchronous: false,
      },
      {
        targetId: 'tenant-schema-failure',
        code: 'DATABASE_SCHEMA_MISMATCH' as const,
        outcome: 'not-started' as const,
        synchronous: true,
      },
      {
        targetId: 'tenant-unknown-outcome',
        code: 'DATABASE_OUTCOME_UNKNOWN' as const,
        outcome: 'unknown' as const,
        synchronous: false,
      },
    ];

    for (const failure of failures) {
      const clock = mutableClock(980);
      const system = memoryDb();
      const targetDb = memoryDb();
      const outbox = deterministicOutbox(system, clock);
      outbox.registerTarget(failure.targetId, 'tenant');
      const target = new IdentityAnchorStore(targetDb, {
        installationId: outbox.getInstallationId(),
        targetId: failure.targetId,
      }, { now: clock.now });
      const emitted: Array<{
        code: string;
        options: Parameters<AuthPlatformCodeEmitter>[1];
      }> = [];
      const service = new IdentityProjectionService(outbox, {
        workerId: `worker-${failure.targetId}`,
        now: clock.now,
        emitCode(definition, options) {
          emitted.push({ code: definition.code, options });
          return {} as never;
        },
      });
      const databaseFailure = new DatabaseError(
        failure.code,
        `private ${failure.code} details`,
        { retryable: false, outcome: failure.outcome },
      );
      const failingTarget = {
        inspect: () => target.inspect(),
        apply() {
          throw databaseFailure;
        },
        markReady: () => target.markReady(),
      };
      const anchor = { kind: 'user' as const, userId: `user-${failure.targetId}` };

      if (failure.synchronous) {
        expect(() => service.ensureAnchorSync(
          failure.targetId,
          anchor,
          failingTarget,
        )).toThrow(expect.objectContaining({ code: failure.code }));
      } else {
        await expect(service.ensureAnchor(
          failure.targetId,
          anchor,
          failingTarget,
        )).rejects.toMatchObject({ code: failure.code });
      }

      expect(outbox.getTargetState(failure.targetId)).toMatchObject({
        status: 'quarantined',
        pendingDeliveries: 1,
        lastErrorCode: failure.code,
      });
      expect(emitted.some(({ code }) =>
        code === OBS_CODES.AUTH_IDENTITY_PROJECTION_RETRY.code)).toBe(false);
      const quarantine = emitted.find(({ code }) =>
        code === OBS_CODES.AUTH_IDENTITY_PROJECTION_QUARANTINED.code);
      expect(quarantine?.options?.metadata).toMatchObject({
        scope: 'tenant',
        code: failure.code,
      });
      expect(quarantine?.options?.error).toBeUndefined();
      expect(JSON.stringify(emitted)).not.toContain(`private ${failure.code} details`);
    }
  });

  test('never reports reconciliation success while another worker owns live work', async () => {
    const clock = mutableClock(990);
    const system = memoryDb();
    const targetDb = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-leased', 'tenant');
    outbox.enqueue('tenant-leased', { kind: 'user', userId: 'u_leased' });
    const leased = outbox.claimNext('tenant-leased', 'worker-active', 100)!;
    const target = new IdentityAnchorStore(targetDb, {
      installationId: outbox.getInstallationId(),
      targetId: 'tenant-leased',
    }, { now: clock.now });
    const service = new IdentityProjectionService(outbox, {
      workerId: 'worker-admission',
      now: clock.now,
      emitCode: silentEmitter,
    });

    await expect(service.reconcileTarget('tenant-leased', target))
      .rejects.toMatchObject({
        code: 'IDENTITY_PROJECTION_NOT_READY',
        retryable: true,
      });
    expect(outbox.getTargetState('tenant-leased')).toMatchObject({
      status: 'provisioning',
      pendingDeliveries: 1,
    });

    const receipt = target.apply(leased);
    outbox.acknowledge(leased, receipt);
    await expect(service.reconcileTarget('tenant-leased', target))
      .resolves.toMatchObject({
        processed: 0,
        state: { status: 'ready', pendingDeliveries: 0 },
      });
  });

  test('persists one installation identity across system runtime reconstruction', () => {
    const system = memoryDb();
    const first = new IdentityProjectionOutboxStore(system, {
      createInstallationId: () => 'installation-persisted',
    });
    const second = new IdentityProjectionOutboxStore(system, {
      createInstallationId: () => {
        throw new Error('must not replace installation identity');
      },
    });
    expect(first.getInstallationId()).toBe('installation-persisted');
    expect(second.getInstallationId()).toBe('installation-persisted');
  });

  test('commits source quarantine before rejecting a conflicting retained ID', () => {
    const clock = mutableClock(995);
    const system = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-source-conflict', 'tenant');
    const original = outbox.enqueue('tenant-source-conflict', {
      kind: 'membership',
      membershipId: 'membership-fixed',
      tenantId: 'tenant-original',
      userId: 'user-original',
    });

    expect(() => outbox.enqueue('tenant-source-conflict', {
      kind: 'membership',
      membershipId: 'membership-fixed',
      tenantId: 'tenant-reassigned',
      userId: 'user-reassigned',
    })).toThrow(expect.objectContaining({
      code: 'IDENTITY_PROJECTION_CONFLICT',
      retryable: false,
    }));

    expect(outbox.getTargetState('tenant-source-conflict')).toMatchObject({
      status: 'quarantined',
      pendingDeliveries: 1,
      lastErrorCode: 'IDENTITY_PROJECTION_CONFLICT',
    });
    expect(system.prepare(`
      SELECT status, tenant_id, user_id
      FROM _auth_identity_projection_outbox
      WHERE event_id = ?
    `).get(original.eventId)).toEqual({
      status: 'pending',
      tenant_id: 'tenant-original',
      user_id: 'user-original',
    });
  });

  test('preserves source quarantine when a wider Guardian transaction rolls back', () => {
    const clock = mutableClock(996);
    const system = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-nested-conflict', 'tenant');
    outbox.enqueue('tenant-nested-conflict', {
      kind: 'membership',
      membershipId: 'membership-retained',
      tenantId: 'tenant-original',
      userId: 'user-original',
    });

    expect(() => system.transaction(() => {
      system.prepare(`
        CREATE TEMP TABLE nested_guardian_write (value TEXT NOT NULL)
      `).run();
      outbox.enqueue('tenant-nested-conflict', {
        kind: 'membership',
        membershipId: 'membership-retained',
        tenantId: 'tenant-reassigned',
        userId: 'user-reassigned',
      });
    })).toThrow(expect.objectContaining({
      code: 'IDENTITY_PROJECTION_CONFLICT',
      retryable: false,
    }));

    expect(outbox.getTargetState('tenant-nested-conflict')).toMatchObject({
      status: 'quarantined',
      pendingDeliveries: 1,
      lastErrorCode: 'IDENTITY_PROJECTION_CONFLICT',
    });
    expect(system.prepare(`
      SELECT name FROM sqlite_temp_master
      WHERE type = 'table' AND name = 'nested_guardian_write'
    `).get()).toBeNull();
  });

  test('keeps durable success authoritative when a custom emitter throws', async () => {
    for (const synchronous of [false, true]) {
      const clock = mutableClock(998);
      const system = memoryDb();
      const targetDb = memoryDb();
      const targetId = synchronous ? 'app-emitter-sync' : 'tenant-emitter-async';
      const outbox = deterministicOutbox(system, clock);
      outbox.registerTarget(targetId, synchronous ? 'application' : 'tenant');
      const target = new IdentityAnchorStore(targetDb, {
        installationId: outbox.getInstallationId(),
        targetId,
      }, { now: clock.now });
      const service = new IdentityProjectionService(outbox, {
        workerId: `worker-${targetId}`,
        now: clock.now,
        emitCode: () => {
          throw new Error('private observability sink failure');
        },
      });
      const anchor = { kind: 'user' as const, userId: `user-${targetId}` };

      if (synchronous) {
        expect(() => service.ensureAnchorSync(targetId, anchor, target)).not.toThrow();
      } else {
        await expect(service.ensureAnchor(targetId, anchor, target)).resolves.toMatchObject({
          receipt: { duplicate: false },
        });
      }

      expect(outbox.getTargetState(targetId)).toMatchObject({
        status: 'ready',
        acknowledgedSequence: 1,
        pendingDeliveries: 0,
        lastErrorCode: null,
      });
      expect(target.inspect()).toMatchObject({ status: 'ready', watermark: 1 });
    }
  });

  test('quarantines both planes when a retained ID has conflicting meaning', async () => {
    const clock = mutableClock(1_000);
    const system = memoryDb();
    const targetDb = memoryDb();
    const outbox = deterministicOutbox(system, clock);
    outbox.registerTarget('tenant-a', 'tenant');
    const target = new IdentityAnchorStore(targetDb, {
      installationId: 'install-one',
      targetId: 'tenant-a',
    }, { now: clock.now });
    targetDb.prepare('INSERT INTO users (user_id) VALUES (?)').run('u_wrong');
    targetDb.prepare(`
      INSERT INTO tenant_memberships (membership_id, tenant_id, user_id)
      VALUES (?, ?, ?)
    `).run('m_fixed', 't_wrong', 'u_wrong');
    const service = new IdentityProjectionService(outbox, {
      workerId: 'worker-one',
      now: clock.now,
      emitCode: silentEmitter,
    });

    await expect(service.ensureAnchor('tenant-a', {
      kind: 'membership',
      membershipId: 'm_fixed',
      tenantId: 't_right',
      userId: 'u_right',
    }, target)).rejects.toMatchObject({
      code: 'IDENTITY_PROJECTION_CONFLICT',
      retryable: false,
    });
    expect(target.inspect()).toMatchObject({
      status: 'quarantined',
      quarantineCode: 'IDENTITY_PROJECTION_CONFLICT',
      watermark: 0,
    });
    expect(outbox.getTargetState('tenant-a')).toMatchObject({
      status: 'quarantined',
      lastErrorCode: 'IDENTITY_PROJECTION_CONFLICT',
    });
    expect(targetDb.prepare(`
      SELECT tenant_id, user_id FROM tenant_memberships WHERE membership_id = 'm_fixed'
    `).get()).toEqual({ tenant_id: 't_wrong', user_id: 'u_wrong' });
  });

  test('binds target files to one installation and target identity', () => {
    const db = memoryDb();
    new IdentityAnchorStore(db, {
      installationId: 'install-one',
      targetId: 'tenant-a',
    });
    expect(() => new IdentityAnchorStore(db, {
      installationId: 'install-two',
      targetId: 'tenant-a',
    })).toThrow(expect.objectContaining({
      code: 'IDENTITY_PROJECTION_TARGET_MISMATCH',
    }));
    expect(() => new IdentityAnchorStore(db, {
      installationId: 'install-one',
      targetId: 'tenant-b',
    })).toThrow(expect.objectContaining({
      code: 'IDENTITY_PROJECTION_TARGET_MISMATCH',
    }));
  });

  test('enqueues user and membership lifecycle anchors in Guardian transactions', async () => {
    const system = memoryDb();
    defineAuthTables(system);
    let event = 0;
    const outbox = new IdentityProjectionOutboxStore(system, {
      now: () => 100,
      createEventId: () => `event-${++event}`,
    });
    outbox.registerTarget('app-main', 'application');
    const lifecycle = createIdentityProjectionLifecycleHook(outbox, {
      targetsForUser: () => ['app-main'],
      targetsForMembership: () => ['app-main'],
    });
    const users = new UserStore(system, { identityProjection: lifecycle });
    const user = await users.createUser({
      username: 'projection-user',
      email: 'projection@example.com',
      password: 'correct horse battery staple',
    });
    const tenants = new TenantStore(system, { identityProjection: lifecycle });
    const created = tenants.createTenantWithOwner({
      slug: 'projection-org',
      name: 'Projection Org',
      ownerUserId: user.userId,
    });

    const deliveries = system.prepare(`
      SELECT anchor_kind, user_id, membership_id, tenant_id, sequence
      FROM _auth_identity_projection_outbox ORDER BY sequence
    `).all();
    expect(deliveries).toEqual([
      {
        anchor_kind: 'user',
        user_id: user.userId,
        membership_id: null,
        tenant_id: null,
        sequence: 1,
      },
      {
        anchor_kind: 'membership',
        user_id: user.userId,
        membership_id: created.ownerMembership.membershipId,
        tenant_id: created.tenant.tenantId,
        sequence: 2,
      },
    ]);
  });

  test('rolls Guardian creation back when durable lifecycle enqueue cannot commit', async () => {
    const system = memoryDb();
    defineAuthTables(system);
    const outbox = deterministicOutbox(system, mutableClock(100));
    const lifecycle = createIdentityProjectionLifecycleHook(outbox, {
      targetsForUser: () => ['missing-target'],
      targetsForMembership: () => [],
    });
    const users = new UserStore(system, { identityProjection: lifecycle });

    await expect(users.createUser({
      username: 'must-rollback',
      email: 'rollback@example.com',
      password: 'correct horse battery staple',
    })).rejects.toBeInstanceOf(IdentityProjectionError);
    expect(system.prepare('SELECT COUNT(*) AS count FROM users').get())
      .toEqual({ count: 0 });
    expect(system.prepare(`
      SELECT COUNT(*) AS count FROM _auth_identity_projection_outbox
    `).get()).toEqual({ count: 0 });
  });

  test('bounds lifecycle route iteration before it can enqueue partial fan-out', () => {
    const system = memoryDb();
    const outbox = deterministicOutbox(system, mutableClock(100));
    outbox.registerTarget('app-main', 'application');
    const lifecycle = createIdentityProjectionLifecycleHook(outbox, {
      *targetsForUser() {
        for (let index = 0; index < 2_049; index += 1) yield 'app-main';
      },
      targetsForMembership: () => [],
    });

    expect(() => lifecycle.userCreated('user-bounded-fanout')).toThrow(
      'Identity projection lifecycle fan-out exceeds 2048 targets',
    );
    expect(system.prepare(`
      SELECT COUNT(*) AS count FROM _auth_identity_projection_outbox
    `).get()).toEqual({ count: 0 });
  });
});

function memoryDb(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  db.exec('PRAGMA foreign_keys = ON');
  databases.push(db);
  return db;
}

function columnNames(db: ReactiveDB, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(\"${table}\")`).all() as Array<{ name: string }>)
    .map((column) => column.name);
}

function mutableClock(initial: number) {
  let value = initial;
  return {
    now: () => value,
    advance(delta: number) {
      value += delta;
    },
  };
}

function deterministicOutbox(
  db: ReactiveDB,
  clock: ReturnType<typeof mutableClock>,
): IdentityProjectionOutboxStore {
  let event = 0;
  return new IdentityProjectionOutboxStore(db, {
    now: clock.now,
    createEventId: () => `event-${++event}`,
  });
}

const silentEmitter: AuthPlatformCodeEmitter = () => ({}) as never;
