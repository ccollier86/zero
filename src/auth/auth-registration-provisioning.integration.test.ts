import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { PlatformTokenStore } from '../tokens';
import { hashToken } from '../tokens/token-utils';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';
import type { AuthPluginConfig } from './types';
import type { RegistrationProvisioningReceipt } from './user-store';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  runtime: AuthRuntime;
  url: string;
}

const apps: AnyElysia[] = [];
const databases: ReactiveDB[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.stop();
  for (const db of databases.splice(0).reverse()) db.dispose();
  for (const directory of temporaryDirectories.splice(0).reverse()) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('registration provisioning transaction', () => {
  test('rolls back a multi/advanced bootstrap when session provisioning fails', async () => {
    const harness = await start({
      tenancy: 'multi',
      authorization: { mode: 'advanced' },
      bootstrap: 'public',
      registration: { mode: 'public' },
    });
    const restore = failNextTokenPair(harness.runtime);
    const failed = await register(harness, 'multi-bootstrap', 'Bootstrap organization');
    restore();

    expect(failed).toMatchObject({
      status: 500,
      body: { code: 'AUTH_INTERNAL_ERROR' },
    });
    assertEmptyInstallation(harness.db);

    const retried = await register(
      harness,
      'multi-bootstrap',
      'Bootstrap organization',
    );
    expect(retried).toMatchObject({
      status: 200,
      body: {
        user: { role: 'admin' },
        tenant: { slug: 'bootstrap-organization', role: 'owner' },
      },
    });
    expect(count(harness.db, '_auth_registration_provisioning')).toBe(0);
    expect(count(harness.db, '_auth_tenants')).toBe(1);
    expect(count(harness.db, '_auth_tenant_memberships')).toBe(1);
    expect(count(harness.db, '_auth_tenant_membership_roles')).toBe(1);
    expect(completedBootstrapCount(harness.db)).toBe(1);
  }, 60_000);

  test('rolls back the first single/advanced application owner on token failure', async () => {
    const harness = await start({
      tenancy: 'single',
      authorization: { mode: 'advanced' },
      bootstrap: 'public',
      registration: { mode: 'public' },
    });
    const restore = failNextTokenPair(harness.runtime);
    const failed = await register(harness, 'single-bootstrap');
    restore();

    expect(failed).toMatchObject({
      status: 500,
      body: { code: 'AUTH_INTERNAL_ERROR' },
    });
    assertEmptyInstallation(harness.db);

    const retried = await register(harness, 'single-bootstrap');
    expect(retried).toMatchObject({
      status: 200,
      body: { user: { role: 'admin' } },
    });
    expect(count(harness.db, '_auth_registration_provisioning')).toBe(0);
    expect(count(harness.db, '_auth_application_role_assignments')).toBe(1);
    expect(countWhere(harness.db, `
      SELECT COUNT(*) AS count FROM _auth_application_role_assignments
      WHERE role_key = 'owner' AND source = 'bootstrap' AND revoked_at IS NULL
    `)).toBe(1);
    expect(completedBootstrapCount(harness.db)).toBe(1);
  }, 60_000);

  test('does not carry a stale registration generation into session issuance', async () => {
    const harness = await start({
      tenancy: 'single',
      authorization: { mode: 'simple' },
      bootstrap: 'public',
      registration: { mode: 'public' },
    });
    const service = harness.runtime.getTokenService()!;
    const store = harness.runtime.getStore()!;
    const issueTokenPair = service.issueTokenPair.bind(service);
    let intercepted = false;
    (service as any).issueTokenPair = async (
      ...args: Parameters<typeof issueTokenPair>
    ) => {
      intercepted = true;
      await store.resetPassword(args[0].userId, 'replacement-password1');
      return issueTokenPair(...args);
    };

    let failed: Awaited<ReturnType<typeof register>>;
    try {
      failed = await register(harness, 'registration-generation-race');
    } finally {
      (service as any).issueTokenPair = issueTokenPair;
    }
    expect(intercepted).toBe(true);
    expect(failed!).toMatchObject({
      status: 409,
      body: { code: 'AUTH_STATE_CHANGED' },
    });
    expect(count(harness.db, 'users')).toBe(0);
    expect(count(harness.db, '_auth_sessions')).toBe(0);
    expect(count(harness.db, '_refresh_tokens')).toBe(0);
    expect(count(harness.db, '_auth_registration_provisioning')).toBe(0);
    expect(completedBootstrapCount(harness.db)).toBe(0);

    const retried = await register(harness, 'registration-generation-race');
    expect(retried.status).toBe(200);
  }, 60_000);

  test('rejects direct first-user creation in multi mode and requires the organization path', async () => {
    const harness = await start({
      tenancy: 'multi',
      authorization: { mode: 'simple' },
      bootstrap: 'public',
      registration: { mode: 'public' },
    });

    await expect(harness.runtime.getStore()!.createUser({
      username: 'programmatic-bootstrap',
      email: 'programmatic-bootstrap@example.test',
      password: 'password123',
    })).rejects.toMatchObject({
      code: 'MULTI_TENANT_BOOTSTRAP_ORGANIZATION_REQUIRED',
      status: 409,
    });
    expect(count(harness.db, 'users')).toBe(0);
    expect(count(harness.db, '_auth_tenants')).toBe(0);
    expect(count(harness.db, '_auth_tenant_memberships')).toBe(0);
    expect(count(harness.db, '_auth_registration_provisioning')).toBe(0);
    expect(completedBootstrapCount(harness.db)).toBe(0);

    const explicit = await register(
      harness,
      'explicit-bootstrap',
      'Administration organization',
    );
    expect(explicit).toMatchObject({
      status: 200,
      body: { tenant: { role: 'owner' } },
    });
    expect(count(harness.db, 'users')).toBe(1);
    expect(count(harness.db, '_auth_tenants')).toBe(1);
    expect(completedBootstrapCount(harness.db)).toBe(1);
  }, 60_000);

  test('a second runtime preserves another process live registration lease', async () => {
    const [ownerDb, observerDb] = await sharedFileDatabases();
    const config = {
      tenancy: 'multi' as const,
      authorization: { mode: 'advanced' as const },
      bootstrap: 'public' as const,
      registration: { mode: 'public' as const },
    };
    const owner = await start(config, ownerDb);
    const provisional = await createProvisionalMultiBootstrap(
      owner,
      'live-lease',
      'Live lease organization',
    );
    const receipt = requireProvisioning(provisional.provisioning);
    const persisted = provisioningLease(ownerDb, receipt.registrationId);

    expect(persisted.lease_owner_hash).toBe(hashToken(receipt.leaseToken));
    expect(persisted.lease_owner_hash).not.toBe(receipt.leaseToken);
    const renewedUntil = owner.runtime.getStore()!
      .renewRegistrationProvisioningLease(receipt);
    expect(renewedUntil).toBeGreaterThanOrEqual(persisted.lease_expires_at);

    const observer = await start(config, observerDb);
    expect(observer.runtime.getStore()!.recoverPendingRegistrationProvisioning()).toBe(0);
    expect(count(observerDb, '_auth_registration_provisioning')).toBe(1);
    expect(count(observerDb, 'users')).toBe(1);
    expect(count(observerDb, '_auth_tenants')).toBe(1);

    owner.runtime.getStore()!.finalizeRegistrationProvisioning(receipt);
    expect(count(observerDb, '_auth_registration_provisioning')).toBe(0);
    expect(completedBootstrapCount(observerDb)).toBe(1);
  }, 60_000);

  test('recovers only an expired multi-process lease and stale owner fails closed', async () => {
    const [interruptedDb, recoveryDb] = await sharedFileDatabases();
    const config = {
      tenancy: 'multi' as const,
      authorization: { mode: 'advanced' as const },
      bootstrap: 'public' as const,
      registration: { mode: 'public' as const },
    };
    const interrupted = await start(config, interruptedDb);
    const store = interrupted.runtime.getStore()!;
    const provisional = await createProvisionalMultiBootstrap(
      interrupted,
      'crash-recovery',
      'Crash recovery organization',
    );
    const receipt = requireProvisioning(provisional.provisioning);

    expect(provisional.provisioning).not.toBeNull();
    expect(count(interruptedDb, 'users')).toBe(1);
    expect(count(interruptedDb, '_auth_tenants')).toBe(1);
    expect(count(interruptedDb, '_auth_tenant_membership_roles')).toBe(1);
    expect(count(interruptedDb, '_auth_registration_provisioning')).toBe(1);
    expect(completedBootstrapCount(interruptedDb)).toBe(0);
    const platformTokens = new PlatformTokenStore(interruptedDb);
    platformTokens.storeActionToken({
      tokenId: 'provisional-platform-token',
      purpose: 'email_verification',
      tokenHash: 'provisional-platform-token-hash',
      subject: { type: 'user', id: provisional.user.userId },
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
    });
    expect(count(interruptedDb, '_zero_action_tokens')).toBe(1);
    interruptedDb.prepare(`
      UPDATE _auth_registration_provisioning
      SET lease_expires_at = ?
      WHERE registration_id = ?
    `).run(Date.now() - 1, receipt.registrationId);

    expect(() => store.finalizeRegistrationProvisioning(receipt)).toThrow(
      'Registration provisioning lease is no longer active',
    );
    expect(count(interruptedDb, '_auth_registration_provisioning')).toBe(1);
    expect(count(interruptedDb, 'users')).toBe(1);
    expect(completedBootstrapCount(interruptedDb)).toBe(0);

    const recovered = await start(config, recoveryDb);
    assertEmptyInstallation(recoveryDb);
    expect(count(recoveryDb, '_zero_action_tokens')).toBe(0);
    expect(recovered.runtime.getStore()!.isBootstrapRequired()).toBe(true);
    expect(() => store.finalizeRegistrationProvisioning(receipt))
      .toThrow('invalid or stale');

    const retried = await register(
      recovered,
      'crash-recovery',
      'Crash recovery organization',
    );
    expect(retried).toMatchObject({
      status: 200,
      body: {
        user: { role: 'admin' },
        tenant: { slug: 'crash-recovery-organization', role: 'owner' },
      },
    });
    expect(completedBootstrapCount(recoveryDb)).toBe(1);
  }, 60_000);

  test('preserves an adopted administrator-created user during expired-receipt recovery', async () => {
    const harness = await start({
      tenancy: 'single',
      authorization: { mode: 'simple' },
      bootstrap: 'public',
      registration: { mode: 'admin-only' },
    });
    const bootstrap = await register(harness, 'admin-recovery-owner');
    expect(bootstrap.status).toBe(200);
    const ownerId = String(bootstrap.body.user.userId);
    const store = harness.runtime.getStore()!;
    const provisional = await store.createAdminProvisionedUser({
      username: 'admin-recovery-target',
      email: 'admin-recovery-target@example.test',
      password: 'temporary-password1',
      role: 'user',
    }, {
      actor: { userId: ownerId, provenance: 'authenticated-request' },
      setupRequested: true,
    }, () => {});

    harness.db.exec(`
      CREATE TABLE app_user_links (
        link_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
      )
    `);
    harness.db.prepare(`
      INSERT INTO app_user_links (link_id, user_id) VALUES (?, ?)
    `).run('adopted-user-link', provisional.user.userId);
    harness.db.prepare(`
      UPDATE _auth_admin_user_provisioning
      SET lease_expires_at = ?
      WHERE provisioning_id = ?
    `).run(Date.now() - 1, provisional.provisioning.provisioningId);

    expect(store.hasPendingRegistrationProvisioning(provisional.user.userId)).toBe(false);
    expect(store.recoverPendingAdminUserProvisioning()).toBe(1);
    expect(store.getUserById(provisional.user.userId)).not.toBeNull();
    expect(count(harness.db, 'app_user_links')).toBe(1);
    expect(count(harness.db, '_auth_admin_user_provisioning')).toBe(0);
    expect(() => store.rollbackAdminUserProvisioning(provisional.provisioning))
      .toThrow('invalid or stale');
  }, 60_000);

  test('removes an untouched administrator-created user during expired-receipt recovery', async () => {
    const harness = await start({
      tenancy: 'single',
      authorization: { mode: 'simple' },
      bootstrap: 'public',
      registration: { mode: 'admin-only' },
    });
    const bootstrap = await register(harness, 'admin-cleanup-owner');
    expect(bootstrap.status).toBe(200);
    const ownerId = String(bootstrap.body.user.userId);
    const store = harness.runtime.getStore()!;
    const provisional = await store.createAdminProvisionedUser({
      username: 'admin-cleanup-target',
      email: 'admin-cleanup-target@example.test',
      password: 'temporary-password1',
      role: 'user',
    }, {
      actor: { userId: ownerId, provenance: 'authenticated-request' },
      setupRequested: true,
    }, () => {});
    harness.db.prepare(`
      UPDATE _auth_admin_user_provisioning
      SET lease_expires_at = ?
      WHERE provisioning_id = ?
    `).run(Date.now() - 1, provisional.provisioning.provisioningId);

    expect(store.hasPendingRegistrationProvisioning(provisional.user.userId)).toBe(false);
    expect(store.recoverPendingAdminUserProvisioning()).toBe(1);
    expect(store.getUserById(provisional.user.userId)).toBeNull();
    expect(count(harness.db, '_auth_admin_user_provisioning')).toBe(0);
  }, 60_000);

  test('refuses to finalize a single/advanced receipt after provisional owner loss', async () => {
    const harness = await start({
      tenancy: 'single',
      authorization: { mode: 'advanced' },
      bootstrap: 'public',
      registration: { mode: 'public' },
    });
    const store = harness.runtime.getStore()!;
    const provisional = await store.createRegistrationUser({
      username: 'missing-app-owner',
      email: 'missing-app-owner@example.test',
      password: 'password123',
    }, () => ({
      role: 'admin' as const,
      requireEmailVerification: false,
      mfaRequired: false,
    }), undefined, { provisional: true });
    const receipt = requireProvisioning(provisional.provisioning);

    expect(harness.db.prepare(`
      DELETE FROM _auth_application_role_assignments
      WHERE user_id = ? AND role_key = 'owner' AND revoked_at IS NULL
      RETURNING assignment_id
    `).all(receipt.userId)).toHaveLength(1);
    expect(() => store.finalizeRegistrationProvisioning(receipt))
      .toThrow('authority is missing');
    expect(count(harness.db, '_auth_registration_provisioning')).toBe(1);
    expect(completedBootstrapCount(harness.db)).toBe(0);

    expect(store.rollbackRegistrationProvisioning(receipt)).toBe(true);
    assertEmptyInstallation(harness.db);
  }, 60_000);

  test('refuses to finalize a multi/advanced receipt after tenant-owner loss', async () => {
    const harness = await start({
      tenancy: 'multi',
      authorization: { mode: 'advanced' },
      bootstrap: 'public',
      registration: { mode: 'public' },
    });
    const store = harness.runtime.getStore()!;
    const provisional = await createProvisionalMultiBootstrap(
      harness,
      'missing-tenant-owner',
      'Missing tenant owner organization',
    );
    const receipt = requireProvisioning(provisional.provisioning);

    expect(harness.db.prepare(`
      DELETE FROM _auth_tenant_membership_roles
      WHERE tenant_id = ? AND user_id = ?
        AND role_key = 'owner' AND revoked_at IS NULL
      RETURNING assignment_id
    `).all(receipt.tenantId, receipt.userId)).toHaveLength(1);
    expect(() => store.finalizeRegistrationProvisioning(receipt))
      .toThrow('authority is missing');
    expect(count(harness.db, '_auth_registration_provisioning')).toBe(1);
    expect(completedBootstrapCount(harness.db)).toBe(0);

    expect(store.rollbackRegistrationProvisioning(receipt)).toBe(true);
    assertEmptyInstallation(harness.db);
  }, 60_000);
});

async function sharedFileDatabases(): Promise<readonly [ReactiveDB, ReactiveDB]> {
  const directory = await mkdtemp(join(tmpdir(), 'zero-registration-lease-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'shared.sqlite');
  const first = createReactiveDB({
    mode: 'file',
    path,
    clearChangesOnStart: false,
  });
  const second = createReactiveDB({
    mode: 'file',
    path,
    clearChangesOnStart: false,
  });
  databases.push(first, second);
  return [first, second] as const;
}

async function start(
  config: Omit<AuthPluginConfig, 'db' | 'onRuntimeCreated'>,
  existingDb?: ReactiveDB,
): Promise<Harness> {
  const db = existingDb ?? createReactiveDB({ mode: 'memory' });
  if (!existingDb) databases.push(db);
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    ...config,
    db,
    onRuntimeCreated(created) {
      runtime = created;
    },
  }));
  app.listen(0);
  apps.push(app);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  await createdRuntime.start();
  return {
    app,
    db,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  };
}

async function createProvisionalMultiBootstrap(
  harness: Harness,
  key: string,
  organizationName: string,
) {
  const store = harness.runtime.getStore()!;
  const tenancy = harness.runtime.getTenancyService()!;
  return store.createRegistrationUser({
    username: key,
    email: `${key}@example.test`,
    password: 'password123',
  }, () => ({
    role: 'admin' as const,
    requireEmailVerification: false,
    mfaRequired: false,
  }), (user) => {
    const created = tenancy.createTenant({
      name: organizationName,
      slug: `${key}-organization`,
      ownerUserId: user.userId,
      createdBy: user.userId,
      kind: 'administration',
    });
    return { tenantId: created.tenant.tenantId };
  }, { provisional: true });
}

function requireProvisioning(
  receipt: RegistrationProvisioningReceipt | null,
): RegistrationProvisioningReceipt {
  if (!receipt) throw new Error('Expected a provisional registration receipt');
  return receipt;
}

function provisioningLease(db: ReactiveDB, registrationId: string): {
  lease_owner_hash: string;
  lease_expires_at: number;
} {
  const row = db.prepare(`
    SELECT lease_owner_hash, lease_expires_at
    FROM _auth_registration_provisioning
    WHERE registration_id = ?
  `).get(registrationId) as {
    lease_owner_hash: string;
    lease_expires_at: number;
  } | null;
  if (!row) throw new Error('Expected persisted registration lease');
  return row;
}

function failNextTokenPair(runtime: AuthRuntime): () => void {
  const service = runtime.getTokenService()!;
  const issueTokenPair = service.issueTokenPair.bind(service);
  let fail = true;
  (service as any).issueTokenPair = async (...args: any[]) => {
    if (fail) {
      fail = false;
      throw new Error('Simulated registration session provisioning failure');
    }
    return issueTokenPair(...args as Parameters<typeof issueTokenPair>);
  };
  return () => {
    (service as any).issueTokenPair = issueTokenPair;
  };
}

async function register(
  harness: Harness,
  key: string,
  organizationName?: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${harness.url}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: key,
      email: `${key}@example.test`,
      password: 'password123',
      ...(organizationName ? { organizationName } : {}),
    }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}

function assertEmptyInstallation(db: ReactiveDB): void {
  expect(count(db, 'users')).toBe(0);
  expect(count(db, '_auth_tenants')).toBe(0);
  expect(count(db, '_auth_tenant_memberships')).toBe(0);
  expect(count(db, '_auth_tenant_membership_roles')).toBe(0);
  expect(count(db, '_auth_application_role_assignments')).toBe(0);
  expect(count(db, '_auth_application_authorization_state')).toBe(0);
  expect(count(db, '_auth_sessions')).toBe(0);
  expect(count(db, '_refresh_tokens')).toBe(0);
  expect(count(db, '_auth_action_tokens')).toBe(0);
  expect(count(db, '_auth_registration_intents')).toBe(0);
  expect(count(db, '_auth_registration_provisioning')).toBe(0);
  expect(completedBootstrapCount(db)).toBe(0);
}

function count(db: ReactiveDB, table: string): number {
  return countWhere(db, `SELECT COUNT(*) AS count FROM ${table}`);
}

function completedBootstrapCount(db: ReactiveDB): number {
  return countWhere(db, `
    SELECT COUNT(*) AS count FROM _auth_config
    WHERE key = 'auth.bootstrap.completed' AND value = '1'
  `);
}

function countWhere(db: ReactiveDB, sql: string): number {
  return (db.prepare(sql).get() as { count: number }).count;
}
