import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import {
  authenticatedOnly,
  authorizationPolicy,
  defineResource,
  ResourceRegistry,
  ResourceSyncPolicyService,
  tenantRealm,
} from '../resources';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import type { ReactiveDB } from './reactive-db';
import { createSyncPlugin } from './sync.plugin';
import type {
  ServerMessage,
  SyncAuthContext,
  SyncAuthContextAuthorityReference,
  SyncTokenVerifier,
} from './types';

interface TestApp {
  stop(): void;
  server: { hostname?: string; port?: number } | null;
}

let activeApp: TestApp | null = null;

afterEach(() => {
  activeApp?.stop();
  activeApp = null;
});

describe('tenant resource Sync boundary', () => {
  test('fails multi-tenant Sync startup without explicit realm classification', () => {
    expect(() => createSyncPlugin({
      db: { mode: 'memory' },
      tenancyMode: 'multi',
      tables: {
        documents: {
          id: 'text primary key',
          tenant_id: 'text not null',
        },
      },
    })).toThrow('must have an explicit global or tenant resource realm');

    expect(() => createSyncPlugin({
      db: { mode: 'memory' },
      tenancyMode: 'multi',
      tables: { documents: { id: 'text primary key' } },
      resourcePolicy: {
        classifyManagedTableRealm: () => 'global',
        async resolveTableAccess() {
          return { readableTables: new Set(), rowFilters: new Map() };
        },
        async authorizeMutation() {
          return { ok: false, reason: 'denied' };
        },
      },
    })).toThrow('must have an explicit resource exposure');
  });

  test('allows only sync/all resources across Sync reads and mutations', async () => {
    const tables = Object.fromEntries(
      ['internal_docs', 'http_docs', 'sync_docs', 'all_docs'].map((table) => [
        table,
        { id: 'text primary key', title: 'text not null' },
      ]),
    );
    const registry = new ResourceRegistry();
    registry.register([
      defineResource({ table: 'internal_docs', exposure: 'internal', policy: authenticatedOnly() }),
      defineResource({ table: 'http_docs', exposure: 'http', policy: authenticatedOnly() }),
      defineResource({ table: 'sync_docs', exposure: 'sync', policy: authenticatedOnly() }),
      defineResource({ table: 'all_docs', exposure: 'all', policy: authenticatedOnly() }),
    ], { tables, authConfig: { userProperties: {} } });
    const service = new ResourceSyncPolicyService({
      registry,
      authConfig: { userProperties: {} },
    });
    const authContext = tenantContext('tenant-a');

    const access = await service.resolveTableAccess({
      tableNames: Object.keys(tables),
      authContext,
    });
    expect([...access.readableTables].sort()).toEqual(['all_docs', 'sync_docs']);

    for (const table of ['internal_docs', 'http_docs']) {
      expect(await service.authorizeMutation({
        table,
        op: 'INSERT',
        row: { id: 'denied', title: 'Denied' },
        authContext,
        loadRow: () => null,
      })).toMatchObject({ ok: false, code: 'resource-sync-not-exposed' });
    }
    for (const table of ['sync_docs', 'all_docs']) {
      expect(await service.authorizeMutation({
        table,
        op: 'INSERT',
        row: { id: 'allowed', title: 'Allowed' },
        authContext,
        loadRow: () => null,
      })).toMatchObject({ ok: true, row: { id: 'allowed', title: 'Allowed' } });
    }
  });

  test('filters snapshot, catch-up, and live changes by durable tenant scope', async () => {
    const { app, db } = createTenantSyncApp();
    activeApp = app;
    db.insert('documents', { id: 'a-1', tenant_id: 'tenant-a', title: 'A one' });
    db.insert('documents', { id: 'b-1', tenant_id: 'tenant-b', title: 'B one' });

    const tenantA = await connect(getSyncUrl(app, 'tenant-a-token'));
    tenantA.ws.send(JSON.stringify({
      type: 'sync.subscribe',
      tables: ['documents'],
      snapshot: ['documents'],
      lastSeq: 0,
    }));
    const snapshotA = await tenantA.waitFor(
      (message) => message.type === 'sync.snapshot',
    );
    if (snapshotA.type !== 'sync.snapshot') throw new Error('Expected snapshot');
    expect(snapshotA.tables.documents).toEqual({
      'a-1': { id: 'a-1', tenant_id: 'tenant-a', title: 'A one' },
    });

    const tenantB = await connect(getSyncUrl(app, 'tenant-b-token'));
    tenantB.ws.send(JSON.stringify({
      type: 'sync.subscribe',
      tables: ['documents'],
      snapshot: ['documents'],
      lastSeq: 0,
    }));
    const snapshotB = await tenantB.waitFor(
      (message) => message.type === 'sync.snapshot',
    );
    if (snapshotB.type !== 'sync.snapshot') throw new Error('Expected snapshot');
    expect(snapshotB.tables.documents).toEqual({
      'b-1': { id: 'b-1', tenant_id: 'tenant-b', title: 'B one' },
    });
    expect(snapshotB.scope).not.toBe(snapshotA.scope);

    db.insert('documents', { id: 'b-live', tenant_id: 'tenant-b', title: 'Hidden live' });
    db.insert('documents', { id: 'a-live', tenant_id: 'tenant-a', title: 'Visible live' });
    const liveA = await tenantA.waitFor(
      (message) => message.type === 'sync.change' && message.rowId === 'a-live',
    );
    expect(liveA.type).toBe('sync.change');
    expect(tenantA.messages.some(
      (message) => message.type === 'sync.change' && message.rowId === 'b-live',
    )).toBe(false);

    tenantA.close();
    db.insert('documents', { id: 'b-catchup', tenant_id: 'tenant-b', title: 'Hidden catchup' });
    db.insert('documents', { id: 'a-catchup', tenant_id: 'tenant-a', title: 'Visible catchup' });

    const reconnectedA = await connect(getSyncUrl(app, 'tenant-a-token'));
    reconnectedA.ws.send(JSON.stringify({
      type: 'sync.subscribe',
      tables: ['documents'],
      snapshot: ['documents'],
      lastSeq: snapshotA.seq,
      epoch: snapshotA.epoch,
      scope: snapshotA.scope,
    }));
    const catchup = await reconnectedA.waitFor(
      (message) => message.type === 'sync.catchup',
    );
    if (catchup.type !== 'sync.catchup') throw new Error('Expected catchup');
    expect(catchup.changes.map((change) => change.rowId)).toEqual([
      'a-live',
      'a-catchup',
    ]);

    tenantB.close();
    reconnectedA.close();
  });

  test('stamps inserts and constrains update/delete in the SQL mutation boundary', async () => {
    const { app, db } = createTenantSyncApp();
    activeApp = app;
    db.insert('documents', { id: 'b-1', tenant_id: 'tenant-b', title: 'B one' });

    const tenantA = await connect(getSyncUrl(app, 'tenant-a-token'));
    const mutate = async (
      ref: string,
      op: 'INSERT' | 'UPDATE' | 'DELETE',
      input: { rowId?: string; row?: Record<string, unknown>; table?: string },
    ) => {
      tenantA.ws.send(JSON.stringify({
        type: 'sync.mutate',
        ref,
        table: input.table ?? 'documents',
        op,
        rowId: input.rowId,
        row: input.row,
      }));
      return tenantA.waitFor(
        (message) => message.type === 'sync.ack' && message.ref === ref,
      );
    };

    expect(await mutate('insert-a', 'INSERT', {
      row: { id: 'a-1', title: 'Stamped A' },
    })).toMatchObject({ type: 'sync.ack', ok: true });
    expect(db.get('documents', 'a-1')).toEqual({
      id: 'a-1', tenant_id: 'tenant-a', title: 'Stamped A',
    });

    expect(await mutate('conflict-scope', 'INSERT', {
      row: { id: 'bad', tenant_id: 'tenant-b', title: 'No' },
    })).toMatchObject({
      type: 'sync.ack',
      ok: false,
      error: 'Field "tenant_id" conflicts with the active tenant',
    });

    expect(await mutate('collision', 'INSERT', {
      row: { id: 'b-1', title: 'Overwrite B' },
    })).toMatchObject({
      type: 'sync.ack',
      ok: false,
      error: 'primary key already exists',
    });
    expect(db.get('documents', 'b-1')?.title).toBe('B one');

    expect(await mutate('cross-update', 'UPDATE', {
      rowId: 'b-1', row: { title: 'Cross update' },
    })).toMatchObject({ type: 'sync.ack', ok: false, error: 'Row not found: b-1' });
    expect(await mutate('cross-delete', 'DELETE', {
      rowId: 'b-1',
    })).toMatchObject({ type: 'sync.ack', ok: false, error: 'Row not found: b-1' });

    expect(await mutate('scope-update', 'UPDATE', {
      rowId: 'a-1', row: { tenant_id: 'tenant-a', title: 'No direct scope' },
    })).toMatchObject({
      type: 'sync.ack',
      ok: false,
      error: 'Field "tenant_id" is server-managed and cannot be updated',
    });

    expect(await mutate('allowed-update', 'UPDATE', {
      rowId: 'a-1', row: { title: 'Updated A' },
    })).toMatchObject({ type: 'sync.ack', ok: true });
    expect(db.get('documents', 'a-1')?.title).toBe('Updated A');

    expect(await mutate('allowed-delete', 'DELETE', {
      rowId: 'a-1',
    })).toMatchObject({ type: 'sync.ack', ok: true });
    expect(db.get('documents', 'a-1')).toBeNull();
    tenantA.close();
  });

  test('fences live delivery synchronously after durable authority is revoked', async () => {
    const { app, db, revoke } = createTenantSyncApp();
    activeApp = app;
    const tenantA = await connect(getSyncUrl(app, 'tenant-a-token'));
    tenantA.ws.send(JSON.stringify({
      type: 'sync.subscribe',
      tables: ['documents'],
      snapshot: ['documents'],
      lastSeq: 0,
    }));
    await tenantA.waitFor((message) => message.type === 'sync.snapshot');

    revoke('tenant-a-token');
    db.insert('documents', {
      id: 'revoked-live',
      tenant_id: 'tenant-a',
      title: 'Must never leave the server',
    });

    const close = await tenantA.waitForClose();
    expect(close.code).toBe(4001);
    expect(close.reason).toBe('Auth context changed');
    expect(tenantA.messages.some(
      (message) => message.type === 'sync.change' && message.rowId === 'revoked-live',
    )).toBeFalse();
  });

  test('rejects multi-tenant sockets when durable authority is unavailable', async () => {
    const { app } = createTenantSyncApp(false);
    activeApp = app;
    const tenantA = await connect(getSyncUrl(app, 'tenant-a-token'));
    const close = await tenantA.waitForClose();
    expect(close.code).toBe(1011);
    expect(close.reason).toBe('Durable Sync authority unavailable');
  });

  test('uses the shared advanced RBAC kernel for Sync reads and mutations', async () => {
    const tables = {
      documents: {
        id: 'text primary key',
        tenant_id: 'text not null',
        title: 'text not null',
      },
    };
    const authConfig = resolveAuthBehaviorConfig({
      tenancy: 'multi',
      authorization: {
        mode: 'advanced',
        permissions: {
          'documents:read': { label: 'Read documents' },
          'documents:write': { label: 'Write documents' },
        },
        roles: {
          reader: { permissions: ['documents:read'] },
          editor: { permissions: ['documents:read', 'documents:write'] },
        },
      },
    });
    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: 'documents',
      exposure: 'sync',
      realm: tenantRealm(),
      actions: ['list', 'create'],
      policy: {
        list: authorizationPolicy({
          tenant: 'required',
          permission: 'documents:read',
        }),
        create: authorizationPolicy({
          tenant: 'required',
          permission: 'documents:write',
        }),
      },
    }), {
      tables,
      authConfig,
      tenancyMode: 'multi',
      managedTables: ['documents'],
    });
    const assignments = new Map<string, readonly string[]>([
      ['membership-tenant-a', ['reader']],
      ['membership-tenant-b', []],
    ]);
    const roleAssignments: AuthorizationRoleAssignmentResolver = {
      resolveApplicationRoles() {
        return null;
      },
      resolveTenantRoles(input) {
        const roles = assignments.get(input.membershipId);
        if (!roles) return null;
        return {
          scopeKind: 'tenant',
          scopeId: input.tenantId,
          tenantId: input.tenantId,
          membershipId: input.membershipId,
          userId: input.userId,
          roles,
          revision: `tenant:${input.tenantId}:${input.membershipId}:${roles.join(',')}`,
        };
      },
    };
    const service = new ResourceSyncPolicyService({
      registry,
      authConfig,
      getAuthorizationKernel: () => createAuthorizationKernel(authConfig),
      getRoleAssignments: () => roleAssignments,
      tenancyMode: 'multi',
      managedTables: new Set(['documents']),
    });
    const tenantA = tenantContext('tenant-a');
    const tenantB = tenantContext('tenant-b');

    const readable = await service.resolveTableAccess({
      tableNames: ['documents'],
      authContext: tenantA,
    });
    expect(readable.readableTables.has('documents')).toBeTrue();
    const deniedRead = await service.resolveTableAccess({
      tableNames: ['documents'],
      authContext: tenantB,
    });
    expect(deniedRead.readableTables.has('documents')).toBeFalse();

    const deniedWrite = await service.authorizeMutation({
      table: 'documents',
      op: 'INSERT',
      row: { id: 'a-1', title: 'Reader cannot create' },
      authContext: tenantA,
      loadRow: () => null,
    });
    expect(deniedWrite).toMatchObject({
      ok: false,
      code: 'authorization-denied',
    });

    assignments.set('membership-tenant-a', ['editor']);
    const allowedWrite = await service.authorizeMutation({
      table: 'documents',
      op: 'INSERT',
      row: { id: 'a-2', title: 'Editor can create' },
      authContext: tenantA,
      loadRow: () => null,
    });
    expect(allowedWrite).toMatchObject({
      ok: true,
      row: { id: 'a-2', tenant_id: 'tenant-a', title: 'Editor can create' },
    });
  });
});

function createTenantSyncApp(durableAuthority = true): {
  app: TestApp;
  db: ReactiveDB;
  revoke(token: string): void;
} {
  const tables = {
    documents: {
      id: 'text primary key',
      tenant_id: 'text not null',
      title: 'text not null',
    },
  };
  const registry = new ResourceRegistry();
  registry.register(defineResource({
    table: 'documents',
    exposure: 'sync',
    realm: tenantRealm(),
    policy: authenticatedOnly(),
  }), {
    tables,
    authConfig: { userProperties: {} },
    tenancyMode: 'multi',
    managedTables: ['documents'],
  });
  const contexts = new Map<string, SyncAuthContext>([
    ['tenant-a-token', tenantContext('tenant-a')],
    ['tenant-b-token', tenantContext('tenant-b')],
  ]);
  const verifier: SyncTokenVerifier = {
    async resolveAuthContext(token) {
      return contexts.get(token) ?? null;
    },
    async verifyAccessToken() {
      return null;
    },
    ...(durableAuthority ? {
      captureAuthContextAuthority(context: SyncAuthContext) {
        return authorityReference(context);
      },
      resolveAuthContextAuthority(reference: SyncAuthContextAuthorityReference) {
        const context = [...contexts.values()].find(
          (candidate) => candidate.sessionId === reference.sessionId,
        );
        return context
          && JSON.stringify(authorityReference(context)) === JSON.stringify(reference)
          ? context
          : null;
      },
    } : {}),
  };
  let db!: ReactiveDB;
  const app = new Elysia().use(createSyncPlugin({
    db: { mode: 'memory', ringBufferDepth: 100 },
    tables,
    tenancyMode: 'multi',
    auth: {
      required: true,
      allowLegacyQueryToken: true,
      getTokenVerifier: () => verifier,
    },
    resourcePolicy: new ResourceSyncPolicyService({
      registry,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: new Set(Object.keys(tables)),
    }),
    onDatabaseCreated(created) {
      db = created;
    },
  })).listen(0) as unknown as TestApp;
  if (!db) throw new Error('Sync database was not created');
  return {
    app,
    db,
    revoke(token: string) { contexts.delete(token); },
  };
}

function tenantContext(tenantId: string): SyncAuthContext {
  return {
    userId: 'shared-user',
    email: 'shared@example.test',
    role: 'admin',
    sessionKind: 'web',
    sessionId: `session-${tenantId}`,
    sessionGeneration: 0,
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId: `membership-${tenantId}`,
    tenantRole: 'owner',
    tenantAuthorizationGeneration: 2,
    membershipAuthorizationGeneration: 3,
  };
}

function authorityReference(
  context: SyncAuthContext,
): SyncAuthContextAuthorityReference | null {
  if (!context.sessionKind
    || !context.sessionId
    || !context.sessionScopeKind
    || !context.sessionScopeId) return null;
  return Object.freeze({
    version: 1,
    userId: context.userId,
    platformRole: context.role,
    authGeneration: 0,
    sessionKind: context.sessionKind,
    sessionId: context.sessionId,
    sessionGeneration: context.sessionGeneration ?? null,
    clientId: context.clientId ?? null,
    identityScopes: Object.freeze([...(context.scope ?? [])]),
    sessionScopeKind: context.sessionScopeKind,
    sessionScopeId: context.sessionScopeId,
    tenantId: context.tenantId ?? null,
    membershipId: context.membershipId ?? null,
    tenantRole: context.tenantRole ?? null,
    tenantAuthorizationGeneration: context.tenantAuthorizationGeneration ?? null,
    membershipAuthorizationGeneration:
      context.membershipAuthorizationGeneration ?? null,
    authorizationAssignmentRevision:
      context.authorizationAssignmentRevision ?? null,
  });
}

function getSyncUrl(app: TestApp, token: string): string {
  const { hostname, port } = app.server!;
  if (typeof port !== 'number') throw new Error('Test server did not expose a port');
  const url = new URL(`ws://${hostname ?? 'localhost'}:${port}/sync`);
  url.searchParams.set('token', token);
  return url.toString();
}

async function connect(url: string): Promise<{
  ws: WebSocket;
  messages: ServerMessage[];
  waitFor(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage>;
  waitForClose(): Promise<CloseEvent>;
  close(): void;
}> {
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];
  const closeWaiters: Array<(event: CloseEvent) => void> = [];
  let closeEvent: CloseEvent | null = null;
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index--) {
      const waiter = waiters[index]!;
      if (!waiter.predicate(message)) continue;
      waiters.splice(index, 1);
      waiter.resolve(message);
    }
  };
  ws.onclose = (event) => {
    closeEvent = event;
    while (closeWaiters.length > 0) closeWaiters.shift()!(event);
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  return {
    ws,
    messages,
    waitFor(predicate) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for Sync message')), 2_000);
        waiters.push({
          predicate,
          resolve(message) {
            clearTimeout(timer);
            resolve(message);
          },
        });
      });
    },
    waitForClose() {
      if (closeEvent) return Promise.resolve(closeEvent);
      return new Promise<CloseEvent>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timed out waiting for Sync socket close')),
          2_000,
        );
        closeWaiters.push((event) => {
          clearTimeout(timer);
          resolve(event);
        });
      });
    },
    close() {
      ws.close();
    },
  };
}
