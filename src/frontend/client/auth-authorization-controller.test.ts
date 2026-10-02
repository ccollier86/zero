import { describe, expect, test } from 'bun:test';
import { AuthAuthorizationController } from './auth-authorization-controller';
import {
  hasAuthorizationPermission,
  type AuthAuthorizationSnapshot,
} from './auth-authorization-types';
import { AuthClientError } from './auth-errors';
import type { AuthAuthorizationSessionView } from './auth-authorization-controller';

describe('AuthAuthorizationController', () => {
  test('permission helpers reject undeclared keys even for an all-permissions role', () => {
    const base = snapshot('user-a', null, ['records:read'], 'all-1');
    const current: AuthAuthorizationSnapshot = {
      ...base,
      scope: { ...base.scope!, allPermissions: true },
    };
    expect(hasAuthorizationPermission(current, 'records:read')).toBe(true);
    expect(hasAuthorizationPermission(current, 'records:typo')).toBe(false);
  });

  test('clears account A immediately and suppresses its late response after account B replaces it', async () => {
    const harness = createHarness(session('user-a', 'token-a'));
    const unsubscribe = harness.controller.subscribe(() => {});
    expect(harness.loads).toHaveLength(1);

    harness.setSession(session('user-b', 'token-b'));
    expect(harness.controller.getSnapshot()).toMatchObject({
      status: 'loading',
      snapshot: null,
    });
    expect(harness.loads).toHaveLength(2);

    harness.loads[1]!.resolve(snapshot('user-b', null, ['records:read'], 'b1'));
    await harness.loads[1]!.promise;
    expect(harness.controller.getSnapshot().snapshot?.identity.userId).toBe('user-b');

    harness.loads[0]!.resolve(snapshot('user-a', null, ['records:write'], 'a1'));
    await harness.loads[0]!.promise;
    await flush();
    expect(harness.controller.getSnapshot().snapshot).toMatchObject({
      identity: { userId: 'user-b' },
      revision: 'b1',
    });

    unsubscribe();
    harness.controller.dispose();
  });

  test('invalidates tenant one before requesting tenant two and rejects a mismatched tenant body', async () => {
    const harness = createHarness(session('user-a', 'token-1', 'tenant-1'));
    const unsubscribe = harness.controller.subscribe(() => {});
    harness.loads[0]!.resolve(snapshot('user-a', 'tenant-1', ['records:read'], 't1'));
    await harness.loads[0]!.promise;
    expect(harness.controller.getSnapshot().snapshot?.scope?.tenantId).toBe('tenant-1');

    harness.setSession(session('user-a', 'token-2', 'tenant-2'));
    expect(harness.controller.getSnapshot().snapshot).toBeNull();
    harness.loads[1]!.resolve(snapshot('user-a', 'tenant-1', ['records:read'], 'wrong'));
    await harness.loads[1]!.promise;
    await flush();

    expect(harness.controller.getSnapshot()).toMatchObject({
      status: 'error',
      snapshot: null,
    });
    expect(harness.controller.getSnapshot().error).toContain('another identity or scope');
    unsubscribe();
    harness.controller.dispose();
  });

  test('accepts a fail-closed null scope for the current multi-tenant identity', async () => {
    const harness = createHarness(session('user-a', 'token-1', 'tenant-1'));
    const unsubscribe = harness.controller.subscribe(() => {});
    const denied: AuthAuthorizationSnapshot = {
      ...snapshot('user-a', 'tenant-1', [], 'denied-1'),
      scope: null,
    };
    harness.loads[0]!.resolve(denied);
    await harness.loads[0]!.promise;
    await flush();

    expect(harness.controller.getSnapshot()).toMatchObject({
      status: 'ready',
      snapshot: { scope: null, revision: 'denied-1' },
    });
    unsubscribe();
    harness.controller.dispose();
  });

  test('replaces a retained permission snapshot when live authority is revoked', async () => {
    const harness = createHarness(session('user-a', 'token-a'));
    const unsubscribe = harness.controller.subscribe(() => {});
    harness.loads[0]!.resolve(snapshot('user-a', null, ['records:write'], 'revision-1'));
    await harness.loads[0]!.promise;
    expect(hasAuthorizationPermission(
      harness.controller.getSnapshot().snapshot,
      'records:write',
    )).toBe(true);

    const refresh = harness.controller.refresh();
    expect(harness.controller.getSnapshot()).toMatchObject({
      status: 'refreshing',
      snapshot: { revision: 'revision-1' },
    });
    harness.loads[1]!.resolve(snapshot('user-a', null, [], 'revision-2'));
    await refresh;

    expect(harness.controller.getSnapshot()).toMatchObject({
      status: 'ready',
      snapshot: { revision: 'revision-2', scope: { permissions: [] } },
    });
    expect(hasAuthorizationPermission(
      harness.controller.getSnapshot().snapshot,
      'records:write',
    )).toBe(false);
    unsubscribe();
    harness.controller.dispose();
  });

  test('drops same-session grants synchronously and fences an in-flight stale result', async () => {
    const harness = createHarness(session('user-a', 'token-a'));
    const unsubscribe = harness.controller.subscribe(() => {});
    harness.loads[0]!.resolve(snapshot('user-a', null, ['records:write'], 'manager-1'));
    await harness.loads[0]!.promise;
    expect(hasAuthorizationPermission(
      harness.controller.getSnapshot().snapshot,
      'records:write',
    )).toBe(true);

    const staleRefresh = harness.controller.refresh();
    expect(harness.controller.getSnapshot().snapshot?.revision).toBe('manager-1');
    harness.controller.invalidate();
    expect(harness.controller.getSnapshot()).toMatchObject({
      status: 'loading',
      snapshot: null,
    });
    expect(harness.loads).toHaveLength(3);

    harness.loads[2]!.resolve(snapshot('user-a', null, [], 'owner-only-2'));
    await harness.loads[2]!.promise;
    harness.loads[1]!.resolve(snapshot('user-a', null, ['records:write'], 'stale-manager-2'));
    await staleRefresh;
    await flush();

    expect(harness.controller.getSnapshot()).toMatchObject({
      status: 'ready',
      snapshot: { revision: 'owner-only-2', scope: { permissions: [] } },
    });
    expect(hasAuthorizationPermission(
      harness.controller.getSnapshot().snapshot,
      'records:write',
    )).toBe(false);
    unsubscribe();
    harness.controller.dispose();
  });

  test('fails closed and expires local auth after the live endpoint rejects authority', async () => {
    const harness = createHarness(session('user-a', 'token-a'));
    const unsubscribe = harness.controller.subscribe(() => {
      throw new Error('consumer listener failed');
    });
    harness.loads[0]!.reject(new AuthClientError(
      'Unauthorized',
      401,
      'UNAUTHORIZED',
      null,
    ));
    await expect(harness.loads[0]!.promise).rejects.toThrow('Unauthorized');
    await flush();

    expect(harness.expirations).toBe(1);
    expect(harness.controller.getSnapshot()).toMatchObject({
      status: 'revoked',
      snapshot: null,
    });
    unsubscribe();
    harness.controller.dispose();
  });
});

function createHarness(initial: AuthAuthorizationSessionView) {
  let view = initial;
  let listener = () => {};
  let expirations = 0;
  const loads: Array<ReturnType<typeof deferred<AuthAuthorizationSnapshot>>> = [];
  const controller = new AuthAuthorizationController({
    readSession: () => view,
    subscribeSession(callback) {
      listener = callback;
      return () => { listener = () => {}; };
    },
    load() {
      const next = deferred<AuthAuthorizationSnapshot>();
      loads.push(next);
      return next.promise;
    },
    expireSession() {
      expirations += 1;
      view = {
        ...view,
        user: null,
        activeTenant: null,
        accessToken: null,
        isLoading: false,
      };
      listener();
    },
    revalidateIntervalMs: 0,
  });
  return {
    controller,
    loads,
    get expirations() { return expirations; },
    setSession(next: AuthAuthorizationSessionView) {
      view = next;
      listener();
    },
  };
}

function session(
  userId: string,
  accessToken: string,
  tenantId: string | null = null,
): AuthAuthorizationSessionView {
  return {
    user: {
      userId,
      username: userId,
      email: `${userId}@example.test`,
      firstName: null,
      lastName: null,
      role: 'user',
      status: 'active',
      passwordChangeRequired: false,
      emailVerifiedAt: 1,
      emailVerificationRequired: false,
      mfaRequired: false,
      properties: {},
      createdAt: 1,
      updatedAt: null,
    },
    activeTenant: tenantId ? {
      tenantId,
      kind: 'organization',
      slug: tenantId,
      name: tenantId,
      role: 'member',
    } : null,
    accessToken,
    isLoading: false,
    transition: {
      phase: 'idle',
      operation: null,
      revision: 0,
      recoverable: false,
      error: null,
    },
  };
}

function snapshot(
  userId: string,
  tenantId: string | null,
  permissions: string[],
  revision: string,
): AuthAuthorizationSnapshot {
  return {
    version: 1,
    identity: { userId, platformRole: 'user' },
    profile: {
      tenancy: tenantId ? 'multi' : 'single',
      authorization: 'advanced',
    },
    scope: tenantId ? {
      kind: 'tenant',
      scopeId: tenantId,
      tenantId,
      membershipId: `membership-${tenantId}`,
      roles: ['member'],
      permissions,
      allPermissions: false,
      revision,
    } : {
      kind: 'application',
      scopeId: 'application',
      roles: ['member'],
      permissions,
      allPermissions: false,
      revision,
    },
    revision,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
