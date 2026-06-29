/**
 * data-query.plugin.test.ts
 *
 * Exercises the lazy-table HTTP query endpoint through Elysia lifecycle tests.
 * These tests verify query validation, pagination behavior, and sync read
 * policy enforcement without coupling the data-query plugin to UI hooks.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { TokenService } from '../auth/token-service';
import type { UserStore } from '../auth/user-store';
import {
  adminOnly,
  anyOf,
  defineResource,
  metadataPolicy,
  ownerPolicy,
  readOnly,
  ResourceRegistry,
  type ResourcePolicyAuthConfig,
} from '../resources';
import type { TableSchema } from './types';
import { createDataQueryPlugin } from './data-query.plugin';
import { createSyncPlugin, getSyncDB } from './sync.plugin';
import type { SyncPolicy } from './sync-policy';

interface TestApp {
  handle(request: Request): Promise<Response>;
  stop(): unknown;
}

let app: TestApp | null = null;

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
} satisfies Record<string, TableSchema>;

const tableColumns = new Map([
  ['items', ['id', 'category', 'title', 'priority']],
  ['admin_items', ['id', 'title']],
  ['owned_items', ['id', 'title', 'owner_id', 'priority']],
  ['reports', ['id', 'title', 'department']],
  ['blocked_items', ['id', 'title']],
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
          properties: { department: 'support' },
        },
        'user-1': {
          userId: 'user-1',
          email: 'user@test.local',
          role: 'user',
          status: 'active',
          passwordChangeRequired: false,
          properties: { department: 'support' },
        },
        'user-2': {
          userId: 'user-2',
          email: 'sales@test.local',
          role: 'user',
          status: 'active',
          passwordChangeRequired: false,
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
  resourceRegistry?: ResourceRegistry;
  resourceAuthConfig?: ResourcePolicyAuthConfig;
  defaultLimit?: number;
  maxLimit?: number;
} = {}): TestApp {
  return new Elysia()
    .use(
      createSyncPlugin({
        db: { mode: 'memory' },
        tables: testTables,
      })
    )
    .use(
      createDataQueryPlugin({
        queryableTables: new Set(tableColumns.keys()),
        tableColumns,
        policy: options.policy,
        getTokenService: options.getTokenService,
        getUserStore: options.getUserStore,
        resourceRegistry: options.resourceRegistry,
        resourceAuthConfig: options.resourceAuthConfig,
        defaultLimit: options.defaultLimit,
        maxLimit: options.maxLimit,
      })
    )
    .listen(0);
}

function seedItems(): void {
  const db = getSyncDB();
  expect(db).not.toBeNull();

  db!.insert('items', { id: 'i1', category: 'a', title: 'Alpha', priority: 1 });
  db!.insert('items', { id: 'i2', category: 'a', title: 'Beta', priority: 2 });
  db!.insert('items', { id: 'i3', category: 'a', title: 'Gamma', priority: 3 });
  db!.insert('items', { id: 'i4', category: 'b', title: 'Delta', priority: 4 });
  db!.insert('admin_items', { id: 'admin-1', title: 'Admin only' });
}

function seedResourceRows(): void {
  const db = getSyncDB();
  expect(db).not.toBeNull();

  db!.insert('owned_items', { id: 'o1', title: 'Mine', owner_id: 'user-1', priority: 1 });
  db!.insert('owned_items', { id: 'o2', title: 'Theirs', owner_id: 'user-2', priority: 2 });
  db!.insert('reports', { id: 'r1', title: 'Support', department: 'support' });
  db!.insert('blocked_items', { id: 'b1', title: 'Blocked' });
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
  test('supports equality filters, sort direction, offset pagination, and page metadata', async () => {
    app = createTestApp();
    seedItems();

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
    seedItems();

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
    seedItems();

    const capped = await getJson('/api/data?table=items&order=priority&dir=asc&limit=99');
    expect(capped.status).toBe(200);
    expect(capped.body.rows).toHaveLength(2);
    expect(capped.body.page.limit).toBe(2);
    expect(capped.body.page.hasMore).toBe(true);

    const invalid = await getJson('/api/data?table=items&filter=missing:value');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("Unknown column 'missing' for table 'items'");
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
    seedItems();

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

  test('applies registered owner resource policy constraints', async () => {
    const tokenService = createTokenService();
    const authConfig = createResourceAuthConfig();
    app = createTestApp({
      getTokenService: () => tokenService,
      resourceRegistry: createResourceRegistry(authConfig),
      resourceAuthConfig: authConfig,
    });
    seedResourceRows();

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
    seedResourceRows();

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

  test('fails closed when registered resource has no list action', async () => {
    const authConfig = createResourceAuthConfig();
    app = createTestApp({
      resourceRegistry: createResourceRegistry(authConfig),
      resourceAuthConfig: authConfig,
    });
    seedResourceRows();

    const result = await getJson('/api/data?table=blocked_items');
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('resource-list-not-allowed');
  });
});
