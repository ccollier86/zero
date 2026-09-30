import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';

import { createReactiveDB } from './reactive-db';
import { allowAllSyncPolicy } from './sync-policy';
import { createSyncSocketRevalidation } from './sync-socket-revalidation';
import type {
  SyncAuthContext,
  SyncResourcePolicyAdapter,
  SyncSocketData,
} from './types';

const context: SyncAuthContext = Object.freeze({
  userId: 'user-1',
  email: 'user@example.test',
  role: 'user',
  sessionKind: 'web',
  sessionId: 'session-1',
  sessionGeneration: 1,
  sessionScopeKind: 'tenant',
  sessionScopeId: 'tenant-1',
  tenantId: 'tenant-1',
  membershipId: 'membership-1',
});

describe('Sync socket revalidation lifecycle', () => {
  test('a cleared socket cannot be mutated or closed by stale async revalidation', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let release!: () => void;
    let started!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const resolving = new Promise<void>((resolve) => { started = resolve; });
    const policy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        started();
        await barrier;
        return {
          readableTables: new Set(['new-table']),
          rowFilters: new Map(),
          readAuthorityFingerprint: 'read-current',
          policyFingerprint: 'policy-current',
        };
      },
      validateReadAuthorityAtDelivery(_auth, value) {
        return value === 'read-current';
      },
      async authorizeMutation() { return { ok: false, reason: 'not used' }; },
    };
    const target = socket();
    const runtime = createSyncSocketRevalidation({
      auth: {
        required: true,
        getTokenVerifier: () => ({
          resolveAuthContext: async () => context,
          verifyAccessToken: async () => null,
        }),
      },
      db,
      policy: allowAllSyncPolicy,
      resourcePolicy: policy,
      activeSockets: new Set([target.value]),
      requireComparableReadAuthority: true,
    });

    try {
      const pending = runtime.revalidate(target.value);
      await resolving;
      runtime.clear(target.value);
      target.data.allowedTables = new Set(['closed-table']);
      release();

      expect(await pending).toBeFalse();
      expect(target.data.allowedTables).toEqual(new Set(['closed-table']));
      expect(target.closes).toEqual([]);
    } finally {
      runtime.dispose();
      db.dispose();
    }
  });

  test('invalidates every socket even when one transport teardown throws', () => {
    const db = createReactiveDB({ mode: 'memory' });
    const broken = socket({ throwOnUnsubscribe: true, throwOnClose: true });
    const healthy = socket();
    broken.data.subscribedTopics.add('sync:todos');
    healthy.data.subscribedTopics.add('sync:todos');
    const runtime = createSyncSocketRevalidation({
      auth: {
        required: true,
        getTokenVerifier: () => null,
      },
      db,
      policy: allowAllSyncPolicy,
      activeSockets: new Set([broken.value, healthy.value]),
    });

    try {
      expect(() => runtime.invalidateAll(1011, 'Authority unavailable'))
        .not.toThrow();
      expect(broken.data.authResolved).toBeFalse();
      expect(broken.data.authContext).toBeNull();
      expect(broken.data.subscribedTopics).toEqual(new Set());
      expect(healthy.data.authResolved).toBeFalse();
      expect(healthy.data.authContext).toBeNull();
      expect(healthy.data.subscribedTopics).toEqual(new Set());
      expect(healthy.closes).toEqual([[1011, 'Authority unavailable']]);
    } finally {
      runtime.dispose();
      db.dispose();
    }
  });

  test('observes an unexpected periodic rejection before fail-closed cleanup', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const failure = new Error('private verifier failure');
    const order: string[] = [];
    let verifierReads = 0;
    let observedFailure: unknown;
    let observedTrigger: string | undefined;
    let releaseObserved!: () => void;
    const observed = new Promise<void>((resolve) => { releaseObserved = resolve; });
    const target = socket({
      throwOnClose: true,
      onClose(code, reason) {
        order.push(`close:${code}:${reason}`);
      },
    });
    const runtime = createSyncSocketRevalidation({
      auth: {
        required: true,
        revalidateIntervalMs: 10,
        getTokenVerifier() {
          verifierReads += 1;
          if (verifierReads > 2) throw failure;
          return {
            resolveAuthContext: async () => context,
            verifyAccessToken: async () => null,
          };
        },
      },
      db,
      policy: allowAllSyncPolicy,
      activeSockets: new Set([target.value]),
      onSocketInvalidated() {
        order.push('release');
        throw new Error('private capability cleanup failure');
      },
      onRevalidationFailure(error, trigger) {
        order.push('report');
        observedFailure = error;
        observedTrigger = trigger;
        releaseObserved();
      },
    });

    try {
      runtime.start(target.value);
      await Promise.race([
        observed,
        Bun.sleep(1_000).then(() => {
          throw new Error('Periodic revalidation did not run.');
        }),
      ]);
      await Bun.sleep(30);

      expect(observedFailure).toBe(failure);
      expect(observedTrigger).toBe('periodic');
      expect(order).toEqual([
        'report',
        'release',
        'close:1011:Sync authority revalidation failed',
      ]);
      expect(target.data.authResolved).toBeFalse();
      expect(target.data.authContext).toBeNull();
    } finally {
      runtime.dispose();
      db.dispose();
    }
  });

  test('observes an authority-revision sweep rejection before invalidating sockets', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const failure = new Error('private authority resolver failure');
    const order: string[] = [];
    let verifierReads = 0;
    let observedFailure: unknown;
    let observedTrigger: string | undefined;
    let releaseObserved!: () => void;
    const observed = new Promise<void>((resolve) => { releaseObserved = resolve; });
    const target = socket({
      onClose(code, reason) {
        order.push(`close:${code}:${reason}`);
      },
    });
    const runtime = createSyncSocketRevalidation({
      auth: {
        required: true,
        invalidationPollIntervalMs: 60_000,
        getTokenVerifier() {
          verifierReads += 1;
          if (verifierReads > 2) throw failure;
          return {
            getAuthorityRevision: () => 1,
            resolveAuthContext: async () => context,
            verifyAccessToken: async () => null,
          };
        },
      },
      db,
      policy: allowAllSyncPolicy,
      activeSockets: new Set([target.value]),
      onRevalidationFailure(error, trigger) {
        order.push('report');
        observedFailure = error;
        observedTrigger = trigger;
        releaseObserved();
      },
    });

    try {
      runtime.startAuthorityPolling();
      await Promise.race([
        observed,
        Bun.sleep(1_000).then(() => {
          throw new Error('Authority-revision revalidation did not run.');
        }),
      ]);

      expect(observedFailure).toBe(failure);
      expect(observedTrigger).toBe('authority-revision');
      expect(order).toEqual([
        'report',
        'close:1011:Sync authority revalidation failed',
      ]);
      expect(target.data.authResolved).toBeFalse();
      expect(target.data.authContext).toBeNull();
    } finally {
      runtime.dispose();
      db.dispose();
    }
  });
});

function socket(options: Readonly<{
  throwOnUnsubscribe?: boolean;
  throwOnClose?: boolean;
  onClose?: (code?: number, reason?: string) => void;
}> = {}) {
  const closes: Array<[number | undefined, string | undefined]> = [];
  const data: SyncSocketData = {
    allowedTables: new Set(['old-table']),
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: context,
    authToken: 'token',
    authResolved: true,
    authorizationFingerprint: 'policy-current',
    readAuthorizationFingerprint: 'read-current',
    authorizationScope: 'scope',
    connectionId: 'connection-1',
    query: {},
    stateSubscribed: false,
    ephemeralTopics: new Set(),
    resourceRowFilters: new Map(),
    resourceRowProjectors: new Map(),
    rowFilteredSubscribedTables: new Set(),
  };
  const value = {
    data,
    close(code?: number, reason?: string) {
      options.onClose?.(code, reason);
      if (options.throwOnClose) throw new Error('transport close failed');
      closes.push([code, reason]);
    },
    subscribe() {},
    unsubscribe() {
      if (options.throwOnUnsubscribe) {
        throw new Error('transport unsubscribe failed');
      }
    },
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, closes };
}
