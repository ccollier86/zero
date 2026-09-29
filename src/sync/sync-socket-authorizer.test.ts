import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';

import { createReactiveDB } from './reactive-db';
import { createSyncSocketAuthRuntime } from './sync-socket-auth';
import { createSyncSocketAuthorizer } from './sync-socket-authorizer';
import { allowAllSyncPolicy } from './sync-policy';
import type {
  SyncAuthContext,
  SyncResourcePolicyAdapter,
  SyncSocketData,
} from './types';

const authContext: SyncAuthContext = Object.freeze({
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

describe('Sync socket authorizer', () => {
  test('does not install filters captured before an async read-authority change', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let authority = 'revision-1';
    let release!: () => void;
    let started!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const resolving = new Promise<void>((resolve) => { started = resolve; });
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        const captured = authority;
        started();
        await barrier;
        return {
          readableTables: new Set(['documents']),
          rowFilters: new Map(),
          readAuthorityFingerprint: captured,
          policyFingerprint: captured,
        };
      },
      validateReadAuthorityAtDelivery(_context, expected) {
        return authority === expected;
      },
      async authorizeMutation() {
        return { ok: false, reason: 'not used' };
      },
    };
    let authorized = 0;
    const authorizer = createSyncSocketAuthorizer({
      auth: {
        required: true,
        getTokenVerifier: () => ({
          resolveAuthContext: async () => authContext,
          verifyAccessToken: async () => null,
        }),
      },
      db,
      policy: allowAllSyncPolicy,
      resourcePolicy,
      additionalTables: ['documents'],
      requireComparableReadAuthority: true,
      onAuthorized() { authorized += 1; },
    });
    const target = socket();

    try {
      const pending = authorizer.authorize(target.value, 'access-token');
      await resolving;
      authority = 'revision-2';
      release();

      expect(await pending).toBeFalse();
      expect(authorized).toBe(0);
      expect(target.data.authResolved).toBeFalse();
      expect(target.data.allowedTables.size).toBe(0);
      expect(target.closes).toEqual([[4001, 'Sync read authority changed']]);
    } finally {
      db.dispose();
    }
  });

  test('does not authorize a socket that closes while access resolution is pending', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let release!: () => void;
    let started!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const resolving = new Promise<void>((resolve) => { started = resolve; });
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        started();
        await barrier;
        return {
          readableTables: new Set(['documents']),
          rowFilters: new Map(),
          policyFingerprint: 'allow-all',
        };
      },
      async authorizeMutation() {
        return { ok: false, reason: 'not used' };
      },
    };
    let authorized = 0;
    const authorizer = createSyncSocketAuthorizer({
      auth: {
        required: true,
        getTokenVerifier: () => ({
          resolveAuthContext: async () => authContext,
          verifyAccessToken: async () => null,
        }),
      },
      db,
      policy: allowAllSyncPolicy,
      resourcePolicy,
      additionalTables: ['documents'],
      onAuthorized() { authorized += 1; },
    });
    const target = socket();

    try {
      const pending = authorizer.authorize(target.value, 'access-token');
      await resolving;
      authorizer.cancel(target.value);
      release();

      expect(await pending).toBeFalse();
      expect(authorized).toBe(0);
      expect(target.data.authResolved).toBeFalse();
      expect(target.data.allowedTables.size).toBe(0);
      expect(target.closes).toEqual([]);
    } finally {
      db.dispose();
    }
  });

  test('rejects filtered access without comparable delivery authority', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        return {
          readableTables: new Set(['documents']),
          rowFilters: new Map([['documents', { matches: () => true }]]),
          policyFingerprint: 'filtered',
        };
      },
      async authorizeMutation() {
        return { ok: false, reason: 'not used' };
      },
    };
    let authorized = 0;
    const authorizer = createSyncSocketAuthorizer({
      auth: {
        required: true,
        getTokenVerifier: () => ({
          resolveAuthContext: async () => authContext,
          verifyAccessToken: async () => null,
        }),
      },
      db,
      policy: allowAllSyncPolicy,
      resourcePolicy,
      additionalTables: ['documents'],
      onAuthorized() { authorized += 1; },
    });
    const target = socket();

    try {
      expect(await authorizer.authorize(target.value, 'access-token')).toBeFalse();
      expect(authorized).toBe(0);
      expect(target.data.authResolved).toBeFalse();
      expect(target.closes).toEqual([
        [1011, 'Comparable Sync read authority unavailable'],
      ]);
    } finally {
      db.dispose();
    }
  });

  test('rejects projected access without comparable delivery authority', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        return {
          readableTables: new Set(['documents']),
          rowFilters: new Map(),
          rowProjectors: new Map([['documents', { project: (row) => row }]]),
          policyFingerprint: 'projected',
        };
      },
      async authorizeMutation() {
        return { ok: false, reason: 'not used' };
      },
    };
    const authorizer = createSyncSocketAuthorizer({
      auth: {
        required: true,
        getTokenVerifier: () => ({
          resolveAuthContext: async () => authContext,
          verifyAccessToken: async () => null,
        }),
      },
      db,
      policy: allowAllSyncPolicy,
      resourcePolicy,
      additionalTables: ['documents'],
      onAuthorized() {},
    });
    const target = socket();

    try {
      expect(await authorizer.authorize(target.value, 'access-token')).toBeFalse();
      expect(target.closes).toEqual([
        [1011, 'Comparable Sync read authority unavailable'],
      ]);
    } finally {
      db.dispose();
    }
  });

  test('closes when revalidation would install an uncomparable row policy', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let filtered = false;
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        return {
          readableTables: new Set(['documents']),
          rowFilters: filtered
            ? new Map([['documents', { matches: () => true }]])
            : new Map(),
          policyFingerprint: filtered ? 'filtered' : 'unfiltered',
        };
      },
      async authorizeMutation() {
        return { ok: false, reason: 'not used' };
      },
    };
    const activeSockets = new Set<ServerWebSocket<SyncSocketData>>();
    const runtime = createSyncSocketAuthRuntime({
      auth: {
        required: true,
        getTokenVerifier: () => ({
          resolveAuthContext: async () => authContext,
          verifyAccessToken: async () => null,
        }),
      },
      db,
      policy: allowAllSyncPolicy,
      resourcePolicy,
      additionalTables: ['documents'],
      activeSockets,
    });
    const target = socket();

    try {
      expect(await runtime.authorize(target.value, 'access-token')).toBeTrue();
      expect(activeSockets.has(target.value)).toBeTrue();
      filtered = true;

      expect(await runtime.revalidate(target.value)).toBeFalse();
      expect(target.closes).toEqual([
        [1011, 'Comparable Sync read authority unavailable'],
      ]);
      expect(target.data.authResolved).toBeFalse();
    } finally {
      runtime.dispose();
      db.dispose();
    }
  });
});

function socket() {
  const closes: Array<[number | undefined, string | undefined]> = [];
  const data: SyncSocketData = {
    allowedTables: new Set(),
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: null,
    authResolved: false,
    authorizationFingerprint: null,
    authorizationScope: null,
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
    send() { return 1; },
    close(code?: number, reason?: string) { closes.push([code, reason]); },
    subscribe() {},
    unsubscribe() {},
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { value, data, closes };
}
