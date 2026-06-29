/**
 * resource-app-factory.test.ts
 *
 * Verifies createApp wires app-owned resource definitions into the resource
 * registry. This test covers startup composition only; resource CRUD, /api/data,
 * and sync enforcement are covered by later Phase 5 slices.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'bun:test';

import { defineResource, getResourceRegistry, readOnly } from '../../resources';
import { createApp } from './app-factory';

async function createTempRoot(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, 'test-resource-app-'));
}

describe('createApp resource registration', () => {
  test('registers inline and package-mode resource definitions', async () => {
    const rootDir = await createTempRoot();
    const resourcesDir = join(rootDir, 'server', 'resources');
    const appDir = join(rootDir, 'app');
    const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;

    try {
      await mkdir(resourcesDir, { recursive: true });
      await mkdir(appDir, { recursive: true });
      await writeFile(
        join(resourcesDir, 'projects.ts'),
        [
          `import { defineResource, readOnly } from '${serverImport}';`,
          "export default defineResource({ table: 'projects', policy: readOnly() });",
          '',
        ].join('\n')
      );

      await createApp({
        db: { mode: 'memory' },
        tables: {
          tickets: {
            ticket_id: 'text primary key',
            title: 'text not null',
          },
          projects: {
            project_id: 'text primary key',
            name: 'text not null',
          },
        },
        resources: [
          defineResource({
            table: 'tickets',
            policy: readOnly(),
          }),
        ],
        serverResourcesDir: resourcesDir,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        appDir,
        outDir: join(rootDir, 'out'),
        observability: false,
      });

      const registry = getResourceRegistry();
      expect(registry.getByTable('tickets')?.primaryKey).toBe('ticket_id');
      expect(registry.getByTable('projects')?.primaryKey).toBe('project_id');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
