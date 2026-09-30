import { afterEach, describe, expect, test } from 'bun:test';

import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { AuthActionTokenService } from './action-token-service';
import { defineAuthTables } from './auth-schema';
import { createIdentityProjectionLifecycleHook } from './identity-projection-lifecycle';
import { IdentityProjectionOutboxStore } from './identity-projection-outbox-store';
import { TenantStore } from './tenancy';
import { UserStore, type RegistrationProvisioningReceipt } from './user-store';
import { GuardianIdentityProjectionSource } from '../frontend/server/identity-projection-guardian-source';

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('provisional Guardian identity projection lifecycle', () => {
  test('atomically activates a finalized registration user and owner membership', async () => {
    const harness = projectionHarness('multi');
    const created = await createProvisionalTenantRegistration(harness);
    const source = new GuardianIdentityProjectionSource(harness.db);

    expect(source.hasUser(created.user.userId)).toBe(false);
    expect(source.listUsers()).toEqual([]);
    expect(source.listMemberships()).toEqual([]);
    expect(projectionCounts(harness.db)).toEqual({ targets: 0, deliveries: 0 });

    harness.users.finalizeRegistrationProvisioning(requireReceipt(created.provisioning));

    expect(source.hasUser(created.user.userId)).toBe(true);
    expect(source.listUsers()).toEqual([created.user.userId]);
    expect(source.listMemberships()).toEqual([{
      membershipId: created.membershipId,
      tenantId: created.tenantId,
      userId: created.user.userId,
    }]);
    expect(projectionCounts(harness.db)).toEqual({ targets: 2, deliveries: 4 });
    expect(harness.db.prepare(`
      SELECT target_id, anchor_kind, user_id, membership_id, tenant_id
      FROM _auth_identity_projection_outbox
      ORDER BY target_id, sequence
    `).all()).toEqual([
      {
        target_id: 'application', anchor_kind: 'user',
        user_id: created.user.userId, membership_id: null, tenant_id: null,
      },
      {
        target_id: 'application', anchor_kind: 'membership',
        user_id: created.user.userId,
        membership_id: created.membershipId,
        tenant_id: created.tenantId,
      },
      {
        target_id: `tenant:${created.tenantId}`, anchor_kind: 'user',
        user_id: created.user.userId, membership_id: null, tenant_id: null,
      },
      {
        target_id: `tenant:${created.tenantId}`, anchor_kind: 'membership',
        user_id: created.user.userId,
        membership_id: created.membershipId,
        tenant_id: created.tenantId,
      },
    ]);
  });

  test('leaves no target or delivery after provisional registration rollback', async () => {
    const harness = projectionHarness('multi');
    const created = await createProvisionalTenantRegistration(harness);

    expect(projectionCounts(harness.db)).toEqual({ targets: 0, deliveries: 0 });
    expect(harness.users.rollbackRegistrationProvisioning(
      requireReceipt(created.provisioning),
    )).toBe(true);

    expect(projectionCounts(harness.db)).toEqual({ targets: 0, deliveries: 0 });
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM users').get())
      .toEqual({ count: 0 });
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM _auth_tenants').get())
      .toEqual({ count: 0 });
  });

  test('crash recovery removes an expired registration without publishing ghosts', async () => {
    const harness = projectionHarness('multi');
    const created = await createProvisionalTenantRegistration(harness);
    const receipt = requireReceipt(created.provisioning);
    harness.db.prepare(`
      UPDATE _auth_registration_provisioning SET lease_expires_at = ?
      WHERE registration_id = ? AND user_id = ?
    `).run(Date.now() - 1, receipt.registrationId, receipt.userId);

    expect(harness.users.recoverPendingRegistrationProvisioning()).toBe(1);

    expect(projectionCounts(harness.db)).toEqual({ targets: 0, deliveries: 0 });
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM users').get())
      .toEqual({ count: 0 });
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM _auth_tenants').get())
      .toEqual({ count: 0 });
  });

  test('rolls marker activation back when finalization cannot enqueue', async () => {
    const db = memoryDb();
    defineAuthTables(db);
    const outbox = new IdentityProjectionOutboxStore(db);
    const lifecycle = createIdentityProjectionLifecycleHook(outbox, {
      targetsForUser: () => ['missing-application-target'],
      targetsForMembership: () => [],
    });
    const users = new UserStore(db, {
      tenancyMode: 'multi',
      identityProjection: lifecycle,
    });
    const tenants = new TenantStore(db, { identityProjection: lifecycle });
    const created = await createProvisionalTenantRegistration({ db, users, tenants });
    const receipt = requireReceipt(created.provisioning);

    expect(() => users.finalizeRegistrationProvisioning(receipt)).toThrow(
      expect.objectContaining({ code: 'IDENTITY_PROJECTION_NOT_READY' }),
    );
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM _auth_registration_provisioning
    `).get()).toEqual({ count: 1 });
    expect(projectionCounts(db)).toEqual({ targets: 0, deliveries: 0 });

    expect(users.rollbackRegistrationProvisioning(receipt)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get())
      .toEqual({ count: 0 });
  });

  test('defers an administrator-created identity until setup finalization', async () => {
    const harness = projectionHarness('single');
    const owner = await harness.users.createUser({
      username: 'projection-admin-owner',
      email: 'projection-admin-owner@example.test',
      password: 'owner-password1',
      role: 'admin',
    });
    const before = projectionCounts(harness.db);
    const provisional = await harness.users.createAdminProvisionedUser({
      username: 'projection-admin-target',
      email: 'projection-admin-target@example.test',
      password: 'temporary-password1',
      role: 'user',
    }, {
      actor: { userId: owner.userId, provenance: 'authenticated-request' },
      setupRequested: true,
    }, () => {});

    expect(projectionCounts(harness.db)).toEqual(before);
    const tokens = new AuthActionTokenService(
      harness.users,
      '1h',
      '0s',
      null,
      (() => ({} as never)) as never,
    );
    harness.users.transaction(() => {
      const setup = tokens.create({
        userId: provisional.user.userId,
        type: 'account_setup',
        skipCooldown: true,
      });
      harness.users.bindAdminUserProvisioningSetupToken(
        provisional.provisioning,
        setup.record.tokenId,
      );
    });
    harness.users.finalizeAdminUserProvisioning(provisional.provisioning);

    expect(projectionCounts(harness.db)).toEqual({
      targets: before.targets,
      deliveries: before.deliveries + 1,
    });
    expect(harness.db.prepare(`
      SELECT user_id FROM _auth_identity_projection_outbox
      WHERE target_id = 'application' AND anchor_kind = 'user'
      ORDER BY sequence DESC LIMIT 1
    `).get()).toEqual({ user_id: provisional.user.userId });
  });

  test('leaves no projection work after administrator provisioning rollback', async () => {
    const harness = projectionHarness('single');
    const owner = await harness.users.createUser({
      username: 'projection-admin-rollback-owner',
      email: 'projection-admin-rollback-owner@example.test',
      password: 'owner-password1',
      role: 'admin',
    });
    const before = projectionCounts(harness.db);
    const provisional = await harness.users.createAdminProvisionedUser({
      username: 'projection-admin-rollback-target',
      email: 'projection-admin-rollback-target@example.test',
      password: 'temporary-password1',
      role: 'user',
    }, {
      actor: { userId: owner.userId, provenance: 'authenticated-request' },
      setupRequested: true,
    }, () => {});

    expect(projectionCounts(harness.db)).toEqual(before);
    expect(harness.users.rollbackAdminUserProvisioning(provisional.provisioning))
      .toBe(true);
    expect(harness.users.getUserById(provisional.user.userId)).toBeNull();
    expect(projectionCounts(harness.db)).toEqual(before);
  });

  test('publishes an adopted admin identity during expired-receipt recovery', async () => {
    const harness = projectionHarness('single');
    const owner = await harness.users.createUser({
      username: 'projection-recovery-owner',
      email: 'projection-recovery-owner@example.test',
      password: 'owner-password1',
      role: 'admin',
    });
    const before = projectionCounts(harness.db);
    const provisional = await harness.users.createAdminProvisionedUser({
      username: 'projection-recovery-target',
      email: 'projection-recovery-target@example.test',
      password: 'temporary-password1',
      role: 'user',
    }, {
      actor: { userId: owner.userId, provenance: 'authenticated-request' },
      setupRequested: true,
    }, () => {});
    harness.db.exec(`
      CREATE TABLE adopted_identity_links (
        link_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id)
      )
    `);
    harness.db.prepare(`
      INSERT INTO adopted_identity_links (link_id, user_id) VALUES (?, ?)
    `).run('adopted-link', provisional.user.userId);
    harness.db.prepare(`
      UPDATE _auth_admin_user_provisioning SET lease_expires_at = ?
      WHERE provisioning_id = ?
    `).run(Date.now() - 1, provisional.provisioning.provisioningId);

    expect(harness.users.recoverPendingAdminUserProvisioning()).toBe(1);
    expect(harness.users.getUserById(provisional.user.userId)).not.toBeNull();
    expect(projectionCounts(harness.db)).toEqual({
      targets: before.targets,
      deliveries: before.deliveries + 1,
    });
  });
});

interface ProjectionHarness {
  readonly db: ReactiveDB;
  readonly users: UserStore;
  readonly tenants: TenantStore;
}

function projectionHarness(tenancyMode: 'single' | 'multi'): ProjectionHarness {
  const db = memoryDb();
  defineAuthTables(db);
  const outbox = new IdentityProjectionOutboxStore(db);
  const lifecycle = createIdentityProjectionLifecycleHook(outbox, {
    targetsForUser: () => [{ targetId: 'application', scope: 'application' }],
    targetsForMembership: (anchor) => [
      { targetId: 'application', scope: 'application' },
      { targetId: `tenant:${anchor.tenantId}`, scope: 'tenant' },
    ],
  });
  return {
    db,
    users: new UserStore(db, { tenancyMode, identityProjection: lifecycle }),
    tenants: new TenantStore(db, { identityProjection: lifecycle }),
  };
}

async function createProvisionalTenantRegistration(harness: ProjectionHarness) {
  let tenantId = '';
  let membershipId = '';
  const created = await harness.users.createRegistrationUser({
    username: `provisional-${crypto.randomUUID()}`,
    email: `provisional-${crypto.randomUUID()}@example.test`,
    password: 'registration-password1',
  }, () => ({
    role: 'admin' as const,
    requireEmailVerification: false,
    mfaRequired: false,
  }), (user) => {
    const tenant = harness.tenants.createTenantWithOwner({
      name: 'Provisional tenant',
      slug: `provisional-${crypto.randomUUID()}`,
      ownerUserId: user.userId,
    });
    tenantId = tenant.tenant.tenantId;
    membershipId = tenant.ownerMembership.membershipId;
    return { tenantId };
  }, { provisional: true });
  return { ...created, tenantId, membershipId };
}

function requireReceipt(
  receipt: RegistrationProvisioningReceipt | null,
): RegistrationProvisioningReceipt {
  if (!receipt) throw new Error('Expected provisional registration receipt');
  return receipt;
}

function projectionCounts(db: ReactiveDB): { targets: number; deliveries: number } {
  const targets = db.prepare(`
    SELECT COUNT(*) AS count FROM _auth_identity_projection_targets
  `).get() as { count: number };
  const deliveries = db.prepare(`
    SELECT COUNT(*) AS count FROM _auth_identity_projection_outbox
  `).get() as { count: number };
  return { targets: Number(targets.count), deliveries: Number(deliveries.count) };
}

function memoryDb(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  db.exec('PRAGMA foreign_keys = ON');
  databases.push(db);
  return db;
}
