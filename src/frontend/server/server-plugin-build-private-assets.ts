/** Snapshot declared private plugin files outside public build serving and source discovery. */
import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pluginBuildNamespace } from './server-plugin-build-assets';
import { AppPluginBuildError } from './server-plugin-build-error';
import { readPluginBuildFile } from './server-plugin-build-file';
import type { ZeroPluginBuildFile } from './server-plugin-build-types';

/** Copy admitted attachments to immutable private artifacts; the plugin owns HTTP admission. */
export async function buildPluginPrivateAssets(projectRoot: string, generatedDir: string, pluginName: string, files: readonly ZeroPluginBuildFile[]): Promise<Readonly<Record<string, { readonly artifactPath: string; readonly contentType?: string }>>> {
  const result: Record<string, { readonly artifactPath: string; readonly contentType?: string }> = Object.create(null);
  const namespace = pluginBuildNamespace(pluginName);
  const relativeDir = `plugin-assets/${namespace}`;
  await mkdir(join(generatedDir, relativeDir), { recursive: true });
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(file.name) || Object.hasOwn(result, file.name)) throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', 'Private plugin asset names must be unique bounded identifiers.');
    const { path: source, bytes, hash: contentHash } = await readPluginBuildFile(projectRoot, file);
    const hash = contentHash.slice(0, 16);
    const extension = extname(source).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
    const artifactPath = `${relativeDir}/${file.name}.${hash}${extension}`;
    if (file.contentType && (typeof file.contentType !== 'string' || /[\r\n]/.test(file.contentType))) throw new AppPluginBuildError('APP_PLUGIN_BUILD_CONFIG_INVALID', 'Private plugin asset content type is invalid.');
    await Bun.write(join(generatedDir, artifactPath), bytes);
    result[file.name] = Object.freeze({ artifactPath, ...(file.contentType ? { contentType: file.contentType } : {}) });
  }
  return Object.freeze(result);
}
