/** Compile optional declarative plugin contributions before assets/runtime setup. */
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { OBS_CODES, type emitPlatformCode } from '../../observability';
import { isZeroServerExtension, type ZeroPluginDefinition, type ZeroServerExtensionMountable } from './server-extensions';
import { resolveAppOwnedPath } from './app-project-root';
import { buildPluginFrontendAssets, pluginBuildNamespace } from './server-plugin-build-assets';
import { freezePluginJson } from './server-plugin-build-manifest';
import { AppPluginBuildError } from './server-plugin-build-error';
import { buildPluginPrivateAssets } from './server-plugin-build-private-assets';
import { assertPluginBuildRouteOwnership } from './server-plugin-build-route-ownership';
import type { ResolvedConfig } from './types';
import type { AppFrontendBuildManifest, ResolvedZeroPluginFrontendAssets, ZeroPluginBuildContext } from './server-plugin-build-types';

/** Gather nested declared contributors in mounting order; raw plugin setup is never executed. */
export function collectPluginBuildContributors(extensions: readonly ZeroServerExtensionMountable[]): readonly ZeroPluginDefinition[] {
  const contributors: ZeroPluginDefinition[] = [];
  const names = new Set<string>();
  const seen = new Set<unknown>();
  function walk(items: readonly ZeroServerExtensionMountable[]): void {
    for (const item of items) {
      if (!isZeroServerExtension(item) || seen.has(item)) continue;
      seen.add(item);
      if (item.kind === 'router') walk([...(item.routes ?? []), ...(item.endpoints ?? [])]);
      if (item.kind !== 'plugin' || !item.build) continue;
      if (names.has(item.name)) throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', `Plugin build name is duplicated: "${item.name}".`);
      names.add(item.name);
      contributors.push(item);
    }
  }
  walk(extensions);
  return Object.freeze(contributors);
}

/** Declared build outcomes used by shared asset compilation and runtime setup. */
export interface CompiledPluginContributions {
  readonly plugins: Readonly<Record<string, ResolvedZeroPluginFrontendAssets>>;
  readonly pluginIdentities: Readonly<Record<string, string | null>>;
  readonly styleSources: readonly string[];
  readonly requiredStyles: boolean;
}

/** Await all required content/style/browser work before any Elysia plugin setup runs. */
export async function compilePluginContributions(config: ResolvedConfig, contributors: readonly ZeroPluginDefinition[], mode: 'development' | 'production', emitCode: typeof emitPlatformCode): Promise<CompiledPluginContributions> {
  assertPluginBuildRouteOwnership(config.appDir, contributors);
  const plugins: Record<string, ResolvedZeroPluginFrontendAssets> = Object.create(null);
  const pluginIdentities: Record<string, string | null> = Object.create(null);
  const styleSources = new Set<string>();
  let requiredStyles = false;
  for (const plugin of contributors) {
    const namespace = pluginBuildNamespace(plugin.name);
    const context: ZeroPluginBuildContext = Object.freeze({
      projectRoot: config.projectRoot, appDir: config.appDir,
      appIdentity: Object.freeze({ ...config.app }),
      generatedDir: join(config.generatedDir, 'plugins', namespace),
      assetOutDir: join(config.outDir, 'plugins', namespace), publicBasePath: `/_build/plugins/${namespace}`, mode, emitCode,
    });
    try {
      const output = await plugin.build!.prepare(context);
      if (!output || typeof output !== 'object' || Array.isArray(output)) throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', 'Plugin compilation must return a declared output object.');
      const assets = await buildPluginFrontendAssets(context, output);
      const privateAssets = await buildPluginPrivateAssets(config.projectRoot, config.generatedDir, plugin.name, output.privateAssets ?? []);
      const sources = output.styleSources ?? [];
      const resolvedSources = sources.map((source) => resolveAppOwnedPath(config.projectRoot, source));
      for (const source of resolvedSources) {
        if (!(await stat(source).then((info) => info.isFile() || info.isDirectory(), () => false))) throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', 'Declared plugin stylesheet source is missing or unsupported.');
      }
      requiredStyles ||= (sources.length > 0 || (output.styles?.length ?? 0) > 0 || (output.browserEntries?.length ?? 0) > 0) && plugin.build!.required !== false;
      for (const source of resolvedSources) styleSources.add(source);
      plugins[plugin.name] = Object.freeze({ publicBasePath: context.publicBasePath, assets, ...(Object.keys(privateAssets).length === 0 ? {} : { privateAssets }), ...(output.data === undefined ? {} : { data: freezePluginJson(output.data) }) });
      pluginIdentities[plugin.name] = plugin.build!.identity ?? null;
      emitCode(OBS_CODES.APP_PLUGIN_BUILD_READY, { metadata: { plugin: plugin.name, stage: 'contribution' } });
    } catch (error) {
      emitCode(OBS_CODES.APP_PLUGIN_BUILD_FAILED, { metadata: { plugin: plugin.name, stage: 'contribution' } });
      if (plugin.build!.required !== false) {
        throw error instanceof AppPluginBuildError ? error : new AppPluginBuildError('APP_PLUGIN_BUILD_FAILED', `Required plugin "${plugin.name}" failed to compile.`, { cause: error });
      }
    }
  }
  return Object.freeze({ plugins: Object.freeze(plugins), pluginIdentities: Object.freeze(pluginIdentities), styleSources: Object.freeze([...styleSources]), requiredStyles });
}

/** Match persisted output to current declarations; required production work is never silently rebuilt. */
export function assertPluginBuildManifestMatches(contributors: readonly ZeroPluginDefinition[], manifest: AppFrontendBuildManifest): void {
  const names = new Set(contributors.map((plugin) => plugin.name));
  for (const plugin of contributors) {
    const result = manifest.frontend.plugins[plugin.name];
    if (!result && plugin.build!.required !== false) throw new AppPluginBuildError('APP_PLUGIN_BUILD_MISSING', `Required plugin "${plugin.name}" has no compiled artifact. Run the normal Zero build first.`);
    if (result && manifest.pluginIdentities[plugin.name] !== (plugin.build!.identity ?? null)) throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', `Compiled plugin "${plugin.name}" does not match its declared configuration.`);
  }
  for (const name of Object.keys(manifest.frontend.plugins)) {
    if (!names.has(name)) throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', 'Compiled frontend artifact includes an undeclared plugin.');
  }
}
