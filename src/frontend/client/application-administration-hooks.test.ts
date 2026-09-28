import { describe, expect, test } from 'bun:test';
import type {
  AuthApplicationAdministrationConfig,
  AuthApplicationUser,
} from './auth-application-administration-types';
import { projectApplicationAccessSnapshot } from './application-administration-hooks';

describe('application access actor cache boundary', () => {
  test('masks the previous identity synchronously during account replacement', () => {
    const config = {
      authorization: 'advanced',
      actor: {
        userId: 'user-a',
        roles: ['owner'],
        permissions: [],
        allPermissions: true,
      },
      capabilities: {
        canReadUsers: true,
        canManageRoles: true,
        canTransferOwnership: true,
      },
      roles: [],
    } satisfies AuthApplicationAdministrationConfig;
    const users = [applicationUser('sensitive-user')];
    const cached = {
      config,
      users,
      page: { limit: 25, count: 1, hasMore: false, nextCursor: null },
      isDenied: false,
      error: 'prior identity error',
    };

    expect(projectApplicationAccessSnapshot('user-a', 'user-a', cached)).toMatchObject({
      isCurrent: true,
      config: { actor: { userId: 'user-a' } },
      users: [{ identity: { userId: 'sensitive-user' } }],
    });
    const masked = projectApplicationAccessSnapshot('user-b', 'user-a', cached);
    expect(masked).toEqual({
      isCurrent: false,
      config: null,
      users: [],
      page: null,
      isDenied: false,
      error: null,
    });
    expect(Object.isFrozen(masked.users)).toBe(true);
  });
});

function applicationUser(userId: string): AuthApplicationUser {
  return {
    identity: {
      userId,
      username: userId,
      email: `${userId}@example.test`,
      firstName: null,
      lastName: null,
    },
    status: 'active',
    roles: ['reader'],
    roleRevision: 'application:application:1',
    createdAt: 1,
    updatedAt: null,
  };
}
