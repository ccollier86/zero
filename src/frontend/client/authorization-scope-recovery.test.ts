import { describe, expect, test } from 'bun:test';
import {
  AUTHORIZATION_SCOPE_RECOVERY_UNAVAILABLE,
  AuthorizationScopeRecoveryController,
  type AuthorizationScopeRecoveryClient,
} from './authorization-scope-recovery';
import type { AuthSessionRecoveryResult } from './auth-types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const pending = deferred<AuthSessionRecoveryResult>();
  let recoveries = 0;
  let logouts = 0;
  let starts = 0;
  let reloads = 0;
  const failures: { error: string; cause: unknown }[] = [];
  const client: AuthorizationScopeRecoveryClient & {
    authorizationScopeKey: string | null;
    user: { userId: string } | null;
    hasRecoverableSession: boolean;
  } = {
    authorizationScopeKey: 'family-a', user: { userId: 'user-a' },
    hasRecoverableSession: true,
    recoverSession: () => { recoveries += 1; return pending.promise; },
    logout: async () => {
      logouts += 1;
      client.authorizationScopeKey = null;
      client.user = null;
      client.hasRecoverableSession = false;
    },
  };
  const controller = new AuthorizationScopeRecoveryController();
  controller.activate();
  const input = {
    client, scopeKey: 'family-a', operation: 'recover' as const,
    onStart: () => { starts += 1; },
    onReload: () => { reloads += 1; },
    onRetryable: (error: string, cause?: unknown) => { failures.push({ error, cause }); },
  };
  return {
    pending, client, controller, input, failures,
    counts: () => ({ recoveries, logouts, starts, reloads }),
  };
}

describe('hydrated-page recovery lifecycle', () => {
  test('deduplicates automatic recovery and Retry and reloads only after real recovery', async () => {
    const f = fixture();
    const first = f.controller.run(f.input);
    const duplicate = f.controller.run(f.input);
    expect(duplicate).toBe(first);
    await Promise.resolve();
    expect(f.counts()).toEqual({ recoveries: 1, logouts: 0, starts: 1, reloads: 0 });
    f.pending.resolve({ kind: 'authenticated' });
    expect(await first).toEqual({ kind: 'reload' });
    expect(f.counts().reloads).toBe(1);
  });

  test('retired StrictMode admission does not consume a marker or issue a request', async () => {
    const f = fixture();
    const old = f.controller.run(f.input);
    f.controller.retire();
    f.controller.activate();
    expect(await old).toEqual({ kind: 'retired' });
    expect(f.counts()).toEqual({ recoveries: 0, logouts: 0, starts: 0, reloads: 0 });
    const current = f.controller.run(f.input);
    f.pending.resolve({ kind: 'authenticated' });
    expect(await current).toEqual({ kind: 'reload' });
    expect(f.counts().starts).toBe(1);
  });

  test('retained-proof failures remain retryable without logout or a reload', async () => {
    const f = fixture();
    f.client.user = null;
    const promise = f.controller.run(f.input);
    f.pending.resolve({ kind: 'retryable', error: 'Unable to verify current access. Please retry.' });
    expect(await promise).toEqual({ kind: 'retryable', error: 'Unable to verify current access. Please retry.' });
    expect(f.client.hasRecoverableSession).toBe(true);
    expect(f.counts()).toEqual({ recoveries: 1, logouts: 0, starts: 1, reloads: 0 });
    expect(f.failures).toHaveLength(1);
  });

  test('a rejected proof clears its page cookie only after authoritative sign-out', async () => {
    const f = fixture();
    const promise = f.controller.run(f.input);
    await Promise.resolve();
    f.client.authorizationScopeKey = null;
    f.client.user = null;
    f.client.hasRecoverableSession = false;
    f.pending.resolve({ kind: 'signed-out' });
    expect(await promise).toEqual({ kind: 'reload' });
    expect(f.counts()).toEqual({ recoveries: 1, logouts: 1, starts: 1, reloads: 1 });
  });

  test('explicit sign-out uses the normal logout operation rather than a refresh', async () => {
    const f = fixture();
    expect(await f.controller.run({ ...f.input, operation: 'sign-out' })).toEqual({ kind: 'reload' });
    expect(f.counts()).toEqual({ recoveries: 0, logouts: 1, starts: 1, reloads: 1 });
  });

  test('the admitted sign-out remains pending across its anonymous purge instead of admitting a second logout', async () => {
    const f = fixture();
    const logout = deferred<void>();
    f.client.logout = async () => {
      f.client.authorizationScopeKey = null;
      f.client.user = null;
      f.client.hasRecoverableSession = false;
      await logout.promise;
    };
    const pending = f.controller.run({ ...f.input, operation: 'sign-out' });
    await Promise.resolve();
    expect(f.controller.isPendingFor(f.client)).toBe(true);
    expect(f.counts().reloads).toBe(0);
    logout.resolve();
    expect(await pending).toEqual({ kind: 'reload' });
    expect(f.controller.isPendingFor(f.client)).toBe(false);
  });

  test('pending ownership never extends to a replacement family or client instance', async () => {
    const f = fixture();
    const pending = f.controller.run(f.input);
    await Promise.resolve();
    expect(f.controller.isPendingFor(f.client)).toBe(true);
    expect(f.controller.isPendingFor({ ...f.client })).toBe(false);
    f.client.authorizationScopeKey = 'family-b';
    expect(f.controller.isPendingFor(f.client)).toBe(false);
    f.pending.resolve({ kind: 'authenticated' });
    expect(await pending).toEqual({ kind: 'retired' });
  });

  test('page-cookie clearing finishing after a new login cannot reload the replacement page', async () => {
    const f = fixture();
    const logout = deferred<void>();
    let clears = 0;
    f.client.logout = () => { clears += 1; return logout.promise; };
    const pending = f.controller.run(f.input);
    await Promise.resolve();
    f.client.authorizationScopeKey = null;
    f.client.user = null;
    f.client.hasRecoverableSession = false;
    f.pending.resolve({ kind: 'signed-out' });
    await Promise.resolve();
    await Promise.resolve();
    expect(clears).toBe(1);
    f.client.authorizationScopeKey = 'family-b';
    f.client.user = { userId: 'user-b' };
    f.client.hasRecoverableSession = true;
    logout.resolve();
    expect(await pending).toEqual({ kind: 'retired' });
    expect(f.counts().reloads).toBe(0);
    expect(f.failures).toEqual([]);
  });

  for (const kind of ['authenticated', 'signed-out', 'retryable'] as const) {
    test(`a late ${kind} result cannot reload or sign out a replacement family`, async () => {
      const f = fixture();
      const promise = f.controller.run(f.input);
      await Promise.resolve();
      f.client.authorizationScopeKey = 'family-b';
      f.client.user = { userId: 'user-b' };
      f.pending.resolve(kind === 'retryable' ? { kind, error: 'Please retry.' } : { kind });
      expect(await promise).toEqual({ kind: 'retired' });
      expect(f.counts().reloads).toBe(0);
      expect(f.counts().logouts).toBe(0);
      expect(f.failures).toEqual([]);
    });
  }

  test('unmount retires late success, failure and UI callbacks', async () => {
    const f = fixture();
    const promise = f.controller.run(f.input);
    await Promise.resolve();
    f.controller.retire();
    f.pending.reject(new Error('private upstream detail'));
    expect(await promise).toEqual({ kind: 'retired' });
    expect(f.counts().reloads).toBe(0);
    expect(f.failures).toEqual([]);
  });

  test('unexpected current failures expose only safe copy while preserving cause for code-only observability', async () => {
    const f = fixture();
    const promise = f.controller.run(f.input);
    const cause = new Error('PRIVATE_RECOVERY_DETAIL');
    f.pending.reject(cause);
    expect(await promise).toEqual({ kind: 'retryable', error: AUTHORIZATION_SCOPE_RECOVERY_UNAVAILABLE });
    expect(f.failures).toEqual([{ error: AUTHORIZATION_SCOPE_RECOVERY_UNAVAILABLE, cause }]);
    expect(f.counts().reloads).toBe(0);
  });

  test('a replacement family can start without waiting for the retired request', async () => {
    const f = fixture();
    const old = f.controller.run(f.input);
    await Promise.resolve();
    f.client.authorizationScopeKey = 'family-b';
    f.client.user = { userId: 'user-b' };
    f.client.recoverSession = async () => ({ kind: 'authenticated' });
    expect(await f.controller.run({ ...f.input, scopeKey: 'family-b' })).toEqual({ kind: 'reload' });
    f.pending.resolve({ kind: 'authenticated' });
    expect(await old).toEqual({ kind: 'retired' });
    expect(f.counts().reloads).toBe(1);
  });
});
