/** Admit declared browser entry bytes before bundling; dependencies retain normal Bun resolution. */
import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { buildPluginFrontendAssets } from './server-plugin-build-assets';
import { readPluginBuildFile } from './server-plugin-build-file';
import type { ZeroPluginBuildContext } from './server-plugin-build-types';
import { configureObservability, emitPlatformCodeTo } from '../../observability';

const observability = configureObservability(false);
async function fixture() {
  const root = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(root, { recursive: true });
  const projectRoot = await mkdtemp(join(root, 'plugin-entry-admission-'));
  const context: ZeroPluginBuildContext = { projectRoot, appDir: join(projectRoot, 'app'), appIdentity: {},
    generatedDir: join(projectRoot, 'private'), assetOutDir: join(projectRoot, 'public'),
    publicBasePath: '/_build/plugins/test', mode: 'production', emitCode: (code, options) => emitPlatformCodeTo(observability, code, options) };
  return { projectRoot, context };
}
const hash = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');

describe('browser entry snapshot admission', () => {
  test('rejects incorrect hashes and out-of-root browser entries before publishing a script', async () => {
    const { projectRoot, context } = await fixture();
    try {
      await mkdir(join(projectRoot, 'allowed'));
      await Bun.write(join(projectRoot, 'entry.ts'), 'globalThis.__zeroAdmission = "source";');
      await expect(buildPluginFrontendAssets(context, { browserEntries: [{ name: 'reader', path: 'entry.ts', contentHash: '0'.repeat(64) }] }))
        .rejects.toMatchObject({ code: 'APP_PLUGIN_BUILD_CONFIG_INVALID' });
      await expect(buildPluginFrontendAssets(context, { browserEntries: [{ name: 'reader', path: 'entry.ts', sourceRoot: 'allowed' }] }))
        .rejects.toMatchObject({ code: 'APP_PLUGIN_BUILD_CONFIG_INVALID' });
      await symlink(join(projectRoot, 'entry.ts'), join(projectRoot, 'allowed', 'escape.ts'));
      await expect(buildPluginFrontendAssets(context, { browserEntries: [{ name: 'reader', path: 'allowed/escape.ts', sourceRoot: 'allowed' }] }))
        .rejects.toMatchObject({ code: 'APP_PLUGIN_BUILD_CONFIG_INVALID' });
      expect([...new Bun.Glob('*.js').scanSync({ cwd: context.assetOutDir })]).toEqual([]);
    } finally { await rm(projectRoot, { recursive: true, force: true }); }
  });

  test('bundles admitted bytes after the pathname is replaced while preserving relative imports and split chunks', async () => {
    const { projectRoot, context } = await fixture();
    const source = 'import { value } from "./dependency"; globalThis.__zeroAdmission = "ADMITTED_MARKER" + value; export const lazy = () => import("./lazy");';
    const entry = join(projectRoot, 'entry.ts');
    let replaced = false;
    const originalBuild = Bun.build;
    const build = spyOn(Bun, 'build').mockImplementation(async options => {
      if (!replaced) {
        replaced = true;
        await unlink(entry);
        await symlink(join(projectRoot, 'replacement.ts'), entry);
      }
      return originalBuild(options);
    });
    try {
      await Bun.write(entry, source);
      await Bun.write(join(projectRoot, 'replacement.ts'), 'globalThis.__zeroAdmission = "REPLACED_MARKER";');
      await Bun.write(join(projectRoot, 'dependency.ts'), 'export const value = "RELATIVE_MARKER";');
      await Bun.write(join(projectRoot, 'lazy.ts'), 'export const value = "LAZY_MARKER";');
      const result = await buildPluginFrontendAssets(context, { browserEntries: [{ name: 'reader', path: entry, sourceRoot: projectRoot, contentHash: hash(source) }] });
      const files = [...new Bun.Glob('*.js').scanSync({ cwd: context.assetOutDir })];
      const output = await Bun.file(join(context.assetOutDir, basename(result.reader!.publicPath))).text();
      expect(replaced).toBe(true);
      expect(output).toContain('ADMITTED_MARKER'); expect(output).toContain('RELATIVE_MARKER');
      expect(output).not.toContain('REPLACED_MARKER');
      expect(files.some(file => file.startsWith('chunk.'))).toBe(true);
      const module = await import(join(context.assetOutDir, basename(result.reader!.publicPath)));
      expect((await module.lazy()).value).toBe('LAZY_MARKER');
    } finally { build.mockRestore(); delete (globalThis as Record<string, unknown>).__zeroAdmission; await rm(projectRoot, { recursive: true, force: true }); }
  });

  test('regular copied files and browser entries share canonical admitted path/hash semantics', async () => {
    const { projectRoot } = await fixture();
    try {
      await mkdir(join(projectRoot, 'allowed'));
      const source = 'export const marker = "source";';
      await Bun.write(join(projectRoot, 'allowed', 'actual.ts'), source);
      await symlink(join(projectRoot, 'allowed', 'actual.ts'), join(projectRoot, 'link.ts'));
      const admitted = await readPluginBuildFile(projectRoot, { name: 'source', path: 'link.ts', sourceRoot: 'allowed', contentHash: hash(source) });
      expect(admitted.path).toBe(join(projectRoot, 'allowed', 'actual.ts'));
      expect(new TextDecoder().decode(admitted.bytes)).toBe(source); expect(admitted.hash).toBe(hash(source));
      await expect(readPluginBuildFile(projectRoot, { name: 'directory', path: 'allowed' })).rejects.toMatchObject({ code: 'APP_PLUGIN_BUILD_CONFIG_INVALID' });
    } finally { await rm(projectRoot, { recursive: true, force: true }); }
  });

  test('production ESM preserves imported serializer aliases across the dependency graph', async () => {
    const { projectRoot, context } = await fixture();
    try {
      const serializer = Bun.resolveSync('@shikijs/core', import.meta.dir);
      const source = `import { hastToHtml } from ${JSON.stringify(serializer)};
export const html = hastToHtml({ type: 'root', children: [{ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: '<admitted & escaped>' }] }] });`;
      await Bun.write(join(projectRoot, 'entry[owned].ts'), source);
      const assets = await buildPluginFrontendAssets(context, { browserEntries: [{ name: 'reader', path: 'entry[owned].ts', sourceRoot: projectRoot, contentHash: hash(source) }] });
      const module = await import(join(context.assetOutDir, basename(assets.reader!.publicPath)));
      expect(module.html).toBe('<p>&#x3C;admitted &#x26; escaped></p>');
    } finally { await rm(projectRoot, { recursive: true, force: true }); }
  });
});
