/**
 * server-route-loader.test.ts
 *
 * Verifies app-owned backend extension discovery for package-mode apps. These
 * tests cover loader behavior and plugin mounting only; service context is
 * tested in server-route.test.ts and server-extensions.test.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { MemoryEventStore, OBS_CODES } from '../../observability';
import { ZERO_OBSERVABILITY_RUNTIME } from '../../runtime/service-keys';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { createSyncPlugin } from '../../sync';
import {
  ServerRouteLoaderError,
  collectServerRouteFiles,
  loadServerRoutePlugins,
} from './server-route-loader';

async function createTempRoot(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, 'test-server-routes-'));
}

describe('server route loader', () => {
  test('returns no plugins when the routes directory is missing', async () => {
    const rootDir = await createTempRoot();

    try {
      await expect(loadServerRoutePlugins({ routesDir: join(rootDir, 'missing') }))
        .resolves
        .toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('loads route modules recursively and mounts exported Elysia plugins', async () => {
    const rootDir = await createTempRoot();
    const routesDir = join(rootDir, 'server', 'routes');

    try {
      await mkdir(join(routesDir, 'admin'), { recursive: true });
      await writeFile(
        join(routesDir, 'health.ts'),
        [
          "import { Elysia } from 'elysia';",
          "export default new Elysia({ name: 'test.health', prefix: '/api/custom' })",
          "  .get('/health', () => ({ ok: true }));",
          '',
        ].join('\n')
      );
      await writeFile(
        join(routesDir, 'health.test.ts'),
        "throw new Error('test files should not load');\n"
      );
      await writeFile(
        join(routesDir, 'admin', 'status.ts'),
        [
          "import { Elysia } from 'elysia';",
          "export const routes = [",
          "  new Elysia({ name: 'test.status', prefix: '/api/custom' })",
          "    .get('/status', () => ({ status: 'ready' }))",
          "];",
          '',
        ].join('\n')
      );

      const files = await collectServerRouteFiles(routesDir);
      expect(files.map((file) => file.slice(routesDir.length + 1))).toEqual([
        'admin/status.ts',
        'health.ts',
      ]);

      const plugins = await loadServerRoutePlugins({ routesDir });
      expect(plugins).toHaveLength(1);

      let app = new Elysia();
      for (const plugin of plugins) app = app.use(plugin as any);

      const health = await app
        .handle(new Request('http://localhost/api/custom/health'))
        .then((res) => res.json());
      const status = await app
        .handle(new Request('http://localhost/api/custom/status'))
        .then((res) => res.json());

      expect(health).toEqual({ ok: true });
      expect(status).toEqual({ status: 'ready' });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('loads Zero extensions from conventional folders in scoped order', async () => {
    const rootDir = await createTempRoot();
    const serverDir = join(rootDir, 'server');
    const pluginsDir = join(serverDir, 'plugins');
    const middlewareDir = join(serverDir, 'middleware');
    const endpointsDir = join(serverDir, 'endpoints');
    const routesDir = join(serverDir, 'routes');

    try {
      await mkdir(pluginsDir, { recursive: true });
      await mkdir(middlewareDir, { recursive: true });
      await mkdir(endpointsDir, { recursive: true });
      await mkdir(routesDir, { recursive: true });
      const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;

      await writeFile(
        join(pluginsDir, 'status-plugin.ts'),
        [
          `import { defineZeroPlugin } from '${serverImport}';`,
          "export default defineZeroPlugin({",
          "  name: 'test.status-plugin',",
          "  setup({ app }) {",
          "    return app.get('/api/zero/plugin-status', () => ({ plugin: true }));",
          "  }",
          "});",
          '',
        ].join('\n')
      );

      await writeFile(
        join(middlewareDir, 'headers.ts'),
        [
          `import { defineMiddleware } from '${serverImport}';`,
          "export default defineMiddleware({",
          "  name: 'test.headers',",
          "  path: '/api/zero/*',",
          "  run(context) {",
          "    (context as any).set.headers['x-zero-extension'] = 'yes';",
          "  }",
          "});",
          '',
        ].join('\n')
      );

      await writeFile(
        join(endpointsDir, 'ping.ts'),
        [
          `import { defineEndpoint } from '${serverImport}';`,
          "export default defineEndpoint({",
          "  method: 'GET',",
          "  path: '/api/zero/ping',",
          "  handler({ zero }) {",
          "    return { ok: Boolean(zero.db), alias: zero.db === zero.syncDB };",
          "  }",
          "});",
          '',
        ].join('\n')
      );

      await writeFile(
        join(routesDir, 'group.ts'),
        [
          `import { defineEndpoint, defineRouter } from '${serverImport}';`,
          "export default defineRouter({",
          "  name: 'test.group',",
          "  prefix: '/api/zero/group',",
          "  endpoints: [",
          "    defineEndpoint({ method: 'GET', path: '/health', handler: () => ({ ready: true }) })",
          "  ]",
          "});",
          '',
        ].join('\n')
      );

      const plugins = await loadServerRoutePlugins({
        extensionDirs: [
          { kind: 'plugins', dir: pluginsDir },
          { kind: 'middleware', dir: middlewareDir },
          { kind: 'endpoints', dir: endpointsDir },
          { kind: 'routes', dir: routesDir },
        ],
      });

      expect(plugins).toHaveLength(1);

      let app = new Elysia()
        .use(createSyncPlugin({
          db: { mode: 'memory' },
          tables: {
            customers: {
              customer_id: 'text primary key',
              name: 'text not null',
            },
          },
        }))
        .get('/api/outside', () => ({ outside: true }));

      for (const plugin of plugins) app = app.use(plugin as any);
      app.listen(0);

      const ping = await app.handle(new Request('http://localhost/api/zero/ping'));
      const group = await app.handle(new Request('http://localhost/api/zero/group/health'));
      const pluginStatus = await app.handle(new Request('http://localhost/api/zero/plugin-status'));
      const outside = await app.handle(new Request('http://localhost/api/outside'));

      await expect(ping.json()).resolves.toEqual({ ok: true, alias: true });
      await expect(group.json()).resolves.toEqual({ ready: true });
      await expect(pluginStatus.json()).resolves.toEqual({ plugin: true });
      expect(ping.headers.get('x-zero-extension')).toBe('yes');
      expect(outside.headers.get('x-zero-extension')).toBeNull();
      await app.stop();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('throws for route modules without an Elysia plugin export', async () => {
    const rootDir = await createTempRoot();
    const routesDir = join(rootDir, 'server', 'routes');

    try {
      await mkdir(routesDir, { recursive: true });
      await writeFile(join(routesDir, 'bad.ts'), 'export default { nope: true };\n');

      const events = new MemoryEventStore();
      const runtime = new ZeroAppRuntime();
      runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
        sink: events,
        store: events,
        config: { console: false, store: events },
      });

      await expect(loadServerRoutePlugins({ routesDir, runtime }))
        .rejects.toBeInstanceOf(ServerRouteLoaderError);
      const [event] = events.query({
        code: OBS_CODES.ROUTER_SERVER_ROUTE_LOAD_FAILED.code,
      }).events;
      expect(event?.metadata).toEqual({ directoryKind: 'routes' });
      expect(event?.error).toBeUndefined();
      expect(JSON.stringify(event)).not.toContain(rootDir);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
