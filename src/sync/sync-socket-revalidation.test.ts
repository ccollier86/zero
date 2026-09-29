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
});

function socket() {
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
    close(code?: number, reason?: string) { closes.push([code, reason]); },
    subscribe() {},
    unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, closes };
}
