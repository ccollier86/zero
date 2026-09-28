import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';
import { migrations, Migrator } from '../migrations';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';

interface Harness {
  app: AnyElysia;
  db: ReactiveDB;
  rawDb: Database;
  runtime: AuthRuntime;
  url: string;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop();
    harness.db.dispose();
    harness.rawDb.close();
  }
});

describe('migrated public tenant-onboarding admission boundary', () => {
  test('admits invitation, join-request, and domain work on a 001-022 database', async () => {
    const harness = await start('multi');
    expect(appliedMigration(harness.rawDb, '022')).toBe(true);

    expect(await post(harness, '/auth/invitations/inspect', {
      token: `zinv_${'A'.repeat(50)}`,
    })).toMatchObject({
      status: 200,
      body: { available: false },
    });

    expect(await post(harness, '/auth/tenant-join-requests', {
      tenantSlug: 'missing-tenant',
    })).toMatchObject({
      status: 401,
    });

    expect(await post(harness, '/auth/onboarding/domain/start', {})).toMatchObject({
      status: 200,
      body: { accepted: true },
    });

    expect(harness.db.prepare(`SELECT flow, COUNT(*) AS count
      FROM _auth_request_admissions GROUP BY flow ORDER BY flow`).all()).toEqual([
      { flow: 'domain-onboarding', count: 1 },
      { flow: 'invitation', count: 1 },
      { flow: 'join-request', count: 1 },
    ]);
  });

  test('conceals tenant-only onboarding routes in single mode before admission', async () => {
    const harness = await start('single');
    const requests = [
      ['/auth/invitations/inspect', { token: `zinv_${'B'.repeat(50)}` }],
      ['/auth/tenant-join-requests', { tenantSlug: 'missing-tenant' }],
      ['/auth/onboarding/domain/start', {}],
    ] as const;

    for (const [path, body] of requests) {
      expect(await post(harness, path, body)).toMatchObject({
        status: 404,
        body: { code: 'AUTH_ROUTE_NOT_FOUND' },
      });
    }

    expect(harness.db.prepare(`SELECT COUNT(*) AS count
      FROM _auth_request_admissions`).get()).toEqual({ count: 0 });
  });
});

async function start(mode: 'single' | 'multi'): Promise<Harness> {
  const rawDb = new Database(':memory:');
  const migrator = new Migrator({
    database: rawDb,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });
  migrator.run();
  migrator.dispose();

  const db = createReactiveDB({ database: rawDb });
  let runtime: AuthRuntime | null = null;
  const app = new Elysia().use(createAuthPlugin({
    db,
    tenancy: mode,
    requestAdmission: {
      enabled: true,
      sourceKey: () => 'integration-source',
    },
    onRuntimeCreated(created) {
      runtime = created;
    },
  }));
  app.listen(0);
  const createdRuntime = runtime as AuthRuntime | null;
  if (!createdRuntime) throw new Error('Auth runtime was not created');
  const harness: Harness = {
    app,
    db,
    rawDb,
    runtime: createdRuntime,
    url: `http://localhost:${app.server!.port}`,
  };
  active.push(harness);
  await waitFor(() => Boolean(createdRuntime.getStore()));
  return harness;
}

async function post(
  harness: Harness,
  path: string,
  body: Readonly<Record<string, unknown>>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function appliedMigration(db: Database, version: string): boolean {
  return Boolean(db.query(`SELECT 1 FROM _migrations
    WHERE version = ? LIMIT 1`).get(version));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for auth runtime');
    await Bun.sleep(5);
  }
}
