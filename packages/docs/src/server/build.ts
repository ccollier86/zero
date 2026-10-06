/** Required docs compilation produces portable content and only admitted private attachment files. */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { ZeroPluginBuildContext, ZeroPluginBuildOutput, ZeroPluginJsonValue } from '@zero/framework/server';
import { OBS_CODES } from '@zero/framework/server';
import { compileDocsContent, readDocsAsset } from '../content';
import type { ResolvedDocsOptions } from '../options';
import { compileDocsHighlights } from './highlights';
import type { DocsBuildData, DocsSnapshot } from './types';
import { freezeDocsValue } from '../content/identity';
import { assertDocsPlatformRoutes } from './route-ownership';
import { docsFailure } from '../content/errors';

export function docsContentRoot(projectRoot: string, options: ResolvedDocsOptions): string { return isAbsolute(options.contentDir) ? options.contentDir : resolve(projectRoot, options.contentDir); }
export async function compileDocsSnapshot(projectRoot: string, options: ResolvedDocsOptions, mode: 'development' | 'production', emit: ZeroPluginBuildContext['emitCode']): Promise<DocsSnapshot> {
  const root = docsContentRoot(projectRoot, options);
  const manifest = await compileDocsContent({ ...options, contentDir: root, mode, emit: event => emit(OBS_CODES[event.code], { metadata: { ...event.metadata } }) });
  assertDocsPlatformRoutes(manifest);
  const assets = new Map<string, Uint8Array>();
  for (const asset of manifest.assets) assets.set(asset.id, await readDocsAsset(root, asset));
  const highlights = await compileDocsHighlights(manifest);
  // Highlighting/attachment reads can await external work after the compiler's admission. Recheck
  // the entire publication input before commit so a newly private document cannot bridge those phases.
  const settled = await compileDocsContent({ ...options, contentDir: root, mode });
  if (settled.hash !== manifest.hash) docsFailure('DOCS_SOURCE_INVALID', 'Documentation inputs changed while preparing the build snapshot; retry the build.');
  const data: DocsBuildData = freezeDocsValue({ version: 1, mode, manifest, highlights });
  return Object.freeze({ data, assets });
}
export async function prepareDocsBuild(context: ZeroPluginBuildContext, options: ResolvedDocsOptions): Promise<ZeroPluginBuildOutput> {
  const snapshot = await compileDocsSnapshot(context.projectRoot, options, context.mode, context.emitCode);
  await mkdir(context.generatedDir, { recursive: true });
  const directory = await mkdtemp(join(context.generatedDir, 'docs-assets-'));
  const privateAssets: Array<{ name: string; path: string; contentType: string; contentHash: string; sourceRoot: string }> = [];
  for (const asset of snapshot.data.manifest.assets) {
    const path = join(directory, asset.id); await Bun.write(path, snapshot.assets.get(asset.id)!);
    privateAssets.push({ name: asset.id, path, contentType: asset.mime, contentHash: asset.hash, sourceRoot: directory });
  }
  return {
    browserEntries: [{ name: 'docs', path: new URL('../ui/hydrate.tsx', import.meta.url) }],
    styles: [{ name: 'docs-style', path: new URL('../ui/docs.css', import.meta.url) }],
    styleSources: [new URL('../ui/', import.meta.url)],
    privateAssets,
    data: JSON.parse(JSON.stringify(snapshot.data)) as ZeroPluginJsonValue,
  };
}
