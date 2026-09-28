import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEmailRuntime } from '../email/runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveAuthBehaviorConfig } from './auth-config';
import { readInstalledAuthProfile } from './auth-profile-state';
import { AuthRuntime } from './auth-runtime';

const databases: ReactiveDB[] = [];
const runtimes: AuthRuntime[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0).reverse()) {
    try { await runtime.stop(); } catch { /* cleanup only */ }
  }
  for (const db of databases.splice(0).reverse()) db.dispose();
  for (const directory of directories.splice(0).reverse()) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('auth runtime profile transitions', () => {
  test('keeps a live browser family authorized and fences the old simple runtime', async () => {
    const db = createDb();
    const simple = runtime(db, 'multi', 'simple');
    runtimes.push(simple);
    await simple.start();
    insertUser(db, 'owner', 0);
    insertUser(db, 'manager', 1);
    const created = simple.getTenancyService()!.createTenant({
      slug: 'continuity', name: 'Continuity', ownerUserId: 'owner',
    });
    const manager = simple.getTenancyService()!.addMembership({
      tenantId: created.tenant.tenantId,
      userId: 'manager',
      roleKey: 'manager',
      createdBy: 'owner',
    });
    const managerUser = simple.getStore()!.getUserById('manager')!;
    const oldTokenService = simple.getTokenService()!;
    const oldTenancy = simple.getTenancyService()!;
    const oldStore = simple.getStore()!;
    const oldTokens = await oldTokenService.issueTokenPair(managerUser, {
      binding: {
        tenantId: manager.tenantId,
        membershipId: manager.membershipId,
      },
    });
    const beforeGeneration = manager.authorizationGeneration;

    const advanced = runtime(db, 'multi', 'advanced');
    runtimes.push(advanced);
    await advanced.start();
    expect(readInstalledAuthProfile(db)).toMatchObject({
      generation: 2,
      tenancy: 'multi',
      authorization: 'advanced',
    });
    expect(advanced.getAuthorizationRoleService()?.resolveTenantRoles({
      tenantId: manager.tenantId,
      membershipId: manager.membershipId,
      userId: manager.userId,
    })?.roles).toEqual(['manager']);

    const current = await advanced.getTokenService()!.resolveAuthContext(
      oldTokens.accessToken,
    );
    expect(current).toMatchObject({
      userId: 'manager',
      tenantId: manager.tenantId,
      membershipId: manager.membershipId,
      tenantRole: 'manager',
      membershipAuthorizationGeneration: beforeGeneration + 1,
      authorizationAssignmentRevision: expect.stringContaining(
        `tenant:${manager.tenantId}:${manager.membershipId}:`,
      ),
    });
    const rotated = await advanced.getTokenService()!.rotateRefreshToken(
      oldTokens.refreshToken,
    );
    expect(rotated).not.toBeNull();
    expect(await advanced.getTokenService()!.resolveAuthContext(
      rotated!.accessToken,
    )).toMatchObject({ userId: 'manager', tenantRole: 'manager' });

    await expect(oldTokenService.resolveAuthContext(oldTokens.accessToken))
      .rejects.toMatchObject({ code: 'AUTH_PROFILE_CHANGED', status: 503 });
    expect(() => oldTenancy.updateMembershipRole(manager.membershipId, 'member'))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_CHANGED' }));
    expect(() => oldStore.updateUser('manager', { firstName: 'stale' }))
      .toThrow(expect.objectContaining({ code: 'AUTH_PROFILE_CHANGED' }));
    expect(() => simple.getTenancyService()).toThrow(expect.objectContaining({
      code: 'AUTH_PROFILE_CHANGED',
    }));
    expect(() => simple.getStore()).toThrow(expect.objectContaining({
      code: 'AUTH_PROFILE_CHANGED',
    }));
  });

  test('restarting the committed advanced profile is assignment, generation, and audit idempotent', async () => {
    const db = createDb();
    const simple = runtime(db, 'multi', 'simple');
    runtimes.push(simple);
    await simple.start();
    insertUser(db, 'owner', 0);
    insertUser(db, 'member', 1);
    const created = simple.getTenancyService()!.createTenant({
      slug: 'restart', name: 'Restart', ownerUserId: 'owner',
    });
    const member = simple.getTenancyService()!.addMembership({
      tenantId: created.tenant.tenantId,
      userId: 'member', roleKey: 'member', createdBy: 'owner',
    });
    const advanced = runtime(db, 'multi', 'advanced');
    runtimes.push(advanced);
    await advanced.start();
    const baseline = snapshot(db);
    await advanced.stop();
    runtimes.splice(runtimes.indexOf(advanced), 1);
    await simple.stop();
    runtimes.splice(runtimes.indexOf(simple), 1);

    const restarted = runtime(db, 'multi', 'advanced');
    runtimes.push(restarted);
    await restarted.start();
    expect(snapshot(db)).toEqual(baseline);
    expect(restarted.getAuthorizationRoleService()?.resolveTenantRoles({
      tenantId: member.tenantId,
      membershipId: member.membershipId,
      userId: member.userId,
    })?.roles).toEqual(['member']);
  });

  test('requires explicit owner adoption for single/simple to single/advanced without mapping global roles', async () => {
    const db = createDb();
    const simple = runtime(db, 'single', 'simple');
    runtimes.push(simple);
    await simple.start();
    insertUser(db, 'platform-admin', 0, 'admin');
    insertUser(db, 'ordinary-user', 1, 'user');
    await simple.stop();
    runtimes.splice(runtimes.indexOf(simple), 1);

    const blocked = runtime(db, 'single', 'advanced');
    runtimes.push(blocked);
    await expect(blocked.start()).rejects.toThrow('ownerAdoption');
    expect(readInstalledAuthProfile(db)).toMatchObject({
      generation: 1, tenancy: 'single', authorization: 'simple',
    });
    expect(count(db, '_auth_application_role_assignments')).toBe(0);
    runtimes.splice(runtimes.indexOf(blocked), 1);

    const adopted = new AuthRuntime(
      { db },
      resolveAuthBehaviorConfig({
        tenancy: 'single',
        authorization: {
          mode: 'advanced',
          ownerAdoption: { userId: 'platform-admin' },
        },
      }),
      dependencies(),
    );
    runtimes.push(adopted);
    await adopted.start();
    expect(adopted.getAuthorizationRoleService()
      ?.resolveApplicationRoles('platform-admin')?.roles).toEqual(['owner']);
    expect(adopted.getAuthorizationRoleService()
      ?.resolveApplicationRoles('ordinary-user')?.roles).toEqual([]);
    expect(readInstalledAuthProfile(db)).toMatchObject({
      generation: 2, tenancy: 'single', authorization: 'advanced',
    });
  });

  test('allows only the current generation to finish concurrent different-profile startup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-auth-profile-race-'));
    directories.push(directory);
    const path = join(directory, 'app.sqlite');
    const firstDb = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const secondDb = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    databases.push(firstDb, secondDb);
    const first = runtime(firstDb, 'single', 'simple');
    const second = runtime(secondDb, 'multi', 'simple');
    runtimes.push(first, second);

    const [firstResult, secondResult] = await Promise.allSettled([
      first.start(),
      second.start(),
    ]);
    expect(firstResult.status).toBe('rejected');
    expect(secondResult.status).toBe('fulfilled');
    if (firstResult.status !== 'rejected') {
      throw new Error('Expected the superseded runtime to fail startup.');
    }
    expect(firstResult.reason).toMatchObject({
      code: 'AUTH_PROFILE_CHANGED', status: 503,
    });
    expect(readInstalledAuthProfile(secondDb)).toMatchObject({
      generation: 2, tenancy: 'multi', authorization: 'simple',
    });
    expect(second.getAuthorizationKernel()).toMatchObject({
      tenancy: { mode: 'multi' },
      authorization: { mode: 'simple' },
    });
  });

  test('lets concurrent same-profile starters converge without generation churn', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-auth-profile-same-'));
    directories.push(directory);
    const path = join(directory, 'app.sqlite');
    const firstDb = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    const secondDb = createReactiveDB({ mode: path, busyTimeout: 10_000 });
    databases.push(firstDb, secondDb);
    const first = runtime(firstDb, 'single', 'simple');
    const second = runtime(secondDb, 'single', 'simple');
    runtimes.push(first, second);

    const results = await Promise.allSettled([first.start(), second.start()]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled', 'fulfilled',
    ]);
    expect(readInstalledAuthProfile(firstDb)).toEqual({
      version: 1,
      generation: 1,
      tenancy: 'single',
      authorization: 'simple',
    });
    expect(readInstalledAuthProfile(secondDb)).toEqual(
      readInstalledAuthProfile(firstDb),
    );
  });
});

function createDb(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  return db;
}

function runtime(
  db: ReactiveDB,
  tenancy: 'single' | 'multi',
  authorization: 'simple' | 'advanced',
): AuthRuntime {
  return new AuthRuntime(
    { db },
    resolveAuthBehaviorConfig({ tenancy, authorization }),
    dependencies(),
  );
}

function dependencies() {
  return {
    getEmailRuntime: () => createEmailRuntime(false, {}),
    getPlatformTokenService: () => null,
  };
}

function insertUser(
  db: ReactiveDB,
  userId: string,
  index: number,
  role = 'user',
): void {
  db.prepare(`
    INSERT INTO users (
      user_id, username, email, role, status, password_change_required,
      email_verification_required, mfa_required, created_at
    ) VALUES (?, ?, ?, ?, 'active', 0, 0, 0, ?)
  `).run(userId, userId, `${userId}-${index}@example.test`, role, Date.now());
}

function snapshot(db: ReactiveDB) {
  return {
    profile: readInstalledAuthProfile(db),
    assignments: db.prepare(`
      SELECT tenant_id, membership_id, user_id, role_key, source, source_id,
        created_by, created_at, revoked_by, revoked_at
      FROM _auth_tenant_membership_roles ORDER BY assignment_id
    `).all(),
    generations: db.prepare(`
      SELECT membership_id, authorization_generation
      FROM _auth_tenant_memberships ORDER BY membership_id
    `).all(),
    audits: db.prepare(`
      SELECT action, outcome, actor_provenance, target_type, metadata_json
      FROM _auth_audit_events
      WHERE action = 'application.auth-profile-adopted'
      ORDER BY occurred_at, event_id
    `).all(),
  };
}

function count(db: ReactiveDB, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  }).count);
}
