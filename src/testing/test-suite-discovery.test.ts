/** Actual scratch-tree discovery verifies every Bun suffix and no feature/fixture-specific exclusions. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises'; // Bun has no directory creation/removal API.
import { join } from 'node:path';
import { discoverTestSuiteFiles } from './test-suite-discovery';

test('matches Bun suffix/case/loader and directory admission without Gitignore/build/bunfig omissions', async () => {
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'suite-discovery-'));
  try {
    const expected: string[] = [];
    for (const suffix of ['.test', '_test', '.spec', '_spec']) {
      for (const extension of ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']) expected.push(`source/a${suffix}.${extension}`);
    }
    expected.push('source/.hidden.test.ts', 'sdk/example/test/contract.test.ts', 'test-fixtures/real.test.ts',
      'src/build/build-app.test.ts', 'src/databases/database-actor-entry.test.ts', 'dist/ordinary.test.ts',
      'build/ordinary.test.ts', 'source/mixed.TeSt.TSX');
    const excluded = ['node_modules/dependency.test.ts', '.git/history.test.ts', '.hidden/visible.test.ts',
      'source/.cache/hidden.test.ts', 'sdk/example/NODE_MODULES/dependency.test.ts', 'source/not-a-test.ts'];
    for (const file of [...expected, ...excluded]) {
      await mkdir(join(root, file.slice(0, file.lastIndexOf('/'))), { recursive: true });
      await Bun.write(join(root, file), '// Synthetic file: inventory only.');
    }
    await Bun.write(join(root, '.gitignore'), 'source/\n');
    await Bun.write(join(root, 'bunfig.toml'), '[test]\npathIgnorePatterns = ["sdk/**"]\n');
    expect(await discoverTestSuiteFiles(root)).toEqual(expected.sort());
  } finally { await rm(root, { recursive: true, force: true }); }
});
