import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { databaseActorFixtureRealm } from '../../databases/test-fixtures/database-actor-realm';
import {
  clearPlatformSQLiteService,
  createPlatformSQLiteService,
  getPlatformSQLiteService,
} from '../../persistence';
import {
  allOf,
  authorizationPolicy,
  customPolicy,
  defineResource,
  tenantRealm,
} from '../../resources';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createApp } from './app-factory';

const DATABASE_ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../../databases/test-fixtures/database-actor-same-entry.ts',
  import.meta.url,
));

const TODOS_PERMISSION = 'todos:manage';
const TEST_PASSWORD = 'password123';

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

interface Registration {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: {
    readonly userId: string;
    readonly email: string;
  };
  readonly tenant: {
    readonly tenantId: string;
    readonly membershipId: string;
  };
}

interface IssuedApiKey {
  readonly secret: string;
  readonly apiKey: {
    readonly keyId: string;
    readonly userId: string;
    readonly tenantId: string;
    readonly membershipId: string;
    readonly scopeKind: 'tenant';
    readonly status: 'active';
  };
}

interface JsonResponse {
  readonly status: number;
  readonly body: Record<string, any>;
}

let activeApp: ManagedApp | null = null;
let activeRoot: string | null = null;

afterEach(async () => {
  await activeApp?.stop(true);
  activeApp = null;

  const sqlite = getPlatformSQLiteService();
  sqlite?.close();
  clearPlatformSQLiteService(sqlite);

  if (activeRoot) await rm(activeRoot, { recursive: true, force: true });
  activeRoot = null;
}, 30_000);

describe('Guardian and Fabric integration', () => {
  test('binds live tenant API-key authority to isolated actor databases', async () => {
    const updateBarrier = createUpdateBarrier();
    const zeroDir = join(process.cwd(), '.zero');
    await mkdir(zeroDir, { recursive: true });
    activeRoot = await mkdtemp(join(zeroDir, 'guardian-fabric-'));
    const appDir = join(activeRoot, 'app');
    await mkdir(appDir, { recursive: true });

    const apiKeyAccess = authorizationPolicy({
      user: 'required',
      tenant: 'required',
      credentials: ['session', 'api-key'],
      permission: TODOS_PERMISSION,
    });
    const sessionOnlyAccess = authorizationPolicy({
      user: 'required',
      tenant: 'required',
      credentials: ['session'],
      permission: TODOS_PERMISSION,
    });
    activeApp = await createApp({
      db: {
        sqlite: createPlatformSQLiteService({ mode: 'memory' }),
        ringBufferDepth: 500,
      },
      tables: {
        todos: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      resources: [defineResource({
        table: 'todos',
        exposure: 'http',
        realm: tenantRealm(),
        policy: {
          list: apiKeyAccess,
          get: apiKeyAccess,
          create: apiKeyAccess,
          update: allOf(apiKeyAccess, updateBarrier.policy),
          delete: sessionOnlyAccess,
        },
      })],
      auth: {
        tenancy: 'multi',
        bootstrap: 'public',
        registration: { mode: 'public' },
        authorization: {
          mode: 'advanced',
          permissions: {
            [TODOS_PERMISSION]: { label: 'Manage todos' },
          },
        },
        apiKeys: {
          enabled: true,
          selfService: true,
          administratorIssuance: true,
          eligibleScopeRoles: ['owner'],
        },
      },
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: join(activeRoot, 'tenant-databases'),
        realm: databaseActorFixtureRealm,
        actors: {
          launch: {
            kind: 'source',
            entrypoint: DATABASE_ACTOR_ENTRYPOINT,
          },
        },
        tenantIsolation: 'tenant-database',
      },
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      appDir,
      outDir: join(activeRoot, 'out'),
      generatedDir: join(activeRoot, '.zero', 'generated'),
      observability: { console: false, endpoint: false },
      email: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
    });

    const defaultDatabase = installDefaultDatabaseProbe(activeApp);
    activeApp.listen(0);
    const baseUrl = `http://localhost:${activeApp.server!.port}`;
    const controlDB = await defaultDatabase.resolve(baseUrl);

    // Public bootstrap creates the platform-administration tenant. The next
    // two registrations are ordinary customer organizations and therefore
    // valid tenant API-key subjects.
    await register(baseUrl, 'platform', 'Platform Administration');
    const tenantA = await register(baseUrl, 'tenant-a', 'Tenant A');
    const tenantB = await register(baseUrl, 'tenant-b', 'Tenant B');
    expect(tenantA.tenant.tenantId).not.toBe(tenantB.tenant.tenantId);

    const keyA = await issueApiKey(baseUrl, tenantA, 'Tenant A automation');
    const keyB = await issueApiKey(baseUrl, tenantB, 'Tenant B automation');
    expect(keyA.apiKey).toMatchObject({
      userId: tenantA.user.userId,
      tenantId: tenantA.tenant.tenantId,
      membershipId: tenantA.tenant.membershipId,
      scopeKind: 'tenant',
      status: 'active',
    });
    expect(keyB.apiKey.tenantId).toBe(tenantB.tenant.tenantId);

    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/todos',
      keyA.secret,
      { id: 'same-id', title: 'Tenant A value' },
      { 'Idempotency-Key': 'tenant-a-same-id' },
    )).toEqual({
      status: 201,
      body: { row: { id: 'same-id', title: 'Tenant A value' } },
    });
    expect(await resourceRequest(
      baseUrl,
      'POST',
      '/api/resources/todos',
      keyB.secret,
      { id: 'same-id', title: 'Tenant B value' },
      { 'Idempotency-Key': 'tenant-b-same-id' },
    )).toEqual({
      status: 201,
      body: { row: { id: 'same-id', title: 'Tenant B value' } },
    });

    // The caller cannot select another tenant through headers or query input;
    // physical routing comes only from the live credential binding.
    expect(await resourceRequest(
      baseUrl,
      'GET',
      `/api/resources/todos/same-id?tenantId=${tenantB.tenant.tenantId}`,
      keyA.secret,
      undefined,
      {
        'X-Tenant-Id': tenantB.tenant.tenantId,
        'X-Zero-Tenant-Id': tenantB.tenant.tenantId,
      },
    )).toEqual({
      status: 200,
      body: { row: { id: 'same-id', title: 'Tenant A value' } },
    });
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      keyB.secret,
    )).toEqual({
      status: 200,
      body: { row: { id: 'same-id', title: 'Tenant B value' } },
    });

    // Fabric never materializes the physical resource table in Guardian's
    // pinned default/control database.
    expect(controlDB.hasTable('todos')).toBe(false);
    expect(controlDB.hasTable('users')).toBe(true);

    const sessionOnlyDenial = await resourceRequest(
      baseUrl,
      'DELETE',
      '/api/resources/todos/same-id',
      keyA.secret,
      undefined,
      { 'Idempotency-Key': 'api-key-delete-denied' },
    );
    expect(sessionOnlyDenial).toEqual({
      status: 403,
      body: { error: 'Forbidden', code: 'FORBIDDEN' },
    });
    expect((await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      keyA.secret,
    )).body.row.title).toBe('Tenant A value');

    const pendingUpdate = resourceRequest(
      baseUrl,
      'PATCH',
      '/api/resources/todos/same-id',
      keyA.secret,
      { title: 'Must not commit' },
      { 'Idempotency-Key': 'revoked-in-flight-update' },
    );
    await updateBarrier.waitUntilEntered(pendingUpdate);

    let revoked: JsonResponse;
    try {
      revoked = await jsonRequest(
        baseUrl,
        'DELETE',
        `/auth/api-keys/${keyA.apiKey.keyId}`,
        tenantA.accessToken,
      );
    } finally {
      // A failed management request must not leave the actor test process
      // waiting on the policy barrier during test cleanup.
      updateBarrier.release();
    }
    expect(revoked).toMatchObject({
      status: 200,
      body: { status: 'revoked' },
    });

    expect(await pendingUpdate).toEqual({
      status: 403,
      body: {
        error: 'Resource authorization changed during the request',
        code: 'resource-authority-changed',
      },
    });
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      tenantA.accessToken,
    )).toEqual({
      status: 200,
      body: { row: { id: 'same-id', title: 'Tenant A value' } },
    });
    expect(await resourceRequest(
      baseUrl,
      'GET',
      '/api/resources/todos/same-id',
      keyA.secret,
    )).toEqual({
      status: 401,
      body: { error: 'Unauthorized', code: 'UNAUTHORIZED' },
    });
  }, 60_000);
});

function installDefaultDatabaseProbe(app: ManagedApp): {
  resolve(baseUrl: string): Promise<ReactiveDB>;
} {
  const path = `/__zero_test/default-database-${crypto.randomUUID()}`;
  let captured: ReactiveDB | null = null;
  app.get(path, (context) => {
    captured = (context as unknown as { syncDB?: ReactiveDB }).syncDB ?? null;
    return { ready: captured !== null };
  });
  return {
    async resolve(baseUrl) {
      for (let attempt = 0; attempt < 100; attempt++) {
        await fetch(`${baseUrl}${path}`);
        if (captured) return captured;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error('Timed out waiting for the default database');
    },
  };
}

function createUpdateBarrier(): {
  readonly policy: ReturnType<typeof customPolicy>;
  waitUntilEntered(pending: Promise<JsonResponse>): Promise<void>;
  release(): void;
} {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const policy = customPolicy(async () => {
    markEntered();
    await released;
    return true;
  }, { name: 'guardian-api-key-revocation-race' });

  return {
    policy,
    async waitUntilEntered(pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          entered,
          pending.then((response) => {
            throw new Error(
              `Resource request completed before the policy barrier: ${JSON.stringify(response)}`,
            );
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Timed out waiting for the Resource policy barrier')),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    release,
  };
}

async function register(
  baseUrl: string,
  label: string,
  organizationName: string,
): Promise<Registration> {
  const suffix = crypto.randomUUID();
  const response = await jsonRequest(baseUrl, 'POST', '/auth/register', undefined, {
    username: `${label}-${suffix}`,
    email: `${label}-${suffix}@example.test`,
    password: TEST_PASSWORD,
    organizationName: `${organizationName} ${suffix}`,
  });
  expect(response.status).toBe(200);
  expect(response.body.accessToken).toBeString();
  expect(response.body.tenant?.tenantId).toBeString();
  return response.body as Registration;
}

async function issueApiKey(
  baseUrl: string,
  registration: Registration,
  label: string,
): Promise<IssuedApiKey> {
  const response = await jsonRequest(
    baseUrl,
    'POST',
    '/auth/api-keys',
    registration.accessToken,
    { label },
  );
  expect(response.status).toBe(200);
  expect(response.body.secret).toBeString();
  return response.body as IssuedApiKey;
}

async function resourceRequest(
  baseUrl: string,
  method: string,
  path: string,
  bearer: string,
  body?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<JsonResponse> {
  return jsonRequest(baseUrl, method, path, bearer, body, extraHeaders);
}

async function jsonRequest(
  baseUrl: string,
  method: string,
  path: string,
  bearer?: string,
  body?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<JsonResponse> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, any> : {},
  };
}
