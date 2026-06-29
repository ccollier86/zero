/**
 * package-mode-fixture.test.ts
 *
 * Verifies the generated-app fixture consumes Zero through public package
 * exports. This test owns package-mode fixture checks only; route-loader unit
 * behavior stays in server-route-loader.test.ts.
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createSyncPlugin } from '../../sync';
import { tables } from '../../../examples/package-mode/db/schema';
import { loadServerRoutePlugins } from './server-route-loader';

describe('package-mode fixture', () => {
  test('builds the app server through public @zero/framework exports', async () => {
    const outdir = join(process.cwd(), '.zero', 'package-mode-fixture-test-build');

    try {
      const result = await Bun.build({
        entrypoints: ['examples/package-mode/app/server.ts'],
        outdir,
        target: 'bun',
      });

      expect(result.success).toBe(true);
      expect(result.outputs.some((output) => output.path.endsWith('server.js'))).toBe(true);
    } finally {
      await rm(outdir, { recursive: true, force: true });
    }
  });

  test('loads fixture Elysia route modules from server/routes', async () => {
    const plugins = await loadServerRoutePlugins({
      routesDir: 'examples/package-mode/server/routes',
    });

    let app = new Elysia()
      .use(createSyncPlugin({
        db: { mode: 'memory' },
        tables,
      }));

    for (const plugin of plugins) app = app.use(plugin as any);

    const body = await app
      .handle(new Request('http://localhost/api/customers/health'))
      .then((response) => response.json());

    expect(body).toEqual({
      ok: true,
      feature: 'package-mode-routes',
    });
  });
});
