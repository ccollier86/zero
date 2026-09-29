import { describe, expect, test } from 'bun:test';
import { createNativeSyncAuth } from './sync-auth';
import type { NativeAuthState, NativeAuthStateListener } from './client-types';

describe('native sync auth bridge', () => {
  test('reads the access token and forces native refresh after a 4001', async () => {
    let token = 'access-1';
    let refreshes = 0;
    const bridge = createNativeSyncAuth({
      state: authenticated('user-1'),
      subscribe() { return () => undefined; },
      async getAccessToken() { return token; },
      async refresh() {
        refreshes += 1;
        token = 'access-2';
        return { status: 'authenticated', identity: null, error: null };
      },
    });

    expect(await bridge.getToken?.()).toBe('access-1');
    expect(await bridge.refreshAuth?.()).toBe('access-2');
    expect(refreshes).toBe(1);
  });

  test('halts and purges sync across sign-out and account changes', () => {
    let state: NativeAuthState = { status: 'uninitialized', identity: null, error: null };
    const listeners = new Set<NativeAuthStateListener>();
    const auth = {
      get state() { return state; },
      subscribe(listener: NativeAuthStateListener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async getAccessToken() { return null; },
      async refresh() { return state; },
    };
    let connected = false;
    let connects = 0;
    let resets = 0;
    const bridge = createNativeSyncAuth(auth);
    bridge.bindAuthLifecycle?.({
      get connected() { return connected; },
      connect() { connected = true; connects += 1; },
      reset() { connected = false; resets += 1; },
    }, true);

    emit(authenticated('user-1'));
    emit({ status: 'authorizing', identity: state.identity, error: null });
    emit(authenticated('user-2'));
    emit({ status: 'anonymous', identity: null, error: null });

    expect(connects).toBe(2);
    expect(resets).toBe(2);

    function emit(next: NativeAuthState) {
      state = next;
      for (const listener of listeners) listener(next);
    }
  });

  test('purges and reconnects when the same subject switches tenants', () => {
    let state = authenticated('user-1', 'tenant-a');
    const listeners = new Set<NativeAuthStateListener>();
    const auth = {
      get state() { return state; },
      subscribe(listener: NativeAuthStateListener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async getAccessToken() { return 'access'; },
      async refresh() { return state; },
    };
    let connected = false;
    let connects = 0;
    let resets = 0;
    const bridge = createNativeSyncAuth(auth);
    bridge.bindAuthLifecycle?.({
      get connected() { return connected; },
      connect() { connected = true; connects += 1; },
      reset() { connected = false; resets += 1; },
    }, true);

    state = authenticated('user-1', 'tenant-b');
    for (const listener of listeners) listener(state);

    expect(connects).toBe(2);
    expect(resets).toBe(1);
  });
});

function authenticated(subject: string, tenantId?: string): NativeAuthState {
  return {
    status: 'authenticated', error: null,
    identity: { iss: 'https://zero.example/auth', sub: subject, aud: 'desktop', exp: 1, iat: 1 },
    activeTenant: tenantId
      ? { tenantId, slug: tenantId, name: tenantId, kind: 'organization', role: 'member' }
      : null,
  };
}
