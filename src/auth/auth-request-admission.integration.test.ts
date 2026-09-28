import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { createAuthPlugin } from './auth.plugin';

const BOOTSTRAP_SECRET = 'request-admission-bootstrap-secret-32-characters';
let app: any;
let db: ReactiveDB;
let baseUrl: string;

beforeAll(() => {
  db = createReactiveDB({ mode: 'memory' });
  app = new Elysia().use(createAuthPlugin({
    db,
    bootstrap: { mode: 'secret', secret: BOOTSTRAP_SECRET },
    accountEmails: { passwordReset: false },
    requestAdmission: {
      sourceKey: ({ request }) => request.headers.get('x-test-source'),
      bootstrap: {
        window: '10m', maxGlobal: 50, maxPerSource: 2, maxPerSubject: 20,
      },
      registration: {
        window: '10m', maxGlobal: 50, maxPerSource: 2, maxPerSubject: 20,
      },
      login: {
        window: '10m', maxGlobal: 50, maxPerSource: 2, maxPerSubject: 20,
      },
    },
  }));
  app.listen(0);
  baseUrl = `http://localhost:${app.server!.port}`;
});

afterAll(async () => {
  await app.stop();
  db.dispose();
});

describe('public auth route admission', () => {
  test('limits bootstrap attempts before allowing a different source to initialize', async () => {
    for (let index = 0; index < 2; index += 1) {
      const rejected = await post('/auth/register', registration(`wrong-${index}`, {
        bootstrapSecret: 'x'.repeat(32),
      }), 'bootstrap-attacker');
      expect(rejected.status).toBe(403);
    }
    const limited = await post('/auth/register', registration('wrong-limited', {
      bootstrapSecret: 'x'.repeat(32),
    }), 'bootstrap-attacker');
    expect(limited).toMatchObject({
      status: 429,
      body: { code: 'AUTH_RATE_LIMITED' },
    });

    const initialized = await post('/auth/register', registration('admin', {
      bootstrapSecret: BOOTSTRAP_SECRET,
    }), 'bootstrap-operator');
    expect(initialized.status).toBe(200);
  });

  test('separately limits ordinary registration and password-login attempts', async () => {
    expect((await post(
      '/auth/register', registration('member-one'), 'registration-source',
    )).status).toBe(200);
    expect((await post(
      '/auth/register', registration('member-two'), 'registration-source',
    )).status).toBe(200);
    expect(await post(
      '/auth/register', registration('member-three'), 'registration-source',
    )).toMatchObject({ status: 429, body: { code: 'AUTH_RATE_LIMITED' } });

    for (let index = 0; index < 2; index += 1) {
      expect((await post('/auth/login', {
        username: 'member-one', password: 'wrong-password',
      }, 'login-attacker')).status).toBe(401);
    }
    expect(await post('/auth/login', {
      username: 'member-one', password: 'wrong-password',
    }, 'login-attacker')).toMatchObject({
      status: 429,
      body: { code: 'AUTH_RATE_LIMITED' },
    });
    expect((await post('/auth/login', {
      username: 'member-one', password: 'password123',
    }, 'member-device')).status).toBe(200);
  });
});

function registration(
  username: string,
  extra: Record<string, unknown> = {},
) {
  return {
    username,
    email: `${username}@example.test`,
    password: 'password123',
    ...extra,
  };
}

async function post(path: string, body: object, source: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-source': source,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null) as Record<string, unknown> | null,
  };
}
