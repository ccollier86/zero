/** Synthetic native-plugin contexts only; never read a real application's documentation or database. */
import { Elysia } from 'elysia';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { configureObservability, emitPlatformCode } from '@zero/framework/server';
import type { ZeroPluginBuildContext, ZeroPluginSetupContext, ZeroPluginJsonValue } from '@zero/framework/server';
import type { ResolvedDocsOptions } from '../options';
import type { DocsSnapshot } from './types';
import { docsFixture } from '../content/test-fixture';
import { resolveDocsOptions } from '../options';
import { compileDocsSnapshot } from './build';

configureObservability(false);
export async function docsRuntimeFixture(files: Readonly<Record<string, string>>, input: Partial<ResolvedDocsOptions> = {}) {
  const fixture = await docsFixture(Object.fromEntries(Object.entries(files).map(([path, text]) => ['documentation/' + path, text])));
  const options = resolveDocsOptions({ contentDir: './documentation', watch: false, ...input });
  const events: Array<{ code: string; metadata: unknown }> = [];
  const emit: typeof emitPlatformCode = (code, event) => { events.push({ code: code.code, metadata: event?.metadata }); return emitPlatformCode(code, event); };
  const build: ZeroPluginBuildContext = { projectRoot: fixture.root, appDir: './app', appIdentity: {}, generatedDir: join(fixture.root, '.zero/generated/docs'),
    assetOutDir: join(fixture.root, '.build/docs'), publicBasePath: '/_build/plugins/docs', mode: 'production', emitCode: emit };
  const snapshot = await compileDocsSnapshot(fixture.root, options, 'production', emit);
  const privateFiles: Record<string, string> = Object.create(null); await mkdir(build.generatedDir, { recursive: true });
  for (const asset of snapshot.data.manifest.assets) { const path = join(build.generatedDir, asset.id); await Bun.write(path, snapshot.assets.get(asset.id)!); privateFiles[asset.id] = path; }
  const context = (data: DocsSnapshot = snapshot): ZeroPluginSetupContext => ({ app: new Elysia({ name: 'test-docs-' + crypto.randomUUID() }) as ZeroPluginSetupContext['app'], zero: {} as ZeroPluginSetupContext['zero'],
    projectRoot: fixture.root, appDir: './app', appIdentity: {}, generatedDir: build.generatedDir, emitCode: emit, files: privateFiles,
    frontend: { plugins: { [options.name]: { publicBasePath: '/_build/plugins/docs', assets: {}, data: JSON.parse(JSON.stringify(data.data)) as ZeroPluginJsonValue } } } });
  return { ...fixture, options, events, build, snapshot, privateFiles, context };
}
