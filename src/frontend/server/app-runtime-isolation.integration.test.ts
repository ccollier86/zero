/**
 * Proves the managed createApp composition remains app-local even while every
 * legacy compatibility getter is intentionally ambiguous. Plugin-level tests
 * cover their individual registries; this test exercises the composed auth,
 * resource, data, and app-owned route path.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'bun:test';

import {
  getAuthStore,
  getAuthorizationKernel,
} from '../../auth/auth.plugin';
import {
  authenticatedOnly,
  defineResource,
  getResourceRegistry,
  tenantRealm,
} from '../../resources';
import { ZeroRuntimeAmbiguousError } from '../../runtime/compatibility-provider-registry';
import { getStorageService } from '../../storage';
import { getSyncDB } from '../../sync';
import { createApp } from './app-factory';

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

const runningApps: ManagedApp[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const app of runningApps.splice(0).reverse()) {
    await app.stop(true);
  }
  for (const root of temporaryRoots.splice(0).reverse()) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('createApp runtime isolation', () => {
  test('keeps composed auth, resources, data, and route services app-local', async () => {
    const appA = await startManagedApp('alpha');
    const appB = await startManagedApp('beta');

    // Compatibility getters are deliberately unsuitable once two apps exist.
    // The managed path below must therefore be using its explicit runtime.
    expect(() => getAuthStore()).toThrow(ZeroRuntimeAmbiguousError);
    expect(() => getAuthorizationKernel()).toThrow(ZeroRuntimeAmbiguousError);
    expect(() => getResourceRegistry()).toThrow(ZeroRuntimeAmbiguousError);
    expect(() => getStorageService()).toThrow(ZeroRuntimeAmbiguousError);
    expect(() => getSyncDB()).toThrow(ZeroRuntimeAmbiguousError);

    const alpha = await register(appA, 'alpha', 'Alpha Health');
    const beta = await register(appB, 'beta', 'Beta Health');
    expect(alpha.status).toBe(200);
    expect(beta.status).toBe(200);

    const alphaCreate = await requestJson(appA, '/api/resources/documents', {
      method: 'POST',
      token: alpha.body.accessToken,
      body: { document_id: 'shared-id', title: 'Alpha document' },
    });
    const betaCreate = await requestJson(appB, '/api/resources/documents', {
      method: 'POST',
      token: beta.body.accessToken,
      body: { document_id: 'shared-id', title: 'Beta document' },
    });
    expect(alphaCreate.status).toBe(201);
    expect(betaCreate.status).toBe(201);

    const alphaData = await requestJson(
      appA,
      '/api/data?table=documents&order=document_id&dir=asc',
      { token: alpha.body.accessToken },
    );
    const betaData = await requestJson(
      appB,
      '/api/data?table=documents&order=document_id&dir=asc',
      { token: beta.body.accessToken },
    );
    expect(alphaData.status).toBe(200);
    expect(alphaData.body.rows).toEqual([expect.objectContaining({
      document_id: 'shared-id',
      title: 'Alpha document',
    })]);
    expect(betaData.status).toBe(200);
    expect(betaData.body.rows).toEqual([expect.objectContaining({
      document_id: 'shared-id',
      title: 'Beta document',
    })]);

    const alphaRoute = await requestJson(appA, '/api/runtime-proof', {
      token: alpha.body.accessToken,
    });
    const betaRoute = await requestJson(appB, '/api/runtime-proof', {
      token: beta.body.accessToken,
    });

    expect(alphaRoute).toMatchObject({
      status: 200,
      body: {
        appLabel: 'alpha',
        storedEmail: 'alpha@example.test',
        documentTitle: 'Alpha document',
        resourcePrimaryKey: 'document_id',
        tenancyMode: 'multi',
        hasScopedStorage: true,
      },
    });
    expect(betaRoute).toMatchObject({
      status: 200,
      body: {
        appLabel: 'beta',
        storedEmail: 'beta@example.test',
        documentTitle: 'Beta document',
        resourcePrimaryKey: 'document_id',
        tenancyMode: 'multi',
        hasScopedStorage: true,
      },
    });
    expect(alphaRoute.body.tenantId).toBe(alpha.body.tenant.tenantId);
    expect(betaRoute.body.tenantId).toBe(beta.body.tenant.tenantId);

    // An otherwise valid credential from the other live app is invalid in
    // this issuer/runtime and must fail as unauthenticated before reaching a
    // protected route, Resource policy, or lazy-data policy.
    const crossedRoute = await requestJson(appB, '/api/runtime-proof', {
      token: alpha.body.accessToken,
    });
    const crossedResource = await requestJson(appB, '/api/resources/documents', {
      token: alpha.body.accessToken,
    });
    const crossedData = await requestJson(appB, '/api/data?table=documents', {
      token: alpha.body.accessToken,
    });
    for (const crossed of [crossedRoute, crossedResource, crossedData]) {
      expect(crossed).toMatchObject({
        status: 401,
        body: { code: 'UNAUTHORIZED' },
      });
    }
  });
});

async function startManagedApp(label: string): Promise<ManagedApp> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  const root = await mkdtemp(join(baseDir, `test-app-runtime-${label}-`));
  temporaryRoots.push(root);
  const appDir = join(root, 'app');
  const routesDir = join(root, 'server', 'routes');
  await mkdir(appDir, { recursive: true });
  await mkdir(routesDir, { recursive: true });

  const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;
  await writeFile(join(routesDir, 'runtime-proof.ts'), [
    `import { defineEndpoint } from '${serverImport}';`,
    `const appLabel = ${JSON.stringify(label)};`,
    'export default defineEndpoint({',
    "  method: 'GET',",
    "  path: '/api/runtime-proof',",
    "  auth: { tenant: 'required' },",
    '  handler: ({ zero, user }) => {',
    "    const document = zero.unsafe.db.queryOne('documents', 'shared-id');",
    '    const stored = zero.unsafe.auth.store?.getUserById(user.userId);',
    '    return {',
    '      appLabel,',
    '      storedEmail: stored?.email ?? null,',
    '      documentTitle: document?.title ?? null,',
    "      resourcePrimaryKey: zero.resources.getByTable('documents')?.primaryKey ?? null,",
    '      tenancyMode: zero.auth.authorizationKernel?.tenancy.mode ?? null,',
    '      tenantId: zero.scope?.tenantId ?? null,',
    '      hasScopedStorage: Boolean(zero.storage),',
    '    };',
    '  },',
    '});',
    '',
  ].join('\n'));

  const app = await createApp({
    db: { mode: 'memory' },
    tables: {
      documents: {
        document_id: 'text primary key',
        tenant_id: 'text not null',
        title: 'text not null',
        _identity: ['tenant_id', 'title'],
      },
    },
    resources: [defineResource({
      table: 'documents',
      exposure: 'all',
      realm: tenantRealm(),
      policy: authenticatedOnly(),
    })],
    syncDefaults: {
      tables: { documents: 'lazy' },
    },
    auth: {
      tenancy: 'multi',
      bootstrap: 'public',
      registration: { mode: 'public' },
    },
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: routesDir,
    appDir,
    outDir: join(root, 'out'),
    generatedDir: join(root, '.zero', 'generated'),
    observability: false,
    ai: false,
    vector: false,
    pdf: false,
    kv: false,
  });
  app.listen(0);
  runningApps.push(app);
  return app;
}

function register(app: ManagedApp, username: string, organizationName: string) {
  return requestJson(app, '/auth/register', {
    method: 'POST',
    body: {
      username,
      email: `${username}@example.test`,
      password: 'password123',
      organizationName,
    },
  });
}

async function requestJson(
  app: ManagedApp,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`http://localhost:${app.server!.port}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}
