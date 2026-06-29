/**
 * copy.test.ts
 *
 * Verifies the source-copy engine behind `zero add`. These tests focus on
 * generated file layout, import rewriting, and package-mode buildability.
 */

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { addZeroSource } from './copy';

async function createTempApp(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  const targetDir = await mkdtemp(join(baseDir, 'test-zero-add-'));
  await writeTestTsConfig(targetDir);
  await linkFrameworkPackage(targetDir);
  return targetDir;
}

describe('addZeroSource', () => {
  test('copies an individual UI primitive with alias dependencies', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/ui/button'],
      });

      expect(result.filesWritten).toContain('components/ui/button.tsx');
      expect(result.filesWritten).toContain('lib/utils.ts');
      expect(result.filesPlanned).not.toContain('components/ui/button.test.tsx');

      const button = await readFile(join(targetDir, 'components/ui/button.tsx'), 'utf8');
      expect(button).toContain("from \"@/lib/utils\"");

      const second = await addZeroSource({
        targetDir,
        items: ['components/ui/button'],
      });
      expect(second.filesSkipped).toContain('components/ui/button.tsx');
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test('copies data table source with public framework import rewrites', async () => {
    const targetDir = await createTempApp();

    try {
      const result = await addZeroSource({
        targetDir,
        items: ['components/data-table'],
      });

      expect(result.filesWritten).toContain('components/data-table/data-table.tsx');
      expect(result.filesWritten).toContain('components/data-table/row-identity.ts');
      expect(result.filesWritten).toContain('components/ui/table.tsx');
      expect(result.filesWritten).toContain('components/animate-ui/components/radix/checkbox.tsx');
      expect(result.rewrites.length).toBeGreaterThan(0);

      const rowIdentity = await readFile(join(targetDir, 'components/data-table/row-identity.ts'), 'utf8');
      expect(rowIdentity).toContain("from '@zero/framework/schema'");
      expect(rowIdentity).toContain("from '@zero/framework/sync/types'");
      expect(rowIdentity).toContain("from '@zero/framework/sync/identity'");

      await writeFile(
        join(targetDir, 'entry.tsx'),
        "import { DataTable } from './components/data-table';\nexport { DataTable };\n"
      );

      const build = await Bun.build({
        entrypoints: [join(targetDir, 'entry.tsx')],
        outdir: join(targetDir, 'dist'),
        target: 'browser',
      });
      expect(build.success).toBe(true);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });
});

async function writeTestTsConfig(targetDir: string): Promise<void> {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: ['bun'],
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      jsx: 'react-jsx',
      jsxImportSource: 'react',
      baseUrl: '.',
      paths: {
        '@/*': ['./*'],
        '@/components/*': ['./components/*'],
        '@/hooks/*': ['./hooks/*'],
        '@/lib/*': ['./lib/*'],
      },
    },
    include: ['**/*.ts', '**/*.tsx'],
  };

  await writeFile(join(targetDir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
}

async function linkFrameworkPackage(targetDir: string): Promise<void> {
  const scopeDir = join(targetDir, 'node_modules/@zero');
  await mkdir(scopeDir, { recursive: true });
  await symlink(process.cwd(), join(scopeDir, 'framework'), 'dir');
}
