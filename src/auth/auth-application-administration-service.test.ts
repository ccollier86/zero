import { afterEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthApplicationAdministrationService } from './auth-application-administration-service';
import { AuthAuditService } from './auth-audit-service';
import { resolveAuthAuditConfig } from './auth-audit-config';
import { defineAuthTables } from './auth-schema';
import { createAuthorizationKernel } from './authorization-kernel';
import { AuthorizationRoleService } from './authorization-role-service';
import { AuthorizationRoleStore } from './authorization-role-store';
import { AuthError } from './types';
import { UserStore } from './user-store';

interface Harness {
  db: ReactiveDB;
  users: UserStore;
  roles: AuthorizationRoleService;
  service: AuthApplicationAdministrationService;
}

const databases: ReactiveDB[] = [];

afterEach(() => {
  for (const db of databases.splice(0).reverse()) db.dispose();
});

describe('single-application access administration service', () => {
  test('fails cached reads and role mutations after the installed profile changes', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner', 1);
    insertUser(harness.db, 'subject', 2);
    harness.roles.establishBootstrapOwner('owner');
    let current = true;
    harness.users.setRuntimeProfileGuard(() => {
      if (!current) throw new Error('AUTH_PROFILE_CHANGED');
    });

    expect(harness.service.getConfig('owner').actor.userId).toBe('owner');
    const subjectRevision = harness.roles.getRetainedApplicationRoleSet('subject').revision;
    current = false;

    expect(() => harness.service.getConfig('owner')).toThrow('AUTH_PROFILE_CHANGED');
    expect(() => harness.service.listUsers('owner')).toThrow('AUTH_PROFILE_CHANGED');
    expect(() => replaceUserRoles(harness, {
      actorUserId: 'owner',
      userId: 'subject',
      roleKeys: ['reader'],
      expectedRevision: subjectRevision,
    })).toThrow('AUTH_PROFILE_CHANGED');
    expect(harness.db.prepare(`SELECT COUNT(*) AS count
      FROM _auth_application_role_assignments WHERE user_id = 'subject'`).get())
      .toEqual({ count: 0 });
  });

  test('returns bounded safe projections and never treats a platform admin as application authority', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner', 1, 'user');
    insertUser(harness.db, 'platform-admin', 2, 'admin');
    insertUser(harness.db, 'subject', 3, 'user');
    harness.roles.establishBootstrapOwner('owner');

    expectAuthError(
      () => harness.service.getConfig('platform-admin'),
      'FORBIDDEN',
    );
    const config = harness.service.getConfig('owner');
    expect(config).toMatchObject({
      authorization: 'advanced',
      actor: { userId: 'owner', roles: ['owner'], allPermissions: true },
      capabilities: {
        canReadUsers: true,
        canManageRoles: true,
        canTransferOwnership: true,
      },
    });
    expect(config.roles.find((role) => role.key === 'owner')).toMatchObject({
      system: true,
      assignable: false,
      grantable: false,
    });

    const first = harness.service.listUsers('owner', { limit: 1 });
    expect(first.users).toHaveLength(1);
    expect(first.page).toMatchObject({ limit: 1, count: 1, hasMore: true });
    expect(first.page.nextCursor).toBeString();
    const projected = first.users[0]!;
    expect(projected.identity).toEqual({
      userId: 'owner',
      username: 'user-1',
      email: 'user-1@example.test',
      firstName: 'First1',
      lastName: 'Last1',
    });
    expect(projected).not.toHaveProperty('role');
    expect(projected).not.toHaveProperty('mfaRequired');
    expect(projected).not.toHaveProperty('passwordChangeRequired');
    expect(projected.identity).not.toHaveProperty('role');

    const second = harness.service.listUsers('owner', {
      limit: 2,
      cursor: first.page.nextCursor!,
    });
    expect(second.users.map((user) => user.identity.userId))
      .toEqual(['platform-admin', 'subject']);
    expect(harness.service.listUsers('owner', { search: 'SUBJECT' }).users)
      .toHaveLength(0);
    expect(harness.service.listUsers('owner', { search: 'user-3' }).users)
      .toHaveLength(1);
    expect(harness.service.listUsers('owner', { search: '%' }).users).toHaveLength(0);
    expect(harness.service.listUsers('owner', { search: '_' }).users).toHaveLength(0);
    expectAuthError(
      () => harness.service.listUsers('owner', { cursor: 'broken' }),
      'APPLICATION_USER_PAGE_INVALID',
    );
    for (const cursor of [null, false, 0, {}, [], Symbol('cursor')]) {
      expectAuthError(
        () => harness.service.listUsers('owner', { cursor } as never),
        'APPLICATION_USER_PAGE_INVALID',
      );
    }
    for (const status of [
      null,
      false,
      0,
      '',
      'removed',
      {},
      [],
      Symbol('status'),
    ]) {
      expectAuthError(
        () => harness.service.listUsers('owner', { status } as never),
        'APPLICATION_USER_PAGE_INVALID',
      );
    }
  });

  test('enforces a live grant ceiling, preserves system roles, and invalidates self changes', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner', 1);
    insertUser(harness.db, 'manager', 2);
    insertUser(harness.db, 'subject', 3);
    harness.roles.establishBootstrapOwner('owner');
    harness.roles.replaceApplicationRoles({
      userId: 'manager',
      roleKeys: ['delegated-manager'],
      changedBy: 'owner',
    });
    harness.roles.replaceApplicationRoles({
      userId: 'subject',
      roleKeys: ['editor'],
      changedBy: 'owner',
    });

    const managerConfig = harness.service.getConfig('manager');
    expect(managerConfig.roles.find((role) => role.key === 'reader')?.grantable).toBe(true);
    expect(managerConfig.roles.find((role) => role.key === 'editor')?.grantable).toBe(false);

    // A higher role may be retained while this actor changes a role within its
    // own ceiling, but omission cannot be used to revoke superior authority.
    expect(replaceUserRoles(harness, {
      actorUserId: 'manager',
      userId: 'subject',
      roleKeys: ['editor', 'reader'],
      expectedRevision: applicationRevision(harness, 'subject'),
    }).user.roles).toEqual(['editor', 'reader']);
    expectAuthError(() => replaceUserRoles(harness, {
      actorUserId: 'manager',
      userId: 'subject',
      roleKeys: ['reader'],
      expectedRevision: applicationRevision(harness, 'subject'),
    }), 'APPLICATION_ROLE_ESCALATION_FORBIDDEN');
    expect(harness.roles.getRetainedApplicationRoleKeys('subject'))
      .toEqual(['editor', 'reader']);

    expectAuthError(() => replaceUserRoles(harness, {
      actorUserId: 'owner',
      userId: 'subject',
      roleKeys: ['owner'],
      expectedRevision: applicationRevision(harness, 'subject'),
    }), 'APPLICATION_OWNER_ROLE_PROTECTED');

    harness.users.updateUser('subject', { status: 'suspended' });
    expectAuthError(() => replaceUserRoles(harness, {
      actorUserId: 'owner',
      userId: 'subject',
      roleKeys: ['editor', 'reader', 'viewer'],
      expectedRevision: applicationRevision(harness, 'subject'),
    }), 'APPLICATION_USER_SUBJECT_INACTIVE');
    // Revocation from an unavailable account remains possible.
    expect(replaceUserRoles(harness, {
      actorUserId: 'owner',
      userId: 'subject',
      roleKeys: [],
      expectedRevision: applicationRevision(harness, 'subject'),
    }).user.roles).toEqual([]);

    const self = replaceUserRoles(harness, {
      actorUserId: 'manager',
      userId: 'manager',
      roleKeys: [],
      expectedRevision: applicationRevision(harness, 'manager'),
    });
    expect(self.actorAuthorizationChanged).toBe(true);
    expectAuthError(() => harness.service.getConfig('manager'), 'FORBIDDEN');
  });

  test('rejects malformed role sets without mutating or accidentally clearing grants', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner', 1);
    insertUser(harness.db, 'subject', 2);
    harness.roles.establishBootstrapOwner('owner');
    harness.roles.replaceApplicationRoles({
      userId: 'subject',
      roleKeys: ['reader'],
      changedBy: 'owner',
    });
    const revision = applicationRevision(harness, 'subject');
    const sparse = new Array(2) as string[];
    sparse[0] = 'reader';
    const malformed: unknown[] = [
      undefined,
      null,
      false,
      'reader',
      {},
      sparse,
      [''],
      ['   '],
      ['reader', 7],
      ['reader', 'reader'],
      ['reader', ' reader '],
      ['Not-A-Role'],
      ['role with spaces'],
      ['a'.repeat(65)],
      Array.from({ length: 129 }, (_, index) => `role-${index}`),
    ];

    for (const roleKeys of malformed) {
      expectApplicationRoleSelectionInvalid(() => replaceUserRoles(harness, {
        actorUserId: 'owner',
        userId: 'subject',
        roleKeys: roleKeys as readonly string[],
        expectedRevision: revision,
      }));
      expect(harness.roles.getRetainedApplicationRoleSet('subject')).toMatchObject({
        roles: ['reader'],
        revision,
      });
    }

    // A literal empty array remains the one unambiguous role-clear operation.
    expect(replaceUserRoles(harness, {
      actorUserId: 'owner',
      userId: 'subject',
      roleKeys: [],
      expectedRevision: revision,
    }).user.roles).toEqual([]);
  });

  test('detaches role-mutation input before invoking live authority', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner', 1);
    insertUser(harness.db, 'subject', 2);
    insertUser(harness.db, 'decoy', 3);
    harness.roles.establishBootstrapOwner('owner');
    harness.roles.replaceApplicationRoles({
      userId: 'subject',
      roleKeys: ['reader'],
      changedBy: 'owner',
    });
    harness.roles.replaceApplicationRoles({
      userId: 'decoy',
      roleKeys: ['viewer'],
      changedBy: 'owner',
    });
    const authority = testApplicationAuthority(harness, 'owner');
    const selectedRoles = ['reader'];
    const auditRequest = { requestId: 'request-before-authority' };
    const input: Parameters<
      AuthApplicationAdministrationService['replaceUserRoles']
    >[0] = {
      actorUserId: 'owner',
      userId: 'subject',
      roleKeys: selectedRoles,
      expectedRevision: applicationRevision(harness, 'subject'),
      auditRequest,
      assertCurrentAuthority: (permissions) => {
        input.actorUserId = 'decoy';
        input.userId = 'decoy';
        input.expectedRevision = applicationRevision(harness, 'decoy');
        selectedRoles.splice(0, selectedRoles.length, 'editor');
        auditRequest.requestId = 'request-after-authority';
        return authority(permissions);
      },
    };

    const result = harness.service.replaceUserRoles(input);

    expect(result.user).toMatchObject({
      identity: { userId: 'subject' },
      roles: ['reader'],
    });
    expect(harness.roles.getRetainedApplicationRoleKeys('decoy')).toEqual(['viewer']);
    expect(harness.db.prepare(`
      SELECT request_id, target_id FROM _auth_audit_events
      WHERE action = 'application.roles-replaced'
      ORDER BY occurred_at DESC LIMIT 1
    `).get()).toEqual({
      request_id: 'request-before-authority',
      target_id: 'subject',
    });
  });

  test('rejects stale whole-set writes and lets only an owner retire orphaned roles', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner', 1);
    insertUser(harness.db, 'manager', 2);
    insertUser(harness.db, 'subject', 3);
    harness.roles.establishBootstrapOwner('owner');
    harness.roles.replaceApplicationRoles({
      userId: 'manager',
      roleKeys: ['delegated-manager'],
      changedBy: 'owner',
    });
    harness.roles.replaceApplicationRoles({
      userId: 'subject',
      roleKeys: ['reader'],
      changedBy: 'owner',
    });

    const staleRevision = applicationRevision(harness, 'subject');
    replaceUserRoles(harness, {
      actorUserId: 'owner',
      userId: 'subject',
      roleKeys: ['viewer'],
      expectedRevision: staleRevision,
    });
    expectAuthError(() => replaceUserRoles(harness, {
      actorUserId: 'owner',
      userId: 'subject',
      roleKeys: ['editor'],
      expectedRevision: staleRevision,
    }), 'APPLICATION_ROLE_REVISION_CONFLICT');
    expect(harness.roles.getRetainedApplicationRoleKeys('subject')).toEqual(['viewer']);

    harness.db.prepare(`
      INSERT INTO _auth_application_role_assignments (
        assignment_id, application_id, user_id, role_key, source, source_id,
        created_by, created_at, revoked_by, revoked_at
      ) VALUES (?, 'application', ?, 'retired-role', 'migration', ?, ?, ?, NULL, NULL)
    `).run('retired-assignment', 'subject', 'retired-test', 'owner', Date.now());
    harness.db.prepare(`
      UPDATE _auth_application_authorization_state
      SET authorization_generation = authorization_generation + 1
      WHERE application_id = 'application' AND user_id = ?
    `).run('subject');
    expect(harness.roles.getExpandedApplicationRoles('subject')).toMatchObject({
      roles: ['retired-role', 'viewer'],
      permissions: ['documents:read'],
    });
    const retiredRevision = applicationRevision(harness, 'subject');
    const projected = harness.service.listUsers('owner', { search: 'user-3' }).users[0]!;
    expect(projected).toMatchObject({
      roles: ['retired-role', 'viewer'],
      roleRevision: retiredRevision,
    });
    expectAuthError(() => replaceUserRoles(harness, {
      actorUserId: 'manager',
      userId: 'subject',
      roleKeys: ['retired-role', 'viewer', 'reader'],
      expectedRevision: retiredRevision,
    }), 'APPLICATION_RETIRED_ROLE_CLEANUP_REQUIRED');
    expectAuthError(() => replaceUserRoles(harness, {
      actorUserId: 'manager',
      userId: 'subject',
      roleKeys: ['viewer'],
      expectedRevision: retiredRevision,
    }), 'APPLICATION_ROLE_ESCALATION_FORBIDDEN');

    const cleaned = replaceUserRoles(harness, {
      actorUserId: 'owner',
      userId: 'subject',
      roleKeys: ['viewer'],
      expectedRevision: retiredRevision,
    });
    expect(cleaned.user.roles).toEqual(['viewer']);
    expect(cleaned.user.roleRevision).not.toBe(retiredRevision);
  });

  test('transfers ownership assign-new-before-revoke-old and bumps both revisions atomically', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner', 1);
    insertUser(harness.db, 'target', 2);
    insertUser(harness.db, 'inactive', 3);
    harness.roles.establishBootstrapOwner('owner');
    harness.roles.replaceApplicationRoles({
      userId: 'target',
      roleKeys: ['reader'],
      changedBy: 'owner',
    });
    harness.users.updateUser('inactive', { status: 'suspended' });
    const oldBefore = harness.roles.resolveApplicationRoles('owner')!.revision;
    const targetBefore = harness.roles.resolveApplicationRoles('target')!.revision;

    expectAuthError(() => transferOwnership(harness, {
      actorUserId: 'owner',
      targetUserId: 'inactive',
    }), 'APPLICATION_USER_SUBJECT_INACTIVE');
    harness.users.updateUser('target', { passwordChangeRequired: true });
    expectAuthError(() => transferOwnership(harness, {
      actorUserId: 'owner',
      targetUserId: 'target',
    }), 'AUTHORIZATION_OWNERSHIP_TARGET_INVALID');
    harness.users.updateUser('target', {
      passwordChangeRequired: false,
      emailVerificationRequired: true,
      emailVerifiedAt: null,
    });
    expectAuthError(() => transferOwnership(harness, {
      actorUserId: 'owner',
      targetUserId: 'target',
    }), 'AUTHORIZATION_OWNERSHIP_TARGET_INVALID');
    harness.users.updateUser('target', {
      emailVerificationRequired: true,
      emailVerifiedAt: Date.now(),
    });
    const result = transferOwnership(harness, {
      actorUserId: 'owner',
      targetUserId: 'target',
    });
    expect(result).toMatchObject({
      actorAuthorizationChanged: true,
      owner: { identity: { userId: 'target' }, roles: ['owner', 'reader'] },
      previousOwner: { identity: { userId: 'owner' }, roles: [] },
    });
    expect(harness.roles.resolveApplicationRoles('owner')!.revision).not.toBe(oldBefore);
    expect(harness.roles.resolveApplicationRoles('target')!.revision).not.toBe(targetBefore);
    expectAuthError(() => harness.service.getConfig('owner'), 'FORBIDDEN');
    expect(harness.service.getConfig('target').capabilities.canTransferOwnership).toBe(true);
  });

  test('detaches ownership target and audit input before invoking live authority', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner', 1);
    insertUser(harness.db, 'target', 2);
    insertUser(harness.db, 'decoy', 3);
    harness.roles.establishBootstrapOwner('owner');
    const authority = testApplicationAuthority(harness, 'owner');
    const auditRequest = { correlationId: 'correlation-before-authority' };
    const input: Parameters<
      AuthApplicationAdministrationService['transferOwnership']
    >[0] = {
      actorUserId: 'owner',
      targetUserId: 'target',
      auditRequest,
      assertCurrentAuthority: (permissions) => {
        input.actorUserId = 'decoy';
        input.targetUserId = 'decoy';
        auditRequest.correlationId = 'correlation-after-authority';
        return authority(permissions);
      },
    };

    const result = harness.service.transferOwnership(input);

    expect(result.owner.identity.userId).toBe('target');
    expect(harness.roles.getRetainedApplicationRoleKeys('decoy')).toEqual([]);
    expect(harness.db.prepare(`
      SELECT correlation_id, target_id FROM _auth_audit_events
      WHERE action = 'application.ownership-transferred'
      ORDER BY occurred_at DESC LIMIT 1
    `).get()).toEqual({
      correlation_id: 'correlation-before-authority',
      target_id: 'target',
    });
  });

  test('rolls back the target owner grant when revoking the prior owner fails', () => {
    const harness = createHarness();
    insertUser(harness.db, 'owner', 1);
    insertUser(harness.db, 'target', 2);
    harness.roles.establishBootstrapOwner('owner');
    harness.db.exec(`
      CREATE TRIGGER fail_application_owner_revoke
      BEFORE UPDATE OF revoked_at ON _auth_application_role_assignments
      WHEN OLD.user_id = 'owner' AND OLD.role_key = 'owner'
      BEGIN
        SELECT RAISE(ABORT, 'injected owner transfer failure');
      END
    `);

    expect(() => transferOwnership(harness, {
      actorUserId: 'owner',
      targetUserId: 'target',
    })).toThrow('injected owner transfer failure');
    expect(harness.roles.getRetainedApplicationRoleKeys('owner')).toEqual(['owner']);
    expect(harness.roles.getRetainedApplicationRoleKeys('target')).toEqual([]);
  });
});

function createHarness(): Harness {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  const users = new UserStore(db);
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'single',
    authorization: {
      mode: 'advanced',
      permissions: {
        'documents:read': { label: 'Read documents' },
        'documents:write': { label: 'Write documents' },
      },
      roles: {
        reader: { permissions: ['documents:read'] },
        viewer: { permissions: ['documents:read'] },
        editor: { permissions: ['documents:read', 'documents:write'] },
        'delegated-manager': {
          permissions: [
            'application.roles:read',
            'application.roles:manage',
            'documents:read',
          ],
        },
      },
    },
  }));
  const roles = new AuthorizationRoleService(
    db,
    new AuthorizationRoleStore(db),
    kernel,
    users,
    null,
  );
  return {
    db,
    users,
    roles,
    service: new AuthApplicationAdministrationService(
      db,
      kernel,
      users,
      roles,
      new AuthAuditService(db, resolveAuthAuditConfig(undefined)),
    ),
  };
}

type ReplaceUserRolesInput = Omit<
  Parameters<AuthApplicationAdministrationService['replaceUserRoles']>[0],
  'assertCurrentAuthority'
>;

type TransferOwnershipInput = Omit<
  Parameters<AuthApplicationAdministrationService['transferOwnership']>[0],
  'assertCurrentAuthority'
>;

function replaceUserRoles(
  harness: Harness,
  input: ReplaceUserRolesInput,
) {
  return harness.service.replaceUserRoles({
    ...input,
    assertCurrentAuthority: testApplicationAuthority(harness, input.actorUserId),
  });
}

function transferOwnership(
  harness: Harness,
  input: TransferOwnershipInput,
) {
  return harness.service.transferOwnership({
    ...input,
    assertCurrentAuthority: testApplicationAuthority(harness, input.actorUserId),
  });
}

function testApplicationAuthority(harness: Harness, userId: string) {
  return (requiredPermissions: Parameters<
    Parameters<AuthApplicationAdministrationService['replaceUserRoles']>[0][
      'assertCurrentAuthority'
    ]
  >[0]) => {
    const user = harness.users.getUserById(userId);
    const authority = harness.roles.getExpandedApplicationRoles(userId);
    if (!user || !authority || requiredPermissions.some((permission) => (
      !authority.allPermissions && !authority.permissions.includes(permission)
    ))) {
      throw new AuthError('Forbidden', 'FORBIDDEN', 403);
    }
    return {
      auth: {
        userId: user.userId,
        email: user.email,
        role: user.role,
      },
      scope: {
        tenancy: 'single' as const,
        mode: 'advanced' as const,
        scopeKind: 'application' as const,
        scopeId: 'application',
        roles: authority.roles,
        permissions: authority.permissions,
        allPermissions: authority.allPermissions,
        revision: authority.revision,
      },
    };
  };
}

function insertUser(
  db: ReactiveDB,
  userId: string,
  index: number,
  platformRole = 'user',
): void {
  db.prepare(`
    INSERT INTO users (
      user_id, username, email, first_name, last_name, role, status,
      password_change_required, email_verification_required, mfa_required,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 0, 0, ?, NULL)
  `).run(
    userId,
    `user-${index}`,
    `user-${index}@example.test`,
    `First${index}`,
    `Last${index}`,
    platformRole,
    index,
  );
}

function expectAuthError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`Expected auth error: ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe(code);
  }
}

function expectApplicationRoleSelectionInvalid(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected application role selection to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      code: 'APPLICATION_ROLE_SELECTION_INVALID',
      message: 'Application role selection is invalid',
      status: 422,
    });
  }
}

function applicationRevision(harness: Harness, userId: string): string {
  return harness.roles.getRetainedApplicationRoleSet(userId).revision;
}
