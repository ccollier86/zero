/** Prepare declared frontend content/assets, then bundle the existing application server entry. */
import { mkdir, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppConfig } from '../frontend/server/types';
import { prepareAppBuild } from '../frontend/server/app-build';
import { createAppDependencyAliasPlugin } from '../frontend/server/client-bundle';
import { createBuildConfigAdapter, type EmbeddedBuildAsset, type EmbeddedPrivateBuildAsset } from './build-config-adapter';
import type { ZeroBuildOptions, ZeroBuildResult } from './build-types';

/** Execute the normal build without starting the app, invoking runtime setup or opening databases. */
export async function buildZeroApp(options: ZeroBuildOptions): Promise<ZeroBuildResult> {
  const configPath = resolve(options.configPath);
  if (!(await Bun.file(configPath).exists())) throw new Error('Zero build config module was not found.');
  const module = await import(pathToFileURL(configPath).href);
  const config: AppConfig = module.config ?? module.appConfig ?? module.zeroConfig ?? module.default;
  if (!config || typeof config !== 'object') throw new Error('Zero build config must export a default/config/appConfig/zeroConfig AppConfig object.');
  const projectRoot = config.projectRoot ?? dirname(configPath);
  const prepared = await prepareAppBuild({ ...config, projectRoot }, { mode: 'production' });
  const entryPath = resolve(prepared.config.projectRoot, options.entryPath ?? './app/server.ts');
  if (!(await Bun.file(entryPath).exists())) throw new Error('The app server entry was not found.');
  const outDir = resolve(prepared.config.projectRoot, options.outDir ?? 'dist');
  const assets = await collectBuildAssets(prepared.config.outDir);
  const privateAssets: EmbeddedPrivateBuildAsset[] = Object.entries(prepared.frontend.plugins).flatMap(([pluginName, plugin]) => Object.entries(plugin.privateAssets ?? {}).map(([name, asset]) => ({ pluginName, name, filePath: join(prepared.config.generatedDir, asset.artifactPath) })));
  const serverName = options.compile ? options.outfile ?? 'server' : 'server.js';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(serverName)) throw new Error('Zero executable --outfile must be a simple filename, not a path.');
  await mkdir(outDir, { recursive: true });
  const [publicRoot, serverRoot] = await Promise.all([realpath(prepared.config.outDir), realpath(outDir)]);
  const location = relative(publicRoot, serverRoot);
  if (location === '' || (!isAbsolute(location) && location !== '..' && !location.startsWith('../'))) throw new Error('Server build output must stay outside the public /_build asset directory.');
  const result = await Bun.build({
    entrypoints: [entryPath], outdir: outDir, target: 'bun', format: 'esm',
    minify: false, sourcemap: 'none', naming: { entry: serverName, asset: '[name].[hash].[ext]' },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    ...(options.compile ? { compile: { outfile: join(outDir, serverName) } } : {}),
    plugins: [createBuildConfigAdapter(configPath, prepared, assets, Object.keys(module), privateAssets), createAppDependencyAliasPlugin(prepared.config.appDir)],
  });
  if (!result.success) throw new Error(`Zero server build failed: ${result.logs.map((log) => log.message).join('\n')}`);
  const entry = result.outputs.find((output) => output.kind === 'entry-point');
  return Object.freeze({ serverPath: options.compile ? join(outDir, serverName) : entry?.path ?? join(outDir, serverName), privateManifestPath: prepared.privateManifestPath, publicAssetCount: assets.length, pluginCount: Object.keys(prepared.frontend.plugins).length });
}

/** Only public build files become file-loader inputs; private generated metadata is outside this tree. */
async function collectBuildAssets(root: string): Promise<readonly EmbeddedBuildAsset[]> {
  const assets: EmbeddedBuildAsset[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const filePath = join(directory, entry.name);
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(filePath, path);
      else if (entry.isFile()) assets.push(Object.freeze({ publicPath: `/_build${path}`, filePath }));
    }
  }
  await walk(root, '');
  return Object.freeze(assets.sort((a, b) => a.publicPath.localeCompare(b.publicPath)));
}
