/** Qualify build-only declaration admission, immutable private data and production artifact fences. */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryEventStore, configureObservability, emitPlatformCodeTo, OBS_CODES, type emitPlatformCode } from '../../observability';
import { prepareAppBuild, resolveAppFrontendBuild } from './app-build';
import { defineZeroPlugin, createServerExtensionApp, defineRouter } from './server-extensions';
import { freezePluginJson, admitAppFrontendBuildManifest } from './server-plugin-build-manifest';
import { collectPluginBuildContributors } from './server-plugin-build';
import { pluginBuildNamespace } from './server-plugin-build-assets';
import { resolveConfig, type AppConfig } from './types';
import { AppPluginBuildError } from './server-plugin-build-error';

async function scratch(): Promise<string> { const root = '/Volumes/code-bank/tmp/scratch/zero-platform'; await mkdir(root, { recursive: true }); return mkdtemp(join(root, 'plugin-build-')); }
function config(root: string, extra: Partial<AppConfig> = {}): AppConfig { return { projectRoot: root, db: { mode: 'ephemeral' }, tables: {}, auth: false, email: false, migrate: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, serverResourcesDir: false, ...extra }; }
const silentObservability = configureObservability(false);
const silentEmit: typeof emitPlatformCode = (code, options) => emitPlatformCodeTo(silentObservability, code, options);

describe('native declared plugin builds', () => {
  test('prepare runs once without setup/services and exposes immutable real URLs to later setup', async () => {
    const root = await scratch();
    const events = new MemoryEventStore();
    const observability = configureObservability({ console: false, store: events });
    let builds = 0; let setups = 0;
    const plugin = defineZeroPlugin({ name: 'test.docs', build: { identity: 'config-v1', prepare(context) {
      builds += 1; expect(Object.isFrozen(context)).toBe(true); expect(context.projectRoot).toBe(root); expect(context.mode).toBe('production');
      return { data: { public: 'Compiled text', private: 'SERVER_ONLY_MARKER' }, styles: [{ name: 'reader', path: './reader.css' }], assets: [{ name: 'logo', path: './logo.txt' }] };
    } }, setup(context) {
      setups += 1; expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen(context.frontend)).toBe(true);
      return context.app.get('/plugin-ready', () => ({ data: context.frontend.plugins['test.docs']!.data, projectRoot: context.projectRoot }));
    } });
    try {
      await Bun.write(join(root, 'reader.css'), '.reader{color:var(--foreground)}'); await Bun.write(join(root, 'logo.txt'), 'PUBLIC_LOGO');
      const prepared = await prepareAppBuild(config(root, { serverExtensions: [plugin] }), { emitCode: (code, options) => emitPlatformCodeTo(observability, code, options) });
      expect(builds).toBe(1); expect(setups).toBe(0); expect(prepared.extensions).toEqual([plugin]);
      expect(prepared.privateManifestPath.startsWith(join(root, '.zero/generated'))).toBe(true);
      expect(await Bun.file(prepared.privateManifestPath).text()).toContain('SERVER_ONLY_MARKER');
      const namespace = pluginBuildNamespace(plugin.name); const result = prepared.frontend.plugins[plugin.name]!;
      expect(result.assets.reader!.publicPath).toStartWith(`/_build/plugins/${namespace}/reader.`);
      expect(await Bun.file(join(root, '.build', result.assets.logo!.publicPath.slice('/_build/'.length))).text()).toBe('PUBLIC_LOGO');
      expect(events.query({ code: OBS_CODES.APP_PLUGIN_BUILD_READY.code }).count).toBe(1);
      const mounted = await createServerExtensionApp({ extensions: [...prepared.extensions], frontendContext: { projectRoot: root, appDir: prepared.config.appDir, frontend: prepared.frontend } });
      const response = await mounted.handle(new Request('http://localhost/plugin-ready'));
      expect(response.status).toBe(200); expect(setups).toBe(1); expect(builds).toBe(1);
      expect(await response.json()).toEqual({ data: { public: 'Compiled text', private: 'SERVER_ONLY_MARKER' }, projectRoot: root });
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  test('required compilation rejects before runtime setup and reports one app-owned bounded event', async () => {
    const root = await scratch(); const events = new MemoryEventStore(); const observability = configureObservability({ console: false, store: events }); let setups = 0;
    const plugin = defineZeroPlugin({ name: 'broken-docs', build: { prepare() { throw new Error('PRIVATE_BODY_DO_NOT_LOG'); } }, setup() { setups += 1; } });
    try {
      await expect(prepareAppBuild(config(root, { serverExtensions: [plugin] }), { emitCode: (code, options) => emitPlatformCodeTo(observability, code, options) })).rejects.toBeInstanceOf(AppPluginBuildError);
      expect(setups).toBe(0); expect(events.query({ code: OBS_CODES.APP_PLUGIN_BUILD_FAILED.code }).count).toBe(1);
      expect(JSON.stringify(events.query({}).events)).not.toContain('PRIVATE_BODY_DO_NOT_LOG');
      expect(await Bun.file(join(root, '.zero/generated/frontend-build.json')).exists()).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('current production declarations consume artifacts without touching source or recompiling', async () => {
    const root = await scratch(); let builds = 0;
    const plugin = defineZeroPlugin({ name: 'compiled-only', build: { identity: 'same', prepare() { builds += 1; return { data: { value: 'frozen' } }; } }, setup() {} });
    try {
      const prepared = await prepareAppBuild(config(root, { serverExtensions: [plugin] }), { emitCode: silentEmit });
      const resolved = await resolveAppFrontendBuild(resolveConfig(config(root, { serverExtensions: [plugin], frontendBuild: prepared.manifest })), [plugin], silentEmit);
      expect(resolved).toEqual(prepared.frontend); expect(builds).toBe(1);
      const changed = defineZeroPlugin({ ...plugin, build: { ...plugin.build!, identity: 'changed' } });
      await expect(resolveAppFrontendBuild(resolveConfig(config(root, { frontendBuild: prepared.manifest })), [changed], silentEmit)).rejects.toThrow('does not match');
      await expect(createServerExtensionApp({ extensions: [plugin] })).rejects.toThrow('Required build artifact is missing');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  test('private compiled output cannot be written beneath public build paths, including symlink aliases', async () => {
    const root = await scratch();
    try {
      await expect(prepareAppBuild(config(root, { generatedDir: '.build/private' }), { emitCode: silentEmit })).rejects.toThrow('outside the public build');
      await symlink(join(root, '.build'), join(root, 'alias'), 'dir');
      await expect(prepareAppBuild(config(root, { generatedDir: 'alias' }), { emitCode: silentEmit })).rejects.toThrow('outside the public build');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('explicitly optional production content may be absent without invoking its compiler', async () => {
    const root = await scratch(); let builds = 0; let setups = 0;
    const previousEnvironment = process.env.NODE_ENV;
    const plugin = defineZeroPlugin({ name: 'optional-reader', build: { required: false, prepare() { builds += 1; throw new Error('must-not-build-in-production'); } }, setup({ frontend }) { setups += 1; expect(frontend.plugins['optional-reader']).toBeUndefined(); } });
    try {
      process.env.NODE_ENV = 'production';
      const resolved = resolveConfig(config(root, { serverExtensions: [plugin] }));
      const frontend = await resolveAppFrontendBuild(resolved, [plugin], silentEmit);
      expect(frontend.plugins).toEqual({}); expect(builds).toBe(0);
      await createServerExtensionApp({ extensions: [plugin], frontendContext: { projectRoot: root, appDir: resolved.appDir, frontend } });
      expect(setups).toBe(1);
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test('nested contributors preserve mounting order and reject duplicate owned namespaces', () => {
    const first = defineZeroPlugin({ name: 'first', build: { prepare: () => ({}) }, setup() {} }); const second = defineZeroPlugin({ name: 'second', build: { prepare: () => ({}) }, setup() {} });
    expect(collectPluginBuildContributors([defineRouter({ name: 'nested', routes: [first, second] }), first])).toEqual([first, second]);
    expect(() => collectPluginBuildContributors([first, defineZeroPlugin({ ...first })])).toThrow('duplicated');
  });

  test('root capture accepts file URLs and isolates relative inputs from ambient cwd', () => {
    const root = resolve('/Volumes/code-bank/tmp/scratch/zero-platform/config-origin');
    const resolved = resolveConfig(config(root, { projectRoot: pathToFileURL(`${root}/`) }));
    expect(resolved.projectRoot).toBe(root); expect(resolved.appDir).toBe(join(root, 'app')); expect(resolved.serverExtensions).toEqual([]);
    expect(() => resolveConfig(config(root, { projectRoot: './ambiguous' }))).toThrow('absolute path or file URL');
  });
});

describe('compiled manifest data admission', () => {
  test('JSON snapshots do not alias input, invoke accessors, admit functions/symbols or sparse arrays', () => {
    const input = { nested: { value: 'original' } }; const frozen = freezePluginJson(input); input.nested.value = 'changed'; expect(frozen).toEqual({ nested: { value: 'original' } });
    let getters = 0; expect(() => freezePluginJson({ get secret() { getters += 1; return 'bad'; } })).toThrow('accessors'); expect(getters).toBe(0);
    expect(() => freezePluginJson({ value() {} })).toThrow('JSON'); expect(() => freezePluginJson({ [Symbol('x')]: 'hidden' })).toThrow('symbol'); expect(() => freezePluginJson(new Array(2))).toThrow('sparse');
    expect(() => freezePluginJson({ value: NaN })).toThrow('JSON');
  });

  test('asset admission rejects arbitrary namespaces, scripts and traversal paths', () => {
    const namespace = `/_build/plugins/${pluginBuildNamespace('safe')}`;
    const manifest = { version: 1, frontend: { plugins: { safe: { publicBasePath: namespace, assets: { script: { kind: 'script', publicPath: `${namespace}/entry.js` } } } } }, pluginIdentities: { safe: null } };
    expect(admitAppFrontendBuildManifest(manifest).frontend.plugins.safe!.assets.script!.publicPath).toBe(`${namespace}/entry.js`);
    expect(admitAppFrontendBuildManifest({ ...manifest, frontend: { ...manifest.frontend, pluginSsrRuntime: 'bundled' } }).frontend.pluginSsrRuntime).toBe('bundled');
    expect(() => admitAppFrontendBuildManifest({ ...manifest, frontend: { ...manifest.frontend, pluginSsrRuntime: 'ambient' } })).toThrow('SSR runtime selection');
    for (const path of ['javascript:alert(1)', '/_build/plugins/other/entry.js', `${namespace}/../private.json`, `${namespace}/%2e%2e/private.json`]) {
      expect(() => admitAppFrontendBuildManifest({ ...manifest, frontend: { plugins: { safe: { publicBasePath: namespace, assets: { script: { kind: 'script', publicPath: path } } } } } })).toThrow('URL is invalid');
    }
  });
});
