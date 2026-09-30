import { describe, expect, test } from 'bun:test';

import type { AuthPlatformCodeEmitter } from '../../auth/auth-observability';
import { defineAuthTables } from '../../auth/auth-schema';
import { IdentityAnchorStore } from '../../auth/identity-anchor-store';
import type { AuthContext } from '../../auth/types';
import { DatabaseError } from '../../databases/database-error';
import type { DatabaseManager } from '../../databases/database-manager';
import { OBS_CODES } from '../../observability/codes';
import { defineTable, field } from '../../schema';
import { createReactiveDB } from '../../sync/reactive-db';
import { createAppIdentityProjectionRuntime } from './identity-projection-runtime';
import { IdentityProjectionTenantProvisioner } from './identity-projection-tenant-provisioner';

describe('managed Guardian identity projection runtime', () => {
  test('drains more than one bounded application-anchor batch during startup', async () => {
    const systemDB = createReactiveDB({ mode: 'memory' });
    const applicationDB = createReactiveDB({ mode: 'memory' });
    const tasks = defineTable('tasks', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'task_id' });
    defineAuthTables(systemDB);

    const insert = systemDB.prepare(`
      INSERT INTO users (user_id, username, email, role, status, created_at)
      VALUES (?, ?, ?, 'user', 'active', 1)
    `);
    try {
      systemDB.transaction(() => {
        for (let index = 0; index < 10_001; index += 1) {
          const suffix = String(index).padStart(5, '0');
          insert.run(
            `user-${suffix}`,
            `user-${suffix}`,
            `user-${suffix}@example.test`,
          );
        }
      });

      const runtime = createAppIdentityProjectionRuntime({
        systemDB,
        applicationDB,
        tables: { tasks: tasks.serverTable },
        tenancyMode: 'single',
        getDatabaseManager: () => null,
        emitCode: () => ({}) as never,
      });
      expect(runtime).not.toBeNull();

      await runtime!.lifecycle.initialize?.();

      expect(applicationDB.prepare('SELECT COUNT(*) AS count FROM users').get())
        .toEqual({ count: 10_001 });
      expect(applicationDB.prepare(`
        SELECT status, watermark FROM _zero_identity_projection_state
        WHERE singleton = 1
      `).get()).toEqual({ status: 'ready', watermark: 10_001 });
      expect(systemDB.prepare(`
        SELECT status, acknowledged_sequence
        FROM _auth_identity_projection_targets
        WHERE target_id = 'application'
      `).get()).toEqual({ status: 'ready', acknowledged_sequence: 10_001 });
    } finally {
      insert.finalize();
      applicationDB.dispose();
      systemDB.dispose();
    }
  }, 30_000);

  test('reports a safe stable code when background tenant admission fails', async () => {
    const systemDB = createReactiveDB({ mode: 'memory' });
    const applicationDB = createReactiveDB({ mode: 'memory' });
    const targetDB = createReactiveDB({ mode: 'memory' });
    const tasks = defineTable('tasks', {
      assignee_membership_id: field.guardianMembership(),
    }, { pk: 'task_id' });
    const events: Array<Readonly<{
      code: string;
      metadata: Readonly<Record<string, unknown>> | undefined;
    }>> = [];
    const emitCode: AuthPlatformCodeEmitter = (definition, options = {}) => {
      events.push(Object.freeze({
        code: definition.code,
        metadata: options.metadata,
      }));
      return {} as never;
    };
    const manager = {
      ensureTenantIdentityProjection: async () => {
        throw new DatabaseError(
          'DATABASE_BACKPRESSURE',
          'private tenant /var/lib/zero/tenant-secret.sqlite is overloaded',
          { retryable: true, outcome: 'not-started' },
        );
      },
    } as unknown as DatabaseManager;
    defineAuthTables(systemDB);

    try {
      const runtime = createAppIdentityProjectionRuntime({
        systemDB,
        applicationDB,
        tables: { tasks: tasks.serverTable },
        tenantDatabaseTables: new Set(['tasks']),
        tenancyMode: 'multi',
        getDatabaseManager: () => manager,
        emitCode,
      });
      expect(runtime).not.toBeNull();
      const projection = runtime!.tenantManagerOptions!;
      const targetId = projection.targetIdForTenant('tenant-one');
      await projection.reconcile('tenant-one', targetId, new IdentityAnchorStore(
        targetDB,
        { installationId: projection.installationId, targetId },
      ));
      events.length = 0;

      systemDB.transaction(() => runtime!.lifecycle.membershipCreated({
        membershipId: 'membership-one',
        tenantId: 'tenant-one',
        userId: 'user-one',
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(events).toEqual([{
        code: OBS_CODES.AUTH_IDENTITY_PROJECTION_RETRY.code,
        metadata: {
          scope: 'tenant',
          code: 'DATABASE_BACKPRESSURE',
        },
      }]);
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain('tenant-one');
      expect(serialized).not.toContain('/var/lib/zero');
      expect(serialized).not.toContain('secret');
    } finally {
      targetDB.dispose();
      applicationDB.dispose();
      systemDB.dispose();
    }
  });

  test('does not label a permanent background provisioning failure as a retry', async () => {
    const events: Array<Readonly<{
      code: string;
      metadata: Readonly<Record<string, unknown>> | undefined;
    }>> = [];
    const emitCode: AuthPlatformCodeEmitter = (definition, options = {}) => {
      events.push(Object.freeze({
        code: definition.code,
        metadata: options.metadata,
      }));
      return {} as never;
    };
    const manager = {
      ensureTenantIdentityProjection: async () => {
        throw new DatabaseError(
          'DATABASE_SCHEMA_MISMATCH',
          'private tenant /var/lib/zero/tenant-secret.sqlite is incompatible',
          { retryable: false, outcome: 'not-started' },
        );
      },
    } as unknown as DatabaseManager;
    const provisioner = new IdentityProjectionTenantProvisioner(
      () => manager,
      emitCode,
    );

    provisioner.schedule('tenant-private');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual([{
      code: OBS_CODES.AUTH_IDENTITY_PROJECTION_FAILED.code,
      metadata: {
        scope: 'tenant',
        code: 'DATABASE_SCHEMA_MISMATCH',
      },
    }]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('tenant-private');
    expect(serialized).not.toContain('/var/lib/zero');
    expect(serialized).not.toContain('secret');
  });

  test('requires an inspectable target before reporting tenant readiness', async () => {
    const systemDB = createReactiveDB({ mode: 'memory' });
    const applicationDB = createReactiveDB({ mode: 'memory' });
    const targetDB = createReactiveDB({ mode: 'memory' });
    const tasks = defineTable('tasks', {
      assignee_membership_id: field.guardianMembership(),
    }, { pk: 'task_id' });
    let manager: DatabaseManager | null = null;
    const tenantId = 'tenant-readiness';
    const membershipId = 'membership-readiness';
    const userId = 'user-readiness';
    defineAuthTables(systemDB);

    try {
      const runtime = createAppIdentityProjectionRuntime({
        systemDB,
        applicationDB,
        tables: { tasks: tasks.serverTable },
        tenantDatabaseTables: new Set(['tasks']),
        tenancyMode: 'multi',
        getDatabaseManager: () => manager,
        emitCode: () => ({}) as never,
      })!;
      const projection = runtime.tenantManagerOptions!;
      const targetId = projection.targetIdForTenant(tenantId);
      const target = new IdentityAnchorStore(targetDB, {
        installationId: projection.installationId,
        targetId,
      });

      systemDB.transaction(() => runtime.lifecycle.membershipCreated({
        membershipId,
        tenantId,
        userId,
      }));
      await projection.reconcile(tenantId, targetId, target);

      const request = readinessRequest(tenantAuth({
        tenantId,
        membershipId,
        userId,
      }));
      await expect(runtime.inspect(request)).resolves.toMatchObject({
        status: 'provisioning',
        scope: 'tenant',
      });
      await expect(runtime.retry(request)).resolves.toMatchObject({
        status: 'provisioning',
        scope: 'tenant',
      });

      manager = {
        inspectTenantIdentityProjection: async () => target.inspect(),
        ensureTenantIdentityProjection: async () => undefined,
      } as unknown as DatabaseManager;
      await expect(runtime.inspect(request)).resolves.toMatchObject({
        status: 'ready',
        scope: 'tenant',
      });

      targetDB.dispose();
      await expect(runtime.inspect(request)).resolves.toMatchObject({
        status: 'provisioning',
        scope: 'tenant',
      });
      manager = {
        inspectTenantIdentityProjection: async () => null,
        ensureTenantIdentityProjection: async () => undefined,
      } as unknown as DatabaseManager;
      await expect(runtime.retry(request)).resolves.toMatchObject({
        status: 'provisioning',
        scope: 'tenant',
      });
    } finally {
      targetDB.dispose();
      applicationDB.dispose();
      systemDB.dispose();
    }
  });

  test('creates tenant journals lazily and seeds only the admitted tenant', async () => {
    const systemDB = createReactiveDB({ mode: 'memory' });
    const applicationDB = createReactiveDB({ mode: 'memory' });
    const tenantADB = createReactiveDB({ mode: 'memory' });
    const tasks = defineTable('tasks', {
      assignee_membership_id: field.guardianMembership(),
    }, { pk: 'task_id' });
    defineAuthTables(systemDB);
    seedTenantMembership(systemDB, {
      tenantId: 'tenant-a',
      tenantKind: 'organization',
      userId: 'user-a',
      membershipId: 'membership-a',
    });
    seedTenantMembership(systemDB, {
      tenantId: 'tenant-b',
      tenantKind: 'organization',
      userId: 'user-b',
      membershipId: 'membership-b',
    });
    seedTenantMembership(systemDB, {
      tenantId: 'tenant-admin',
      tenantKind: 'administration',
      userId: 'user-admin',
      membershipId: 'membership-admin',
    });

    try {
      const runtime = createAppIdentityProjectionRuntime({
        systemDB,
        applicationDB,
        tables: { tasks: tasks.serverTable },
        tenantDatabaseTables: new Set(['tasks']),
        eligibleTenantKinds: ['organization'],
        tenancyMode: 'multi',
        getDatabaseManager: () => null,
        emitCode: () => ({}) as never,
      })!;
      await runtime.lifecycle.initialize?.();

      expect(systemDB.prepare(`
        SELECT COUNT(*) AS count FROM _auth_identity_projection_targets
        WHERE scope = 'tenant'
      `).get()).toEqual({ count: 0 });
      await expect(runtime.inspect(readinessRequest(tenantAuth({
        tenantId: 'tenant-admin',
        membershipId: 'membership-admin',
        userId: 'user-admin',
        tenantKind: 'administration',
      })))).resolves.toMatchObject({ status: 'not-required', scope: null });

      const projection = runtime.tenantManagerOptions!;
      const targetId = projection.targetIdForTenant('tenant-a');
      const target = new IdentityAnchorStore(tenantADB, {
        installationId: projection.installationId,
        targetId,
      });
      await projection.reconcile('tenant-a', targetId, target);

      expect(systemDB.prepare(`
        SELECT target_id FROM _auth_identity_projection_targets
        WHERE scope = 'tenant'
      `).all()).toEqual([{ target_id: targetId }]);
      expect(tenantADB.prepare('SELECT user_id FROM users ORDER BY user_id').all())
        .toEqual([{ user_id: 'user-a' }]);
      expect(tenantADB.prepare(`
        SELECT membership_id, tenant_id, user_id
        FROM tenant_memberships ORDER BY membership_id
      `).all()).toEqual([{
        membership_id: 'membership-a',
        tenant_id: 'tenant-a',
        user_id: 'user-a',
      }]);

      seedMembershipInExistingTenant(systemDB, {
        tenantId: 'tenant-a',
        userId: 'user-a-late',
        membershipId: 'membership-a-late',
      });
      await runtime.lifecycle.initialize?.();
      expect(systemDB.prepare(`
        SELECT status, acknowledged_sequence, next_sequence
        FROM _auth_identity_projection_targets WHERE target_id = ?
      `).get(targetId)).toEqual({
        status: 'provisioning',
        acknowledged_sequence: 2,
        next_sequence: 5,
      });
      await projection.reconcile('tenant-a', targetId, target);
      expect(tenantADB.prepare('SELECT user_id FROM users ORDER BY user_id').all())
        .toEqual([{ user_id: 'user-a' }, { user_id: 'user-a-late' }]);
      expect(tenantADB.prepare(`
        SELECT membership_id, tenant_id, user_id
        FROM tenant_memberships ORDER BY membership_id
      `).all()).toEqual([{
        membership_id: 'membership-a',
        tenant_id: 'tenant-a',
        user_id: 'user-a',
      }, {
        membership_id: 'membership-a-late',
        tenant_id: 'tenant-a',
        user_id: 'user-a-late',
      }]);
      expect(systemDB.prepare(`
        SELECT COUNT(*) AS count FROM _auth_identity_projection_targets
        WHERE target_id = ?
      `).get(projection.targetIdForTenant('tenant-b'))).toEqual({ count: 0 });
      expect(systemDB.prepare(`
        SELECT COUNT(*) AS count FROM _auth_identity_projection_targets
        WHERE target_id = ?
      `).get(projection.targetIdForTenant('tenant-admin'))).toEqual({ count: 0 });
    } finally {
      tenantADB.dispose();
      applicationDB.dispose();
      systemDB.dispose();
    }
  });

  test('rolls target registration and partial seed work back atomically', async () => {
    const systemDB = createReactiveDB({ mode: 'memory' });
    const applicationDB = createReactiveDB({ mode: 'memory' });
    const tenantDB = createReactiveDB({ mode: 'memory' });
    const tasks = defineTable('tasks', {
      assignee_membership_id: field.guardianMembership(),
    }, { pk: 'task_id' });
    defineAuthTables(systemDB);
    seedTenantMembership(systemDB, {
      tenantId: 'tenant-seed-atomic',
      tenantKind: 'organization',
      userId: 'user-seed-atomic',
      // Direct corruption simulates hostile source state that must not leave a
      // half-registered target or user-only partial seed behind.
      membershipId: 'membership@invalid',
    });

    try {
      const runtime = createAppIdentityProjectionRuntime({
        systemDB,
        applicationDB,
        tables: { tasks: tasks.serverTable },
        tenantDatabaseTables: new Set(['tasks']),
        tenancyMode: 'multi',
        getDatabaseManager: () => null,
        emitCode: () => ({}) as never,
      })!;
      const projection = runtime.tenantManagerOptions!;
      const targetId = projection.targetIdForTenant('tenant-seed-atomic');
      const target = new IdentityAnchorStore(tenantDB, {
        installationId: projection.installationId,
        targetId,
      });

      await expect(projection.reconcile('tenant-seed-atomic', targetId, target))
        .rejects.toMatchObject({ code: 'IDENTITY_PROJECTION_SCHEMA_INVALID' });
      expect(systemDB.prepare(`
        SELECT COUNT(*) AS count FROM _auth_identity_projection_targets
        WHERE target_id = ?
      `).get(targetId)).toEqual({ count: 0 });
      expect(systemDB.prepare(`
        SELECT COUNT(*) AS count FROM _auth_identity_projection_outbox
        WHERE target_id = ?
      `).get(targetId)).toEqual({ count: 0 });
    } finally {
      tenantDB.dispose();
      applicationDB.dispose();
      systemDB.dispose();
    }
  });

  test('fails readiness when the application target binding no longer matches', async () => {
    const systemDB = createReactiveDB({ mode: 'memory' });
    const applicationDB = createReactiveDB({ mode: 'memory' });
    const tasks = defineTable('tasks', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'task_id' });

    try {
      const runtime = createAppIdentityProjectionRuntime({
        systemDB,
        applicationDB,
        tables: { tasks: tasks.serverTable },
        tenancyMode: 'single',
        getDatabaseManager: () => null,
        emitCode: () => ({}) as never,
      })!;
      systemDB.transaction(() => runtime.lifecycle.userCreated('user-application'));
      const request = readinessRequest(applicationAuth('user-application'));
      await expect(runtime.inspect(request)).resolves.toMatchObject({
        status: 'ready',
        scope: 'application',
      });

      applicationDB.prepare(`
        UPDATE _zero_identity_projection_state
        SET target_id = 'application-mismatch'
        WHERE singleton = 1
      `).run();
      await expect(runtime.inspect(request)).resolves.toMatchObject({
        status: 'failed',
        scope: 'application',
        errorCode: 'IDENTITY_PROJECTION_TARGET_MISMATCH',
      });
    } finally {
      applicationDB.dispose();
      systemDB.dispose();
    }
  });
});

function readinessRequest(auth: AuthContext) {
  return { auth, signal: new AbortController().signal };
}

function applicationAuth(userId: string): AuthContext {
  return {
    userId,
    email: `${userId}@example.test`,
    role: 'user',
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  };
}

function tenantAuth(input: {
  tenantId: string;
  membershipId: string;
  userId: string;
  tenantKind?: 'organization' | 'administration';
}): AuthContext {
  return {
    ...applicationAuth(input.userId),
    sessionScopeKind: 'tenant',
    sessionScopeId: input.tenantId,
    tenantId: input.tenantId,
    tenantKind: input.tenantKind ?? 'organization',
    membershipId: input.membershipId,
    tenantRole: 'owner',
  };
}

function seedTenantMembership(
  db: ReturnType<typeof createReactiveDB>,
  input: {
    tenantId: string;
    tenantKind: 'organization' | 'administration';
    userId: string;
    membershipId: string;
  },
): void {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (
        user_id, username, email, role, status,
        email_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'user', 'active', 1, 1, 1)
    `).run(input.userId, input.userId, `${input.userId}@example.test`);
    db.prepare(`
      INSERT INTO _auth_tenants (
        tenant_id, slug, name, status, kind, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?, 1, 1)
    `).run(
      input.tenantId,
      input.tenantId,
      input.tenantId,
      input.tenantKind,
      input.userId,
    );
    db.prepare(`
      INSERT INTO _auth_tenant_memberships (
        membership_id, tenant_id, user_id, status, role_key,
        joined_at, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, 'active', NULL, 1, 1, 1, ?)
    `).run(
      input.membershipId,
      input.tenantId,
      input.userId,
      input.userId,
    );
  });
}

function seedMembershipInExistingTenant(
  db: ReturnType<typeof createReactiveDB>,
  input: {
    tenantId: string;
    userId: string;
    membershipId: string;
  },
): void {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (
        user_id, username, email, role, status,
        email_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'user', 'active', 1, 1, 1)
    `).run(input.userId, input.userId, `${input.userId}@example.test`);
    db.prepare(`
      INSERT INTO _auth_tenant_memberships (
        membership_id, tenant_id, user_id, status, role_key,
        joined_at, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, 'active', NULL, 1, 1, 1, ?)
    `).run(
      input.membershipId,
      input.tenantId,
      input.userId,
      input.userId,
    );
  });
}
