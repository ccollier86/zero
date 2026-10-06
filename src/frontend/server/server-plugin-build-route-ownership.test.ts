/** Validate declarative page ownership without evaluating routes or executing plugin setup. */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { defineZeroPlugin, createServerExtensionApp } from './server-extensions';
import { assertPluginBuildRouteOwnership, isReservedAppRoutePath } from './server-plugin-build-route-ownership';
import { pluginBuildNamespace } from './server-plugin-build-assets';
import { scanRoutes } from '../router/scanner';

function contributor(name: string, path: string) { return defineZeroPlugin({ name, build: { mountPaths: [path], prepare: () => ({}) }, setup() {} }); }
async function scratch(): Promise<string> { const root = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(root, { recursive: true }); return mkdtemp(join(root, 'plugin-ownership-')); }

describe('declared page mount ownership', () => {
  test('missing optional file-router roots are empty but existing files are invalid', async () => {
    const root = await scratch(); try { expect(scanRoutes(join(root, 'missing'))).toEqual([]); await Bun.write(join(root, 'not-directory'), 'file'); expect(() => scanRoutes(join(root, 'not-directory'))).toThrow('must be a directory'); } finally { await rm(root, { recursive: true, force: true }); }
  });
  test('separate mounts are admitted while overlap, malformed and reserved prefixes fail', async () => {
    const root = await scratch(); try {
      expect(() => assertPluginBuildRouteOwnership(root, [contributor('a', '/docs'), contributor('b', '/help')])).not.toThrow();
      for (const prefix of ['/docs/guide', '/', '/docs']) expect(() => assertPluginBuildRouteOwnership(root, [contributor('a', '/docs'), contributor('b', prefix)])).toThrow('overlaps');
      for (const prefix of ['/api', '/api/docs', '/auth/custom', '/_build/plugins', '/sync']) expect(() => assertPluginBuildRouteOwnership(root, [contributor('a', prefix)])).toThrow('reserved');
      for (const prefix of ['/docs/../secret', '/docs//x', '/docs?x', '/docs/%2e', 'relative']) expect(() => assertPluginBuildRouteOwnership(root, [contributor('a', prefix)])).toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test('static, grouped, dynamic and catch-all app pages/file APIs preserve their ownership', async () => {
    for (const relative of ['docs/guide/page.tsx', '(public)/docs/route.ts', '[workspace]/page.tsx', '[...path]/page.tsx']) {
      const root = await scratch(); try {
        const path = join(root, relative); await mkdir(join(path, '..'), { recursive: true }); await Bun.write(path, 'export default function Page(){return null}');
        expect(() => assertPluginBuildRouteOwnership(root, [contributor('reader', '/docs')])).toThrow('conflicts');
        expect(() => assertPluginBuildRouteOwnership(root, [contributor('reader', '/')])).toThrow('conflicts');
      } finally { await rm(root, { recursive: true, force: true }); }
    }
  });
  test('a normal home page does not own a sibling docs mount', async () => {
    const root = await scratch(); try { await Bun.write(join(root, 'page.tsx'), 'export default function Home(){return null}'); expect(() => assertPluginBuildRouteOwnership(root, [contributor('reader', '/docs')])).not.toThrow(); } finally { await rm(root, { recursive: true, force: true }); }
  });
  test('canonical Unicode/space/encoded-punctuation mounts route through real Elysia/Bun sockets', async () => {
    const root = await scratch();
    const name = 'unicode-mount';
    const path = '/caf%C3%A9%20guide%21';
    const plugin = defineZeroPlugin({ name, build: { mountPaths: [path], prepare: () => ({}) }, setup({ app }) { return app.get(path, () => 'Unicode mounted'); } });
    const frontend = { plugins: { [name]: { publicBasePath: `/_build/plugins/${pluginBuildNamespace(name)}`, assets: {} } } };
    const app = await createServerExtensionApp({ extensions: [plugin], frontendContext: { projectRoot: root, frontend } });
    try {
      expect(() => assertPluginBuildRouteOwnership(root, [plugin])).not.toThrow();
      app.listen(0); const port = app.server!.port;
      const response = await fetch(`http://127.0.0.1:${port}/café%20guide%21`); expect(response.status).toBe(200); expect(await response.text()).toBe('Unicode mounted');
      expect(isReservedAppRoutePath('/%61pi/functions')).toBe(true); expect(isReservedAppRoutePath('/caf%C3%A9')).toBe(false);
      for (const bad of ['/docs/%', '/docs/%2Fsecret', '/docs/%5Csecret', '/docs/%2E%2E', '/docs/%00', '/docs/%5Bparam%5D/../']) expect(() => assertPluginBuildRouteOwnership(root, [contributor('bad', bad)])).toThrow();
      await mkdir(join(root, 'café guide!'), { recursive: true }); await Bun.write(join(root, 'café guide!/page.tsx'), 'export default function Page(){return null}');
      expect(() => assertPluginBuildRouteOwnership(root, [plugin])).toThrow('conflicts');
    } finally { await app.stop(); await rm(root, { recursive: true, force: true }); }
  });
});
