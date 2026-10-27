/** Verifies that the public UI wildcard never admits test/spec/fixture modules. */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const frameworkRoot = import.meta.dir.replace(/\/src$/u, '');
let consumer = '';
beforeAll(async () => {
  consumer = await mkdtemp(join(tmpdir(), 'zero-public-ui-resolution-'));
  await mkdir(join(consumer, 'node_modules/@zero'), { recursive: true });
  await symlink(frameworkRoot, join(consumer, 'node_modules/@zero/framework'));
});
afterAll(async () => { if (consumer) await rm(consumer, { recursive: true, force: true }); });
/** Resolve in an actual external consumer, not the repository's intentionally wider development aliases. */
function resolvePublic(specifier: string, _frameworkRoot: string): string {
  const child = Bun.spawnSync([process.execPath, '--no-env-file', '-e', `try { process.stdout.write(Bun.resolveSync(${JSON.stringify(specifier)}, process.cwd())); } catch { process.exit(2); }`],
    { cwd: consumer, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  if (child.exitCode === 2) throw new Error('The public export is not admitted.');
  if (child.exitCode !== 0) throw new Error('The external resolution probe failed.');
  return new TextDecoder().decode(child.stdout);
}

describe('public UI export boundary', () => {
  test('logging exposes contracts and the component facade, not actor/private/fixture modules', () => {
    expect(resolvePublic('@zero/framework/logging', frameworkRoot)).toEndWith('/src/logging/index.ts');
    expect(resolvePublic('@zero/framework/components/logging', frameworkRoot)).toEndWith('/src/components/logging/index.ts');
    for (const path of ['logging/logging-runtime', 'logging/logging-actor-entry', 'logging/logging-source-outbox', 'components/logging/logging.browser-fixture', 'components/logging/logging.browser.test']) {
      expect(() => resolvePublic('@zero/framework/' + path, frameworkRoot)).toThrow();
    }
  });
  test('exposes messaging only through its public facade, not test fixtures or private modules', () => {
    for (const path of ['messaging', 'components/messaging']) {
      expect(resolvePublic(`@zero/framework/${path}`, frameworkRoot)).toEndWith('/src/components/messaging/index.ts');
      for (const internal of ['use-conversation-typing', 'messaging.browser-fixture', 'messaging-parts.test', 'messaging.browser.test']) {
        expect(() => resolvePublic(`@zero/framework/${path}/${internal}`, frameworkRoot)).toThrow();
      }
    }
  });
  test('keeps intended components resolvable', () => {
    for (const name of ['card', 'list-detail-layout', 'record-navigation-bar', 'input', 'resizable']) {
      expect(resolvePublic(`@zero/framework/components/ui/${name}`, frameworkRoot))
        .toEndWith(`/src/components/ui/${name}.tsx`);
    }
  });

  test('resolves the reusable JSON editor through its focused public entrypoint', () => {
    expect(resolvePublic('@zero/framework/components/json-editor', frameworkRoot))
      .toEndWith('/src/components/json-editor/index.ts');
  });

  test('resolves only the focused phone facade, not its private modules or tests', () => {
    expect(resolvePublic('@zero/framework/components/phone-input', frameworkRoot))
      .toEndWith('/src/components/phone-input/index.ts');
    for (const name of ['phone-input', 'phone-input-country', 'phone-input.browser-fixture', 'phone-input.test']) {
      expect(() => resolvePublic(`@zero/framework/components/phone-input/${name}`, frameworkRoot)).toThrow();
    }
  });

  test('rejects every existing UI test or spec module without executing it', async () => {
    const modules = Array.from(new Bun.Glob('*.{test,spec}.tsx').scanSync({
      cwd: `${frameworkRoot}/src/components/ui`,
      onlyFiles: true,
    }));
    expect(modules.length).toBeGreaterThan(0);
    for (const file of modules) {
      const name = file.replace(/\.tsx$/u, '');
      expect(() => resolvePublic(`@zero/framework/components/ui/${name}`, frameworkRoot))
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
      expect(() => resolvePublic(`@zero/framework/components/ui/${name}`, frameworkRoot)).toThrow();
    }
    const manifest = await Bun.file(`${frameworkRoot}/package.json`).json();
    expect(manifest.exports['./components/ui/*.browser-fixture']).toBeNull();
  });
});
