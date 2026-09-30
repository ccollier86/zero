import { afterEach, describe, expect, test } from 'bun:test';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import { createIdentityProjectionLifecycleHook } from './identity-projection-lifecycle';
import { IdentityProjectionOutboxStore } from './identity-projection-outbox-store';
import type { IdentityProjectionLifecycleHook } from './identity-projection-types';
import { TenantStore } from './tenancy';
import { UserStore, type RegistrationProvisioningReceipt } from './user-store';

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('UserStore identity projection lifecycle', () => {
  test('defers provisional hooks and activates memberships in stable tenant order', async () => {
    const db = memoryDb();
    defineAuthTables(db);
    const events: ProjectionEvent[] = [];
    const lifecycle: IdentityProjectionLifecycleHook = {
      userCreated(userId) {
        events.push({ kind: 'user', userId });
      },
      membershipCreated(input) {
        events.push({ kind: 'membership', ...input });
      },
    };
    const tenantIds = ['ten-z-existing', 'ten-a-new'];
    const membershipIds = ['tmem-existing-owner', 'tmem-z-cross', 'tmem-a-owner'];
    const users = new UserStore(db, {
      tenancyMode: 'multi',
      identityProjection: lifecycle,
    });
    const tenants = new TenantStore(db, {
      identityProjection: lifecycle,
      createTenantId: () => requireNext(tenantIds, 'tenant ID'),
      createMembershipId: () => requireNext(membershipIds, 'membership ID'),
    });

    const bootstrap = await users.createRegistrationUser({
      username: 'projection-bootstrap',
      email: 'projection-bootstrap@example.test',
      password: 'bootstrap-password1',
    }, registrationPolicy, (user) => {
      const created = tenants.createTenantWithOwner({
        name: 'Existing organization',
        slug: 'existing-organization',
        ownerUserId: user.userId,
      });
      return { tenantId: created.tenant.tenantId };
    }, { provisional: true });
    users.finalizeRegistrationProvisioning(requireReceipt(bootstrap.provisioning));
    events.length = 0;

    let crossMembershipId = '';
    let ownerMembershipId = '';
    const pending = await users.createRegistrationUser({
      username: 'projection-member',
      email: 'projection-member@example.test',
      password: 'member-password1',
    }, registrationPolicy, (user) => {
      // Insert in the reverse of the expected activation order. Finalization
      // must be deterministic rather than inheriting callback insertion order.
      crossMembershipId = tenants.createMembership({
        tenantId: 'ten-z-existing',
        userId: user.userId,
        roleKey: 'member',
        createdBy: bootstrap.user.userId,
      }).membershipId;
      const created = tenants.createTenantWithOwner({
        name: 'New organization',
        slug: 'new-organization',
        ownerUserId: user.userId,
      });
      ownerMembershipId = created.ownerMembership.membershipId;
      return { tenantId: created.tenant.tenantId };
    }, { provisional: true });

    expect(events).toEqual([]);
    users.finalizeRegistrationProvisioning(requireReceipt(pending.provisioning));

    expect(events).toEqual([
      { kind: 'user', userId: pending.user.userId },
      {
        kind: 'membership',
        membershipId: ownerMembershipId,
        tenantId: 'ten-a-new',
        userId: pending.user.userId,
      },
      {
        kind: 'membership',
        membershipId: crossMembershipId,
        tenantId: 'ten-z-existing',
        userId: pending.user.userId,
      },
    ]);
  });

  test('rejects an asynchronous user hook and rolls its writes back atomically', async () => {
    const db = memoryDb();
    defineAuthTables(db);
    db.exec('CREATE TABLE projection_hook_effects (user_id TEXT PRIMARY KEY)');
    const emitted: EmittedInvariant[] = [];
    const users = new UserStore(db, {
      identityProjection: {
        async userCreated(userId) {
          db.prepare('INSERT INTO projection_hook_effects (user_id) VALUES (?)')
            .run(userId);
          throw new Error('private asynchronous projection failure');
        },
      },
      emitCode: captureInvariants(emitted),
    });

    await expect(users.createUser({
      username: 'async-projection-user',
      email: 'async-projection-user@example.test',
      password: 'projection-password1',
    })).rejects.toMatchObject({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
    });
    await Promise.resolve();

    expect(countRows(db, 'users')).toBe(0);
    expect(countRows(db, '_credentials')).toBe(0);
    expect(countRows(db, 'projection_hook_effects')).toBe(0);
    expect(emitted).toEqual([{
      code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      metadata: {
        component: 'user-store',
        invariant: 'identity-projection-user-hook-async',
      },
    }]);
    expect(JSON.stringify(emitted)).not.toContain('private asynchronous projection failure');
  });

  test('keeps a provisional marker private when membership activation yields', async () => {
    const db = memoryDb();
    defineAuthTables(db);
    const outbox = new IdentityProjectionOutboxStore(db);
    const durableLifecycle = createIdentityProjectionLifecycleHook(outbox, {
      targetsForUser: () => [{ targetId: 'application', scope: 'application' }],
      targetsForMembership: () => [
        { targetId: 'application', scope: 'application' },
      ],
    });
    const lifecycle: IdentityProjectionLifecycleHook = {
      userCreated: (userId) => durableLifecycle.userCreated(userId),
      async membershipCreated(input) {
        durableLifecycle.membershipCreated(input);
        throw new Error('private membership continuation failure');
      },
    };
    const emitted: EmittedInvariant[] = [];
    const users = new UserStore(db, {
      tenancyMode: 'multi',
      identityProjection: lifecycle,
      emitCode: captureInvariants(emitted),
    });
    const tenants = new TenantStore(db, { identityProjection: lifecycle });
    const pending = await users.createRegistrationUser({
      username: 'async-membership-user',
      email: 'async-membership-user@example.test',
      password: 'membership-password1',
    }, registrationPolicy, (user) => {
      const created = tenants.createTenantWithOwner({
        name: 'Pending organization',
        slug: 'pending-organization',
        ownerUserId: user.userId,
      });
      return { tenantId: created.tenant.tenantId };
    }, { provisional: true });
    const receipt = requireReceipt(pending.provisioning);

    expect(() => users.finalizeRegistrationProvisioning(receipt)).toThrow(
      expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        status: 500,
      }),
    );
    await Promise.resolve();

    expect(countRows(db, '_auth_registration_provisioning')).toBe(1);
    expect(countRows(db, '_auth_identity_projection_targets')).toBe(0);
    expect(countRows(db, '_auth_identity_projection_outbox')).toBe(0);
    expect(emitted).toEqual([{
      code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      metadata: {
        component: 'user-store',
        invariant: 'identity-projection-membership-activation-hook-async',
      },
    }]);
    expect(JSON.stringify(emitted)).not.toContain('private membership continuation failure');
  });
});

type ProjectionEvent =
  | { kind: 'user'; userId: string }
  | {
      kind: 'membership';
      membershipId: string;
      tenantId: string;
      userId: string;
    };

interface EmittedInvariant {
  readonly code: string;
  readonly metadata: unknown;
}

function registrationPolicy(): {
  role: 'admin';
  requireEmailVerification: false;
  mfaRequired: false;
} {
  return {
    role: 'admin',
    requireEmailVerification: false,
    mfaRequired: false,
  };
}

function captureInvariants(emitted: EmittedInvariant[]): typeof emitPlatformCode {
  return (definition, options) => {
    emitted.push({ code: definition.code, metadata: options?.metadata });
    return emitPlatformCode(definition, options);
  };
}

function requireReceipt(
  receipt: RegistrationProvisioningReceipt | null,
): RegistrationProvisioningReceipt {
  if (!receipt) throw new Error('Expected provisional registration receipt');
  return receipt;
}

function requireNext(values: string[], label: string): string {
  const value = values.shift();
  if (!value) throw new Error(`Expected another ${label}`);
  return value;
}

function countRows(db: ReactiveDB, table: string): number {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('Invalid test table');
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return Number(row.count);
}

function memoryDb(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  db.exec('PRAGMA foreign_keys = ON');
  databases.push(db);
  return db;
}
