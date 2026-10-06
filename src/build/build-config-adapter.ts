/** Adapt the existing config import during bundling without replacing the app-owned server entry. */
import { basename, dirname, extname, resolve } from 'node:path';
import type { PreparedAppBuild } from '../frontend/server/app-build';

/** Public compiled file-loader inputs; private content is embedded separately as manifest data. */
export interface EmbeddedBuildAsset { readonly publicPath: string; readonly filePath: string }
export interface EmbeddedPrivateBuildAsset { readonly pluginName: string; readonly name: string; readonly filePath: string }

/** Build the config wrapper source that preserves named exports and static server declarations. */
export function generatedBuildConfigSource(prepared: PreparedAppBuild, assets: readonly EmbeddedBuildAsset[], configExports: readonly string[] = [], privateAssets: readonly EmbeddedPrivateBuildAsset[] = []): string {
  const moduleImports = prepared.extensionModulePaths.map((path, index) => `import * as extension${index} from ${JSON.stringify(path)};`);
  const assetImports = assets.map((asset, index) => `import asset${index} from ${JSON.stringify(asset.filePath)} with { type: 'file' };`);
  const privateAssetImports = privateAssets.map((asset, index) => `import privateAsset${index} from ${JSON.stringify(asset.filePath)} with { type: 'file' };`);
  const sources = prepared.extensionModulePaths.map((path, index) => `...normalizeServerRouteModule(extension${index}, ${JSON.stringify(path)})`);
  const assetReferences = assets.map((asset, index) => `${JSON.stringify(asset.publicPath)}: new URL(asset${index}, import.meta.url)`);
  const privateFileReferences: Record<string, string[]> = Object.create(null);
  privateAssets.forEach((asset, index) => (privateFileReferences[asset.pluginName] ??= []).push(`${JSON.stringify(asset.name)}:new URL(privateAsset${index},import.meta.url)`));
  return [
    'import * as original from "zero:original-build-config";',
    'export * from "zero:original-build-config";',
    ...configExports.filter((name) => !['default', 'config', 'appConfig', 'zeroConfig'].includes(name)).map((name) => `export { ${JSON.stringify(name)} } from "zero:original-build-config";`),
    'import { normalizeServerRouteModule } from "@zero/framework/server";',
    ...moduleImports, ...assetImports, ...privateAssetImports,
    'const config = original.config ?? original.appConfig ?? original.zeroConfig ?? original.default;',
    `const frontendBuild = ${JSON.stringify({ ...prepared.manifest, frontend: { ...prepared.manifest.frontend, pluginSsrRuntime: 'bundled' } })};`,
    `const frontendAssetFiles = {${assetReferences.join(',')}};`,
    `const pluginBuildFiles = {${Object.entries(privateFileReferences).map(([name, references]) => `${JSON.stringify(name)}:{${references.join(',')}}`).join(',')}};`,
    `const serverExtensions = [...(config.serverExtensions ?? []), ${sources.join(',')}];`,
    'const preparedConfig = { ...config, projectRoot: config.projectRoot ?? process.cwd(), frontendBuild, frontendAssetFiles, pluginBuildFiles, serverExtensions, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false };',
    'export { preparedConfig as config, preparedConfig as appConfig, preparedConfig as zeroConfig };',
    'export default preparedConfig;',
  ].join('\n');
}

/** Intercept only the selected config import; its original module and all app hooks remain intact. */
export function createBuildConfigAdapter(configPath: string, prepared: PreparedAppBuild, assets: readonly EmbeddedBuildAsset[], configExports: readonly string[] = [], privateAssets: readonly EmbeddedPrivateBuildAsset[] = []): Bun.BunPlugin {
  const config = resolve(configPath);
  const stem = basename(config).replace(/\.[cm]?[jt]sx?$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const configFilter = new RegExp(`(?:^|/)${stem}(?:\\.[cm]?[jt]sx?)?$`);
  let adapted = false;
  return {
    name: 'zero-prepared-app-config',
    setup(build) {
      // Distinct virtual paths are necessary even with different namespaces:
      // Bun's module identity must not collapse the wrapper and original file.
      build.onResolve({ filter: /^zero:original-build-config$/ }, () => ({ path: `${config}.zero-original-source`, namespace: 'zero-original-build-config' }));
      build.onResolve({ filter: configFilter }, (args) => {
        if (args.namespace === 'zero-original-build-config') return undefined;
        let resolvedPath: string;
        try { resolvedPath = Bun.resolveSync(args.path, args.resolveDir || dirname(config)); } catch { return undefined; }
        if (resolve(resolvedPath) !== config) return undefined;
        adapted = true;
        return { path: `${config}.zero-prepared-source`, namespace: 'zero-prepared-app-config' };
      });
      build.onLoad({ filter: /.*/, namespace: 'zero-original-build-config' }, async () => ({ contents: await Bun.file(config).text(), loader: loaderForPath(config), resolveDir: dirname(config) }));
      build.onLoad({ filter: /.*/, namespace: 'zero-prepared-app-config' }, () => ({ contents: generatedBuildConfigSource(prepared, assets, configExports, privateAssets), loader: 'ts', resolveDir: dirname(config) }));
      build.onEnd(() => { if (!adapted) throw new Error('The app entry does not import the selected Zero config. Use --config for the actual module used by the entry.'); });
    },
  };
}

function loaderForPath(path: string): Bun.Loader { const ext = extname(path); return ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : ext === '.js' || ext === '.mjs' || ext === '.cjs' ? 'js' : 'ts'; }
