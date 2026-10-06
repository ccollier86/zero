/** Prepare app assets and native plugin content without opening databases or runtime services. */
import { mkdir, realpath, rename } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { emitPlatformCode, type emitPlatformCode as EmitCode } from '../../observability';
import { buildAppAssets } from './app-build-assets';
import { loadServerRouteDiscovery } from './server-route-loader';
import type { ZeroServerExtensionMountable } from './server-extensions';
import { admitAppFrontendBuildManifest } from './server-plugin-build-manifest';
import { assertPluginBuildManifestMatches, collectPluginBuildContributors, compilePluginContributions } from './server-plugin-build';
import { AppPluginBuildError } from './server-plugin-build-error';
import { assertPluginBuildRouteOwnership } from './server-plugin-build-route-ownership';
import type { AppFrontendBuildManifest, ResolvedAppFrontendAssets } from './server-plugin-build-types';
import { resolveConfig, type AppConfig, type ResolvedConfig } from './types';

/** Immutable build result consumed by generated production entries and app setup. */
export interface PreparedAppBuild {
  readonly config: ResolvedConfig;
  readonly extensions: readonly ZeroServerExtensionMountable[];
  readonly frontend: ResolvedAppFrontendAssets;
  readonly manifest: AppFrontendBuildManifest;
  readonly privateManifestPath: string;
  /** Source declaration modules included statically by the normal server bundler. */
  readonly extensionModulePaths: readonly string[];
}

/** Discover once, prepare plugin content, then build shared frontend assets without touching databases. */
export async function prepareAppBuild(userConfig: AppConfig, options: { readonly mode?: 'development' | 'production'; readonly emitCode?: typeof EmitCode } = {}): Promise<PreparedAppBuild> {
  const config = resolveConfig(userConfig);
  const discovered = await discoverAppServerExtensionDeclarations(config);
  return compileResolvedAppBuild(config, discovered.extensions, options.mode ?? 'production', options.emitCode ?? emitPlatformCode, discovered.modulePaths);
}

/** Reuse configured declarations and discovered modules without invoking runtime setup. */
export async function discoverAppServerExtensions(config: ResolvedConfig, options: { readonly runtime?: import('../../runtime/zero-app-runtime').ZeroAppRuntime } = {}): Promise<readonly ZeroServerExtensionMountable[]> {
  return (await discoverAppServerExtensionDeclarations(config, options)).extensions;
}

/** Preserve declaration source paths for build-time static inclusion without importing modules twice. */
export async function discoverAppServerExtensionDeclarations(config: ResolvedConfig, options: { readonly runtime?: import('../../runtime/zero-app-runtime').ZeroAppRuntime } = {}) {
  const discovered = await loadServerRouteDiscovery({ runtime: options.runtime, extensionDirs: [
    { kind: 'plugins', dir: config.serverPluginsDir }, { kind: 'middleware', dir: config.serverMiddlewareDir },
    { kind: 'endpoints', dir: config.serverEndpointsDir }, { kind: 'routes', dir: config.serverRoutesDir },
  ] });
  return Object.freeze({ extensions: Object.freeze([...config.serverExtensions, ...discovered.extensions]), modulePaths: discovered.modulePaths });
}

/** Compile a previously discovered list so managed startup cannot import/mount declarations twice. */
export async function compileResolvedAppBuild(config: ResolvedConfig, extensions: readonly ZeroServerExtensionMountable[], mode: 'development' | 'production', emitCode: typeof EmitCode, extensionModulePaths: readonly string[] = []): Promise<PreparedAppBuild> {
  await assertPrivateGeneratedDirectory(config);
  const contributions = await compilePluginContributions(config, collectPluginBuildContributors(extensions), mode, emitCode);
  const assets = await buildAppAssets(config, emitCode, { styleSources: contributions.styleSources, requiredStyles: contributions.requiredStyles });
  const manifest = admitAppFrontendBuildManifest({ version: 1, frontend: { ...assets, plugins: contributions.plugins }, pluginIdentities: contributions.pluginIdentities });
  const privateManifestPath = join(config.generatedDir, 'frontend-build.json');
  await mkdir(config.generatedDir, { recursive: true });
  const temporaryPath = `${privateManifestPath}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporaryPath, JSON.stringify(manifest));
  await rename(temporaryPath, privateManifestPath);
  return Object.freeze({ config, extensions, frontend: manifest.frontend, manifest, privateManifestPath, extensionModulePaths: Object.freeze([...extensionModulePaths]) });
}

/** Use a built production artifact, or compile ordinary development/legacy frontend assets. */
export async function resolveAppFrontendBuild(config: ResolvedConfig, extensions: readonly ZeroServerExtensionMountable[], emitCode: typeof EmitCode): Promise<ResolvedAppFrontendAssets> {
  const contributors = collectPluginBuildContributors(extensions);
  assertPluginBuildRouteOwnership(config.appDir, contributors);
  if (config.frontendBuild) {
    const manifest = admitAppFrontendBuildManifest(config.frontendBuild);
    assertPluginBuildManifestMatches(contributors, manifest);
    await assertFrontendAssetsExist(config, manifest.frontend);
    return manifest.frontend;
  }
  if (process.env.NODE_ENV === 'production' && contributors.some((plugin) => plugin.build!.required !== false)) throw new AppPluginBuildError('APP_PLUGIN_BUILD_MISSING', 'Declared plugin content requires a precompiled frontend artifact in production. Run the normal Zero build first.');
  if (process.env.NODE_ENV === 'production') return Object.freeze({ ...await buildAppAssets(config, emitCode), plugins: Object.freeze({}) });
  if (contributors.length === 0) return Object.freeze({ ...await buildAppAssets(config, emitCode), plugins: Object.freeze({}) });
  return (await compileResolvedAppBuild(config, extensions, 'development', emitCode)).frontend;
}

async function assertFrontendAssetsExist(config: ResolvedConfig, frontend: ResolvedAppFrontendAssets): Promise<void> {
  const urls = [frontend.clientEntry, frontend.cssPath, ...Object.values(frontend.plugins).flatMap((plugin) => Object.values(plugin.assets).map((asset) => asset.publicPath))].filter((value): value is string => value !== undefined);
  for (const url of urls) {
    if (!(await Bun.file(config.frontendAssetFiles[url] ?? join(config.outDir, url.slice('/_build/'.length))).exists())) throw new AppPluginBuildError('APP_PLUGIN_BUILD_MISSING', 'A declared compiled frontend asset is missing from the deployed build directory.');
  }
  for (const [name, plugin] of Object.entries(frontend.plugins)) {
    for (const [key, file] of Object.entries(plugin.privateAssets ?? {})) {
      if (!(await Bun.file(config.pluginBuildFiles[name]?.[key] ?? join(config.generatedDir, file.artifactPath)).exists())) throw new AppPluginBuildError('APP_PLUGIN_BUILD_MISSING', 'A declared private plugin attachment is missing from the deployed build.');
    }
  }
}

async function assertPrivateGeneratedDirectory(config: ResolvedConfig): Promise<void> {
  await Promise.all([mkdir(config.outDir, { recursive: true }), mkdir(config.generatedDir, { recursive: true })]);
  const [publicPath, privatePath] = await Promise.all([realpath(config.outDir), realpath(config.generatedDir)]);
  const location = relative(publicPath, privatePath);
  if (location === '' || (!isAbsolute(location) && location !== '..' && !location.startsWith('../'))) throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', 'Private generated plugin content must be outside the public build directory.');
}
