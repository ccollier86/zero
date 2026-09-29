/**
 * data-query.plugin.test.ts
 *
 * Exercises the lazy-table HTTP query endpoint through Elysia lifecycle tests.
 * These tests verify query validation, pagination behavior, and sync read
 * policy enforcement without coupling the data-query plugin to UI hooks.
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { TokenService } from '../auth/token-service';
import type { UserStore } from '../auth/user-store';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import { DatabaseError } from '../databases/database-error';
import type { DatabaseManager } from '../databases/database-manager';
import type { DatabaseFindInput } from '../databases/database-operations';
import { MemoryEventStore, OBS_CODES } from '../observability';
import type { PlatformObservabilityRuntime } from '../observability';
import {
  adminOnly,
  anyOf,
  authorizationPolicy,
  authenticatedOnly,
  customPolicy,
  defineResource,
  metadataPolicy,
  ownerPolicy,
  readOnly,
  ResourceRegistry,
  tenantRealm,
  type ResourcePolicyAuthConfig,
} from '../resources';
import { RESOURCE_QUERY_LIMITS } from '../resources/resource-query';
import type { ReactiveDB } from './reactive-db';
import type { TableSchema } from './types';
import { createDataQueryPlugin } from './data-query.plugin';
import { createSyncPlugin } from './sync.plugin';
import type { SyncPolicy } from './sync-policy';

interface TestApp {
  handle(request: Request): Promise<Response>;
  stop(): unknown;
}

let app: TestApp | null = null;
const appDatabases = new WeakMap<object, ReactiveDB>();

const testTables = {
  items: {
    id: 'text primary key',
    category: 'text not null',
    title: 'text not null',
    priority: 'integer not null',
  },
  admin_items: {
    id: 'text primary key',
    title: 'text not null',
  },
  owned_items: {
    id: 'text primary key',
    title: 'text not null',
    owner_id: 'text not null',
    priority: 'integer not null',
  },
  reports: {
    id: 'text primary key',
    title: 'text not null',
    department: 'text not null',
  },
  blocked_items: {
    id: 'text primary key',
    title: 'text not null',
  },
  tenant_docs: {
    id: 'text primary key',
    tenant_id: 'text not null',
    title: 'text not null',
  },
  isolated_docs: {
    id: 'text primary key',
    title: 'text not null',
  },
} satisfies Record<string, TableSchema>;

const tableColumns = new Map([
  ['items', ['id', 'category', 'title', 'priority']],
  ['admin_items', ['id', 'title']],
  ['owned_items', ['id', 'title', 'owner_id', 'priority']],
  ['reports', ['id', 'title', 'department']],
  ['blocked_items', ['id', 'title']],
  ['tenant_docs', ['id', 'tenant_id', 'title']],
  ['isolated_docs', ['id', 'title']],
]);

function createTokenService(): TokenService {
  return {
    async verifyAccessToken(token: string) {
      if (token === 'admin-token') {
        return { sub: 'admin-1', email: 'admin@test.local', role: 'admin' };
      }
      if (token === 'user-token') {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      }
      if (token === 'sales-token') {
        return { sub: 'user-2', email: 'sales@test.local', role: 'user' };
      }
      return null;
    },
  } as unknown as TokenService;
}

function createUserStore(): UserStore {
  return {
    getUserById(userId: string) {
      const users: Record<string, any> = {
        'admin-1': {
          userId: 'admin-1',
          email: 'admin@test.local',
          role: 'admin',
          status: 'active',
          passwordChangeRequired: false,
          emailVerifiedAt: 1,
          emailVerificationRequired: false,
          mfaRequired: false,
          properties: { department: 'support' },
        },
        'user-1': {
          userId: 'user-1',
          email: 'user@test.local',
          role: 'user',
          status: 'active',
          passwordChangeRequired: false,
          emailVerifiedAt: 1,
          emailVerificationRequired: false,
          mfaRequired: false,
          properties: { department: 'support' },
        },
        'user-2': {
          userId: 'user-2',
          email: 'sales@test.local',
          role: 'user',
          status: 'active',
          passwordChangeRequired: false,
          emailVerifiedAt: 1,
          emailVerificationRequired: false,
          mfaRequired: false,
          properties: { department: 'sales' },
        },
      };
      return users[userId] ?? null;
    },
  } as unknown as UserStore;
}

function createTestApp(options: {
  policy?: SyncPolicy;
  getTokenService?: () => TokenService | null;
  getUserStore?: () => UserStore | null;
  getAuthorizationKernel?: () => ReturnType<typeof createAuthorizationKernel> | null;
  getRoleAssignments?: () => AuthorizationRoleAssignmentResolver | null;
  getDatabaseManager?: () => DatabaseManager | null;
  resourceRegistry?: ResourceRegistry;
  resourceAuthConfig?: ResourcePolicyAuthConfig;
  defaultLimit?: number;
  maxLimit?: number;
  tenancyMode?: 'single' | 'multi';
  managedTables?: ReadonlySet<string>;
  queryableTables?: Set<string>;
  observability?: PlatformObservabilityRuntime;
} = {}): TestApp {
  let db: ReactiveDB | null = null;
  const testApp = new Elysia()
    .use(
      createSyncPlugin({
        db: { mode: 'memory' },
        tables: testTables,
        onDatabaseCreated(created) {
          db = created;
        },
      })
    )
    .use(
      createDataQueryPlugin({
        queryableTables: options.queryableTables ?? new Set(tableColumns.keys()),
        tableColumns,
        policy: options.policy,
        getTokenService: options.getTokenService,
        getUserStore: options.getUserStore,
        getAuthorizationKernel: options.getAuthorizationKernel,
        getRoleAssignments: options.getRoleAssignments,
        getDatabaseManager: options.getDatabaseManager,
        resourceRegistry: options.resourceRegistry,
        resourceAuthConfig: options.resourceAuthConfig,
        tenancyMode: options.tenancyMode,
        managedTables: options.managedTables,
        defaultLimit: options.defaultLimit,
        maxLimit: options.maxLimit,
        observability: options.observability,
      })
    )
    .listen(0);

  if (!db) throw new Error('Sync test database was not created');
  appDatabases.set(testApp, db);
  return testApp;
}

function getAppDatabase(testApp: TestApp): ReactiveDB {
  const db = appDatabases.get(testApp);
  if (!db) throw new Error('Sync test database is not bound to this app');
  return db;
}

function seedItems(testApp: TestApp): void {
  const db = getAppDatabase(testApp);

  db.insert('items', { id: 'i1', category: 'a', title: 'Alpha', priority: 1 });
  db.insert('items', { id: 'i2', category: 'a', title: 'Beta', priority: 2 });
  db.insert('items', { id: 'i3', category: 'a', title: 'Gamma', priority: 3 });
  db.insert('items', { id: 'i4', category: 'b', title: 'Delta', priority: 4 });
  db.insert('admin_items', { id: 'admin-1', title: 'Admin only' });
}

function seedResourceRows(testApp: TestApp): void {
  const db = getAppDatabase(testApp);

  db.insert('owned_items', { id: 'o1', title: 'Mine', owner_id: 'user-1', priority: 1 });
  db.insert('owned_items', { id: 'o2', title: 'Theirs', owner_id: 'user-2', priority: 2 });
  db.insert('reports', { id: 'r1', title: 'Support', department: 'support' });
  db.insert('blocked_items', { id: 'b1', title: 'Blocked' });
}

function createResourceRegistry(authConfig: ResourcePolicyAuthConfig): ResourceRegistry {
  const registry = new ResourceRegistry();
  registry.register([
    defineResource({
      table: 'owned_items',
      actions: ['list'],
      policy: {
        list: anyOf(adminOnly(), ownerPolicy({ userField: 'owner_id' })),
      },
    }),
    defineResource({
      table: 'reports',
      actions: ['list'],
      policy: {
        list: metadataPolicy({ department: 'support' }),
      },
    }),
    defineResource({
      table: 'blocked_items',
      actions: ['get'],
      policy: {
        get: readOnly(),
      },
    }),
  ], {
    tables: testTables,
    authConfig,
  });
  return registry;
}

function createResourceAuthConfig(): ResourcePolicyAuthConfig {
  return {
    userProperties: {
      department: {
        key: 'department',
        type: 'enum',
        values: ['support', 'sales'],
        editableBy: 'admin',
        useInPolicies: true,
      },
    },
  };
}

function createPhysicalTenantRegistry(): ResourceRegistry {
  const registry = new ResourceRegistry();
  registry.register(defineResource({
    table: 'isolated_docs',
    exposure: 'http',
    actions: ['list'],
    realm: tenantRealm(),
    policy: authenticatedOnly(),
  }), {
    tables: testTables,
    authConfig: { userProperties: {} },
    tenancyMode: 'multi',
    tenantIsolation: 'tenant-database',
    managedTables: ['isolated_docs'],
  });
  return registry;
}

async function getJson(path: string, headers?: HeadersInit): Promise<{
  status: number;
  body: any;
}> {
  const response = await app!.handle(new Request(`http://localhost${path}`, { headers }));
  return {
    status: response.status,
    body: await response.json(),
  };
}

afterEach(async () => {
  await app?.stop();
  app = null;
});

describe('/api/data', () => {
  test('finalizes each transient shared-database query statement', async () => {
    app = createTestApp();
    seedItems(app);
    const db = getAppDatabase(app);
    const originalPrepare = db.prepare.bind(db);
    const statements: Array<ReturnType<ReactiveDB['prepare']>> = [];
    const prepare = spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = originalPrepare(sql);
      statements.push(statement);
      return statement;
    });

    try {
      const result = await getJson('/api/data?table=items&limit=1');
      expect(result.status).toBe(200);
      expect(statements).toHaveLength(1);
      expect(statementIsFinalized(statements[0]!)).toBe(true);
    } finally {
      prepare.mockRestore();
      for (const statement of statements) {
        if (!statementIsFinalized(statement)) statement.finalize();
      }
    }
  });

  test('supports equality filters, sort direction, offset pagination, and page metadata', async () => {
    app = createTestApp();
    seedItems(app);

    const result = await getJson(
      '/api/data?table=items&filter=category:a&order=priority&dir=asc&limit=1&offset=1'
    );

    expect(result.status).toBe(200);
    expect(result.body.rows).toEqual([
      { id: 'i2', category: 'a', title: 'Beta', priority: 2 },
    ]);
    expect(result.body.page).toEqual({
      limit: 1,
      offset: 1,
      count: 1,
      hasMore: true,
      nextOffset: 2,
    });
  });

  test('supports explicit filter operators', async () => {
    app = createTestApp();
    seedItems(app);

    const result = await getJson(
      '/api/data?table=items&filter=priority:gte:2&filter=title:contains:mm&order=priority&dir=desc'
    );

    expect(result.status).toBe(200);
    expect(result.body.rows).toEqual([
      { id: 'i3', category: 'a', title: 'Gamma', priority: 3 },
    ]);
  });

  test('caps limits and rejects invalid query columns', async () => {
    app = createTestApp({ maxLimit: 2 });
    seedItems(app);

    const capped = await getJson('/api/data?table=items&order=priority&dir=asc&limit=99');
    expect(capped.status).toBe(200);
    expect(capped.body.rows).toHaveLength(2);
    expect(capped.body.page.limit).toBe(2);
    expect(capped.body.page.hasMore).toBe(true);

    const invalid = await getJson('/api/data?table=items&filter=missing:value');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("Unknown column 'missing' for table 'items'");
    expect(invalid.body.code).toBe('invalid-data-query');
  });

  test('bounds query strings without reflecting rejected input', async () => {
    app = createTestApp();

    const invalidName = 'items-secret-value';
    const invalid = await getJson(`/api/data?table=${invalidName}`);
    expect(invalid).toEqual({
      status: 400,
      body: { error: 'Invalid table name', code: 'invalid-data-query' },
    });
    expect(JSON.stringify(invalid.body)).not.toContain(invalidName);

    const overlongName = 'a'.repeat(RESOURCE_QUERY_LIMITS.identifierLength + 1);
    const overlong = await getJson(`/api/data?table=${overlongName}`);
    expect(overlong).toEqual({
      status: 400,
      body: { error: 'Invalid data query', code: 'invalid-data-query' },
    });
    expect(JSON.stringify(overlong.body)).not.toContain(overlongName);

    const params = new URLSearchParams({ table: 'items' });
    for (let index = 0; index <= RESOURCE_QUERY_LIMITS.filterCount; index += 1) {
      params.append('filter', `priority:eq:${index}`);
    }
    const tooManyFilters = await getJson(`/api/data?${params}`);
    expect(tooManyFilters).toEqual({
      status: 400,
      body: { error: 'Invalid data query', code: 'invalid-data-query' },
    });
  });

  test('enforces sync read policy with HTTP auth context', async () => {
    const tokenService = createTokenService();
    app = createTestApp({
      getTokenService: () => tokenService,
      policy: {
        canReadTable({ table, authContext }) {
          if (table === 'admin_items' && authContext?.role !== 'admin') {
            return { ok: false, reason: 'Admin data requires admin role' };
          }
          return true;
        },
      },
    });
    seedItems(app);

    const anonymous = await getJson('/api/data?table=admin_items');
    expect(anonymous).toEqual({
      status: 403,
      body: { error: 'Admin data requires admin role' },
    });

    const user = await getJson('/api/data?table=admin_items', {
      authorization: 'Bearer user-token',
    });
    expect(user.status).toBe(403);

    const admin = await getJson('/api/data?table=admin_items', {
      authorization: 'Bearer admin-token',
    });
    expect(admin.status).toBe(200);
    expect(admin.body.rows).toEqual([{ id: 'admin-1', title: 'Admin only' }]);
  });

  test('enforces resource HTTP exposure independently from the loading allow-list', async () => {
    const registry = new ResourceRegistry();
    registry.register([
      defineResource({
        table: 'items',
        exposure: 'internal',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        table: 'admin_items',
        exposure: 'http',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        table: 'owned_items',
        exposure: 'sync',
        actions: ['list'],
        policy: readOnly(),
      }),
      defineResource({
        table: 'reports',
        exposure: 'all',
        actions: ['list'],
        policy: readOnly(),
      }),
    ], { tables: testTables, authConfig: { userProperties: {} } });
    app = createTestApp({
      resourceRegistry: registry,
      resourceAuthConfig: { userProperties: {} },
      // Registered exposure wins in both directions: these loading-allowed
      // resources stay HTTP-denied, while http/all below need no lazy entry.
      queryableTables: new Set(['items', 'owned_items']),
    });
    seedItems(app);
    seedResourceRows(app);

    const unknown = await getJson('/api/data?table=not_a_client_table');
    expect(unknown).toEqual({
      status: 404,
      body: {
        error: 'Table not found',
        code: 'table-not-queryable',
      },
    });

    for (const table of ['items', 'owned_items']) {
      const denied = await getJson(`/api/data?table=${table}`);
      expect(denied).toEqual(unknown);
    }

    const http = await getJson('/api/data?table=admin_items');
    expect(http.status).toBe(200);
    expect(http.body.rows).toEqual([{ id: 'admin-1', title: 'Admin only' }]);

    const all = await getJson('/api/data?table=reports');
    expect(all.status).toBe(200);
    expect(all.body.rows).toEqual([
      { id: 'r1', title: 'Support', department: 'support' },
    ]);
  });

  test('applies registered owner resource policy constraints', async () => {
    const tokenService = createTokenService();
    const authConfig = createResourceAuthConfig();
    app = createTestApp({
      getTokenService: () => tokenService,
      resourceRegistry: createResourceRegistry(authConfig),
      resourceAuthConfig: authConfig,
    });
    seedResourceRows(app);

    const user = await getJson('/api/data?table=owned_items&order=priority&dir=asc', {
      authorization: 'Bearer user-token',
    });
    expect(user.status).toBe(200);
    expect(user.body.rows.map((row: any) => row.id)).toEqual(['o1']);

    const admin = await getJson('/api/data?table=owned_items&order=priority&dir=asc', {
      authorization: 'Bearer admin-token',
    });
    expect(admin.status).toBe(200);
    expect(admin.body.rows.map((row: any) => row.id)).toEqual(['o1', 'o2']);
  });

  test('hydrates metadata policy properties for registered data resources', async () => {
    const tokenService = createTokenService();
    const userStore = createUserStore();
    const authConfig = createResourceAuthConfig();
    app = createTestApp({
      getTokenService: () => tokenService,
      getUserStore: () => userStore,
      resourceRegistry: createResourceRegistry(authConfig),
      resourceAuthConfig: authConfig,
    });
    seedResourceRows(app);

    const support = await getJson('/api/data?table=reports', {
      authorization: 'Bearer user-token',
    });
    expect(support.status).toBe(200);
    expect(support.body.rows.map((row: any) => row.id)).toEqual(['r1']);

    const sales = await getJson('/api/data?table=reports', {
      authorization: 'Bearer sales-token',
    });
    expect(sales.status).toBe(403);
    expect(sales.body.code).toBe('metadata-property');
  });

  test('applies the shared advanced RBAC kernel to lazy resource reads', async () => {
    const authConfig = resolveAuthBehaviorConfig({
      tenancy: 'single',
      authorization: {
        mode: 'advanced',
        permissions: {
          'items:read': { label: 'Read items' },
        },
        roles: {
          reader: { permissions: ['items:read'] },
        },
      },
    });
    const kernel = createAuthorizationKernel(authConfig);
    const roles: AuthorizationRoleAssignmentResolver = {
      resolveApplicationRoles(userId) {
        if (userId !== 'user-1') return null;
        return {
          scopeKind: 'application',
          scopeId: 'application',
          userId,
          roles: ['reader'],
          revision: 'application:application:1',
        };
      },
      resolveTenantRoles() {
        return null;
      },
    };
    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: 'items',
      actions: ['list'],
      policy: authorizationPolicy({ permission: 'items:read' }),
    }), {
      tables: testTables,
      authConfig,
    });
    app = createTestApp({
      getTokenService: () => createTokenService(),
      getAuthorizationKernel: () => kernel,
      getRoleAssignments: () => roles,
      resourceRegistry: registry,
      resourceAuthConfig: authConfig,
    });
    seedItems(app);

    const allowed = await getJson('/api/data?table=items&order=priority&dir=asc', {
      authorization: 'Bearer user-token',
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.rows).toHaveLength(4);

    const denied = await getJson('/api/data?table=items', {
      authorization: 'Bearer sales-token',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('authorization-denied');
  });

  test('fails closed when registered resource has no list action', async () => {
    const authConfig = createResourceAuthConfig();
    app = createTestApp({
      resourceRegistry: createResourceRegistry(authConfig),
      resourceAuthConfig: authConfig,
    });
    seedResourceRows(app);

    const result = await getJson('/api/data?table=blocked_items');
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('resource-list-not-allowed');
  });

  test('revalidates bearer authority after asynchronous resource policy work', async () => {
    let resolutions = 0;
    const tokenService = {
      async resolveAuthContext(token: string) {
        if (token !== 'race-token') return null;
        resolutions += 1;
        if (resolutions > 1) return null;
        return {
          userId: 'user-1',
          email: 'user@test.local',
          role: 'user',
          sessionId: 'session-race',
          sessionGeneration: 0,
        };
      },
    } as unknown as TokenService;
    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: 'items',
      actions: ['list'],
      policy: customPolicy(async () => {
        await Promise.resolve();
        return true;
      }, { name: 'authority-race' }),
    }), {
      tables: testTables,
      authConfig: { userProperties: {} },
    });
    app = createTestApp({
      getTokenService: () => tokenService,
      resourceRegistry: registry,
      resourceAuthConfig: { userProperties: {} },
    });
    seedItems(app);

    const result = await getJson('/api/data?table=items', {
      authorization: 'Bearer race-token',
    });
    expect(result).toEqual({
      status: 403,
      body: {
        error: 'Resource authorization changed during the request',
        code: 'resource-authority-changed',
      },
    });
    expect(resolutions).toBe(2);
  });

  test('rechecks durable authority inside the same SQLite transaction as the query', async () => {
    let asyncResolutions = 0;
    let commitResolutions = 0;
    const context = {
      userId: 'user-1',
      email: 'user@test.local',
      role: 'user',
      sessionKind: 'web' as const,
      sessionId: 'session-commit-race',
      sessionGeneration: 0,
      sessionScopeKind: 'application' as const,
      sessionScopeId: 'application',
    };
    const tokenService = {
      async resolveAuthContext(token: string) {
        if (token !== 'commit-race-token') return null;
        asyncResolutions += 1;
        return context;
      },
      captureAuthContextAuthority() {
        return { version: 1 };
      },
      resolveAuthContextAuthority() {
        commitResolutions += 1;
        // Simulate a revocation committed after asynchronous policy/token
        // revalidation but before the final SQL read boundary.
        return null;
      },
    } as unknown as TokenService;
    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: 'items',
      actions: ['list'],
      policy: customPolicy(async () => {
        await Promise.resolve();
        return true;
      }, { name: 'commit-authority-race' }),
    }), {
      tables: testTables,
      authConfig: { userProperties: {} },
    });
    app = createTestApp({
      getTokenService: () => tokenService,
      resourceRegistry: registry,
      resourceAuthConfig: { userProperties: {} },
    });
    seedItems(app);

    const result = await getJson('/api/data?table=items', {
      authorization: 'Bearer commit-race-token',
    });
    expect(result).toEqual({
      status: 403,
      body: {
        error: 'Resource authorization changed during the request',
        code: 'resource-authority-changed',
      },
    });
    expect(asyncResolutions).toBe(2);
    expect(commitResolutions).toBe(1);
  });

  test('ANDs the durable tenant realm and rejects unclassified multi-mode query tables at startup', async () => {
    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: 'tenant_docs',
      exposure: 'http',
      actions: ['list'],
      realm: tenantRealm(),
      policy: authenticatedOnly(),
    }), {
      tables: testTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: ['tenant_docs'],
    });
    const tenantContext = {
      userId: 'shared-user',
      email: 'shared@example.test',
      role: 'admin',
      sessionKind: 'web' as const,
      sessionId: 'session-a',
      sessionGeneration: 0,
      sessionScopeKind: 'tenant' as const,
      sessionScopeId: 'tenant-a',
      tenantId: 'tenant-a',
      membershipId: 'membership-a',
      tenantRole: 'owner',
      tenantAuthorizationGeneration: 1,
      membershipAuthorizationGeneration: 2,
    };
    const nativeTenantContext = {
      ...tenantContext,
      sessionKind: 'native' as const,
      sessionId: 'native-family-a',
      sessionGeneration: undefined,
      clientId: 'com.example.zero',
    };
    const tokenService = {
      async resolveAuthContext(token: string) {
        if (token === 'tenant-a-token') return tenantContext;
        if (token === 'native-tenant-a-token') return nativeTenantContext;
        return null;
      },
      captureAuthContextAuthority(authContext: unknown) {
        return { version: 1, authContext };
      },
      resolveAuthContextAuthority(reference: { authContext: typeof tenantContext }) {
        return reference.authContext;
      },
    } as unknown as TokenService;
    app = createTestApp({
      getTokenService: () => tokenService,
      resourceRegistry: registry,
      resourceAuthConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: new Set(['tenant_docs', 'items']),
      queryableTables: new Set(['tenant_docs']),
    });
    const db = getAppDatabase(app);
    db.insert('tenant_docs', { id: 'a', tenant_id: 'tenant-a', title: 'A' });
    db.insert('tenant_docs', { id: 'b', tenant_id: 'tenant-b', title: 'B' });

    const scoped = await getJson('/api/data?table=tenant_docs&order=id', {
      authorization: 'Bearer tenant-a-token',
    });
    expect(scoped.status).toBe(200);
    expect(scoped.body.rows.map((row: any) => row.id)).toEqual(['a']);

    const nativeScoped = await getJson('/api/data?table=tenant_docs&order=id', {
      authorization: 'Bearer native-tenant-a-token',
    });
    expect(nativeScoped.status).toBe(200);
    expect(nativeScoped.body.rows.map((row: any) => row.id)).toEqual(['a']);

    const attemptedWiden = await getJson(
      '/api/data?table=tenant_docs&filter=tenant_id:tenant-b',
      { authorization: 'Bearer tenant-a-token' },
    );
    expect(attemptedWiden.status).toBe(200);
    expect(attemptedWiden.body.rows).toEqual([]);

    const anonymous = await getJson('/api/data?table=tenant_docs');
    expect(anonymous).toMatchObject({
      status: 403,
      body: { code: 'resource-tenant-context-required' },
    });

    expect(() => createDataQueryPlugin({
      queryableTables: new Set(['tenant_docs', 'items']),
      tableColumns,
      resourceRegistry: registry,
      tenancyMode: 'multi',
    })).toThrow('table "items" must have an explicit global or tenant resource realm');
  });

  test('routes physical tenant resources through the bound actor without a tenant_id predicate', async () => {
    const tenantContext = {
      userId: 'isolated-user',
      email: 'isolated@example.test',
      role: 'admin',
      sessionKind: 'web' as const,
      sessionId: 'isolated-session-a',
      sessionGeneration: 0,
      sessionScopeKind: 'tenant' as const,
      sessionScopeId: 'tenant-a',
      tenantId: 'tenant-a',
      membershipId: 'isolated-membership-a',
      tenantRole: 'owner',
      tenantAuthorizationGeneration: 3,
      membershipAuthorizationGeneration: 5,
    };
    const tokenService = {
      async resolveAuthContext(token: string) {
        return token === 'isolated-token' ? tenantContext : null;
      },
      captureAuthContextAuthority(authContext: unknown) {
        return { authContext };
      },
      resolveAuthContextAuthority(reference: { authContext: typeof tenantContext }) {
        return reference.authContext;
      },
    } as unknown as TokenService;

    const boundTenantIds: string[] = [];
    const findCalls: Array<{ table: string; input: DatabaseFindInput }> = [];
    let releases = 0;
    const manager = {
      async bindTenant(options: {
        tenantId: string;
        assertCurrentAuthoritySync: () => undefined;
        assertCurrentReadAuthority?: () => undefined;
      }) {
        boundTenantIds.push(options.tenantId);
        options.assertCurrentAuthoritySync();
        return {
          client: {
            async find(table: string, input: DatabaseFindInput) {
              options.assertCurrentReadAuthority?.();
              findCalls.push({ table, input });
              options.assertCurrentReadAuthority?.();
              return {
                value: [
                  { id: 'a', title: 'Alpha' },
                  { id: 'b', title: 'Almanac' },
                ],
                sequence: { seq: 7 },
              };
            },
          },
          released: false,
          release() {
            releases += 1;
          },
        };
      },
    } as unknown as DatabaseManager;

    app = createTestApp({
      getTokenService: () => tokenService,
      getDatabaseManager: () => manager,
      resourceRegistry: createPhysicalTenantRegistry(),
      resourceAuthConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: new Set(['isolated_docs']),
      queryableTables: new Set(['isolated_docs']),
      defaultLimit: 1,
    });

    const result = await getJson(
      '/api/data?table=isolated_docs&filter=title:contains:Al&order=id&dir=asc',
      { authorization: 'Bearer isolated-token' },
    );

    expect(result).toEqual({
      status: 200,
      body: {
        rows: [{ id: 'a', title: 'Alpha' }],
        page: {
          limit: 1,
          offset: 0,
          count: 1,
          hasMore: true,
          nextOffset: 1,
        },
      },
    });
    expect(boundTenantIds).toEqual(['tenant-a']);
    expect(findCalls).toHaveLength(1);
    expect(findCalls[0]).toEqual({
      table: 'isolated_docs',
      input: {
        filters: [{
          type: 'field',
          field: 'title',
          operator: 'contains',
          value: 'Al',
        }],
        order: [{ field: 'id', direction: 'asc' }],
        limit: 2,
        offset: 0,
      },
    });
    expect(JSON.stringify(findCalls)).not.toContain('tenant_id');
    expect(releases).toBe(1);
  });

  test('rechecks physical-tenant authority after actor read and immediately before row delivery', async () => {
    const tenantContext = {
      userId: 'isolated-user',
      email: 'isolated@example.test',
      role: 'admin',
      sessionKind: 'web' as const,
      sessionId: 'isolated-session-a',
      sessionGeneration: 0,
      sessionScopeKind: 'tenant' as const,
      sessionScopeId: 'tenant-a',
      tenantId: 'tenant-a',
      membershipId: 'isolated-membership-a',
      tenantRole: 'owner',
      tenantAuthorizationGeneration: 3,
      membershipAuthorizationGeneration: 5,
    };
    let durableContext: typeof tenantContext | null = tenantContext;
    const tokenService = {
      async resolveAuthContext(token: string) {
        return token === 'isolated-token' ? tenantContext : null;
      },
      captureAuthContextAuthority() {
        return { kind: 'test-authority' };
      },
      resolveAuthContextAuthority() {
        return durableContext;
      },
    } as unknown as TokenService;

    let releases = 0;
    const manager = {
      async bindTenant(options: {
        tenantId: string;
        assertCurrentAuthoritySync: () => undefined;
        assertCurrentReadAuthority?: () => undefined;
      }) {
        expect(options.tenantId).toBe('tenant-a');
        options.assertCurrentAuthoritySync();
        return {
          client: {
            async find() {
              options.assertCurrentReadAuthority?.();
              options.assertCurrentReadAuthority?.();
              // Model a revocation interleaved after the actor client's own
              // post-read fence but before the route's await continuation.
              queueMicrotask(() => { durableContext = null; });
              return {
                value: [{ id: 'private', title: 'Must not escape' }],
                sequence: { seq: 7 },
              };
            },
          },
          released: false,
          release() {
            releases += 1;
          },
        };
      },
    } as unknown as DatabaseManager;

    app = createTestApp({
      getTokenService: () => tokenService,
      getDatabaseManager: () => manager,
      resourceRegistry: createPhysicalTenantRegistry(),
      resourceAuthConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: new Set(['isolated_docs']),
      queryableTables: new Set(['isolated_docs']),
    });

    const result = await getJson('/api/data?table=isolated_docs', {
      authorization: 'Bearer isolated-token',
    });
    expect(result).toEqual({
      status: 403,
      body: {
        error: 'Resource authorization changed during the request',
        code: 'resource-authority-changed',
      },
    });
    expect(releases).toBe(1);
  });

  test('classifies actor 4xx before ERROR emission and logs unavailable failures locally', async () => {
    const tenantContext = {
      userId: 'isolated-user',
      email: 'isolated@example.test',
      role: 'admin',
      sessionKind: 'web' as const,
      sessionId: 'isolated-session-a',
      sessionGeneration: 0,
      sessionScopeKind: 'tenant' as const,
      sessionScopeId: 'tenant-a',
      tenantId: 'tenant-a',
      membershipId: 'isolated-membership-a',
      tenantRole: 'owner',
      tenantAuthorizationGeneration: 3,
      membershipAuthorizationGeneration: 5,
    };
    const tokenService = {
      async resolveAuthContext(token: string) {
        return token === 'isolated-token' ? tenantContext : null;
      },
      captureAuthContextAuthority(authContext: unknown) {
        return { authContext };
      },
      resolveAuthContextAuthority(reference: { authContext: typeof tenantContext }) {
        return reference.authContext;
      },
    } as unknown as TokenService;
    let releases = 0;
    let failureCode:
      | 'DATABASE_AUTHORITY_CHANGED'
      | 'DATABASE_BACKPRESSURE'
      | 'DATABASE_CAPACITY_EXHAUSTED'
      | 'DATABASE_CONFLICT'
      | 'DATABASE_PAYLOAD_INVALID' =
      'DATABASE_AUTHORITY_CHANGED';
    const events = new MemoryEventStore();
    const manager = {
      async bindTenant() {
        return {
          client: {
            async find() {
              throw new DatabaseError(
                failureCode,
                'internal actor queue details',
                failureCode === 'DATABASE_CAPACITY_EXHAUSTED'
                  ? { details: { capacityType: 'files', capacityLimit: 10_000 } }
                  : {},
              );
            },
          },
          released: false,
          release() {
            releases += 1;
          },
        };
      },
    } as unknown as DatabaseManager;
    app = createTestApp({
      getTokenService: () => tokenService,
      getDatabaseManager: () => manager,
      resourceRegistry: createPhysicalTenantRegistry(),
      resourceAuthConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: new Set(['isolated_docs']),
      queryableTables: new Set(['isolated_docs']),
      observability: {
        sink: events,
        store: events,
        config: { console: false, store: events },
      },
    });

    const rejected = await getJson('/api/data?table=isolated_docs', {
      authorization: 'Bearer isolated-token',
    });
    expect(rejected).toEqual({
      status: 403,
      body: {
        error: 'Resource authorization changed during the request',
        code: 'resource-authority-changed',
      },
    });
    expect(events.query().count).toBe(0);

    failureCode = 'DATABASE_BACKPRESSURE';
    const result = await getJson('/api/data?table=isolated_docs', {
      authorization: 'Bearer isolated-token',
    });

    expect(result).toEqual({
      status: 503,
      body: {
        error: 'Tenant database is temporarily unavailable',
        code: 'database-unavailable',
      },
    });
    expect(JSON.stringify(result.body)).not.toContain('internal actor queue details');
    expect(releases).toBe(2);
    expect(events.query().events.map((event) => event.code)).toEqual([
      OBS_CODES.DATA_QUERY_FAILED.code,
    ]);

    failureCode = 'DATABASE_PAYLOAD_INVALID';
    const invalid = await getJson('/api/data?table=isolated_docs', {
      authorization: 'Bearer isolated-token',
    });
    expect(invalid).toEqual({
      status: 400,
      body: {
        error: 'Invalid data query',
        code: 'invalid-data-query',
      },
    });
    expect(events.query().events.map((event) => event.code)).toEqual([
      OBS_CODES.DATA_QUERY_FAILED.code,
    ]);

    failureCode = 'DATABASE_CONFLICT';
    const conflict = await getJson('/api/data?table=isolated_docs', {
      authorization: 'Bearer isolated-token',
    });
    expect(conflict).toEqual({
      status: 409,
      body: {
        error: 'Data changed during the query; retry the request',
        code: 'data-query-conflict',
      },
    });
    expect(events.query().events.map((event) => event.code)).toEqual([
      OBS_CODES.DATA_QUERY_FAILED.code,
    ]);

    failureCode = 'DATABASE_CAPACITY_EXHAUSTED';
    const exhausted = await getJson('/api/data?table=isolated_docs', {
      authorization: 'Bearer isolated-token',
    });
    expect(exhausted).toEqual({
      status: 503,
      body: {
        error: 'Tenant database capacity is exhausted',
        code: 'database-capacity-exhausted',
      },
    });
    expect(releases).toBe(5);
    expect(events.query().events.map((event) => event.code)).toEqual([
      OBS_CODES.DATA_QUERY_FAILED.code,
      OBS_CODES.DATA_QUERY_FAILED.code,
    ]);
  });

  test('fails closed in multi mode when a verifier lacks durable commit authority', async () => {
    const registry = new ResourceRegistry();
    registry.register(defineResource({
      table: 'tenant_docs',
      exposure: 'http',
      actions: ['list'],
      realm: tenantRealm(),
      policy: authenticatedOnly(),
    }), {
      tables: testTables,
      authConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: ['tenant_docs'],
    });
    const tokenService = {
      async resolveAuthContext(token: string) {
        if (token !== 'legacy-multi-token') return null;
        return {
          userId: 'shared-user',
          email: 'shared@example.test',
          role: 'admin',
          sessionKind: 'web' as const,
          sessionId: 'session-without-durable-resolver',
          sessionGeneration: 0,
          sessionScopeKind: 'tenant' as const,
          sessionScopeId: 'tenant-a',
          tenantId: 'tenant-a',
          membershipId: 'membership-a',
          tenantRole: 'owner',
          tenantAuthorizationGeneration: 1,
          membershipAuthorizationGeneration: 2,
        };
      },
    } as unknown as TokenService;
    app = createTestApp({
      getTokenService: () => tokenService,
      resourceRegistry: registry,
      resourceAuthConfig: { userProperties: {} },
      tenancyMode: 'multi',
      managedTables: new Set(['tenant_docs']),
      queryableTables: new Set(['tenant_docs']),
    });
    getAppDatabase(app).insert('tenant_docs', {
      id: 'protected',
      tenant_id: 'tenant-a',
      title: 'Must not be returned',
    });

    const result = await getJson('/api/data?table=tenant_docs', {
      authorization: 'Bearer legacy-multi-token',
    });
    expect(result).toEqual({
      status: 403,
      body: {
        error: 'Resource authorization changed during the request',
        code: 'resource-authority-changed',
      },
    });
  });
});

function statementIsFinalized(
  statement: ReturnType<ReactiveDB['prepare']>,
): boolean {
  // Bun exposes this runtime flag but has not added it to Statement's type.
  return (statement as unknown as { readonly isFinalized: boolean }).isFinalized;
}
