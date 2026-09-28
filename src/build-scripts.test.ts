/**
 * build-scripts.test.ts
 *
 * Guards package script entrypoints against drift. The test checks that the
 * scripts point at framework-owned files in this repo; it does not execute
 * long-lived dev servers.
 */

import { describe, expect, test } from 'bun:test';

interface PackageJson {
  scripts?: Record<string, string>;
  bin?: Record<string, string>;
  imports?: Record<string, string>;
}

const packageJson = await Bun.file('package.json').json() as PackageJson;

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
        const imported = [
          ...source.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/g),
          ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
        ].map((match) => match[1]!);
        expect(imported.filter((specifier) => specifier.startsWith('@/'))).toEqual([]);
        for (const specifier of imported) {
          if (specifier.startsWith('#zero/')) specifiers.add(specifier);
        }
      }
    }

    expect(Object.keys(packageJson.imports ?? {}).sort()).toEqual([...specifiers].sort());
    for (const specifier of specifiers) {
      const target = packageJson.imports?.[specifier];
      expect(target).toMatch(/^\.\/src\/.+\.tsx?$/);
      expect(await Bun.file(target!).exists()).toBe(true);
    }
  });
});
