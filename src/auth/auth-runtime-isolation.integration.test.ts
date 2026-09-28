import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { EmailService } from '../email/email-service';
import { MemoryEmailProvider } from '../email/memory-email-provider';
import type { EmailRuntime } from '../email/types';
import { ZERO_RUNTIME_AMBIGUOUS } from '../runtime/compatibility-provider-registry';
import {
  ZERO_AUTH_STORE,
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTH_SESSION_SERVICE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_EMAIL_RUNTIME,
  ZERO_PLATFORM_TOKEN_SERVICE,
} from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { PlatformTokenService } from '../tokens/token-service';
import {
  definePlatformTokenTables,
  PlatformTokenStore,
} from '../tokens/token-store';
import {
  createAuthPlugin,
  getAuthorizationKernel,
  getAuthStore,
} from './auth.plugin';

interface RunningAuthApp {
  app: any;
  db: ReactiveDB;
  runtime: ZeroAppRuntime;
  email: MemoryEmailProvider;
  url: string;
}

const running: RunningAuthApp[] = [];

afterEach(async () => {
  for (const instance of running.splice(0).reverse()) {
    await instance.runtime.dispose();
    await instance.app.stop();
    instance.db.dispose();
  }
});

describe('Auth plugin runtime isolation', () => {
  test('keeps two live apps isolated and safely restores legacy getter fallback', async () => {
    const appA = await startAuthApp('auth-a');
    const appB = await startAuthApp('auth-b');

    const storeA = appA.runtime.require(ZERO_AUTH_STORE);
    const storeB = appB.runtime.require(ZERO_AUTH_STORE);
    const tokensA = appA.runtime.require(ZERO_AUTH_TOKEN_SERVICE);
    const tokensB = appB.runtime.require(ZERO_AUTH_TOKEN_SERVICE);
    const sessionsA = appA.runtime.require(ZERO_AUTH_SESSION_SERVICE);
    const sessionsB = appB.runtime.require(ZERO_AUTH_SESSION_SERVICE);
    const authorizationA = appA.runtime.require(ZERO_AUTHORIZATION_KERNEL);
    const authorizationB = appB.runtime.require(ZERO_AUTHORIZATION_KERNEL);
    expect(storeA).not.toBe(storeB);
    expect(tokensA).not.toBe(tokensB);
    expect(sessionsA).not.toBe(sessionsB);
    expect(authorizationA).not.toBe(authorizationB);

    expect(() => getAuthStore()).toThrow(expect.objectContaining({
      code: ZERO_RUNTIME_AMBIGUOUS,
    }));
    expect(() => getAuthorizationKernel()).toThrow(expect.objectContaining({
      code: ZERO_RUNTIME_AMBIGUOUS,
    }));

    const adminA = await register(appA, 'admin-a');
    expect(adminA.status).toBe(200);
    expect(adminA.body.user.role).toBe('admin');

    const configA = await request(appA, 'GET', '/auth/config');
    const configBBefore = await request(appB, 'GET', '/auth/config');
    expect(configA.body.bootstrap.required).toBe(false);
    expect(configBBefore.body.bootstrap.required).toBe(true);
    expect(storeA.countUsers()).toBe(1);
    expect(storeB.countUsers()).toBe(0);

    const adminB = await register(appB, 'admin-b');
    expect(adminB.status).toBe(200);
    expect(adminB.body.user.role).toBe('admin');

    const userA = await register(appA, 'user-a');
    expect(userA.status).toBe(200);
    expect(userA.body.user.emailVerificationRequired).toBe(true);
    expect(appA.email.messages).toHaveLength(1);
    expect(appB.email.messages).toHaveLength(0);
    expect(platformActionTokenCount(appA.db)).toBe(1);
    expect(platformActionTokenCount(appB.db)).toBe(0);

    const userB = await register(appB, 'user-b');
    expect(userB.status).toBe(200);
    expect(userB.body.user.emailVerificationRequired).toBe(true);
    expect(appA.email.messages).toHaveLength(1);
    expect(appB.email.messages).toHaveLength(1);
    expect(platformActionTokenCount(appA.db)).toBe(1);
    expect(platformActionTokenCount(appB.db)).toBe(1);
    expect(appA.email.messages[0]!.message.to).toBe('user-a@example.test');
    expect(appB.email.messages[0]!.message.to).toBe('user-b@example.test');

    const pairA = await tokensA.issueTokenPair(storeA.getUserByUsername('admin-a')!);
    const ownSession = await request(appA, 'GET', '/auth/me', undefined, pairA.accessToken);
    const crossedSession = await request(appB, 'GET', '/auth/me', undefined, pairA.accessToken);
    expect(ownSession.status).toBe(200);
    expect(ownSession.body.username).toBe('admin-a');
    expect(crossedSession.status).toBe(401);

    await appB.runtime.dispose();
    await appB.app.stop();
    running.splice(running.indexOf(appB), 1);
    appB.db.dispose();

    expect(appB.runtime.get(ZERO_AUTH_STORE)).toBeNull();
    expect(appB.runtime.get(ZERO_AUTH_TOKEN_SERVICE)).toBeNull();
    expect(appB.runtime.get(ZERO_AUTH_SESSION_SERVICE)).toBeNull();
    expect(appB.runtime.get(ZERO_AUTHORIZATION_KERNEL)).toBeNull();
    expect(getAuthStore()).toBe(storeA);
    expect(getAuthorizationKernel()).toBe(authorizationA);
    expect(appA.runtime.get(ZERO_AUTH_STORE)).toBe(storeA);

    const stillLive = await request(appA, 'GET', '/auth/me', undefined, pairA.accessToken);
    expect(stillLive.status).toBe(200);
    expect(stillLive.body.username).toBe('admin-a');
  });
});

async function startAuthApp(id: string): Promise<RunningAuthApp> {
  const db = createReactiveDB({ mode: 'memory' });
  definePlatformTokenTables(db);
  const platformTokens = new PlatformTokenService(new PlatformTokenStore(db));
  const email = new MemoryEmailProvider();
  const emailRuntime: EmailRuntime = {
    enabled: true,
    app: {
      name: id,
      publicUrl: `https://${id}.example.test`,
    },
    config: {
      provider: email,
      from: `${id}@example.test`,
    },
    provider: email,
    service: new EmailService(email, { from: `${id}@example.test` }),
  };
  const runtime = new ZeroAppRuntime(id);
  runtime.set(ZERO_EMAIL_RUNTIME, emailRuntime);
  runtime.set(ZERO_PLATFORM_TOKEN_SERVICE, platformTokens);

  const app = new Elysia({ name: id }).use(createAuthPlugin({
    db,
    runtime,
    bootstrap: 'public',
    registration: { mode: 'public' },
    account: { requireEmailVerification: true },
  }));
  app.listen(0);
  const instance = {
    app,
    db,
    runtime,
    email,
    url: `http://localhost:${app.server!.port}`,
  };
  running.push(instance);
  await waitForAuthRuntime(runtime);
  return instance;
}

function register(app: RunningAuthApp, username: string) {
  return request(app, 'POST', '/auth/register', {
    username,
    email: `${username}@example.test`,
    password: 'password123',
  });
}

async function request(
  app: RunningAuthApp,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  accessToken?: string,
) {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${app.url}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}

function platformActionTokenCount(db: ReactiveDB): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS count FROM _zero_action_tokens',
  ).get() as { count: number };
  return row.count;
}

async function waitForAuthRuntime(runtime: ZeroAppRuntime): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!runtime.get(ZERO_AUTH_STORE) || !runtime.get(ZERO_AUTH_TOKEN_SERVICE)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Auth runtime startup');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
