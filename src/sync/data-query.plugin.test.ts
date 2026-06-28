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
import { createDataQueryPlugin } from './data-query.plugin';
import { createSyncPlugin, getSyncDB } from './sync.plugin';
import type { SyncPolicy } from './sync-policy';

interface TestApp {
  handle(request: Request): Promise<Response>;
  stop(): unknown;
}

let app: TestApp | null = null;

function createTokenService(): TokenService {
  return {
    async verifyAccessToken(token: string) {
      if (token === 'admin-token') {
        return { sub: 'admin-1', email: 'admin@test.local', role: 'admin' };
      }
      if (token === 'user-token') {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      }
      return null;
    },
  } as unknown as TokenService;
}

function createTestApp(options: {
  policy?: SyncPolicy;
  getTokenService?: () => TokenService | null;
  defaultLimit?: number;
  maxLimit?: number;
} = {}): TestApp {
  return new Elysia()
    .use(
      createSyncPlugin({
        db: { mode: 'memory' },
        tables: {
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
        },
      })
    )
    .use(
      createDataQueryPlugin({
        queryableTables: new Set(['items', 'admin_items']),
        tableColumns: new Map([
          ['items', ['id', 'category', 'title', 'priority']],
          ['admin_items', ['id', 'title']],
        ]),
        policy: options.policy,
        getTokenService: options.getTokenService,
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
});
