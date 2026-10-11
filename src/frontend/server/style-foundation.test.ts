/** Backing selection, real stylesheet builds and portable artifact checks without starting application services. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPlatformStyles } from './style-bundle';
import { resolveAppThemeFoundation } from './style-foundation';
import { resolveConfig, type AppConfig } from './types';
import { admitAppFrontendBuildManifest } from './server-plugin-build-manifest';
import { prepareAppBuild, resolveAppFrontendBuild } from './app-build';
import { buildAppAssets } from './app-build-assets';
import { configureObservability, emitPlatformCodeTo, type emitPlatformCode } from '../../observability';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const observation = configureObservability(false);
const silent: typeof emitPlatformCode = (code, options) => emitPlatformCodeTo(observation, code, options);
async function scratch() { await mkdir(SCRATCH, { recursive: true }); return mkdtemp(join(SCRATCH, 'style-foundation-')); }
function config(root: string, extra: Partial<AppConfig> = {}): AppConfig {
  return { projectRoot: root, db: { mode: 'ephemeral' }, tables: {}, auth: false, kv: false,
    serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
    serverRoutesDir: false, serverResourcesDir: false, ...extra };
}

test('managed selection defaults to next, preserves explicit legacy and rejects malformed values before configuration work', () => {
  expect(resolveAppThemeFoundation(undefined)).toBe('next');
  expect(resolveAppThemeFoundation('legacy')).toBe('legacy');
  expect(resolveAppThemeFoundation('next')).toBe('next');
  for (const value of [null, false, true, 0, '', 'Next', ['next'], new String('next'), { toString: () => 'next' }]) {
    expect(() => resolveAppThemeFoundation(value)).toThrow('themeFoundation');
    expect(() => resolveConfig({ themeFoundation: value } as AppConfig)).toThrow('themeFoundation');
  }
  const base: AppConfig = { db: { mode: 'ephemeral' }, tables: {} };
  expect(resolveConfig(base).themeFoundation).toBe('next');
  expect(resolveConfig({ ...base, themeFoundation: 'legacy' }).themeFoundation).toBe('legacy');
  expect(resolveConfig({ ...base, themeFoundation: 'next' }).themeFoundation).toBe('next');
});

test('default managed CSS appends the next foundation, hashes its content and preserves explicit legacy assets', async () => {
  const root = await scratch(); const out = join(root, 'out');
  try {
    const legacy = await buildPlatformStyles(out, join(root, 'absent-app'), [], { themeFoundation: 'legacy' });
    const previous = await Bun.file(legacy.cssPath).text();
    expect(previous).not.toContain('[data-zero-theme="next"]');
    const next = await buildPlatformStyles(out, join(root, 'absent-app'));
    const css = await Bun.file(next.cssPath).text();
    expect(css).toContain('[data-zero-theme="next"]');
    expect(css).toContain('--zero-type-control-size');
    expect(css).toContain('[data-zero-typography="section"]');
    expect(css).toContain('--zero-sankey-particle-radius');
    expect(css.indexOf('--zero-theme-font-body')).toBeGreaterThan(css.indexOf('--font-platform-sans'));
    expect(next.publicPath).not.toBe(legacy.publicPath);
    expect(next.publicPath).toMatch(/^\/_build\/platform\.[a-f0-9]{12}\.css$/);
    expect(await Bun.file(legacy.cssPath).text()).toBe(previous);
    const repeated = await buildPlatformStyles(out, join(root, 'absent-app'), [], { themeFoundation: 'next' });
    expect(repeated.publicPath).toBe(next.publicPath);
    expect(await Bun.file(repeated.cssPath).text()).toBe(css);
    expect((await readdir(out)).some(name => name.endsWith('.tmp'))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test('failed builds and later publication retain live hashed assets and all app-owned files', async () => {
  const root = await scratch(); const out = join(root, 'out');
  try {
    const initial = await buildPlatformStyles(out, join(root, 'absent-app'), [], { themeFoundation: 'legacy' });
    const previous = await Bun.file(initial.cssPath).text();
    await Bun.write(join(out, 'platform.custom.css'), 'APP_OWNED_STYLE');
    await Bun.write(join(root, 'app-owned.css'), 'APP_OWNED_TARGET');
    await symlink(join(root, 'app-owned.css'), join(out, 'platform.111111111111.css'));
    await mkdir(join(out, 'platform.222222222222.css'));
    await expect(buildPlatformStyles(out, join(root, 'absent-app'), [join(root, 'missing-source')], { themeFoundation: 'next' })).rejects.toThrow('source is missing');
    expect(await Bun.file(initial.cssPath).text()).toBe(previous);
    await expect(buildPlatformStyles(join(root, 'not-created'), join(root, 'absent-app'), [], { themeFoundation: null as never })).rejects.toThrow('themeFoundation');
    expect((await readdir(root)).includes('not-created')).toBe(false);
    await buildPlatformStyles(out, join(root, 'absent-app'), [], { themeFoundation: 'next' });
    expect(await Bun.file(join(out, 'platform.custom.css')).text()).toBe('APP_OWNED_STYLE');
    expect(await Bun.file(join(out, 'platform.111111111111.css')).text()).toBe('APP_OWNED_TARGET');
    expect((await readdir(out)).includes('platform.222222222222.css')).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test('concurrent legacy/next builds keep both returned content-addressed URLs usable', async () => {
  const root = await scratch(); const out = join(root, 'out');
  try {
    const [legacy, next] = await Promise.all([
      buildPlatformStyles(out, join(root, 'absent-app'), [], { themeFoundation: 'legacy' }),
      buildPlatformStyles(out, join(root, 'absent-app'), [], { themeFoundation: 'next' }),
    ]);
    expect(legacy.cssPath).not.toBe(next.cssPath);
    expect(await Bun.file(legacy.cssPath).text()).not.toContain('[data-zero-theme="next"]');
    expect(await Bun.file(next.cssPath).text()).toContain('[data-zero-theme="next"]');
    expect((await readdir(out)).filter(name => name.endsWith('.css'))).toHaveLength(2);
    expect((await readdir(out)).some(name => name.endsWith('.tmp'))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test('portable manifest admits only supported foundation metadata and requires CSS for next', () => {
  const base = { version: 1, frontend: { plugins: {} }, pluginIdentities: {} };
  expect(admitAppFrontendBuildManifest(base).frontend.themeFoundation).toBeUndefined();
  expect(admitAppFrontendBuildManifest({ ...base, frontend: { plugins: {}, themeFoundation: 'legacy' } }).frontend.themeFoundation).toBe('legacy');
  for (const value of [null, true, 0, ['next'], 'ambient']) {
    expect(() => admitAppFrontendBuildManifest({ ...base, frontend: { plugins: {}, themeFoundation: value } })).toThrow('foundation selection');
  }
  expect(() => admitAppFrontendBuildManifest({ ...base, frontend: { plugins: {}, themeFoundation: 'next' } })).toThrow('requires a compiled');
  expect(admitAppFrontendBuildManifest({ ...base, frontend: { plugins: {}, themeFoundation: 'next', cssPath: '/_build/platform.abcdef123456.css' } }).frontend.themeFoundation).toBe('next');
});

test('omitted managed selection records next without mounting services; old artifact metadata remains legacy', async () => {
  const root = await scratch(); let setups = 0;
  try {
    const { defineZeroPlugin } = await import('./server-extensions');
    const extension = defineZeroPlugin({ name: 'theme-no-setup', setup() { setups++; throw new Error('Runtime setup must not run.'); } });
    const prepared = await prepareAppBuild(config(root, { serverExtensions: [extension] }), { emitCode: silent });
    expect(setups).toBe(0);
    expect(prepared.config.themeFoundation).toBe('next');
    expect(prepared.manifest.frontend.themeFoundation).toBe('next');
    expect(Object.isFrozen(prepared.manifest.frontend)).toBe(true);
    const css = await Bun.file(join(prepared.config.outDir, prepared.frontend.cssPath!.slice('/_build/'.length))).text();
    expect(css).toContain('[data-zero-theme="next"]');
    const admitted = await resolveAppFrontendBuild(resolveConfig(config(root, { frontendBuild: prepared.manifest })), [extension], silent);
    expect(admitted).toBeDefined(); expect(setups).toBe(0);
    await expect(resolveAppFrontendBuild(resolveConfig(config(root, { themeFoundation: 'legacy', frontendBuild: prepared.manifest })), [extension], silent)).rejects.toThrow('differs from application');
    const oldManifest = { version: 1 as const, frontend: { plugins: {} }, pluginIdentities: {} };
    const legacy = await resolveAppFrontendBuild(resolveConfig(config(root, { themeFoundation: 'legacy', frontendBuild: oldManifest })), [], silent);
    expect(legacy.themeFoundation).toBeUndefined();
    await expect(resolveAppFrontendBuild(resolveConfig(config(root, { frontendBuild: oldManifest })), [], silent)).rejects.toThrow('differs from application');
    await expect(resolveAppFrontendBuild(resolveConfig(config(root, { themeFoundation: 'next', frontendBuild: oldManifest })), [], silent)).rejects.toThrow('differs from application');
    const persisted = await Bun.file(prepared.privateManifestPath).json();
    expect(persisted.frontend.themeFoundation).toBe('next');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test('default next foundation never silently falls back when its managed stylesheet fails; explicit legacy remains optional', async () => {
  const root = await scratch();
  try {
    const out = join(root, 'not-a-directory'); await Bun.write(out, 'APP_OWNED');
    const paths = { outDir: out, appDir: join(root, 'absent-app'), generatedDir: join(root, 'generated') };
    const legacy = await buildAppAssets({ ...paths, themeFoundation: 'legacy' }, silent);
    expect(legacy.cssPath).toBeUndefined(); expect(legacy.themeFoundation).toBe('legacy');
    await expect(buildAppAssets(paths, silent)).rejects.toBeDefined();
    await expect(buildAppAssets({ ...paths, themeFoundation: 'next' }, silent)).rejects.toBeDefined();
    expect(await Bun.file(out).text()).toBe('APP_OWNED');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
