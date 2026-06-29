/**
 * scaffold.test.ts
 *
 * Verifies create-zero project generation. These tests exercise filesystem
 * output and generated package metadata only; runtime app behavior is covered
 * by the package-mode fixture tests.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { scaffoldZeroApp } from './scaffold';

async function createTempRoot(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, 'test-create-zero-'));
}

describe('scaffoldZeroApp', () => {
  test('creates a package-mode app that builds through public imports', async () => {
    const rootDir = await createTempRoot();
    const targetDir = join(rootDir, 'acme-crm');
    const outdir = join(rootDir, 'build');

    try {
      const result = await scaffoldZeroApp({
        targetDir,
        packageName: 'acme-crm',
        zeroDependency: 'file:../zero-framework',
      });

      expect(result.packageName).toBe('acme-crm');
      expect(result.filesWritten).toContain('zero.config.ts');
      expect(result.filesWritten).toContain('server/routes/customers.ts');

      const packageJson = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
        scripts: Record<string, string>;
      };
      expect(packageJson.dependencies['@zero/framework']).toBe('file:../zero-framework');
      expect(packageJson.scripts.doctor).toBe('zero doctor --config ./zero.config.ts');

      const build = await Bun.build({
        entrypoints: [join(targetDir, 'app/server.ts')],
        outdir,
        target: 'bun',
      });
      expect(build.success).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('rejects non-empty target directories unless force is enabled', async () => {
    const rootDir = await createTempRoot();
    const targetDir = join(rootDir, 'existing');

    try {
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, 'README.md'), 'existing\n');
      await writeFile(join(targetDir, 'stale.txt'), 'delete me\n');

      await expect(scaffoldZeroApp({ targetDir })).rejects.toThrow('Target directory is not empty');

      await expect(scaffoldZeroApp({ targetDir, force: true })).resolves.toMatchObject({
        packageName: 'existing',
      });
      expect(await Bun.file(join(targetDir, 'stale.txt')).exists()).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
