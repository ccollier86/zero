/** Qualify the real public plugin/build/mount handshake without creating a database or real app. */
import { describe, expect, test } from 'bun:test';
import { rename, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prepareAppBuild, createServerExtensionApp } from '@zero/framework/server';
import { docs } from '../index';
import { docsRuntimeFixture } from './test-fixture';

describe('docs native public integration', () => {
  test('normal prepare and native mount include the actual script/style URLs and deploy without source documents', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Native reader\n\n[File](report.pdf)\n\n```ts\nconst ready = true;\n```',
      'report.pdf': '%PDF-1.7\nNATIVE_PRIVATE_ATTACHMENT', 'private.md': '---\nvisibility: private\n---\n# NATIVE_PRIVATE_SOURCE' });
    const plugin = docs({ contentDir: './documentation', watch: false });
    try {
      // A real consuming app owns its React installation. This synthetic package root reuses the test dependencies read-only.
      await symlink(resolve(import.meta.dir, '../../../../node_modules'), join(fixture.root, 'node_modules'), 'dir');
      const prepared = await prepareAppBuild({ projectRoot: fixture.root, db: { mode: 'ephemeral' }, tables: {}, auth: false, email: false, migrate: false,
        serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, serverResourcesDir: false, serverExtensions: [plugin] },
        { emitCode: fixture.build.emitCode });
      const declared = prepared.frontend.plugins[plugin.name]!;
      expect(Object.values(declared.assets).filter(asset => asset.kind === 'script')).toHaveLength(1); expect(Object.values(declared.assets).filter(asset => asset.kind === 'style')).toHaveLength(1);
      expect(Object.keys(declared.privateAssets ?? {})).toHaveLength(1); expect(Object.values(declared.assets).some(asset => asset.kind === 'asset')).toBe(false);
      const publicFiles = await Promise.all(Object.values(declared.assets).map(asset => Bun.file(join(prepared.config.outDir, asset.publicPath.slice('/_build/'.length))).text()));
      expect(publicFiles.join('\n')).not.toContain('NATIVE_PRIVATE_SOURCE'); expect(publicFiles.join('\n')).not.toContain('NATIVE_PRIVATE_ATTACHMENT');
      await rename(fixture.root + '/documentation', fixture.root + '/not-runtime-source');
      const mounted = await createServerExtensionApp({ extensions: [...prepared.extensions], frontendContext: { projectRoot: fixture.root, appDir: prepared.config.appDir,
        generatedDir: prepared.config.generatedDir, frontend: prepared.frontend } });
      const response = await mounted.handle(new Request('http://localhost/docs')), html = await response.text();
      expect(response.status).toBe(200); expect(html).toContain('Native reader'); expect(html).toContain('zero-docs-root');
      for (const asset of Object.values(declared.assets)) expect(html).toContain(asset.publicPath);
      expect(html).not.toContain('NATIVE_PRIVATE_SOURCE'); expect(html).not.toContain(fixture.root);
      const data = declared.data as unknown as { manifest: { assets: readonly { route: string }[] } };
      const attachment = await mounted.handle(new Request('http://localhost' + data.manifest.assets[0]!.route));
      expect(attachment.status).toBe(200); expect(await attachment.text()).toContain('NATIVE_PRIVATE_ATTACHMENT'); expect(attachment.headers.get('content-disposition')).toStartWith('attachment;');
      expect((await mounted.handle(new Request('http://localhost/docs/private'))).status).toBe(404);
    } finally { await fixture.close(); }
  }, 60_000);
});
