import { describe, expect, test } from 'bun:test';
import type { AuthClient } from './auth-client';
import type { AuthAuthorizationStatus } from './auth-authorization-types';
import { AuthorizationDataBoundaryController } from './authorization-data-boundary';
import {
  AuthorizationScopeBoundaryFence,
  isAuthorizationDataReady,
  isAuthorizationScopeCallbackCurrent,
  isAuthorizationScopeReady,
  isAuthorizationScopeStable,
  readAuthorizationScopeBoundaryKey,
  readAuthorizationScopeIdentityKey,
} from './authorization-scope-hooks';

function authState(overrides: Partial<{
  authorizationScopeKey: string | null;
  userId: string | null;
  tenantId: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  phase: 'idle' | 'preparing' | 'committed' | 'reconciling' | 'recovery-required';
  revision: number;
  authorizationStatus: AuthAuthorizationStatus;
}> = {}): AuthClient {
  const userId = overrides.userId === undefined ? 'user-1' : overrides.userId;
  const tenantId = overrides.tenantId === undefined ? 'tenant-1' : overrides.tenantId;
  return {
    authorizationScopeKey: overrides.authorizationScopeKey ?? 'scope-1',
    user: userId ? { userId } : null,
    activeTenant: tenantId ? { tenantId } : null,
    isLoading: overrides.isLoading ?? false,
    isAuthenticated: overrides.isAuthenticated ?? Boolean(userId),
    authorizationState: {
      status: overrides.authorizationStatus ?? 'ready',
      snapshot: null,
      error: null,
    },
    sessionTransition: {
      phase: overrides.phase ?? 'idle',
      operation: null,
      revision: overrides.revision ?? 0,
      recoverable: overrides.phase === 'recovery-required',
      error: null,
    },
  } as unknown as AuthClient;
}

describe('authorization scope hook boundary', () => {
  test('changes the opaque boundary during initial restoration without changing identity', () => {
    const loading = authState({ isLoading: true });
    const ready = authState({ isLoading: false });

    expect(readAuthorizationScopeBoundaryKey(loading)).not.toBe(
      readAuthorizationScopeBoundaryKey(ready),
    );
    expect(readAuthorizationScopeIdentityKey(loading)).toBe(
      readAuthorizationScopeIdentityKey(ready),
    );
  });

  test('separates account, tenant, transition phase, and transition revision', () => {
    const baseline = readAuthorizationScopeBoundaryKey(authState());

    expect(readAuthorizationScopeBoundaryKey(authState({ userId: 'user-2' }))).not.toBe(baseline);
    expect(readAuthorizationScopeBoundaryKey(authState({ tenantId: 'tenant-2' }))).not.toBe(baseline);
    expect(readAuthorizationScopeBoundaryKey(authState({ phase: 'preparing' }))).not.toBe(baseline);
    expect(readAuthorizationScopeBoundaryKey(authState({ revision: 1 }))).not.toBe(baseline);
  });

  test('separates same-scope authorization data revisions without changing identity', () => {
    const auth = authState();
    const boundary = new AuthorizationDataBoundaryController();
    const identity = readAuthorizationScopeIdentityKey(auth);
    const managerKey = readAuthorizationScopeBoundaryKey(auth, boundary.revision);
    let notifications = 0;
    const unsubscribe = boundary.subscribe(() => { notifications += 1; });

    boundary.invalidate();

    expect(notifications).toBe(1);
    expect(readAuthorizationScopeBoundaryKey(auth, boundary.revision)).not.toBe(managerKey);
    expect(readAuthorizationScopeIdentityKey(auth)).toBe(identity);
    unsubscribe();
  });

  test('advances the boundary again when replacement authorization becomes readable', () => {
    const unvalidated = readAuthorizationScopeBoundaryKey(
      authState({ authorizationStatus: 'loading' }),
      1,
    );
    const ready = readAuthorizationScopeBoundaryKey(
      authState({ authorizationStatus: 'ready' }),
      1,
    );
    const refreshing = readAuthorizationScopeBoundaryKey(
      authState({ authorizationStatus: 'refreshing' }),
      1,
    );

    expect(ready).not.toBe(unvalidated);
    expect(refreshing).toBe(ready);
  });

  test('treats only committed and recoverable scopes as readable', () => {
    expect(isAuthorizationScopeStable(authState({ phase: 'idle' }).sessionTransition)).toBe(true);
    expect(isAuthorizationScopeStable(
      authState({ phase: 'recovery-required' }).sessionTransition,
    )).toBe(true);
    expect(isAuthorizationScopeStable(
      authState({ phase: 'preparing' }).sessionTransition,
    )).toBe(false);
    expect(isAuthorizationScopeStable(
      authState({ phase: 'committed' }).sessionTransition,
    )).toBe(false);
    expect(isAuthorizationScopeStable(
      authState({ phase: 'reconciling' }).sessionTransition,
    )).toBe(false);
  });

  test('keeps ordinary auth form submission mounted while masking restoration and transitions', () => {
    const idle = authState().sessionTransition;
    const preparing = authState({ phase: 'preparing' }).sessionTransition;

    expect(isAuthorizationScopeReady(idle, false)).toBe(true);
    expect(isAuthorizationScopeReady(idle, true)).toBe(false);
    expect(isAuthorizationScopeReady(preparing, false)).toBe(false);
  });

  test('masks an authenticated authorization purge until replacement grants are validated', () => {
    expect(isAuthorizationDataReady(0, 'loading', true)).toBe(true);
    expect(isAuthorizationDataReady(0, 'error', true)).toBe(true);
    expect(isAuthorizationDataReady(0, 'revoked', true)).toBe(false);
    expect(isAuthorizationDataReady(1, 'disabled', true)).toBe(false);
    expect(isAuthorizationDataReady(1, 'unauthenticated', true)).toBe(false);
    expect(isAuthorizationDataReady(1, 'loading', true)).toBe(false);
    expect(isAuthorizationDataReady(1, 'error', true)).toBe(false);
    expect(isAuthorizationDataReady(1, 'revoked', true)).toBe(false);
    expect(isAuthorizationDataReady(1, 'ready', true)).toBe(true);
    expect(isAuthorizationDataReady(1, 'refreshing', true)).toBe(true);
  });

  test('keeps settled signed-out auth surfaces readable after an anonymous cache purge', () => {
    expect(isAuthorizationDataReady(0, 'unauthenticated', false)).toBe(true);
    expect(isAuthorizationDataReady(0, 'loading', false)).toBe(true);
    expect(isAuthorizationDataReady(0, 'revoked', false)).toBe(true);
    expect(isAuthorizationDataReady(0, 'ready', false)).toBe(false);
    expect(isAuthorizationDataReady(1, 'unauthenticated', false)).toBe(true);
    expect(isAuthorizationDataReady(1, 'loading', false)).toBe(true);
    expect(isAuthorizationDataReady(1, 'revoked', false)).toBe(true);
    expect(isAuthorizationDataReady(1, 'disabled', false)).toBe(false);
    expect(isAuthorizationDataReady(1, 'error', false)).toBe(false);
    expect(isAuthorizationDataReady(1, 'ready', false)).toBe(false);
    expect(isAuthorizationDataReady(1, 'refreshing', false)).toBe(false);
    expect(isAuthorizationDataReady(17, 'unauthenticated', false)).toBe(true);
    expect(isAuthorizationDataReady(17, 'loading', true)).toBe(false);

    const anonymous = authState({
      authorizationScopeKey: null,
      userId: null,
      tenantId: null,
      isAuthenticated: false,
      authorizationStatus: 'unauthenticated',
    });
    const key = readAuthorizationScopeBoundaryKey(anonymous, 1);
    expect(JSON.parse(key).at(-1)).toBe('validated');
  });

  test('validates every auth and authorization-status combination at every revision class', () => {
    const statuses = [
      null,
      'disabled',
      'unauthenticated',
      'loading',
      'refreshing',
      'ready',
      'error',
      'revoked',
    ] as const;
    const readable = (
      revision: number,
      authenticated: boolean,
    ) => statuses.filter((status) => (
      isAuthorizationDataReady(revision, status, authenticated)
    ));

    expect(readable(0, false)).toEqual(['unauthenticated', 'loading', 'revoked']);
    expect(readable(1, false)).toEqual(['unauthenticated', 'loading', 'revoked']);
    expect(readable(17, false)).toEqual(['unauthenticated', 'loading', 'revoked']);
    expect(readable(0, true)).toEqual(['loading', 'refreshing', 'ready', 'error']);
    expect(readable(1, true)).toEqual(['refreshing', 'ready']);
    expect(readable(17, true)).toEqual(['refreshing', 'ready']);
  });

  test('changes the revision-zero boundary key when status compatibility changes', () => {
    const authenticatedReady = readAuthorizationScopeBoundaryKey(
      authState({ authorizationStatus: 'ready', isAuthenticated: true }),
      0,
    );
    const authenticatedRevoked = readAuthorizationScopeBoundaryKey(
      authState({ authorizationStatus: 'revoked', isAuthenticated: true }),
      0,
    );
    const signedOutReady = readAuthorizationScopeBoundaryKey(
      authState({
        authorizationStatus: 'ready',
        isAuthenticated: false,
        userId: null,
        tenantId: null,
      }),
      0,
    );
    const signedOut = readAuthorizationScopeBoundaryKey(
      authState({
        authorizationStatus: 'unauthenticated',
        isAuthenticated: false,
        userId: null,
        tenantId: null,
      }),
      0,
    );

    expect(JSON.parse(authenticatedReady).at(-1)).toBe('initial');
    expect(JSON.parse(authenticatedRevoked).at(-1)).toBe('unvalidated');
    expect(authenticatedRevoked).not.toBe(authenticatedReady);
    expect(JSON.parse(signedOutReady).at(-1)).toBe('unvalidated');
    expect(JSON.parse(signedOut).at(-1)).toBe('initial');
    expect(signedOut).not.toBe(signedOutReady);
  });

  test('invalidates async work at every boundary change', () => {
    const fence = new AuthorizationScopeBoundaryFence();
    const first = fence.update('scope-a');
    expect(fence.isCurrent(first)).toBe(true);

    const transition = fence.update('scope-a:preparing');
    expect(fence.isCurrent(first)).toBe(false);
    expect(fence.isCurrent(transition)).toBe(true);

    const replacement = fence.update('scope-b:idle');
    expect(fence.isCurrent(transition)).toBe(false);
    expect(fence.isCurrent(replacement)).toBe(true);
  });

  test('prevents callbacks retained from a completed scope from writing into its replacement', () => {
    let currentKey = 'scope-a:idle';
    let ready = true;
    const scopeA = currentKey;
    let writes = 0;
    const retainedScopeASetter = () => {
      if (isAuthorizationScopeCallbackCurrent(currentKey, ready, scopeA)) writes += 1;
    };

    retainedScopeASetter();
    expect(writes).toBe(1);

    currentKey = 'scope-a:preparing';
    ready = false;
    retainedScopeASetter();
    expect(writes).toBe(1);

    currentKey = 'scope-b:idle';
    ready = true;
    const scopeB = currentKey;
    retainedScopeASetter();
    expect(writes).toBe(1);

    const scopeBSetter = () => {
      if (isAuthorizationScopeCallbackCurrent(currentKey, ready, scopeB)) writes += 1;
    };
    scopeBSetter();
    expect(writes).toBe(2);
  });

  test('blocks retained mutation, storage, and data-table handlers from acting in scope B', () => {
    const current = { key: 'scope-a:idle', ready: true };
    const calls: string[] = [];
    const retain = (surface: string) => {
      const capturedKey = current.key;
      return () => {
        if (!isAuthorizationScopeCallbackCurrent(
          current.key,
          current.ready,
          capturedKey,
        )) return;
        calls.push(surface);
      };
    };

    const mutation = retain('mutation');
    const storage = retain('storage');
    const dataTable = retain('data-table');
    mutation();
    storage();
    dataTable();
    expect(calls).toEqual(['mutation', 'storage', 'data-table']);

    current.ready = false;
    mutation();
    storage();
    dataTable();
    current.key = 'scope-b:idle';
    current.ready = true;
    mutation();
    storage();
    dataTable();

    expect(calls).toEqual(['mutation', 'storage', 'data-table']);
  });

  test('suppresses delayed async publication and masks reads after a boundary change', async () => {
    const current = { key: 'scope-a:idle', ready: true };
    const capturedKey = current.key;
    const publications: string[] = [];
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });

    const completion = pending.then((value) => {
      if (isAuthorizationScopeCallbackCurrent(
        current.key,
        current.ready,
        capturedKey,
      )) publications.push(value);
    });

    current.ready = false;
    expect(isAuthorizationScopeCallbackCurrent(current.key, current.ready, capturedKey)).toBe(false);
    current.key = 'scope-b:idle';
    current.ready = true;
    release('scope-a-result');
    await completion;

    expect(publications).toEqual([]);
  });

  test('keeps concrete public surfaces bound to captured keys instead of latest callbacks', async () => {
    const mutation = await Bun.file(new URL('mutation-hooks.ts', import.meta.url)).text();
    const storage = await Bun.file(new URL('../../storage/storage-hooks.ts', import.meta.url)).text();
    const dataTable = await Bun.file(
      new URL('../../components/data-table/data-table-source.ts', import.meta.url),
    ).text();

    expect(mutation).toContain('const run = useCallback(async');
    expect(mutation).not.toContain('const run = useStableCallback(async');
    expect(storage).toContain('function useStorageOperationGuard');
    expect(storage).toContain('callbackBoundaryKey');
    expect(dataTable).toContain('requestControllerRef.current?.abort()');
    expect(dataTable).toContain('isAuthorizationScopeCallbackCurrent');
  });

  test('blocks retained account-property, MFA, and tenant callbacks before scope-B dispatch', async () => {
    const current = { key: 'scope-a:idle', ready: true };
    const captured = current.key;
    let dispatches = 0;
    const retainedAccountAction = async () => {
      if (!isAuthorizationScopeCallbackCurrent(current.key, current.ready, captured)) {
        throw new Error('stale account operation');
      }
      dispatches += 1;
    };

    await retainedAccountAction();
    current.ready = false;
    await expect(retainedAccountAction()).rejects.toThrow('stale account operation');
    current.key = 'scope-b:idle';
    current.ready = true;
    await expect(retainedAccountAction()).rejects.toThrow('stale account operation');
    expect(dispatches).toBe(1);

    const source = await Bun.file(new URL('auth-hooks.ts', import.meta.url)).text();
    expect(source).toMatch(
      /runAccountAction\(\s*\(\) => authClient\.changePassword/,
    );
    expect(source).toContain('runAccountAction(() => authClient.listMfaMethods());');
    expect(source).toContain('runAccountAction(() => authClient.listTenants());');
    expect(source).toContain('runAccountAction(() => authClient.setProperty');
    expect(source).toContain('runAccountAction(() => authClient.getProperties());');
    expect(source).toContain('runScopeChangingAction(() => authClient.logout());');
    expect(source).toContain('runScopeChangingAction(() => authClient.switchTenant');
    expect(source).toContain('runScopeChangingAction(() => authClient.verifyMfaSetup');
  });

  test('rejects a delayed same-scope account result after replacement', async () => {
    const current = { key: 'scope-a:idle', ready: true };
    const captured = current.key;
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    const accountRead = (async () => {
      if (!isAuthorizationScopeCallbackCurrent(current.key, current.ready, captured)) {
        throw new Error('stale account operation');
      }
      const result = await pending;
      if (!isAuthorizationScopeCallbackCurrent(current.key, current.ready, captured)) {
        throw new Error('stale account operation');
      }
      return result;
    })();

    current.ready = false;
    current.key = 'scope-b:idle';
    current.ready = true;
    release('scope-a-properties');
    await expect(accountRead).rejects.toThrow('stale account operation');
  });
});

const authorizationScopedHookFiles = [
  'data-hooks.ts',
  'resource-hooks.ts',
  'data-composition-hooks.ts',
  'mutation-hooks.ts',
  'workflow-run-hooks.ts',
  'workflow-hooks.ts',
  'workflow-topology-hooks.ts',
  'notification-hooks.ts',
  'room-hooks.ts',
  'typing-indicator-hooks.ts',
  'data-selection-hooks.ts',
  'preference-hooks.ts',
  'auth-hooks.ts',
  'auth-api-key-hooks.ts',
  'authorization-hooks.ts',
  'data-realm-readiness-hooks.ts',
  'application-administration-hooks.ts',
  'tenant-member-hooks.ts',
  'tenant-onboarding-hooks.ts',
  'tenant-switcher-hooks.ts',
  'platform-administration-hooks.ts',
  'platform-tenant-directory-hooks.ts',
  'domain-onboarding-hooks.ts',
  'auth-audit-hooks.ts',
  '../../sync/client/state-hooks.ts',
  '../../sync/client/ephemeral-hooks.ts',
  '../../sync/client/hooks.ts',
  '../../hooks/use-form.ts',
  '../../components/data-table/data-table-source.ts',
  '../../components/auth/tenant-member-management.tsx',
  '../../components/auth/platform-workspace-management.tsx',
  '../../components/admin/users/use-admin-user-data.ts',
  '../../components/admin/users/use-admin-user-actions.ts',
];

describe('ClientProvider-only authorization-scoped hook coverage', () => {
  test('subscribes every stateful hook surface to the shared boundary', async () => {
    for (const file of authorizationScopedHookFiles) {
      const source = await Bun.file(new URL(file, import.meta.url)).text();
      expect(source).toContain('useAuthorizationScopeBoundary');
    }
  });
});
