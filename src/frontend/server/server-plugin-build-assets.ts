/** Bundle/copy declared public plugin files without exposing private compiled content. */
import { mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { createAppDependencyAliasPlugin } from './client-bundle';
import { AppPluginBuildError } from './server-plugin-build-error';
import { readPluginBuildFile } from './server-plugin-build-file';
import type { ZeroPluginBuildContext, ZeroPluginBuildFile, ZeroPluginBuildOutput, ResolvedZeroPluginFrontendAsset } from './server-plugin-build-types';

/** Create stable, collision-resistant namespace identity without using machine-specific paths. */
export function pluginBuildNamespace(name: string): string {
  const slug = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'plugin';
  return `${slug}-${new Bun.CryptoHasher('sha256').update(name).digest('hex').slice(0, 12)}`;
}

/** Resolve and build declared files. Browser dependency identity remains owned by the host app. */
export async function buildPluginFrontendAssets(context: ZeroPluginBuildContext, output: ZeroPluginBuildOutput): Promise<Readonly<Record<string, ResolvedZeroPluginFrontendAsset>>> {
  const assets: Record<string, ResolvedZeroPluginFrontendAsset> = Object.create(null);
  await mkdir(context.assetOutDir, { recursive: true });
  const entries: Array<{ file: ZeroPluginBuildFile; kind: ResolvedZeroPluginFrontendAsset['kind'] }> = [
    ...(output.browserEntries ?? []).map((file) => ({ file, kind: 'script' as const })),
    ...(output.styles ?? []).map((file) => ({ file, kind: 'style' as const })),
    ...(output.assets ?? []).map((file) => ({ file, kind: 'asset' as const })),
  ];
  for (const { file, kind } of entries) {
    if (!file || typeof file.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(file.name) || Object.hasOwn(assets, file.name)) {
      throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', 'Plugin asset names must be unique bounded identifiers.');
    }
    const publicPath = kind === 'script'
      ? await bundleEntry(context, file)
      : await copyPublicFile(context, file, kind);
    if (file.contentType && /[\r\n]/.test(file.contentType)) throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', 'Plugin asset content type is invalid.');
    assets[file.name] = Object.freeze({ publicPath, kind, ...(file.contentType ? { contentType: file.contentType } : {}) });
  }
  return Object.freeze(assets);
}

async function bundleEntry(context: ZeroPluginBuildContext, file: ZeroPluginBuildFile): Promise<string> {
  const admitted = await readPluginBuildFile(context.projectRoot, file);
  const loader = browserEntryLoader(admitted.path);
  const snapshot: Bun.BunPlugin = { name: 'zero-admitted-plugin-entry', setup(build) {
    build.onResolve({ filter: /.*/, namespace: 'file' }, args => args.kind === 'entry-point-build'
      ? { path: admitted.path, namespace: 'file' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'file' }, args => args.path === admitted.path
      ? { contents: admitted.bytes, loader, resolveDir: dirname(admitted.path) } : undefined);
  } };
  const result = await Bun.build({
    entrypoints: [admitted.path], outdir: context.assetOutDir, target: 'browser', format: 'esm', splitting: true,
    naming: { entry: `${file.name}.[hash].[ext]`, chunk: 'chunk.[hash].[ext]', asset: '[name].[hash].[ext]' },
    minify: context.mode === 'production', sourcemap: 'none',
    define: { 'process.env.NODE_ENV': JSON.stringify(context.mode) },
    plugins: [snapshot, createAppDependencyAliasPlugin(context.appDir)],
  });
  if (!result.success) throw new AppPluginBuildError('APP_PLUGIN_BUILD_FAILED', 'Declared plugin browser entry could not be bundled.');
  const entry = result.outputs.find((item) => item.kind === 'entry-point');
  if (!entry) throw new AppPluginBuildError('APP_PLUGIN_BUILD_FAILED', 'Declared plugin browser bundle has no entry output.');
  return `${context.publicBasePath}/${basename(entry.path)}`;
}

function browserEntryLoader(path: string): Bun.Loader {
  switch (extname(path).toLowerCase()) {
    case '.ts': case '.mts': case '.cts': return 'ts';
    case '.tsx': return 'tsx';
    case '.js': case '.mjs': case '.cjs': return 'js';
    case '.jsx': return 'jsx';
    default: throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', 'Declared plugin browser entry must be JavaScript or TypeScript.');
  }
}

async function copyPublicFile(context: ZeroPluginBuildContext, file: ZeroPluginBuildFile, kind: 'style' | 'asset'): Promise<string> {
  const { bytes, path, hash: contentHash } = await readPluginBuildFile(context.projectRoot, file);
  const hash = contentHash.slice(0, 16);
  const extension = kind === 'style' ? '.css' : extname(path).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  const filename = `${file.name}.${hash}${extension}`;
  await Bun.write(join(context.assetOutDir, filename), bytes);
  return `${context.publicBasePath}/${filename}`;
}
