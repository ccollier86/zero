/** Verifies that the public UI wildcard never admits test/spec/fixture modules. */

import { describe, expect, test } from 'bun:test';

const frameworkRoot = import.meta.dir.replace(/\/src$/u, '');

describe('public UI export boundary', () => {
  test('keeps intended components resolvable', () => {
    for (const name of ['card', 'list-detail-layout', 'record-navigation-bar', 'input', 'resizable']) {
      expect(Bun.resolveSync(`@zero/framework/components/ui/${name}`, frameworkRoot))
        .toEndWith(`/src/components/ui/${name}.tsx`);
    }
  });

  test('resolves the reusable JSON editor through its focused public entrypoint', () => {
    expect(Bun.resolveSync('@zero/framework/components/json-editor', frameworkRoot))
      .toEndWith('/src/components/json-editor/index.ts');
  });

  test('rejects every existing UI test or spec module without executing it', async () => {
    const modules = Array.from(new Bun.Glob('*.{test,spec}.tsx').scanSync({
      cwd: `${frameworkRoot}/src/components/ui`,
      onlyFiles: true,
    }));
    expect(modules.length).toBeGreaterThan(0);
    for (const file of modules) {
      const name = file.replace(/\.tsx$/u, '');
      expect(() => Bun.resolveSync(`@zero/framework/components/ui/${name}`, frameworkRoot))
        .toThrow();
    }
    const manifest = await Bun.file(`${frameworkRoot}/package.json`).json();
    expect(manifest.exports['./components/ui/*.test']).toBeNull();
    expect(manifest.exports['./components/ui/*.spec']).toBeNull();
  });

  test('rejects browser fixture mounts without importing or executing them', async () => {
    const fixtures = Array.from(new Bun.Glob('*.browser-fixture.tsx').scanSync({
      cwd: `${frameworkRoot}/src/components/ui`, onlyFiles: true,
    }));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const file of fixtures) {
      const name = file.replace(/\.tsx$/u, '');
      expect(() => Bun.resolveSync(`@zero/framework/components/ui/${name}`, frameworkRoot)).toThrow();
    }
    const manifest = await Bun.file(`${frameworkRoot}/package.json`).json();
    expect(manifest.exports['./components/ui/*.browser-fixture']).toBeNull();
  });
});
