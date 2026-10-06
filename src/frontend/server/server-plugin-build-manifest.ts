/** Validate and freeze portable build metadata; never publish private plugin data as a file asset. */
import { AppPluginBuildError } from './server-plugin-build-error';
import { pluginBuildNamespace } from './server-plugin-build-assets';
import type { AppFrontendBuildManifest, ZeroPluginJsonValue } from './server-plugin-build-types';

/** Copy JSON data into getter-free, immutable plain containers with no executable metadata. */
export function freezePluginJson(value: unknown, depth = 0): ZeroPluginJsonValue {
  if (depth > 100) throw invalid('Plugin compiled data exceeds the supported nesting depth.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') throw invalid('Plugin compiled data must contain only JSON values.');
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null && !Array.isArray(value)) throw invalid('Plugin compiled data must use plain JSON objects.');
  if (Object.getOwnPropertySymbols(value).length > 0) throw invalid('Plugin compiled data contains unsupported symbol metadata.');
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw invalid('Plugin compiled arrays must not contain sparse entries.');
  const result: Record<string, ZeroPluginJsonValue> | ZeroPluginJsonValue[] = Array.isArray(value) ? [] : Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!('value' in descriptor)) throw invalid('Plugin compiled data must not contain accessors.');
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) throw invalid('Plugin compiled arrays cannot contain custom metadata.');
    Object.defineProperty(result, key, { value: freezePluginJson(descriptor.value, depth + 1), enumerable: true });
  }
  return Object.freeze(result);
}

/** Admit an app artifact before setup; local namespaced URLs cannot point outside declared assets. */
export function admitAppFrontendBuildManifest(value: unknown): AppFrontendBuildManifest {
  const snapshot = freezePluginJson(value);
  if (!isRecord(snapshot)) throw invalid('The compiled frontend artifact must be an object.');
  const manifest = snapshot as unknown as AppFrontendBuildManifest;
  if (manifest.version !== 1 || !manifest.frontend || !isRecord(manifest.frontend.plugins) || !isRecord(manifest.pluginIdentities)) throw invalid('The compiled frontend artifact has an unsupported shape/version.');
  if (manifest.frontend.clientEntry !== undefined && !isBuildUrl(manifest.frontend.clientEntry)) throw invalid('Compiled client entry URL is invalid.');
  if (manifest.frontend.cssPath !== undefined && !isBuildUrl(manifest.frontend.cssPath)) throw invalid('Compiled platform stylesheet URL is invalid.');
  if (manifest.frontend.pluginSsrRuntime !== undefined && !['app', 'bundled'].includes(manifest.frontend.pluginSsrRuntime)) throw invalid('Compiled plugin SSR runtime selection is invalid.');
  for (const [name, plugin] of Object.entries(manifest.frontend.plugins)) {
    const publicBasePath = `/_build/plugins/${pluginBuildNamespace(name)}`;
    if (!plugin || plugin.publicBasePath !== publicBasePath || !isRecord(plugin.assets)) throw invalid('Compiled plugin asset namespace is invalid.');
    for (const asset of Object.values(plugin.assets)) {
      if (!asset || !['script', 'style', 'asset'].includes(asset.kind) || !isBuildUrl(asset.publicPath) || !asset.publicPath.startsWith(`${publicBasePath}/`)) throw invalid('Compiled plugin asset URL is invalid.');
      if (asset.contentType !== undefined && (typeof asset.contentType !== 'string' || /[\r\n]/.test(asset.contentType))) throw invalid('Compiled plugin asset content type is invalid.');
    }
    if (plugin.privateAssets !== undefined) {
      if (!isRecord(plugin.privateAssets)) throw invalid('Compiled private plugin assets are invalid.');
      for (const asset of Object.values(plugin.privateAssets)) {
        if (!asset || typeof asset.artifactPath !== 'string' || !asset.artifactPath.startsWith(`plugin-assets/${pluginBuildNamespace(name)}/`) || !/^[a-zA-Z0-9/_\-.]+$/.test(asset.artifactPath) || asset.artifactPath.split('/').some((part) => part === '.' || part === '..')) throw invalid('Compiled private plugin asset path is invalid.');
        if (asset.contentType !== undefined && (typeof asset.contentType !== 'string' || /[\r\n]/.test(asset.contentType))) throw invalid('Compiled private plugin asset content type is invalid.');
      }
    }
  }
  for (const identity of Object.values(manifest.pluginIdentities)) {
    if (identity !== null && (typeof identity !== 'string' || identity.length === 0)) throw invalid('Compiled plugin configuration identity is invalid.');
  }
  return manifest;
}

function isBuildUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\/_build\/[a-zA-Z0-9/_\-.]+$/.test(value) && !value.split('/').some((part) => part === '.' || part === '..');
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function invalid(message: string): AppPluginBuildError { return new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', message); }
