/**
 * server-route-loader.test.ts
 *
 * Verifies app-owned Elysia route discovery for package-mode apps. These tests
 * cover loader behavior and plugin mounting only; platform service context is
 * tested in server-route.test.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

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
      expect(plugins).toHaveLength(2);

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

  test('throws for route modules without an Elysia plugin export', async () => {
    const rootDir = await createTempRoot();
    const routesDir = join(rootDir, 'server', 'routes');

    try {
      await mkdir(routesDir, { recursive: true });
      await writeFile(join(routesDir, 'bad.ts'), 'export default { nope: true };\n');

      await expect(loadServerRoutePlugins({ routesDir })).rejects.toBeInstanceOf(
        ServerRouteLoaderError
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
