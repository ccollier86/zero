/** Adversarial coverage for the one-time installation bootstrap ceremony. */

import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createAuthMiddleware } from './auth.middleware';
import { createAuthPlugin, getAuthStore, getTokenService } from './auth.plugin';
import type { AuthBehaviorConfig } from './types';

const BOOTSTRAP_SECRET = 'correct-bootstrap-secret-with-more-than-32-characters';
const WRONG_SECRET = 'incorrect-bootstrap-secret-more-than-32-characters';

let active: { app: any; db: ReactiveDB; url: string } | null = null;

afterEach(async () => {
  if (!active) return;
  await active.app.stop();
  active.db.dispose();
  active = null;
});

async function start(config: AuthBehaviorConfig = {}) {
  const db = createReactiveDB({ mode: 'memory' });
  const app = new Elysia()
    .use(createAuthPlugin({ db, ...config }))
    .use(createAuthMiddleware(getTokenService));
  app.listen(0);
  active = { app, db, url: `http://localhost:${app.server!.port}` };
  return active;
}

async function json(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  accessToken?: string
) {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${active!.url}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}

function registration(index: number, bootstrapSecret?: string) {
  return {
    username: `bootstrap-${index}`,
    email: `bootstrap-${index}@example.test`,
    password: 'password123',
    ...(bootstrapSecret === undefined ? {} : { bootstrapSecret }),
  };
}

describe('installation bootstrap security', () => {
  test('default config stays closed and reports an operable but unavailable secret ceremony', async () => {
    await start();

    const config = await json('GET', '/auth/config');
    expect(config.status).toBe(200);
    expect(config.body.bootstrap).toEqual({
      required: true,
      mode: 'secret',
      available: false,
      secretRequired: true,
    });
    expect(config.body.registration).toMatchObject({
      mode: 'public',
      bootstrapRequired: true,
      registrationEnabled: false,
      publicRegistrationEnabled: false,
    });

    const rejected = await json('POST', '/auth/register', registration(0));
    expect(rejected.status).toBe(403);
    expect(rejected.body.code).toBe('BOOTSTRAP_UNAVAILABLE');
    expect(getAuthStore()!.countUsers()).toBe(0);
  });

  test('configured secret rejects missing/wrong values, succeeds once, and never leaks', async () => {
    await start({
      bootstrap: { mode: 'secret', secret: BOOTSTRAP_SECRET },
      registration: { mode: 'public' },
    });

    const publicConfig = await json('GET', '/auth/config');
    expect(publicConfig.body.bootstrap).toEqual({
      required: true,
      mode: 'secret',
      available: true,
      secretRequired: true,
    });
    expect(JSON.stringify(publicConfig.body)).not.toContain(BOOTSTRAP_SECRET);

    const missing = await json('POST', '/auth/register', registration(0));
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe('BOOTSTRAP_AUTHORIZATION_FAILED');

    const wrong = await json('POST', '/auth/register', registration(1, WRONG_SECRET));
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('BOOTSTRAP_AUTHORIZATION_FAILED');
    expect(getAuthStore()!.countUsers()).toBe(0);

    const created = await json('POST', '/auth/register', registration(2, BOOTSTRAP_SECRET));
    expect(created.status).toBe(200);
    expect(created.body.user.role).toBe('admin');
    expect(getAuthStore()!.getConfig('auth.bootstrap.completed')).toBe('1');

    const adminConfig = await json(
      'GET',
      '/auth/admin/config',
      undefined,
      created.body.accessToken
    );
    expect(adminConfig.status).toBe(200);
    expect(JSON.stringify(adminConfig.body)).not.toContain(BOOTSTRAP_SECRET);
    expect(adminConfig.body.bootstrap.required).toBe(false);

    const staleSecret = await json(
      'POST',
      '/auth/register',
      registration(3, BOOTSTRAP_SECRET)
    );
    expect(staleSecret.status).toBe(400);
    expect(staleSecret.body.code).toBe('BOOTSTRAP_NOT_REQUIRED');
    expect(getAuthStore()!.countUsers()).toBe(1);
  });

  test('projects only public-safe API-key capability settings', async () => {
    await start({
      apiKeys: {
        enabled: true,
        selfService: true,
        administratorIssuance: true,
        eligibleScopeRoles: ['owner'],
        defaultTTL: '12h',
        maxTTL: '30d',
        maxActivePerUser: 7,
      },
    });

    const publicConfig = await json('GET', '/auth/config');
    expect(publicConfig.status).toBe(200);
    expect(publicConfig.body.apiKeys).toEqual({
      enabled: true,
      selfService: true,
      administratorIssuance: true,
      defaultTTL: '12h',
      maxTTL: '30d',
      maxActivePerUser: 7,
    });
    expect(publicConfig.body.apiKeys).not.toHaveProperty('eligibleScopeRoles');
    expect(publicConfig.body.apiKeys).not.toHaveProperty('defaultTTLms');
    expect(publicConfig.body.apiKeys).not.toHaveProperty('maxTTLms');
  });

  test('concurrent correct, wrong, and missing attempts elect exactly one admin', async () => {
    await start({
      bootstrap: { mode: 'secret', secret: BOOTSTRAP_SECRET },
      registration: { mode: 'admin-only' },
    });

    const secrets = [
      WRONG_SECRET,
      undefined,
      BOOTSTRAP_SECRET,
      WRONG_SECRET,
      BOOTSTRAP_SECRET,
      undefined,
      BOOTSTRAP_SECRET,
    ];
    const results = await Promise.all(secrets.map((secret, index) =>
      json('POST', '/auth/register', registration(index, secret))
    ));

    const admitted = results.filter(({ status }) => status === 200);
    expect(admitted).toHaveLength(1);
    expect(admitted[0]!.body.user.role).toBe('admin');
    expect(results.filter(({ status }) => status >= 400)).toHaveLength(6);
    expect(getAuthStore()!.countUsers()).toBe(1);
    expect(getAuthStore()!.countUsersByRole('admin')).toBe(1);
  });

  test('explicit public mode preserves legacy bootstrap while disabled mode stays closed', async () => {
    await start({ bootstrap: 'public', registration: { mode: 'public' } });
    const publicCreated = await json('POST', '/auth/register', registration(0));
    expect(publicCreated.status).toBe(200);
    expect(publicCreated.body.user.role).toBe('admin');
    await active!.app.stop();
    active!.db.dispose();
    active = null;

    await start({ bootstrap: 'disabled', registration: { mode: 'public' } });
    const disabled = await json(
      'POST',
      '/auth/register',
      registration(1, BOOTSTRAP_SECRET)
    );
    expect(disabled.status).toBe(403);
    expect(disabled.body.code).toBe('BOOTSTRAP_UNAVAILABLE');
    expect(getAuthStore()!.countUsers()).toBe(0);
  });

  test('durable completion marker prevents user deletion from reopening bootstrap', async () => {
    await start({
      bootstrap: { mode: 'secret', secret: BOOTSTRAP_SECRET },
      registration: { mode: 'admin-only' },
    });
    const created = await json(
      'POST',
      '/auth/register',
      registration(0, BOOTSTRAP_SECRET)
    );
    expect(created.status).toBe(200);

    expect(getAuthStore()!.deleteUser(created.body.user.userId)).toBe(true);
    expect(getAuthStore()!.countUsers()).toBe(0);
    expect(getAuthStore()!.isBootstrapRequired()).toBe(false);

    const config = await json('GET', '/auth/config');
    expect(config.body.bootstrap.required).toBe(false);
    const replay = await json(
      'POST',
      '/auth/register',
      registration(1, BOOTSTRAP_SECRET)
    );
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('BOOTSTRAP_NOT_REQUIRED');
    expect(getAuthStore()!.countUsers()).toBe(0);
  });
});
