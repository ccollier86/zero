/**
 * build-scripts.test.ts
 *
 * Guards package script entrypoints against drift. The test checks that the
 * scripts point at runnable files in this repo; it does not execute long-lived
 * dev servers.
 */

import { describe, expect, test } from 'bun:test';

interface PackageJson {
  scripts?: Record<string, string>;
}

const packageJson = await Bun.file('package.json').json() as PackageJson;

function scriptEntrypoint(scriptName: string): string {
  const script = packageJson.scripts?.[scriptName];
  if (!script) throw new Error(`Missing package script: ${scriptName}`);

  const match = script.match(/\b(?:app|src)\/[^\s]+\.tsx?\b/);
  if (!match) throw new Error(`Package script '${scriptName}' has no TypeScript entrypoint`);

  return match[0];
}

describe('package build scripts', () => {
  test('dev script points at the runnable app server entry', async () => {
    const entrypoint = scriptEntrypoint('dev');

    expect(entrypoint).toBe('app/server.ts');
    expect(await Bun.file(entrypoint).exists()).toBe(true);
  });

  test('build scripts point at existing TypeScript entrypoints', async () => {
    for (const scriptName of ['build', 'build:binary']) {
      const entrypoint = scriptEntrypoint(scriptName);
      expect(await Bun.file(entrypoint).exists()).toBe(true);
    }
  });
});
