/** Additive modal-scroll source-copy qualification; exact disposable consumers only, without app configuration or services. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { addZeroSource } from './copy';
import { listStaticAddableTargets } from './registry';
import { SourceOnlyUpgradeExports } from '../doctor/source-only-upgrade-exports';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const SOURCE_ROOT = new URL('../../', import.meta.url).pathname;
const REQUIRED = [
  'modals/index.ts', 'modals/modal-manager.tsx', 'modals/modal-system.types.ts', 'modals/modal-events.ts',
  'modals/modal-scroll-shell.tsx', 'modals/modal-scroll-treatment.css', 'modals/modal-shell.tsx', 'modals/modal-shell.css',
  'components/_internal/scroll-viewport/scroll-viewport-decoration-next.tsx',
  'components/_internal/scroll-viewport/scroll-viewport-interactions.ts',
  'components/_internal/scroll-viewport/scroll-viewport-next.css',
  'components/_internal/scroll-viewport/scroll-viewport.css',
  'components/_internal/scroll-viewport/scroll-viewport-metrics.ts',
  'components/_internal/scroll-viewport/use-scroll-viewport.ts',
  'components/_internal/overlay-scope/overlay-scope.tsx', 'components/ui/button.tsx', 'lib/observe-presentation-theme.ts',
];

test('existing modals source target includes next and original scroll owners without tests or backend assets', async () => {
  expect(listStaticAddableTargets().find(target => target.id === 'modals')?.sourceRel).toBe('modals');
  const result = await addZeroSource({ targetDir: join(SCRATCH, 'modal-scroll-copy-plan'), items: ['modals'], dryRun: true });
  for (const path of REQUIRED) expect(result.filesPlanned, path).toContain(path);
  expect(result.filesPlanned.some(path => /\.(?:test|spec)\.|\.(?:browser|test|package)-fixture\./u.test(path))).toBe(false);
  expect(result.filesPlanned.some(path => /(?:^|\/)(?:databases|server)\//u.test(path))).toBe(false);
  expect(result.filesPlanned).not.toContain('frontend/styles/globals.css');
  expect(result.filesPlanned).not.toContain('frontend/styles/theme-next.css');
  expect(result.filesWritten).toHaveLength(0);
});

test('source-only Doctor retains existing modal facade and descriptor types without a new public adapter route', async () => {
  const pkg = await Bun.file(join(SOURCE_ROOT, 'package.json')).json();
  const inspector = new SourceOnlyUpgradeExports(SOURCE_ROOT, pkg.exports);
  for (const route of ['@zero/framework', '@zero/framework/react', '@zero/framework/modals']) {
    for (const name of ['ModalManager', 'ControlledModal', 'modals']) expect((await inspector.inspect(route, name)).status).toBe('available');
    for (const name of ['ModalDescriptor', 'ModalDescriptorBase']) expect((await inspector.inspect(route, name, 'any')).status).toBe('available');
    expect((await inspector.inspect(route, 'ModalScrollShell')).status).toBe('missing');
    expect((await inspector.inspect(route, 'ScrollViewportDecorationNext')).status).toBe('missing');
  }
});

test('actual zero add modals CLI copy builds both scroll skins and preserves customized original files', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const consumer = await mkdtemp(join(SCRATCH, 'modal-scroll-copy-'));
  try {
    const modules = join(consumer, 'node_modules');
    await mkdir(join(modules, '@zero'), { recursive: true });
    await Promise.all((await readdir(join(SOURCE_ROOT, 'node_modules'))).filter(name => name !== '@zero')
      .map(name => symlink(join(SOURCE_ROOT, 'node_modules', name), join(modules, name))));
    await symlink(SOURCE_ROOT, join(modules, '@zero/framework'), 'dir');
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] },
    } }));
    const tripwire = "throw new Error('MODAL_SCROLL_COPY_CONFIG_MUST_NOT_EXECUTE');\n";
    await Bun.write(join(consumer, 'zero.config.ts'), tripwire);
    await Bun.write(join(consumer, '.env'), 'ZERO_SCROLL_COPY_ENV_TRIPWIRE=MUST_NOT_LOAD\n');
    const first = await checked([join(SOURCE_ROOT, 'src/cli/run.ts'), 'add', 'modals', '--target', consumer], consumer);
    expect(first).toContain('Zero add complete');
    for (const path of REQUIRED) expect(await Bun.file(join(consumer, path)).exists(), path).toBe(true);
    const copiedPaths = [...new Bun.Glob('**/*.{ts,tsx,css}').scanSync({ cwd: consumer, onlyFiles: true })]
      .filter(path => !path.startsWith('node_modules/'));
    expect(copiedPaths.some(path => /\.(?:test|spec)\.|\.(?:browser|test|package)-fixture\./u.test(path))).toBe(false);
    expect(copiedPaths.some(path => /(?:^|\/)(?:databases|server)\//u.test(path))).toBe(false);

    const custom = '\n/* APPLICATION-OWNED ORIGINAL MUST SURVIVE */\n';
    for (const path of ['modals/modal-shell.tsx', 'modals/modal-shell.css',
      'components/_internal/scroll-viewport/use-scroll-viewport.ts', 'components/_internal/scroll-viewport/scroll-viewport.css']) {
      const file = join(consumer, path);
      await Bun.write(file, await Bun.file(file).text() + custom);
    }
    const second = await checked([join(SOURCE_ROOT, 'src/cli/run.ts'), 'add', 'modals', '--target', consumer], consumer);
    expect(second).toMatch(/Written:\s+0 file\(s\)/u);
    for (const path of ['modals/modal-shell.tsx', 'modals/modal-shell.css',
      'components/_internal/scroll-viewport/use-scroll-viewport.ts', 'components/_internal/scroll-viewport/scroll-viewport.css']) {
      expect(await Bun.file(join(consumer, path)).text(), path).toEndWith(custom);
    }
    await Bun.write(join(consumer, 'entry.tsx'), [
      "import { ModalManager, ControlledModal } from './modals';",
      "import type { ModalDescriptor } from './modals';",
      "import './modals/modal-shell.css';",
      "export const arc: ModalDescriptor = { title: 'Arc scrolling', scrollTreatment: 'arc', scrollbar: 'thin', body: 'Content' };",
      "export const native: ModalDescriptor = { title: 'Original scrolling', scrollTreatment: 'native', scrollbar: 'hidden', body: 'Content' };",
      'export { ModalManager };',
      'export const examples = <><ControlledModal open={false} descriptor={arc} onOpenChange={() => undefined}/><ControlledModal open={false} descriptor={native} onOpenChange={() => undefined}/></>;',
    ].join('\n'));
    await checked(['build', 'entry.tsx', '--target', 'browser', '--outdir', 'build'], consumer);
    const javascript = await Bun.file(join(consumer, 'build/entry.js')).text();
    const css = await Bun.file(join(consumer, 'build/entry.css')).text();
    expect(javascript).not.toContain('MODAL_SCROLL_COPY_CONFIG_MUST_NOT_EXECUTE');
    expect(javascript).toContain('data-zero-scroll-treatment');
    for (const selector of ['.zero-modal__body', '.zero-scroll-viewport', '.zero-scroll-decoration',
      'data-zero-scroll-treatment', 'data-zero-scroll-decoration']) expect(css, selector).toContain(selector);
    await Bun.write(join(consumer, 'verify-env.ts'),
      'console.log(JSON.stringify({environmentNotLoaded:process.env.ZERO_SCROLL_COPY_ENV_TRIPWIRE===undefined}));\n');
    expect(JSON.parse((await checked(['verify-env.ts'], consumer)).trim()).environmentNotLoaded).toBe(true);
    expect(await Bun.file(join(consumer, 'zero.config.ts')).text()).toBe(tripwire);
    expect([...new Bun.Glob('**/*.{db,sqlite,sqlite3}').scanSync({ cwd: consumer, onlyFiles: true })]
      .filter(path => !path.startsWith('node_modules/'))).toHaveLength(0);
  } finally {
    // This exact freshly allocated synthetic consumer is disposable; no original source is removed.
    await rm(consumer, { recursive: true, force: true });
  }
}, 60_000);

/** Minimal child environment and explicit .env suppression; no caller credentials, application or script lifecycle. */
async function checked(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`Modal scroll copy qualification failed (${code}):\n${stdout}\n${stderr}`);
  return stdout;
}
