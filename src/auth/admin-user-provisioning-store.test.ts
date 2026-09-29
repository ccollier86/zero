import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { SQLQueryBindings } from 'bun:sqlite';

import { OBS_CODES } from '../observability/codes';
import type { PlatformCodeDefinition } from '../observability/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { PlatformTokenService } from '../tokens/token-service';
import { PlatformTokenStore } from '../tokens/token-store';
import { AuthActionTokenService } from './action-token-service';
import { defineAuthTables } from './auth-schema';
import {
  UserStore,
  type AdminUserProvisioningReceipt,
} from './user-store';

interface ProvisionedAdminUser {
  readonly userId: string;
  readonly receipt: AdminUserProvisioningReceipt;
}

let db: ReactiveDB;
let store: UserStore;
let emitted: Array<{
  code: string;
  metadata: Record<string, unknown> | undefined;
}>;
let ownerId: string;

beforeEach(async () => {
  db = createReactiveDB({ mode: 'memory' });
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  emitted = [];
  store = new UserStore(db, {
    emitCode: ((definition: PlatformCodeDefinition, options?: {
      metadata?: Record<string, unknown>;
    }) => {
      emitted.push({ code: definition.code, metadata: options?.metadata });
      return {} as never;
    }) as never,
  });
  ownerId = (await store.createUser({
    username: 'provisioning-owner',
    email: 'provisioning-owner@example.test',
    password: 'owner-password1',
    role: 'admin',
  })).userId;
});

afterEach(() => {
  db.dispose();
});

describe('administrator user provisioning recovery', () => {
  test('removes the exact legacy account-setup token and untouched account', async () => {
    const provisional = await provisionAdminUser('legacy-cleanup');
    const tokens = new AuthActionTokenService(
      store,
      '1h',
      '0s',
      null,
      quietEmitter,
    );
    const created = store.transaction(() => {
      const token = tokens.create({
        userId: provisional.userId,
        type: 'account_setup',
        skipCooldown: true,
      });
      store.bindAdminUserProvisioningSetupToken(
        provisional.receipt,
        token.record.tokenId,
      );
      return token;
    });
    expect(() => store.assertAdminUserProvisioningCommitReady(
      provisional.receipt,
    )).not.toThrow();
    expire(provisional.receipt);

    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _auth_action_tokens WHERE token_id = ?',
      created.record.tokenId,
    )).toBe(1);
    expect(store.recoverPendingAdminUserProvisioning()).toBe(1);

    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _auth_action_tokens WHERE token_id = ?',
      created.record.tokenId,
    )).toBe(0);
    expect(store.getUserById(provisional.userId)).toBeNull();
    expect(count('_auth_admin_user_provisioning')).toBe(0);
  });

  test('removes the exact platform account-setup token and untouched account', async () => {
    const provisional = await provisionAdminUser('platform-cleanup');
    const tokens = createPlatformActionTokens();
    const created = store.transaction(() => {
      const token = tokens.create({
        userId: provisional.userId,
        type: 'account_setup',
        skipCooldown: true,
      });
      store.bindAdminUserProvisioningSetupToken(
        provisional.receipt,
        token.record.tokenId,
      );
      return token;
    });
    expect(() => store.assertAdminUserProvisioningCommitReady(
      provisional.receipt,
    )).not.toThrow();
    expire(provisional.receipt);
    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _zero_action_tokens WHERE token_id = ?',
      created.record.tokenId,
    )).toBe(1);
    expect(store.recoverPendingAdminUserProvisioning()).toBe(1);

    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _zero_action_tokens WHERE token_id = ?',
      created.record.tokenId,
    )).toBe(0);
    expect(store.getUserById(provisional.userId)).toBeNull();
    expect(count('_auth_admin_user_provisioning')).toBe(0);
  });

  test('removes the bound setup token but preserves an account adopted by another token', async () => {
    const provisional = await provisionAdminUser('token-adoption');
    const tokens = createPlatformActionTokens();
    const setup = store.transaction(() => {
      const setup = tokens.create({
        userId: provisional.userId,
        type: 'account_setup',
        skipCooldown: true,
      });
      store.bindAdminUserProvisioningSetupToken(
        provisional.receipt,
        setup.record.tokenId,
      );
      return setup;
    });
    expect(() => store.assertAdminUserProvisioningCommitReady(
      provisional.receipt,
    )).not.toThrow();
    const adopted = tokens.create({
      userId: provisional.userId,
      type: 'password_reset',
      skipCooldown: true,
    });
    expect(() => store.assertAdminUserProvisioningCommitReady(
      provisional.receipt,
    )).toThrow(expect.objectContaining({ code: 'AUTH_STATE_CHANGED' }));
    expire(provisional.receipt);

    expect(store.recoverPendingAdminUserProvisioning()).toBe(1);

    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _zero_action_tokens WHERE token_id = ?',
      setup.record.tokenId,
    )).toBe(0);
    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _zero_action_tokens WHERE token_id = ?',
      adopted.record.tokenId,
    )).toBe(1);
    expect(store.getUserById(provisional.userId)).not.toBeNull();
    expect(count('_auth_admin_user_provisioning')).toBe(0);
    expect(recoveryEvents()).toEqual([{
      code: OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_RECOVERED.code,
      metadata: { cleanupSucceeded: false },
    }]);
  });

  test('refuses to bind a setup token after the original identity changes', async () => {
    const provisional = await provisionAdminUser('bind-state-fence');
    expect(store.updateUser(provisional.userId, { firstName: 'Adopted' }))
      .not.toBeNull();
    const tokens = createPlatformActionTokens();
    let tokenId: string | undefined;

    expect(() => store.transaction(() => {
      const created = tokens.create({
        userId: provisional.userId,
        type: 'account_setup',
        skipCooldown: true,
      });
      tokenId = created.record.tokenId;
      store.bindAdminUserProvisioningSetupToken(
        provisional.receipt,
        created.record.tokenId,
      );
    })).toThrow(expect.objectContaining({ code: 'AUTH_STATE_CHANGED' }));

    expect(tokenId).toBeDefined();
    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _zero_action_tokens WHERE token_id = ?',
      tokenId!,
    )).toBe(0);
    expect(count('_auth_admin_user_provisioning')).toBe(1);
    expect(store.getUserById(provisional.userId)?.firstName).toBe('Adopted');
  });

  test('refuses to bind a setup token after the provisional account is adopted', async () => {
    const provisional = await provisionAdminUser('bind-adoption-fence');
    db.exec(`
      CREATE TABLE pre_bind_user_links (
        link_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);
    db.prepare(`
      INSERT INTO pre_bind_user_links (link_id, user_id) VALUES (?, ?)
    `).run('pre-bind-link', provisional.userId);
    const tokens = createPlatformActionTokens();
    let tokenId: string | undefined;

    expect(() => store.transaction(() => {
      const created = tokens.create({
        userId: provisional.userId,
        type: 'account_setup',
        skipCooldown: true,
      });
      tokenId = created.record.tokenId;
      store.bindAdminUserProvisioningSetupToken(
        provisional.receipt,
        created.record.tokenId,
      );
    })).toThrow(expect.objectContaining({ code: 'AUTH_STATE_CHANGED' }));

    expect(tokenId).toBeDefined();
    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _zero_action_tokens WHERE token_id = ?',
      tokenId!,
    )).toBe(0);
    expect(count('pre_bind_user_links')).toBe(1);
    expect(count('_auth_admin_user_provisioning')).toBe(1);
  });

  test('does not mistake a same-id platform resume token for the bound action token', async () => {
    const provisional = await provisionAdminUser('resume-token-adoption');
    const tokens = createPlatformActionTokens();
    const setup = store.transaction(() => {
      const created = tokens.create({
        userId: provisional.userId,
        type: 'account_setup',
        skipCooldown: true,
      });
      store.bindAdminUserProvisioningSetupToken(
        provisional.receipt,
        created.record.tokenId,
      );
      return created;
    });
    db.prepare(`
      INSERT INTO _zero_resume_tokens (
        token_id, flow, token_hash, resource_type, resource_id,
        subject_type, subject_id, expires_at, created_at
      ) VALUES (?, 'adoption-proof', ?, 'account', ?, 'user', ?, ?, ?)
    `).run(
      setup.record.tokenId,
      `resume-hash-${crypto.randomUUID()}`,
      provisional.userId,
      provisional.userId,
      Date.now() + 60_000,
      Date.now(),
    );

    expect(() => store.assertAdminUserProvisioningCommitReady(
      provisional.receipt,
    )).toThrow(expect.objectContaining({ code: 'AUTH_STATE_CHANGED' }));
    expire(provisional.receipt);
    expect(store.recoverPendingAdminUserProvisioning()).toBe(1);

    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _zero_action_tokens WHERE token_id = ?',
      setup.record.tokenId,
    )).toBe(0);
    expect(countWhere(
      'SELECT COUNT(*) AS count FROM _zero_resume_tokens WHERE token_id = ?',
      setup.record.tokenId,
    )).toBe(1);
    expect(store.getUserById(provisional.userId)).not.toBeNull();
    expect(count('_auth_admin_user_provisioning')).toBe(0);
  });

  test('recognizes mixed-case REFERENCES Users as adoption and retires only the receipt', async () => {
    const provisional = await provisionAdminUser('foreign-key-adoption');
    db.exec(`
      CREATE TABLE app_user_links (
        link_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
      )
    `);
    db.prepare(`
      INSERT INTO app_user_links (link_id, user_id) VALUES (?, ?)
    `).run('adopted-link', provisional.userId);
    expire(provisional.receipt);

    expect(store.recoverPendingAdminUserProvisioning()).toBe(1);

    expect(store.getUserById(provisional.userId)).not.toBeNull();
    expect(count('app_user_links')).toBe(1);
    expect(count('_auth_admin_user_provisioning')).toBe(0);
    expect(recoveryEvents()).toEqual([{
      code: OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_RECOVERED.code,
      metadata: { cleanupSucceeded: false },
    }]);
  });

  test('does not grant registration-only authority to an admin provisioning receipt', async () => {
    const provisional = await provisionAdminUser('authority-isolation', {
      status: 'suspended',
    });

    expect(count('_auth_admin_user_provisioning')).toBe(1);
    expect(count('_auth_registration_provisioning')).toBe(0);
    expect(store.hasPendingRegistrationProvisioning(provisional.userId)).toBe(false);
  });

  test('suppresses recovery events and restores state when an outer transaction rolls back', async () => {
    const provisional = await provisionAdminUser('outer-rollback');
    expire(provisional.receipt);
    emitted = [];

    expect(() => db.transaction(() => {
      expect(store.recoverPendingAdminUserProvisioning()).toBe(1);
      expect(store.getUserById(provisional.userId)).toBeNull();
      expect(count('_auth_admin_user_provisioning')).toBe(0);
      throw new Error('abort outer transaction');
    })).toThrow('abort outer transaction');

    expect(store.getUserById(provisional.userId)).not.toBeNull();
    expect(count('_auth_admin_user_provisioning')).toBe(1);
    expect(recoveryEvents()).toEqual([]);

    expect(store.recoverPendingAdminUserProvisioning()).toBe(1);
    expect(store.getUserById(provisional.userId)).toBeNull();
    expect(recoveryEvents()).toEqual([{
      code: OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_RECOVERED.code,
      metadata: { cleanupSucceeded: true },
    }]);
  });
});

async function provisionAdminUser(
  name: string,
  overrides: { status?: 'active' | 'suspended' } = {},
): Promise<ProvisionedAdminUser> {
  const created = await store.createAdminProvisionedUser({
    username: name,
    email: `${name}@example.test`,
    password: 'temporary-password1',
    role: 'user',
    ...overrides,
  }, {
    actor: { userId: ownerId, provenance: 'authenticated-request' },
    setupRequested: true,
  }, () => {});
  return {
    userId: created.user.userId,
    receipt: created.provisioning,
  };
}

function createPlatformActionTokens(): AuthActionTokenService {
  const platform = new PlatformTokenService(
    new PlatformTokenStore(db),
    { actionTokenCooldown: false },
    quietEmitter,
  );
  return new AuthActionTokenService(store, '1h', '0s', platform, quietEmitter);
}

function expire(receipt: AdminUserProvisioningReceipt): void {
  db.prepare(`
    UPDATE _auth_admin_user_provisioning
    SET lease_expires_at = ?
    WHERE provisioning_id = ? AND user_id = ?
  `).run(Date.now() - 1, receipt.provisioningId, receipt.userId);
}

function count(table: string): number {
  return countWhere(`SELECT COUNT(*) AS count FROM "${table}"`);
}

function countWhere(sql: string, ...params: SQLQueryBindings[]): number {
  return Number((db.prepare(sql).get(...params) as { count: number }).count);
}

function recoveryEvents() {
  return emitted.filter(({ code }) => (
    code === OBS_CODES.AUTH_ADMIN_USER_PROVISIONING_RECOVERED.code
  ));
}

const quietEmitter = (() => ({} as never)) as never;
