/** Ensures createApp forwards public auth admission policy into AuthRuntime. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createApp } from './app-factory';

let rootDir = '';
let app: Awaited<ReturnType<typeof createApp>> | null = null;
let baseUrl = '';

beforeAll(async () => {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  rootDir = await mkdtemp(join(baseDir, 'test-auth-admission-app-'));
  const appDir = join(rootDir, 'app');
  await mkdir(appDir, { recursive: true });

  app = await createApp({
    db: { mode: 'memory' },
    auth: {
      bootstrap: 'public',
      accountEmails: { passwordReset: false },
      requestAdmission: {
        sourceKey: ({ request }) => request.headers.get('x-test-source'),
        login: {
          window: '10m',
          maxGlobal: 1,
          maxPerSource: 1,
          maxPerSubject: 1,
        },
      },
    },
    tables: {},
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    appDir,
    outDir: join(rootDir, 'out'),
    observability: false,
    kv: false,
  });
  app.listen(0);
  baseUrl = `http://localhost:${app.server!.port}`;
});

afterAll(async () => {
  await app?.stop();
  app = null;
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

describe('createApp auth request admission wiring', () => {
  test('honors configured flow limits instead of silently using defaults', async () => {
    const registered = await post('/auth/register', {
      username: 'admission-user',
      email: 'admission-user@example.test',
      password: 'password123',
    }, 'registration-source');
    expect(registered.status).toBe(200);

    const firstLogin = await post('/auth/login', {
      username: 'admission-user',
      password: 'password123',
    }, 'same-login-source');
    expect(firstLogin.status).toBe(200);

    const limited = await post('/auth/login', {
      username: 'admission-user',
      password: 'password123',
    }, 'same-login-source');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'AUTH_RATE_LIMITED' });
  });
});

async function post(path: string, body: object, source: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-source': source,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null) as Record<string, unknown> | null,
  };
}
