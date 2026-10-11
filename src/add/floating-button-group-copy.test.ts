/** Qualified local action-tray copy closure; disposable external consumers only, never application configuration or data. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { addZeroSource } from './copy';
import { listStaticAddableTargets } from './registry';
import { SourceOnlyUpgradeExports } from '../doctor/source-only-upgrade-exports';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const root = new URL('../../', import.meta.url).pathname;
const family = 'components/controls/floating-button-group';

test('floating tray source target retains canonical helpers, skin and existing Tooltip without test/server assets', async () => {
  expect(listStaticAddableTargets().find(target => target.id === 'components/floating-button-group')?.sourceRel).toBe(family);
  const result = await addZeroSource({ targetDir: join(scratch, 'floating-button-group-copy-plan'), items: ['components/floating-button-group'], dryRun: true });
  for (const name of ['index.ts', 'floating-button-group.tsx', 'floating-button-group.types.ts', 'floating-button-group.css',
    'floating-button-group-model.ts', 'floating-button-group-geometry.ts', 'floating-button-group-label.tsx', 'use-floating-button-group-highlight.ts']) {
    expect(result.filesPlanned).toContain(`${family}/${name}`);
  }
  for (const name of ['components/ui/button.tsx', 'components/tooltip/index.ts', 'components/tooltip/tooltip-group.tsx',
    'components/_internal/overlay-scope/overlay-scope.tsx', 'lib/observe-presentation-theme.ts']) expect(result.filesPlanned).toContain(name);
  expect(result.filesPlanned.some(path => /\.(?:test|browser-fixture|package-fixture)\./u.test(path))).toBe(false);
  expect(result.filesPlanned.some(path => /frontend\/server|\/databases\//u.test(path))).toBe(false);
  expect(result.filesWritten).toHaveLength(0);
});

test('existing source-only Doctor resolves the additive public value and types without a toolbar migration rule', async () => {
  const pkg = await Bun.file(join(root, 'package.json')).json();
  const inspector = new SourceOnlyUpgradeExports(root, pkg.exports);
  for (const route of ['@zero/framework', '@zero/framework/react', '@zero/framework/components/floating-button-group']) {
    expect((await inspector.inspect(route, 'FloatingButtonGroup')).status).toBe('available');
    expect((await inspector.inspect(route, 'FloatingButtonGroupProps', 'any')).status).toBe('available');
    expect((await inspector.inspect(route, 'FloatingButtonGroupAction', 'any')).status).toBe('available');
  }
  expect((await inspector.inspect('@zero/framework/components/button-group', 'FloatingButtonGroup')).status).toBe('missing');
  expect((await inspector.inspect('@zero/framework/components/button-group', 'ButtonGroup')).status).toBe('available');
});

test('actual floating tray copy browser-builds from an isolated app-owned closure and preserves custom copies', async () => {
  await mkdir(scratch, { recursive: true });
  const consumer = await mkdtemp(join(scratch, 'floating-button-group-copy-'));
  try {
    const modules = join(consumer, 'node_modules'); await mkdir(join(modules, '@zero'), { recursive: true });
    await Promise.all((await readdir(join(root, 'node_modules'))).filter(name => name !== '@zero').map(name => symlink(join(root, 'node_modules', name), join(modules, name))));
    await symlink(root, join(modules, '@zero/framework'), 'dir');
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'Bundler', paths: { '@/*': ['./*'] } } }));
    await Bun.write(join(consumer, 'zero.config.ts'), "throw new Error('FLOATING_COPY_MUST_NOT_BOOT');\n");
    const copied = await addZeroSource({ targetDir: consumer, items: ['components/floating-button-group'] });
    expect(copied.filesWritten).toContain(`${family}/floating-button-group.css`);
    const component = join(consumer, family, 'floating-button-group.tsx');
    const original = await Bun.file(component).text();
    await Bun.write(component, original + '\n// APPLICATION CUSTOMIZATION MUST SURVIVE\n');
    expect((await addZeroSource({ targetDir: consumer, items: ['components/floating-button-group'] })).filesWritten).toHaveLength(0);
    expect(await Bun.file(component).text()).toContain('APPLICATION CUSTOMIZATION MUST SURVIVE');
    await Bun.write(join(consumer, 'entry.tsx'), "import {FloatingButtonGroup} from './components/controls/floating-button-group'; export const toolbar=<FloatingButtonGroup label='Actions' items={[{id:'copy',label:'Copy'}]}/>;\n");
    // Resolve aliases with the consumer's actual cwd/tsconfig, not the test runner's workspace config.
    const child = Bun.spawn([process.execPath, '--no-env-file', 'build', 'entry.tsx', '--target', 'browser', '--outdir', 'build'],
      { cwd: consumer, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Copied floating tray failed: ${stdout}\n${stderr}`);
    expect(code).toBe(0);
    const javascript = await Bun.file(join(consumer, 'build/entry.js')).text();
    expect(javascript).not.toContain('FLOATING_COPY_MUST_NOT_BOOT');
    expect(await Bun.file(join(consumer, 'build/entry.css')).text()).toContain('zero-floating-button-group-highlight');
  } finally {
    // Only this exact newly allocated consumer is disposable.
    await rm(consumer, { recursive: true, force: true });
  }
}, 45_000);
