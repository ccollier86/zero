/** Qualifies additive picker/menu scroll source-copy closures without app boot, service state or original retirement. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { addZeroSource } from './copy';
import { listStaticAddableTargets } from './registry';
import { SourceOnlyUpgradeExports } from '../doctor/source-only-upgrade-exports';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const SOURCE_ROOT = new URL('../../', import.meta.url).pathname;
const SHARED = [
  'components/_internal/scroll-viewport/scroll-viewport-attachment.tsx',
  'components/_internal/scroll-viewport/scroll-viewport-decoration-next.tsx',
  'components/_internal/scroll-viewport/scroll-viewport-interactions.ts',
  'components/_internal/scroll-viewport/scroll-viewport-next.css',
  'components/_internal/scroll-viewport/scroll-viewport.css',
  'components/_internal/scroll-viewport/scroll-viewport-metrics.ts',
  'components/_internal/scroll-viewport/use-scroll-viewport.ts',
];
const PICKER = ['components/ui/date-picker.tsx', 'components/controls/date-time/date-picker.tsx',
  'components/controls/date-time/date-picker-scroll.tsx'];
const MENU = ['components/context-menu/index.ts', 'components/context-menu/context-menu.props.ts',
  'components/context-menu/context-menu-content.tsx', 'components/context-menu/context-menu-surface.tsx',
  'components/context-menu/context-menu-styles.ts', 'components/context-menu/context-menu-scroll-content.tsx',
  'components/context-menu/context-menu-viewport.tsx', 'components/context-menu/context-menu-floating-surface.ts',
  'components/context-menu/context-menu-scroll.css'];

test('direct picker and canonical context-menu targets include next interactions and every original owner', async () => {
  expect(listStaticAddableTargets().find(target => target.id === 'components/context-menu')?.sourceRel).toBe('components/context-menu');
  for (const [target, required] of [['components/ui/date-picker', PICKER], ['components/context-menu', MENU]] as const) {
    const plan = await addZeroSource({ targetDir: join(SCRATCH, 'ordinary-scroll-plan'), items: [target], dryRun: true });
    for (const path of [...required, ...SHARED]) expect(plan.filesPlanned, `${target}: ${path}`).toContain(path);
    expect(plan.filesPlanned.some(path => /\.(?:test|spec)\.|\.(?:browser|test|package)-fixture\./u.test(path))).toBe(false);
    expect(plan.filesPlanned.some(path => /(?:^|\/)(?:databases|server)\//u.test(path))).toBe(false);
    expect(plan.filesPlanned).not.toContain('frontend/styles/globals.css');
    expect(plan.filesPlanned).not.toContain('frontend/styles/theme-next.css');
    expect(plan.filesWritten).toHaveLength(0);
  }
});

test('transitive DataTable picker copy and source-only Doctor retain supported public facade identities', async () => {
  const plan = await addZeroSource({ targetDir: join(SCRATCH, 'ordinary-scroll-table-plan'), items: ['components/data-table'], dryRun: true });
  for (const path of [...PICKER, ...SHARED]) expect(plan.filesPlanned, path).toContain(path);
  const metadata = await Bun.file(join(SOURCE_ROOT, 'package.json')).json();
  const inspector = new SourceOnlyUpgradeExports(SOURCE_ROOT, metadata.exports);
  for (const route of ['@zero/framework', '@zero/framework/react', '@zero/framework/components/ui/date-picker']) {
    expect((await inspector.inspect(route, 'DatePicker')).status).toBe('available');
    for (const name of ['DatePickerProps', 'DatePickerCalendarProps']) expect((await inspector.inspect(route, name, 'any')).status).toBe('available');
  }
  for (const route of ['@zero/framework', '@zero/framework/react', '@zero/framework/components/context-menu']) {
    for (const name of ['ContextMenuContent', 'ContextMenuSubContent', 'ContextMenuViewport']) expect((await inspector.inspect(route, name)).status).toBe('available');
    for (const name of ['ContextMenuContentProps', 'ContextMenuSubContentProps', 'ContextMenuViewportProps', 'ContextMenuScrollOptions']) expect((await inspector.inspect(route, name, 'any')).status).toBe('available');
    expect((await inspector.inspect(route, 'ScrollViewportDecorationNext')).status).toBe('missing');
  }
});

test('actual zero add picker/menu CLI builds new skins while no-force repeat preserves application-owned originals', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const consumer = await mkdtemp(join(SCRATCH, 'ordinary-scroll-copy-'));
  try {
    const modules = join(consumer, 'node_modules');
    await mkdir(join(modules, '@zero'), { recursive: true });
    await Promise.all((await readdir(join(SOURCE_ROOT, 'node_modules'))).filter(name => name !== '@zero')
      .map(name => symlink(join(SOURCE_ROOT, 'node_modules', name), join(modules, name))));
    await symlink(SOURCE_ROOT, join(modules, '@zero/framework'), 'dir');
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] },
    } }));
    const config = "throw new Error('ORDINARY_SCROLL_COPY_CONFIG_MUST_NOT_EXECUTE');\n";
    await Bun.write(join(consumer, 'zero.config.ts'), config);
    await Bun.write(join(consumer, '.env'), 'ZERO_ORDINARY_SCROLL_COPY_ENV_TRIPWIRE=MUST_NOT_LOAD\n');
    const ownedOriginal = 'components/context-menu/context-menu-content.tsx';
    const initialCustom = await Bun.file(join(SOURCE_ROOT, 'src', ownedOriginal)).text()
      + '\n/* APPLICATION ORIGINAL CUSTOMIZATION BEFORE FIRST ADD MUST SURVIVE */\n';
    await mkdir(dirname(join(consumer, ownedOriginal)), { recursive: true });
    await Bun.write(join(consumer, ownedOriginal), initialCustom);
    const args = [join(SOURCE_ROOT, 'src/cli/run.ts'), 'add', 'components/ui/date-picker', 'components/context-menu', '--target', consumer];
    expect(await checked(args, consumer)).toContain('Zero add complete');
    expect(await Bun.file(join(consumer, ownedOriginal)).text()).toBe(initialCustom);
    for (const path of [...PICKER, ...MENU, ...SHARED]) expect(await Bun.file(join(consumer, path)).exists(), path).toBe(true);
    const copied = [...new Bun.Glob('**/*.{ts,tsx,css}').scanSync({ cwd: consumer, onlyFiles: true })]
      .filter(path => /^(?:components|hooks|lib|modals)\//u.test(path));
    expect(copied.filter(path => /\.(?:test|spec)\.|\.(?:browser|test|package)-fixture\./u.test(path))).toHaveLength(0);
    const custom = '\n/* APPLICATION-OWNED ORIGINAL MUST SURVIVE */\n';
    const customized = ['components/controls/date-time/date-picker.tsx',
      'components/context-menu/context-menu-content.tsx', 'components/context-menu/context-menu-styles.ts',
      'components/_internal/scroll-viewport/use-scroll-viewport.ts', 'components/_internal/scroll-viewport/scroll-viewport.css'];
    for (const path of customized) await Bun.write(join(consumer, path), await Bun.file(join(consumer, path)).text() + custom);
    expect(await checked(args, consumer)).toMatch(/Written:\s+0 file\(s\)/u);
    for (const path of customized) expect(await Bun.file(join(consumer, path)).text(), path).toEndWith(custom);
    await Bun.write(join(consumer, 'consumer.tsx'), COPIED_CONSUMER);
    await checked(['build', 'consumer.tsx', '--target', 'browser', '--outdir', 'build'], consumer);
    const css = await Bun.file(join(consumer, 'build/consumer.css')).text();
    const javascript = await Bun.file(join(consumer, 'build/consumer.js')).text();
    for (const selector of ['.zero-scroll-decoration', 'data-zero-scroll-decoration', 'context-menu']) expect(css, selector).toContain(selector);
    expect(javascript).toContain('date-picker-calendar-viewport');
    expect(javascript).not.toContain('ORDINARY_SCROLL_COPY_CONFIG_MUST_NOT_EXECUTE');
    await Bun.write(join(consumer, 'verify-env.ts'),
      'console.log(JSON.stringify({environmentNotLoaded:process.env.ZERO_ORDINARY_SCROLL_COPY_ENV_TRIPWIRE===undefined}));\n');
    expect(JSON.parse((await checked(['verify-env.ts'], consumer)).trim()).environmentNotLoaded).toBe(true);
    expect(await Bun.file(join(consumer, 'zero.config.ts')).text()).toBe(config);
    expect([...new Bun.Glob('**/*.{db,sqlite,sqlite3}').scanSync({ cwd: consumer, onlyFiles: true })]
      .filter(path => !path.startsWith('node_modules/'))).toHaveLength(0);
  } finally {
    // Only this exact fresh synthetic consumer is disposable; framework/application originals stay untouched.
    await rm(consumer, { recursive: true, force: true });
  }
}, 60_000);

/** Minimal child environment and explicit .env suppression; no live app configuration or service credentials are inherited. */
async function checked(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`Ordinary scroll source-copy qualification failed (${code}):\n${stdout}\n${stderr}`);
  return stdout;
}

const COPIED_CONSUMER = `
import { DatePicker } from './components/ui/date-picker';
import type { DatePickerProps } from './components/ui/date-picker';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuViewport } from './components/context-menu';
import type { ContextMenuContentProps, ContextMenuSubContentProps } from './components/context-menu';
export const arc: DatePickerProps = { scrollTreatment: 'arc', appearance: 'button' };
export const native: DatePickerProps = { scrollTreatment: 'native', appearance: 'input' };
const content: ContextMenuContentProps = { scrollTreatment: 'arc' };
const subcontent: ContextMenuSubContentProps = { scrollTreatment: 'native' };
export function CopiedScrollConsumer() { return <><DatePicker {...arc}/><DatePicker {...native}/>
  <ContextMenu><ContextMenuTrigger>Record</ContextMenuTrigger><ContextMenuContent {...content}>
    <ContextMenuItem>First</ContextMenuItem><ContextMenuSub><ContextMenuSubTrigger>Export</ContextMenuSubTrigger>
      <ContextMenuSubContent {...subcontent}><ContextMenuItem>JSON</ContextMenuItem></ContextMenuSubContent>
    </ContextMenuSub></ContextMenuContent></ContextMenu>
  <ContextMenu><ContextMenuTrigger>Custom record</ContextMenuTrigger><ContextMenuContent asChild>
    <section><ContextMenuViewport><ContextMenuItem>Composed action</ContextMenuItem></ContextMenuViewport></section>
  </ContextMenuContent></ContextMenu></>; }
`;
