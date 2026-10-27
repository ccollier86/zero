/**
 * build-scripts.test.ts
 *
 * Guards package script entrypoints against drift. The test checks that the
 * scripts point at framework-owned files in this repo; it does not execute
 * long-lived dev servers.
 */

import { describe, expect, test } from 'bun:test';
import { collectSourceImportSpecifiers } from '../scripts/private-import-specifiers';

interface PackageJson {
  scripts?: Record<string, string>;
  bin?: Record<string, string>;
  imports?: Record<string, string>;
}

const packageJson = await Bun.file('package.json').json() as PackageJson;

// This test scans the complete TypeScript source tree. It normally completes
// in well under a second, but parallel package/build tests can temporarily
// saturate filesystem I/O on CI runners.
const SOURCE_IMPORT_CONTRACT_TIMEOUT_MS = 30_000;

function scriptEntrypoints(scriptName: string): string[] {
  const script = packageJson.scripts?.[scriptName];
  if (!script) throw new Error(`Missing package script: ${scriptName}`);

  const matches = script.match(/\bsrc\/[^\s]+\.tsx?\b/g);
  if (!matches?.length) throw new Error(`Package script '${scriptName}' has no framework TypeScript entrypoint`);

  return matches;
}

describe('package build scripts', () => {
  test('root scripts do not depend on the ignored app playground', () => {
    for (const scriptName of ['dev', 'build', 'build:binary', 'test:package']) {
      const script = packageJson.scripts?.[scriptName] ?? '';
      expect(script).not.toContain('app/');
    }
  });

  test('the canonical release suite isolates files in bounded OS processes without skipping actor entry', async () => {
    expect(packageJson.scripts?.test).toBe('bun --no-env-file src/testing/run-test-suite.ts');
    expect(packageJson.scripts?.['test:parallel']).toBe('bun run test');
    // Package qualification must not reintroduce shared global/module/build
    // state after the complete suite deliberately moved to OS-file isolation.
    expect(packageJson.scripts?.['test:package']).toStartWith('bun run test --timeout 120000 ');
    expect(packageJson.scripts?.['test:package']).not.toContain('--parallel=');
    expect(packageJson.scripts?.['test:package']).toContain('&& bun run test --timeout 120000 src/update/');
    expect(await Bun.file('src/testing/run-test-suite.ts').exists()).toBe(true);
    const { discoverTestSuiteFiles } = await import('./testing/test-suite-discovery');
    const { parseTestSuiteOptions } = await import('./testing/test-suite-options');
    const files = await discoverTestSuiteFiles(process.cwd());
    expect(files.filter(file => file === 'src/databases/database-actor-entry.test.ts')).toHaveLength(1);
    expect(files).toContain('src/presence/presence-http-sync.integration.test.ts');
    expect(parseTestSuiteOptions(['--timeout', '120000'])).toMatchObject({ testTimeoutMs: 120000, fileTimeoutMs: 900000, concurrency: 4 });
    expect(() => parseTestSuiteOptions(['--parallel=4'])).toThrow('Unsupported test-suite option');
    expect(() => parseTestSuiteOptions(['--path-ignore-patterns=**/database-actor-entry.test.ts'])).toThrow('Unsupported test-suite option');
  });

  test('dev script points at the framework CLI entry', async () => {
    const entrypoints = scriptEntrypoints('dev');

    expect(entrypoints).toEqual(['src/cli/run.ts']);
    expect(await Bun.file(entrypoints[0]).exists()).toBe(true);
  });

  test('build scripts point at existing TypeScript entrypoints', async () => {
    for (const scriptName of ['build', 'build:binary']) {
      const entrypoints = scriptEntrypoints(scriptName);
      for (const entrypoint of entrypoints) {
        expect(await Bun.file(entrypoint).exists()).toBe(true);
      }
    }
  });

  test('CLI bins point at existing TypeScript entrypoints', async () => {
    expect(packageJson.bin?.zero).toBe('./src/cli/run.ts');
    expect(packageJson.bin?.['create-zero']).toBe('./src/create-zero/run.ts');
    expect(await Bun.file(packageJson.bin!.zero).exists()).toBe(true);
    expect(await Bun.file(packageJson.bin!['create-zero']).exists()).toBe(true);
  });

  test('package-private source imports have exact publishable mappings', async () => {
    const specifiers = new Set<string>();
    for (const pattern of ['src/**/*.ts', 'src/**/*.tsx']) {
      for await (const pathname of new Bun.Glob(pattern).scan('.')) {
        const source = await Bun.file(pathname).text();
        const imported = collectSourceImportSpecifiers(pathname, source);
        expect(imported.filter((specifier) => specifier.startsWith('@/'))).toEqual([]);
        for (const specifier of imported) {
          if (specifier.startsWith('#zero/')) specifiers.add(specifier);
        }
      }
    }

    // The generator deliberately retains these existing compatibility routes
    // even when no current runtime import uses them. They are not removable by
    // changing a synthetic fixture or by replacing the source inventory.
    for (const retained of ['#zero/components/animate-ui/primitives/radix/popover', '#zero/components/ui/calendar', '#zero/components/ui/date-picker-value', '#zero/components/ui/time-picker-value']) specifiers.add(retained);
    expect(Object.keys(packageJson.imports ?? {}).sort()).toEqual([...specifiers].sort());
    for (const specifier of specifiers) {
      const target = packageJson.imports?.[specifier];
      expect(target).toMatch(/^\.\/src\/.+\.tsx?$/);
      expect(await Bun.file(target!).exists()).toBe(true);
    }
  }, SOURCE_IMPORT_CONTRACT_TIMEOUT_MS);
});
