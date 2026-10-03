/**
 * app-extension-shutdown.integration.test.ts
 *
 * Proves managed app extensions drain while Guardian and Fabric remain live.
 * The fixture exercises the real discovered-plugin, request-authority, actor,
 * and createApp shutdown boundaries; it does not replace service unit tests.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { databaseActorFixtureRealm } from '../../databases/test-fixtures/database-actor-realm';
import {
  authenticatedOnly,
  defineResource,
  tenantRealm,
} from '../../resources';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createApp } from './app-factory';

const DATABASE_ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../../databases/test-fixtures/database-actor-same-entry.ts',
  import.meta.url,
));

const roots = new Set<string>();

afterEach(async () => {
  await Promise.all([...roots].map((root) => (
    rm(root, { recursive: true, force: true })
  )));
  roots.clear();
});

describe('managed app extension shutdown', () => {
  test('drains every extension with live scoped Guardian/Fabric services before runtime disposal', async () => {
    const root = await createRoot();
    const markers = {
      rejecting: join(root, 'rejecting-extension-drained'),
      fabric: join(root, 'fabric-extension-drained'),
    };
    await writeShutdownPlugins(root, markers);

    let first: Awaited<ReturnType<typeof createApp>> | null = null;
    let second: Awaited<ReturnType<typeof createApp>> | null = null;
    try {
      first = await createShutdownApp(root);
      const databaseProbe = installDatabaseProbe(first);
      first.listen(0);
      const firstUrl = appUrl(first);
      const applicationDB = await resolveDatabaseProbe(firstUrl, databaseProbe);

      await register(firstUrl, 'platform-owner', 'Platform Administration');
      const tenant = await register(firstUrl, 'tenant-owner', 'Customer Workspace');
      const capture = await requestJson(
        firstUrl,
        'POST',
        '/__test/capture-shutdown-authority',
        undefined,
        tenant.accessToken,
      );
      expect(capture).toMatchObject({ status: 200, body: { captured: true } });
      const arm = await requestJson(
        firstUrl,
        'POST',
        '/__test/arm-shutdown-failure',
        undefined,
        tenant.accessToken,
      );
      expect(arm.status).toBe(200);

      let shutdownFailure: unknown;
      try {
        await first.stop(true);
      } catch (error) {
        shutdownFailure = error;
      }
      first = null;

      expect(hasNestedMessage(shutdownFailure, 'intentional extension drain failure'))
        .toBe(true);
      expect(await Bun.file(markers.rejecting).text()).toBe('drained');
      expect(await Bun.file(markers.fabric).text()).toBe('drained');
      expect(() => applicationDB.currentSeq).toThrow('disposed');

      second = await createShutdownApp(root);
      second.listen(0);
      const secondUrl = appUrl(second);
      const login = await requestJson(secondUrl, 'POST', '/auth/login', {
        username: tenant.username,
        password: tenant.password,
      });
      expect(login.status).toBe(200);
      const persisted = await requestJson(
        secondUrl,
        'GET',
        '/api/resources/todos/extension-shutdown-row',
        undefined,
        String(login.body.accessToken),
      );
      expect(persisted).toMatchObject({
        status: 200,
        body: {
          row: {
            id: 'extension-shutdown-row',
            title: 'Recorded during extension drain',
          },
        },
      });
    } finally {
      if (first) await first.stop(true).catch(() => undefined);
      if (second) await second.stop(true).catch(() => undefined);
    }
  }, 90_000);
});

interface RegistrationResult {
  readonly accessToken: string;
  readonly username: string;
  readonly password: string;
}

async function createRoot(): Promise<string> {
  const base = join(process.cwd(), '.zero');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'app-extension-shutdown-'));
  roots.add(root);
  await Promise.all([
    mkdir(join(root, 'app'), { recursive: true }),
    mkdir(join(root, 'control'), { recursive: true }),
    mkdir(join(root, 'server', 'plugins'), { recursive: true }),
  ]);
  return root;
}

async function createShutdownApp(root: string) {
  return createApp({
    app: { publicUrl: 'https://app.test' },
    db: { mode: 'file', path: join(root, 'control', 'application.db') },
    systemDb: { mode: 'file', path: join(root, 'control', 'system.db') },
    tables: {
      todos: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    resources: [defineResource({
      table: 'todos',
      exposure: 'all',
      realm: tenantRealm(),
      policy: authenticatedOnly(),
    })],
    auth: {
      tenancy: 'multi',
      bootstrap: 'public',
      registration: { mode: 'public' },
      accountEmails: { passwordReset: false },
    },
    databaseTopology: {
      mode: 'multiple',
      rootDirectory: join(root, 'fabric'),
      realm: databaseActorFixtureRealm,
      actors: {
        launch: { kind: 'source', entrypoint: DATABASE_ACTOR_ENTRYPOINT },
      },
      tenantIsolation: 'tenant-database',
    },
    appDir: join(root, 'app'),
    outDir: join(root, 'out'),
    storageDir: join(root, 'storage'),
    generatedDir: join(root, '.zero', 'generated'),
    serverResourcesDir: false,
    serverPluginsDir: join(root, 'server', 'plugins'),
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    observability: false,
    workflows: false,
    email: false,
    ai: false,
    vector: false,
    pdf: false,
    kv: false,
  });
}

async function writeShutdownPlugins(
  root: string,
  markers: Readonly<{ rejecting: string; fabric: string }>,
): Promise<void> {
  const pluginsDir = join(root, 'server', 'plugins');
  const serverImport = pathToFileURL(
    join(process.cwd(), 'src/frontend/server.ts'),
  ).href;
  await Promise.all([
    writeFile(join(pluginsDir, 'a-rejecting-drain.ts'), [
      `import { defineZeroPlugin } from ${JSON.stringify(serverImport)};`,
      'let armed = false;',
      'export default defineZeroPlugin({',
      "  name: 'test.rejecting-shutdown-drain',",
      '  setup({ app }) {',
      "    return app.post('/__test/arm-shutdown-failure', () => {",
      '      armed = true;',
      '      return { armed: true };',
      "    }, { zeroAuth: 'user' }).onStop(async () => {",
      '      if (!armed) return;',
      `      await Bun.write(${JSON.stringify(markers.rejecting)}, 'drained');`,
      "      throw new Error('intentional extension drain failure');",
      '    });',
      '  },',
      '});',
      '',
    ].join('\n')),
    writeFile(join(pluginsDir, 'b-fabric-drain.ts'), [
      `import { defineZeroPlugin } from ${JSON.stringify(serverImport)};`,
      'let scopedData = null;',
      'export default defineZeroPlugin({',
      "  name: 'test.fabric-shutdown-drain',",
      '  setup({ app }) {',
      "    return app.post('/__test/capture-shutdown-authority', ({ zero }) => {",
      "      if (!zero.data) throw new Error('Scoped Fabric data service unavailable');",
      '      scopedData = zero.data;',
      '      return { captured: true };',
      "    }, { zeroAuth: 'user' }).onStop(async () => {",
      '      if (!scopedData) return;',
      '      await scopedData.mutate({',
      "        type: 'create',",
      "        table: 'todos',",
      '        row: {',
      "          id: 'extension-shutdown-row',",
      "          title: 'Recorded during extension drain',",
      '        },',
      '      }, {',
      "        idempotencyKey: 'test:extension-shutdown-row',",
      '      });',
      `      await Bun.write(${JSON.stringify(markers.fabric)}, 'drained');`,
      '    });',
      '  },',
      '});',
      '',
    ].join('\n')),
  ]);
}

function installDatabaseProbe(
  app: Awaited<ReturnType<typeof createApp>>,
): { readonly path: string; read(): ReactiveDB | null } {
  const path = `/__test/database-probe-${crypto.randomUUID()}`;
  let db: ReactiveDB | null = null;
  app.get(path, (context) => {
    db = (context as unknown as { syncDB?: ReactiveDB }).syncDB ?? null;
    return { ready: db !== null };
  });
  return { path, read: () => db };
}

async function resolveDatabaseProbe(
  url: string,
  probe: { readonly path: string; read(): ReactiveDB | null },
): Promise<ReactiveDB> {
  const response = await fetch(`${url}${probe.path}`);
  await response.arrayBuffer();
  const db = probe.read();
  if (!db) throw new Error('Application ReactiveDB probe was not populated');
  return db;
}

async function register(
  url: string,
  username: string,
  organizationName: string,
): Promise<RegistrationResult> {
  const password = 'password123';
  const result = await requestJson(url, 'POST', '/auth/register', {
    username,
    email: `${username}@example.test`,
    password,
    organizationName,
  });
  expect(result.status).toBe(200);
  return {
    accessToken: String(result.body.accessToken),
    username,
    password,
  };
}

async function requestJson(
  url: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  accessToken?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function appUrl(app: Awaited<ReturnType<typeof createApp>>): string {
  const port = app.server?.port;
  if (port === undefined) throw new Error('Application is not listening');
  return `http://localhost:${port}`;
}

function hasNestedMessage(error: unknown, message: string): boolean {
  if (error instanceof AggregateError) {
    return error.errors.some((candidate) => hasNestedMessage(candidate, message));
  }
  return error instanceof Error && error.message.includes(message);
}
