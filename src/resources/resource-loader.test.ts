/**
 * resource-loader.test.ts
 *
 * Verifies package-mode resource module discovery. Registry validation stays
 * in resource-registry.test.ts, and generated route behavior is intentionally
 * out of scope for this slice.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'bun:test';

import {
  ResourceLoaderError,
  collectResourceFiles,
  loadResourceDefinitions,
} from './resource-loader';

async function createTempRoot(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, 'test-resources-'));
}

describe('resource loader', () => {
  test('returns no definitions when resource discovery is missing or disabled', async () => {
    const rootDir = await createTempRoot();

    try {
      await expect(loadResourceDefinitions({ resourcesDir: join(rootDir, 'missing') }))
        .resolves
        .toEqual([]);
      await expect(loadResourceDefinitions({ resourcesDir: false }))
        .resolves
        .toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('loads resource modules recursively in stable order', async () => {
    const rootDir = await createTempRoot();
    const resourcesDir = join(rootDir, 'server', 'resources');
    const serverImport = pathToFileURL(join(process.cwd(), 'src/frontend/server.ts')).href;

    try {
      await mkdir(join(resourcesDir, 'admin'), { recursive: true });
      await writeFile(
        join(resourcesDir, 'tickets.ts'),
        [
          `import { defineResource, readOnly } from '${serverImport}';`,
          "export default defineResource({ table: 'tickets', actions: ['list', 'get'], policy: readOnly() });",
          '',
        ].join('\n')
      );
      await writeFile(
        join(resourcesDir, 'tickets.test.ts'),
        "throw new Error('test files should not load');\n"
      );
      await writeFile(
        join(resourcesDir, 'admin', 'projects.ts'),
        [
          `import { defineResource, adminOnly } from '${serverImport}';`,
          'export const resources = [',
          "  defineResource({ table: 'projects', actions: ['list'], policy: adminOnly() })",
          '];',
          '',
        ].join('\n')
      );

      const files = await collectResourceFiles(resourcesDir);
      expect(files.map((file) => file.slice(resourcesDir.length + 1))).toEqual([
        'admin/projects.ts',
        'tickets.ts',
      ]);

      const resources = await loadResourceDefinitions({ resourcesDir });
      expect(resources.map((resource) => resource.table)).toEqual(['projects', 'tickets']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('throws for modules without resource exports', async () => {
    const rootDir = await createTempRoot();
    const resourcesDir = join(rootDir, 'server', 'resources');

    try {
      await mkdir(resourcesDir, { recursive: true });
      await writeFile(join(resourcesDir, 'bad.ts'), 'export default { nope: true };\n');

      await expect(loadResourceDefinitions({ resourcesDir })).rejects.toBeInstanceOf(
        ResourceLoaderError
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
